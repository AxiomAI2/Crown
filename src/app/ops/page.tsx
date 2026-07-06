"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConnectWalletButton } from "@/components/layout/connect-wallet-button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { Pager, usePager } from "@/components/ui/pager";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { ModerationSandbox } from "@/components/domain/moderation-sandbox";
import {
  useApplyOperatorAction,
  useOperatorChannels,
  useOperatorQueue,
  useSession,
} from "@/lib/data/hooks";
import { cn, shortAddress, timeAgo } from "@/lib/utils";
import type { IncidentLog, PenaltyAction } from "@/lib/data/types";

// Incident kind → a clear label and color (readable at a glance).
const KIND: Record<IncidentLog["kind"], { label: string; cls: string }> = {
  report: { label: "Report", cls: "border-warn text-warn" },
  hard_block: { label: "Auto-quarantine", cls: "border-danger text-danger" },
  sanction_hit: { label: "Sanctions", cls: "border-danger text-danger" },
  flood: { label: "Flood", cls: "border-warn text-warn" },
};

const LADDER = [
  "Hide / quarantine message",
  "Realm block (content maker)",
  "Temporary realm suspend (SUSPENDED)",
  "Ban creator role (BANNED)",
  "Full wallet ban",
  "Legal escalation: NCMEC + preservation",
];

const ACTIONS: { value: PenaltyAction; label: string }[] = [
  { value: "HIDE_MESSAGE", label: "Hide message" },
  { value: "CHANNEL_BLOCK", label: "Realm block" },
  { value: "SUSPEND_CHANNEL", label: "Suspend realm" },
  { value: "BAN_CREATOR_ROLE", label: "Ban creator role" },
  { value: "BAN_WALLET_FULL", label: "Full wallet ban" },
  { value: "REINSTATE_CHANNEL", label: "Reinstate realm (lift suspend/ban)" },
];

// Which targets an action needs: a realm and/or a wallet address. For the selected action we show the needed fields.
const REQUIRES: Record<PenaltyAction, { channel: boolean; address: boolean }> = {
  HIDE_MESSAGE: { channel: true, address: false },
  CHANNEL_BLOCK: { channel: true, address: true },
  SUSPEND_CHANNEL: { channel: true, address: false },
  BAN_CREATOR_ROLE: { channel: true, address: false },
  BAN_WALLET_FULL: { channel: false, address: true },
  REINSTATE_CHANNEL: { channel: true, address: false },
};

export default function OpsConsolePage() {
  const sessionQ = useSession();
  const queueQ = useOperatorQueue();
  const channelsQ = useOperatorChannels(); // all realms (any status) — so we can act on SUSPENDED ones too
  const apply = useApplyOperatorAction();

  const [action, setAction] = useState<PenaltyAction>("SUSPEND_CHANNEL");
  const [channelId, setChannelId] = useState("");
  const [address, setAddress] = useState("");
  const [reason, setReason] = useState("");
  const [preservation, setPreservation] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const incPg = usePager(queueQ.data ?? [], 10); // paginate the log so it doesn't run on forever

  const req = REQUIRES[action];
  const canApply =
    (!req.channel || channelId.trim() !== "") && (!req.address || address.trim() !== "");

  // channelId → @handle (readable).
  const handleFor = (id: string): string => {
    const ch = (channelsQ.data ?? []).find((c) => c.id === id);
    return ch ? `@${ch.handle}` : id;
  };

  // "Resolve": fill the incident's target into the action form and scroll to it.
  function fillFromIncident(inc: IncidentLog) {
    if (inc.channelId) setChannelId(inc.channelId);
    if (inc.address) setAddress(inc.address);
    if (inc.kind === "hard_block" || inc.kind === "sanction_hit") setAction("SUSPEND_CHANNEL");
    document.getElementById("ops-action")?.scrollIntoView({ behavior: "smooth", block: "start" });
    toast({ title: "Target filled into the form", description: "Check the action and apply." });
  }

  function doApply() {
    apply.mutate(
      {
        action,
        targetChannelId: channelId.trim() || undefined,
        targetAddress: address.trim() || undefined,
        reason: reason.trim() || action,
        preservation: preservation || undefined,
        reported: preservation || undefined,
      },
      {
        onSuccess: () => {
          toast({ variant: "success", title: "Action applied", description: action });
          setConfirmOpen(false);
        },
        onError: (e) => toast({ variant: "error", title: "Error", description: String(e) }),
      },
    );
  }

  // Access gate: the T&S console is visible ONLY to the operator. Other actions are blocked by the server anyway (requireOperator),
  // but we don't show the console itself either. (Source of truth — getSession.isOperator by the verified address.)
  if (sessionQ.isLoading) return <Skeleton className="h-64 w-full rounded-lg" />;
  if (!sessionQ.data?.isOperator) {
    return (
      <EmptyState
        title="Operators only"
        description="The T&S console is available only to the platform operator wallet. Sign in with the operator wallet."
        action={<ConnectWalletButton />}
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-display-l text-fg">Operator console / T&amp;S</h1>
        <p className="text-fg-muted">
          Platform level: what a content maker cannot do.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-h2 text-fg">Moderation sandbox</h2>
          <p className="text-small text-fg-muted">
            Type in some text — we'll run it through the same pipeline as the live path and show the verdict. Nothing is
            saved.
          </p>
        </div>
        <ModerationSandbox />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-h2 text-fg">Penalty ladder</h2>
        <ol className="flex flex-col gap-1">
          {LADDER.map((step, i) => (
            <li key={step} className="flex items-center gap-3 rounded border border-border bg-surface px-3 py-2">
              <span className="mono text-small text-fg-faint">{i + 1}</span>
              <span className="text-small text-fg">{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <section id="ops-action" className="flex flex-col gap-3 scroll-mt-4">
        <h2 className="text-h2 text-fg">Apply action</h2>
        <div className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2">
          <Select label="Action" value={action} onChange={(e) => setAction(e.target.value as PenaltyAction)}>
            {ACTIONS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </Select>
          <Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="CSAM / flood / sanctions" />
          {req.channel ? (
            <Select label="Realm" value={channelId} onChange={(e) => setChannelId(e.target.value)}>
              <option value="">— select realm —</option>
              {(channelsQ.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  @{c.handle} · {c.status}
                </option>
              ))}
            </Select>
          ) : null}
          {req.address ? (
            <Input
              label="Wallet address"
              mono
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="paste base58 address"
            />
          ) : null}
          <Switch checked={preservation} onCheckedChange={setPreservation} label="Preservation + report (NCMEC)" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="danger" disabled={!canApply} onClick={() => setConfirmOpen(true)}>
            Apply action
          </Button>
          {!canApply ? (
            <span className="text-small text-fg-faint">
              Specify a target: {[req.channel && "realm", req.address && "wallet address"].filter(Boolean).join(" + ")}
            </span>
          ) : null}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-h2 text-fg">Incident log</h2>
        {queueQ.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : queueQ.error ? (
          <ErrorState onRetry={() => queueQ.refetch()} />
        ) : (queueQ.data ?? []).length === 0 ? (
          <EmptyState title="No incidents" />
        ) : (
          <div className="flex flex-col gap-2">
            <ul className="flex flex-col gap-2">
            {incPg.pageItems.map((inc: IncidentLog) => (
              <li key={inc.id} className="flex flex-col gap-1.5 rounded border border-border bg-surface px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("rounded border px-1.5 py-0.5 text-caption", KIND[inc.kind].cls)}>
                    {KIND[inc.kind].label}
                  </span>
                  {inc.channelId ? (
                    <span className="text-small text-fg">{handleFor(inc.channelId)}</span>
                  ) : null}
                  {inc.address ? (
                    <span className="mono text-small text-fg-muted">{shortAddress(inc.address)}</span>
                  ) : null}
                  <span className="ml-auto text-small text-fg-faint">{timeAgo(inc.ts)}</span>
                </div>
                <span className="text-small text-fg-muted">{inc.detail}</span>
                {inc.text ? (
                  <p className="rounded bg-surface-raised px-2 py-1 text-small italic text-fg">
                    «{inc.text}»
                  </p>
                ) : null}
                {inc.resolution ? (
                  <span className="text-small text-fg-faint">→ {inc.resolution}</span>
                ) : null}
                {inc.channelId || inc.address ? (
                  <button
                    type="button"
                    onClick={() => fillFromIncident(inc)}
                    className="self-start text-small text-info hover:underline"
                  >
                    Resolve →
                  </button>
                ) : null}
              </li>
            ))}
            </ul>
            <Pager
              page={incPg.page}
              pageCount={incPg.pageCount}
              total={incPg.total}
              pageSize={incPg.pageSize}
              setPage={incPg.setPage}
              setPageSize={incPg.setPageSize}
            />
          </div>
        )}
      </section>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm action</DialogTitle>
            <DialogDescription>
              {ACTIONS.find((a) => a.value === action)?.label}. Destructive actions are recorded in the
              incident log.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" disabled={apply.isPending}>
                Cancel
              </Button>
            </DialogClose>
            <Button variant="danger" loading={apply.isPending} onClick={doApply}>
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
