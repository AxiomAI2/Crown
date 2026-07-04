import type { WalletContextState } from "@solana/wallet-adapter-react";
import { Connection, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  ACTIVATION_FEE_MICRO,
  DEVNET_RPC,
  DEVNET_USDC_MINT,
  ESCROW_PROGRAM_ID,
  SIWS_STORAGE_KEY,
  TREASURY_OWNER,
} from "../chain/config";
import {
  buildActivationInstructions,
  buildDonationInstructions,
  splitAmount,
} from "../chain/donation-tx";
import {
  buildAcceptIx,
  buildCancelIx,
  buildClaimDonorIxs,
  buildClaimStreamerIxs,
  buildFundIx,
  buildMarkDisputedIx,
  buildMarkDoneIx,
  buildRejectIx,
  buildResolveDisputeIx,
  buildResolveTimeoutIx,
  decodeEscrow,
  escrowPda,
} from "../chain/escrow-tx";
import { WINDOWS } from "@/games/escrow-task/machine";
import { buildPayoutAttestationMessage, verifyPayoutAttestation } from "../chain/attestation";
import { resolveTier } from "../reputation";
import { toMicro } from "../utils";
import { ApiDataProvider } from "./api-provider";
import { hashContent, taskTextCommitment } from "./moderation";
import { DataError, type DataProvider, type Result } from "./provider";
import type {
  Address,
  Channel,
  ChannelBlock,
  ChannelCard,
  ChannelConfig,
  ConfigPatch,
  CreateChannelInput,
  Donation,
  DonationInput,
  DonationResult,
  DonorOverview,
  GameRequest,
  HomeFeed,
  IncidentLog,
  LeaderboardEntry,
  LeaderboardPeriod,
  LightProfile,
  ListOpts,
  MessageRef,
  OperatorAction,
  Page,
  Session,
  ViewerStanding,
} from "./types";

/**
 * Фаза 3 (crypto/spec.md §7): ГИБРИД. Чтение репутации/каналов/модерации — из оффчейн-бэкенда
 * (индексер кормит его), поэтому делегируется `ApiDataProvider`. Запись денег — через кошелёк:
 * `connect` (SIWS, gasless), `createDonation` (сборка tx 97/3 + memo + ATA, подпись кошельком).
 * Финальный зачёт репутации делает индексер; здесь возвращается оптимистичный результат.
 *
 * Кошелёк инжектится из React-дерева (useWallet) через setWallet — класс не вызывает хуки.
 */
/** Uint8Array → base64 без Buffer (браузер). Подпись 64 байта — простая реализация достаточна. */
function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

// — Хелперы 32-байтового seed эскроу (chain-режим игры, G3a) —
const toHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
function fromHex(s: string): Uint8Array {
  const a = new Uint8Array(s.length >> 1);
  for (let i = 0; i < a.length; i++) a[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return a;
}
function randomTaskId(): Uint8Array {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  return a;
}

export class ChainDataProvider implements DataProvider {
  private api = new ApiDataProvider();
  private connection = new Connection(DEVNET_RPC, "confirmed");
  // protected: IcpDataProvider (подкласс) подписывает кошельком governance-сообщения (M1).
  protected wallet: WalletContextState | null = null;
  private authedAddress: string | null = null; // адрес, по которому уже есть проверенный токен
  private authing: Promise<boolean> | null = null;

  constructor() {
    // Сессия привязана к ПОДКЛЮЧЁННОМУ кошельку: на старте токен из localStorage НЕ применяем «вслепую» —
    // иначе UI «полу-залогинен» (форма доната/standing активны), хотя кошелёк не подключён и подписать нечем.
    // Когда кошелёк подключится (autoConnect или «Войти»), bridge вызовет ensureAuth → тот переиспользует
    // сохранённый токен БЕЗ повторной подписи. Так шапка, standing и донат всегда отражают одно состояние.
  }

  setWallet(wallet: WalletContextState | null) {
    this.wallet = wallet;
    // Личность бэкенда = ПРОВЕРЕННЫЙ токен (ensureAuth), не голый pubkey (дыра C1). Роняем сессию ТОЛЬКО при
    // смене на ДРУГОЙ подключённый адрес. «Кошелёк не подключён» (addr === null, напр. refresh без
    // autoConnect) НЕ должно ронять восстановленный токен — выход делается явно (__logout из bridge).
    const addr = wallet?.publicKey?.toBase58() ?? null;
    if (addr !== null && addr !== this.authedAddress) this.clearAuth();
  }
  /** Полный выход: забыть токен (память + localStorage). Зовётся bridge при ЯВНОМ дисконекте кошелька. */
  __logout() {
    this.clearAuth();
    this.clearStoredToken();
  }
  private address(): string | null {
    return this.wallet?.publicKey?.toBase58() ?? null;
  }

  // — Аутентификация (SIWS): nonce от сервера → подпись кошельком → session-токен —
  private clearAuth() {
    this.authedAddress = null;
    this.api.__setToken(null);
  }
  private loadStoredToken(address: string): string | null {
    if (typeof localStorage === "undefined") return null;
    try {
      const o = JSON.parse(localStorage.getItem(SIWS_STORAGE_KEY) ?? "null") as {
        address: string;
        token: string;
        exp: number;
      } | null;
      if (o && o.address === address && o.exp > Date.now()) return o.token;
    } catch {
      /* битый/пустой стор */
    }
    return null;
  }
  private storeToken(address: string, token: string, exp: number) {
    try {
      localStorage?.setItem(SIWS_STORAGE_KEY, JSON.stringify({ address, token, exp }));
    } catch {
      /* приватный режим/квота — не критично, останемся без персистентности */
    }
  }
  private clearStoredToken() {
    try {
      localStorage?.removeItem(SIWS_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
  /**
   * Гарантирует проверенную личность для подключённого кошелька. Идемпотентно: при уже валидном токене
   * (в памяти или localStorage) НЕ просит подпись повторно. Возвращает true, если состояние изменилось
   * (повод инвалидировать кэш запросов). Донаты не зовут этот метод — донатить можно без входа.
   */
  async ensureAuth(): Promise<boolean> {
    const w = this.wallet;
    if (!w?.connected || !w.publicKey) {
      if (this.authedAddress) {
        this.clearAuth();
        return true;
      }
      return false;
    }
    const address = w.publicKey.toBase58();
    if (this.authedAddress === address) return false;
    if (this.authing) return this.authing;

    const p = (async () => {
      // 1. Пробуем сохранённый токен, но ПРОВЕРЯЕМ его против сервера (источник истины). Сессии на сервере
      //    in-memory → после рестарта сервера/истечения токена localStorage-токен уже не резолвится. Без этой
      //    проверки UI оставался бы «полу-залогинен»: кошелёк подключён (адрес виден), но сессия пустая →
      //    кнопки создателя/после регистрации сброшены.
      const stored = this.loadStoredToken(address);
      if (stored) {
        this.api.__setToken(stored);
        const s = await this.api.getSession();
        if (s.address === address) {
          this.authedAddress = address;
          return true;
        }
        this.clearStoredToken(); // токен протух на сервере → чистим и идём на свежую подпись
        this.api.__setToken(null);
      }
      // 2. Свежий SIWS: серверный nonce + подпись кошельком.
      if (!w.signMessage) throw new DataError("NO_SIGN", "Кошелёк не умеет подписывать сообщения.");
      const { message } = await this.api.authNonce(address);
      let sig: Uint8Array;
      try {
        sig = await w.signMessage(new TextEncoder().encode(message));
      } catch {
        // Пользователь отклонил подпись SIWS (или кошелёк не смог) — это ШТАТНЫЙ отказ, не краш. Отключаем
        // кошелёк, чтобы UI вернулся к исходной «Войти» (а не залип в «Войти (подпись)»), и НЕ пробрасываем
        // ошибку — иначе всплывает dev-overlay и кнопка подвисает.
        await w.disconnect?.().catch(() => {});
        this.clearAuth();
        return false;
      }
      const { token, exp } = await this.api.authVerify(address, toBase64(sig));
      this.api.__setToken(token);
      this.storeToken(address, token, exp);
      this.authedAddress = address;
      return true;
    })();
    this.authing = p;
    // finally-цепочка может ОТКЛОНИТЬСЯ (ошибка сервера в authNonce/authVerify) → гасим её .catch, иначе
    // unhandled rejection всплывёт dev-overlay'ем. Саму ошибку получает вызывающий через `return p`.
    void p
      .finally(() => {
        if (this.authing === p) this.authing = null;
      })
      .catch(() => {});
    return p;
  }

  /**
   * Приём ончейн-tx сервером с ретраями. В chain-режиме сервер принимает только finalized (M2), а это
   * на ~15-30с позже клиентского "confirmed" — один запрос почти всегда вернул бы pending, и тогда деньги
   * ушли, а зачёта/активации нет (был такой баг с активацией). Повторяем, пока сервер сигналит pending.
   * 24×3с ≈ 72с с запасом перекрывают типичную финализацию. Идемпотентно на стороне сервера.
   */
  private async ingestWithRetry<T extends { ok: boolean; pending?: boolean }>(
    call: () => Promise<T>,
    tries = 24,
    delayMs = 3000,
  ): Promise<T> {
    let res = await call();
    for (let i = 1; i < tries && !res.ok && res.pending; i++) {
      await new Promise((r) => setTimeout(r, delayMs));
      res = await call();
    }
    return res;
  }

  // — Кошелёк (ончейн) —
  async getSession(): Result<Session> {
    return this.api.getSession(); // личность сервер берёт из проверенного токена (ensureAuth)
  }
  async connect(): Result<Session> {
    const w = this.wallet;
    if (!w) throw new DataError("NO_WALLET", "Кошелёк не подключён.");
    if (!w.connected) await w.connect();
    await this.ensureAuth(); // настоящий SIWS: серверный nonce + проверка подписи на бэкенде
    return this.api.getSession();
  }
  async disconnect(): Result<void> {
    try {
      await this.api.disconnect(); // пока токен в теле — сервер его погасит
    } catch {
      /* всё равно чистим локально */
    }
    this.clearAuth();
    this.clearStoredToken();
    await this.wallet?.disconnect?.();
  }

  async createDonation(input: DonationInput): Result<DonationResult> {
    const w = this.wallet;
    if (!w?.publicKey || !w.sendTransaction) throw new DataError("NO_WALLET", "Подключи кошелёк.");
    if (!DEVNET_USDC_MINT || !TREASURY_OWNER) {
      throw new DataError(
        "NOT_CONFIGURED",
        "Не заданы NEXT_PUBLIC_DEVNET_USDC_MINT и NEXT_PUBLIC_TREASURY_OWNER.",
      );
    }
    // Префлайт текста ДО подписи/отправки: деньги ончейн необратимы (§4.2), поэтому запрещёнку
    // (HARD_BLOCK) ловим заранее и НЕ строим транзакцию — кошелёк даже не спросит подпись. Мат разрешён
    // (политика модерации); ingest всё равно проводит модерацию повторно как бэкстоп. Без текста — нечего.
    const text = input.text?.trim() || undefined;
    if (text) {
      const { blocked, reason } = await this.api.precheckText(text, input.channelId);
      if (blocked)
        throw new DataError(
          reason === "blocklist" ? "BLOCKED" : "TEXT_BLOCKED",
          reason === "blocklist"
            ? "Этот кошелёк заблокирован на канале для донатов-с-сообщениями. Задонатить можно без текста."
            : "Сообщение не прошло модерацию (запрещённый/жёсткий контент). Убери его или задонать без текста.",
        );
    }

    // Разрешаем channelId → payoutAddress через оффчейн-бэкенд.
    const list = await this.api.listChannels();
    const card = list.items.find((c) => c.channelId === input.channelId);
    const channel = card ? await this.api.getChannel(card.handle) : null;
    if (!channel) throw new DataError("NO_CHANNEL", "Канал не найден или не активирован.");
    this.assertPayoutAttested(channel); // H1: payout валиден только с подписью владельца — сервер не истина

    const amountMicro = toMicro(input.amountUSDC);
    const { fee, net } = splitAmount(amountMicro);
    const donationId = `d-${this.address()}-${list.items.length}`;
    // Текст приватен и оффчейн; в memo кладём ТОЛЬКО его хэш — сервер потом сверит присланный текст с ним
    // (трастлесс-привязка, см. server/ingest.ts). Без текста m = null.
    const msgRef = text ? await hashContent(text) : null;
    const ix = await buildDonationInstructions(this.connection, {
      donor: w.publicKey,
      payout: new PublicKey(channel.payoutAddress),
      treasury: new PublicKey(TREASURY_OWNER),
      mint: new PublicKey(DEVNET_USDC_MINT),
      amountMicro,
      creatorId: input.channelId,
      donationId,
      msgRef,
    });
    const tx = new Transaction().add(...ix);
    tx.feePayer = w.publicKey;
    const latest = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = latest.blockhash;
    const signature = await w.sendTransaction(tx, this.connection);

    // Сначала ждём, что tx вообще попала в сеть (confirmed — быстро).
    await this.connection.confirmTransaction({ signature, ...latest }, "confirmed");
    // Момент «Готово» показываем только после ФИНАЛИЗАЦИИ (необратимо): сервер принимает донат лишь на
    // finalized, поэтому опрашиваем приём с ретраями, пока tx не финализируется (~15-30с). Только так момент
    // честен — деньги ушли окончательно, отменить (Brave «Cancel») уже нельзя. Текст сервер сверит с memo-
    // хэшем и заведёт сообщение → HELD/модерация. Зачёт репутации к этому моменту уже произошёл.
    const ingest = await this.ingestWithRetry(() => this.api.ingestSignature(signature, text));
    if (!ingest.ok) {
      throw new DataError(
        "DONATION_PENDING",
        ingest.reason ?? "Донат пока не финализирован в сети — обнови страницу чуть позже.",
      );
    }

    const donation: Donation = {
      id: donationId,
      channelId: input.channelId,
      donor: w.publicKey.toBase58(),
      amount: amountMicro,
      feeAmount: fee,
      netToStreamer: net,
      txSignature: signature,
      final: true,
      ts: new Date().toISOString(),
    };
    const donorAddr = w.publicKey.toBase58();
    let standing = await this.api.getStanding(input.channelId, donorAddr);
    if (!standing) {
      const cfg = await this.api.getChannelConfig(input.channelId);
      const { tier, nextTier, progressToNext } = resolveTier(0, cfg.tiers);
      standing = {
        channelId: input.channelId,
        donor: donorAddr,
        points: 0,
        tier,
        nextTier,
        progressToNext,
        totalDonated: 0n,
      };
    }
    return { donation, standing, tierChanged: false };
  }

  // — Оффчейн-слой (читается из бэкенда, кормится индексером) → делегируем ApiDataProvider —
  getProfile(a: Address): Result<LightProfile | null> {
    return this.api.getProfile(a);
  }
  updateProfile(p: Partial<LightProfile>): Result<LightProfile> {
    return this.api.updateProfile(p);
  }
  listChannels(o?: ListOpts): Result<Page<ChannelCard>> {
    return this.api.listChannels(o);
  }
  getChannel(h: string): Result<Channel | null> {
    return this.api.getChannel(h);
  }
  getMyChannel(): Result<Channel | null> {
    return this.api.getMyChannel();
  }
  getManagedChannels(): Result<Channel[]> {
    return this.api.getManagedChannels();
  }
  getOperatorChannels(): Result<Channel[]> {
    return this.api.getOperatorChannels();
  }
  getChannelConfig(id: string): Result<ChannelConfig> {
    return this.api.getChannelConfig(id);
  }
  /**
   * H1: создание канала в chain-режиме сразу закрепляет payout ed25519-подписью кошелька владельца.
   * С этого момента сервер не источник истины по адресу выплат: подпись проверяет клиент каждого донора
   * (assertPayoutAttested) и ingest при зачёте. Кошелёк покажет читаемый текст сообщения (не транзакция).
   */
  async createChannel(i: CreateChannelInput): Result<Channel> {
    const payoutAttestation = await this.signPayoutAttestation(i.payoutAddress);
    return this.api.createChannel({ ...i, payoutAttestation });
  }
  /** H1: дозакрепить payout существующего канала (создан до аттестаций) — подписываем и шлём на сервер. */
  async attestPayout(channelId: string): Result<Channel> {
    const mine = await this.api.getMyChannel();
    if (!mine || mine.id !== channelId)
      throw new DataError("NOT_OWNER", "Подписать адрес выплат может только владелец канала.");
    return this.api.attestPayout(channelId, await this.signPayoutAttestation(mine.payoutAddress));
  }
  private async signPayoutAttestation(payout: string): Promise<string> {
    const w = this.wallet;
    if (!w?.publicKey || !w.signMessage)
      throw new DataError("NO_SIGN", "Кошелёк не умеет подписывать сообщения.");
    const msg = buildPayoutAttestationMessage(w.publicKey.toBase58(), payout);
    return toBase64(await w.signMessage(new TextEncoder().encode(msg)));
  }
  /** Клиентская проверка H1: не собираем денежную tx на payout, не подписанный ключом владельца канала. */
  private assertPayoutAttested(channel: Channel): void {
    if (
      !channel.payoutAttestation ||
      !verifyPayoutAttestation(channel.ownerAddress, channel.payoutAddress, channel.payoutAttestation)
    )
      throw new DataError(
        "PAYOUT_UNATTESTED",
        "Канал не подтвердил адрес выплат подписью владельца — отправка денег заблокирована (защита от подмены адреса).",
      );
  }
  /**
   * Активация канала = ончейн-сбор (~$2 USDC владелец→трежери) + memo `{act}`. Сервер сам достаёт tx
   * из цепочки, сверяет payer === владелец и порог суммы, и переводит канал в ACTIVE (см. ingestActivation).
   * Оффчейн-флип в chain-режиме запрещён (CHAIN_FORBIDDEN), поэтому идём строго через кошелёк.
   */
  async activateChannel(id: string): Result<Channel> {
    const w = this.wallet;
    if (!w?.publicKey || !w.sendTransaction) throw new DataError("NO_WALLET", "Подключи кошелёк.");
    if (!DEVNET_USDC_MINT || !TREASURY_OWNER) {
      throw new DataError(
        "NOT_CONFIGURED",
        "Не заданы NEXT_PUBLIC_DEVNET_USDC_MINT и NEXT_PUBLIC_TREASURY_OWNER.",
      );
    }
    await this.ensureAuth(); // владелец активирует свой канал → нужна проверенная личность для getMyChannel

    const ix = await buildActivationInstructions(this.connection, {
      payer: w.publicKey,
      treasury: new PublicKey(TREASURY_OWNER),
      mint: new PublicKey(DEVNET_USDC_MINT),
      channelId: id,
      feeMicro: ACTIVATION_FEE_MICRO,
    });
    const tx = new Transaction().add(...ix);
    tx.feePayer = w.publicKey;
    const latest = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = latest.blockhash;
    const signature = await w.sendTransaction(tx, this.connection);

    await this.connection.confirmTransaction({ signature, ...latest }, "confirmed");
    // Сервер принимает сбор только на finalized (M2) — повторяем приём, пока tx не финализируется (~15-30с),
    // иначе сбор уплачен, а канал не активирован. Блокирующе: пользователь ждёт на экране активации.
    const res = await this.ingestWithRetry(() => this.api.ingestActivation(signature));
    if (!res.ok)
      throw new DataError("ACTIVATION_FAILED", res.reason ?? "Сбор активации не принят.");

    const channel = await this.api.getMyChannel();
    if (!channel) throw new DataError("NO_CHANNEL", "Канал не найден после активации.");
    return channel;
  }
  updateChannelConfig(id: string, p: ConfigPatch): Result<ChannelConfig> {
    return this.api.updateChannelConfig(id, p);
  }
  getStanding(id: string, d: Address): Result<ViewerStanding | null> {
    return this.api.getStanding(id, d);
  }
  getLeaderboard(id: string, p: LeaderboardPeriod): Result<LeaderboardEntry[]> {
    return this.api.getLeaderboard(id, p);
  }
  getDonorOverview(a: Address): Result<DonorOverview> {
    return this.api.getDonorOverview(a);
  }
  homeFeed(): Result<HomeFeed> {
    return this.api.homeFeed();
  }
  listDonations(id: string, o?: ListOpts): Result<Page<Donation>> {
    return this.api.listDonations(id, o);
  }
  getModerationQueue(id: string): Result<MessageRef[]> {
    return this.api.getModerationQueue(id);
  }
  setMessageState(id: string, s: "SHOWN" | "HIDDEN"): Result<MessageRef> {
    return this.api.setMessageState(id, s);
  }
  hideDonorMessages(channelId: string, donor: string): Result<{ hidden: number }> {
    return this.api.hideDonorMessages(channelId, donor);
  }
  reportMessage(messageId: string, reason?: string): Result<{ reports: number; hidden: boolean }> {
    return this.api.reportMessage(messageId, reason);
  }
  getChannelBlocklist(id: string): Result<ChannelBlock[]> {
    return this.api.getChannelBlocklist(id);
  }
  addChannelBlock(id: string, a: Address, r?: string): Result<ChannelBlock> {
    return this.api.addChannelBlock(id, a, r);
  }
  removeChannelBlock(id: string, a: Address): Result<void> {
    return this.api.removeChannelBlock(id, a);
  }
  getMyChannelBlock(id: string): Result<ChannelBlock | null> {
    return this.api.getMyChannelBlock(id);
  }
  getOperatorQueue(): Result<IncidentLog[]> {
    return this.api.getOperatorQueue();
  }
  applyOperatorAction(a: Omit<OperatorAction, "id" | "ts" | "byOperator">): Result<OperatorAction> {
    return this.api.applyOperatorAction(a);
  }

  // — Мини-игры (game-bus, ADR 0016) —
  // Для escrow-task (ADR 0017): денежные операции реально двигают USDC через ончейн-программу подключённым
  // кошельком (программа сама проверяет, что подписант — нужный актор: донор/стример/получатель), затем
  // обновляем оффчейн-зеркало через `api` (там же — модерация текста и банковка репутации). Спор/голоса в
  // G3a остаются оффчейн (на цепочку их исход пушит резолвер-оператор отдельно). Чтения — из бэкенда.

  /** Собрать tx из инструкций, подписать подключённым кошельком, дождаться confirmed. Вернуть подпись. */
  private async sendTx(ixs: TransactionInstruction[]): Promise<string> {
    const w = this.wallet;
    if (!w?.publicKey || !w.sendTransaction) throw new DataError("NO_WALLET", "Подключи кошелёк.");
    const tx = new Transaction().add(...ixs);
    tx.feePayer = w.publicKey;
    const latest = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = latest.blockhash;
    const sig = await w.sendTransaction(tx, this.connection);
    await this.connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
    return sig;
  }

  /** 32-байтовый seed эскроу задания (из оффчейн-зеркала) для пересборки PDA в последующих операциях. */
  private async escrowTaskIdOf(channelId: string, taskId: unknown): Promise<Uint8Array> {
    const task = (await this.api.gameQuery({
      gameId: "escrow-task",
      channelId,
      op: "get",
      payload: { taskId },
    })) as { escrowTaskId?: string } | null;
    if (!task?.escrowTaskId)
      throw new DataError("NO_ESCROW", "У задания нет ончейн-эскроу (создано не в chain-режиме?).");
    return fromHex(task.escrowTaskId);
  }

  async gameAction(req: GameRequest): Result<unknown> {
    if (req.gameId !== "escrow-task") return this.api.gameAction(req);
    const w = this.wallet;
    if (!w?.publicKey) throw new DataError("NO_WALLET", "Подключи кошелёк.");
    if (!ESCROW_PROGRAM_ID || !DEVNET_USDC_MINT) {
      throw new DataError(
        "NOT_CONFIGURED",
        "Не задан адрес эскроу-программы или USDC-mint (NEXT_PUBLIC_ESCROW_PROGRAM_ID/USDC).",
      );
    }
    const programId = new PublicKey(ESCROW_PROGRAM_ID);
    const mint = new PublicKey(DEVNET_USDC_MINT);
    const p = (req.payload ?? {}) as Record<string, unknown>;

    switch (req.op) {
      case "create": {
        const amountStr = String(p.amount ?? "");
        if (!/^\d+$/.test(amountStr) || BigInt(amountStr) <= 0n)
          throw new DataError("BAD_AMOUNT", "Нужна положительная сумма (micro-USDC).");
        // Рычаги канала ДО подписи/отправки (паритет с серверным create): эскроу необратим — BELOW_MIN/
        // TOO_LONG после fund заморозили бы деньги до таймаута возврата. Сервер проверит ещё раз (истина там).
        const text = typeof p.text === "string" ? p.text.trim() : "";
        const cfg = await this.api.getChannelConfig(req.channelId);
        const minTask =
          cfg.minDonationWithText > cfg.minDonation ? cfg.minDonationWithText : cfg.minDonation;
        if (BigInt(amountStr) < minTask)
          throw new DataError("BELOW_MIN", "Сумма ниже минимума канала для заданий.");
        if (text.length > cfg.messageMaxLen)
          throw new DataError("TOO_LONG", "Текст задания превышает лимит канала.");
        // §10-порог ДО подписи (паритет с серверным create): эскроу необратим — отказ LOW_REP ПОСЛЕ
        // fund заморозил бы деньги донора до таймаута возврата (yellow-paper §18.3-5, закрыто).
        if (cfg.minReputationToTask > 0) {
          const st = await this.api.getStanding(req.channelId, w.publicKey.toBase58());
          if ((st?.points ?? 0) < cfg.minReputationToTask)
            throw new DataError(
              "LOW_REP",
              `Задания на этом канале доступны с ${cfg.minReputationToTask} очков репутации — набери их обычными донатами.`,
            );
        }
        // Модерация ДО подписи/отправки: деньги ончейн необратимы — запрещёнку ловим заранее, иначе
        // эскроу был бы профинансирован под задание, которое оффчейн-create потом отклонит.
        if (text) {
          // kind: "task" → префлайт судит ТОЙ ЖЕ строгой политикой, что серверный create (ADR 0017): деньги
          // ончейн необратимы, поэтому нелегальное задание должно отсекаться ДО фандинга, а не после.
          const { blocked, reason } = await this.api.precheckText(text, req.channelId, "task");
          if (blocked)
            throw new DataError(
              reason === "blocklist" ? "BLOCKED" : "TEXT_BLOCKED",
              reason === "blocklist"
                ? "Кошелёк заблокирован на канале для сообщений."
                : "Текст задания не прошёл модерацию (запрещённый/опасный контент).",
            );
        }
        // channelId → payout-адрес стримера (через оффчейн-бэкенд, как в createDonation).
        const list = await this.api.listChannels();
        const card = list.items.find((c) => c.channelId === req.channelId);
        const channel = card ? await this.api.getChannel(card.handle) : null;
        if (!channel) throw new DataError("NO_CHANNEL", "Канал не найден или не активирован.");
        this.assertPayoutAttested(channel); // H1: эскроу-fund — тоже деньги на payout, та же проверка
        const rawMs = typeof p.executionMs === "number" ? p.executionMs : 24 * 3600 * 1000;
        // Клампим окно сдачи к executionMin (тот же пол, что и machine.createTask; executionMin > grace, ESC-17)
        // — иначе fund ревертит на ончейн require, а офчейн-дедлайн разошёлся бы с ончейн done_deadline. То же
        // значение уходит в офчейн-create → ончейн и зеркало согласованы.
        const executionMs = Math.max(rawMs, WINDOWS.executionMin);
        // CR-4: task_id = SHA-256(nonce ‖ text) — ончейн-seed эскроу СТАНОВИТСЯ коммитментом к тексту задания
        // (как memo.m у донатов). Оператор не сможет ни подменить, ни скрыть незаметно текст, который судит
        // жюри: любой пересчитает коммитмент по (text, nonce) и сверит с ончейн-адресом. nonce хранится офчейн.
        const textNonce = toHex(randomTaskId()).slice(0, 32); // 16 байт соли (гасит брутфорс низкоэнтропийных)
        const taskIdHex = await taskTextCommitment(text, textNonce);
        const taskId = fromHex(taskIdHex);
        const ix = await buildFundIx({
          programId,
          donor: w.publicKey,
          streamer: new PublicKey(channel.payoutAddress),
          mint,
          taskId,
          amount: BigInt(amountStr),
          executionWindow: BigInt(Math.floor(executionMs / 1000)),
        });
        const fundTx = await this.sendTx([ix]);
        return this.api.gameAction({
          ...req,
          payload: { ...p, executionMs, escrowTaskId: taskIdHex, fundTx, textNonce },
        });
      }

      // «Принять» (accept) теперь ХОДИТ на цепочку (ESC-19): без ончейн-accept нельзя mark_done/claim, а по
      // accept-tx индексер раскрывает текст. Стример платит газ; текст публикуется — это и есть шов.
      case "accept":
      case "reject":
      case "markDone":
      case "cancel": {
        const taskId = await this.escrowTaskIdOf(req.channelId, p.taskId);
        const ix =
          req.op === "accept"
            ? buildAcceptIx(programId, w.publicKey, taskId)
            : req.op === "reject"
              ? buildRejectIx(programId, w.publicKey, taskId)
              : req.op === "markDone"
                ? buildMarkDoneIx(programId, w.publicKey, taskId)
                : buildCancelIx(programId, w.publicKey, taskId);
        await this.sendTx([ix]);
        return this.api.gameAction(req);
      }

      case "claim": {
        const taskId = await this.escrowTaskIdOf(req.channelId, p.taskId);
        const escrow = escrowPda(programId, taskId);
        const info = await this.connection.getAccountInfo(escrow);
        if (info) {
          const me = w.publicKey; // сужение из гварда не доживает до замыканий — фиксируем в const
          const acc = decodeEscrow(info.data);
          const claimStreamerIxs = () =>
            buildClaimStreamerIxs(this.connection, {
              programId,
              streamer: me,
              donor: acc.donor,
              treasury: acc.treasury,
              mint,
              taskId,
            });
          const claimDonorIxs = () =>
            buildClaimDonorIxs(this.connection, { programId, donor: me, mint, taskId });

          if (acc.resolution === 1) {
            await this.sendTx(await claimStreamerIxs()); // ToStreamer (уже разрешено)
          } else if (acc.resolution === 2) {
            await this.sendTx(await claimDonorIxs()); // ToDonor (уже разрешено)
          } else {
            // Unresolved → авторазрешение по таймауту + claim ОДНОЙ транзакцией (одно подтверждение/газ
            // вместо двух). Сторону предсказываем по on-chain состоянию (то же выставит resolve_timeout):
            // Done → стримеру; Pending/Accepted-просрочка → донору. Не дозрело / открыт спор → программа
            // откатит всю tx (claim откроется после окна или резолва спора оператором).
            const claimIxs = acc.state === 2 ? await claimStreamerIxs() : await claimDonorIxs();
            await this.sendTx([buildResolveTimeoutIx(programId, me, taskId), ...claimIxs]);
          }
        }
        // Оффчейн-settle забанкует репутацию (DONATION при to_streamer; возврат очков не даёт) — мозг оффчейн.
        return this.api.gameAction(req);
      }

      // Ончейн-действия резолвера (оператора) по спору. Подписывает подключённый кошелёк = резолвер
      // (программа сама проверяет signer == escrow.resolver). Оффчейн спор/тальи/репутация идут своим
      // чередом (raiseDispute/vote → api; settler банкует) — здесь только синхронизируем ДЕНЬГИ на цепочке.
      case "markDisputed": {
        // Поднят оффчейн-спор → метим эскроу спорным, чтобы resolve_timeout не опередил голосование.
        const taskId = await this.escrowTaskIdOf(req.channelId, p.taskId);
        await this.sendTx([buildMarkDisputedIx(programId, w.publicKey, taskId)]);
        return { ok: true };
      }

      case "resolveDispute": {
        // Голосование закрылось → фиксируем вердикт на цепочке (toStreamer считает UI из тальи).
        const taskId = await this.escrowTaskIdOf(req.channelId, p.taskId);
        await this.sendTx([
          buildResolveDisputeIx(programId, w.publicKey, taskId, Boolean(p.toStreamer)),
        ]);
        return { ok: true };
      }

      default:
        // raiseDispute, vote и прочее — оффчейн (off-chain спор; на цепочку его двигает резолвер выше).
        return this.api.gameAction(req);
    }
  }

  gameQuery(req: GameRequest): Result<unknown> {
    return this.api.gameQuery(req);
  }
}
