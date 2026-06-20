"use client";

import { useEffect, useState } from "react";
import { TierEditor } from "@/components/domain/settings";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { useChannelConfig, useMyChannel, useUpdateConfig } from "@/lib/data/hooks";
import { fromMicro, toMicro } from "@/lib/utils";
import type { ChannelConfig, ConfigPatch, ModeratorRef, OverlaySettings, Tier } from "@/lib/data/types";

interface Draft {
  tiers: Tier[];
  minDonation: bigint;
  minDonationWithText: bigint;
  messageMaxLen: number;
  profanityPolicy: ChannelConfig["profanityPolicy"];
  nameMode: ChannelConfig["nameMode"];
  textShowMode: ChannelConfig["textShowMode"];
  overlay: OverlaySettings;
  moderators: ModeratorRef[];
}

function deriveDraft(c: ChannelConfig): Draft {
  return {
    tiers: c.tiers,
    minDonation: c.minDonation,
    minDonationWithText: c.minDonationWithText,
    messageMaxLen: c.messageMaxLen,
    profanityPolicy: c.profanityPolicy,
    nameMode: c.nameMode,
    textShowMode: c.textShowMode,
    overlay: c.overlay,
    moderators: c.moderators,
  };
}

const enc = (v: unknown) =>
  JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? `__b${val}` : val));
const eq = (a: unknown, b: unknown) => enc(a) === enc(b);

function buildPatch(draft: Draft, original: ChannelConfig): ConfigPatch {
  const patch: ConfigPatch = {};
  if (!eq(draft.tiers, original.tiers)) patch.tiers = draft.tiers;
  if (draft.minDonation !== original.minDonation) patch.minDonation = draft.minDonation;
  if (draft.minDonationWithText !== original.minDonationWithText)
    patch.minDonationWithText = draft.minDonationWithText;
  if (draft.messageMaxLen !== original.messageMaxLen) patch.messageMaxLen = draft.messageMaxLen;
  if (draft.profanityPolicy !== original.profanityPolicy) patch.profanityPolicy = draft.profanityPolicy;
  if (draft.nameMode !== original.nameMode) patch.nameMode = draft.nameMode;
  if (draft.textShowMode !== original.textShowMode) patch.textShowMode = draft.textShowMode;
  if (!eq(draft.overlay, original.overlay)) patch.overlay = draft.overlay;
  if (!eq(draft.moderators, original.moderators)) patch.moderators = draft.moderators;
  return patch;
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

      <Section title="Тиры и пороги участия">
        <p className="text-small text-fg-muted">
          Репутация начисляется фиксированно: <span className="mono">1 USDC = 100 очков</span>. Здесь ты
          задаёшь пороги в очках — сколько нужно для тира, перков и участия в мини-играх.
        </p>
        <TierEditor value={draft.tiers} onChange={(t) => set("tiers", t)} />
      </Section>

      <Section title="Донаты">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Минимум доната, USDC"
            mono
            value={String(fromMicro(draft.minDonation))}
            onChange={(e) => set("minDonation", toMicro(Number(e.target.value) || 0))}
          />
          <Input
            label="Минимум доната с текстом, USDC"
            mono
            value={String(fromMicro(draft.minDonationWithText))}
            onChange={(e) => set("minDonationWithText", toMicro(Number(e.target.value) || 0))}
          />
          <Input
            label="Лимит длины сообщения"
            mono
            value={String(draft.messageMaxLen)}
            onChange={(e) => set("messageMaxLen", Number(e.target.value) || 0)}
          />
          <Select
            label="Профанити-политика"
            value={draft.profanityPolicy}
            onChange={(e) => set("profanityPolicy", e.target.value as Draft["profanityPolicy"])}
          >
            <option value="mask">Маскировать</option>
            <option value="hide">Скрыть</option>
            <option value="queue">В очередь</option>
          </Select>
        </div>
      </Section>

      <Section title="Имена и показ текста">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Режим имён"
            value={draft.nameMode}
            onChange={(e) => set("nameMode", e.target.value as Draft["nameMode"])}
          >
            <option value="addresses_only">Только адреса</option>
            <option value="allow_display_names">Разрешить display_name</option>
          </Select>
          <Select
            label="Показ текста"
            value={draft.textShowMode}
            onChange={(e) => set("textShowMode", e.target.value as Draft["textShowMode"])}
          >
            <option value="manual">Ручное одобрение</option>
            <option value="auto_if_clean">Авто-показ если чисто</option>
          </Select>
        </div>
        {draft.textShowMode === "auto_if_clean" ? (
          <p className="text-small text-fg-faint">
            Hard-block-категории не авто-показываются никогда.
          </p>
        ) : null}
      </Section>

      <Section title="Оверлей / алерты">
        <div className="flex flex-col gap-3">
          <Input
            label="Мин. сумма показа, USDC"
            mono
            value={String(fromMicro(draft.overlay.minAmountToShow))}
            onChange={(e) =>
              set("overlay", { ...draft.overlay, minAmountToShow: toMicro(Number(e.target.value) || 0) })
            }
          />
          <Switch
            checked={draft.overlay.sound}
            onCheckedChange={(v) => set("overlay", { ...draft.overlay, sound: v })}
            label="Звук алертов"
          />
          <Switch
            checked={draft.overlay.tts}
            onCheckedChange={(v) => set("overlay", { ...draft.overlay, tts: v })}
            label="TTS (озвучка сообщений)"
          />
        </div>
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
              <span className="text-small text-fg-muted">{m.scope}</span>
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
        <Select label="Скоуп" value={scope} onChange={(e) => setScope(e.target.value as ModeratorRef["scope"])}>
          <option value="queue">queue</option>
          <option value="queue_and_block">queue_and_block</option>
        </Select>
        <Button
          variant="secondary"
          onClick={() => {
            if (address.trim().length < 32) return;
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
