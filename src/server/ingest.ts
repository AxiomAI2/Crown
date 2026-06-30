import { getAssociatedTokenAddress } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  ACTIVATION_FEE_MICRO,
  assertMoneyConfig,
  DEVNET_RPC,
  mintPubkey,
  treasuryPubkey,
} from "@/lib/chain/config";
import { extractActivation, extractDonation } from "@/lib/chain/indexer";
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
): Promise<{ ok: boolean; pending?: boolean; reason?: string; points?: number }> {
  assertMoneyConfig(); // fail-closed: на mainnet без явной денежной конфигурации донат не принимаем (C2)
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const mint = mintPubkey();
  const treasuryAta = await getAssociatedTokenAddress(mint, treasuryPubkey());

  // M2: в chain-режиме зачёт ждёт "finalized" (анти-реорг). Финализация наступает на ~15-30с ПОЗЖЕ
  // клиентского "confirmed" → tx может быть ещё не видна. Это НЕ ошибка: возвращаем pending, клиент повторит
  // (иначе деньги ушли, а зачёта нет). null ПОСЛЕ фетча = реально невалидная tx — не повторяем.
  const commitment = CHAIN_MODE ? "finalized" : "confirmed";
  const tx = await connection.getParsedTransaction(signature, {
    commitment,
    maxSupportedTransactionVersion: 0,
  });
  if (!tx) {
    return { ok: false, pending: true, reason: "транзакция ещё не подтверждена на нужном уровне — повторим" };
  }
  const indexed = extractDonation(tx, signature, { mint, treasuryAta });
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

  const cfg = await store.getChannelConfig(channelId);
  // B7: ниже минимума канала донат не принимаем (паритет с off-chain createDonation — анти-спам). Деньги
  // реальны, но политику спам-порога держим одинаковой на обоих путях.
  if (indexed.amountMicro < cfg.minDonation) {
    return { ok: false, reason: "сумма доната ниже минимума канала" };
  }
  // Трастлесс-привязка текста: memo.m несёт contentHash(текста). Принимаем текст ТОЛЬКО если его хэш совпал
  // с ончейн-memo (донор подписал именно его), длина в пределах лимита канала (R5/ADR 0012) И сумма ≥
  // minDonationWithText (как off-chain — текст требует порога). Иначе текст игнорируем — деньги/репутация не зависят.
  const verifiedText =
    text &&
    text.length <= cfg.messageMaxLen &&
    indexed.amountMicro >= cfg.minDonationWithText &&
    indexed.memo.m &&
    hashContent(text) === indexed.memo.m
      ? text
      : undefined;

  const res = await store.recordDonationFromChain({
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

/**
 * Доверенный приём ончейн-сбора активации по подписи: сервер сам достаёт tx, проверяет перевод
 * payer→treasuryATA ≥ ACTIVATION_FEE и memo `{act}`, сверяет payer === владелец канала (трастлесс — не
 * верит клиенту) и идемпотентно переводит канал в ACTIVE. Деньги сбора — оператору, не возврат (§4.1).
 */
export async function ingestActivation(
  store: MockDataProvider,
  signature: string,
): Promise<{ ok: boolean; pending?: boolean; reason?: string }> {
  assertMoneyConfig(); // fail-closed: на mainnet без денежной конфигурации сбор не принимаем (C2)
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const mint = mintPubkey();
  const treasuryAta = await getAssociatedTokenAddress(mint, treasuryPubkey());

  // M2: см. ingestSignature — finalized в chain-режиме. tx не видна сразу после client-confirmed → pending
  // (клиент повторит), иначе сбор уплачен, а канал не активирован (ровно этот баг и был).
  const commitment = CHAIN_MODE ? "finalized" : "confirmed";
  const tx = await connection.getParsedTransaction(signature, {
    commitment,
    maxSupportedTransactionVersion: 0,
  });
  if (!tx) {
    return { ok: false, pending: true, reason: "транзакция активации ещё не финализирована — повторим" };
  }
  const indexed = extractActivation(tx, signature, { mint, treasuryAta });
  if (!indexed) return { ok: false, reason: "не валидная транзакция активации (нет перевода + memo {act})" };

  const channel = store.__getChannelById(indexed.channelId);
  if (!channel) return { ok: false, reason: `канал ${indexed.channelId} не найден` };
  if (indexed.payer !== channel.ownerAddress) {
    return { ok: false, reason: "сбор уплачен не владельцем канала" };
  }
  if (indexed.amountMicro < ACTIVATION_FEE_MICRO) {
    return { ok: false, reason: "сумма сбора активации ниже требуемой" };
  }

  store.activateFromChain(indexed.channelId);
  return { ok: true };
}
