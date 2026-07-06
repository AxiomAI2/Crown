"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { GAMES } from "@/games/registry";
import type { GameModule } from "@/games/types";
import { DISPUTE_LOSS_PENALTY, DISPUTE_WIN_BONUS } from "@/games/escrow-task/machine";
import { IS_ICP } from "@/lib/chain/addresses";
import type { DisputeParamsValues } from "@/lib/chain/dispute-params";
import {
  useChannelConfig,
  useDisputeParams,
  useMyChannel,
  useSetDisputeParams,
  useUpdateConfig,
} from "@/lib/data/hooks";
import { fromMicro, toMicro } from "@/lib/utils";

/**
 * Personal Space → My Realm → "Mini-games". The single place for ALL game settings (ADR 0016): the catalog
 * from the registry (`src/games`, toggled in `enabledGames`), the §10 Reign thresholds/limits (who can send
 * tasks / raise disputes), the dispute outcome by Reign (protocol constants), and — in icp mode — the
 * dispute governance parameters from the canister. Thresholds used to live at `/studio/games` and dispute
 * parameters in Customization; they were consolidated here by the owner's decision.
 */
export function RealmGamesSettings() {
  const myChannelQ = useMyChannel();
  const channelId = myChannelQ.data?.id;
  const configQ = useChannelConfig(channelId);
  const config = configQ.data;
  const update = useUpdateConfig(channelId ?? "");

  // Reign thresholds (tasks/disputes) — a local draft + an explicit "Save" (we don't hit the network on
  // every keystroke). Synced from the config. Hooks go BEFORE any early return (rules of hooks).
  const cfgRepTask = config?.minReputationToTask ?? 0;
  const cfgRepDispute = config?.minReputationToDispute ?? 0;
  const [repTask, setRepTask] = useState(0);
  const [repDispute, setRepDispute] = useState(0);
  useEffect(() => {
    setRepTask(cfgRepTask);
    setRepDispute(cfgRepDispute);
  }, [cfgRepTask, cfgRepDispute]);

  if (myChannelQ.isLoading) return <Skeleton className="h-64 w-full rounded-lg" />;
  if (!channelId) {
    return (
      <EmptyState
        title="Create a realm first"
        description="Mini-games are enabled per realm — create yours in the overview, then turn on mechanics here."
      />
    );
  }
  if (configQ.isLoading || !config) {
    if (configQ.error) {
      return (
        <ErrorState description="Couldn't load the config." onRetry={() => configQ.refetch()} />
      );
    }
    return <Skeleton className="h-64 w-full rounded-lg" />;
  }

  const enabled = new Set(config.enabledGames);

  function toggle(g: GameModule, on: boolean) {
    const next = on ? [...new Set([...enabled, g.id])] : [...enabled].filter((id) => id !== g.id);
    update.mutate(
      { enabledGames: next },
      {
        onSuccess: () =>
          toast({
            variant: "success",
            title: on ? `"${g.title}" enabled` : `"${g.title}" disabled`,
          }),
        onError: (e) => toast({ variant: "error", title: "Couldn't save", description: String(e) }),
      },
    );
  }

  const thresholdsDirty = repTask !== cfgRepTask || repDispute !== cfgRepDispute;

  function saveThresholds() {
    update.mutate(
      { minReputationToTask: repTask, minReputationToDispute: repDispute },
      {
        onSuccess: () => toast({ variant: "success", title: "Thresholds saved" }),
        onError: (e) => toast({ variant: "error", title: "Couldn't save", description: String(e) }),
      },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-display-l text-fg">Mini-games</h1>
        <p className="text-fg-muted">
          Mechanics on top of Reign. Turn them on once your community has weight — on a cold realm
          there&apos;s no one to play dispute games with (cold-start).
        </p>
      </div>

      {/* Game catalog from the registry — the on/off state is stored in enabledGames */}
      <div className="flex flex-col gap-3">
        {GAMES.map((g) => {
          const building = g.status === "building";
          const isOn = enabled.has(g.id);
          return (
            <div
              key={g.id}
              className="flex items-start gap-4 rounded-lg border border-border bg-surface p-4"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-fg">{g.title}</span>
                  {building ? (
                    <span className="text-caption rounded-pill border border-border px-2 py-0.5 text-fg-faint">
                      in development
                    </span>
                  ) : null}
                </div>
                <p className="text-small text-fg-muted">{g.tagline}</p>
                {building ? (
                  <p className="text-small text-fg-faint">
                    You&apos;ll be able to enable it once the game is ready.
                  </p>
                ) : null}
              </div>
              <div className="shrink-0 pt-0.5">
                <Switch
                  checked={isOn}
                  disabled={building || update.isPending}
                  onCheckedChange={(on) => toggle(g, on)}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* "Task-crown" Reign thresholds — the streamer's §10 levers: who can send tasks / raise disputes.
          Reign is earned by crowning → the threshold = a money barrier against zero-wallets. */}
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-fg">Reputation thresholds (limits)</h2>
          <p className="text-small text-fg-muted">
            Reign is earned by crowning. Thresholds keep zero-wallets out: to send a task
            {IS_ICP ? "" : " or raise a dispute"} a viewer needs status — a realm they actually
            backed. 0 = no threshold.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Min Reign to send a task"
            mono
            value={String(repTask)}
            onChange={(e) => setRepTask(Math.max(0, Number(e.target.value) || 0))}
          />
          {/* In icp the dispute threshold lives in the canister (Dispute governance below) — not duplicated here. */}
          {!IS_ICP ? (
            <Input
              label="Min Reign to raise a dispute"
              mono
              value={String(repDispute)}
              onChange={(e) => setRepDispute(Math.max(0, Number(e.target.value) || 0))}
            />
          ) : null}
        </div>
        <p className="text-small text-fg-faint">
          {IS_ICP
            ? "The dispute reputation gate is set in Dispute governance (canister) below."
            : "A high dispute threshold means less trolling but fewer challenges. Set it very high and you effectively turn disputes off — supporters will see that."}
        </p>
        <div>
          <Button
            variant="secondary"
            disabled={!thresholdsDirty || update.isPending}
            onClick={saveThresholds}
          >
            Save thresholds
          </Button>
        </div>
      </div>

      {/* Dispute outcome by Reign. Outside icp (mock/api/chain) the TS machine (machine.ts) rules with fixed
          constants — shown read-only. In icp the rewards are editable via the canister's governance params (below). */}
      {!IS_ICP ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-fg">Dispute outcomes (Reign)</h2>
            <p className="text-small text-fg-muted">
              When a task-crown dispute resolves, the raiser&apos;s Reign moves by a fixed protocol
              amount. On this data source it&apos;s not editable; on-chain (icp) you tune it in Dispute
              governance below.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-[var(--bg)] p-3">
              <div className="text-caption text-fg-faint">Won dispute</div>
              <div className="mono text-money">+{DISPUTE_WIN_BONUS} Reign</div>
            </div>
            <div className="rounded-lg border border-border bg-[var(--bg)] p-3">
              <div className="text-caption text-fg-faint">Lost false dispute</div>
              <div className="mono text-danger">−{DISPUTE_LOSS_PENALTY} Reign</div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Dispute governance params from the canister (icp): quorum/windows/juror weight/min Reign + REWARDS
          (win/loss) — changed only by the owner's signature and with a timelock. Consolidated here with the games. */}
      {IS_ICP ? <DisputeParamsSection channelId={channelId} /> : null}
    </div>
  );
}

/**
 * Dispute governance params (migration M1, ADR 0021) — live in the ICP canister, not on the server. Changed
 * only by the owner's wallet signature and take effect on a timelock (disputes already running keep the old
 * rules). The draft is in human units (Reign/minutes/USDC), micro is applied at the boundary.
 */
interface ParamsDraft {
  minRep: string;
  minWeight: string;
  quorum: string;
  disputeMin: string;
  votingMin: string;
  winBonus: string;
  lossPenalty: string;
}

/** Логическая группа полей формы — мини-заголовок + сетка 2-в-ряд. Разбивает длинный список
 *  параметров на осмысленные блоки (кто открывает/голосует · тайминги · ставки). */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <span className="text-caption uppercase tracking-wide text-fg-faint">{title}</span>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function DisputeParamsSection({ channelId }: { channelId: string }) {
  const paramsQ = useDisputeParams(channelId);
  const save = useSetDisputeParams();
  const [draft, setDraft] = useState<ParamsDraft | null>(null);

  const info = paramsQ.data;
  useEffect(() => {
    if (!info) return;
    const e = info.effective;
    setDraft({
      minRep: String(fromMicro(e.minReputationToDisputeMicro)),
      minWeight: String(fromMicro(e.minWeightToVoteMicro)),
      quorum: String(fromMicro(e.quorumMicro)),
      disputeMin: String(e.disputeWindowSecs / 60),
      votingMin: String(e.votingWindowSecs / 60),
      winBonus: String(fromMicro(e.disputeWinBonusMicro)),
      lossPenalty: String(fromMicro(e.disputeLossPenaltyMicro)),
    });
  }, [info?.version, info?.channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  const Card = ({ children }: { children: React.ReactNode }) => (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <h2 className="font-display text-fg">Dispute governance (canister)</h2>
      {children}
    </div>
  );

  if (paramsQ.error) {
    return (
      <Card>
        <ErrorState
          description={`Canister unavailable: ${paramsQ.error instanceof Error ? paramsQ.error.message : String(paramsQ.error)}`}
          onRetry={() => paramsQ.refetch()}
        />
      </Card>
    );
  }
  if (!info || !draft) {
    return (
      <Card>
        <Skeleton className="h-32 w-full rounded-lg" />
      </Card>
    );
  }

  const num = (s: string) => Number(s.replace(",", "."));
  const valid =
    Number.isFinite(num(draft.minRep)) &&
    Number.isFinite(num(draft.minWeight)) &&
    num(draft.quorum) >= 0 &&
    num(draft.disputeMin) >= 1 &&
    num(draft.votingMin) >= 1 &&
    num(draft.winBonus) >= 0 &&
    num(draft.lossPenalty) >= 0;

  function submit() {
    const params: DisputeParamsValues = {
      minReputationToDisputeMicro: toMicro(num(draft!.minRep)),
      minWeightToVoteMicro: toMicro(num(draft!.minWeight)),
      quorumMicro: toMicro(num(draft!.quorum)),
      disputeWindowSecs: Math.round(num(draft!.disputeMin) * 60),
      votingWindowSecs: Math.round(num(draft!.votingMin) * 60),
      // Dead field of the signature format (the arbiter doesn't read it; no economics tied to the amount — owner's M2 decision).
      dMaxMicro: info!.effective.dMaxMicro,
      disputeWinBonusMicro: toMicro(num(draft!.winBonus)),
      disputeLossPenaltyMicro: toMicro(num(draft!.lossPenalty)),
    };
    save.mutate(
      { channelId, params },
      {
        onSuccess: (r) =>
          toast({
            variant: "success",
            title: "Rules sent to the canister",
            description: r.pending
              ? `Effective ${new Date(r.pending.effectiveAtMs).toLocaleString("en-US")} (timelock).`
              : undefined,
          }),
        onError: (e) =>
          toast({
            variant: "error",
            title: "Canister rejected the write",
            description: e instanceof Error ? e.message : String(e),
          }),
      },
    );
  }

  // Эффективный пол открытия спора = max(порог, штраф): поднявший обязан покрыть, что проиграет.
  const penaltyNum = Number.isFinite(num(draft.lossPenalty)) ? num(draft.lossPenalty) : 0;
  const minRepNum = Number.isFinite(num(draft.minRep)) ? num(draft.minRep) : 0;
  const floor = Math.max(minRepNum, penaltyNum);
  const floorFromPenalty = penaltyNum > minRepNum;

  return (
    <Card>
      <p className="text-small text-fg-muted">
        Rules for task-crown disputes live in the ICP canister, not with the platform: only your
        wallet signature can change them, and they take effect on a timelock — disputes already
        running keep the old rules. The platform cannot tweak these.
      </p>
      {info.pending ? (
        <p className="text-small text-info">
          Awaiting activation (version {info.pending.version}):{" "}
          {new Date(info.pending.effectiveAtMs).toLocaleString("en-US")}. Until then the previous
          rules apply.
        </p>
      ) : info.isDefault ? (
        <p className="text-small text-fg-faint">
          Default rules apply — this realm hasn&apos;t changed anything.
        </p>
      ) : null}

      {/* Живой «эффективный пол» открытия спора — снимает необходимость держать max в голове. */}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-[var(--bg)] px-4 py-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-caption uppercase tracking-wide text-fg-faint">
            Floor to open a dispute
          </span>
          <span className="text-small text-fg-muted">
            A raiser must cover what they&apos;d lose — so it can&apos;t be below the penalty.
          </span>
        </div>
        <span className="mono shrink-0 text-h3 tabular-nums text-fg">
          {floor}
          <span className="ml-1 text-small text-fg-faint">Reign</span>
        </span>
      </div>

      <Group title="Who can open & vote">
        <Input
          label="Reign to open a dispute"
          mono
          inputMode="decimal"
          value={draft.minRep}
          helper={
            floorFromPenalty
              ? `Auto-raised to ${penaltyNum} to match the penalty.`
              : "Minimum Reign to raise a dispute."
          }
          onChange={(e) => setDraft({ ...draft, minRep: e.target.value })}
        />
        <Input
          label="Minimum juror weight"
          mono
          inputMode="decimal"
          helper="Reign a wallet needs for its vote to count."
          value={draft.minWeight}
          onChange={(e) => setDraft({ ...draft, minWeight: e.target.value })}
        />
        <Input
          label="Turnout quorum"
          mono
          inputMode="decimal"
          helper="Reign — if fewer vote, the dispute goes to you."
          value={draft.quorum}
          onChange={(e) => setDraft({ ...draft, quorum: e.target.value })}
        />
      </Group>

      <Group title="Timing">
        <Input
          label="Open-dispute window"
          mono
          inputMode="decimal"
          helper="minutes to raise a dispute after «Done»."
          value={draft.disputeMin}
          onChange={(e) => setDraft({ ...draft, disputeMin: e.target.value })}
        />
        <Input
          label="Voting window"
          mono
          inputMode="decimal"
          helper="minutes jurors have to vote."
          value={draft.votingMin}
          onChange={(e) => setDraft({ ...draft, votingMin: e.target.value })}
        />
      </Group>

      <Group title="Stakes (Reign)">
        <Input
          label="Won-dispute reward"
          mono
          inputMode="decimal"
          helper="Reign the raiser gains if the community sides with them."
          value={draft.winBonus}
          onChange={(e) => setDraft({ ...draft, winBonus: e.target.value })}
        />
        <Input
          label="Lost-dispute penalty"
          mono
          inputMode="decimal"
          helper="Reign the raiser loses on a false dispute — sets the floor above."
          value={draft.lossPenalty}
          onChange={(e) => {
            // Логическая связка: штраф авто-поднимает порог открытия спора (пол = max), чтобы
            // поднявший всегда мог покрыть проигрыш. Более высокий ручной порог сохраняется.
            const v = e.target.value;
            const penalty = num(v);
            const curMin = num(draft.minRep);
            setDraft({
              ...draft,
              lossPenalty: v,
              minRep: Number.isFinite(penalty) && penalty > curMin ? v : draft.minRep,
            });
          }}
        />
      </Group>

      <div className="flex flex-col items-start gap-2 border-t border-border pt-4">
        <Button variant="money" loading={save.isPending} disabled={!valid} onClick={submit}>
          Sign and send to the canister
        </Button>
        <p className="text-small text-fg-faint">
          This is a message signature, not a transaction: no money moves, no gas is spent. Rules
          version: {info.version}.
        </p>
      </div>
    </Card>
  );
}
