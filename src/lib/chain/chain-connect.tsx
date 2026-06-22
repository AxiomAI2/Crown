"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { LabeledWalletButton } from "./wallet-multi-button";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useData } from "@/lib/data/context";
import { useSession } from "@/lib/data/hooks";

/**
 * Кнопка подключения/входа, учитывающая ДВА состояния (они разные!): подключён ли кошелёк (wallet-adapter)
 * и есть ли серверная сессия (SIWS). Если кошелёк подключён, но сессии нет (автоподпись из bridge не прошла —
 * напр. кошелёк отклонил/не поддержал signMessage), раньше показывалась кнопка кошелька в состоянии «Выйти»,
 * и войти было нечем (тупик). Теперь в этом случае показываем «Войти (подпись)» — повторно запускаем SIWS и
 * показываем ошибку, если подпись не удалась.
 */
export function ChainConnect() {
  const wallet = useWallet();
  const session = useSession();
  const data = useData();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const connectedNoSession = wallet.connected && !session.data?.address;
  if (connectedNoSession) {
    return (
      <Button
        size="sm"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await data.connect(); // chain: ensureAuth → подпись SIWS текущим кошельком
            await qc.invalidateQueries(); // обновить сессию и все гейты
          } catch (e) {
            toast({
              variant: "error",
              title: "Не удалось войти",
              description: e instanceof Error ? e.message : String(e),
            });
          } finally {
            setBusy(false);
          }
        }}
      >
        Войти (подпись)
      </Button>
    );
  }
  // кошелёк не подключён → обычная кнопка кошелька (подключит + bridge автоподпишет)
  return <LabeledWalletButton />;
}
