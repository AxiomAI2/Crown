"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

type TableData = Record<string, { count: number; rows: Record<string, unknown>[] }>;

const disp = (v: unknown): string =>
  v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);

/** DEV-смотрелка БД: выбор таблицы + сортировка по столбцам. Данные из /api/dev/db (только вне прода). */
export default function DbViewerPage() {
  const [data, setData] = useState<TableData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<string>("");
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    fetch("/api/dev/db")
      .then((r) => r.json())
      .then((d: TableData) => {
        if ((d as { error?: string }).error) {
          setError((d as { error?: string }).error ?? "Ошибка");
          return;
        }
        setData(d);
        setActive(Object.keys(d)[0] ?? "");
      })
      .catch((e) => setError(String(e)));
  }, []);

  const current = data && active ? data[active] : null;
  const cols = current?.rows[0] ? Object.keys(current.rows[0]) : [];

  const rows = useMemo(() => {
    if (!current) return [];
    const r = [...current.rows];
    if (sortCol) {
      r.sort((a, b) => {
        const av = a[sortCol];
        const bv = b[sortCol];
        const an = Number(av);
        const bn = Number(bv);
        const numeric =
          av !== "" && bv !== "" && av != null && bv != null && Number.isFinite(an) && Number.isFinite(bn);
        const c = numeric ? an - bn : disp(av).localeCompare(disp(bv), "ru");
        return sortDir === "asc" ? c : -c;
      });
    }
    return r;
  }, [current, sortCol, sortDir]);

  const toggleSort = (c: string) => {
    if (sortCol === c) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortCol(c);
      setSortDir("asc");
    }
  };

  return (
    <main className="mx-auto flex max-w-content flex-col gap-4 px-4 py-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-display-l text-fg">База данных</h1>
        <p className="text-small text-fg-muted">
          Данные приложения в таблицах Postgres (папка <span className="mono">.data/pg</span>). Выбери
          таблицу, кликни по заголовку столбца для сортировки. Это dev-смотрелка, в проде закрыта.
        </p>
      </div>

      {error ? (
        <p className="rounded-lg border border-danger bg-danger-bg p-3 text-small text-danger">{error}</p>
      ) : !data ? (
        <p className="text-small text-fg-faint">Загрузка…</p>
      ) : (
        <>
          {/* Выбор таблицы */}
          <div className="flex flex-wrap gap-2">
            {Object.entries(data).map(([name, t]) => (
              <button
                key={name}
                type="button"
                onClick={() => {
                  setActive(name);
                  setSortCol(null);
                }}
                className={cn(
                  "flex items-center gap-2 rounded-pill border px-3 py-1.5 text-small transition-colors",
                  active === name
                    ? "border-border-strong bg-surface-raised text-fg"
                    : "border-border text-fg-muted hover:border-border-strong hover:text-fg",
                )}
              >
                {name}
                <span className="mono text-fg-faint">{t.count}</span>
              </button>
            ))}
          </div>

          {/* Таблица */}
          {!current || current.rows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-small text-fg-faint">
              Таблица пуста.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full border-collapse text-small">
                <thead>
                  <tr>
                    {cols.map((c) => (
                      <th
                        key={c}
                        onClick={() => toggleSort(c)}
                        className="cursor-pointer select-none whitespace-nowrap border-b border-border bg-surface-raised px-3 py-2 text-left font-medium text-fg-muted transition-colors hover:text-fg"
                        title="Сортировать"
                      >
                        {c}
                        {sortCol === c ? (
                          <span className="ml-1 text-info">{sortDir === "asc" ? "▲" : "▼"}</span>
                        ) : null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i} className="even:bg-[var(--surface-2)]">
                      {cols.map((c) => {
                        const text = disp(row[c]);
                        return (
                          <td
                            key={c}
                            title={text}
                            className="mono max-w-[28ch] truncate whitespace-nowrap border-b border-border px-3 py-1.5 text-fg-muted"
                          >
                            {text}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-small text-fg-faint">
            Показано строк: {rows.length}
            {current && current.count > rows.length ? ` из ${current.count} (лимит 500)` : ""}.
          </p>
        </>
      )}
    </main>
  );
}
