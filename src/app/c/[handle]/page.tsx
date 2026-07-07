"use client";

import { useParams } from "next/navigation";
import { ChannelView } from "@/components/domain/channel-view";
import { AppHeader } from "@/components/layout/app-header";

export default function ChannelPage() {
  const params = useParams<{ handle: string }>();
  return (
    <>
      <AppHeader />
      <main className="w-full px-4 pb-10 pt-4 lg:px-6">
        <ChannelView handle={params.handle} />
      </main>
    </>
  );
}
