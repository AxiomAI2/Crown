"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/layout/app-header";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useProfile, useSession, useUpdateProfile } from "@/lib/data/hooks";

export default function ProfileSettingsPage() {
  const sessionQ = useSession();
  const address = sessionQ.data?.address ?? null;
  const profileQ = useProfile(address);
  const update = useUpdateProfile();

  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [bio, setBio] = useState("");
  const [links, setLinks] = useState("");

  useEffect(() => {
    const p = profileQ.data;
    if (p) {
      setDisplayName(p.displayName ?? "");
      setAvatarUrl(p.avatarUrl ?? "");
      setBio(p.bio ?? "");
      setLinks((p.links ?? []).join("\n"));
    }
  }, [profileQ.data]);

  function save() {
    update.mutate(
      {
        displayName: displayName.trim() || undefined,
        avatarUrl: avatarUrl.trim() || undefined,
        bio: bio.trim() || undefined,
        links: links
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean),
      },
      {
        onSuccess: () => toast({ variant: "success", title: "Профиль сохранён" }),
        onError: (e) => toast({ variant: "error", title: "Ошибка", description: String(e) }),
      },
    );
  }

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-lg flex-col gap-5 px-4 py-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-display-l text-fg">Лёгкий профиль</h1>
          <p className="text-fg-muted">
            Профиль необязателен (по умолчанию — адрес-онли). Включение добавляет публичную поверхность:
            ник и аватар видны в ленте и лидерборде.
          </p>
        </div>

        {sessionQ.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : !address ? (
          <EmptyState
            title="Подключи кошелёк"
            action={
              <Button asChild size="sm">
                <Link href="/connect">Подключить кошелёк</Link>
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-4">
            <Input label="Имя (display_name)" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            <Input label="Аватар (URL)" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} />
            <Textarea label="О себе" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={280} showCount />
            <Textarea
              label="Ссылки (по одной на строку)"
              value={links}
              onChange={(e) => setLinks(e.target.value)}
            />
            <Button onClick={save} loading={update.isPending}>
              Сохранить профиль
            </Button>
          </div>
        )}
      </main>
    </>
  );
}
