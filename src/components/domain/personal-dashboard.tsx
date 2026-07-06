"use client";

import { EmptyState } from "@/components/ui/feedback";

/**
 * Личный дашборд донатера («My Holdings» → Dashboard). Пока пусто — раздел на переработке.
 * Прежняя раскладка (hero + список realms + активность) снята по решению; вернём в новом виде.
 */
export function PersonalDashboard(_props: { address: string }) {
  return <EmptyState title="Nothing here yet" description="This section is being reworked." />;
}
