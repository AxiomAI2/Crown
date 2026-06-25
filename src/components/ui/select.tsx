"use client";

import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckIcon, ChevronDownIcon } from "./icons";
import { cn } from "@/lib/utils";

interface OptionData {
  value: string;
  label: ReactNode;
  disabled: boolean;
}

/**
 * Кастомный селект в стиле сайта (нативный <select> рисует выпадашку силами ОС — выбивается из тёмной темы).
 * API совместим с прежним нативным: принимает <option>-детей и зовёт onChange({target:{value}}), поэтому
 * места вызова не меняются. Выпадашка — обычный DOM (стилизуется), с клавиатурой и закрытием по клику вне.
 */
export interface SelectProps {
  label?: string;
  helper?: string;
  value?: string;
  onChange?: (e: { target: { value: string } }) => void;
  className?: string; // на триггер (напр. ширина)
  disabled?: boolean;
  id?: string;
  placeholder?: string;
  "aria-label"?: string;
  children?: ReactNode;
}

function readOptions(children: ReactNode): OptionData[] {
  const out: OptionData[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child) || child.type !== "option") return;
    const props = child.props as { value?: string | number; children?: ReactNode; disabled?: boolean };
    const value = props.value != null ? String(props.value) : String(props.children ?? "");
    out.push({ value, label: props.children ?? value, disabled: Boolean(props.disabled) });
  });
  return out;
}

export function Select({
  label,
  helper,
  value,
  onChange,
  className,
  disabled,
  id,
  placeholder,
  children,
  ...rest
}: SelectProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  const ariaLabel = (rest as Record<string, unknown>)["aria-label"] as string | undefined;

  const options = readOptions(children);
  const selected = options.find((o) => o.value === value);

  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function openMenu() {
    if (disabled) return;
    const sel = options.findIndex((o) => o.value === value);
    setActiveIdx(sel >= 0 ? sel : options.findIndex((o) => !o.disabled));
    setOpen(true);
  }
  function choose(idx: number) {
    const o = options[idx];
    if (!o || o.disabled) return;
    onChange?.({ target: { value: o.value } });
    setOpen(false);
    triggerRef.current?.focus();
  }
  function moveActive(delta: number) {
    setActiveIdx((cur) => {
      let i = cur < 0 ? 0 : cur;
      for (let step = 0; step < options.length; step++) {
        i = (i + delta + options.length) % options.length;
        if (!options[i]?.disabled) return i;
      }
      return cur;
    });
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveActive(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveActive(-1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(activeIdx);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIdx(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIdx(options.length - 1);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <label htmlFor={selectId} className="text-small text-fg-muted">
          {label}
        </label>
      ) : null}
      <div ref={rootRef} className="relative">
        <button
          id={selectId}
          ref={triggerRef}
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-controls={`${selectId}-listbox`}
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          onClick={() => (open ? setOpen(false) : openMenu())}
          onKeyDown={onKeyDown}
          className={cn(
            "flex h-10 w-full items-center justify-between gap-2 rounded border border-border bg-surface px-3 text-body text-fg",
            "transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-info",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <span className={cn("truncate", !selected && "text-fg-faint")}>
            {selected ? selected.label : (placeholder ?? "—")}
          </span>
          <ChevronDownIcon
            className={cn("h-4 w-4 shrink-0 text-fg-faint transition-transform", open && "rotate-180")}
          />
        </button>

        {open ? (
          <ul
            id={`${selectId}-listbox`}
            role="listbox"
            className="scroll-thin absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-auto rounded-lg border border-border bg-surface-raised p-1 shadow-lg"
          >
            {options.map((o, i) => {
              const isSel = o.value === value;
              return (
                <li key={o.value} role="option" aria-selected={isSel}>
                  <button
                    type="button"
                    disabled={o.disabled}
                    onClick={() => choose(i)}
                    onMouseEnter={() => setActiveIdx(i)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded px-3 py-2 text-left text-small transition-colors",
                      i === activeIdx ? "bg-surface text-fg" : "text-fg-muted",
                      isSel && "text-fg",
                      o.disabled && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <span className="truncate">{o.label}</span>
                    {isSel ? <CheckIcon className="h-3.5 w-3.5 shrink-0 text-status" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
      {helper ? <span className="text-small text-fg-faint">{helper}</span> : null}
    </div>
  );
}
