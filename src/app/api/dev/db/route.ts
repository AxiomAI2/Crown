import { getDb } from "@/server/db";

/**
 * DEV-эндпоинт: данные таблиц Postgres (число строк + до 500 строк) в JSON — для интерактивной смотрелки
 * /dev/db. Только вне прода. Имена таблиц — фиксированный список (не из пользовательского ввода), поэтому
 * интерполяция в SQL безопасна.
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

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "Доступно только в dev." }, { status: 404 });
  }
  const db = await getDb();
  const out: Record<string, { count: number; rows: Record<string, unknown>[] }> = {};
  for (const t of TABLES) {
    const c = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t}`);
    const s = await db.query<Record<string, unknown>>(`SELECT * FROM ${t} LIMIT 500`);
    out[t] = { count: c.rows[0]?.n ?? 0, rows: s.rows };
  }
  return Response.json(out);
}
