"use client";

import { useRef, useState } from "react";
import { SearchIcon, XIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

/**
 * A compact magnifier that grows into a full search field on click/focus (width animation); filters the list
 * live. Collapses back into an icon on blur if empty. Respects reduced-motion (a global rule in
 * globals.css neutralizes the transition). Shared: the realm catalog (size "lg") and the realm feed ("md").
 */
export function ExpandingSearch({
  value,
  onChange,
  placeholder = "Search…",
  label = "Search",
  size = "md",
  alwaysOpen = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label?: string;
  size?: "md" | "lg";
  /** Start already open (visible field, not just the magnifier) and never collapse. */
  alwaysOpen?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const expanded = alwaysOpen || focused || value.length > 0;
  const lg = size === "lg";

  // Height GROWS on focus (taller field) — the main "increase" the field animates.
  const hBase = lg ? "h-14" : "h-10";
  const hFocus = lg ? "h-16" : "h-12";
  const h = focused ? hFocus : hBase;
  const square = lg ? "w-14" : "w-10";
  // Open width: a base, and a WIDER width on focus → the field still animates (grows) even when always-open.
  const openBase = lg ? "w-72 sm:w-[32rem]" : "w-52 sm:w-72";
  const openWide = lg ? "w-80 sm:w-[42rem]" : "w-56 sm:w-80";
  const width = alwaysOpen ? (focused ? openWide : openBase) : expanded ? openBase : square;
  const pl = lg ? "pl-14" : "pl-10";
  const pr = lg ? "pr-14" : "pr-9";
  const icon = lg ? "h-6 w-6" : "h-[18px] w-[18px]";
  const text = lg ? "text-lg" : "text-small";

  return (
    <div
      className={cn(
        "relative flex flex-none items-center transition-[width,height] duration-slow ease-ease",
        h,
        width,
      )}
    >
      <button
        type="button"
        aria-label={label}
        onClick={() => inputRef.current?.focus()}
        className={cn(
          "absolute left-0 z-10 grid flex-none place-items-center text-fg-faint transition-[color,height] duration-slow ease-ease hover:text-fg",
          h,
          square,
        )}
      >
        <SearchIcon className={icon} />
      </button>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        aria-label={label}
        className={cn(
          "w-full rounded-lg border bg-surface text-fg outline-none",
          h,
          pl,
          pr,
          text,
          "transition-[opacity,border-color,box-shadow,height] duration-slow ease-ease placeholder:text-fg-faint",
          expanded
            ? "border-border opacity-100 focus:border-money-dim focus:shadow-[0_12px_44px_-14px_rgba(228,179,76,0.35)]"
            : "cursor-pointer border-transparent bg-transparent opacity-0",
        )}
      />
      {value.length > 0 ? (
        <button
          type="button"
          aria-label="Clear"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          className={cn(
            "absolute right-0 z-10 grid flex-none place-items-center text-fg-faint transition-[color,height] duration-slow ease-ease hover:text-fg",
            h,
            square,
          )}
        >
          <XIcon className={icon} />
        </button>
      ) : null}
    </div>
  );
}
