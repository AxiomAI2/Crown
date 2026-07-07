import type { PageTheme, PageWidget } from "@/lib/data/types";

/** The default rail stack when the owner never touched widgets — exactly the pre-widgets page: the Crown form. */
export const DEFAULT_PAGE_WIDGETS: PageWidget[] = [{ id: "donate", type: "donate", enabled: true }];

/** Resolve a theme's widget stack: the saved list, or the default. Shared by the public page and the builder
 *  preview so both render the same thing. */
export function pageWidgets(theme?: PageTheme): PageWidget[] {
  return theme?.widgets && theme.widgets.length > 0 ? theme.widgets : DEFAULT_PAGE_WIDGETS;
}

/** Default quick-pick amounts (USDC) on the Crown form when the owner hasn't set their own. */
export const DEFAULT_PRESET_AMOUNTS = [5, 10, 25, 50];

/** The Crown form's suggested amounts: the owner's list (positive, finite, deduped, capped at 6), or the default. */
export function donateAmounts(theme?: PageTheme): number[] {
  const raw = pageWidgets(theme).find((w) => w.type === "donate")?.amounts;
  const clean = (raw ?? [])
    .filter((n) => Number.isFinite(n) && n > 0)
    .filter((n, i, a) => a.indexOf(n) === i)
    .slice(0, 6);
  return clean.length > 0 ? clean : DEFAULT_PRESET_AMOUNTS;
}
