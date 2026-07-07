import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

/**
 * Local Postgres via PGlite (Postgres compiled to WASM) — runs right inside the Node process and stores
 * data in `.data/pg/`, with no separate server/Docker/sudo (Tier-1 "production readiness"). For production we
 * swap the connection string for a cloud Postgres (Neon/Supabase) using the same SQL — the provider is untouched.
 *
 * Server-only module (WASM + node:fs) — it never lands in the client bundle. The singleton is cached on
 * globalThis so it survives HMR in dev and is shared across requests; the schema is applied once at init.
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
 * Schema for the CURRENT types (yellow-paper §13, updated by ADR 0007: no reputation/overlay/profanity_policy).
 * Money is numeric(20,0) (micro-USDC), points are numeric (fractional, 1 USDC = 1 point with cents).
 * Idempotent (IF NOT EXISTS) — safe to call on every start.
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
    -- One realm per wallet (ADR 0002): unique among the non-banned.
    CREATE UNIQUE INDEX IF NOT EXISTS channels_owner_active_uq
      ON channels (owner_address) WHERE status <> 'BANNED';
    -- H1: the owner's ed25519 signature over the payout (lib/chain/attestation.ts); NULL = a realm predating attestations.
    ALTER TABLE channels ADD COLUMN IF NOT EXISTS payout_attestation text;

    CREATE TABLE IF NOT EXISTS channel_configs (
      channel_id             text NOT NULL,
      version                integer NOT NULL,
      hash                   text NOT NULL,
      description            text,
      goal_target            numeric(20,0),
      goal_label             text,
      page_theme             jsonb,
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
    -- Cleaning up dead schema (2026-07-02, yellow-paper §18.4): identities was never read/written,
    -- messages.reported was never mapped (reports live in reports).
    DROP TABLE IF EXISTS identities;
    ALTER TABLE IF EXISTS messages DROP COLUMN IF EXISTS reported;

    -- Migrations for already-created DBs (CREATE TABLE IF NOT EXISTS won't add a column):
    ALTER TABLE channel_configs ADD COLUMN IF NOT EXISTS enabled_games jsonb NOT NULL DEFAULT '[]';
    -- §10: Reign thresholds to submit a task / to earn the right to raise a dispute (streamer levers).
    ALTER TABLE channel_configs ADD COLUMN IF NOT EXISTS min_reputation_to_task double precision NOT NULL DEFAULT 0;
    ALTER TABLE channel_configs ADD COLUMN IF NOT EXISTS min_reputation_to_dispute double precision NOT NULL DEFAULT 0;
    -- Donation goal for the OBS "goal" overlay (nullable → no goal). Inert for Reign, like description.
    ALTER TABLE channel_configs ADD COLUMN IF NOT EXISTS goal_target numeric(20,0);
    ALTER TABLE channel_configs ADD COLUMN IF NOT EXISTS goal_label text;
    -- Public realm-page theme (Customization → Page). Display-only, inert for Reign.
    ALTER TABLE channel_configs ADD COLUMN IF NOT EXISTS page_theme jsonb;

    -- The Reign ledger — the append-only source of truth.
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

    -- Viewer reports (anti-gaming: one per message_id+reporter pair). Internal store state.
    CREATE TABLE IF NOT EXISTS reports (
      message_id text NOT NULL,
      channel_id text NOT NULL,
      reporter   text NOT NULL,
      reason     text,
      ts         timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (message_id, reporter)
    );

    -- KV for internal state (id counter, etc.).
    CREATE TABLE IF NOT EXISTS meta (
      key   text PRIMARY KEY,
      value text NOT NULL
    );

    -- Mini-game state: gameId → opaque slice (the game owns its shape; ADR 0016).
    CREATE TABLE IF NOT EXISTS game_state (
      game_id text PRIMARY KEY,
      state   jsonb NOT NULL
    );
  `);

  // Fractional-points migration: points became 1:1 to USDC with cents (2.5 USDC → 2.5 points). Old DBs have
  // points_delta bigint (integer) → we widen it to numeric (bigint→numeric — lossless). The CREATE TABLE above
  // already sets numeric for new DBs; here we fix existing ones. Conditionally, so we don't rewrite the table every start.
  const col = await db.query<{ data_type: string }>(
    `SELECT data_type FROM information_schema.columns
     WHERE table_name = 'ledger_events' AND column_name = 'points_delta'`,
  );
  if (col.rows[0]?.data_type === "bigint") {
    await db.exec(`ALTER TABLE ledger_events ALTER COLUMN points_delta TYPE numeric;`);
  }
}
