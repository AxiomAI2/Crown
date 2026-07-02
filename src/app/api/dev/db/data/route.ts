import { IS_PROD, OPERATOR_ADDRESS } from "@/lib/chain/addresses";
import { resolveToken } from "@/server/auth";
import { getDb } from "@/server/db";

/**
 * Данные таблиц Postgres для смотрелки /dev/db — ТОЛЬКО для оператора (в таблицах есть приватный текст
 * сообщений, инциденты, жалобы). POST с session-токеном; пускаем, лишь если токен резолвится в адрес
 * оператора (OPERATOR_ADDRESS). Имена таблиц — фиксированный список, интерполяция в SQL безопасна.
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

export async function POST(request: Request) {
  // Паритет с /dev/* (layout → notFound): в проде dev-поверхности не существует, включая этот API.
  if (IS_PROD) return new Response(null, { status: 404 });
  const body = (await request.json().catch(() => null)) as { token?: string } | null;
  const addr = resolveToken(body?.token);
  if (!OPERATOR_ADDRESS || addr !== OPERATOR_ADDRESS) {
    return Response.json({ error: "Только для оператора. Подключи операторский кошелёк." }, { status: 403 });
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
