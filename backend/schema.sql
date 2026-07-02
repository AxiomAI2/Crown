-- Standing — целевая схема Postgres (Фаза 2, по docs/data-model.md и backend/spec.md §2).
--
-- ПРИМЕЧАНИЕ: эта схема ЖИВАЯ — реализована через PGlite (встроенный Postgres-WASM, без установки/sudo;
-- src/server/db.ts создаёт эти таблицы, store-db.ts отображает домен ↔ строки; ADR 0014). Стор работает
-- на быстрой in-memory копии и пишет в эти таблицы; прямые SQL-чтения без копии — оптимизация на потом.
-- Переход на managed-Postgres в проде = смена подключения, экраны/API не трогаем. Деньги — micro-USDC в
-- numeric(20,0); очки — bigint.
-- Источник истины по репутации — ledger_events (append-only); число всегда пересчитывается движком.

CREATE TABLE identities (
  address     text PRIMARY KEY,
  level       text NOT NULL DEFAULT 'address_only'
                CHECK (level IN ('address_only','light','creator')),
  sns         text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE light_profiles (
  address      text PRIMARY KEY REFERENCES identities(address),
  display_name text,
  avatar_url   text,
  bio          text,
  links        jsonb NOT NULL DEFAULT '[]'
);

CREATE TABLE channels (
  id             text PRIMARY KEY,
  owner_address  text NOT NULL,
  payout_address text NOT NULL,
  handle         text NOT NULL UNIQUE,
  status         text NOT NULL DEFAULT 'BASIC'
                   CHECK (status IN ('BASIC','ACTIVE','SUSPENDED','BANNED')),
  activated_at   timestamptz,
  config_version integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now()
);
-- Один канал на кошелёк (ADR 0002): уникален среди не-забаненных (после бана можно новый кошелёк).
CREATE UNIQUE INDEX channels_owner_active_uq
  ON channels (owner_address) WHERE status <> 'BANNED';

CREATE TABLE channel_configs (
  channel_id             text NOT NULL REFERENCES channels(id),
  version                integer NOT NULL,
  hash                   text NOT NULL,
  reputation             jsonb NOT NULL,
  tiers                  jsonb NOT NULL,
  min_donation           numeric(20,0) NOT NULL,
  min_donation_with_text numeric(20,0) NOT NULL,
  message_max_len        integer NOT NULL,
  profanity_policy       text NOT NULL CHECK (profanity_policy IN ('mask','hide','queue')),
  name_mode              text NOT NULL CHECK (name_mode IN ('addresses_only','allow_display_names')),
  text_show_mode         text NOT NULL CHECK (text_show_mode IN ('manual','auto_if_clean')),
  overlay                jsonb NOT NULL,
  moderators             jsonb NOT NULL DEFAULT '[]',
  updated_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, version)   -- все версии хранятся (банкинг)
);

-- Журнал репутации — append-only источник истины.
CREATE TABLE ledger_events (
  id             text PRIMARY KEY,
  donor          text NOT NULL,
  creator        text NOT NULL REFERENCES channels(id),
  type           text NOT NULL
                   CHECK (type IN ('DONATION','DISPUTE_WON','DISPUTE_LOST','GAME','REFUND')),
  amount         numeric(20,0) NOT NULL DEFAULT 0,  -- micro-USDC (0 для не-донатных)
  points_delta   bigint NOT NULL,                   -- забанковано в момент события (+/−)
  config_version integer NOT NULL,
  tx_signature   text,                              -- Фаза 3
  ts             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_creator_donor ON ledger_events (creator, donor);  -- свёртка standing
CREATE INDEX ledger_creator_ts    ON ledger_events (creator, ts);     -- лидерборд

CREATE TABLE donations (
  id               text PRIMARY KEY,
  channel_id       text NOT NULL REFERENCES channels(id),
  donor            text NOT NULL,
  amount           numeric(20,0) NOT NULL,  -- полная сумма (до расщепления)
  fee_amount       numeric(20,0) NOT NULL,  -- ~3% в трежери
  net_to_streamer  numeric(20,0) NOT NULL,  -- ~97%
  tx_signature     text,                    -- Фаза 3
  final            boolean NOT NULL DEFAULT true,
  ts               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX donations_channel_ts ON donations (channel_id, ts);

CREATE TABLE messages (
  id           text PRIMARY KEY,
  donation_id  text NOT NULL REFERENCES donations(id),
  channel_id   text NOT NULL REFERENCES channels(id),
  text         text NOT NULL,            -- оффчейн, снимаемо
  lang         text,
  state        text NOT NULL DEFAULT 'HELD'
                 CHECK (state IN ('HELD','SHOWN','HIDDEN','QUARANTINED')),
  auto_verdict text CHECK (auto_verdict IN ('CLEAR','FLAG','HARD_BLOCK')),
  content_hash text NOT NULL,
  shown_at     timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_channel_state ON messages (channel_id, state);  -- очередь модерации
CREATE INDEX messages_content_hash  ON messages (content_hash);       -- дедуп карантина

CREATE TABLE channel_blocks (
  channel_id      text NOT NULL REFERENCES channels(id),
  blocked_address text NOT NULL,
  reason          text,
  by_moderator    text NOT NULL,
  ts              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, blocked_address)
);

CREATE TABLE operator_actions (
  id                text PRIMARY KEY,
  action            text NOT NULL
                      CHECK (action IN ('HIDE_MESSAGE','CHANNEL_BLOCK','SUSPEND_CHANNEL',
                                        'BAN_CREATOR_ROLE','BAN_WALLET_FULL','REINSTATE_CHANNEL')),
  target_channel_id text,
  target_address    text,
  reason            text NOT NULL,
  by_operator       text NOT NULL,
  preservation      boolean,
  reported          boolean,
  ts                timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE incident_logs (
  id          text PRIMARY KEY,
  channel_id  text,
  address     text,
  kind        text NOT NULL CHECK (kind IN ('report','hard_block','sanction_hit','flood')),
  detail      text NOT NULL,
  resolution  text,
  ts          timestamptz NOT NULL DEFAULT now()
);
