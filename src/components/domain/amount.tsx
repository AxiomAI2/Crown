import { splitAmount } from "@/lib/chain/addresses";
import { cn, formatUSDC } from "@/lib/utils";

/** A monetary amount: mono, tabular-nums. variant="money" — for confirmed/final (design-system §2). */
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

/** The 97/3 fee split right in the crown widget (screens.md). */
export function FeeSplit({ amount }: { amount: bigint }) {
  const { fee, net } = splitAmount(amount);
  return (
    <div className="flex flex-col gap-1.5 rounded border border-border bg-[var(--bg)] p-3 text-small">
      <div className="flex items-center justify-between">
        <span className="text-fg-muted">To content maker 97%</span>
        <Amount micro={net} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-fg-muted">To platform 3%</span>
        <Amount micro={fee} />
      </div>
      <div className="mt-1 flex items-center justify-between border-t border-border pt-2">
        <span className="text-fg">Total</span>
        <Amount micro={amount} className="text-fg" />
      </div>
    </div>
  );
}
