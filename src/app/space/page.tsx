"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ChannelStatusBanner } from "@/components/domain/channel-status";
import { ChannelSettingsEditor } from "@/components/domain/channel-settings-editor";
import { RealmPageBuilder } from "@/components/domain/realm-page-builder";
import { ChannelView } from "@/components/domain/channel-view";
import { CreateChannelForm } from "@/components/domain/create-channel-form";
import { DonorProfile } from "@/components/domain/donor-profile";
import { ModerationQueue } from "@/components/domain/moderation-queue";
import { RealmDashboard } from "@/components/domain/realm-dashboard";
import { RealmGamesSettings } from "@/components/domain/realm-games-settings";
import { RealmWidgets } from "@/components/domain/realm-widgets";
import { CrownLogo } from "@/components/crown-logo";
import { AppHeader } from "@/components/layout/app-header";
import { ConnectWalletButton } from "@/components/layout/connect-wallet-button";
import { CrownWallet } from "@/components/layout/crown-wallet";
import { RailToggle, useRailCollapsed } from "@/components/layout/rail-toggle";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/feedback";
import { CheckIcon, ChevronDownIcon, CopyIcon, ExternalLinkIcon } from "@/components/ui/icons";
import { toast } from "@/components/ui/toast";
import { useCopied } from "@/components/ui/use-copied";
import { explorerAddressUrl, IS_CHAIN } from "@/lib/chain/addresses";
import { useData } from "@/lib/data/context";
import { demoAddress } from "@/lib/data/dev-identity";
import { useDevControls, useMyChannel, useSession } from "@/lib/data/hooks";
import { cn } from "@/lib/utils";

type SectionKey =
  | "profile"
  | "realm-create"
  | "realm-view"
  | "realm-dashboard"
  | "realm-queue"
  | "realm-games"
  | "custom-profile"
  | "custom-page"
  | "custom-messages"
  | "custom-payout"
  | "widget-overlays"
  | "widget-goal"
  | "widget-list"
  | "settings";

// The "My Realm" items depend on whether the user has their own realm. The entire Studio moved here.
const REALM_OWNED: { key: SectionKey; label: string }[] = [
  { key: "realm-view", label: "Realm page" },
  { key: "realm-dashboard", label: "Dashboard" },
  { key: "realm-queue", label: "Moderation" },
  { key: "realm-games", label: "Mini-games" },
];
// Collapsible folder: every way to customise the realm + the widgets, split into sub-pages.
// "custom-payout" is chain-only (off-chain it renders nothing) → filtered at render time.
const WIDGETS_CUSTOM: { key: SectionKey; label: string }[] = [
  { key: "custom-profile", label: "Profile" },
  { key: "custom-page", label: "Page" },
  { key: "custom-messages", label: "Messages" },
  { key: "custom-payout", label: "Payout" },
  { key: "widget-overlays", label: "Overlays" },
  { key: "widget-goal", label: "Donation goal" },
  { key: "widget-list", label: "Donations list" },
];
const CUSTOM_KEYS: SectionKey[] = WIDGETS_CUSTOM.map((it) => it.key);
const REALM_NONE: { key: SectionKey; label: string }[] = [{ key: "realm-create", label: "Create realm" }];

// Deep-link aliases (including legacy ?tab values).
const TAB_ALIAS: Record<string, SectionKey> = {
  profile: "profile",
  me: "profile",
  dashboard: "realm-dashboard",
  create: "realm-create",
  "realm-create": "realm-create",
  realm: "realm-view",
  "realm-view": "realm-view",
  view: "realm-view",
  "realm-dashboard": "realm-dashboard",
  customization: "custom-page",
  "realm-customization": "custom-page",
  page: "custom-page",
  "custom-page": "custom-page",
  "custom-profile": "custom-profile",
  description: "custom-profile",
  ranks: "custom-profile",
  tiers: "custom-profile",
  crowns: "custom-profile",
  messages: "custom-messages",
  "custom-messages": "custom-messages",
  payout: "custom-payout",
  "custom-payout": "custom-payout",
  queue: "realm-queue",
  "realm-queue": "realm-queue",
  games: "realm-games",
  "realm-games": "realm-games",
  widgets: "widget-overlays",
  "realm-widgets": "widget-overlays",
  overlays: "widget-overlays",
  "widget-overlays": "widget-overlays",
  goal: "widget-goal",
  "widget-goal": "widget-goal",
  list: "widget-list",
  "widget-list": "widget-list",
  // Blocklist tab removed: blocking/unblocking lives in the "…" moderation menu on donations.
  blocklist: "realm-queue",
  "realm-blocklist": "realm-queue",
  settings: "settings",
  account: "settings",
};

/**
 * `/space` — personal space: My Holdings (patron side), My Realm (owner side) + Settings.
 * While there is no own realm — My Realm shows only "Create realm"; after creation, Dashboard and
 * Customization appear (reactively via useMyChannel). Entry point — "Personal Space" in the header.
 */
export default function SpacePage() {
  const session = useSession();
  const dev = useDevControls();
  const address = session.data?.address ?? null;
  const myChannelQ = useMyChannel();
  const hasRealm = !!myChannelQ.data;
  const realmKnown = !myChannelQ.isLoading;
  const [section, setSection] = useState<SectionKey>("profile");
  const { collapsed, toggle } = useRailCollapsed("space-rail");
  const searchParams = useSearchParams();

  // Dev-only: `?as=<label>` logs in a seeded identity (mock only; inert in api/chain).
  useEffect(() => {
    if (address || !dev.available) return;
    const as = new URLSearchParams(window.location.search).get("as");
    if (as) dev.setAddress(demoAddress(as));
  }, [address, dev.available]); // eslint-disable-line react-hooks/exhaustive-deps

  // Section deep-link: `?tab=realm-customization` etc. (+ aliases). Reacts to searchParams so in-app links
  // that only change ?tab= (e.g. the "Open queue" banner) actually switch the view — not just the URL.
  useEffect(() => {
    const t = searchParams.get("tab");
    if (t && TAB_ALIAS[t]) setSection(TAB_ALIAS[t]);
  }, [searchParams]);

  // Keep the section consistent with realm ownership (after creation / if there is no realm yet).
  useEffect(() => {
    if (!address || !realmKnown) return;
    if (hasRealm && section === "realm-create") setSection("realm-view");
    else if (!hasRealm && section.startsWith("realm-") && section !== "realm-create")
      setSection("realm-create");
  }, [address, realmKnown, hasRealm, section]);

  // Arriving from the "Open your realm" funnel (landing / sidebar) → make the connect prompt about that.
  const wantsCreate = ((t) => t === "realm-create" || t === "create")(searchParams.get("tab"));

  if (session.isLoading) {
    return (
      <>
        <AppHeader />
        <div className="mx-auto max-w-content px-4 pt-16">
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </>
    );
  }
  if (!address) {
    // Guest CTAs land here (e.g. "Open your realm"). Keep the app chrome so it doesn't read as a broken,
    // header-less dead end — brand + nav + a clear connect affordance, with copy matching why they came.
    return (
      <>
        <AppHeader />
        <div className="mx-auto max-w-content px-4 pt-16">
          <EmptyState
            title={wantsCreate ? "Connect your wallet to open your realm" : "Connect your wallet"}
            description={
              wantsCreate
                ? "Opening a realm is free — one realm per wallet. Connect to set it up."
                : "Connect to enter your personal space."
            }
            action={<ConnectWalletButton />}
          />
        </div>
      </>
    );
  }

  return (
    <div className="flex min-h-[100dvh] flex-col md:flex-row">
      {/* Full-height sidebar with the logo on top and a vertical border (like in the admin panel). */}
      <SpaceSidebar
        active={section}
        onSelect={setSection}
        hasRealm={hasRealm}
        realmLoading={!realmKnown}
        collapsed={collapsed}
      />
      <RailToggle collapsed={collapsed} onToggle={toggle} width="15rem" />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Thin top bar: wallet control on the right. */}
        <div className="sticky top-0 z-20 flex h-[var(--header-h)] flex-none items-center justify-end gap-2 border-b border-border bg-[var(--bg)] px-4 lg:px-6">
          {IS_CHAIN ? <ConnectWalletButton /> : <CrownWallet />}
        </div>
        <main className="min-w-0 flex-1 px-4 pb-8 pt-6 lg:px-6">
          {/* Contextual realm banner (activation / suspension) — in all My Realm tabs except creation. */}
          {section.startsWith("realm-") && section !== "realm-create" ? (
            <div className="mb-5">
              <ChannelStatusBanner />
            </div>
          ) : null}
          {section === "profile" ? <DonorProfile address={address} editable /> : null}
          {section === "realm-create" ? <CreateChannelForm /> : null}
          {section === "realm-view" ? (
            myChannelQ.data ? (
              <ChannelView handle={myChannelQ.data.handle} />
            ) : (
              <Skeleton className="h-64 w-full rounded-xl" />
            )
          ) : null}
          {section === "realm-dashboard" ? <RealmDashboard /> : null}
          {section === "realm-queue" ? <ModerationQueue /> : null}
          {section === "realm-games" ? <RealmGamesSettings /> : null}
          {section === "custom-profile" ? (
            <ChannelSettingsEditor title="Profile" group="profile" />
          ) : null}
          {section === "custom-page" ? <RealmPageBuilder /> : null}
          {section === "custom-messages" ? (
            <ChannelSettingsEditor title="Messages" group="messages" />
          ) : null}
          {section === "custom-payout" ? (
            <ChannelSettingsEditor title="Payout" group="payout" />
          ) : null}
          {section === "widget-overlays" ? <RealmWidgets view="overlays" /> : null}
          {section === "widget-goal" ? <RealmWidgets view="goal" /> : null}
          {section === "widget-list" ? <RealmWidgets view="list" /> : null}
          {section === "settings" ? <SettingsSection address={address} /> : null}
        </main>
      </div>
    </div>
  );
}

function SpaceSidebar({
  active,
  onSelect,
  hasRealm,
  realmLoading,
  collapsed,
}: {
  active: SectionKey;
  onSelect: (k: SectionKey) => void;
  hasRealm: boolean;
  realmLoading: boolean;
  collapsed: boolean;
}) {
  const realmItems = hasRealm ? REALM_OWNED : REALM_NONE;
  // The "Widgets & Customization" folder: open when toggled, or auto-open while one of its sub-pages is active.
  const [customOpen, setCustomOpen] = useState(false);
  const folderOpen = customOpen || CUSTOM_KEYS.includes(active);

  const item = (it: { key: SectionKey; label: string }, nested: boolean) => {
    const isCreate = it.key === "realm-create";
    return (
      <button
        key={it.key}
        type="button"
        onClick={() => onSelect(it.key)}
        aria-current={active === it.key ? "page" : undefined}
        className={cn(
          "flex w-full items-center rounded px-3 py-2 text-left text-small transition-colors duration-fast ease-ease",
          nested && "md:pl-5",
          active === it.key
            ? "bg-surface-raised text-fg"
            : isCreate
              ? "font-medium text-money hover:bg-money-bg"
              : "text-fg-muted hover:bg-surface-raised hover:text-fg",
        )}
      >
        {isCreate ? <span className="mr-1.5">+</span> : null}
        {it.label}
      </button>
    );
  };

  return (
    <aside
      className={cn(
        "flex w-full flex-col border-b border-border bg-[var(--bg)] transition-[width] duration-slow ease-ease md:sticky md:top-0 md:h-[100dvh] md:flex-none md:overflow-hidden md:border-b-0 md:border-r",
        collapsed ? "md:w-14" : "md:w-60",
      )}
    >
      {/* Logo on top — stays visible even when collapsed (collapsed shows only the mark). */}
      <Link
        href="/"
        aria-label="CROWN — home"
        className={cn(
          "flex h-[var(--header-h)] flex-none items-center gap-2.5 px-4",
          collapsed && "md:justify-center md:px-0",
        )}
      >
        <CrownLogo size={26} className="text-[#c9a24a]" />
        <span
          className={cn(
            "font-display text-lg font-semibold tracking-[0.2em] text-fg",
            collapsed && "md:hidden",
          )}
        >
          CROWN
        </span>
      </Link>
      <nav
        className={cn(
          "flex flex-col gap-0.5 overflow-y-auto px-2 pb-3 [scrollbar-width:none] md:pt-1 [&::-webkit-scrollbar]:hidden",
          collapsed && "md:hidden",
        )}
      >
        {/* Profile — the patron/trophy page (same as /me), above My Realm. */}
        {item({ key: "profile", label: "Profile" }, false)}
        <div className="my-1 border-t border-border" aria-hidden />

        {/* My Realm — Create realm while there is no realm; after creation Dashboard + Customization */}
        <div className="mb-2 flex flex-col gap-0.5">
          <div className="px-3 pb-1 pt-1 text-caption uppercase tracking-wide text-fg-faint">
            My Realm
          </div>
          {realmLoading ? (
            <div className="px-3 py-2 text-small text-fg-faint">…</div>
          ) : (
            <>
              {realmItems.map((it) => item(it, true))}
              {hasRealm ? (
                <div className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={() => setCustomOpen((o) => !o)}
                    aria-expanded={folderOpen}
                    className="flex w-full items-center justify-between gap-2 rounded px-3 py-2 text-left text-small leading-snug text-fg-muted transition-colors duration-fast ease-ease hover:bg-surface-raised hover:text-fg md:pl-5"
                  >
                    <span>Widgets &amp; Customization</span>
                    <ChevronDownIcon
                      className={cn("h-4 w-4 flex-none transition-transform", folderOpen && "rotate-180")}
                    />
                  </button>
                  {folderOpen ? (
                    <div className="flex flex-col gap-0.5">
                      {WIDGETS_CUSTOM.filter((it) => it.key !== "custom-payout" || IS_CHAIN).map((it) => (
                        <button
                          key={it.key}
                          type="button"
                          onClick={() => onSelect(it.key)}
                          aria-current={active === it.key ? "page" : undefined}
                          className={cn(
                            "flex w-full items-center rounded px-3 py-1.5 text-left text-small transition-colors duration-fast ease-ease md:pl-8",
                            active === it.key
                              ? "bg-surface-raised text-fg"
                              : "text-fg-muted hover:bg-surface-raised hover:text-fg",
                          )}
                        >
                          {it.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="my-1 border-t border-border" aria-hidden />
        {item({ key: "settings", label: "Account" }, false)}
      </nav>
    </aside>
  );
}

/** "Account" tab — just the wallet (address, copy/explorer, sign out). Profile editing lives in the
 *  Profile tab, so no duplicate link here. */
function SettingsSection({ address }: { address: string }) {
  return (
    <div className="flex flex-col gap-8 pb-10">
      <h1 className="text-display-l text-fg">Account</h1>
      <AccountBlock address={address} />
    </div>
  );
}

function AccountBlock({ address }: { address: string }) {
  const dev = useDevControls();
  const data = useData();
  const [copied, mark] = useCopied();
  const btn =
    "flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface text-fg-muted transition-colors hover:border-border-strong hover:text-fg";
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-caption uppercase tracking-wide text-fg-faint">Wallet</span>
          <span className="mono break-all text-fg">{address}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className={btn}
            title="Copy address"
            aria-label="Copy address"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(address);
                mark();
                toast({ variant: "success", title: "Address copied" });
              } catch {
                toast({ variant: "error", title: "Couldn't copy" });
              }
            }}
          >
            {copied ? <CheckIcon className="h-[18px] w-[18px]" /> : <CopyIcon className="h-[18px] w-[18px]" />}
          </button>
          <a
            className={btn}
            href={explorerAddressUrl(address)}
            target="_blank"
            rel="noopener noreferrer"
            title="Address in Solana Explorer"
            aria-label="Open in explorer"
          >
            <ExternalLinkIcon className="h-[18px] w-[18px]" />
          </a>
        </div>
      </div>
      <Button
        variant="ghost"
        className="w-fit text-danger hover:text-danger"
        onClick={() => (dev.available ? dev.setAddress(null) : void data.disconnect())}
      >
        Sign out
      </Button>
    </div>
  );
}
