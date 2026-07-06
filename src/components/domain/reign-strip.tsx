import { RankBadge } from "./rank-badge";
import { Skeleton } from "@/components/ui/feedback";
import { rankProgress } from "@/lib/crown";
import type { ViewerStanding } from "@/lib/data/types";
import { formatPoints } from "@/lib/utils";

/**
 * Полоса «Your Reign»: личный ранг зрителя на этом дворе (шкала CROWN: Squire→King) + прогресс до
 * следующего ранга. Гость / нулевой Reign → приглашающая подсказка вместо прогресса. Reign считается по
 * очкам (1 USDC = 1 Reign); шкала едина для всех дворов (в отличие от настраиваемых стримером тиров).
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
  const { rank, next, progress, toNext } = rankProgress(points);

  return (
    <div className="flex items-center gap-4 p-4">
      <RankBadge points={points} size={48} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="flex items-baseline gap-2">
            <span className="text-caption uppercase tracking-wide text-fg-faint">Your Reign</span>
            <span className="text-small font-medium" style={{ color: rank.metal }}>
              {rank.name}
            </span>
          </span>
          <span className="mono shrink-0 text-status">
            {formatPoints(points)}
            <span className="ml-1 text-caption text-fg-faint">Reign</span>
          </span>
        </div>

        {points === 0 ? (
          <p className="text-small text-fg-muted">
            Crown this realm to begin your Reign — climb Squire → King.
          </p>
        ) : next ? (
          <div className="flex flex-col gap-1">
            <div className="h-1.5 overflow-hidden rounded-pill bg-surface-raised">
              <div
                className="h-full rounded-pill"
                style={{
                  width: `${Math.round(progress * 100)}%`,
                  background: `linear-gradient(90deg, ${rank.metal}, ${next.metal})`,
                }}
              />
            </div>
            <span className="text-caption text-fg-faint">
              {formatPoints(toNext)} to {next.name}
            </span>
          </div>
        ) : (
          <span className="text-caption text-fg-faint">Apex rank — the realm is yours.</span>
        )}
      </div>
    </div>
  );
}
