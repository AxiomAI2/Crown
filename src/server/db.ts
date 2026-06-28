import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

/**
 * Локальный Postgres через PGlite (Postgres, собранный в WASM) — работает прямо в Node-процессе, хранит
 * данные в `.data/pg/`, без отдельного сервера/Docker/sudo (Tier-1 «production-readiness»). Для прода строку
 * подключения меняем на облачный Postgres (Neon/Supabase) тем же SQL — провайдер не трогаем.
 *
 * Только серверный модуль (WASM + node:fs) — в клиентский bundle не попадает. Singleton кэшируется на
 * globalThis, чтобы переживать HMR в dev и шариться между запросами; схема применяется один раз при инициализации.
 */
const DIR = path.join(process.cwd(), ".data", "pg");

const g = globalThis as unknown as { __pglite?: Promise<PGlite> };

export function getDb(): Promise<PGlite> {
  if (!g.__pglite) {
    g.__pglite = (async () => {
      const db = await PGlite.create(DIR);
      await ensureSchema(db);
      return db;
    })();
  }
  return g.__pglite;
}

/**
 * Схема под АКТУАЛЬНЫЕ типы (docs/data-model.md, обновлено ADR 0007: без reputation/overlay/profanity_policy).
 * Деньги — numeric(20,0) (micro-USDC), очки — bigint. Источник истины репутации — ledger_events (append-only).
 * Идемпотентно (IF NOT EXISTS) — безопасно вызывать при каждом старте.
 */
async function ensureSchema(db: PGlite): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS identities (
      address     text PRIMARY KEY,
      level       text NOT NULL DEFAULT 'address_only',
      created_at  timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS light_profiles (
      address      text PRIMARY KEY,
      display_name text,
      avatar_url   text,
      bio          text,
      links        jsonb NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS channels (
      id             text PRIMARY KEY,
      owner_address  text NOT NULL,
      payout_address text NOT NULL,
      handle         text NOT NULL UNIQUE,
      status         text NOT NULL DEFAULT 'BASIC',
      activated_at   timestamptz,
      config_version integer NOT NULL DEFAULT 1,
      created_at     timestamptz NOT NULL DEFAULT now()
    );
    -- Один канал на кошелёк (ADR 0002): уникален среди не-забаненных.
    CREATE UNIQUE INDEX IF NOT EXISTS channels_owner_active_uq
      ON channels (owner_address) WHERE status <> 'BANNED';

    CREATE TABLE IF NOT EXISTS channel_configs (
      channel_id             text NOT NULL,
      version                integer NOT NULL,
      hash                   text NOT NULL,
      tiers                  jsonb NOT NULL,
      min_donation           numeric(20,0) NOT NULL,
      min_donation_with_text numeric(20,0) NOT NULL,
      message_max_len        integer NOT NULL,
      name_mode              text NOT NULL,
      text_show_mode         text NOT NULL,
      moderators             jsonb NOT NULL DEFAULT '[]',
      updated_at             timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (channel_id, version)
    );

    -- Журнал репутации — append-only источник истины.
    CREATE TABLE IF NOT EXISTS ledger_events (
      id             text PRIMARY KEY,
      donor          text NOT NULL,
      creator        text NOT NULL,
      type           text NOT NULL,
      amount         numeric(20,0) NOT NULL DEFAULT 0,
      points_delta   bigint NOT NULL,
      config_version integer NOT NULL,
      tx_signature   text,
      ts             timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS ledger_creator_donor ON ledger_events (creator, donor);
    CREATE INDEX IF NOT EXISTS ledger_creator_ts    ON ledger_events (creator, ts);

    CREATE TABLE IF NOT EXISTS donations (
      id               text PRIMARY KEY,
      channel_id       text NOT NULL,
      donor            text NOT NULL,
      amount           numeric(20,0) NOT NULL,
      fee_amount       numeric(20,0) NOT NULL,
      net_to_streamer  numeric(20,0) NOT NULL,
      tx_signature     text,
      final            boolean NOT NULL DEFAULT true,
      ts               timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS donations_channel_ts ON donations (channel_id, ts);

    CREATE TABLE IF NOT EXISTS messages (
      id           text PRIMARY KEY,
      donation_id  text NOT NULL,
      channel_id   text NOT NULL,
      text         text NOT NULL,
      lang         text,
      state        text NOT NULL DEFAULT 'HELD',
      auto_verdict text,
      content_hash text NOT NULL,
      reported     boolean NOT NULL DEFAULT false,
      shown_at     timestamptz,
      created_at   timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS messages_channel_state ON messages (channel_id, state);
    CREATE INDEX IF NOT EXISTS messages_content_hash  ON messages (content_hash);

    CREATE TABLE IF NOT EXISTS channel_blocks (
      channel_id      text NOT NULL,
      blocked_address text NOT NULL,
      reason          text,
      by_moderator    text NOT NULL,
      ts              timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (channel_id, blocked_address)
    );

    CREATE TABLE IF NOT EXISTS operator_actions (
      id                text PRIMARY KEY,
      action            text NOT NULL,
      target_channel_id text,
      target_address    text,
      reason            text NOT NULL,
      by_operator       text NOT NULL,
      preservation      boolean,
      reported          boolean,
      ts                timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS incident_logs (
      id          text PRIMARY KEY,
      channel_id  text,
      address     text,
      kind        text NOT NULL,
      detail      text NOT NULL,
      text        text,
      resolution  text,
      ts          timestamptz NOT NULL DEFAULT now()
    );
  `);
}
