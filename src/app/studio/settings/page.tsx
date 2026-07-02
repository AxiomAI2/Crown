"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TierEditor } from "@/components/domain/settings";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { CHANNEL_DESC_MAX } from "@/lib/channel-links";
import { useChannelConfig, useMyChannel, useUpdateConfig } from "@/lib/data/hooks";
import { fromMicro, isLikelyBase58Address, toMicro } from "@/lib/utils";
import type { ChannelConfig, ConfigPatch, ModeratorRef, Tier } from "@/lib/data/types";

interface Draft {
  description: string;
  tiers: Tier[];
  minDonation: bigint;
  minDonationWithText: bigint;
  minReputationToTask: number;
  minReputationToDispute: number;
  messageMaxLen: number;
  nameMode: ChannelConfig["nameMode"];
  textShowMode: ChannelConfig["textShowMode"];
  moderators: ModeratorRef[];
}

function deriveDraft(c: ChannelConfig): Draft {
  return {
    description: c.description ?? "",
    tiers: c.tiers,
    minDonation: c.minDonation,
    minDonationWithText: c.minDonationWithText,
    minReputationToTask: c.minReputationToTask,
    minReputationToDispute: c.minReputationToDispute,
    messageMaxLen: c.messageMaxLen,
    nameMode: c.nameMode,
    textShowMode: c.textShowMode,
    moderators: c.moderators,
  };
}

const enc = (v: unknown) =>
  JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? `__b${val}` : val));
const eq = (a: unknown, b: unknown) => enc(a) === enc(b);

function buildPatch(draft: Draft, original: ChannelConfig): ConfigPatch {
  const patch: ConfigPatch = {};
  const ds = draft.description.trim();
  if ((ds || undefined) !== (original.description || undefined)) patch.description = ds || undefined;
  if (!eq(draft.tiers, original.tiers)) patch.tiers = draft.tiers;
  if (draft.minDonation !== original.minDonation) patch.minDonation = draft.minDonation;
  if (draft.minDonationWithText !== original.minDonationWithText)
    patch.minDonationWithText = draft.minDonationWithText;
  if (draft.minReputationToTask !== original.minReputationToTask)
    patch.minReputationToTask = draft.minReputationToTask;
  if (draft.minReputationToDispute !== original.minReputationToDispute)
    patch.minReputationToDispute = draft.minReputationToDispute;
  if (draft.messageMaxLen !== original.messageMaxLen) patch.messageMaxLen = draft.messageMaxLen;
  if (draft.nameMode !== original.nameMode) patch.nameMode = draft.nameMode;
  if (draft.textShowMode !== original.textShowMode) patch.textShowMode = draft.textShowMode;
  if (!eq(draft.moderators, original.moderators)) patch.moderators = draft.moderators;
  return patch;
}

/**
 * Поле суммы в USDC: держит СЫРУЮ строку (чтобы можно было набрать «0.», «0.5» — иначе round-trip через
 * Number→toMicro→fromMicro съедал бы дробную точку на каждом нажатии). В micro отдаёт только валидное число.
 */
function UsdcAmountInput({
  label,
  micro,
  onMicro,
}: {
  label: string;
  micro: bigint;
  onMicro: (v: bigint) => void;
}) {
  const [str, setStr] = useState(String(fromMicro(micro)));
  return (
    <Input
      label={label}
      mono
      inputMode="decimal"
      value={str}
      onChange={(e) => {
        const s = e.target.value;
        setStr(s);
        const n = Number(s);
        if (s.trim() !== "" && Number.isFinite(n) && n >= 0) onMicro(toMicro(n));
      }}
    />
  );
}

export default function ChannelSettingsPage() {
  const myChannelQ = useMyChannel();
  const channelId = myChannelQ.data?.id;
  const configQ = useChannelConfig(channelId);
  const config = configQ.data;
  const update = useUpdateConfig(channelId ?? "");

  const [draft, setDraft] = useState<Draft | null>(null);

  // Инициализация/сброс черновика при загрузке и после сохранения (version/updatedAt меняются).
  useEffect(() => {
    if (config) setDraft(deriveDraft(config));
  }, [config?.version, config?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  if (myChannelQ.isLoading || configQ.isLoading || !draft) {
    if (!channelId && !myChannelQ.isLoading) return <EmptyState title="Сначала создай канал" />;
    return <Skeleton className="h-96 w-full rounded-lg" />;
  }
  if (configQ.error || !config) {
    return <ErrorState description="Не удалось загрузить конфиг." onRetry={() => configQ.refetch()} />;
  }

  const patch = buildPatch(draft, config);
  const dirty = Object.keys(patch).length > 0;
  const set = <K extends keyof Draft>(key: K, val: Draft[K]) =>
    setDraft({ ...draft, [key]: val } as Draft);

  function save() {
    update.mutate(patch, {
      onSuccess: () => toast({ variant: "success", title: "Сохранено" }),
      onError: (e) => toast({ variant: "error", title: "Ошибка сохранения", description: String(e) }),
    });
  }

  return (
    <div className="flex flex-col gap-8 pb-24">
      <h1 className="text-display-l text-fg">Настройки канала</h1>

      <Section title="Описание канала">
        <p className="text-small text-fg-muted">
          Имя канала и ссылки берутся из твоего{" "}
          <Link href="/me/profile" className="text-info hover:underline">
            профиля
          </Link>{" "}
          — один ник и один набор ссылок на человека. Здесь — только описание канала (тэглайн); оно видно
          на странице канала и модерируется как UGC (мат — ок, запрещёнка — нет).
        </p>
        <Textarea
          label="Описание"
          maxLength={CHANNEL_DESC_MAX}
          showCount
          value={draft.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </Section>

      <Section title="Тиры и пороги участия">
        <p className="text-small text-fg-muted">
          Репутация начисляется фиксированно: <span className="mono">1 USDC = 1 очко</span>. Здесь ты
          задаёшь пороги в очках — сколько нужно для тира, перков и участия в мини-играх.
        </p>
        <TierEditor value={draft.tiers} onChange={(t) => set("tiers", t)} />
      </Section>

      <Section title="Донаты">
        <div className="grid gap-4 sm:grid-cols-2">
          <UsdcAmountInput
            label="Минимум доната, USDC"
            micro={draft.minDonation}
            onMicro={(v) => set("minDonation", v)}
          />
          <UsdcAmountInput
            label="Минимум доната с текстом, USDC"
            micro={draft.minDonationWithText}
            onMicro={(v) => set("minDonationWithText", v)}
          />
          <Input
            label="Лимит длины сообщения"
            mono
            value={String(draft.messageMaxLen)}
            onChange={(e) => set("messageMaxLen", Number(e.target.value) || 0)}
          />
        </div>
      </Section>

      <Section title="Задания и споры (пороги репутации)">
        <p className="text-small text-fg-muted">
          Репутация набирается донатами. Пороги отсекают нулевые кошельки: чтобы прислать задание или
          поднять спор, нужен статус — то есть реально поддержанный канал. 0 — без порога.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Мин. репутация для задания, очков"
            mono
            value={String(draft.minReputationToTask)}
            onChange={(e) => set("minReputationToTask", Math.max(0, Number(e.target.value) || 0))}
          />
          <Input
            label="Порог репутации для спора, очков"
            mono
            value={String(draft.minReputationToDispute)}
            onChange={(e) => set("minReputationToDispute", Math.max(0, Number(e.target.value) || 0))}
          />
        </div>
        <p className="text-small text-fg-faint">
          Высокий порог спора = меньше троллинга, но и меньше возможности оспорить. Совсем большой порог
          фактически отключает споры на канале — доноры это увидят.
        </p>
      </Section>

      <Section title="Имена и показ текста">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Режим имён"
            value={draft.nameMode}
            onChange={(e) => set("nameMode", e.target.value as Draft["nameMode"])}
          >
            <option value="addresses_only">Только адреса</option>
            <option value="allow_display_names">Разрешить имена</option>
          </Select>
          <Select
            label="Показ текста"
            value={draft.textShowMode}
            onChange={(e) => set("textShowMode", e.target.value as Draft["textShowMode"])}
          >
            <option value="manual">Ручное одобрение</option>
            <option value="auto_if_clean">Авто-показ</option>
          </Select>
        </div>
        {draft.textShowMode === "auto_if_clean" ? (
          <p className="text-small text-fg-faint">
            Hard-block-категории не авто-показываются никогда.
          </p>
        ) : null}
      </Section>

      <Section title="Модераторы">
        <ModeratorEditor value={draft.moderators} onChange={(m) => set("moderators", m)} />
      </Section>

      {dirty ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface-raised">
          <div className="mx-auto flex max-w-content items-center justify-between gap-3 px-4 py-3">
            <span className="text-small text-fg-muted">Несохранённые изменения</span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setDraft(deriveDraft(config))} disabled={update.isPending}>
                Отменить
              </Button>
              <Button variant="money" onClick={save} loading={update.isPending}>
                Сохранить
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t border-border pt-6 first:border-t-0 first:pt-0">
      <h2 className="text-h2 text-fg">{title}</h2>
      {children}
    </section>
  );
}

// Человекочитаемые подписи прав модератора (значения "queue"/"queue_and_block" — это данные, их не трогаем).
const SCOPE_LABEL: Record<ModeratorRef["scope"], string> = {
  queue: "Модерация очереди",
  queue_and_block: "Очередь и блокировки",
};

function ModeratorEditor({
  value,
  onChange,
}: {
  value: ModeratorRef[];
  onChange: (m: ModeratorRef[]) => void;
}) {
  const [address, setAddress] = useState("");
  const [scope, setScope] = useState<ModeratorRef["scope"]>("queue");
  return (
    <div className="flex flex-col gap-3">
      {value.length === 0 ? (
        <p className="text-small text-fg-faint">Модераторов пока нет.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {value.map((m, i) => (
            <li
              key={m.address}
              className="flex items-center justify-between gap-2 rounded border border-border bg-surface px-3 py-2"
            >
              <span className="mono text-small text-fg">{m.address.slice(0, 10)}…</span>
              <span className="text-small text-fg-muted">{SCOPE_LABEL[m.scope]}</span>
              <Button variant="ghost" size="sm" onClick={() => onChange(value.filter((_, idx) => idx !== i))}>
                ✕
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input label="Адрес модератора" mono value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <Select label="Права" value={scope} onChange={(e) => setScope(e.target.value as ModeratorRef["scope"])}>
          <option value="queue">{SCOPE_LABEL.queue}</option>
          <option value="queue_and_block">{SCOPE_LABEL.queue_and_block}</option>
        </Select>
        <Button
          variant="secondary"
          onClick={() => {
            if (!isLikelyBase58Address(address.trim())) return;
            onChange([...value, { address: address.trim(), scope }]);
            setAddress("");
          }}
        >
          Добавить
        </Button>
      </div>
    </div>
  );
}
