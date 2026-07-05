/**
 * IcpDataProvider — режим `icp` (M1+M2 миграции, ADR 0021): канистра ICP = КАНОН репутации и споров.
 *
 * Гибрид поверх ChainDataProvider. В канистру идут:
 *  - чтения репутации: `getStanding`, `getLeaderboard`, цифры и журнал `getDonorOverview`
 *    (HTTP-экспорт core-канистры; браузер читает канон МИМО нашего сервера — в этом смысл фазы);
 *  - споры по chain-задачам (M2): открытие/голос — подписи кошелька в арбитр (`gameAction`),
 *    состояние спора ВЛИВАЕТСЯ в чтения задач (`gameQuery`/`homeFeed`) — серверное зеркало
 *    спор не видит, канон статуса/голосов/вердикта — арбитр;
 *  - governance-параметры споров канала (M1): чтение/запись подписью владельца.
 * Всё остальное — как в chain: кошелёк, донаты, эскроу-деньги, тексты/модерация/профили — сервер.
 *
 * Косметика остаётся кожей: имена доноров на лидерборде подтягиваются с сервера и присоединяются
 * к каноничным цифрам; сервер недоступен → цифры без имён (деньги/репутация не зависят от кожи).
 *
 * Дельта канона на переходе (yellow-paper §18.5-8a): канистра знает только ончейн-события;
 * каналы mock-эпохи (без ончейн-активации) остаются с серверными цифрами и событиями.
 *
 * Откат (migration-plan §3): NEXT_PUBLIC_DATA_SOURCE=chain — фронт снова читает сервер.
 */
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { ESCROW_PROGRAM_ID, ICP_CANISTER_URL } from "@/lib/chain/addresses";
import {
  buildDisputeParamsMessage,
  normalizeDisputeParams,
  type DisputeParamsInfo,
  type DisputeParamsValues,
  type RawDisputeParamsResponse,
} from "@/lib/chain/dispute-params";
import {
  buildOpenDisputeMessage,
  buildVoteMessage,
  normalizeCanisterDispute,
  type CanisterDisputeView,
} from "@/lib/chain/dispute-vote";
import { escrowPda } from "@/lib/chain/escrow-tx";
import { resolveTier } from "@/lib/reputation";
import { disputeVotesView } from "@/games/escrow-task/machine";
import type { DisputeVotesResult, EscrowTask, TaskDispute } from "@/games/escrow-task/types";
import { ChainDataProvider } from "./chain-provider";
import { DataError, type Result } from "./provider";
import type {
  Address,
  DonorOverview,
  DonorPointEvent,
  GameRequest,
  HomeFeed,
  LeaderboardEntry,
  LeaderboardPeriod,
  ViewerStanding,
} from "./types";

/** Агрегат донора из HTTP-экспорта канистры (`/standing`, `/leaderboard`). Деньги — строками. */
interface CanisterAgg {
  address: string;
  pointsMicro: string;
  totalDonatedMicro: string;
  donations: number;
  firstBlockTime: number | null;
}

const MICRO_PER_POINT = 1_000_000;
/** «Месяц» лидерборда = скользящие 30 дней — та же семантика, что у сервера (mock-provider). */
const MONTH_MS = 30 * 86_400_000;

/** Запись журнала донора из `/donor` канистры (детализация для «Журнала репутации» профиля). */
interface CanisterDonorEvent {
  seq: number;
  channelId: string;
  kind: "DONATION" | "GAME_DONATION" | "DISPUTE_WON" | "DISPUTE_LOST";
  pointsDeltaMicro: string; // знаковая (DISPUTE_LOST < 0)
  amountMicro: string;
  blockTime: number | null;
  signature: string; // tx-подпись для денежных записей; псевдо `dispute:…` у спор-эффектов
}

/** Спор канистры → оффчейн-форма TaskDispute (micro → очки на границе UI). null — спора нет. */
function canisterDisputeAsTask(cd: CanisterDisputeView): TaskDispute | null {
  if (cd.openedAtMs == null) return null;
  return {
    by: cd.openedBy ?? "",
    openedAt: new Date(cd.openedAtMs).toISOString(),
    votingEndsAt: new Date(cd.votingEndsAtMs ?? cd.openedAtMs).toISOString(),
    quorum: Number(cd.quorumMicro) / MICRO_PER_POINT,
    votes: cd.votes.map((v) => ({
      voter: v.voter,
      choice: v.choice,
      weight: Number(v.weightMicro) / MICRO_PER_POINT,
      at: new Date(v.atMs).toISOString(),
    })),
  };
}

/**
 * Влить спор канистры в задачу серверного зеркала: статус/голоса спора — канон арбитра.
 * RESOLVED сервера не понижаем (индексер уже увидел ончейн-исход — спор при нём история);
 * иначе задача с идущим/вынесенным спором показывается как DISPUTED, а не «DONE» зеркала.
 */
function mergeCanisterDispute(
  task: EscrowTask,
  cases: Map<string, CanisterDisputeView>,
): EscrowTask {
  const cd = task.escrowTaskId ? cases.get(task.escrowTaskId) : undefined;
  const dispute = cd ? canisterDisputeAsTask(cd) : null;
  if (!dispute) return task;
  return task.status === "RESOLVED" ? { ...task, dispute } : { ...task, status: "DISPUTED", dispute };
}

export class IcpDataProvider extends ChainDataProvider {
  private async canisterGet<T>(path: string): Promise<T> {
    if (!ICP_CANISTER_URL) {
      throw new DataError(
        "NOT_CONFIGURED",
        "Режим icp требует NEXT_PUBLIC_ICP_CANISTER_URL (runbook «Канистры ICP»).",
      );
    }
    let res: Response;
    try {
      res = await fetch(`${ICP_CANISTER_URL}${path}`);
    } catch {
      throw new DataError(
        "NETWORK",
        "Канистра недоступна — поднят ли локальный стенд? (runbook «Канистры ICP»)",
      );
    }
    if (!res.ok) throw new DataError("BAD_RESPONSE", `Канистра ответила HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  override getStanding(channelId: string, donor: Address): Result<ViewerStanding | null> {
    return (async () => {
      const [{ standing }, config] = await Promise.all([
        this.canisterGet<{ standing: CanisterAgg }>(
          `/standing?channel=${encodeURIComponent(channelId)}&address=${encodeURIComponent(donor)}`,
        ),
        this.getChannelConfig(channelId), // тиры — конфиг канала (кожа), сама шкала очков — канон
      ]);
      if (standing.donations === 0) return null; // как у сервера: нет истории → нет стендинга
      const points = Number(standing.pointsMicro) / MICRO_PER_POINT;
      const { tier, nextTier, progressToNext } = resolveTier(points, config.tiers);
      return {
        channelId,
        donor,
        points,
        tier,
        nextTier,
        progressToNext,
        totalDonated: BigInt(standing.totalDonatedMicro),
        firstDonationAt:
          standing.firstBlockTime != null
            ? new Date(standing.firstBlockTime * 1000).toISOString()
            : undefined,
      };
    })();
  }

  override getLeaderboard(
    channelId: string,
    period: LeaderboardPeriod,
  ): Result<LeaderboardEntry[]> {
    return (async () => {
      const since = period === "month" ? Math.floor((Date.now() - MONTH_MS) / 1000) : undefined;
      const [board, config, skin] = await Promise.all([
        this.canisterGet<{ rows: CanisterAgg[] }>(
          `/leaderboard?channel=${encodeURIComponent(channelId)}&limit=100` +
            (since !== undefined ? `&since=${since}` : ""),
        ),
        this.getChannelConfig(channelId),
        // Имена — косметика с сервера; его недоступность НЕ роняет канон (цифры покажем без имён).
        super.getLeaderboard(channelId, period).catch(() => [] as LeaderboardEntry[]),
      ]);
      const displayNames = new Map(skin.map((e) => [e.donor, e.displayName]));
      return board.rows.map((r, i) => {
        const points = Number(r.pointsMicro) / MICRO_PER_POINT;
        return {
          rank: i + 1,
          donor: r.address,
          displayName: displayNames.get(r.address),
          points,
          tier: resolveTier(points, config.tiers).tier,
          totalDonated: BigInt(r.totalDonatedMicro),
        };
      });
    })();
  }

  /**
   * Профиль донора (/me, /u): цифры репутации/денег по каналам — КАНОН из канистры
   * (`/donor?address=`), кожа (имена каналов, handle, тексты активности) — с сервера.
   * Каналы, которых канистра не знает (mock-эпоха, без ончейн-активации), остаются с
   * серверными цифрами — честная переходная дельта (yellow-paper §18.5-8a).
   */
  override getDonorOverview(address: Address): Result<DonorOverview> {
    return (async () => {
      const [base, canon] = await Promise.all([
        super.getDonorOverview(address),
        this.canisterGet<{
          rows: (CanisterAgg & { channelId: string; lastBlockTime: number | null })[];
          events?: CanisterDonorEvent[];
        }>(`/donor?address=${encodeURIComponent(address)}`),
      ]);
      const byChannel = new Map(canon.rows.map((r) => [r.channelId, r]));

      const iso = (bt: number | null | undefined) =>
        bt != null ? new Date(bt * 1000).toISOString() : undefined;
      const standings = await Promise.all(
        base.standings.map(async (row) => {
          const c = byChannel.get(row.channelId);
          if (!c) return row; // канистра канал не знает — серверная строка как есть
          const points = Number(c.pointsMicro) / MICRO_PER_POINT;
          // Тир — по действующей лестнице канала; конфиг недоступен → без тира (честно).
          const tier = await this.getChannelConfig(row.channelId)
            .then((cfg) => resolveTier(points, cfg.tiers).tier)
            .catch(() => undefined);
          return {
            ...row,
            points,
            tier,
            totalDonated: BigInt(c.totalDonatedMicro),
            donationCount: c.donations,
            firstDonationAt: iso(c.firstBlockTime) ?? row.firstDonationAt,
            lastDonationAt: iso(c.lastBlockTime) ?? row.lastDonationAt,
          };
        }),
      );
      standings.sort((a, b) => (a.totalDonated < b.totalDonated ? 1 : -1));

      const topStanding = standings.reduce(
        (best, row) => (best === undefined || row.points > best.points ? row : best),
        undefined as (typeof standings)[number] | undefined,
      );
      const firstDonationAt = standings
        .map((r) => r.firstDonationAt)
        .filter((v): v is string => !!v)
        .sort()[0];

      // «Журнал репутации»: для каналов, которые канистра знает, — детализация из ЕЁ журнала
      // (включая спор-эффекты DISPUTE_WON/LOST и выплаты заданий GAME_DONATION) — иначе число
      // сверху (канон) не сходится с перечнем событий под ним. Кожа (текст доната) присоединяется
      // из серверного события по tx-подписи; каналы mock-эпохи остаются с серверными событиями.
      const skinBySig = new Map(
        base.pointEvents.filter((e) => e.txSignature).map((e) => [e.txSignature!, e]),
      );
      const canonEvents: DonorPointEvent[] = (canon.events ?? []).map((e) => {
        const skin = skinBySig.get(e.signature);
        const isTx = !e.signature.startsWith("dispute:"); // псевдо-подпись спор-эффекта — не ссылка
        return {
          id: `icp:${e.seq}`,
          channelId: e.channelId,
          type: e.kind,
          pointsDelta: Number(e.pointsDeltaMicro) / MICRO_PER_POINT,
          amount: BigInt(e.amountMicro),
          ts:
            e.blockTime != null
              ? new Date(e.blockTime * 1000).toISOString()
              : (skin?.ts ?? new Date(0).toISOString()),
          txSignature: isTx ? e.signature : undefined,
          message: skin?.message,
        };
      });
      // Канистра без `events` (код до M2-детализации, ещё не передеплоена) → серверный журнал
      // как был: хуже канона, но не пустота.
      const pointEvents = canon.events
        ? [...canonEvents, ...base.pointEvents.filter((e) => !byChannel.has(e.channelId))].sort(
            (a, b) => (a.ts < b.ts ? 1 : -1),
          )
        : base.pointEvents;

      return {
        ...base,
        standings,
        topStanding,
        totalDonated: standings.reduce((sum, r) => sum + r.totalDonated, 0n),
        donationCount: standings.reduce((sum, r) => sum + r.donationCount, 0),
        channelsSupported: standings.filter((r) => r.donationCount > 0).length,
        firstDonationAt: firstDonationAt ?? base.firstDonationAt,
        pointEvents,
      };
    })();
  }

  // ─────────── governance-параметры споров (M1): канон — канистра ───────────

  getDisputeParams(channelId: string): Result<DisputeParamsInfo> {
    return (async () => {
      const raw = await this.canisterGet<RawDisputeParamsResponse>(
        `/dispute-params?channel=${encodeURIComponent(channelId)}`,
      );
      return normalizeDisputeParams(raw);
    })();
  }

  /**
   * Запись параметров: канон-сообщение → подпись кошельком (ed25519, без газа) → POST в канистру.
   * Право на запись проверяет КАНИСТРА (владелец = плательщик активации из цепочки, версия-нонс,
   * таймлок §8.9) — здесь только ранние понятные отказы до похода за подписью.
   */
  setDisputeParams(channelId: string, params: DisputeParamsValues): Result<DisputeParamsInfo> {
    return (async () => {
      const w = this.wallet;
      if (!w?.publicKey || !w.signMessage)
        throw new DataError("NO_SIGN", "Кошелёк не умеет подписывать сообщения.");
      const me = w.publicKey.toBase58();

      const info = await this.getDisputeParams(channelId);
      if (!info.owner)
        throw new DataError(
          "NOT_OWNER",
          "Канал не активирован ончейн — канистра не знает владельца (правила менять нельзя).",
        );
      if (info.owner !== me)
        throw new DataError(
          "NOT_OWNER",
          `Правила меняет только владелец канала (плательщик активации ${info.owner.slice(0, 8)}…) — подключён другой кошелёк.`,
        );

      const version = info.version + 1;
      const message = buildDisputeParamsMessage(channelId, me, version, params);
      const signature = bs58.encode(await w.signMessage(new TextEncoder().encode(message)));

      let res: Response;
      try {
        res = await fetch(`${ICP_CANISTER_URL}/dispute-params`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channelId,
            owner: me,
            version,
            params: {
              minReputationToDisputeMicro: params.minReputationToDisputeMicro.toString(),
              minWeightToVoteMicro: params.minWeightToVoteMicro.toString(),
              quorumMicro: params.quorumMicro.toString(),
              disputeWindowSecs: params.disputeWindowSecs,
              votingWindowSecs: params.votingWindowSecs,
              dMaxMicro: params.dMaxMicro.toString(),
            },
            signature,
          }),
        });
      } catch {
        throw new DataError(
          "NETWORK",
          "Канистра недоступна — поднят ли локальный стенд? (runbook «Канистры ICP»)",
        );
      }
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !body.ok)
        throw new DataError(
          "BAD_RESPONSE",
          `Канистра отвергла запись: ${body.error ?? `HTTP ${res.status}`}`,
        );
      return this.getDisputeParams(channelId);
    })();
  }

  // ─────────── споры по chain-задачам (M2): канон — арбитр канистры ───────────

  /** Кэш `/disputes?channel=` (ключ карты — hex escrowTaskId): один поход на пачку чтений задач. */
  private disputesCache = new Map<string, { at: number; map: Map<string, CanisterDisputeView> }>();
  private static readonly DISPUTES_TTL_MS = 10_000;

  /**
   * Все споры канала из канистры. Недоступность канистры деградирует до пустой карты (и тоже
   * кэшируется на TTL — не долбим упавший шлюз): задачи покажутся по серверному зеркалу, канон
   * спора подтянется следующими запросами. Точечный `getCanisterDispute` ошибку НЕ прячет.
   */
  private async channelDisputes(channelId: string): Promise<Map<string, CanisterDisputeView>> {
    const hit = this.disputesCache.get(channelId);
    if (hit && Date.now() - hit.at < IcpDataProvider.DISPUTES_TTL_MS) return hit.map;
    const map = new Map<string, CanisterDisputeView>();
    try {
      const res = await this.canisterGet<{
        disputes: Parameters<typeof normalizeCanisterDispute>[0][];
      }>(`/disputes?channel=${encodeURIComponent(channelId)}`);
      for (const raw of res.disputes) {
        const cd = normalizeCanisterDispute(raw);
        if (cd.escrowTaskId) map.set(cd.escrowTaskId, cd);
      }
    } catch {
      /* пустая карта ниже */
    }
    this.disputesCache.set(channelId, { at: Date.now(), map });
    return map;
  }

  /**
   * Чтения задач: зеркало сервера (деньги/тексты/модерация) + СПОР из канистры (канон арбитра).
   * Открытие/голос уходят в канистру мимо сервера (gameAction ниже), поэтому без слияния лента,
   * студия, страница спора и дашборд показывали бы задачу как «DONE» без спора — а карточка
   * даже предлагала бы «Забрать» во время живого голосования.
   */
  override gameQuery(req: GameRequest): Result<unknown> {
    return (async () => {
      if (req.gameId !== "escrow-task") return super.gameQuery(req);
      if (req.op === "list") {
        const [base, cases] = await Promise.all([
          super.gameQuery(req) as Promise<{ tasks: EscrowTask[] } | null>,
          this.channelDisputes(req.channelId),
        ]);
        if (!base?.tasks?.length || !cases.size) return base;
        return { ...base, tasks: base.tasks.map((t) => mergeCanisterDispute(t, cases)) };
      }
      if (req.op === "get") {
        const [task, cases] = await Promise.all([
          super.gameQuery(req) as Promise<EscrowTask | null>,
          this.channelDisputes(req.channelId),
        ]);
        return task ? mergeCanisterDispute(task, cases) : task;
      }
      if (req.op === "disputeVotes") {
        // Сервер знает только оффчейн-споры (задачи mock/api-эпохи); спор канистры собираем
        // в тот же постраничный вид той же чистой функцией (machine.disputeVotesView).
        const base = (await super.gameQuery(req)) as DisputeVotesResult | null;
        if (base?.found) return base;
        const taskId = (req.payload as { taskId?: string } | null)?.taskId;
        if (!taskId) return base;
        const task = (await super.gameQuery({
          gameId: req.gameId,
          channelId: req.channelId,
          op: "get",
          payload: { taskId },
        })) as EscrowTask | null;
        if (!task?.escrowTaskId) return base;
        const merged = mergeCanisterDispute(task, await this.channelDisputes(req.channelId));
        return merged.dispute ? disputeVotesView(merged, req.payload) : base;
      }
      return super.gameQuery(req);
    })();
  }

  /**
   * Дашборд «Требует тебя»: циклы считает сервер, но спор канистры он не видит — задача донора
   * с идущим голосованием навсегда оставалась бы «Оспорить или подождать». Дозреваем циклы:
   * окно оспаривания с открытым в канистре спором → «Идёт голосование» с её дедлайном.
   */
  override homeFeed(): Result<HomeFeed> {
    return (async () => {
      const base = await super.homeFeed();
      const cycles = await Promise.all(
        base.cycles.map(async (c) => {
          if (c.kind !== "dispute_window") return c;
          try {
            const cases = await this.channelDisputes(c.channelId);
            if (!cases.size) return c;
            const task = (await super.gameQuery({
              gameId: "escrow-task",
              channelId: c.channelId,
              op: "get",
              payload: { taskId: c.taskId },
            })) as EscrowTask | null;
            const cd = task?.escrowTaskId ? cases.get(task.escrowTaskId) : undefined;
            if (!cd || cd.openedAtMs == null) return c;
            return {
              ...c,
              kind: "voting" as const,
              deadline: cd.votingEndsAtMs
                ? new Date(cd.votingEndsAtMs).toISOString()
                : undefined,
              actionable: false,
            };
          } catch {
            return c; // канистра недоступна → серверный цикл как есть
          }
        }),
      );
      return { ...base, cycles };
    })();
  }

  /** Адрес эскроу-аккаунта задания (base58 PDA); null = задача без ончейн-эскроу (mock-эпоха).
   * Нарочно `super.gameQuery`: слияние спора здесь не нужно (нужен только escrowTaskId). */
  private async escrowAccountOf(channelId: string, taskId: string): Promise<string | null> {
    const task = (await super.gameQuery({
      gameId: "escrow-task",
      channelId,
      op: "get",
      payload: { taskId },
    })) as { escrowTaskId?: string } | null;
    if (!task?.escrowTaskId) return null;
    const seed = new Uint8Array(task.escrowTaskId.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
    return escrowPda(new PublicKey(ESCROW_PROGRAM_ID!), seed).toBase58();
  }

  getCanisterDispute(channelId: string, taskId: string): Result<CanisterDisputeView | null> {
    return (async () => {
      const escrowAccount = await this.escrowAccountOf(channelId, taskId);
      if (!escrowAccount) return null;
      let res: Response;
      try {
        res = await fetch(
          `${ICP_CANISTER_URL}/dispute?escrow=${encodeURIComponent(escrowAccount)}`,
        );
      } catch {
        throw new DataError("NETWORK", "Канистра недоступна (runbook «Канистры ICP»)");
      }
      if (res.status === 404) return null; // спора по этому эскроу нет
      if (!res.ok) throw new DataError("BAD_RESPONSE", `Канистра ответила HTTP ${res.status}`);
      return normalizeCanisterDispute(
        (await res.json()) as Parameters<typeof normalizeCanisterDispute>[0],
      );
    })();
  }

  /**
   * Маршрутизация операций спора: для CHAIN-задач `raiseDispute`/`vote` идут В КАНИСТРУ
   * (подпись кошельком канонического сообщения; исход исполняет тресхолд-резолвер) — те же
   * кнопки панели, другой субстрат. Задачи без эскроу (mock/api-эпоха) — как раньше, оффчейн.
   */
  override gameAction(req: GameRequest): Result<unknown> {
    return (async () => {
      const p = (req.payload ?? {}) as { taskId?: string; choice?: string };
      if (
        req.gameId !== "escrow-task" ||
        !p.taskId ||
        (req.op !== "raiseDispute" && req.op !== "vote")
      )
        return super.gameAction(req);
      const escrowAccount = await this.escrowAccountOf(req.channelId, p.taskId);
      if (!escrowAccount) return super.gameAction(req);

      const w = this.wallet;
      if (!w?.publicKey || !w.signMessage)
        throw new DataError("NO_SIGN", "Кошелёк не умеет подписывать сообщения.");
      const me = w.publicKey.toBase58();

      const post = async (path: string, body: Record<string, unknown>) => {
        const res = await fetch(`${ICP_CANISTER_URL}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const out = (await res.json()) as { ok: boolean; error?: string };
        if (!res.ok || !out.ok)
          throw new DataError("BAD_RESPONSE", `Канистра: ${out.error ?? `HTTP ${res.status}`}`);
      };

      if (req.op === "raiseDispute") {
        const message = buildOpenDisputeMessage(escrowAccount, req.channelId, me);
        const signature = bs58.encode(await w.signMessage(new TextEncoder().encode(message)));
        await post("/dispute/open", {
          escrowAccount,
          channelId: req.channelId,
          by: me,
          signature,
        });
        return { ok: true };
      }
      const choice = p.choice === "completed" ? "completed" : "not_completed";
      const message = buildVoteMessage(escrowAccount, req.channelId, me, choice);
      const signature = bs58.encode(await w.signMessage(new TextEncoder().encode(message)));
      await post("/dispute/vote", { escrowAccount, voter: me, choice, signature });
      return { ok: true };
    })();
  }
}
