/**
 * IcpDataProvider — режим `icp` (M1 миграции, ADR 0021): канистра ICP = КАНОН ЧТЕНИЯ репутации.
 *
 * Гибрид поверх ChainDataProvider: переопределены ТОЛЬКО два читающих метода —
 * `getStanding` и `getLeaderboard` идут напрямую в HTTP-экспорт core-канистры (она пересобирает
 * журнал из цепочки сама; браузер читает канон МИМО нашего сервера — в этом смысл фазы).
 * Всё остальное — как в chain: кошелёк, донаты, эскроу, тексты/модерация/профили (кожа) — сервер.
 *
 * Косметика остаётся кожей: имена доноров на лидерборде подтягиваются с сервера и присоединяются
 * к каноничным цифрам; сервер недоступен → цифры без имён (деньги/репутация не зависят от кожи).
 *
 * Дельта канона на переходе (yellow-paper §18.5-8a): канистра знает только ончейн-донаты по
 * текущей формуле; серверные события вне цепочки (DISPUTE_* до M2, mock-эпоха, легаси-округления)
 * в её числах отсутствуют. Игровые веса/кворумы продолжают считаться сервером до M2.
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
import { ChainDataProvider } from "./chain-provider";
import { DataError, type Result } from "./provider";
import type {
  Address,
  DonorOverview,
  GameRequest,
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
      return {
        ...base,
        standings,
        topStanding,
        totalDonated: standings.reduce((sum, r) => sum + r.totalDonated, 0n),
        donationCount: standings.reduce((sum, r) => sum + r.donationCount, 0),
        channelsSupported: standings.filter((r) => r.donationCount > 0).length,
        firstDonationAt: firstDonationAt ?? base.firstDonationAt,
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

  /** Адрес эскроу-аккаунта задания (base58 PDA); null = задача без ончейн-эскроу (mock-эпоха). */
  private async escrowAccountOf(channelId: string, taskId: string): Promise<string | null> {
    const task = (await this.gameQuery({
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
