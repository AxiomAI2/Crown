import { Skeleton } from "@/components/ui/feedback";
import type { ViewerStanding } from "@/lib/data/types";
import { formatPoints } from "@/lib/utils";

/**
 * "Your Reign" strip: the viewer's standing in THIS realm, expressed in the realm's OWN tiers (set by the
 * creator — there is no global rank ladder; §4.3 reputation is local). Shows the current tier + progress to
 * the next tier. Guest / zero Reign → an inviting prompt. Reign is measured in points (1 USDC = 1 Reign).
 */
export function ReignStrip({
  standing,
  loading,
}: {
  standing?: ViewerStanding | null;
  loading?: boolean;
}) {
  if (loading) return <Skeleton className="h-[68px] w-full rounded-xl" />;

  const points = standing?.points ?? 0;
  const tier = standing?.tier;
  const nextTier = standing?.nextTier;
  const progress = standing?.progressToNext ?? 0;
  const toNext = nextTier ? Math.max(0, nextTier.threshold - points) : 0;
  const color = tier?.color ?? "var(--text-faint)";

  return (
    <div className="flex items-center gap-4 p-4">
      {/* Tier medallion — colored by the realm's own tier (no global Squire→King). */}
      <span
        className="grid h-12 w-12 flex-none place-items-center rounded-full border-2 font-display text-h3"
        style={{
          borderColor: color,
          color,
          background: `radial-gradient(circle at 50% 32%, color-mix(in srgb, ${color} 20%, transparent), transparent 70%)`,
        }}
        aria-hidden
      >
        {(tier?.name ?? "?").replace(/^@/, "").slice(0, 1).toUpperCase()}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="flex items-baseline gap-2">
            <span className="text-caption uppercase tracking-wide text-fg-faint">Your Reign</span>
            <span className="text-small font-medium" style={{ color }}>
              {tier?.name ?? "No tier yet"}
            </span>
          </span>
          <span className="mono shrink-0 text-status">
            {formatPoints(points)}
            <span className="ml-1 text-caption text-fg-faint">Reign</span>
          </span>
        </div>

        {points === 0 ? (
          <p className="text-small text-fg-muted">
            Crown this realm to begin your Reign and climb its tiers.
          </p>
        ) : nextTier ? (
          <div className="flex flex-col gap-1">
            <div className="h-1.5 overflow-hidden rounded-pill bg-surface-raised">
              <div
                className="h-full rounded-pill"
                style={{
                  width: `${Math.round(progress * 100)}%`,
                  background: `linear-gradient(90deg, ${color}, ${nextTier.color})`,
                }}
              />
            </div>
            <span className="text-caption text-fg-faint">
              {formatPoints(toNext)} to {nextTier.name}
            </span>
          </div>
        ) : (
          <span className="text-caption text-fg-faint">Top tier of this realm.</span>
        )}
      </div>
    </div>
  );
}
