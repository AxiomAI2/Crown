/**
 * Handlers of the "task-for-a-crown" mini-game for the game-bus (ADR 0016). They glue the pure machine (machine.ts) to
 * the provider context: they check IDENTITY/eligibility (invisible to the machine), compute the vote weight and quorum via
 * core bridges, and bank the reputation effects (ADR 0015). Money: in chain mode — a real on-chain escrow
 * (G3a, ADR 0017; banking strictly by the on-chain outcome), in mock/api — a simulation.
 *
 * Time-based resolution and banking happen in `claim` (it's MUTATING → persisted): the recipient takes the
 * winnings/refund, and at that moment the outcome is recorded in the ledger. Reads (queries) are pure and don't change
 * state (the UI derives the "expected outcome" from the machine itself).
 */
import { pointsForAmount } from "@/lib/reputation";
import { GameBusError, type GameContext, type GameHandlers } from "../bus";
import * as M from "./machine";
import type { EscrowTask, ResolutionReason, TaskOutcome, VoteChoice } from "./types";

/** Quorum in reputation points — grows with the crown amount (spec §8). Mock default: no less than the crown's own points. */
const quorumFor = (amount: string) => Math.max(1, pointsForAmount(BigInt(amount)));

const nowMs = (ctx: GameContext) => Date.parse(ctx.now());

interface EscrowState {
  tasks: EscrowTask[];
}
const loadTasks = (ctx: GameContext): EscrowTask[] => ctx.state.get<EscrowState>()?.tasks ?? [];
const saveTasks = (ctx: GameContext, tasks: EscrowTask[]) =>
  ctx.state.set({ tasks } satisfies EscrowState);

function findTask(tasks: EscrowTask[], id: unknown, channelId: string): EscrowTask {
  const t =
    typeof id === "string"
      ? tasks.find((x) => x.id === id && x.channelId === channelId)
      : undefined;
  if (!t) throw new GameBusError("NO_TASK", "Task not found.");
  return t;
}
/** Replace the task in the list by id and save it; return it. */
function commit(ctx: GameContext, tasks: EscrowTask[], updated: EscrowTask): EscrowTask {
  saveTasks(
    ctx,
    tasks.map((t) => (t.id === updated.id ? updated : t)),
  );
  return updated;
}

function requireIdentity(ctx: GameContext): string {
  if (!ctx.identity) throw new GameBusError("NO_SESSION", "Sign in with your wallet first.");
  return ctx.identity;
}
function requireOwner(ctx: GameContext): string {
  const id = requireIdentity(ctx);
  if (id !== ctx.channelOwner)
    throw new GameBusError("FORBIDDEN", "This action is available only to the realm owner.");
  return id;
}

/**
 * Reconcile the off-chain outcome (by time/votes) with the escrow's ON-CHAIN outcome (ESC-12, money = truth). If the chain
 * diverges from the off-chain timer (e.g. the resolver didn't make the deadline → resolve_timeout gave it to the streamer),
 * we take the on-chain side and synthesize a coherent reason, so the dispute effects follow the money.
 */
function reconcile(
  due: { outcome: TaskOutcome; reason: ResolutionReason },
  chain: "to_streamer" | "to_donor",
  task: EscrowTask,
): { outcome: TaskOutcome; reason: ResolutionReason } {
  if (chain === due.outcome) return due;
  return chain === "to_streamer"
    ? { outcome: "to_streamer", reason: task.dispute ? "vote_completed" : "completed" }
    : { outcome: "to_donor", reason: task.dispute ? "vote_not_completed" : "expired" };
}

/**
 * Resolve by time and bank the effects when due (once — then the status is RESOLVED).
 * ESC-12: for a chain-backed task (has `escrowTaskId`) we bank the crown reputation only when the outcome is
 * CONFIRMED on the chain — money is truth, not the off-chain timer. If the escrow isn't resolved on-chain yet → defer.
 */
async function settle(ctx: GameContext, task: EscrowTask): Promise<EscrowTask> {
  if (task.status === "RESOLVED") return task;
  const due = M.dueResolution(task, nowMs(ctx));
  if (!due) return task;
  if (task.escrowTaskId && ctx.escrowOutcome) {
    // M3 (closes the ESC-12/16 tail): bank ONLY on a KNOWN on-chain outcome — a live `resolution` OR a claim
    // recorded by the event indexer (the money truth outlives the account closure). If the outcome is unknown
    // (Unresolved / not indexed / RPC failure) → DEFER. There's no off-chain timer for a chain-backed task.
    const outcome = await ctx.escrowOutcome(task.escrowTaskId);
    if (!outcome) return task;
    const res = reconcile(due, outcome, task);
    const resolved = M.applyResolution(task, res, nowMs(ctx));
    ctx.bankLedger(M.repEffects(resolved, res));
    return resolved;
  }
  const resolved = M.applyResolution(task, due, nowMs(ctx));
  ctx.bankLedger(M.repEffects(resolved, due));
  return resolved;
}

/**
 * ESC-19: reveal the task text if the streamer ACCEPTED it on-chain (even bypassing the UI). The path to the streamer's
 * money (accept→mark_done→claim) is impossible without an on-chain `accept`, and `accept` is visible to us via the indexer,
 * so we reveal the text to the community. That rules out "hid the text but took the money". Only for chain-backed
 * tasks; state≥Accepted (or already gone to the streamer) → SHOWN. Money/resolve untouched.
 */
/** Marks the task operatorBlocked from the operator override set (platform moderation). Computed in queries — the slice
 * itself doesn't store the flag; so takedown/reinstatement via the operator log is always up to date. */
function withOperatorBlock(ctx: GameContext, task: EscrowTask): EscrowTask {
  return ctx.isContentBlocked?.(task.id) ? { ...task, operatorBlocked: true } : task;
}

/** Server-side redaction of a task's private text (invariant §4.6, parity with the core's `redactDonation`):
 * HELD/HIDDEN text is seen only by channel managers (owner/moderator) and the donor themselves; an operator takedown
 * hides the text from EVERYONE, including managers (overrides the role). The client-side `canSeeText` stays presentation —
 * the truth is here: raw private text does not leave the server. Apply AFTER `withOperatorBlock`. */
function redactTask(ctx: GameContext, task: EscrowTask): EscrowTask {
  if (task.operatorBlocked) return { ...task, text: "" };
  if (M.isTextPublic(task)) return task;
  if (ctx.identity && (ctx.identity === task.donor || ctx.isChannelManager)) return task;
  return { ...task, text: "" };
}

async function revealFromChain(ctx: GameContext, task: EscrowTask): Promise<EscrowTask> {
  // An operator takedown overrides auto-reveal: a task pulled by the operator is NOT brought back to light by the indexer
  // (illegal content stays pulled even if the escrow is accepted/paid on-chain). Operator > chain > moderation.
  if (ctx.isContentBlocked?.(task.id)) return task;
  // Already FULLY visible (text shown AND not hidden from the feed) → nothing to fix. Otherwise — reconcile with the chain:
  // a "hidden" (Reject) or HIDDEN text on an ACCEPTED on-chain task must be lifted, money ⟹ the task is visible.
  const fullyVisible = (task.textState ?? "SHOWN") === "SHOWN" && !task.hidden;
  if (fullyVisible || !task.escrowTaskId) return task;
  if (ctx.escrowState) {
    const st = await ctx.escrowState(task.escrowTaskId);
    // Accepted(1)/Done(2)/Disputed(4) ⟹ an on-chain accept happened (mark_done requires Accepted) → the task is visible:
    // reveal the text AND return it to the feed (clear hidden), so the community has time to see and dispute it.
    if (st === 1 || st === 2 || st === 4)
      return {
        ...task,
        textState: "SHOWN",
        hidden: false,
        status: task.status === "PENDING" ? "ACCEPTED" : task.status,
      };
  }
  // The escrow was closed by a claim to the streamer ⟹ it passed through Done ⟹ accept happened → reveal retrospectively
  // (a safeguard in case the indexer didn't make it before the account closed).
  if (ctx.escrowOutcome && (await ctx.escrowOutcome(task.escrowTaskId)) === "to_streamer")
    return { ...task, textState: "SHOWN", hidden: false };
  return task;
}

export const escrowTaskHandlers: GameHandlers = {
  actions: {
    // The donor creates a task-for-a-crown (money "in escrow" — mocked).
    create: async (ctx, payload) => {
      const donor = requireIdentity(ctx);
      const p = (payload ?? {}) as {
        amount?: unknown;
        text?: unknown;
        executionMs?: unknown;
        escrowTaskId?: unknown; // chain mode: a reference to the on-chain escrow (ADR 0017)
        fundTx?: unknown;
        textNonce?: unknown; // CR-4: the text-commitment salt (task_id = SHA-256(nonce ‖ text))
      };
      const amount = String(p.amount ?? "");
      if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n)
        throw new GameBusError("BAD_AMOUNT", "A positive amount is required (micro-USDC).");
      const text = typeof p.text === "string" ? p.text.trim() : "";
      if (!text) throw new GameBusError("NO_TEXT", "Task text is required.");
      // Realm levers (spec §10, parity with the core's createDonation): the length limit (B4 — DoS/moderation
      // amplification) and the minimum amount (a task = a crown with text → the larger of the realm's two minimums).
      if (text.length > ctx.textMaxLen)
        throw new GameBusError("TOO_LONG", "The task text exceeds the realm's limit.");
      if (BigInt(amount) < BigInt(ctx.minTaskAmountMicro))
        throw new GameBusError("BELOW_MIN", "The amount is below the realm's minimum for tasks.");
      // §10: the reputation threshold to submit a task — newcomers send simple crowns and build standing that way, tasks
      // only from the threshold. Reputation = money actually crowned to this realm → a paid barrier against task flooding
      // (including a free create via raw RPC). 0 = no threshold.
      if (ctx.minReputationToTask > 0 && ctx.reputationAsOf(donor, ctx.now()) < ctx.minReputationToTask)
        throw new GameBusError(
          "LOW_REP",
          "Not enough Reign in this realm to submit tasks. Support the realm with regular crowns.",
        );
      // Task-text moderation: illegal/dangerous content isn't created at all. Otherwise the text's visibility in the PUBLIC
      // feed is decided by the same policy as donation messages (textShowMode): clean + auto_if_clean → immediately
      // SHOWN; otherwise → HELD (the streamer's moderation queue until "Show"). Money/escrow doesn't depend on this (§7).
      const verdict = await ctx.moderate(text);
      if (verdict === "HARD_BLOCK")
        throw new GameBusError(
          "ILLEGAL_TASK",
          "The task didn't pass moderation: illegal/dangerous content is forbidden.",
        );
      const textState: "SHOWN" | "HELD" =
        ctx.textShowMode === "auto_if_clean" && verdict === "CLEAR" ? "SHOWN" : "HELD";
      // Trustless verification of the on-chain escrow (chain mode): a task without a confirmed escrow (no account,
      // wrong donor/amount/mint) isn't recorded — the server doesn't trust the client (ADR 0017). In mock/api — always ok.
      const escrowTaskId = typeof p.escrowTaskId === "string" ? p.escrowTaskId : undefined;
      // ESC-18: one on-chain escrow = one mirror. Re-binding the same escrowTaskId would count reputation N times for ONE
      // payment (verifyEscrow lets a duplicate through while the escrow is Pending) → inflation of §4.4.
      if (escrowTaskId && loadTasks(ctx).some((t) => t.escrowTaskId === escrowTaskId))
        throw new GameBusError("ESCROW_REUSED", "This escrow is already bound to a task.");
      // ESC-6: bind the escrow to THIS realm's payout address (streamer) + require a fresh Pending.
      // fail-closed: a chain escrow without the realm's payout isn't bound (otherwise the streamer check is silently skipped).
      const streamer = ctx.channelPayout ?? undefined;
      if (escrowTaskId && !streamer)
        throw new GameBusError("NO_PAYOUT", "The realm has no payout address — the escrow can't be bound.");
      // H1: the payout the task's money is baked into must be confirmed by the realm owner's signature —
      // the same server-side fail-closed guard that ingest.ts does for a regular crown. Otherwise the escrow path would be
      // a loophole around H1: reputation would drip to a realm with a possibly-swapped payout, and the client-side check
      // (chain-provider.assertPayoutAttested) is bypassable with a hand-built client. We hold it on the server too.
      if (escrowTaskId && !ctx.channelPayoutAttested)
        throw new GameBusError(
          "PAYOUT_UNATTESTED",
          "The realm's payout isn't confirmed by the owner's signature — the escrow task can't be bound.",
        );
      if (escrowTaskId && !(await ctx.verifyEscrow(escrowTaskId, { donor, amount, streamer }))) {
        throw new GameBusError(
          "ESCROW_INVALID",
          "The on-chain escrow wasn't found or doesn't match (donor/amount/mint/realm).",
        );
      }
      // CR-4: task_id must be a commitment to THIS text (SHA-256(nonce ‖ text)). Otherwise a client could fund
      // an escrow under one text and record another → the jury would judge something other than what's baked into the chain.
      const textNonce = typeof p.textNonce === "string" ? p.textNonce : undefined;
      if (escrowTaskId && !(await ctx.verifyTextCommitment(escrowTaskId, text, textNonce))) {
        throw new GameBusError(
          "ESCROW_TEXT_MISMATCH",
          "The on-chain escrow isn't bound to this task text (the commitment didn't match).",
        );
      }
      const task = M.createTask(
        {
          // The id is used in the dispute page URL → we make it URL-safe (the store's id carries an ISO with ":"/".").
          id: ctx.newId().replace(/[^a-zA-Z0-9_-]/g, ""),
          channelId: ctx.channelId,
          donor,
          amount,
          text,
          textState,
          executionMs: typeof p.executionMs === "number" ? p.executionMs : undefined,
        },
        nowMs(ctx),
      );
      // chain mode: bind the off-chain mirror to the on-chain escrow (the provider already sent `fund`).
      const stored: typeof task = {
        ...task,
        ...(escrowTaskId ? { escrowTaskId } : {}),
        ...(typeof p.fundTx === "string" ? { fundTx: p.fundTx } : {}),
        ...(textNonce ? { textNonce } : {}), // CR-4: the salt for a third party to recompute the text commitment
      };
      saveTasks(ctx, [...loadTasks(ctx), stored]);
      return stored;
    },

    // Streamer: accept / reject / mark "Done".
    accept: (ctx, payload) => {
      requireOwner(ctx);
      const tasks = loadTasks(ctx);
      return commit(
        ctx,
        tasks,
        M.accept(findTask(tasks, idOf(payload), ctx.channelId), nowMs(ctx)),
      );
    },
    reject: (ctx, payload) => {
      requireOwner(ctx);
      const tasks = loadTasks(ctx);
      return commit(
        ctx,
        tasks,
        M.reject(findTask(tasks, idOf(payload), ctx.channelId), nowMs(ctx)),
      );
    },
    markDone: (ctx, payload) => {
      requireOwner(ctx);
      const tasks = loadTasks(ctx);
      return commit(
        ctx,
        tasks,
        M.markDone(findTask(tasks, idOf(payload), ctx.channelId), nowMs(ctx)),
      );
    },

    // Donor: cancel within the grace window.
    cancel: (ctx, payload) => {
      const id = requireIdentity(ctx);
      const tasks = loadTasks(ctx);
      const task = findTask(tasks, idOf(payload), ctx.channelId);
      if (id !== task.donor) throw new GameBusError("FORBIDDEN", "Only the donor can cancel.");
      return commit(ctx, tasks, M.cancel(task, nowMs(ctx)));
    },

    // Streamer "Reject": we hide the task from the frontend WITHOUT an on-chain tx and immediate refund. The escrow returns
    // to the donor on its own by timer (no-show) — the streamer pays no gas. Off-chain only (in the chain provider it goes
    // to default → api, no transaction is built).
    hide: (ctx, payload) => {
      requireOwner(ctx);
      const tasks = loadTasks(ctx);
      return commit(ctx, tasks, M.hide(findTask(tasks, idOf(payload), ctx.channelId)));
    },

    // Viewer: report on a task's text (public UGC). Dedup/threshold/text auto-hide — in the machine; money and escrow
    // are untouched (§7). We return {reports,hidden} — like reportMessage, so the UI gives the same toast.
    report: (ctx, payload) => {
      const reporter = requireIdentity(ctx);
      const p = (payload ?? {}) as { reason?: unknown };
      const reason = typeof p.reason === "string" ? p.reason : undefined;
      const tasks = loadTasks(ctx);
      const updated = M.report(
        findTask(tasks, idOf(payload), ctx.channelId),
        reporter,
        reason,
        nowMs(ctx),
      );
      commit(ctx, tasks, updated);
      return { reports: updated.reports?.length ?? 0, hidden: updated.textState === "HIDDEN" };
    },

    // Streamer: show/hide a task's text in the PUBLIC feed (moderation queue). Money/escrow — untouched (§7).
    setTextState: (ctx, payload) => {
      requireOwner(ctx);
      const p = (payload ?? {}) as { state?: unknown };
      const state = p.state === "SHOWN" ? "SHOWN" : "HIDDEN";
      const tasks = loadTasks(ctx);
      const task = findTask(tasks, idOf(payload), ctx.channelId);
      // "Show" is only possible while the task is alive: the timer hasn't expired and it isn't resolved. Expired → it goes
      // to a refund to the donor on its own, too late to publish the text.
      if (state === "SHOWN" && (task.status === "RESOLVED" || M.dueResolution(task, nowMs(ctx))))
        throw new GameBusError("TEXT_LOCKED", "The task's deadline has passed — the text can no longer be shown.");
      // ESC-19: "hide" is only possible BEFORE acceptance (PENDING) — while not a cent can go to the streamer.
      // After accept the money may leak to the streamer, so the text must stay visible to the community
      // (otherwise: hid the text → quietly took it → nobody knows what they voted on). The indexer reveals such
      // text back by the on-chain state anyway — hiding it after accept is pointless.
      if (state === "HIDDEN" && task.status !== "PENDING")
        throw new GameBusError(
          "TEXT_LOCKED",
          "The task is accepted — the text can no longer be hidden: the community sees it.",
        );
      return commit(ctx, tasks, M.setTextState(task, state));
    },

    // A qualified viewer raises a dispute (not the streamer; reputation ≥ threshold).
    raiseDispute: (ctx, payload) => {
      const id = requireIdentity(ctx);
      if (id === ctx.channelOwner)
        throw new GameBusError("FORBIDDEN", "The content maker doesn't dispute their own completion.");
      // §10: the reputation threshold for the right to raise a dispute (a streamer lever) — gates the right, not the vote
      // weight or the outcome. Reputation = money crowned to the realm → spamming false disputes requires real standing, not a zero wallet.
      if (ctx.reputationAsOf(id, ctx.now()) < ctx.minReputationToDispute)
        throw new GameBusError("LOW_REP", "Not enough Reign to raise a dispute.");
      const tasks = loadTasks(ctx);
      const task = findTask(tasks, idOf(payload), ctx.channelId);
      return commit(ctx, tasks, M.raiseDispute(task, id, quorumFor(task.amount), nowMs(ctx)));
    },

    // A juror votes; weight = reputation at the snapshot (the moment the dispute was opened). Donor/streamer are excluded.
    vote: (ctx, payload) => {
      const id = requireIdentity(ctx);
      const p = (payload ?? {}) as { taskId?: unknown; choice?: unknown };
      const choice =
        p.choice === "completed" || p.choice === "not_completed" ? (p.choice as VoteChoice) : null;
      if (!choice) throw new GameBusError("BAD_CHOICE", "Choice: completed | not_completed.");
      const tasks = loadTasks(ctx);
      const task = findTask(tasks, p.taskId, ctx.channelId);
      if (id === task.donor)
        throw new GameBusError("FORBIDDEN", "The donor doesn't vote in their own dispute.");
      if (id === ctx.channelOwner)
        throw new GameBusError("FORBIDDEN", "The content maker doesn't vote in their own dispute.");
      const weight = ctx.reputationAsOf(id, task.dispute?.openedAt ?? ctx.now());
      return commit(
        ctx,
        tasks,
        M.castVote(task, { voter: id, choice, weight, at: ctx.now() }, nowMs(ctx)),
      );
    },

    // The recipient claims the money (claim model, ADR 0015): here we resolve by time + bank the effects.
    claim: async (ctx, payload) => {
      const by = requireIdentity(ctx);
      const tasks = loadTasks(ctx);
      const task = findTask(tasks, idOf(payload), ctx.channelId);
      const settled = await settle(ctx, task);
      // ESC-14: PERSIST the resolve (with all banked effects) BEFORE the winner check. Otherwise M.claim
      // throws NOT_WINNER before commit → the status isn't saved, but the banking (settle's side effect) already
      // happened → a repeated claim by a non-recipient again sees the task matured and mints reputation without limit.
      if (settled !== task) commit(ctx, tasks, settled);
      return commit(ctx, loadTasks(ctx), M.claim(settled, by, ctx.channelOwner ?? "", nowMs(ctx)));
    },

    // PERMISSIONLESS: resolve by time + bank reputation for ALL matured tasks in the realm, without waiting for a claim
    // (ADR 0015 §2 — reputation at the resolve moment). Called by a background settler (indexer-service)
    // independently of the browser. Idempotent: settle() doesn't touch an already-RESOLVED task. Doesn't move money (claim model).
    settleDue: async (ctx) => {
      const tasks = loadTasks(ctx);
      let changed = 0;
      const next: EscrowTask[] = [];
      for (const t of tasks) {
        if (t.status === "RESOLVED" || t.channelId !== ctx.channelId) {
          next.push(t);
          continue;
        }
        // ESC-19: reveal the text if the streamer accepted on-chain (even bypassing the UI), BEFORE attempting the resolve.
        const revealed = await revealFromChain(ctx, t);
        const s = await settle(ctx, revealed); // banks the effects on the transition to RESOLVED (bankLedger)
        if (s !== t) changed++;
        next.push(s);
      }
      if (changed > 0) saveTasks(ctx, next);
      return { settled: changed };
    },
  },

  queries: {
    // Tasks of this realm (the UI computes the "expected outcome" by time with the machine itself). We annotate
    // operatorBlocked from the operator override set — a single source of truth for takedowns (not in the slice) — and
    // redact the private text by the caller's role (§4.6): raw HELD/HIDDEN text doesn't go to outsiders.
    list: (ctx) => ({
      tasks: loadTasks(ctx)
        .filter((t) => t.channelId === ctx.channelId)
        .map((t) => redactTask(ctx, withOperatorBlock(ctx, t))),
    }),
    get: (ctx, payload) => {
      const id = idOf(payload);
      const t = loadTasks(ctx).find((t) => t.id === id && t.channelId === ctx.channelId);
      return t ? redactTask(ctx, withOperatorBlock(ctx, t)) : null;
    },
    // Dispute votes — PAGINATED + filter by side + search by address + sorting (the pure
    // machine.disputeVotesView — also called by the icp provider for canister disputes). We redact the task
    // as in list/get (§4.6): a dispute is only possible after accept (text SHOWN), but an operator
    // takedown may have pulled the text later — we don't return pulled text.
    disputeVotes: (ctx, payload) => {
      const id = idOf(payload);
      const raw = loadTasks(ctx).find((t) => t.id === id && t.channelId === ctx.channelId);
      if (!raw || !raw.dispute) return { found: false };
      return M.disputeVotesView(redactTask(ctx, withOperatorBlock(ctx, raw)), payload);
    },
  },
};

function idOf(payload: unknown): unknown {
  return (payload as { taskId?: unknown } | null)?.taskId;
}
