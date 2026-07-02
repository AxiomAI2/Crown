import { decode, encode } from "@/lib/data/codec";
import { DataError } from "@/lib/data/provider";
import type { Address } from "@/lib/data/types";
import { issueNonce, resolveToken, revokeToken, verifyAndIssueToken } from "@/server/auth";
import { ingestActivation, ingestSignature } from "@/server/ingest";
import { runWithIdentity } from "@/server/request-context";
import { CHAIN_MODE, IS_PROD } from "@/server/runtime";
import { getStore, persistStore } from "@/server/store";

export const dynamic = "force-dynamic";

// C1/M2: IS_PROD и серверный CHAIN_MODE живут в @/server/runtime (единая формула для гейта и зачёта).
// CHAIN_MODE → оффчейн-симуляция доната запрещена: любой вошедший по SIWS кошелёк иначе наколдовал бы
// донат+репутацию+оверлей мимо цепочки (нарушение §4.4/§4.7). Репутацию даёт только ingestSignature.
// activateChannel так же: оффчейн-флип в ACTIVE мимо сбора → только ингест ончейн-сбора (ingestActivation).
const CHAIN_FORBIDDEN = new Set<string>(["createDonation", "activateChannel"]);

// Методы, меняющие состояние стора → после них планируем сохранение на диск (ADR 0013). Читающие методы
// не пишут (лишние записи ни к чему). ingest*/__reset обрабатываются отдельными ветками и сохраняют там же.
const MUTATING = new Set<string>([
  "createChannel",
  "activateChannel",
  "attestPayout",
  "updateChannelConfig",
  "createDonation",
  "updateProfile",
  "setMessageState",
  "hideDonorMessages",
  "reportMessage",
  "addChannelBlock",
  "removeChannelBlock",
  "applyOperatorAction",
  "gameAction", // мутации мини-игр (game-bus, ADR 0016)
]);

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
  "getManagedChannels",
  "getOperatorChannels",
  "getChannelConfig",
  "createChannel",
  "activateChannel",
  "attestPayout",
  "updateChannelConfig",
  "hideDonorMessages",
  "getStanding",
  "getLeaderboard",
  "getDonorOverview",
  "homeFeed",
  "createDonation",
  "precheckText",
  "listDonations",
  "getModerationQueue",
  "setMessageState",
  "reportMessage",
  "getChannelBlocklist",
  "getMyChannelBlock",
  "addChannelBlock",
  "removeChannelBlock",
  "getOperatorQueue",
  "applyOperatorAction",
  "gameAction", // мини-игры (game-bus, ADR 0016)
  "gameQuery",
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
// R4 (ADR 0012): клиенту отдаём текст ошибки ТОЛЬКО для доменных DataError (они написаны для пользователя).
// Прочие (web3.js/PublicKey/сбой RPC/баг) → общий текст, а детали — в серверный лог, чтобы не утекали.
function caughtError(e: unknown, fallbackCode = "ERROR"): Response {
  if (e instanceof DataError)
    return json({ ok: false, error: { code: e.code, message: e.message } });
  console.error("[rpc] необработанная ошибка:", e);
  return json({ ok: false, error: { code: fallbackCode, message: "Внутренняя ошибка сервера." } });
}

export async function POST(req: Request): Promise<Response> {
  let body: RpcBody;
  try {
    body = decode<RpcBody>(await req.text());
  } catch {
    return rpcError("BAD_BODY", "Невалидное тело запроса", 400);
  }
  if (typeof body?.method !== "string") return rpcError("BAD_BODY", "нужен method", 400);
  // args нормализуем здесь: не-массив (объект/строка/число) ловим до dispatch, иначе fn.apply бросил бы
  // сырой TypeError, утекающий клиенту (R3, ADR 0012). undefined → пустой список аргументов.
  if (body.args === undefined || body.args === null) body.args = [];
  if (!Array.isArray(body.args)) return rpcError("BAD_ARGS", "args должен быть массивом", 400);

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

  const store = await getStore();
  store.__setLatencyScale(0);
  store.__setFailMode(!IS_PROD && Boolean(body.failMode)); // L1: инъекция ошибок — только dev-тулинг, не из прода

  // Личность запроса — ТОЛЬКО из проверенного токена. Вход по голому адресу без подписи допускается
  // лишь как dev-тулинг для mock/api и ТОЛЬКО когда это безопасно: не prod И не денежный chain-режим.
  // Иначе (prod, либо staging в chain-режиме без NODE_ENV=production) `address` игнорируется — иначе
  // любой бы выдал себя за владельца/оператора при работающих деньгах (расширение C1-защиты, ADR 0012).
  // Личность НЕ кладётся в поле singleton-стора — она несётся per-request через AsyncLocalStorage
  // (runWithIdentity вокруг диспатча ниже), иначе конкурентные RPC перетирали бы сессию друг друга.
  const allowDevIdentity = !IS_PROD && !CHAIN_MODE;
  const verified = resolveToken(body.token);
  const identity = verified ?? (allowDevIdentity ? (body.address ?? null) : null);

  // Dev-сброс стора — только вне прода и никогда из обычного диспатча.
  if (body.method === "__reset") {
    if (IS_PROD) return rpcError("BAD_METHOD", "Метод недоступен.", 403);
    store.__reset();
    persistStore();
    return json({ ok: true, result: null });
  }

  // Спец-метод: приём ончейн-доната по подписи (сервер валидирует из цепочки, см. server/ingest.ts).
  if (body.method === "ingestSignature") {
    const sig = body.args?.[0];
    const text = body.args?.[1];
    if (typeof sig !== "string") return rpcError("BAD_ARGS", "нужна signature", 400);
    try {
      const result = await ingestSignature(store, sig, typeof text === "string" ? text : undefined);
      if (result.ok) persistStore(); // донат записан в стор → на диск
      return json({ ok: true, result });
    } catch (e) {
      // Кривая/неизвестная подпись или сбой RPC иначе ронял публичный эндпоинт в 500 (детали — в лог).
      return caughtError(e, "INGEST_ERROR");
    }
  }

  // Спец-метод: приём ончейн-сбора активации по подписи (сервер валидирует из цепочки, см. server/ingest.ts).
  if (body.method === "ingestActivation") {
    const sig = body.args?.[0];
    if (typeof sig !== "string") return rpcError("BAD_ARGS", "нужна signature", 400);
    try {
      const result = await ingestActivation(store, sig);
      if (result.ok) persistStore(); // канал активирован → на диск
      return json({ ok: true, result });
    } catch (e) {
      return caughtError(e, "INGEST_ERROR");
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
    const result = await runWithIdentity(identity, () => fn.apply(store, body.args));
    if (MUTATING.has(body.method)) persistStore(); // мутация удалась → планируем сохранение на диск
    return json({ ok: true, result });
  } catch (e) {
    return caughtError(e);
  }
}
