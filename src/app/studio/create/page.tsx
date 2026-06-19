"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { useCreateChannel, useMyChannel, useSession } from "@/lib/data/hooks";

const HANDLE_RE = /^[a-z0-9-]{3,32}$/;

export default function CreateChannelPage() {
  const router = useRouter();
  const sessionQ = useSession();
  const myChannelQ = useMyChannel();
  const create = useCreateChannel();

  const address = sessionQ.data?.address ?? null;
  const [handle, setHandle] = useState("");
  const [payout, setPayout] = useState("");

  // payoutAddress по умолчанию = логин-адрес.
  useEffect(() => {
    if (address && !payout) setPayout(address);
  }, [address, payout]);

  if (sessionQ.isLoading || myChannelQ.isLoading) {
    return <Skeleton className="h-64 w-full rounded-lg" />;
  }
  if (!address) {
    return (
      <EmptyState
        title="Подключи кошелёк"
        description="Создание канала доступно после подключения кошелька."
        action={
          <Button asChild size="sm">
            <Link href="/connect">Подключить кошелёк</Link>
          </Button>
        }
      />
    );
  }
  if (myChannelQ.data) {
    return (
      <EmptyState
        title="У тебя уже есть канал"
        description={`Один канал на кошелёк (ADR 0002). Твой канал — @${myChannelQ.data.handle}.`}
        action={
          <Button asChild size="sm">
            <Link href="/studio">В студию</Link>
          </Button>
        }
      />
    );
  }

  const handleValid = HANDLE_RE.test(handle);
  const payoutValid = payout.trim().length >= 32;
  const canSubmit = handleValid && payoutValid && !create.isPending;

  function submit() {
    create.mutate(
      { handle, payoutAddress: payout.trim() },
      {
        onSuccess: () => {
          toast({ variant: "success", title: "Канал создан", description: `@${handle} — статус BASIC.` });
          router.push("/studio");
        },
        onError: (e) =>
          toast({
            variant: "error",
            title: "Не удалось создать канал",
            description: e instanceof Error ? e.message : String(e),
          }),
      },
    );
  }

  return (
    <div className="flex max-w-lg flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-display-l text-fg">Создать канал</h1>
        <p className="text-fg-muted">
          Создаётся канал в статусе <span className="mono">BASIC</span> — бесплатно, но без донатов-с-текстом
          и публичной индексации (их разблокирует активация).
        </p>
      </div>

      <Input
        label="Handle (публичный адрес канала)"
        placeholder="my-channel"
        value={handle}
        onChange={(e) => setHandle(e.target.value.toLowerCase())}
        helper="Латиница, цифры, дефис; 3–32 символа."
        error={handle !== "" && !handleValid ? "Недопустимый handle" : undefined}
      />
      <Input
        label="Адрес для выплат (payoutAddress)"
        mono
        value={payout}
        onChange={(e) => setPayout(e.target.value)}
        helper="По умолчанию — твой логин-адрес. Можно указать другой."
        error={payout !== "" && !payoutValid ? "Похоже на неполный адрес" : undefined}
      />

      <Button disabled={!canSubmit} loading={create.isPending} onClick={submit}>
        Создать канал
      </Button>
    </div>
  );
}
