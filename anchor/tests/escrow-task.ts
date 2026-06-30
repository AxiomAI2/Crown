/**
 * Скаффолд anchor-тестов эскроу-программы (G3a) для `anchor test` на localnet (нужен тулчейн, см. BUILD.md).
 *
 * ⚠️ КАНОНИЧЕСКАЯ проверка — `scripts/escrow-smoke.ts` (гоняется против ЖИВОЙ devnet-программы; happy через
 * resolve_timeout + refund + проверка аудита #1). Этот файл покрывает time-независимые пути под НОВОЙ моделью
 * (после аудита):
 *   • refund: fund → reject → claim_donor (100%);
 *   • audit #1: резолвер/трежери — КОНСТАНТЫ программы; fund их не принимает, чужой ключ не может mark_disputed.
 * Пути по таймауту (resolve_timeout, окно спора) и резолв спора (нужен ключ оператора-резолвера) требуют
 * клок-варпа валидатора / реального резолвера — здесь не покрыты (см. escrow-smoke.ts).
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { assert } from "chai";
import { EscrowTask } from "../target/types/escrow_task";

const AMOUNT = 5_000_000;
const EXEC_WINDOW = new anchor.BN(600); // 10 мин

describe("escrow-task (G3a, после аудита)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.EscrowTask as Program<EscrowTask>;
  const conn = provider.connection;

  const streamer = Keypair.generate();
  let mint: anchor.web3.PublicKey;
  let donorAta: anchor.web3.PublicKey;

  const taskId = (s: string) => {
    const b = Buffer.alloc(32);
    b.write(s);
    return [...b];
  };

  before(async () => {
    const donor = provider.wallet.publicKey; // donor = провайдер-кошелёк
    await conn.confirmTransaction(await conn.requestAirdrop(streamer.publicKey, LAMPORTS_PER_SOL));
    mint = await createMint(conn, (provider.wallet as anchor.Wallet).payer, donor, null, 6);
    donorAta = (
      await getOrCreateAssociatedTokenAccount(
        conn,
        (provider.wallet as anchor.Wallet).payer,
        mint,
        donor,
      )
    ).address;
    await mintTo(conn, (provider.wallet as anchor.Wallet).payer, mint, donorAta, donor, AMOUNT * 2);
  });

  it("refund: fund → reject → claim_donor (100% назад)", async () => {
    const t = taskId("refund");
    const before = (await getAccount(conn, donorAta)).amount;
    // fund: резолвер/трежери НЕ передаются (константы программы; аудит #1).
    await program.methods
      .fund(t, new anchor.BN(AMOUNT), EXEC_WINDOW)
      .accounts({ donor: provider.wallet.publicKey, donorToken: donorAta, mint, streamer: streamer.publicKey })
      .rpc();
    await program.methods.reject().accounts({ streamer: streamer.publicKey }).signers([streamer]).rpc();
    await program.methods.claimDonor().accounts({ donor: provider.wallet.publicKey, mint }).rpc();
    assert.equal((await getAccount(conn, donorAta)).amount, before, "донору вернулось 100%");
  });

  it("audit #1: чужой ключ не может mark_disputed (резолвер захардкожен)", async () => {
    const t = taskId("audit1");
    await program.methods
      .fund(t, new anchor.BN(AMOUNT), EXEC_WINDOW)
      .accounts({ donor: provider.wallet.publicKey, donorToken: donorAta, mint, streamer: streamer.publicKey })
      .rpc();
    await program.methods.markDone().accounts({ streamer: streamer.publicKey }).signers([streamer]).rpc();
    let blocked = false;
    try {
      // streamer ≠ RESOLVER-константа → constraint resolver.key()==escrow.resolver падает.
      await program.methods.markDisputed().accounts({ resolver: streamer.publicKey }).signers([streamer]).rpc();
    } catch {
      blocked = true;
    }
    assert.isTrue(blocked, "mark_disputed чужим ключом отклонён");
  });
});
