"use client";

import { useEffect, useRef, useState } from "react";
import { Monogram } from "@/components/domain/header-actions";
import { CrownLogo } from "@/components/crown-logo";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, Skeleton } from "@/components/ui/feedback";
import {
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  GripIcon,
  ImageIcon,
  LinkIcon,
  PaletteIcon,
  PencilIcon,
  QrIcon,
  TextIcon,
  TrashIcon,
  UserIcon,
} from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useCopied } from "@/components/ui/use-copied";
import { platformDef } from "@/lib/channel-links";
import { useChannelConfig, useMyChannel, useProfile, useUpdateConfig } from "@/lib/data/hooks";
import { DEFAULT_PRESET_AMOUNTS, pageWidgets } from "@/lib/page-widgets";
import { qrSvg } from "@/lib/qr";
import type { ChannelLink, PageTheme, PageWidget } from "@/lib/data/types";
import { cn, pageThemeStyle } from "@/lib/utils";

type BgType = "color" | "gradient" | "image";
interface ThemeDraft {
  bgType: BgType;
  bgColor: string;
  bgGradient: string;
  bgImage: string;
  bgFill: "cover" | "repeat";
  accent: string;
  buttonText: string;
  buttonTextColor: string;
  headerImage: string;
  pageText: string;
  showAvatar: boolean;
  widgets: PageWidget[];
}

const GRADIENTS = [
  "linear-gradient(160deg, #241b07, #0f0f0f 70%, #000)",
  "linear-gradient(160deg, #2a1050, #120a24 70%, #000)",
  "linear-gradient(160deg, #07231b, #08140f 70%, #000)",
  "linear-gradient(160deg, #2a0f18, #14090d 70%, #000)",
];

const DEFAULT_BUTTON_TEXT = "Crown";
const DEFAULT_BUTTON_TEXT_COLOR = "#0d0d0d";
const PAGE_TEXT_MAX = 280;

const DEFAULTS: Omit<ThemeDraft, "widgets"> = {
  bgType: "color",
  bgColor: "#0f0f0f",
  bgGradient: GRADIENTS[0]!,
  bgImage: "",
  bgFill: "cover",
  accent: "#e4b34c",
  buttonText: "",
  buttonTextColor: DEFAULT_BUTTON_TEXT_COLOR,
  headerImage: "",
  pageText: "",
  showAvatar: true,
};

function fromTheme(t?: PageTheme): ThemeDraft {
  return {
    bgType: t?.bgType ?? DEFAULTS.bgType,
    bgColor: t?.bgColor ?? DEFAULTS.bgColor,
    bgGradient: t?.bgGradient ?? DEFAULTS.bgGradient,
    bgImage: t?.bgImage ?? DEFAULTS.bgImage,
    bgFill: t?.bgFill ?? DEFAULTS.bgFill,
    accent: t?.accent ?? DEFAULTS.accent,
    buttonText: t?.buttonText ?? DEFAULTS.buttonText,
    buttonTextColor: t?.buttonTextColor ?? DEFAULTS.buttonTextColor,
    headerImage: t?.headerImage ?? DEFAULTS.headerImage,
    pageText: t?.pageText ?? DEFAULTS.pageText,
    showAvatar: t?.showAvatar ?? DEFAULTS.showAvatar,
    widgets: pageWidgets(t).map((w) => ({ ...w })),
  };
}
function toTheme(d: ThemeDraft): PageTheme {
  return {
    bgType: d.bgType,
    bgColor: d.bgColor,
    bgGradient: d.bgGradient,
    bgImage: d.bgImage.trim() || undefined,
    bgFill: d.bgFill,
    accent: d.accent,
    buttonText: d.buttonText.trim() || undefined,
    buttonTextColor: d.buttonTextColor,
    headerImage: d.headerImage.trim() || undefined,
    pageText: d.pageText.trim() || undefined,
    showAvatar: d.showAvatar,
    widgets: d.widgets,
  };
}

// Sub-tabs like the competitors' "Моя страница / Дизайн": WHAT is on the page vs HOW it looks.
const SUBTABS = [
  { key: "content", label: "My page" },
  { key: "design", label: "Design" },
] as const;
type SubTab = (typeof SUBTABS)[number]["key"];

// Widget catalog — icon, name, one-liner for the picker dialog and the list rows.
const WIDGET_META: Record<
  PageWidget["type"],
  { name: string; desc: string; icon: React.ReactNode; single: boolean }
> = {
  donate: {
    name: "Crown form",
    desc: "The easy way to support you",
    icon: <CrownLogo size={16} />,
    single: true,
  },
  socials: {
    name: "Social icons",
    desc: "Quick links to your profiles",
    icon: <LinkIcon className="h-4 w-4" />,
    single: true,
  },
  button: {
    name: "Button",
    desc: "A link to a socials page or any URL",
    icon: <ExternalLinkIcon className="h-4 w-4" />,
    single: false,
  },
  text: {
    name: "Text block",
    desc: "Any text or message",
    icon: <TextIcon className="h-4 w-4" />,
    single: false,
  },
};

function newWidget(type: PageWidget["type"]): PageWidget {
  return {
    id: crypto.randomUUID(),
    type,
    enabled: true,
    label: "",
    url: "",
    text: "",
    amounts: type === "donate" ? [...DEFAULT_PRESET_AMOUNTS] : undefined,
  };
}

const MAX_PRESET_AMOUNTS = 6;

/** Quick-pick amounts editor: removable `$N ×` chips + an add field (Enter or the + button). No raw
 *  comma-string editing — the parser used to re-format the field on every keystroke. */
function AmountsEditor({ value, onChange }: { value: number[]; onChange: (a: number[]) => void }) {
  const [draft, setDraft] = useState("");
  const isDefault =
    value.length === DEFAULT_PRESET_AMOUNTS.length && value.every((n, i) => n === DEFAULT_PRESET_AMOUNTS[i]);

  function add() {
    const n = Math.floor(Number(draft.trim()));
    if (!Number.isFinite(n) || n <= 0 || value.includes(n) || value.length >= MAX_PRESET_AMOUNTS) return;
    onChange([...value, n].sort((a, b) => a - b));
    setDraft("");
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-small text-fg-muted">Quick-pick amounts on your Crown form</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((n) => (
          <span
            key={n}
            className="mono inline-flex items-center gap-1 rounded-pill border border-border bg-[var(--bg)] py-1 pl-3 pr-1.5 text-small text-fg"
          >
            ${n.toLocaleString("en-US")}
            <button
              type="button"
              aria-label={`Remove $${n}`}
              onClick={() => onChange(value.filter((x) => x !== n))}
              className="grid h-4 w-4 place-items-center rounded-full text-fg-faint transition-colors hover:bg-surface-raised hover:text-danger"
            >
              ×
            </button>
          </span>
        ))}
        {value.length < MAX_PRESET_AMOUNTS ? (
          <span className="inline-flex items-center gap-1">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
              inputMode="numeric"
              placeholder="$"
              aria-label="Add amount, USDC"
              className="mono h-7 w-16 rounded-pill border border-border bg-[var(--bg)] px-2.5 text-center text-small text-fg placeholder:text-fg-faint focus-visible:border-border-strong focus-visible:outline-none"
            />
            <button
              type="button"
              onClick={add}
              disabled={!draft.trim()}
              aria-label="Add amount"
              className="grid h-7 w-7 place-items-center rounded-full border border-border text-fg-muted transition-colors hover:border-border-strong hover:text-fg disabled:opacity-40"
            >
              +
            </button>
          </span>
        ) : null}
        {!isDefault ? (
          <button
            type="button"
            onClick={() => onChange([...DEFAULT_PRESET_AMOUNTS])}
            className="text-small text-fg-faint underline-offset-2 transition-colors hover:text-fg hover:underline"
          >
            Reset to default
          </button>
        ) : null}
      </div>
      {value.length === 0 ? (
        <span className="text-small text-fg-faint">No chips — supporters just type an amount.</span>
      ) : null}
    </div>
  );
}

export function RealmPageBuilder() {
  const channelQ = useMyChannel();
  const channel = channelQ.data;
  const configQ = useChannelConfig(channel?.id);
  const profileQ = useProfile(channel?.ownerAddress ?? null);
  const update = useUpdateConfig(channel?.id ?? "");

  const [tab, setTab] = useState<SubTab>("content");
  const [draft, setDraft] = useState<ThemeDraft | null>(null);
  // The greeting toggle: OFF hides the field and clears the text (empty text = nothing shown on the page).
  const [greetOn, setGreetOn] = useState(false);
  useEffect(() => {
    if (configQ.data) {
      const t = fromTheme(configQ.data.pageTheme);
      setDraft(t);
      setGreetOn(Boolean(t.pageText.trim()));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configQ.data?.version, configQ.data?.updatedAt]);

  if (channelQ.isLoading || configQ.isLoading || !draft) {
    if (!channelQ.isLoading && !channel) {
      return <EmptyState title="No realm yet" description="Create your realm to customize its page." />;
    }
    return <Skeleton className="h-96 w-full rounded-lg" />;
  }
  if (!channel) return <EmptyState title="No realm yet" description="Create your realm to customize its page." />;

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const link = `${origin}/c/${channel.handle}`;
  const saved = fromTheme(configQ.data?.pageTheme);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = (patch: Partial<ThemeDraft>) => setDraft((d) => ({ ...(d as ThemeDraft), ...patch }));

  function save() {
    update.mutate(
      { pageTheme: toTheme(draft!) },
      {
        onSuccess: () => toast({ variant: "success", title: "Page saved" }),
        onError: (e) => toast({ variant: "error", title: "Couldn't save", description: String(e) }),
      },
    );
  }

  const name = profileQ.data?.displayName?.trim() || `@${channel.handle}`;
  const avatarUrl = profileQ.data?.avatarUrl;
  const description = configQ.data?.description?.trim();
  const links = profileQ.data?.links ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-display-l text-fg">Page</h1>
        <p className="max-w-2xl text-fg-muted">
          This is where supporters send you paid crowns. Share the link — and make the page yours.
        </p>
      </div>

      {/* My link — one compact row; the QR lives behind a button (dialog), not permanently on the page. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-small text-fg-muted">My link</span>
        <LinkRow url={link} />
        <QrButton url={link} accent={draft.accent} handle={channel.handle} />
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
        {/* Controls */}
        <div className="flex min-w-0 max-w-2xl flex-1 flex-col gap-5">
          {/* Sub-tabs: content ↔ design */}
          <div className="flex gap-1 border-b border-border">
            {SUBTABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                aria-current={tab === t.key ? "page" : undefined}
                className={cn(
                  "relative px-3 py-2 text-small transition-colors",
                  tab === t.key ? "text-fg" : "text-fg-muted hover:text-fg",
                )}
              >
                {t.label}
                {tab === t.key ? <span className="absolute inset-x-0 -bottom-px h-0.5 bg-money" /> : null}
              </button>
            ))}
          </div>

          {tab === "content" ? (
            <>
              {/* Profile card: avatar + greeting, each behind its own toggle. */}
              <Card icon={<UserIcon className="h-4 w-4" />} title="Profile">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Monogram name={name} avatarUrl={avatarUrl} size="md" className="flex-none" />
                    <span className="text-small text-fg">Avatar</span>
                  </div>
                  <Switch
                    checked={draft.showAvatar}
                    onCheckedChange={(v) => set({ showAvatar: v })}
                    srLabel="Show avatar on the page"
                  />
                </div>

                <div className="border-t border-border" />

                <div className="flex items-center justify-between gap-3">
                  <span className="text-small text-fg">Greeting</span>
                  <Switch
                    checked={greetOn}
                    onCheckedChange={(v) => {
                      setGreetOn(v);
                      if (!v) set({ pageText: "" });
                    }}
                    srLabel="Show a greeting on the page"
                  />
                </div>
                {greetOn ? (
                  <Textarea
                    aria-label="Greeting"
                    placeholder="e.g. Thanks for supporting the stream! Drop a message with your crown."
                    maxLength={PAGE_TEXT_MAX}
                    showCount
                    value={draft.pageText}
                    onChange={(e) => set({ pageText: e.target.value })}
                  />
                ) : null}
              </Card>

              {/* Banner above the Crown form. */}
              <Card icon={<ImageIcon className="h-4 w-4" />} title="Image above the form">
                {draft.headerImage.trim() ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={draft.headerImage.trim()}
                    alt=""
                    className="h-24 w-full rounded-md border border-border object-cover"
                  />
                ) : null}
                <Input
                  aria-label="Image URL"
                  placeholder="https://… or data:image/…"
                  value={draft.headerImage}
                  onChange={(e) => set({ headerImage: e.target.value })}
                />
              </Card>

              {/* Widgets: what blocks the page's action rail is built of, in order. */}
              <WidgetsEditor widgets={draft.widgets} onChange={(w) => set({ widgets: w })} />
            </>
          ) : (
            <>
              {/* Background */}
              <Card icon={<PaletteIcon className="h-4 w-4" />} title="Background">
                <div className="flex gap-2">
                  {(["color", "gradient", "image"] as BgType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => set({ bgType: t })}
                      className={cn(
                        "flex-1 rounded-md border px-3 py-2 text-small capitalize transition-colors",
                        draft.bgType === t
                          ? "border-border-strong bg-surface-raised text-fg"
                          : "border-border text-fg-muted hover:border-border-strong hover:text-fg",
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>

                {draft.bgType === "color" ? (
                  <ColorField label="Background color" value={draft.bgColor} onChange={(v) => set({ bgColor: v })} />
                ) : null}

                {draft.bgType === "gradient" ? (
                  <div className="grid grid-cols-4 gap-2">
                    {GRADIENTS.map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => set({ bgGradient: g })}
                        aria-label="Gradient preset"
                        style={{ background: g }}
                        className={cn(
                          "h-14 rounded-md border-2 transition-colors",
                          draft.bgGradient === g ? "border-money" : "border-transparent hover:border-border-strong",
                        )}
                      />
                    ))}
                  </div>
                ) : null}

                {draft.bgType === "image" ? (
                  <>
                    <Input
                      aria-label="Image URL"
                      placeholder="https://… or data:image/…"
                      value={draft.bgImage}
                      onChange={(e) => set({ bgImage: e.target.value })}
                      helper="Any image URL. It fills the page behind your content."
                    />
                    <div className="flex gap-2">
                      {(["cover", "repeat"] as const).map((f) => (
                        <button
                          key={f}
                          type="button"
                          onClick={() => set({ bgFill: f })}
                          className={cn(
                            "flex-1 rounded-md border px-3 py-2 text-small transition-colors",
                            draft.bgFill === f
                              ? "border-border-strong bg-surface-raised text-fg"
                              : "border-border text-fg-muted hover:border-border-strong hover:text-fg",
                          )}
                        >
                          {f === "cover" ? "Fill" : "Tile"}
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
              </Card>

              {/* Crown button */}
              <Card icon={<CrownLogo size={16} />} title="Button">
                <Input
                  label="Button text"
                  placeholder={DEFAULT_BUTTON_TEXT}
                  maxLength={24}
                  value={draft.buttonText}
                  onChange={(e) => set({ buttonText: e.target.value })}
                  helper={`Label on the send button. Empty → “${DEFAULT_BUTTON_TEXT}”.`}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <ColorField label="Button color" value={draft.accent} onChange={(v) => set({ accent: v })} />
                  <ColorField
                    label="Button text color"
                    value={draft.buttonTextColor}
                    onChange={(v) => set({ buttonTextColor: v })}
                  />
                </div>
              </Card>
            </>
          )}

          <div className="flex items-center gap-3">
            <Button onClick={save} loading={update.isPending} disabled={!dirty}>
              Save page
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setDraft(saved);
                setGreetOn(Boolean(saved.pageText.trim()));
              }}
              disabled={!dirty}
            >
              Reset
            </Button>
          </div>
        </div>

        {/* Live preview — the phone, mirroring the public page (same widget stack). */}
        <div className="flex-none lg:sticky lg:top-4">
          <PhonePreview
            draft={draft}
            name={name}
            avatarUrl={avatarUrl}
            description={description}
            links={links}
          />
        </div>
      </div>
    </div>
  );
}

/** Add/toggle/edit/remove/reorder the page's widget blocks — competitors' builder pattern, honest here:
 *  every row maps 1:1 to a block on the public page. */
function WidgetsEditor({
  widgets,
  onChange,
}: {
  widgets: PageWidget[];
  onChange: (w: PageWidget[]) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const dragIndex = useRef<number | null>(null);

  const setAt = (i: number, patch: Partial<PageWidget>) =>
    onChange(widgets.map((w, idx) => (idx === i ? { ...w, ...patch } : w)));

  function add(type: PageWidget["type"]) {
    const w = newWidget(type);
    onChange([...widgets, w]);
    setPickerOpen(false);
    if (type === "button" || type === "text") setEditId(w.id); // straight into its fields
  }

  function drop(to: number) {
    const from = dragIndex.current;
    dragIndex.current = null;
    if (from === null || from === to) return;
    const next = [...widgets];
    const [moved] = next.splice(from, 1);
    if (moved) next.splice(to, 0, moved);
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-money py-2.5 text-small font-semibold text-[#1a1206] transition-opacity hover:opacity-90"
      >
        + Add widget
      </button>

      <div className="flex flex-col gap-1.5">
        {widgets.map((w, i) => {
          const meta = WIDGET_META[w.type];
          const editable = w.type === "button" || w.type === "text" || w.type === "donate";
          const editing = editId === w.id;
          return (
            <div
              key={w.id}
              draggable
              onDragStart={() => (dragIndex.current = i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => drop(i)}
              className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-2.5"
            >
              <div className="flex items-center gap-2.5">
                <GripIcon className="h-4 w-4 flex-none cursor-grab text-fg-faint" />
                <span className="grid h-8 w-8 flex-none place-items-center rounded-md bg-money-bg text-money">
                  {meta.icon}
                </span>
                <span className="min-w-0 flex-1 truncate text-small font-medium text-fg">
                  {w.type === "button" && w.label?.trim() ? w.label : meta.name}
                </span>
                {editable ? (
                  <button
                    type="button"
                    aria-label="Edit widget"
                    onClick={() => setEditId(editing ? null : w.id)}
                    className={cn(
                      "grid h-8 w-8 flex-none place-items-center rounded-md transition-colors hover:bg-surface-raised",
                      editing ? "text-fg" : "text-fg-faint hover:text-fg",
                    )}
                  >
                    <PencilIcon className="h-4 w-4" />
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label="Remove widget"
                  onClick={() => onChange(widgets.filter((_, idx) => idx !== i))}
                  className="grid h-8 w-8 flex-none place-items-center rounded-md text-fg-faint transition-colors hover:bg-surface-raised hover:text-danger"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
                <Switch
                  checked={w.enabled}
                  onCheckedChange={(v) => setAt(i, { enabled: v })}
                  srLabel={`${meta.name} on the page`}
                />
              </div>

              {editing && w.type === "donate" ? (
                <div className="border-t border-border pt-3">
                  <AmountsEditor
                    value={w.amounts ?? DEFAULT_PRESET_AMOUNTS}
                    onChange={(a) => setAt(i, { amounts: a })}
                  />
                </div>
              ) : null}
              {editing && w.type === "button" ? (
                <div className="grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
                  <Input
                    label="Button text"
                    maxLength={40}
                    placeholder="My Discord"
                    value={w.label ?? ""}
                    onChange={(e) => setAt(i, { label: e.target.value })}
                  />
                  <Input
                    label="Link"
                    mono
                    placeholder="https://…"
                    value={w.url ?? ""}
                    onChange={(e) => setAt(i, { url: e.target.value })}
                  />
                </div>
              ) : null}
              {editing && w.type === "text" ? (
                <div className="border-t border-border pt-3">
                  <Textarea
                    aria-label="Text"
                    maxLength={500}
                    showCount
                    placeholder="Any text or message…"
                    value={w.text ?? ""}
                    onChange={(e) => setAt(i, { text: e.target.value })}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add a widget</DialogTitle>
            <DialogDescription>Blocks appear on your page in the order below.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {(Object.keys(WIDGET_META) as PageWidget["type"][]).map((type) => {
              const meta = WIDGET_META[type];
              const taken = meta.single && widgets.some((w) => w.type === type);
              return (
                <button
                  key={type}
                  type="button"
                  disabled={taken}
                  onClick={() => add(type)}
                  className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3 text-left transition-colors hover:border-border-strong hover:bg-surface-raised disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-surface"
                >
                  <span className="grid h-9 w-9 flex-none place-items-center rounded-md bg-money-bg text-money">
                    {meta.icon}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-small font-medium text-fg">
                      {meta.name}
                      {taken ? <span className="ml-2 text-fg-faint">— already added</span> : null}
                    </span>
                    <span className="text-small text-fg-faint">{meta.desc}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The phone — a real phone silhouette (tall 9:19 body, big corner radius, speaker slot), showing the SAME
 *  widget stack as the public page. No frame-in-frame, no labels around it. */
function PhonePreview({
  draft,
  name,
  avatarUrl,
  description,
  links,
}: {
  draft: ThemeDraft;
  name: string;
  avatarUrl?: string;
  description?: string;
  links: ChannelLink[];
}) {
  const buttonLabel = draft.buttonText.trim() || DEFAULT_BUTTON_TEXT;
  const socialIcons = (
    <div className="flex items-center justify-center gap-4">
      {links.slice(0, 6).map((l) => {
        const def = platformDef(l.platform);
        if (!def) return null;
        return (
          <span key={l.platform} className="text-fg-muted" aria-hidden>
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
              <path d={def.iconPath} />
            </svg>
          </span>
        );
      })}
    </div>
  );

  return (
    <div
      className="relative mx-auto h-[640px] w-[320px] overflow-hidden rounded-[2.75rem] border border-border/70 bg-[#0d0d0d] shadow-2xl shadow-black/60"
      style={pageThemeStyle(toTheme(draft))}
    >
      {/* Speaker slot — the one cue that instantly reads "phone". */}
      <div className="absolute left-1/2 top-3.5 z-10 h-1.5 w-16 -translate-x-1/2 rounded-pill bg-white/10" />

      <div className="flex h-full flex-col items-center gap-5 overflow-y-auto px-6 pb-10 pt-14 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {draft.showAvatar ? <Monogram name={name} avatarUrl={avatarUrl} size="xl" /> : null}
        <div className="flex flex-col items-center gap-1 text-center">
          <div className="font-display text-xl font-semibold text-fg">{name}</div>
          {draft.pageText.trim() ? (
            <p className="whitespace-pre-wrap break-words text-small text-fg-muted">{draft.pageText.trim()}</p>
          ) : description ? (
            <div className="text-small text-fg-muted">{description}</div>
          ) : null}
        </div>

        {draft.widgets
          .filter((w) => w.enabled)
          .map((w) => {
            if (w.type === "donate")
              return (
                <div
                  key={w.id}
                  className="flex w-full flex-col gap-2.5 rounded-2xl bg-black/35 p-3.5 backdrop-blur-sm"
                >
                  {draft.headerImage.trim() ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={draft.headerImage.trim()} alt="" className="h-16 w-full rounded-xl object-cover" />
                  ) : null}
                  <div className="rounded-lg border border-border bg-black/40 px-3 py-2.5 text-small text-fg-faint">
                    Anonymous
                  </div>
                  <div className="rounded-lg border border-border bg-black/40 px-3 py-2.5 text-small text-fg-faint">
                    Amount
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(w.amounts?.length ? w.amounts : DEFAULT_PRESET_AMOUNTS).slice(0, 6).map((p, idx) => (
                      <span
                        key={`${p}-${idx}`}
                        className="rounded-pill bg-black/40 py-1.5 text-center text-caption text-fg-muted"
                      >
                        ${p}
                      </span>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="rounded-xl py-3 text-center text-small font-bold"
                    style={{ background: draft.accent, color: draft.buttonTextColor }}
                  >
                    {buttonLabel}
                  </button>
                </div>
              );
            if (w.type === "socials") return links.length > 0 ? <div key={w.id}>{socialIcons}</div> : null;
            if (w.type === "button")
              return (
                <span
                  key={w.id}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-border/70 bg-black/30 py-2.5 text-small font-medium text-fg"
                >
                  {w.label?.trim() || w.url?.trim() || "Button"}
                  <ExternalLinkIcon className="h-3 w-3 text-fg-faint" />
                </span>
              );
            return w.text?.trim() ? (
              <p key={w.id} className="w-full whitespace-pre-wrap break-words text-center text-small text-fg-muted">
                {w.text.trim()}
              </p>
            ) : null;
          })}
      </div>
    </div>
  );
}

/** A settings card: icon + small-caps title header, then the controls — the competitors' tidy block look. */
function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2 text-fg-muted">
        <span aria-hidden>{icon}</span>
        <span className="text-caption uppercase tracking-wide">{title}</span>
      </div>
      {children}
    </div>
  );
}

function LinkRow({ url }: { url: string }) {
  const [copied, mark] = useCopied();
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <code className="mono min-w-0 flex-1 truncate rounded-md border border-border bg-[var(--bg)] px-3 py-2 text-small text-money">
        {url}
      </code>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          mark();
        }}
        aria-label="Copy link"
        title="Copy link"
        className="grid h-9 w-9 flex-none place-items-center rounded-md border border-border text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
      >
        {copied ? <CheckIcon className="h-4 w-4 text-status" /> : <CopyIcon className="h-4 w-4" />}
      </button>
    </div>
  );
}

/** "QR code" button → dialog with a large client-generated QR + SVG download (the link never leaves the browser). */
function QrButton({ url, accent, handle }: { url: string; accent: string; handle: string }) {
  const [open, setOpen] = useState(false);
  const [svg, setSvg] = useState<string | null>(null);
  const dark = /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : "#0d0d0d";

  useEffect(() => {
    if (!open) return;
    let alive = true;
    qrSvg(url, { dark, light: "#ffffff" })
      .then((s) => {
        if (alive) setSvg(s);
      })
      .catch(() => {
        if (alive) setSvg(null);
      });
    return () => {
      alive = false;
    };
  }, [open, url, dark]);

  const downloadRef = useRef<HTMLAnchorElement>(null);
  function download() {
    if (!svg) return;
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const href = URL.createObjectURL(blob);
    const a = downloadRef.current;
    if (a) {
      a.href = href;
      a.download = `crown-${handle}-qr.svg`;
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 flex-none items-center gap-1.5 rounded-md border border-border px-3 text-small text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
      >
        <QrIcon className="h-4 w-4" /> QR code
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Your realm QR</DialogTitle>
            <DialogDescription>
              Put it on stream or a card — scanning opens your Crown page.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4">
            <div className="grid h-52 w-52 place-items-center rounded-lg bg-white p-3">
              {svg ? (
                <div
                  className="h-full w-full [&>svg]:h-full [&>svg]:w-full"
                  dangerouslySetInnerHTML={{ __html: svg }}
                />
              ) : (
                <Skeleton className="h-full w-full rounded" />
              )}
            </div>
            <code className="mono max-w-full truncate text-small text-fg-muted">{url}</code>
            <Button variant="secondary" onClick={download} disabled={!svg}>
              Download SVG
            </Button>
            {/* eslint-disable-next-line jsx-a11y/anchor-has-content */}
            <a ref={downloadRef} className="hidden" aria-hidden />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Color swatch + hex text input, kept in sync. */
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-end gap-2">
      <input
        type="color"
        aria-label={label}
        value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-12 flex-none cursor-pointer rounded border border-border bg-surface"
      />
      <div className="flex-1">
        <Input label={label} mono value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  );
}
