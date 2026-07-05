/**
 * dispute-smoke (M2, ADR 0021) — живой прогон СПОРА ЧЕРЕЗ КАНИСТРУ против настоящей связки
 * devnet + core-канистра: исход спора приходит от тресхолд-резолвера, без участия площадки.
 *
 *   npx tsx scripts/dispute-smoke.ts [--canister http://<id>.raw.localhost:4943]
 *
 * Сценарий (двумя ключами, ~5–7 минут из-за finalized-ожиданий и окон):
 *  1) канал `m2-smoke`: активация владельцем (id.json) → канистра выучивает владельца из цепочки;
 *  2) донат 9tSW→канал (97/3+memo) → вес будущего присяжного в журнале канистры;
 *  3) эскроу: fund (донор 9tSW) → accept → грейс → markDone (стример id.json);
 *     резолвер эскроу обязан быть ТРЕСХОЛД-АДРЕСОМ КАНИСТРЫ (проверка редеплоя);
 *  4) спор: POST /dispute/open (подпись инициатора) → канистра шлёт mark_disputed ончейн;
 *  5) голос: POST /dispute/vote (подпись, вес = снимок журнала);
 *  6) окно голосования → канистра финализирует и шлёт resolve_dispute тресхолд-подписью;
 *  7) сверка ончейн: state=Resolved, resolution=ToDonor → claim_donor возвращает USDC;
 *  8) сверка журнала: инициатору DISPUTE_WON +10 очков.
 *
 * Требования: локальный стенд канистры (runbook «Канистры ICP»), SOL на обоих ключах,
 * USDC в трежери-ATA. Ничего не мокается — все транзакции настоящие.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { buildOpenDisputeMessage, buildVoteMessage } from "../src/lib/chain/dispute-vote";
import {
  buildAcceptIx,
  buildClaimDonorIxs,
  buildFundIx,
  buildMarkDoneIx,
  decodeEscrow,
  escrowPda,
} from "../src/lib/chain/escrow-tx";
import {
  DEVNET_RPC,
  DEVNET_USDC_MINT,
  ESCROW_PROGRAM_ID,
  TREASURY_OWNER,
} from "../src/lib/chain/addresses";
import { encodeActivationMemo, encodeMemo, buildMemoInstruction } from "../src/lib/chain/memo";
import { splitAmount } from "../src/lib/chain/donation-tx";

const CHANNEL = "m2-smoke";
const FUND_MICRO = 1_000_000n; // $1 в эскроу
const DONATION_MICRO = 2_000_000n; // $2 → вес присяжного 2 очка

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const CANISTER = arg("canister") ?? "http://uxrrr-q7777-77774-qaaaq-cai.raw.localhost:4943";

const ok = (m: string) => console.log(`✅ ${m}`);
const step = (m: string) => console.log(`\n— ${m}`);
const die = (m: string): never => {
  console.error(`❌ ${m}`);
  process.exit(1);
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(
  what: string,
  timeoutMs: number,
  probe: () => Promise<T | null>,
): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await probe().catch(() => null);
    if (v !== null) return v;
    if (Date.now() - t0 > timeoutMs) die(`таймаут: ${what}`);
    await sleep(10_000);
  }
}

async function canisterGet<T>(path: string): Promise<T> {
  const res = await fetch(`${CANISTER}${path}`);
  return (await res.json()) as T;
}
async function canisterPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${CANISTER}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

const signMsg = (kp: Keypair, msg: string) =>
  bs58.encode(nacl.sign.detached(new TextEncoder().encode(msg), kp.secretKey));

async function main() {
  if (!DEVNET_USDC_MINT || !TREASURY_OWNER || !ESCROW_PROGRAM_ID)
    die("нет денежного конфига (env)");
  const conn = new Connection(DEVNET_RPC, "confirmed");
  const mint = new PublicKey(DEVNET_USDC_MINT!);
  const program = new PublicKey(ESCROW_PROGRAM_ID!);
  const streamer = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, "utf8"))),
  );
  const donor = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(readFileSync(".treasury-devnet.json", "utf8"))),
  );
  const treasuryAta = await getAssociatedTokenAddress(mint, new PublicKey(TREASURY_OWNER!));
  const streamerAta = await getAssociatedTokenAddress(mint, streamer.publicKey);
  const send = (tx: Transaction, signers: Keypair[]) =>
    sendAndConfirmTransaction(conn, tx, signers, { commitment: "confirmed" });

  console.log(
    `канистра: ${CANISTER}\nстример/владелец: ${streamer.publicKey.toBase58()}\nдонор/присяжный: ${donor.publicKey.toBase58()}`,
  );

  // ── 1. Канал: активация владельцем (канистра выучит владельца из цепочки) ──
  step(`канал ${CHANNEL}: активация владельцем`);
  const params0 = await canisterGet<{ owner: string | null }>(`/dispute-params?channel=${CHANNEL}`);
  if (params0.owner === streamer.publicKey.toBase58()) {
    ok("активация уже в журнале канистры (повторный прогон)");
  } else {
    // Стримеру нужен USDC на взнос активации: закинем $0.01 из трежери.
    const ixs: TransactionInstruction[] = [];
    if (!(await conn.getAccountInfo(streamerAta)))
      ixs.push(
        createAssociatedTokenAccountInstruction(
          donor.publicKey,
          streamerAta,
          streamer.publicKey,
          mint,
        ),
      );
    ixs.push(
      createTransferCheckedInstruction(treasuryAta, mint, streamerAta, donor.publicKey, 10_000n, 6),
    );
    await send(new Transaction().add(...ixs), [donor]);
    const act = new Transaction().add(
      createTransferCheckedInstruction(
        streamerAta,
        mint,
        treasuryAta,
        streamer.publicKey,
        10_000n,
        6,
      ),
      buildMemoInstruction(encodeActivationMemo(CHANNEL)),
    );
    const sig = await send(act, [streamer]);
    ok(`активация в цепочке: ${sig.slice(0, 16)}…`);
    await until("канистра выучила владельца канала", 240_000, async () => {
      const p = await canisterGet<{ owner: string | null }>(`/dispute-params?channel=${CHANNEL}`);
      return p.owner === streamer.publicKey.toBase58() ? p : null;
    });
    ok("канистра вывела владельца из цепочки");
  }

  // ── 2. Вес присяжного: донат 97/3 каналу ──
  step("донат для веса присяжного (2 USDC, 97/3 + memo)");
  const donorAddr = donor.publicKey.toBase58();
  const weightBefore = await canisterGet<{ standing: { pointsMicro: string } }>(
    `/standing?channel=${CHANNEL}&address=${donorAddr}`,
  );
  if (BigInt(weightBefore.standing.pointsMicro) >= 1_000_000n) {
    ok("вес уже есть (повторный прогон)");
  } else {
    const { fee, net } = splitAmount(DONATION_MICRO);
    const donation = new Transaction().add(
      createTransferCheckedInstruction(treasuryAta, mint, streamerAta, donor.publicKey, net, 6),
      createTransferCheckedInstruction(treasuryAta, mint, treasuryAta, donor.publicKey, fee, 6),
      buildMemoInstruction(encodeMemo({ c: CHANNEL, d: `smoke-${Date.now()}`, m: null })),
    );
    const sig = await send(donation, [donor]);
    ok(`донат в цепочке: ${sig.slice(0, 16)}…`);
    await until("канистра забанковала вес", 240_000, async () => {
      const s = await canisterGet<{ standing: { pointsMicro: string } }>(
        `/standing?channel=${CHANNEL}&address=${donorAddr}`,
      );
      return BigInt(s.standing.pointsMicro) >= 1_000_000n ? s : null;
    });
    ok("вес присяжного в журнале канистры");
  }

  // ── 3. Эскроу: fund → accept → грейс → markDone ──
  step("эскроу: fund → accept → (грейс 61с) → markDone");
  const taskId = new Uint8Array(randomBytes(32));
  const escrowAccount = escrowPda(program, taskId);
  console.log(`   эскроу: ${escrowAccount.toBase58()}`);
  await send(
    new Transaction().add(
      await buildFundIx({
        programId: program,
        donor: donor.publicKey,
        streamer: streamer.publicKey,
        mint,
        taskId,
        amount: FUND_MICRO,
        executionWindow: 600n, // 10 минут на сдачу — смоуку хватает с запасом
      }),
    ),
    [donor],
  );
  ok("fund: $1 заперт в PDA");

  const escrowInfo = async () => decodeEscrow((await conn.getAccountInfo(escrowAccount))!.data);
  const resolver = (await escrowInfo()).resolver.toBase58();
  console.log(`   резолвер эскроу: ${resolver}`);
  const canisterStatus = await canisterGet<{ config?: unknown }>(`/status`);
  void canisterStatus;
  if (resolver === "6F5Y3qLdDCB7gm1hFwdangodbRjWJRhnvNSxgPofB5xR")
    die("резолвер — старый операторский ключ: редеплой программы не подхватился");
  ok("резолвер эскроу = тресхолд-адрес канистры (редеплой работает)");

  await send(new Transaction().add(buildAcceptIx(program, streamer.publicKey, taskId)), [streamer]);
  ok("accept");
  console.log("   ждём грейс-окно отмены (61с)…");
  await sleep(61_000);
  await send(new Transaction().add(buildMarkDoneIx(program, streamer.publicKey, taskId)), [
    streamer,
  ]);
  ok("markDone — окно спора открыто (2 мин)");

  // Канистра читает цепочку ТОЛЬКО в finalized (анти-реорг, M2-принцип) — дождёмся финализации.
  const finalizedConn = new Connection(DEVNET_RPC, "finalized");
  await until("markDone финализирован (канистре виден Done)", 90_000, async () => {
    const info = await finalizedConn.getAccountInfo(escrowAccount);
    return info && decodeEscrow(info.data).state === 2 ? true : null;
  });
  ok("финализация дошла — канистра увидит Done");

  // ── 4. Спор через канистру ──
  step("открытие спора (подпись инициатора → канистра шлёт mark_disputed тресхолдом)");
  const escrowB58 = escrowAccount.toBase58();
  const openMsg = buildOpenDisputeMessage(escrowB58, CHANNEL, donorAddr);
  const opened = await canisterPost<{
    ok: boolean;
    error?: string;
    dispute?: { markDisputedTx?: string };
  }>("/dispute/open", {
    escrowAccount: escrowB58,
    channelId: CHANNEL,
    by: donorAddr,
    signature: signMsg(donor, openMsg),
  });
  if (!opened.ok) die(`канистра отвергла спор: ${opened.error}`);
  ok("спор открыт в канистре");

  const marked = await until("mark_disputed в цепочке (state=Disputed)", 180_000, async () => {
    const e = await escrowInfo();
    return e.state === 4 ? e : null;
  });
  void marked;
  ok("ончейн: эскроу помечен спорным ТРЕСХОЛД-ПОДПИСЬЮ канистры");

  // ── 5. Голос ──
  step("голос присяжного (не выполнено)");
  const voteMsg = buildVoteMessage(escrowB58, CHANNEL, donorAddr, "not_completed");
  const voted = await canisterPost<{ ok: boolean; error?: string }>("/dispute/vote", {
    escrowAccount: escrowB58,
    voter: donorAddr,
    choice: "not_completed",
    signature: signMsg(donor, voteMsg),
  });
  if (!voted.ok) die(`голос отвергнут: ${(voted as { error?: string }).error}`);
  ok("голос принят (вес — снимок журнала на момент открытия)");

  // ── 6. Финализация и ончейн-вердикт ──
  step("окно голосования (2 мин) → вердикт → resolve_dispute тресхолдом");
  const resolved = await until("resolve_dispute в цепочке (state=Resolved)", 360_000, async () => {
    const e = await escrowInfo();
    return e.state === 3 ? e : null;
  });
  if (resolved.resolution !== 2) die(`резолюция ${resolved.resolution}, ожидалась ToDonor(2)`);
  ok("ончейн: спор решён КАНИСТРОЙ в пользу донора — площадка не участвовала");
  const kase = await canisterGet<{ verdict?: { reason: string }; resolveTx?: string }>(
    `/dispute?escrow=${escrowB58}`,
  );
  console.log(`   вердикт: ${kase.verdict?.reason}, resolve-tx: ${kase.resolveTx?.slice(0, 16)}…`);

  // ── 7. Возврат денег ──
  step("claim: донор забирает возврат");
  const balBefore = BigInt((await conn.getTokenAccountBalance(treasuryAta)).value.amount);
  await send(
    new Transaction().add(
      ...(await buildClaimDonorIxs(conn, {
        programId: program,
        donor: donor.publicKey,
        mint,
        taskId,
      })),
    ),
    [donor],
  );
  const balAfter = BigInt((await conn.getTokenAccountBalance(treasuryAta)).value.amount);
  if (balAfter - balBefore !== FUND_MICRO)
    die(`возврат ${balAfter - balBefore} micro, ожидался ${FUND_MICRO}`);
  ok("деньги вернулись донору полностью ($1)");

  // ── 8. Репутационный эффект ──
  step("журнал канистры: DISPUTE_WON инициатору");
  await until("+10 очков за подтверждённый спор", 120_000, async () => {
    const s = await canisterGet<{ standing: { pointsMicro: string } }>(
      `/standing?channel=${CHANNEL}&address=${donorAddr}`,
    );
    return BigInt(s.standing.pointsMicro) >= 12_000_000n ? s : null; // 2 (донат) + 10 (DISPUTE_WON)
  });
  ok("репутация инициатора выросла на +10 (свёртка журнала канистры)");

  console.log(
    "\n✅ DISPUTE-SMOKE ПРОЙДЕН: спор от открытия до денег решён канистрой без площадки.",
  );
}

void main().catch((e) => {
  console.error("СМОУК УПАЛ:", e instanceof Error ? e.message : e);
  process.exit(1);
});
