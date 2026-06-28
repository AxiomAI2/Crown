import { getDb } from "@/server/db";

/**
 * DEV-смотрелка БД: HTML-страница с таблицами Postgres, числом строк и примерами строк — чтобы наглядно
 * увидеть, что данные приложения живут в реальной базе. Только вне прода. Имена таблиц — фиксированный
 * список (не из пользовательского ввода), поэтому интерполяция в SQL безопасна.
 */
const TABLES = [
  "channels",
  "channel_configs",
  "light_profiles",
  "ledger_events",
  "donations",
  "messages",
  "channel_blocks",
  "operator_actions",
  "incident_logs",
  "reports",
  "meta",
] as const;

function cell(v: unknown): string {
  const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  const short = s.length > 70 ? s.slice(0, 67) + "…" : s;
  return short.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);
}

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return new Response("Доступно только в dev.", { status: 404 });
  }
  const db = await getDb();
  const sections: string[] = [];
  for (const t of TABLES) {
    const c = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t}`);
    const s = await db.query<Record<string, unknown>>(`SELECT * FROM ${t} LIMIT 5`);
    const n = c.rows[0]?.n ?? 0;
    let table = '<p class="empty">— пусто —</p>';
    const first = s.rows[0];
    if (first) {
      const cols = Object.keys(first);
      const head = cols.map((k) => `<th>${cell(k)}</th>`).join("");
      const body = s.rows
        .map((row) => `<tr>${cols.map((k) => `<td>${cell(row[k])}</td>`).join("")}</tr>`)
        .join("");
      table = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    }
    sections.push(`<h2>${t} <span class="n">${n} строк</span></h2>${table}`);
  }

  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>База данных (dev)</title>
<style>
  body{background:#0e0f13;color:#eceef3;font:14px/1.5 system-ui,sans-serif;margin:0;padding:24px;}
  h1{font-size:20px;margin:0 0 4px;} .sub{color:#9aa1b2;margin:0 0 24px;}
  h2{font-size:15px;margin:28px 0 8px;border-bottom:1px solid #2a2e3a;padding-bottom:6px;}
  .n{color:#6e8bff;font-weight:400;font-size:13px;margin-left:6px;}
  table{border-collapse:collapse;width:100%;font-size:12px;display:block;overflow-x:auto;}
  th,td{border:1px solid #2a2e3a;padding:4px 8px;text-align:left;white-space:nowrap;}
  th{color:#9aa1b2;font-weight:500;background:#15171e;}
  td{font-family:ui-monospace,monospace;color:#c9cdd6;}
  .empty{color:#6b7282;margin:4px 0;}
</style></head><body>
<h1>База данных — Postgres (PGlite)</h1>
<p class="sub">Данные приложения живут в этих таблицах (папка <code>.data/pg</code>). Показаны счётчики и до 5 строк-примеров. Это dev-смотрелка, в проде недоступна.</p>
${sections.join("")}
</body></html>`;

  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
