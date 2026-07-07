"use client";

import { useRouter } from "next/navigation";
import { demoAddress } from "@/lib/data/dev-identity";
import { useDevControls, useSession } from "@/lib/data/hooks";

const CREATE_HREF = "/space?tab=realm-create";

/**
 * "Open your realm" CTA. Already connected → straight to the create-realm form. Not connected: in dev
 * (mock/api) sign in instantly (impersonate a demo identity) THEN open the form — no "connect your wallet"
 * gate in between; in chain, fall through to /space which runs the real wallet connect. Once connected the
 * create-realm menu shows immediately (space auto-selects that tab when the wallet has no realm yet).
 */
export function CreateRealmButton({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const dev = useDevControls();

  const onClick = () => {
    if (!session?.address && dev.available) {
      dev.setAddress(demoAddress("max")); // dev sign-in (mock/api): instant, then straight to the form
    }
    router.push(CREATE_HREF);
  };

  return (
    <button type="button" onClick={onClick} className={className}>
      {children}
    </button>
  );
}
