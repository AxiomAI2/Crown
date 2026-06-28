import type { PGlite } from "@electric-sql/pglite";
import type { Channel, ChannelConfig, LightProfile } from "@/lib/data/types";

/**
 * Маппинг состояния стора ↔ реляционные таблицы Postgres (PGlite). Логика и инварианты остаются в
 * MockDataProvider (работает на in-memory копии); этот слой грузит состояние из таблиц при старте и
 * сохраняет обратно после мутаций — вместо JSON-снимка. Деньги (micro-USDC, bigint) ↔ numeric(20,0) как
 * строки; объекты ↔ jsonb; Iso-строки ↔ timestamptz (на чтении приводим Date → ISO).
 *
 * Строится по сущностям (этап 2 — каналы/конфиги/профили); остальные таблицы добавляются в следующих этапах,
 * после чего store.ts переключается с JSON-снимка на эти функции.
 */

// PG timestamptz → Iso-строка (PGlite отдаёт Date); прочее — как есть.
const toIso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
// jsonb приходит уже разобранным; на всякий случай поддержим и строку.
const asJson = <T>(v: unknown, fallback: T): T =>
  v == null ? fallback : typeof v === "string" ? (JSON.parse(v) as T) : (v as T);

// ───────────────────────── channels ─────────────────────────
export async function saveChannels(db: PGlite, channels: Channel[]): Promise<void> {
  for (const c of channels) {
    await db.query(
      `INSERT INTO channels (id, owner_address, payout_address, handle, status, activated_at, config_version, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         owner_address=$2, payout_address=$3, handle=$4, status=$5, activated_at=$6, config_version=$7, created_at=$8`,
      [
        c.id,
        c.ownerAddress,
        c.payoutAddress,
        c.handle,
        c.status,
        c.activatedAt ?? null,
        c.configVersion,
        c.createdAt,
      ],
    );
  }
}

export async function loadChannels(db: PGlite): Promise<Channel[]> {
  const r = await db.query<Record<string, unknown>>("SELECT * FROM channels");
  return r.rows.map((row) => ({
    id: row.id as string,
    ownerAddress: row.owner_address as string,
    payoutAddress: row.payout_address as string,
    handle: row.handle as string,
    status: row.status as Channel["status"],
    activatedAt: row.activated_at ? toIso(row.activated_at) : undefined,
    configVersion: Number(row.config_version),
    createdAt: toIso(row.created_at),
  }));
}

// ───────────────────────── channel_configs ─────────────────────────
export async function saveConfigs(
  db: PGlite,
  configsByChannel: Map<string, ChannelConfig[]>,
): Promise<void> {
  for (const versions of configsByChannel.values()) {
    for (const cfg of versions) {
      await db.query(
        `INSERT INTO channel_configs
           (channel_id, version, hash, description, tiers, min_donation, min_donation_with_text,
            message_max_len, name_mode, text_show_mode, moderators, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (channel_id, version) DO UPDATE SET
           hash=$3, description=$4, tiers=$5, min_donation=$6, min_donation_with_text=$7,
           message_max_len=$8, name_mode=$9, text_show_mode=$10, moderators=$11, updated_at=$12`,
        [
          cfg.channelId,
          cfg.version,
          cfg.hash,
          cfg.description ?? null,
          JSON.stringify(cfg.tiers),
          String(cfg.minDonation),
          String(cfg.minDonationWithText),
          cfg.messageMaxLen,
          cfg.nameMode,
          cfg.textShowMode,
          JSON.stringify(cfg.moderators),
          cfg.updatedAt,
        ],
      );
    }
  }
}

export async function loadConfigs(db: PGlite): Promise<Map<string, ChannelConfig[]>> {
  const r = await db.query<Record<string, unknown>>(
    "SELECT * FROM channel_configs ORDER BY channel_id, version",
  );
  const m = new Map<string, ChannelConfig[]>();
  for (const row of r.rows) {
    const cfg: ChannelConfig = {
      channelId: row.channel_id as string,
      version: Number(row.version),
      hash: row.hash as string,
      description: (row.description as string | null) ?? undefined,
      tiers: asJson(row.tiers, []),
      minDonation: BigInt(row.min_donation as string),
      minDonationWithText: BigInt(row.min_donation_with_text as string),
      messageMaxLen: Number(row.message_max_len),
      nameMode: row.name_mode as ChannelConfig["nameMode"],
      textShowMode: row.text_show_mode as ChannelConfig["textShowMode"],
      moderators: asJson(row.moderators, []),
      updatedAt: toIso(row.updated_at),
    };
    const arr = m.get(cfg.channelId);
    if (arr) arr.push(cfg);
    else m.set(cfg.channelId, [cfg]);
  }
  return m;
}

// ───────────────────────── light_profiles ─────────────────────────
export async function saveProfiles(
  db: PGlite,
  profiles: Map<string, LightProfile>,
): Promise<void> {
  for (const p of profiles.values()) {
    await db.query(
      `INSERT INTO light_profiles (address, display_name, avatar_url, bio, links)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (address) DO UPDATE SET display_name=$2, avatar_url=$3, bio=$4, links=$5`,
      [p.address, p.displayName ?? null, p.avatarUrl ?? null, p.bio ?? null, JSON.stringify(p.links ?? [])],
    );
  }
}

export async function loadProfiles(db: PGlite): Promise<Map<string, LightProfile>> {
  const r = await db.query<Record<string, unknown>>("SELECT * FROM light_profiles");
  const m = new Map<string, LightProfile>();
  for (const row of r.rows) {
    m.set(row.address as string, {
      address: row.address as string,
      displayName: (row.display_name as string | null) ?? undefined,
      avatarUrl: (row.avatar_url as string | null) ?? undefined,
      bio: (row.bio as string | null) ?? undefined,
      links: asJson(row.links, []),
    });
  }
  return m;
}
