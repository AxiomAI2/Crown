"use client";

import Link from "next/link";
import { useMemo } from "react";
import { RealmFilterToolbar, useRealmFilter } from "@/components/domain/realm-filters";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { platformDef } from "@/lib/channel-links";
import { useDiscovery } from "@/lib/data/hooks";
import { fromMicro } from "@/lib/utils";

function usd(micro: bigint): string {
  return "$" + Math.round(fromMicro(micro)).toLocaleString("en-US");
}

/** Admin → Realms. Full list of realms with the same filters/search as on the home page, as a table. */
export default function AdminRealmsPage() {
  const { data, isLoading, error, refetch } = useDiscovery();
  const realms = useMemo(() => data?.items ?? [], [data]);
  const f = useRealmFilter(realms);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-h2 text-fg">Realms</h1>
          <p className="text-small text-fg-faint">
            {realms.length} total
            {f.visible.length !== realms.length ? ` · ${f.visible.length} shown` : ""}
          </p>
        </div>
        {realms.length > 0 ? <RealmFilterToolbar filter={f} /> : null}
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full rounded-lg" />
      ) : error ? (
        <ErrorState description="Couldn't load realms." onRetry={() => refetch()} />
      ) : realms.length === 0 ? (
        <EmptyState title="No realms yet" description="Be the first to open one." />
      ) : f.visible.length === 0 ? (
        <EmptyState title="No realms found" description="Try clearing the search or platform filters." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-small">
            <thead>
              <tr className="border-b border-border text-caption uppercase tracking-wide text-fg-faint">
                <th className="px-4 py-2.5 text-left font-medium">#</th>
                <th className="px-4 py-2.5 text-left font-medium">Realm</th>
                <th className="px-4 py-2.5 text-left font-medium">Socials</th>
                <th className="px-4 py-2.5 text-right font-medium">Crowned</th>
                <th className="px-4 py-2.5 text-right font-medium">7d</th>
                <th className="px-4 py-2.5 text-right font-medium">Supporters</th>
                <th className="px-4 py-2.5 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {f.visible.map((r, i) => (
                <tr key={r.channelId} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5 text-fg-faint">{i + 1}</td>
                  <td className="px-4 py-2.5">
                    <Link href={`/c/${r.handle}`} className="flex flex-col transition-colors hover:text-status">
                      <span className="mono text-fg">@{r.handle}</span>
                      {r.displayName ? (
                        <span className="text-caption text-fg-faint">{r.displayName}</span>
                      ) : null}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5 text-fg-faint">
                      {(r.links ?? []).map((l) => {
                        const def = platformDef(l.platform);
                        return def ? (
                          <svg
                            key={l.platform}
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          >
                            <title>{def.label}</title>
                            <path d={def.iconPath} />
                          </svg>
                        ) : null;
                      })}
                      {(r.links?.length ?? 0) === 0 ? <span className="text-caption">—</span> : null}
                    </div>
                  </td>
                  <td className="mono px-4 py-2.5 text-right text-money">{usd(r.totalDonated)}</td>
                  <td className="mono px-4 py-2.5 text-right text-fg-muted">{usd(r.crowned7d ?? 0n)}</td>
                  <td className="px-4 py-2.5 text-right text-fg-muted">{r.donorsCount}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      {r.isLive ? (
                        <span className="inline-flex items-center gap-1 text-caption text-danger">
                          <span className="h-1.5 w-1.5 rounded-full bg-danger" />
                          LIVE
                        </span>
                      ) : null}
                      <span className={r.activated ? "text-caption text-status" : "text-caption text-fg-faint"}>
                        {r.activated ? "Active" : "Basic"}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
