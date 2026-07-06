import { redirect } from "next/navigation";

// Renamed to /supporters (one name for this surface: rail label "Supporters", page title, URL).
// Kept as a redirect so old links/bookmarks to /donors don't 404.
export default async function DonorsRedirect({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  redirect(`/c/${handle}/supporters`);
}
