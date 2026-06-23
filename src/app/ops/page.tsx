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
import {
  useApplyOperatorAction,
  useOperatorChannels,
  useOperatorQueue,
  useSession,
} from "@/lib/data/hooks";
import { cn, shortAddress, timeAgo } from "@/lib/utils";
import type { IncidentLog, PenaltyAction } from "@/lib/data/types";

// Тип инцидента → понятная подпись и цвет (читается с одного взгляда).
const KIND: Record<IncidentLog["kind"], { label: string; cls: string }> = {
  report: { label: "Жалоба", cls: "border-warn text-warn" },
  hard_block: { label: "Авто-карантин", cls: "border-danger text-danger" },
  sanction_hit: { label: "Санкции", cls: "border-danger text-danger" },
  flood: { label: "Флуд", cls: "border-warn text-warn" },
};

const LADDER = [
  "Скрыть / карантин сообщения",
  "Канальный блок (стример)",
  "Временный саспенд канала (SUSPENDED)",
  "Бан роли креатора (BANNED)",
  "Полный бан кошелька",
  "Воид репутации (ADMIN_VOID)",
  "Юр-эскалация: NCMEC + preservation",
];

const ACTIONS: { value: PenaltyAction; label: string }[] = [
  { value: "HIDE_MESSAGE", label: "Скрыть сообщение" },
  { value: "CHANNEL_BLOCK", label: "Канальный блок" },
  { value: "SUSPEND_CHANNEL", label: "Саспенд канала" },
  { value: "BAN_CREATOR_ROLE", label: "Бан креатор-роли" },
  { value: "BAN_WALLET_FULL", label: "Полный бан кошелька" },
  { value: "ADMIN_VOID", label: "Воид репутации (ADMIN_VOID)" },
  { value: "REINSTATE_CHANNEL", label: "Восстановить канал (снять саспенд/бан)" },
];

// Какие цели нужны действию: канал и/или адрес кошелька. Под выбранное действие показываем нужные поля.
const REQUIRES: Record<PenaltyAction, { channel: boolean; address: boolean }> = {
  HIDE_MESSAGE: { channel: true, address: false },
  CHANNEL_BLOCK: { channel: true, address: true },
  SUSPEND_CHANNEL: { channel: true, address: false },
  BAN_CREATOR_ROLE: { channel: true, address: false },
  BAN_WALLET_FULL: { channel: false, address: true },
  ADMIN_VOID: { channel: true, address: true },
  REINSTATE_CHANNEL: { channel: true, address: false },
};

export default function OpsConsolePage() {
  const sessionQ = useSession();
  const queueQ = useOperatorQueue();
  const channelsQ = useOperatorChannels(); // все каналы (любой статус) — чтобы действовать и на SUSPENDED
  const apply = useApplyOperatorAction();

  const [action, setAction] = useState<PenaltyAction>("SUSPEND_CHANNEL");
  const [channelId, setChannelId] = useState("");
  const [address, setAddress] = useState("");
  const [reason, setReason] = useState("");
  const [preservation, setPreservation] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const incPg = usePager(queueQ.data ?? [], 10); // лог постранично, чтобы не уходил в бесконечность

  const req = REQUIRES[action];
  const canApply =
    (!req.channel || channelId.trim() !== "") && (!req.address || address.trim() !== "");

  // channelId → @handle (читаемо).
  const handleFor = (id: string): string => {
    const ch = (channelsQ.data ?? []).find((c) => c.id === id);
    return ch ? `@${ch.handle}` : id;
  };

  // «Разобрать»: подставить цель инцидента в форму действия и проскроллить к ней.
  function fillFromIncident(inc: IncidentLog) {
    if (inc.channelId) setChannelId(inc.channelId);
    if (inc.address) setAddress(inc.address);
    if (inc.kind === "hard_block" || inc.kind === "sanction_hit") setAction("SUSPEND_CHANNEL");
    document.getElementById("ops-action")?.scrollIntoView({ behavior: "smooth", block: "start" });
    toast({ title: "Цель подставлена в форму", description: "Проверь действие и применяй." });
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
          toast({ variant: "success", title: "Действие применено", description: action });
          setConfirmOpen(false);
        },
        onError: (e) => toast({ variant: "error", title: "Ошибка", description: String(e) }),
      },
    );
  }

  // Гейт доступа: консоль T&S видна ТОЛЬКО оператору. Прочие действия и так блокирует сервер (requireOperator),
  // но и саму консоль не показываем. (Источник истины — getSession.isOperator по проверенному адресу.)
  if (sessionQ.isLoading) return <Skeleton className="h-64 w-full rounded-lg" />;
  if (!sessionQ.data?.isOperator) {
    return (
      <EmptyState
        title="Доступ только для оператора"
        description="Консоль T&S доступна лишь кошельку-оператору платформы. Войди кошельком оператора."
        action={<ConnectWalletButton />}
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-display-l text-fg">Консоль оператора / T&amp;S</h1>
        <p className="text-fg-muted">
          Платформенный уровень: то, что не может стример. ADMIN_VOID — единственное списание репутации.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-h2 text-fg">Лестница наказаний</h2>
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
        <h2 className="text-h2 text-fg">Применить действие</h2>
        <div className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2">
          <Select label="Действие" value={action} onChange={(e) => setAction(e.target.value as PenaltyAction)}>
            {ACTIONS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </Select>
          <Input label="Причина" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="CSAM / flood / sanctions" />
          {req.channel ? (
            <Select label="Канал" value={channelId} onChange={(e) => setChannelId(e.target.value)}>
              <option value="">— выбери канал —</option>
              {(channelsQ.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  @{c.handle} · {c.status}
                </option>
              ))}
            </Select>
          ) : null}
          {req.address ? (
            <Input
              label="Адрес кошелька"
              mono
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="вставь base58-адрес"
            />
          ) : null}
          <Switch checked={preservation} onCheckedChange={setPreservation} label="Preservation + репорт (NCMEC)" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="danger" disabled={!canApply} onClick={() => setConfirmOpen(true)}>
            Применить действие
          </Button>
          {!canApply ? (
            <span className="text-small text-fg-faint">
              Укажи цель: {[req.channel && "канал", req.address && "адрес кошелька"].filter(Boolean).join(" + ")}
            </span>
          ) : null}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-h2 text-fg">Инцидент-лог</h2>
        {queueQ.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : queueQ.error ? (
          <ErrorState onRetry={() => queueQ.refetch()} />
        ) : (queueQ.data ?? []).length === 0 ? (
          <EmptyState title="Инцидентов нет" />
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
                    Разобрать →
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
            <DialogTitle>Подтверждение действия</DialogTitle>
            <DialogDescription>
              {ACTIONS.find((a) => a.value === action)?.label}. Деструктивные действия записываются в
              инцидент-лог.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" disabled={apply.isPending}>
                Отмена
              </Button>
            </DialogClose>
            <Button variant="danger" loading={apply.isPending} onClick={doApply}>
              Применить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
