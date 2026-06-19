import { cn, formatUSDC } from "@/lib/utils";

/** Денежная сумма: моно, tabular-nums. variant="money" — для подтверждённого/финального (design-system §2). */
export function Amount({
  micro,
  variant = "default",
  className,
}: {
  micro: bigint;
  variant?: "default" | "money";
  className?: string;
}) {
  return (
    <span className={cn("mono tabular-nums", variant === "money" && "text-money", className)}>
      {formatUSDC(micro)}
    </span>
  );
}

/** Разбивка комиссии 97/3 прямо в виджете доната (screens.md). */
export function FeeSplit({ amount }: { amount: bigint }) {
  const fee = (amount * 3n) / 100n;
  const net = amount - fee;
  return (
    <div className="flex flex-col gap-1.5 rounded border border-border bg-surface p-3 text-small">
      <div className="flex items-center justify-between">
        <span className="text-fg-muted">Стримеру 97%</span>
        <Amount micro={net} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-fg-muted">Платформе 3%</span>
        <Amount micro={fee} />
      </div>
      <div className="mt-1 flex items-center justify-between border-t border-border pt-2">
        <span className="text-fg">Итого</span>
        <Amount micro={amount} className="text-fg" />
      </div>
    </div>
  );
}
