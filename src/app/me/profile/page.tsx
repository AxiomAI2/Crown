"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  inputsFromLinks,
  LinkEditor,
  type LinkInputs,
  linksFromInputs,
} from "@/components/domain/link-editor";
import { AppHeader } from "@/components/layout/app-header";
import { ConnectWalletButton } from "@/components/layout/connect-wallet-button";
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
  const [bio, setBio] = useState("");
  const [linkInputs, setLinkInputs] = useState<LinkInputs>([]);

  // Заполняем форму ОДИН раз на адрес: фоновый рефетч (напр. инвалидация после save) не должен затирать
  // несохранённые правки пользователя. Смена адреса (другой кошелёк) → пере-гидрация.
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    const p = profileQ.data;
    if (p && hydratedFor.current !== address) {
      hydratedFor.current = address;
      setDisplayName(p.displayName ?? "");
      setBio(p.bio ?? "");
      setLinkInputs(inputsFromLinks(p.links));
    }
  }, [profileQ.data, address]);

  function save() {
    update.mutate(
      {
        displayName: displayName.trim() || undefined,
        bio: bio.trim() || undefined,
        links: linksFromInputs(linkInputs),
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
        <Link href="/me" className="text-small text-fg-muted hover:text-fg">
          ← К профилю
        </Link>
        <div className="flex flex-col gap-1">
          <h1 className="text-display-l text-fg">Редактирование профиля</h1>
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
            action={<ConnectWalletButton />}
          />
        ) : (
          <div className="flex flex-col gap-4">
            <Input label="Имя (display_name)" maxLength={40} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            <Textarea label="О себе" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={280} showCount />
            <div className="flex flex-col gap-2">
              <span className="text-small text-fg-muted">Ссылки</span>
              <LinkEditor value={linkInputs} onChange={setLinkInputs} />
            </div>
            <Button onClick={save} loading={update.isPending}>
              Сохранить профиль
            </Button>
          </div>
        )}
      </main>
    </>
  );
}
