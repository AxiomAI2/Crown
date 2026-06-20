import { decode, encode } from "@/lib/data/codec";
import type { Address } from "@/lib/data/types";
import { issueNonce, resolveToken, revokeToken, verifyAndIssueToken } from "@/server/auth";
import { ingestSignature } from "@/server/ingest";
import { getStore } from "@/server/store";

export const dynamic = "force-dynamic";

const IS_PROD = process.env.NODE_ENV === "production";

// Белый список разрешённых методов стора (методы DataProvider). Авторизацию каждой мутации делает сам
// store по проверенной личности; здесь — только транспорт. Dev-методы (__reset) и auth-методы (__auth*)
// сюда НЕ входят — они обрабатываются явными ветками ниже.
const ALLOWED = new Set<string>([
  "getSession",
  "connect",
  "disconnect",
  "getProfile",
  "updateProfile",
  "listChannels",
  "getChannel",
  "getMyChannel",
  "getChannelConfig",
  "createChannel",
  "activateChannel",
  "updateChannelConfig",
  "getStanding",
  "getLeaderboard",
  "createDonation",
  "listDonations",
  "getModerationQueue",
  "setMessageState",
  "getChannelBlocklist",
  "addChannelBlock",
  "removeChannelBlock",
  "getOperatorQueue",
  "applyOperatorAction",
  "getIncidentLog",
]);

interface RpcBody {
  method: string;
  args: unknown[];
  token?: string | null; // session-токен (выдан после проверки SIWS-подписи) — проверенная личность
  address?: Address | null; // DEV-вход по адресу без подписи; в проде ИГНОРИРУЕТСЯ
  failMode?: boolean;
}

function json(payload: unknown, status = 200): Response {
  return new Response(encode(payload), { status, headers: { "content-type": "application/json" } });
}
function rpcError(code: string, message: string, status = 200): Response {
  return json({ ok: false, error: { code, message } }, status);
}

export async function POST(req: Request): Promise<Response> {
  let body: RpcBody;
  try {
    body = decode<RpcBody>(await req.text());
  } catch {
    return rpcError("BAD_BODY", "Невалидное тело запроса", 400);
  }

  // — Аутентификация (публичные методы: устанавливают личность, сами её не требуют) —
  if (body.method === "__authNonce") {
    const address = body.args?.[0];
    if (typeof address !== "string") return rpcError("BAD_ARGS", "нужен address", 400);
    const res = issueNonce(address);
    if (!res) return rpcError("AUTH_BAD_ADDRESS", "Невалидный Solana-адрес.");
    return json({ ok: true, result: res });
  }
  if (body.method === "__authVerify") {
    const [address, signatureB64] = body.args ?? [];
    if (typeof address !== "string" || typeof signatureB64 !== "string") {
      return rpcError("BAD_ARGS", "нужны address и signature", 400);
    }
    const res = verifyAndIssueToken(address, signatureB64);
    if (!res) return rpcError("AUTH_FAILED", "Подпись не прошла проверку (или nonce истёк).");
    return json({ ok: true, result: res });
  }

  const store = getStore();
  store.__setLatencyScale(0);
  store.__setFailMode(Boolean(body.failMode));

  // Личность запроса — ТОЛЬКО из проверенного токена. В dev (не prod) допускаем вход по адресу без
  // подписи для mock/api-тулинга; в проде `address` игнорируется полностью (дыра C1 закрыта).
  const verified = resolveToken(body.token);
  const identity = verified ?? (IS_PROD ? null : (body.address ?? null));
  store.__setAddress(identity);

  // Dev-сброс стора — только вне прода и никогда из обычного диспатча.
  if (body.method === "__reset") {
    if (IS_PROD) return rpcError("BAD_METHOD", "Метод недоступен.", 403);
    store.__reset();
    return json({ ok: true, result: null });
  }

  // Спец-метод: приём ончейн-доната по подписи (сервер валидирует из цепочки, см. server/ingest.ts).
  if (body.method === "ingestSignature") {
    const sig = body.args?.[0];
    if (typeof sig !== "string") return rpcError("BAD_ARGS", "нужна signature", 400);
    const result = await ingestSignature(store, sig);
    return json({ ok: true, result });
  }

  if (!ALLOWED.has(body.method)) {
    return rpcError("BAD_METHOD", `Метод не разрешён: ${body.method}`, 400);
  }

  // Явный выход — гасим серверную сессию (токен).
  if (body.method === "disconnect") revokeToken(body.token);

  const fn = (store as unknown as Record<string, ((...a: unknown[]) => unknown) | undefined>)[body.method];
  if (typeof fn !== "function") {
    return rpcError("BAD_METHOD", `Метод не найден: ${body.method}`, 400);
  }

  try {
    const result = await fn.apply(store, body.args ?? []);
    return json({ ok: true, result });
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return json({ ok: false, error: { code: err.code ?? "ERROR", message: err.message ?? String(e) } });
  }
}
