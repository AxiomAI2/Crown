import { decode, encode } from "@/lib/data/codec";
import type { Address } from "@/lib/data/types";
import { issueNonce, resolveToken, revokeToken, verifyAndIssueToken } from "@/server/auth";
import { ingestActivation, ingestSignature } from "@/server/ingest";
import { runWithIdentity } from "@/server/request-context";
import { CHAIN_MODE, IS_PROD } from "@/server/runtime";
import { getStore } from "@/server/store";

export const dynamic = "force-dynamic";

// C1/M2: IS_PROD и серверный CHAIN_MODE живут в @/server/runtime (единая формула для гейта и зачёта).
// CHAIN_MODE → оффчейн-симуляция доната запрещена: любой вошедший по SIWS кошелёк иначе наколдовал бы
// донат+репутацию+оверлей мимо цепочки (нарушение §4.4/§4.7). Репутацию даёт только ingestSignature.
// activateChannel так же: оффчейн-флип в ACTIVE мимо сбора → только ингест ончейн-сбора (ingestActivation).
const CHAIN_FORBIDDEN = new Set<string>(["createDonation", "activateChannel"]);

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
  store.__setFailMode(!IS_PROD && Boolean(body.failMode)); // L1: инъекция ошибок — только dev-тулинг, не из прода

  // Личность запроса — ТОЛЬКО из проверенного токена. В dev (не prod) допускаем вход по адресу без
  // подписи для mock/api-тулинга; в проде `address` игнорируется полностью (дыра C1 закрыта).
  // H3: личность НЕ кладётся в поле singleton-стора — она несётся per-request через AsyncLocalStorage
  // (runWithIdentity вокруг диспатча ниже), иначе конкурентные RPC перетирали бы сессию друг друга.
  const verified = resolveToken(body.token);
  const identity = verified ?? (IS_PROD ? null : (body.address ?? null));

  // Dev-сброс стора — только вне прода и никогда из обычного диспатча.
  if (body.method === "__reset") {
    if (IS_PROD) return rpcError("BAD_METHOD", "Метод недоступен.", 403);
    store.__reset();
    return json({ ok: true, result: null });
  }

  // Спец-метод: приём ончейн-доната по подписи (сервер валидирует из цепочки, см. server/ingest.ts).
  if (body.method === "ingestSignature") {
    const sig = body.args?.[0];
    const text = body.args?.[1];
    if (typeof sig !== "string") return rpcError("BAD_ARGS", "нужна signature", 400);
    try {
      const result = await ingestSignature(store, sig, typeof text === "string" ? text : undefined);
      return json({ ok: true, result });
    } catch (e) {
      // Кривая/неизвестная подпись (или сбой RPC) роняла публичный эндпоинт в 500 — отдаём чистую ошибку.
      const err = e as { code?: string; message?: string };
      return json({
        ok: false,
        error: { code: err.code ?? "INGEST_ERROR", message: err.message ?? String(e) },
      });
    }
  }

  // Спец-метод: приём ончейн-сбора активации по подписи (сервер валидирует из цепочки, см. server/ingest.ts).
  if (body.method === "ingestActivation") {
    const sig = body.args?.[0];
    if (typeof sig !== "string") return rpcError("BAD_ARGS", "нужна signature", 400);
    try {
      const result = await ingestActivation(store, sig);
      return json({ ok: true, result });
    } catch (e) {
      const err = e as { code?: string; message?: string };
      return json({
        ok: false,
        error: { code: err.code ?? "INGEST_ERROR", message: err.message ?? String(e) },
      });
    }
  }

  // C1: оффчейн-симуляция доната недоступна в chain-режиме — репутацию даёт только ingestSignature.
  if (CHAIN_MODE && CHAIN_FORBIDDEN.has(body.method)) {
    return rpcError(
      "CHAIN_MODE",
      "Оффчейн-симуляция доната отключена: в chain-режиме донат идёт ончейн (ingestSignature).",
      403,
    );
  }

  if (!ALLOWED.has(body.method)) {
    return rpcError("BAD_METHOD", `Метод не разрешён: ${body.method}`, 400);
  }

  // Явный выход — гасим серверную сессию (токен).
  if (body.method === "disconnect") revokeToken(body.token);

  const fn = (store as unknown as Record<string, ((...a: unknown[]) => unknown) | undefined>)[
    body.method
  ];
  if (typeof fn !== "function") {
    return rpcError("BAD_METHOD", `Метод не найден: ${body.method}`, 400);
  }

  try {
    // H3: диспатч идёт в контексте per-request личности (AsyncLocalStorage), а не из поля singleton —
    // конкурентные RPC не перетирают друг другу сессию, в т.ч. при реальных await (Postgres).
    const result = await runWithIdentity(identity, () => fn.apply(store, body.args ?? []));
    return json({ ok: true, result });
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return json({
      ok: false,
      error: { code: err.code ?? "ERROR", message: err.message ?? String(e) },
    });
  }
}
