"use client";

import { useParams } from "next/navigation";
import { DonorProfile } from "@/components/domain/donor-profile";
import { AppHeader } from "@/components/layout/app-header";

/** Публичный профиль донатёра (read-only): личность + деньги во времени + standing по каналам + активность.
 *  Дашборд в духе публичного профиля (как у polymarket), но в контексте донат-платформы. */
export default function PublicProfilePage() {
  const params = useParams<{ address: string }>();
  const address = params.address ? decodeURIComponent(params.address) : "";

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-content flex-col gap-6 px-4 py-8">
        <DonorProfile address={address} />
      </main>
    </>
  );
}
