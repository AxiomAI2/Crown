import type { WalletContextState } from "@solana/wallet-adapter-react";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { ACTIVATION_FEE_MICRO, DEVNET_RPC, DEVNET_USDC_MINT, TREASURY_OWNER } from "../chain/config";
import {
  buildActivationInstructions,
  buildDonationInstructions,
  splitAmount,
} from "../chain/donation-tx";
import { toMicro } from "../utils";
import { ApiDataProvider } from "./api-provider";
import { hashContent } from "./moderation";
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
  IncidentLog,
  LeaderboardEntry,
  LeaderboardPeriod,
  LightProfile,
  ListOpts,
  MessageRef,
  OperatorAction,
  OverlayEvent,
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
const SIWS_STORAGE_KEY = "standing.siws.v1";

/** Uint8Array → base64 без Buffer (браузер). Подпись 64 байта — простая реализация достаточна. */
function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export class ChainDataProvider implements DataProvider {
  private api = new ApiDataProvider();
  private connection = new Connection(DEVNET_RPC, "confirmed");
  private wallet: WalletContextState | null = null;
  private authedAddress: string | null = null; // адрес, по которому уже есть проверенный токен
  private authing: Promise<boolean> | null = null;

  constructor() {
    // Сессия живёт по СОХРАНЁННОМУ токену, а не по живому подключению кошелька. На старте применяем валидный
    // токен из localStorage сразу → сессия переживает refresh, даже если кошелёк не переподключился
    // автоматически (напр. Brave не делает autoConnect). Живой кошелёк нужен лишь для ПОДПИСИ транзакций.
    this.restoreStoredToken();
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
  /** Применить валидный токен из localStorage без знания адреса (старт) — сессия по токену переживает refresh. */
  private restoreStoredToken() {
    if (typeof localStorage === "undefined") return;
    try {
      const o = JSON.parse(localStorage.getItem(SIWS_STORAGE_KEY) ?? "null") as {
        address: string;
        token: string;
        exp: number;
      } | null;
      if (o?.token && o.address && o.exp > Date.now()) {
        this.api.__setToken(o.token);
        this.authedAddress = o.address;
      }
    } catch {
      /* битый/пустой стор */
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
      const { blocked } = await this.api.precheckText(text);
      if (blocked)
        throw new DataError(
          "TEXT_BLOCKED",
          "Сообщение не прошло модерацию (запрещённый/жёсткий контент). Убери его или задонать без текста.",
        );
    }

    // Разрешаем channelId → payoutAddress через оффчейн-бэкенд.
    const list = await this.api.listChannels();
    const card = list.items.find((c) => c.channelId === input.channelId);
    const channel = card ? await this.api.getChannel(card.handle) : null;
    if (!channel) throw new DataError("NO_CHANNEL", "Канал не найден или не активирован.");

    const amountMicro = toMicro(input.amountUSDC);
    const { fee, net } = splitAmount(amountMicro);
    const donationId = `d-${this.address()}-${list.items.length}`;
    // Текст приватен и оффчейн; в memo кладём ТОЛЬКО его хэш — сервер потом сверит присланный текст с ним
    // (трастлесс-привязка, см. server/ingest.ts). Без текста m = null.
    const ix = await buildDonationInstructions(this.connection, {
      donor: w.publicKey,
      payout: new PublicKey(channel.payoutAddress),
      treasury: new PublicKey(TREASURY_OWNER),
      mint: new PublicKey(DEVNET_USDC_MINT),
      amountMicro,
      creatorId: input.channelId,
      donationId,
      msgRef: text ? hashContent(text) : null,
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
      standing = {
        channelId: input.channelId,
        donor: donorAddr,
        points: 0,
        tier: cfg.tiers[0]!,
        progressToNext: 0,
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
  createChannel(i: CreateChannelInput): Result<Channel> {
    return this.api.createChannel(i);
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
    if (!res.ok) throw new DataError("ACTIVATION_FAILED", res.reason ?? "Сбор активации не принят.");

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
  getOperatorQueue(): Result<IncidentLog[]> {
    return this.api.getOperatorQueue();
  }
  applyOperatorAction(a: Omit<OperatorAction, "id" | "ts" | "byOperator">): Result<OperatorAction> {
    return this.api.applyOperatorAction(a);
  }
  getIncidentLog(o?: ListOpts): Result<Page<IncidentLog>> {
    return this.api.getIncidentLog(o);
  }
  subscribeOverlay(id: string, cb: (e: OverlayEvent) => void): () => void {
    return this.api.subscribeOverlay(id, cb);
  }
}
