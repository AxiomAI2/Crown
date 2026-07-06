import { redirect } from "next/navigation";

// The realm catalog now lives at "/" (one showcase, one card design — RealmCard). This route used to be a
// second catalog (ADR 0018), now orphaned with no links to it — kept only to redirect stale links/bookmarks.
export default function DiscoveryPage() {
  redirect("/");
}
