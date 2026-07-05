"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Amount } from "./amount";
import { ChannelLinkButtons } from "./channel-links";
import { inputsFromLinks, LinkEditor, type LinkInputs, linksFromInputs } from "./link-editor";
import { OpenCycles } from "./open-cycles";
import { TierBadge } from "./standing";
import { CumulativeAreaChart, RangeTabs, type ChartRange } from "./area-chart";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/feedback";
import {
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  PencilIcon,
  SearchIcon,
} from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useCopied } from "@/components/ui/use-copied";
import { explorerTxUrl } from "@/lib/chain/addresses";
import { useDonorOverview, useProfile, useUpdateProfile } from "@/lib/data/hooks";
import type { Donation, DonorChannelStanding, DonorOverview, DonorPointEvent } from "@/lib/data/types";
import {
  channelHue,
  cn,
  collapseWhitespace,
  formatPoints,
  formatUSDCNumber,
  fromMicro,
  plural,
  timeAgo,
} from "@/lib/utils";

const DONATIONS = ["донат", "доната", "донатов"] as const;
const CHANNELS = ["канал", "канала", "каналов"] as const;
const POINTS = ["очко", "очка", "очков"] as const;

/** Аватар профиля: монограмма со стабильным цветом по имени/адресу (картинок нет — §профиль). */
export function ProfileAvatar({ name, address }: { name?: string; address: string }) {
  const seed = name?.trim() || address;
  const initial = seed.replace(/^@/, "").slice(0, 1).toUpperCase();
  const hue = channelHue(seed);
  return (
    <div
      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full font-display text-h3"
      style={{ backgroundColor: `hsl(${hue} 45% 20%)`, color: `hsl(${hue} 70% 72%)` }}
    >
      {initial}
    </div>
  );
}

// — Аналог polymarket-профиля в нашем контексте: деньги (донаты) агрегируемы, репутация — ПОканальная
//   (инвариант §4.3, глобального рейтинга нет). Headline + график = «всего задонатил» во времени;
//   «позиции» = standing по каналам; «активность» = история донатов.

function monthYear(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
}

/** Кнопка-иконка «скопировать» (адрес / ссылка) с галочкой-подтверждением. */
function CopyIconButton({ value, title }: { value: string; title: string }) {
  const [copied, markCopied] = useCopied();
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          markCopied();
          toast({ variant: "success", title: "Скопировано" });
        } catch {
          toast({ variant: "error", title: "Не удалось скопировать" });
        }
      }}
    >
      {copied ? <CheckIcon className="h-[18px] w-[18px]" /> : <CopyIcon className="h-[18px] w-[18px]" />}
    </button>
  );
}

/**
 * Био профиля: одна строка — текст обрезается многоточием, «…ещё» стоит инлайн справа на той же строке
 * (не растит карточку и соседнюю по сетке). Клик по «…ещё» открывает окно с полным описанием.
 */
function ProfileBio({ bio }: { bio: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [clamped, setClamped] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setClamped(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [bio]);

  return (
    <div className="flex w-full items-baseline gap-1">
      <span ref={ref} className="min-w-0 truncate text-small text-fg-muted">
        {bio}
      </span>
      {clamped ? (
        <Dialog>
          <DialogTrigger asChild>
            <button
              type="button"
              className="shrink-0 text-small text-fg-faint transition-colors hover:text-fg"
            >
              …ещё
            </button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>О себе</DialogTitle>
            </DialogHeader>
            <p className="whitespace-pre-wrap break-words text-body text-fg-muted">{bio}</p>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

/** Карандашик → диалог редактирования своего профиля (ник, о себе, ссылки). Та же форма, что и /me/profile. */
function ProfileEditDialog({ address }: { address: string }) {
  const profileQ = useProfile(address || null);
  const update = useUpdateProfile();
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [linkInputs, setLinkInputs] = useState<LinkInputs>([]);

  // Префилл из профиля; перечитываем при открытии (на случай правок в другой вкладке).
  useEffect(() => {
    const p = profileQ.data;
    if (p && open) {
      setDisplayName(p.displayName ?? "");
      setBio(p.bio ?? "");
      setLinkInputs(inputsFromLinks(p.links));
    }
  }, [profileQ.data, open]);

  function save() {
    update.mutate(
      {
        displayName: displayName.trim() || undefined,
        bio: bio.trim() || undefined,
        links: linksFromInputs(linkInputs),
      },
      {
        onSuccess: () => {
          toast({ variant: "success", title: "Профиль сохранён" });
          setOpen(false);
        },
        onError: (e) => toast({ variant: "error", title: "Ошибка", description: String(e) }),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          title="Редактировать профиль"
          aria-label="Редактировать профиль"
          className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
        >
          <PencilIcon className="h-[18px] w-[18px]" />
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Редактирование профиля</DialogTitle>
          <DialogDescription>
            Ник, аватар и ссылки видны в ленте, лидерборде и на этом профиле. Профиль необязателен.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Input
            label="Имя"
            maxLength={40}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <Textarea
            label="О себе"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={280}
            showCount
          />
          <div className="flex flex-col gap-2">
            <span className="text-small text-fg-muted">Ссылки</span>
            <LinkEditor value={linkInputs} onChange={setLinkInputs} />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={update.isPending}>
              Отмена
            </Button>
          </DialogClose>
          <Button onClick={save} loading={update.isPending}>
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


// Подпись под графиком для выбранного окна.
const RANGE_CAPTION: Record<ChartRange, string> = {
  "1D": "за день",
  "1W": "за неделю",
  "1M": "за месяц",
  "1Y": "за год",
  ALL: "за всё время",
};

/**
 * Кумулятивный график «всего задонатил» — общий компонент (area-chart): равномерные ступени по донатам,
 * резкий скачок на каждый донат. Здесь только конвертируем донаты → события (t, прибавка в USDC).
 */
function DonationsAreaChart({ donations, range }: { donations: Donation[]; range: ChartRange }) {
  const events = useMemo(
    () => donations.map((d) => ({ t: Date.parse(d.ts), v: fromMicro(d.amount) })),
    [donations],
  );
  return (
    <CumulativeAreaChart
      events={events}
      range={range}
      formatValue={formatUSDCNumber}
      emptyHint="Пока нет донатов — график появится после первого."
    />
  );
}

/** Строка-позиция: канал + тир + локальные очки + задонатил. Кликабельна → страница канала. */
function PositionRow({ s }: { s: DonorChannelStanding }) {
  const name = s.channelName?.trim() || `@${s.handle}`;
  const hue = channelHue(name);
  return (
    <Link
      href={`/c/${s.handle}`}
      className="group flex items-center gap-3 border-b border-border py-3"
    >
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-display text-small"
        style={{ backgroundColor: `hsl(${hue} 45% 20%)`, color: `hsl(${hue} 70% 72%)` }}
      >
        {name.replace(/^@/, "")[0]?.toUpperCase() ?? "?"}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-display text-fg transition-colors group-hover:text-status">{name}</div>
        <div className="mono truncate text-small text-fg-faint">@{s.handle}</div>
      </div>
      <div className="hidden shrink-0 sm:block">
        {s.tier ? <TierBadge tier={s.tier} /> : null}
      </div>
      <div className="hidden min-w-[5rem] shrink-0 flex-col items-end sm:flex">
        <span className="mono whitespace-nowrap text-fg">{formatPoints(s.points)}</span>
        <span className="text-small text-fg-faint">{plural(s.points, POINTS)}</span>
      </div>
      <div className="flex min-w-[6rem] shrink-0 flex-col items-end">
        <Amount micro={s.totalDonated} variant="money" className="whitespace-nowrap" />
        <span className="text-small text-fg-faint">задонатил</span>
      </div>
    </Link>
  );
}

/** Строка журнала очков: канал + «за что» (донат / задание / исход спора) + знаковая дельта очков. */
const EVENT_LABEL: Record<DonorPointEvent["type"], string> = {
  DONATION: "Донат",
  GAME_DONATION: "Задание-донат выполнено",
  DISPUTE_WON: "Выигранный спор",
  DISPUTE_LOST: "Проигранный ложный спор",
};

function ActivityRow({
  e,
  handle,
  channelName,
}: {
  e: DonorPointEvent;
  handle?: string;
  channelName?: string;
}) {
  const shown = e.message?.state === "SHOWN";
  const delta = e.pointsDelta;
  const negative = delta < 0;
  return (
    <div className="flex flex-col gap-2 border-b border-border py-3">
      <div className="flex items-center justify-between gap-2">
        {handle ? (
          <Link href={`/c/${handle}`} className="min-w-0 truncate text-small text-fg hover:text-status">
            {channelName?.trim() ? channelName : `@${handle}`}
            {channelName?.trim() ? <span className="mono text-fg-faint"> · @{handle}</span> : null}
          </Link>
        ) : (
          <span className="mono min-w-0 truncate text-small text-fg-faint">{e.channelId}</span>
        )}
        {/* знаковая дельта: рост — money-green, протокольное списание (DISPUTE_LOST) — danger */}
        <span
          className="mono shrink-0 text-small font-medium"
          style={{ color: negative ? "var(--danger)" : "var(--money)" }}
        >
          {negative ? "−" : "+"}
          {formatPoints(Math.abs(delta))} {plural(Math.abs(delta), POINTS)}
        </span>
      </div>

      {/* за что: денежные события — с суммой; исходы споров — только подпись */}
      <div className="flex items-center gap-1.5 text-small text-fg-muted">
        <span>{EVENT_LABEL[e.type] ?? e.type}</span>
        {e.amount > 0n ? <Amount micro={e.amount} variant="money" /> : null}
      </div>
      {shown && e.message ? (
        <p className="break-words text-body text-fg">{collapseWhitespace(e.message.text)}</p>
      ) : null}

      <div className="flex items-center gap-2 text-small text-fg-faint">
        <span title={e.ts}>{timeAgo(e.ts)}</span>
        {e.txSignature ? (
          <a
            href={explorerTxUrl(e.txSignature)}
            target="_blank"
            rel="noreferrer"
            title="Транзакция в проводнике"
            aria-label="Транзакция в проводнике"
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg"
          >
            <ExternalLinkIcon className="h-4 w-4" />
          </a>
        ) : null}
      </div>
    </div>
  );
}

type Tab = "channels" | "activity";
type PosSort = "donated" | "points";

function DonorDashboard({
  overview,
  displayName,
  editable,
}: {
  overview: DonorOverview;
  displayName?: string;
  editable?: boolean;
}) {
  const [tab, setTab] = useState<Tab>("channels");
  const [range, setRange] = useState<ChartRange>("ALL");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<PosSort>("donated");
  const [actLimit, setActLimit] = useState(12);
  const [actChannel, setActChannel] = useState("all"); // фильтр ленты активности по каналу
  const profileQ = useProfile(overview.address || null);
  // Защита от старого ответа без журнала очков (напр. устаревший серверный стор) — не падаем.
  const pointEvents = useMemo(() => overview.pointEvents ?? [], [overview.pointEvents]);

  // Канал по id → handle/имя (для подписей в активности).
  const handleById = useMemo(() => {
    const m = new Map<string, { handle: string; channelName?: string }>();
    for (const s of overview.standings) m.set(s.channelId, { handle: s.handle, channelName: s.channelName });
    return m;
  }, [overview.standings]);

  // Каналы, по которым есть активность (для фильтра) + отфильтрованная лента.
  const actChannels = useMemo(() => {
    const ids = [...new Set(pointEvents.map((e) => e.channelId))];
    return ids.map((id) => {
      const ref = handleById.get(id);
      return { id, label: ref?.channelName?.trim() || (ref ? `@${ref.handle}` : id) };
    });
  }, [pointEvents, handleById]);
  const filteredEvents =
    actChannel === "all" ? pointEvents : pointEvents.filter((e) => e.channelId === actChannel);

  const positions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? overview.standings.filter(
          (s) =>
            s.handle.toLowerCase().includes(q) || (s.channelName?.toLowerCase().includes(q) ?? false),
        )
      : overview.standings;
    const sorted = [...filtered].sort((a, b) =>
      sort === "points"
        ? b.points - a.points
        : b.totalDonated > a.totalDonated
          ? 1
          : b.totalDonated < a.totalDonated
            ? -1
            : 0,
    );
    return sorted;
  }, [overview.standings, query, sort]);

  const name = displayName?.trim() || profileQ.data?.displayName?.trim() || "Профиль донатёра";

  return (
    <div className="flex flex-col gap-8">
      {/* ADR 0018: на СВОём профиле сверху — открытые циклы («требует тебя»); профиль = личная база. */}
      {editable ? <OpenCycles /> : null}
      {/* Личность + график — две карточки в ряд, одинаковой высоты (stretch), в тёмном тоне (bg --bg). */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Карточка личности — по образцу шапки канала (лейбл + крупное имя + мета со счётчиками). */}
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-[var(--bg)] p-4">
          <div className="flex items-start gap-4">
            <ProfileAvatar name={name} address={overview.address} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-caption uppercase tracking-wide text-fg-faint">Профиль</span>
              <h1 className="text-display-l leading-tight text-fg">{name}</h1>
              <div className="mono truncate text-small text-fg-faint">{overview.address}</div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-fg-muted">
                <span>
                  <span className="font-medium text-fg">{overview.channelsSupported}</span>{" "}
                  {plural(overview.channelsSupported, CHANNELS)}
                </span>
                <span className="text-fg-faint">·</span>
                <span>
                  <span className="font-medium text-fg">{overview.donationCount}</span>{" "}
                  {plural(overview.donationCount, DONATIONS)}
                </span>
                <span className="text-fg-faint">·</span>
                <span>с {monthYear(overview.firstDonationAt)}</span>
              </div>
              {overview.ownedChannelHandle ? (
                <Link
                  href={`/c/${overview.ownedChannelHandle}`}
                  className="mt-1 inline-flex w-fit items-center gap-1 rounded-pill border border-border px-2.5 py-0.5 text-small text-fg-muted transition-colors hover:border-border-strong hover:text-status"
                >
                  Канал @{overview.ownedChannelHandle} →
                </Link>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <CopyIconButton value={overview.address} title="Скопировать адрес" />
              {editable ? <ProfileEditDialog address={overview.address} /> : null}
            </div>
          </div>

          {profileQ.data?.bio ? <ProfileBio bio={profileQ.data.bio} /> : null}
          {profileQ.data?.links?.length ? (
            <ChannelLinkButtons links={profileQ.data.links} variant="text" />
          ) : null}
        </div>

        {/* Карточка «всего задонатил» + график */}
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-[var(--bg)] p-4">
          <div className="flex items-start justify-between gap-2">
            <span className="text-small text-fg-muted">Всего задонатил</span>
            <RangeTabs range={range} onChange={setRange} />
          </div>
          <Amount micro={overview.totalDonated} variant="money" className="text-display-l" />
          <DonationsAreaChart donations={overview.donations} range={range} />
          <span className="text-small text-fg-faint">
            {RANGE_CAPTION[range]} · деньги финальны, репутация считается у каждого канала отдельно
          </span>
        </div>
      </div>

      {/* Вкладки — нейтральное подчёркивание, счётчик = заголовок секции. */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-4 border-b border-border">
          {(
            [
              ["channels", `Каналы · ${overview.channelsSupported}`],
              ["activity", `Журнал репутации · ${pointEvents.length}`],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                "-mb-px border-b-2 pb-2 text-body transition-colors",
                tab === key ? "border-fg text-fg" : "border-transparent text-fg-muted hover:text-fg",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "channels" ? (
          overview.standings.length > 0 ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-48 flex-1">
                  <Input
                    icon={<SearchIcon className="h-4 w-4" />}
                    placeholder="Поиск каналов…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
                  {(
                    [
                      ["donated", "По сумме"],
                      ["points", "По очкам"],
                    ] as [PosSort, string][]
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSort(key)}
                      className={cn(
                        "rounded px-2.5 py-1 text-small transition-colors",
                        sort === key ? "bg-surface-raised text-fg" : "text-fg-faint hover:text-fg",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {positions.length > 0 ? (
                <div className="flex flex-col [&>:last-child]:border-b-0">
                  {positions.map((s) => (
                    <PositionRow key={s.channelId} s={s} />
                  ))}
                </div>
              ) : (
                <p className="text-small text-fg-faint">Ничего не найдено.</p>
              )}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-small text-fg-faint">
              Этот адрес ещё не донатил ни одному каналу.
            </p>
          )
        ) : pointEvents.length > 0 ? (
          <div className="flex flex-col gap-3">
            {actChannels.length > 1 ? (
              <Select
                value={actChannel}
                onChange={(e) => {
                  setActChannel(e.target.value);
                  setActLimit(12);
                }}
                aria-label="Фильтр журнала по каналу"
                className="w-full sm:w-64"
              >
                <option value="all">Все каналы</option>
                {actChannels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
            ) : null}
            {filteredEvents.length > 0 ? (
              <>
                <div className="flex flex-col [&>:last-child]:border-b-0">
                  {filteredEvents.slice(0, actLimit).map((e) => {
                    const ref = handleById.get(e.channelId);
                    return (
                      <ActivityRow
                        key={e.id}
                        e={e}
                        handle={ref?.handle}
                        channelName={ref?.channelName}
                      />
                    );
                  })}
                </div>
                {filteredEvents.length > actLimit ? (
                  <button
                    type="button"
                    onClick={() => setActLimit((n) => n + 12)}
                    className="mx-auto rounded-pill border border-border px-4 py-1.5 text-small text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
                  >
                    Показать больше
                  </button>
                ) : null}
              </>
            ) : (
              <p className="text-small text-fg-faint">По этому каналу записей в журнале нет.</p>
            )}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-small text-fg-faint">
            Журнал репутации пуст.
          </p>
        )}
      </div>
    </div>
  );
}

/** Профиль донатёра в духе дашборда: личность + деньги во времени + standing/активность.
 *  editable=true (своя страница /me) добавляет карандашик-редактор профиля. */
export function DonorProfile({ address, editable }: { address: string; editable?: boolean }) {
  const overviewQ = useDonorOverview(address || null);
  const profileQ = useProfile(address || null);

  if (overviewQ.isLoading) {
    return (
      <div className="flex flex-col gap-8">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!overviewQ.data) {
    return <p className="text-small text-fg-faint">Не удалось загрузить профиль.</p>;
  }
  return (
    <DonorDashboard
      overview={overviewQ.data}
      displayName={profileQ.data?.displayName}
      editable={editable}
    />
  );
}
