"use client";

import { useState } from "react";
import { Amount, FeeSplit } from "./amount";
import { StandingHeadline, TierBadge } from "./standing";
import { ConnectWalletButton } from "@/components/layout/connect-wallet-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useDonate } from "@/lib/data/hooks";
import { pointsForAmount } from "@/lib/reputation";
import { cn, plural, toMicro } from "@/lib/utils";
import type {
  Channel,
  ChannelConfig,
  DonationResult,
  Session,
  ViewerStanding,
} from "@/lib/data/types";

const PRESETS = [5, 10, 25, 100];
const SOFT_WORDS = ["худший", "лох", "scam", "idiot"];

const USDC_DECIMALS = 6; // точность USDC: больше знаков после точки не существует в micro-USDC

/**
 * Санитайзер поля суммы: только цифры и ОДНА точка (запятую → точку для RU-раскладки), дробная часть не
 * длиннее 6 знаков. Иначе лишние знаки округлялись бы в toMicro и давали «странности» (напр. 0.0000001 → 0).
 */
function sanitizeAmount(raw: string): string {
  const s = raw.replace(",", ".").replace(/[^\d.]/g, "");
  const dot = s.indexOf(".");
  if (dot === -1) return s;
  const int = s.slice(0, dot);
  const frac = s.slice(dot + 1).replace(/\./g, ""); // выкинуть повторные точки
  return `${int}.${frac.slice(0, USDC_DECIMALS)}`;
}

export function DonateWidget({
  channel,
  config,
  session,
  standing,
  standingLoading,
}: {
  channel: Channel;
  config: ChannelConfig;
  session: Session;
  standing?: ViewerStanding | null;
  standingLoading?: boolean;
}) {
  const [amount, setAmount] = useState("");
  const [withText, setWithText] = useState(false);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<DonationResult | null>(null);
  const donate = useDonate(channel.id);

  const connected = Boolean(session.address);
  const isBasic = channel.status === "BASIC";
  const amountNum = Number(amount);
  const amountValid = amount !== "" && Number.isFinite(amountNum) && amountNum > 0;
  const min = withText ? config.minDonationWithText : config.minDonation;
  const micro = amountValid ? toMicro(amountNum) : 0n;
  const meetsMin = amountValid && micro >= min;
  const textOk = !withText || text.trim().length > 0;
  const canDonate = connected && amountValid && meetsMin && textOk && !(withText && isBasic);
  const softWarn = withText && SOFT_WORDS.some((w) => text.toLowerCase().includes(w));

  // Прогноз начисления за введённую сумму (та же формула, что и при реальном начислении) — для предпросмотра.
  const gain = amountValid ? pointsForAmount(micro) : 0;

  function openFlow() {
    setResult(null);
    donate.reset();
    setOpen(true);
  }
  function confirm() {
    donate.mutate(
      { amountUSDC: amountNum, text: withText ? text.trim() : undefined },
      {
        onSuccess: (r) => {
          setResult(r);
          // Донат отправлен → сразу чистим форму (особенно текст сообщения), чтобы он не оставался в поле.
          setAmount("");
          setText("");
          setWithText(false);
        },
        onError: (e) =>
          toast({
            variant: "error",
            title: "Донат не прошёл",
            description: e instanceof Error ? e.message : String(e),
          }),
      },
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-[var(--bg)] p-4">
      {!connected ? (
        <>
          <h3 className="text-h3 text-fg">Задонатить</h3>
          <p className="text-small text-fg-muted">
            Подключи кошелёк, чтобы поддержать канал и набирать standing.
          </p>
          <ConnectWalletButton />
        </>
      ) : (
        <>
      {/* Моё standing + живой предпросмотр: ввёл сумму → число катится к прогнозу, полоска тянется. */}
      <StandingHeadline standing={standing} tiers={config.tiers} gain={gain} loading={standingLoading} />

      <div className="border-t border-border" />

      <h3 className="text-h3 text-fg">Задонатить</h3>

      <div className="flex flex-col gap-2">
        <Input
          label="Сумма, USDC"
          mono
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(sanitizeAmount(e.target.value))}
          error={amountValid && !meetsMin ? "Ниже минимума канала" : undefined}
          className="bg-[var(--bg)]"
        />
        <div className="grid grid-cols-4 gap-2">
          {PRESETS.map((p) => (
            <Button
              key={p}
              variant="secondary"
              size="sm"
              className="w-full bg-[var(--bg)]"
              onClick={() => setAmount(String(p))}
            >
              ${p}
            </Button>
          ))}
        </div>
      </div>

      {isBasic ? (
        <p className="rounded border border-border bg-surface-raised p-3 text-small text-fg-muted">
          Канал не активирован — донат с сообщением пока недоступен. Задонатить можно, но без текста.
        </p>
      ) : (
        <>
          <label className="flex items-center gap-2 text-small text-fg-muted">
            <input
              type="checkbox"
              checked={withText}
              onChange={(e) => setWithText(e.target.checked)}
            />
            Добавить сообщение
          </label>

          {withText ? (
            <Textarea
              label="Сообщение"
              placeholder="Текст к донату…"
              maxLength={config.messageMaxLen}
              showCount
              value={text}
              onChange={(e) => setText(e.target.value)}
              helper={
                softWarn
                  ? "В тексте есть слово, которое может попасть под фильтр стримера (не блокирует)."
                  : "Текст приватен до показа — стример решит, публиковать ли его."
              }
              className={cn("bg-[var(--bg)]", softWarn && "border-warn")}
            />
          ) : null}
        </>
      )}

      {amountValid ? <FeeSplit amount={micro} /> : null}

      <Button
        variant="secondary"
        disabled={!canDonate}
        onClick={openFlow}
        className="border-border-strong bg-[var(--bg)] hover:bg-surface-raised"
      >
        Задонатить
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          // после успешного доната очищаем форму при закрытии
          if (!o && result) {
            setAmount("");
            setText("");
            setWithText(false);
            setResult(null);
          }
        }}
      >
        <DialogContent>
          {result ? (
            <DoneView result={result} hadText={withText} onClose={() => setOpen(false)} />
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Подтверждение</DialogTitle>
                <DialogDescription>Донат необратим. Возврата нет.</DialogDescription>
              </DialogHeader>
              <FeeSplit amount={micro} />
              {donate.isPending ? (
                <p className="text-small text-fg-muted">
                  Подпиши в кошельке и подожди финализации в сети (~15–30с) — «Готово» появится, когда донат
                  станет необратимым.
                </p>
              ) : null}
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="ghost" disabled={donate.isPending}>
                    Отмена
                  </Button>
                </DialogClose>
                <Button variant="money" loading={donate.isPending} onClick={confirm}>
                  {donate.isPending ? "Финализируем…" : "Подтвердить и подписать"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
        </>
      )}
    </div>
  );
}

/** Финальность доната — сигнатурный момент: суммы 97/3 расходятся, «печать», переключение в --money. */
export function FinalityMoment({ result }: { result: DonationResult }) {
  return (
    <div className="animate-stamp flex flex-col items-center gap-3 rounded-lg border border-money bg-money-bg p-5 text-center">
      <div className="flex w-full items-center justify-between text-small">
        <span className="text-fg-muted">Стримеру</span>
        <Amount micro={result.donation.netToStreamer} variant="money" />
      </div>
      <div className="flex w-full items-center justify-between text-small">
        <span className="text-fg-muted">Платформе</span>
        <Amount micro={result.donation.feeAmount} variant="money" />
      </div>
      <p className="text-h3 text-money">Готово. Деньги ушли стримеру.</p>
    </div>
  );
}

function DoneView({
  result,
  hadText,
  onClose,
}: {
  result: DonationResult;
  hadText: boolean;
  onClose: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Донат прошёл</DialogTitle>
        <DialogDescription>Деньги финальны. Репутация уже зачтена.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3">
        <FinalityMoment result={result} />
        {result.tierChanged && result.standing.tier ? (
          <div
            className="animate-stamp flex items-center justify-center gap-2 rounded-lg border-2 p-3"
            style={{ borderColor: result.standing.tier.color }}
          >
            <span className="text-small text-fg-muted">Новый тир!</span>
            <TierBadge tier={result.standing.tier} />
          </div>
        ) : null}
        <p className="text-small text-fg-muted">
          Твой standing уже зачтён:{" "}
          <span className="mono text-status">{result.standing.points}</span>{" "}
          {plural(result.standing.points, ["очко", "очка", "очков"])}.
        </p>
        {hadText ? (
          <p className="rounded border border-border bg-surface p-3 text-small text-fg-muted">
            Сообщение на модерации у стримера (HELD). Деньги и standing уже зачтены — публикация текста
            от них не зависит.
          </p>
        ) : null}
      </div>
      <DialogFooter>
        <Button onClick={onClose}>Готово</Button>
      </DialogFooter>
    </>
  );
}
