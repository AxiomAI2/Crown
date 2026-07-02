"use client";

import { useQuery } from "@tanstack/react-query";
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
import { IS_CHAIN } from "@/lib/chain/addresses";
import { useDonate, useMyBlock } from "@/lib/data/hooks";
import { pointsForAmount } from "@/lib/reputation";
import { cn, formatPoints, plural, toMicro } from "@/lib/utils";
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
// Потолок одного доната. Защищает сразу от трёх «выходов за рамки»: бессмысленно огромные суммы,
// переполнение вёрстки (число вылезает за карточку) и потеря точности в toMicro (usdc*1e6 за Number.MAX).
const MAX_DONATION_USDC = 1_000_000;
const MAX_INT_DIGITS = String(MAX_DONATION_USDC).length; // длина целой части ограничена → нельзя вписать «бесконечность»

/**
 * Санитайзер поля суммы: только цифры и ОДНА точка (запятую → точку для RU-раскладки), целая часть не длиннее
 * MAX_INT_DIGITS, дробная — не длиннее 6 знаков. Иначе лишние знаки округлялись бы в toMicro и давали
 * «странности» (напр. 0.0000001 → 0), а длинное целое вылезало бы за карточку и теряло точность.
 */
function sanitizeAmount(raw: string): string {
  const s = raw.replace(",", ".").replace(/[^\d.]/g, "");
  const dot = s.indexOf(".");
  if (dot === -1) return s.slice(0, MAX_INT_DIGITS);
  const int = s.slice(0, dot).slice(0, MAX_INT_DIGITS);
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
  const [blockDismissed, setBlockDismissed] = useState(false);
  const donate = useDonate(channel.id);
  // Заблокирован ли донор на этом канале (для плашки): свой блок + причина.
  const myBlock = useMyBlock(channel.id, session.address).data;
  // Баланс USDC кошелька кладёт в кэш HeaderBalance (chain-режим). Здесь только ПОДПИСЫВАЕМСЯ на тот же ключ
  // (enabled:false — свой запрос не шлём). В mock/api ключа нет → balance остаётся undefined и проверка не
  // применяется. Не тянем wallet-adapter в общий бандл.
  const balanceQ = useQuery<number>({
    queryKey: ["usdcBalance", session.address ?? ""],
    queryFn: () => new Promise<number>(() => {}), // не вызывается (enabled:false)
    enabled: false,
  });

  const connected = Boolean(session.address);
  const isBasic = channel.status === "BASIC";
  const amountNum = Number(amount);
  const amountPositive = amount !== "" && Number.isFinite(amountNum) && amountNum > 0;
  const overMax = amountPositive && amountNum > MAX_DONATION_USDC;
  const amountValid = amountPositive && !overMax;
  const min = withText ? config.minDonationWithText : config.minDonation;
  const micro = amountValid ? toMicro(amountNum) : 0n;
  const meetsMin = amountValid && micro >= min;
  const textOk = !withText || text.trim().length > 0;
  // Хватает ли USDC на кошельке (только chain — где balance известен). amountNum и balance оба в USDC.
  const balance = session.address ? balanceQ.data : undefined;
  const insufficient = balance != null && amountValid && amountNum > balance;
  // Канальный блок бьёт только по тексту: донат без текста разрешён, с текстом — сервер откажет
  // (BLOCKED), поэтому и кнопку честно гасим (плашка выше объясняет причину).
  const blockedWithText = withText && Boolean(myBlock);
  const canDonate =
    connected &&
    amountValid &&
    meetsMin &&
    textOk &&
    !(withText && isBasic) &&
    !blockedWithText &&
    !insufficient;
  const softWarn = withText && SOFT_WORDS.some((w) => text.toLowerCase().includes(w));
  const amountError = overMax
    ? `Максимум ${formatPoints(MAX_DONATION_USDC)} USDC за раз`
    : amountPositive && !meetsMin
      ? "Ниже минимума канала"
      : insufficient
        ? "Недостаточно USDC на кошельке"
        : undefined;

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

  // H1: канал без подписи payout — в chain-режиме провайдер откажется собирать tx (PAYOUT_UNATTESTED),
  // поэтому вместо формы честный disabled-state с объяснением (никаких заглушек-обманок, CLAUDE.md §7).
  if (IS_CHAIN && !channel.payoutAttestation) {
    return (
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-[var(--bg)] p-4">
        <h3 className="text-h3 text-fg">Задонатить</h3>
        <p className="text-small text-fg-muted">
          Донаты приостановлены: канал ещё не подтвердил адрес выплат подписью кошелька владельца
          (защита от подмены адреса). Стример включает донаты одной подписью в настройках студии.
        </p>
      </div>
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
      {/* Плашка для заблокированного донора: за что и что заблокирован; крестик скрывает её. */}
      {myBlock && !blockDismissed ? (
        <div className="flex items-start gap-2 rounded-lg border border-danger bg-danger-bg p-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-small font-medium text-danger">
              Ты заблокирован на этом канале
            </span>
            <span className="text-small text-fg-muted">
              Донаты с сообщением сюда не проходят
              {myBlock.reason ? <> · причина: {myBlock.reason}</> : null}. Задонатить без текста можно.
            </span>
          </div>
          <button
            type="button"
            aria-label="Скрыть"
            onClick={() => setBlockDismissed(true)}
            className="-mr-1 -mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-faint transition-colors hover:bg-surface-raised hover:text-fg"
          >
            ✕
          </button>
        </div>
      ) : null}

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
          error={amountError}
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
