import { createPublicKey, randomBytes, verify as edVerify } from "crypto";
import { PublicKey } from "@solana/web3.js";
import { buildSiwsMessage, type SiwsFields } from "@/lib/chain/siws";
import { makeSaver, readSnapshot } from "@/server/persist";

/**
 * Серверная аутентификация (закрывает дыру: раньше личностью был НЕПРОВЕРЕННЫЙ `address` из тела запроса).
 *
 * Поток SIWS:
 *   1. `issueNonce(address)` — сервер выдаёт одноразовый nonce с TTL и каноническое сообщение.
 *   2. клиент подписывает сообщение кошельком (signMessage), шлёт подпись.
 *   3. `verifyAndIssueToken(address, sigB64)` — сервер проверяет ed25519-подпись над тем же сообщением,
 *      гасит nonce (one-time), выдаёт session-токен.
 *   4. последующие RPC несут токен; `resolveToken(token)` → проверенный address (или null).
 *
 * Проверка подписи — без новых зависимостей: встроенный node:crypto (ed25519) поверх сырого 32-байтного
 * Solana-pubkey (оборачиваем в SPKI DER). In-memory сторы nonce/сессий — стенд-ин под Postgres/Redis,
 * как и сам store; в проде переносятся в общий слой персистентности.
 */

const NONCE_TTL_MS = 5 * 60_000; // 5 минут на подпись
const SESSION_TTL_MS = 12 * 60 * 60_000; // 12 часов
// M1 (аудит): домен в SIWS-сообщении — пользователь видит, куда входит, и подпись не переносится меж-app.
const SIWS_DOMAIN = process.env.APP_DOMAIN ?? "standing.local";
// M1: жёсткие потолки на in-memory сторы — `__authNonce` неаутентифицирован, иначе рост памяти безграничен.
// B5: `prune` чистит ПРОТУХШИЕ первыми, поэтому честный nonce вытесняется (FIFO) лишь при > MAX_NONCES ЖИВЫХ
// одновременно — это требует устойчивого спрея многими адресами. Держим запас (записи крошечные); НАСТОЯЩАЯ
// защита неаутентифицированного эндпоинта от флуда — рейт-лимит на краю (Cloudflare/nginx), не в app-коде.
const MAX_NONCES = 50_000;
const MAX_SESSIONS = 50_000;

interface NonceRec {
  nonce: string;
  exp: number;
  issuedAt: number;
}
interface SessionRec {
  address: string;
  exp: number;
}

const g = globalThis as unknown as {
  __standingNonces?: Map<string, NonceRec>;
  __standingSessions?: Map<string, SessionRec>;
  __authLoaded?: boolean;
  __authSave?: () => void;
};
const nonces = (g.__standingNonces ??= new Map());
const sessions = (g.__standingSessions ??= new Map());

// Персистентность сессий (ADR 0013): SIWS-сессии переживают рестарт сервера → не нужно переподписываться
// после каждого перезапуска. nonce'ы НЕ сохраняем (живут 5 мин, транзиентны). Грузим один раз на процесс,
// отбрасывая протухшие. Сейвер — на globalThis, чтобы переживал HMR.
if (!g.__authLoaded) {
  g.__authLoaded = true;
  const persisted = readSnapshot<[string, SessionRec][]>("auth.json");
  if (persisted)
    for (const [token, rec] of persisted) if (rec.exp > Date.now()) sessions.set(token, rec);
}
const saveSessions = (g.__authSave ??= makeSaver("auth.json", () => [...sessions.entries()]));

/** Чистка протухших + ограничение размера (вытеснение старейших по insertion order) — анти-DoS памяти. */
function prune<T extends { exp: number }>(map: Map<string, T>, max: number): void {
  const now = Date.now();
  for (const [k, v] of map) if (v.exp < now) map.delete(k);
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

/** SIWS-поля из меток времени nonce — одинаковы при выдаче и проверке → сообщение байт-в-байт совпадает. */
function siwsFields(issuedAt: number, exp: number): SiwsFields {
  return {
    domain: SIWS_DOMAIN,
    issuedAt: new Date(issuedAt).toISOString(),
    expiresAt: new Date(exp).toISOString(),
  };
}

/** Валидный ли это base58 Solana-адрес на кривой ed25519 (авторитетная проверка, в отличие от формата). */
function isValidAddress(address: string): boolean {
  try {
    // PublicKey бросает на кривом base58; isOnCurve отсекает PDA/мусор (у входящего кошелька ключ на кривой).
    return PublicKey.isOnCurve(new PublicKey(address).toBytes());
  } catch {
    return false;
  }
}

/** Шаг 1: выдать nonce + сообщение для подписи. */
export function issueNonce(address: string): { nonce: string; message: string } | null {
  if (!isValidAddress(address)) return null;
  prune(nonces, MAX_NONCES);
  const nonce = randomBytes(24).toString("hex");
  const issuedAt = Date.now();
  const exp = issuedAt + NONCE_TTL_MS;
  nonces.set(address, { nonce, exp, issuedAt });
  return { nonce, message: buildSiwsMessage(address, nonce, siwsFields(issuedAt, exp)) };
}

const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** ed25519-проверка подписи сообщения сырым 32-байтным pubkey (Solana-адрес). */
function verifySignature(address: string, message: string, signatureB64: string): boolean {
  try {
    const raw = Buffer.from(new PublicKey(address).toBytes()); // 32 байта
    const keyObj = createPublicKey({
      key: Buffer.concat([SPKI_ED25519_PREFIX, raw]),
      format: "der",
      type: "spki",
    });
    const sig = Buffer.from(signatureB64, "base64");
    if (sig.length !== 64) return false;
    return edVerify(null, Buffer.from(message, "utf8"), keyObj, sig);
  } catch {
    return false;
  }
}

/** Шаг 3: проверить подпись против выданного nonce, погасить nonce, выдать session-токен. */
export function verifyAndIssueToken(
  address: string,
  signatureB64: string,
): { token: string; exp: number } | null {
  const rec = nonces.get(address);
  if (!rec || rec.exp < Date.now()) {
    nonces.delete(address);
    return null;
  }
  nonces.delete(address); // one-time: nonce гасится в любом исходе (нет реюза/перебора)
  const message = buildSiwsMessage(address, rec.nonce, siwsFields(rec.issuedAt, rec.exp));
  if (!verifySignature(address, message, signatureB64)) return null;

  prune(sessions, MAX_SESSIONS);
  const token = randomBytes(32).toString("hex");
  const exp = Date.now() + SESSION_TTL_MS;
  sessions.set(token, { address, exp });
  saveSessions(); // сессия переживёт рестарт (ADR 0013)
  return { token, exp };
}

/** Шаг 4: токен → проверенный address (или null, если нет/просрочен). */
export function resolveToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const rec = sessions.get(token);
  if (!rec) return null;
  if (rec.exp < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return rec.address;
}

/** Явный выход — инвалидировать токен. */
export function revokeToken(token: string | null | undefined): void {
  if (token) {
    sessions.delete(token);
    saveSessions();
  }
}
