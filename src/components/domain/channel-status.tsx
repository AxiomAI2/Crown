"use client";

import { useMyChannel } from "@/lib/data/hooks";

/**
 * A contextual reminder about the realm's status in the studio (shown across ALL tabs via layout, not as a
 * separate page). SUSPENDED/BANNED → info. ACTIVE / BASIC / no realm → nothing.
 *
 * The activation fee was removed — realms are active on creation (crowns-with-text + public indexing are
 * unlocked immediately), so there's no "Activate to unlock… $2" prompt anymore.
 */
export function ChannelStatusBanner() {
  const { data: channel } = useMyChannel();
  if (!channel || channel.status === "ACTIVE" || channel.status === "BASIC") return null;

  return (
    <div className="mb-6 rounded-lg border border-danger bg-danger-bg p-4">
      <span className="text-h3 text-fg">
        {channel.status === "SUSPENDED" ? "Realm suspended" : "Realm banned"}
      </span>
      <p className="text-small text-fg-muted">
        {channel.status === "SUSPENDED"
          ? "The realm is under operator review. Wait for a decision or contact support."
          : "The realm was banned by the platform. Contact support if you think this is a mistake."}
      </p>
    </div>
  );
}
