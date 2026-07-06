"use client";

/**
 * Persistent pill search bar (magnifier + input on one line), styled after the bobounty catalog search:
 * rounded-full, subtle gold-tinted border on a card surface, muted magnifier. Unlike ExpandingSearch it's
 * always open — used as the primary catalog search. Controlled: value + onChange.
 */
export function SearchBar({
  value,
  onChange,
  placeholder = "Search…",
  label,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={
        "flex items-center gap-2.5 rounded-full border border-border bg-surface px-4 py-2 transition-colors focus-within:border-border-strong " +
        (className ?? "")
      }
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4 shrink-0 text-fg-faint"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="M21 21l-4.35-4.35" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        className="min-w-0 flex-1 bg-transparent text-small text-fg outline-none placeholder:text-fg-faint"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="shrink-0 text-fg-faint transition-colors hover:text-fg"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
