"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Amount } from "./amount";
import { ChannelLinkButtons } from "./channel-links";
import { inputsFromLinks, LinkEditor, type LinkInputs, linksFromInputs } from "./link-editor";
import { TierBadge } from "./standing";
import { ProfileAvatar } from "./standing-list";
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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { explorerTxUrl } from "@/lib/chain/addresses";
import { useDonorOverview, useProfile, useUpdateProfile } from "@/lib/data/hooks";
import type { Donation, DonorChannelStanding, DonorOverview } from "@/lib/data/types";
import { channelHue, cn, collapseWhitespace, formatPoints, fromMicro, plural, timeAgo } from "@/lib/utils";

const DONATIONS = ["донат", "доната", "донатов"] as const;
const CHANNELS = ["канал", "канала", "каналов"] as const;
const POINTS = ["очко", "очка", "очков"] as const;

// — Аналог polymarket-профиля в нашем контексте: деньги (донаты) агрегируемы, репутация — ПОканальная
//   (инвариант §4.3, глобального рейтинга нет). Headline + график = «всего задонатил» во времени;
//   «позиции» = standing по каналам; «активность» = история донатов.

function monthYear(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
}

/** Дата для подсказки графика: «24 июн 2026». */
function chartDate(t: number): string {
  return new Date(t).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
}

/** Число долларов → «$88.60» (для подсказки графика; деньги уже в USDC-числе). */
function dollars(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Кнопка-иконка «скопировать» (адрес / ссылка) с галочкой-подтверждением. */
function CopyIconButton({ value, title }: { value: string; title: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
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

type ChartRange = "1M" | "1Y" | "ALL";
const RANGE_MS: Record<ChartRange, number> = {
  "1M": 30 * 86_400_000,
  "1Y": 365 * 86_400_000,
  ALL: Number.POSITIVE_INFINITY,
};
const RANGE_LABEL: Record<ChartRange, string> = { "1M": "1М", "1Y": "1Г", ALL: "Всё" };

/**
 * Кумулятивный график «всего задонатил» во времени (донаты только прибавляют → монотонный рост). База
 * оси Y — 0 (площадь «наполняется»). Окно по диапазону; вне окна слева — стартовое значение, справа —
 * ровная линия до «сейчас». Деньги в micro-USDC; на UI-границе → number (fromMicro) только для геометрии.
 */
function DonationsAreaChart({ donations, range }: { donations: Donation[]; range: ChartRange }) {
  // Доля 0..1 по X под курсором (null — мышь вне графика). Хук — ДО раннего выхода (правило хуков).
  const [hoverFx, setHoverFx] = useState<number | null>(null);
  const series = useMemo(() => {
    const asc = [...donations].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    let running = 0;
    return asc.map((d) => {
      running += fromMicro(d.amount);
      return { t: Date.parse(d.ts), y: running };
    });
  }, [donations]);

  if (series.length === 0) {
    return (
      <div className="flex h-24 items-center justify-center rounded border border-dashed border-border text-small text-fg-faint">
        Пока нет донатов — график появится после первого.
      </div>
    );
  }

  const now = Date.now();
  const total = series[series.length - 1]!.y;
  const firstT = series[0]!.t;
  // Окно не должно уходить раньше первого доната: иначе на «1М/1Г» ось тянется в прошлое до проекта
  // (плоская линия в «пустом» периоде выглядит как донаты тогда, когда их не было).
  const windowStart = range === "ALL" ? firstT : Math.max(firstT, now - RANGE_MS[range]);

  // Стартовое (накопленное) значение на левом крае окна.
  let baseY = 0;
  for (const p of series) {
    if (p.t <= windowStart) baseY = p.y;
    else break;
  }
  const visible = series.filter((p) => p.t > windowStart);
  const pts =
    range === "ALL"
      ? [...series, { t: now, y: total }]
      : [{ t: windowStart, y: baseY }, ...visible, { t: now, y: total }];

  const W = 100;
  const H = 40;
  const xMin = pts[0]!.t;
  const xMax = Math.max(now, xMin + 1);
  const maxY = Math.max(total, 1);
  const sx = (t: number) => ((t - xMin) / (xMax - xMin)) * W;
  const sy = (y: number) => H - (y / maxY) * H;

  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${sx(p.t).toFixed(2)} ${sy(p.y).toFixed(2)}`).join(" ");
  const area = `${line} L ${sx(pts[pts.length - 1]!.t).toFixed(2)} ${H} L ${sx(pts[0]!.t).toFixed(2)} ${H} Z`;

  // Значение под курсором: курсор по X → время → значение на линии (линейная интерполяция по сегментам,
  // т.е. ровно по нарисованной линии, чтобы точка лежала на ней).
  let hover: { fx: number; y: number; t: number } | null = null;
  if (hoverFx != null) {
    const t = xMin + hoverFx * (xMax - xMin);
    let y = pts[0]!.y;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      if (t >= a.t && t <= b.t) {
        const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
        y = a.y + f * (b.y - a.y);
        break;
      }
      if (t > b.t) y = b.y;
    }
    hover = { fx: hoverFx, y, t };
  }

  return (
    <div
      className="relative h-24 w-full"
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setHoverFx(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
      }}
      onMouseLeave={() => setHoverFx(null)}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full" aria-hidden>
        <defs>
          <linearGradient id="donChartFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--money)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--money)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#donChartFill)" stroke="none" />
        <path
          d={line}
          fill="none"
          stroke="var(--money)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {hover ? (
        <>
          {/* вертикальная линия-курсор */}
          <div
            className="pointer-events-none absolute inset-y-0 w-px bg-fg-faint"
            style={{ left: `${hover.fx * 100}%` }}
          />
          {/* точка на линии (HTML-оверлей — остаётся круглой, svg растянут) */}
          <div
            className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-surface bg-money"
            style={{ left: `${hover.fx * 100}%`, top: `${(sy(hover.y) / H) * 100}%` }}
          />
          {/* подсказка: сумма + дата в этой точке */}
          <div
            className="pointer-events-none absolute top-0 -translate-x-1/2 whitespace-nowrap rounded border border-border bg-surface-raised px-2 py-1 text-caption shadow-md"
            style={{ left: `${Math.min(88, Math.max(12, hover.fx * 100))}%` }}
          >
            <span className="mono text-money">{dollars(hover.y)}</span>
            <span className="ml-1.5 text-fg-faint">{chartDate(hover.t)}</span>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Инлайн-стат: крупное число и подпись на одной базовой линии. */
function StatTile({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <p className="flex items-baseline gap-1.5">
      <span className="font-display text-h3 text-fg">{value}</span>
      <span className="text-small text-fg-muted">{label}</span>
    </p>
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
        <TierBadge tier={s.tier} />
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

/** Строка активности: канал (ссылка) + сумма + время + текст (если показан). */
function ActivityRow({ d, handle, channelName }: { d: Donation; handle?: string; channelName?: string }) {
  const shown = d.message?.state === "SHOWN";
  return (
    <div className="flex flex-col gap-2 border-b border-border py-3">
      <div className="flex items-center justify-between gap-2">
        {handle ? (
          <Link href={`/c/${handle}`} className="min-w-0 truncate text-small text-fg hover:text-status">
            {channelName?.trim() ? channelName : `@${handle}`}
            {channelName?.trim() ? <span className="mono text-fg-faint"> · @{handle}</span> : null}
          </Link>
        ) : (
          <span className="mono min-w-0 truncate text-small text-fg-faint">{d.channelId}</span>
        )}
        <Amount micro={d.amount} variant="money" />
      </div>
      {shown && d.message ? (
        <p className="break-words text-body text-fg">{collapseWhitespace(d.message.text)}</p>
      ) : null}
      <div className="flex items-center gap-2 text-small text-fg-faint">
        <span title={d.ts}>{timeAgo(d.ts)}</span>
        {d.txSignature ? (
          <a
            href={explorerTxUrl(d.txSignature)}
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
  const profileQ = useProfile(overview.address || null);

  // Канал по id → handle/имя (для подписей в активности).
  const handleById = useMemo(() => {
    const m = new Map<string, { handle: string; channelName?: string }>();
    for (const s of overview.standings) m.set(s.channelId, { handle: s.handle, channelName: s.channelName });
    return m;
  }, [overview.standings]);

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
      {/* Личность + график — две карточки в ряд, одинаковой высоты (stretch), в тёмном тоне (bg --bg). */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Карточка личности */}
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-[var(--bg)] p-4">
          <div className="flex items-start gap-4">
            <ProfileAvatar name={name} address={overview.address} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="truncate font-display text-h3 text-fg">{name}</span>
              <span className="mono truncate text-small text-fg-faint">{overview.address}</span>
              <span className="text-small text-fg-muted">
                донатит с {monthYear(overview.firstDonationAt)} · {overview.donationCount}{" "}
                {plural(overview.donationCount, DONATIONS)}
              </span>
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
          {profileQ.data?.links?.length ? <ChannelLinkButtons links={profileQ.data.links} /> : null}

          <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3">
            <StatTile
              value={overview.channelsSupported}
              label={`${plural(overview.channelsSupported, CHANNELS)} поддержано`}
            />
            <span className="h-6 w-px shrink-0 bg-border" aria-hidden />
            <StatTile value={overview.donationCount} label={plural(overview.donationCount, DONATIONS)} />
          </div>
        </div>

        {/* Карточка «всего задонатил» + график */}
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-[var(--bg)] p-4">
          <div className="flex items-start justify-between gap-2">
            <span className="text-small text-fg-muted">Всего задонатил</span>
            <div className="flex shrink-0 items-center gap-1 rounded-md border border-border p-0.5">
              {(["1M", "1Y", "ALL"] as ChartRange[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  className={cn(
                    "rounded px-2 py-0.5 text-small transition-colors",
                    range === r ? "bg-surface-raised text-fg" : "text-fg-faint hover:text-fg",
                  )}
                >
                  {RANGE_LABEL[r]}
                </button>
              ))}
            </div>
          </div>
          <Amount micro={overview.totalDonated} variant="money" className="text-display-l" />
          <DonationsAreaChart donations={overview.donations} range={range} />
          <span className="text-small text-fg-faint">
            {range === "ALL" ? "за всё время" : range === "1M" ? "за месяц" : "за год"} · деньги финальны,
            репутация считается у каждого канала отдельно
          </span>
        </div>
      </div>

      {/* Вкладки — нейтральное подчёркивание, счётчик = заголовок секции. */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-4 border-b border-border">
          {(
            [
              ["channels", `Каналы · ${overview.channelsSupported}`],
              ["activity", `Активность · ${overview.donationCount}`],
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
        ) : overview.donations.length > 0 ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col [&>:last-child]:border-b-0">
              {overview.donations.slice(0, actLimit).map((d) => {
                const ref = handleById.get(d.channelId);
                return (
                  <ActivityRow key={d.id} d={d} handle={ref?.handle} channelName={ref?.channelName} />
                );
              })}
            </div>
            {overview.donations.length > actLimit ? (
              <button
                type="button"
                onClick={() => setActLimit((n) => n + 12)}
                className="mx-auto rounded-pill border border-border px-4 py-1.5 text-small text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
              >
                Показать больше
              </button>
            ) : null}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-small text-fg-faint">
            Пока нет донатов.
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
