import { decode, encode } from "./codec";
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

interface RpcResponse<T> {
  ok: boolean;
  result?: T;
  error?: { code: string; message: string };
}

/**
 * Фаза 2: реализация DataProvider поверх HTTP (RPC-мост /api/v1/rpc). Экраны не знают, что под ними
 * теперь сервер. Личность и MOCK_FAIL мирроятся локально и шлются с каждым запросом → dev-тулбар
 * работает и под `api`. Оверлей-подписка — заглушка (SSE — дальнейший шаг).
 */
export class ApiDataProvider implements DataProvider {
  private address: Address | null = null; // DEV-личность (mock/api без кошелька); в проде сервер игнорит
  private token: string | null = null; // session-токен после проверки SIWS-подписи — реальная личность
  private failMode = false;

  private async rpc<T>(method: string, args: unknown[]): Promise<T> {
    let res: Response;
    try {
      res = await fetch("/api/v1/rpc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: encode({ method, args, token: this.token, address: this.address, failMode: this.failMode }),
      });
    } catch {
      throw new DataError("NETWORK", "Сеть недоступна или сервер не отвечает.");
    }
    const text = await res.text();
    let payload: RpcResponse<T>;
    try {
      payload = decode<RpcResponse<T>>(text);
    } catch {
      // не-JSON (framework-500 → HTML, прокси-ошибка и т.п.)
      throw new DataError("BAD_RESPONSE", `Сервер вернул неожиданный ответ (HTTP ${res.status}).`);
    }
    if (!payload.ok) {
      throw new DataError(payload.error?.code ?? "RPC_ERROR", payload.error?.message ?? "Ошибка API");
    }
    return payload.result as T;
  }

  // — Сессия / идентичность —
  getSession(): Result<Session> {
    return this.rpc("getSession", []);
  }
  connect(): Result<Session> {
    // Адрес задаётся снаружи (кошелёк/dev) через __setAddress; connect возвращает сессию по нему.
    return this.rpc("connect", []);
  }
  disconnect(): Result<void> {
    const p = this.rpc<void>("disconnect", []); // пока токен ещё в теле — сервер его погасит
    this.address = null;
    this.token = null;
    return p;
  }
  /** Приём ончейн-доната по подписи (сервер валидирует из цепочки). Вне DataProvider — для chain. */
  ingestSignature(
    signature: string,
    text?: string,
  ): Promise<{ ok: boolean; pending?: boolean; reason?: string; points?: number }> {
    return this.rpc("ingestSignature", [signature, text]);
  }
  /** Приём ончейн-сбора активации по подписи (сервер валидирует из цепочки). Вне DataProvider — для chain. */
  ingestActivation(signature: string): Promise<{ ok: boolean; pending?: boolean; reason?: string }> {
    return this.rpc("ingestActivation", [signature]);
  }
  /** Префлайт текста доната ДО отправки: blocked=true при HARD_BLOCK (запрещёнка). Вне DataProvider. */
  precheckText(text: string): Promise<{ blocked: boolean }> {
    return this.rpc("precheckText", [text]);
  }
  /** SIWS шаг 1: получить nonce + каноническое сообщение для подписи. Вне DataProvider — для chain. */
  authNonce(address: Address): Promise<{ nonce: string; message: string }> {
    return this.rpc("__authNonce", [address]);
  }
  /** SIWS шаг 3: отдать подпись, получить session-токен. Вне DataProvider — для chain. */
  authVerify(address: Address, signatureB64: string): Promise<{ token: string; exp: number }> {
    return this.rpc("__authVerify", [address, signatureB64]);
  }
  getProfile(address: Address): Result<LightProfile | null> {
    return this.rpc("getProfile", [address]);
  }
  updateProfile(patch: Partial<LightProfile>): Result<LightProfile> {
    return this.rpc("updateProfile", [patch]);
  }

  // — Дискавери / каналы —
  listChannels(opts?: ListOpts): Result<Page<ChannelCard>> {
    return this.rpc("listChannels", [opts]);
  }
  getChannel(handle: string): Result<Channel | null> {
    return this.rpc("getChannel", [handle]);
  }
  getMyChannel(): Result<Channel | null> {
    return this.rpc("getMyChannel", []);
  }
  getManagedChannels(): Result<Channel[]> {
    return this.rpc("getManagedChannels", []);
  }
  getOperatorChannels(): Result<Channel[]> {
    return this.rpc("getOperatorChannels", []);
  }
  getChannelConfig(channelId: string): Result<ChannelConfig> {
    return this.rpc("getChannelConfig", [channelId]);
  }
  createChannel(input: CreateChannelInput): Result<Channel> {
    return this.rpc("createChannel", [input]);
  }
  activateChannel(channelId: string): Result<Channel> {
    return this.rpc("activateChannel", [channelId]);
  }
  updateChannelConfig(channelId: string, patch: ConfigPatch): Result<ChannelConfig> {
    return this.rpc("updateChannelConfig", [channelId, patch]);
  }

  // — Репутация / статус —
  getStanding(channelId: string, donor: Address): Result<ViewerStanding | null> {
    return this.rpc("getStanding", [channelId, donor]);
  }
  getLeaderboard(channelId: string, period: LeaderboardPeriod): Result<LeaderboardEntry[]> {
    return this.rpc("getLeaderboard", [channelId, period]);
  }

  // — Донаты —
  createDonation(input: DonationInput): Result<DonationResult> {
    return this.rpc("createDonation", [input]);
  }
  listDonations(channelId: string, opts?: ListOpts): Result<Page<Donation>> {
    return this.rpc("listDonations", [channelId, opts]);
  }

  // — Модерация —
  getModerationQueue(channelId: string): Result<MessageRef[]> {
    return this.rpc("getModerationQueue", [channelId]);
  }
  setMessageState(messageId: string, state: "SHOWN" | "HIDDEN"): Result<MessageRef> {
    return this.rpc("setMessageState", [messageId, state]);
  }
  hideDonorMessages(channelId: string, donor: Address): Result<{ hidden: number }> {
    return this.rpc("hideDonorMessages", [channelId, donor]);
  }
  reportMessage(messageId: string, reason?: string): Result<{ reports: number; hidden: boolean }> {
    return this.rpc("reportMessage", [messageId, reason]);
  }

  // — Канальный блок-лист —
  getChannelBlocklist(channelId: string): Result<ChannelBlock[]> {
    return this.rpc("getChannelBlocklist", [channelId]);
  }
  addChannelBlock(channelId: string, address: Address, reason?: string): Result<ChannelBlock> {
    return this.rpc("addChannelBlock", [channelId, address, reason]);
  }
  removeChannelBlock(channelId: string, address: Address): Result<void> {
    return this.rpc("removeChannelBlock", [channelId, address]);
  }

  // — Оператор / T&S —
  getOperatorQueue(): Result<IncidentLog[]> {
    return this.rpc("getOperatorQueue", []);
  }
  applyOperatorAction(
    action: Omit<OperatorAction, "id" | "ts" | "byOperator">,
  ): Result<OperatorAction> {
    return this.rpc("applyOperatorAction", [action]);
  }
  getIncidentLog(opts?: ListOpts): Result<Page<IncidentLog>> {
    return this.rpc("getIncidentLog", [opts]);
  }

  // — Оверлей — живой поток через SSE (GET /api/v1/overlay/[channelId]).
  subscribeOverlay(channelId: string, cb: (e: OverlayEvent) => void): () => void {
    if (typeof window === "undefined" || typeof EventSource === "undefined") return () => {};
    const es = new EventSource(`/api/v1/overlay/${encodeURIComponent(channelId)}`);
    es.onmessage = (ev) => {
      try {
        cb(decode<OverlayEvent>(ev.data));
      } catch {
        // игнор битых кадров
      }
    };
    es.onerror = () => {
      // Транзиентный обрыв: EventSource переподключается сам. Явный хук — чтобы ошибка не всплывала.
    };
    return () => es.close();
  }

  // — Адрес сессии (кошелёк/dev) + dev-контролы; шлются с каждым запросом —
  __setAddress(address: Address | null) {
    this.address = address;
  }
  __getAddress(): Address | null {
    return this.address;
  }
  /** Проверенный session-токен (выставляет chain-слой после SIWS). */
  __setToken(token: string | null) {
    this.token = token;
  }
  __getToken(): string | null {
    return this.token;
  }
  __setFailMode(on: boolean) {
    this.failMode = on;
  }
  __getFailMode(): boolean {
    return this.failMode;
  }
  __setLatencyScale(_scale: number) {
    // латентность задаётся сервером; на клиенте no-op
  }
  __reset() {
    this.address = null;
    this.token = null;
    this.failMode = false;
    void this.rpc("__reset", []);
  }
}
