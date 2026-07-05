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
 * Схема под АКТУАЛЬНЫЕ типы (yellow-paper §13, обновлено ADR 0007: без reputation/overlay/profanity_policy).
 * Деньги — numeric(20,0) (micro-USDC), очки — numeric (дробные, 1 USDC = 1 очко с копейками).
 * Идемпотентно (IF NOT EXISTS) — безопасно вызывать при каждом старте.
 */
async function ensureSchema(db: PGlite): Promise<void> {
  await db.exec(`
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
      payout_attestation text,
      handle         text NOT NULL UNIQUE,
      status         text NOT NULL DEFAULT 'BASIC',
      activated_at   timestamptz,
      config_version integer NOT NULL DEFAULT 1,
      created_at     timestamptz NOT NULL DEFAULT now()
    );
    -- Один канал на кошелёк (ADR 0002): уникален среди не-забаненных.
    CREATE UNIQUE INDEX IF NOT EXISTS channels_owner_active_uq
      ON channels (owner_address) WHERE status <> 'BANNED';
    -- H1: ed25519-подпись владельца над payout (lib/chain/attestation.ts); NULL = канал до аттестаций.
    ALTER TABLE channels ADD COLUMN IF NOT EXISTS payout_attestation text;

    CREATE TABLE IF NOT EXISTS channel_configs (
      channel_id             text NOT NULL,
      version                integer NOT NULL,
      hash                   text NOT NULL,
      description            text,
      tiers                  jsonb NOT NULL,
      min_donation           numeric(20,0) NOT NULL,
      min_donation_with_text numeric(20,0) NOT NULL,
      min_reputation_to_task    double precision NOT NULL DEFAULT 0,
      min_reputation_to_dispute double precision NOT NULL DEFAULT 0,
      message_max_len        integer NOT NULL,
      name_mode              text NOT NULL,
      text_show_mode         text NOT NULL,
      moderators             jsonb NOT NULL DEFAULT '[]',
      enabled_games          jsonb NOT NULL DEFAULT '[]',
      updated_at             timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (channel_id, version)
    );
    -- Чистка мёртвой схемы (2026-07-02, yellow-paper §18.4): identities никогда не читалась/писалась,
    -- messages.reported не маппился (жалобы живут в reports).
    DROP TABLE IF EXISTS identities;
    ALTER TABLE IF EXISTS messages DROP COLUMN IF EXISTS reported;

    -- Миграции для уже созданных БД (CREATE TABLE IF NOT EXISTS не добавит колонку):
    ALTER TABLE channel_configs ADD COLUMN IF NOT EXISTS enabled_games jsonb NOT NULL DEFAULT '[]';
    -- §10: пороги репутации на присыл задания / на право поднять спор (рычаги стримера).
    ALTER TABLE channel_configs ADD COLUMN IF NOT EXISTS min_reputation_to_task double precision NOT NULL DEFAULT 0;
    ALTER TABLE channel_configs ADD COLUMN IF NOT EXISTS min_reputation_to_dispute double precision NOT NULL DEFAULT 0;

    -- Журнал репутации — append-only источник истины.
    CREATE TABLE IF NOT EXISTS ledger_events (
      id             text PRIMARY KEY,
      donor          text NOT NULL,
      creator        text NOT NULL,
      type           text NOT NULL,
      amount         numeric(20,0) NOT NULL DEFAULT 0,
      points_delta   numeric NOT NULL,
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

    -- Жалобы зрителей (анти-накрутка: одна на пару message_id+reporter). Внутреннее состояние стора.
    CREATE TABLE IF NOT EXISTS reports (
      message_id text NOT NULL,
      channel_id text NOT NULL,
      reporter   text NOT NULL,
      reason     text,
      ts         timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (message_id, reporter)
    );

    -- KV для служебного состояния (счётчик id и т.п.).
    CREATE TABLE IF NOT EXISTS meta (
      key   text PRIMARY KEY,
      value text NOT NULL
    );

    -- Состояние мини-игр: gameId → непрозрачный слайс (форму владеет сама игра; ADR 0016).
    CREATE TABLE IF NOT EXISTS game_state (
      game_id text PRIMARY KEY,
      state   jsonb NOT NULL
    );
  `);

  // Миграция дробных очков: очки стали 1:1 к USDC с копейками (2.5 USDC → 2.5 очка). Старые БД имеют
  // points_delta bigint (целое) → расширяем до numeric (bigint→numeric — без потерь). CREATE TABLE выше уже
  // задаёт numeric для новых БД; тут чиним существующие. Условно, чтобы не переписывать таблицу каждый старт.
  const col = await db.query<{ data_type: string }>(
    `SELECT data_type FROM information_schema.columns
     WHERE table_name = 'ledger_events' AND column_name = 'points_delta'`,
  );
  if (col.rows[0]?.data_type === "bigint") {
    await db.exec(`ALTER TABLE ledger_events ALTER COLUMN points_delta TYPE numeric;`);
  }
}
