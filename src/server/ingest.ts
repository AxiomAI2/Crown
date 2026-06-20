import { getAssociatedTokenAddress } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { assertMoneyConfig, DEVNET_RPC, mintPubkey, treasuryPubkey } from "@/lib/chain/config";
import { parseDonationTx } from "@/lib/chain/indexer";
import { hashContent } from "@/lib/data/moderation";
import { CHAIN_MODE } from "@/server/runtime";
import type { MockDataProvider } from "@/lib/data/mock-provider";

/**
 * Доверенный приём ончейн-доната по подписи: сервер САМ достаёт транзакцию из devnet, валидирует пару
 * 97/3 + memo, сверяет, что 97%-нога ушла на payout-ATA канала (трастлесс — не верит клиенту), и
 * идемпотентно записывает донат в стор. Зовётся из RPC (клиент после отправки) и из индексер-сервиса.
 * Только серверный модуль (web3.js не попадает в клиентские bundle mock/api).
 */
export async function ingestSignature(
  store: MockDataProvider,
  signature: string,
  text?: string,
): Promise<{ ok: boolean; reason?: string; points?: number }> {
  assertMoneyConfig(); // fail-closed: на mainnet без явной денежной конфигурации донат не принимаем (C2)
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const mint = mintPubkey();
  const treasuryAta = await getAssociatedTokenAddress(mint, treasuryPubkey());

  const indexed = await parseDonationTx(connection, signature, {
    mint,
    treasuryAta,
    commitment: CHAIN_MODE ? "finalized" : "confirmed",
  });
  if (!indexed) return { ok: false, reason: "не валидная донат-транзакция (нет пары 97/3 + memo)" };

  const channelId = indexed.memo.c;
  const channel = store.__getChannelById(channelId);
  if (!channel) return { ok: false, reason: `канал ${channelId} не найден` };

  // Трастлесс-проверка: 97%-нога должна уйти именно на payout-ATA канала.
  const expectedStreamerAta = (
    await getAssociatedTokenAddress(mint, new PublicKey(channel.payoutAddress))
  ).toBase58();
  if (indexed.streamerAta !== expectedStreamerAta) {
    return { ok: false, reason: "97%-нога ушла не на payout канала" };
  }

  // Трастлесс-привязка текста: memo.m несёт contentHash(текста). Принимаем текст ТОЛЬКО если его хэш
  // совпал с ончейн-memo (донор подписал именно его). Иначе текст игнорируем — деньги/репутация не зависят.
  const verifiedText =
    text && indexed.memo.m && hashContent(text) === indexed.memo.m ? text : undefined;

  const res = store.recordDonationFromChain({
    signature,
    donor: indexed.donor,
    channelId,
    amountMicro: indexed.amountMicro,
    feeMicro: indexed.feeMicro,
    netMicro: indexed.netMicro,
    text: verifiedText,
  });
  if (!res) return { ok: false, reason: "уже принято или канал отсутствует" };
  return { ok: true, points: res.standing.points };
}
