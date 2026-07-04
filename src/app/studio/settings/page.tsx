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
import { IS_CHAIN, IS_ICP } from "@/lib/chain/addresses";
import type { DisputeParamsValues } from "@/lib/chain/dispute-params";
import { CHANNEL_DESC_MAX } from "@/lib/channel-links";
import {
  useAttestPayout,
  useChannelConfig,
  useDisputeParams,
  useMyChannel,
  useSetDisputeParams,
  useUpdateConfig,
} from "@/lib/data/hooks";
import { fromMicro, isLikelyBase58Address, toMicro } from "@/lib/utils";
import type { Channel, ChannelConfig, ConfigPatch, ModeratorRef, Tier } from "@/lib/data/types";

interface Draft {
  description: string;
  tiers: Tier[];
  minDonation: bigint;
  minDonationWithText: bigint;
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
  if ((ds || undefined) !== (original.description || undefined))
    patch.description = ds || undefined;
  if (!eq(draft.tiers, original.tiers)) patch.tiers = draft.tiers;
  if (draft.minDonation !== original.minDonation) patch.minDonation = draft.minDonation;
  if (draft.minDonationWithText !== original.minDonationWithText)
    patch.minDonationWithText = draft.minDonationWithText;
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
    return (
      <ErrorState description="Не удалось загрузить конфиг." onRetry={() => configQ.refetch()} />
    );
  }

  const patch = buildPatch(draft, config);
  const dirty = Object.keys(patch).length > 0;
  const set = <K extends keyof Draft>(key: K, val: Draft[K]) =>
    setDraft({ ...draft, [key]: val } as Draft);

  function save() {
    update.mutate(patch, {
      onSuccess: () => toast({ variant: "success", title: "Сохранено" }),
      onError: (e) =>
        toast({ variant: "error", title: "Ошибка сохранения", description: String(e) }),
    });
  }

  return (
    <div className="flex flex-col gap-8 pb-24">
      <h1 className="text-display-l text-fg">Настройки канала</h1>

      {IS_CHAIN && myChannelQ.data ? <PayoutAttestationSection channel={myChannelQ.data} /> : null}

      <Section title="Описание канала">
        <p className="text-small text-fg-muted">
          Имя канала и ссылки берутся из твоего{" "}
          <Link href="/me/profile" className="text-info hover:underline">
            профиля
          </Link>{" "}
          — один ник и один набор ссылок на человека. Здесь — только описание канала (тэглайн); оно
          видно на странице канала и модерируется как UGC (мат — ок, запрещёнка — нет).
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
          Репутация начисляется фиксированно: <span className="mono">1 USDC = 1 очко</span>. Здесь
          ты задаёшь пороги в очках — сколько нужно для тира, перков и участия в мини-играх.
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

      {IS_ICP && myChannelQ.data ? <DisputeParamsSection channelId={myChannelQ.data.id} /> : null}

      {dirty ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface-raised">
          <div className="mx-auto flex max-w-content items-center justify-between gap-3 px-4 py-3">
            <span className="text-small text-fg-muted">Несохранённые изменения</span>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() => setDraft(deriveDraft(config))}
                disabled={update.isPending}
              >
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

/**
 * H1: payout-адрес считается доверенным только с ed25519-подписью владельца — её проверяет кошелёк
 * каждого донора перед отправкой денег (сервер не источник истины). Без подписи донаты на канал
 * приостановлены (см. DonateWidget), поэтому секция стоит первой и просит одну подпись (без газа).
 */
function PayoutAttestationSection({ channel }: { channel: Channel }) {
  const attest = useAttestPayout();
  const attested = Boolean(channel.payoutAttestation);
  return (
    <Section title="Адрес выплат">
      <div className="flex flex-col gap-3">
        <p className="text-small text-fg-muted">
          Донаты идут напрямую на этот адрес. Подпись кошелька закрепляет его за тобой: донор
          проверяет её перед отправкой, и никто (включая площадку) не может тихо подменить адрес.
        </p>
        <span className="mono text-small text-fg">{channel.payoutAddress}</span>
        {attested ? (
          <p className="text-small text-success">
            Подтверждён подписью владельца — донаты открыты.
          </p>
        ) : (
          <div className="flex flex-col items-start gap-2">
            <p className="text-small text-danger">
              Не подтверждён — донаты на канал приостановлены, пока адрес не закреплён подписью.
            </p>
            <Button
              variant="money"
              loading={attest.isPending}
              onClick={() =>
                attest.mutate(channel.id, {
                  onSuccess: () => toast({ variant: "success", title: "Адрес выплат подтверждён" }),
                  onError: (e) =>
                    toast({
                      variant: "error",
                      title: "Подпись не принята",
                      description: e instanceof Error ? e.message : String(e),
                    }),
                })
              }
            >
              Подписать адрес выплат
            </Button>
            <p className="text-small text-fg-faint">
              Это подпись сообщения, не транзакция: деньги не двигаются, газ не списывается.
            </p>
          </div>
        )}
      </div>
    </Section>
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

/**
 * Governance-параметры споров (миграция M1, ADR 0021) — живут в core-канистре ICP, НЕ на сервере.
 * Меняются только подписью кошелька владельца и вступают с таймлоком (идущие споры — по прежним
 * правилам). Черновик — в человеческих единицах (очки/минуты/USDC), micro — на границе.
 */
interface ParamsDraft {
  minRep: string;
  minWeight: string;
  quorumK: string;
  disputeMin: string;
  votingMin: string;
  dMax: string;
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
      quorumK: String(e.quorumCoefficientMilli / 1000),
      disputeMin: String(e.disputeWindowSecs / 60),
      votingMin: String(e.votingWindowSecs / 60),
      dMax: String(fromMicro(e.dMaxMicro)),
    });
  }, [info?.version, info?.channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (paramsQ.error) {
    return (
      <Section title="Параметры споров (канистра)">
        <ErrorState
          description={`Канистра недоступна: ${paramsQ.error instanceof Error ? paramsQ.error.message : String(paramsQ.error)}`}
          onRetry={() => paramsQ.refetch()}
        />
      </Section>
    );
  }
  if (!info || !draft) {
    return (
      <Section title="Параметры споров (канистра)">
        <Skeleton className="h-32 w-full rounded-lg" />
      </Section>
    );
  }

  const num = (s: string) => Number(s.replace(",", "."));
  const valid =
    Number.isFinite(num(draft.minRep)) &&
    Number.isFinite(num(draft.minWeight)) &&
    num(draft.quorumK) > 0 &&
    num(draft.disputeMin) >= 1 &&
    num(draft.votingMin) >= 1 &&
    Number.isFinite(num(draft.dMax));

  function submit() {
    const params: DisputeParamsValues = {
      minReputationToDisputeMicro: toMicro(num(draft!.minRep)),
      minWeightToVoteMicro: toMicro(num(draft!.minWeight)),
      quorumCoefficientMilli: Math.round(num(draft!.quorumK) * 1000),
      disputeWindowSecs: Math.round(num(draft!.disputeMin) * 60),
      votingWindowSecs: Math.round(num(draft!.votingMin) * 60),
      dMaxMicro: toMicro(num(draft!.dMax)),
    };
    save.mutate(
      { channelId, params },
      {
        onSuccess: (r) =>
          toast({
            variant: "success",
            title: "Правила отправлены в канистру",
            description: r.pending
              ? `Вступят ${new Date(r.pending.effectiveAtMs).toLocaleString("ru-RU")} (таймлок).`
              : undefined,
          }),
        onError: (e) =>
          toast({
            variant: "error",
            title: "Канистра не приняла запись",
            description: e instanceof Error ? e.message : String(e),
          }),
      },
    );
  }

  return (
    <Section title="Параметры споров (канистра)">
      <p className="text-small text-fg-muted">
        Правила споров по заданиям-донатам хранятся в канистре ICP, а не у площадки: изменить их
        может только подпись твоего кошелька, и вступают они с таймлоком — идущие споры играются по
        прежним правилам. Площадка подкрутить эти параметры не может.
      </p>
      {info.pending ? (
        <p className="text-small text-info">
          Ожидает вступления (версия {info.pending.version}):{" "}
          {new Date(info.pending.effectiveAtMs).toLocaleString("ru-RU")}. До этого действуют прежние
          правила.
        </p>
      ) : info.isDefault ? (
        <p className="text-small text-fg-faint">
          Действуют дефолтные правила — канал ничего не менял.
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Порог репутации для открытия спора, очки"
          mono
          value={draft.minRep}
          onChange={(e) => setDraft({ ...draft, minRep: e.target.value })}
        />
        <Input
          label="Минимальный вес присяжного, очки"
          mono
          value={draft.minWeight}
          onChange={(e) => setDraft({ ...draft, minWeight: e.target.value })}
        />
        <Input
          label="Кворум-коэффициент K (кворум = K·√USDC)"
          mono
          value={draft.quorumK}
          onChange={(e) => setDraft({ ...draft, quorumK: e.target.value })}
        />
        <Input
          label="Потолок суммы задания, USDC (0 — без потолка)"
          mono
          value={draft.dMax}
          onChange={(e) => setDraft({ ...draft, dMax: e.target.value })}
        />
        <Input
          label="Окно «поднять спор», минут"
          mono
          value={draft.disputeMin}
          onChange={(e) => setDraft({ ...draft, disputeMin: e.target.value })}
        />
        <Input
          label="Окно голосования, минут"
          mono
          value={draft.votingMin}
          onChange={(e) => setDraft({ ...draft, votingMin: e.target.value })}
        />
      </div>
      <div className="flex flex-col items-start gap-2">
        <Button variant="money" loading={save.isPending} disabled={!valid} onClick={submit}>
          Подписать и отправить в канистру
        </Button>
        <p className="text-small text-fg-faint">
          Это подпись сообщения, не транзакция: деньги не двигаются, газ не списывается. Версия
          правил: {info.version}.
        </p>
      </div>
    </Section>
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
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onChange(value.filter((_, idx) => idx !== i))}
              >
                ✕
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            label="Адрес модератора"
            mono
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </div>
        <Select
          label="Права"
          value={scope}
          onChange={(e) => setScope(e.target.value as ModeratorRef["scope"])}
        >
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
