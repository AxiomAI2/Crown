/**
 * Верификация ончейн-логики Фазы 3 БЕЗ airdrop (devnet-фасет лимитирован).
 *  (1) Сборщик донат-транзакции — против РЕАЛЬНОГО devnet (RPC-чтения getAccountInfo работают):
 *      проверяем форму инструкций (2×createATA, 2×transferChecked, memo) и декод memo.
 *  (2) Индексер (чистая extractDonation) — на синтетических parsed-транзакциях: корректный разбор,
 *      самоконтроль комиссии (неверное расщепление → не донат), отбраковка без memo / сырого перевода.
 * Полную отправку транзакции см. scripts/devnet-smoke.ts (нужен devnet SOL).
 */
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Connection, Keypair, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { ACTIVATION_FEE_MICRO, DEVNET_RPC, MEMO_PROGRAM_ID } from "../src/lib/chain/config";
import {
  buildActivationInstructions,
  buildDonationInstructions,
  splitAmount,
} from "../src/lib/chain/donation-tx";
import { extractActivation, extractDonation } from "../src/lib/chain/indexer";
import { decodeMemo, encodeActivationMemo, encodeMemo } from "../src/lib/chain/memo";
import { pointsForAmount } from "../src/lib/reputation";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

async function verifyBuilder() {
  console.log("\n— (1) Сборщик донат-транзакции против devnet —");
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const donor = Keypair.generate();
  const streamer = Keypair.generate();
  const treasury = Keypair.generate();
  const mint = Keypair.generate().publicKey;

  const ix = await buildDonationInstructions(connection, {
    donor: donor.publicKey,
    payout: streamer.publicKey,
    treasury: treasury.publicKey,
    mint,
    amountMicro: 10_000_000n,
    creatorId: "ch-lumi",
    donationId: "d-1",
    msgRef: "m-1",
  });

  const progs = ix.map((i) => i.programId.toBase58());
  check("5 инструкций (2×ATA + 2×transfer + memo)", ix.length === 5, `got ${ix.length}`);
  check(
    "первые две — createATA (ATA-программа)",
    progs[0] === ASSOCIATED_TOKEN_PROGRAM_ID.toBase58() &&
      progs[1] === ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
  );
  check(
    "две transferChecked (Token-программа)",
    progs[2] === TOKEN_PROGRAM_ID.toBase58() && progs[3] === TOKEN_PROGRAM_ID.toBase58(),
  );
  const memoIx = ix[4];
  check("последняя — memo (Memo-программа)", memoIx?.programId.toBase58() === MEMO_PROGRAM_ID.toBase58());
  const memo = memoIx ? decodeMemo(memoIx.data.toString("utf8")) : null;
  check(
    "memo декодируется в атрибуцию",
    memo?.c === "ch-lumi" && memo?.d === "d-1" && memo?.m === "m-1",
    JSON.stringify(memo),
  );

  const s = splitAmount(10_000_000n);
  check("расщепление 97/3: net=9.7, fee=0.3", s.net === 9_700_000n && s.fee === 300_000n);
}

function makeParsed(
  donor: string,
  mint: string,
  streamerAta: string,
  treasuryAta: string,
  netAmount: string,
  feeAmount: string,
  memo: string | null,
): ParsedTransactionWithMeta {
  const transfer = (destination: string, amount: string) => ({
    program: "spl-token",
    programId: TOKEN_PROGRAM_ID,
    parsed: {
      type: "transferChecked",
      info: { authority: donor, destination, mint, source: "donorAta", tokenAmount: { amount, decimals: 6 } },
    },
  });
  const instructions: unknown[] = [
    transfer(streamerAta, netAmount),
    transfer(treasuryAta, feeAmount),
  ];
  if (memo !== null) {
    instructions.push({ program: "spl-memo", programId: MEMO_PROGRAM_ID, parsed: memo });
  }
  return {
    blockTime: 1_700_000_000,
    slot: 1,
    meta: { err: null, fee: 5000, preBalances: [], postBalances: [] },
    transaction: { message: { instructions }, signatures: ["sig"] },
  } as unknown as ParsedTransactionWithMeta;
}

async function verifyIndexer() {
  console.log("\n— (2) Индексер (extractDonation) на синтетических tx —");
  const mint = Keypair.generate().publicKey;
  const streamer = Keypair.generate().publicKey;
  const treasury = Keypair.generate().publicKey;
  const donor = Keypair.generate().publicKey;
  const streamerAta = await getAssociatedTokenAddress(mint, streamer);
  const treasuryAta = await getAssociatedTokenAddress(mint, treasury);
  const opts = { mint, treasuryAta };

  // корректный донат
  const ok = extractDonation(
    makeParsed(
      donor.toBase58(),
      mint.toBase58(),
      streamerAta.toBase58(),
      treasuryAta.toBase58(),
      "9700000",
      "300000",
      encodeMemo({ c: "ch-lumi", d: "d-1", m: "m-1" }),
    ),
    "sig1",
    opts,
  );
  check("корректный донат распознан", ok !== null);
  check("amount=10M, net=9.7M, fee=0.3M", ok?.amountMicro === 10_000_000n && ok?.netMicro === 9_700_000n && ok?.feeMicro === 300_000n);
  check("донор, memo и streamerAta извлечены", ok?.donor === donor.toBase58() && ok?.memo.c === "ch-lumi" && ok?.streamerAta === streamerAta.toBase58());

  // самоконтроль комиссии: неверное расщепление → не донат
  const badSplit = extractDonation(
    makeParsed(donor.toBase58(), mint.toBase58(), streamerAta.toBase58(), treasuryAta.toBase58(), "9000000", "1000000", encodeMemo({ c: "ch-lumi", d: "d-2", m: null })),
    "sig2",
    opts,
  );
  check("неверное расщепление 90/10 отклонено (null)", badSplit === null);

  // без memo → не донат
  const noMemo = extractDonation(
    makeParsed(donor.toBase58(), mint.toBase58(), streamerAta.toBase58(), treasuryAta.toBase58(), "9700000", "300000", null),
    "sig3",
    opts,
  );
  check("без memo отклонено (null)", noMemo === null);

  // tx с ошибкой → не донат
  const errored = extractDonation(
    { blockTime: 1, slot: 1, meta: { err: { foo: 1 } }, transaction: { message: { instructions: [] }, signatures: [] } } as unknown as ParsedTransactionWithMeta,
    "sig4",
    opts,
  );
  check("tx с ошибкой отклонена (null)", errored === null);

  // R2: лишняя нога того же mint (помимо нетто+комиссии) → не наша tx → null
  const otherAta = (await getAssociatedTokenAddress(mint, Keypair.generate().publicKey)).toBase58();
  const leg = (dest: string, amount: string) => ({
    program: "spl-token",
    programId: TOKEN_PROGRAM_ID,
    parsed: {
      type: "transferChecked",
      info: { authority: donor.toBase58(), destination: dest, mint: mint.toBase58(), source: "donorAta", tokenAmount: { amount, decimals: 6 } },
    },
  });
  const extraLeg = extractDonation(
    {
      blockTime: 1,
      slot: 1,
      meta: { err: null, fee: 5000, preBalances: [], postBalances: [] },
      transaction: {
        message: {
          instructions: [
            leg(streamerAta.toBase58(), "9700000"),
            leg(treasuryAta.toBase58(), "300000"),
            leg(otherAta, "1"),
            { program: "spl-memo", programId: MEMO_PROGRAM_ID, parsed: encodeMemo({ c: "ch-lumi", d: "d-x", m: null }) },
          ],
        },
        signatures: ["sigExtra"],
      },
    } as unknown as ParsedTransactionWithMeta,
    "sigExtra",
    opts,
  );
  check("R2: лишняя нога mint → донат отклонён (null)", extraLeg === null);
}

function verifyReputation() {
  console.log("\n— (4) Очки репутации: курс 1:1, дробные без округления (ADR 0007 / A3) —");
  check("1 USDC → 1 очко", pointsForAmount(1_000_000n) === 1);
  check("2.5 USDC → 2.5 очка (дробные, без округления)", pointsForAmount(2_500_000n) === 2.5);
  // A3: дробление нейтрально — сумма частей равна очкам целого (никакой накрутки сплитом).
  check(
    "0.5 + 0.5 USDC = 1 USDC по очкам (нейтральность дробления)",
    pointsForAmount(500_000n) + pointsForAmount(500_000n) === pointsForAmount(1_000_000n),
  );
  check("0 → 0", pointsForAmount(0n) === 0);
  check("отрицательное → 0", pointsForAmount(-1n) === 0);
}

async function verifyActivation() {
  console.log("\n— (3) Сбор активации: сборщик (devnet) + индексер (extractActivation) —");
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const owner = Keypair.generate();
  const treasury = Keypair.generate();
  const mint = Keypair.generate().publicKey;

  const ix = await buildActivationInstructions(connection, {
    payer: owner.publicKey,
    treasury: treasury.publicKey,
    mint,
    channelId: "ch-lumi",
    feeMicro: ACTIVATION_FEE_MICRO,
  });
  const progs = ix.map((i) => i.programId.toBase58());
  check("2 инструкции (createATA трежери + transfer + memo)", ix.length === 3, `got ${ix.length}`);
  check("первая — createATA (ATA-программа)", progs[0] === ASSOCIATED_TOKEN_PROGRAM_ID.toBase58());
  check("вторая — transferChecked (Token-программа)", progs[1] === TOKEN_PROGRAM_ID.toBase58());
  const memoIx = ix[2];
  check("последняя — memo (Memo-программа)", memoIx?.programId.toBase58() === MEMO_PROGRAM_ID.toBase58());
  check(
    "memo декодируется в {act: channelId}",
    memoIx ? memoIx.data.toString("utf8") === encodeActivationMemo("ch-lumi") : false,
  );

  // — индексер на синтетических tx —
  const treasuryAta = await getAssociatedTokenAddress(mint, treasury.publicKey);
  const otherAta = await getAssociatedTokenAddress(mint, Keypair.generate().publicKey);
  const opts = { mint, treasuryAta };
  const makeAct = (dest: string, amount: string, memo: string | null) =>
    ({
      blockTime: 1_700_000_000,
      slot: 1,
      meta: { err: null, fee: 5000, preBalances: [], postBalances: [] },
      transaction: {
        message: {
          instructions: [
            {
              program: "spl-token",
              programId: TOKEN_PROGRAM_ID,
              parsed: {
                type: "transferChecked",
                info: {
                  authority: owner.publicKey.toBase58(),
                  destination: dest,
                  mint: mint.toBase58(),
                  source: "ownerAta",
                  tokenAmount: { amount, decimals: 6 },
                },
              },
            },
            ...(memo === null
              ? []
              : [{ program: "spl-memo", programId: MEMO_PROGRAM_ID, parsed: memo }]),
          ],
        },
        signatures: ["sig"],
      },
    }) as unknown as ParsedTransactionWithMeta;

  const ok = extractActivation(
    makeAct(treasuryAta.toBase58(), "2000000", encodeActivationMemo("ch-lumi")),
    "asig1",
    opts,
  );
  check("корректный сбор распознан", ok !== null);
  check(
    "payer, channelId, amount извлечены",
    ok?.payer === owner.publicKey.toBase58() && ok?.channelId === "ch-lumi" && ok?.amountMicro === 2_000_000n,
  );

  const noMemo = extractActivation(makeAct(treasuryAta.toBase58(), "2000000", null), "asig2", opts);
  check("без memo {act} отклонено (null)", noMemo === null);

  const wrongDest = extractActivation(
    makeAct(otherAta.toBase58(), "2000000", encodeActivationMemo("ch-lumi")),
    "asig3",
    opts,
  );
  check("перевод не в трежери отклонён (null)", wrongDest === null);
}

async function main() {
  await verifyBuilder();
  await verifyIndexer();
  await verifyActivation();
  verifyReputation();
  console.log(failures === 0 ? "\n✅ ВСЕ ПРОВЕРКИ ПРОШЛИ" : `\n❌ ПРОВАЛОВ: ${failures}`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error("❌ FAILED:", e);
  process.exit(1);
});
