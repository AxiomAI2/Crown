import type { PGlite } from "@electric-sql/pglite";
import { getDb } from "./db";
import type { StoreSnapshot } from "@/lib/data/mock-provider";
import type {
  Channel,
  ChannelBlock,
  ChannelConfig,
  Donation,
  IncidentLog,
  LedgerEvent,
  LightProfile,
  MessageRef,
  OperatorAction,
  PageTheme,
} from "@/lib/data/types";

// ReportRecord — an internal store type (not exported); we take its shape from the snapshot.
type ReportRecord = StoreSnapshot["reports"][number];

/**
 * Mapping of store state ↔ relational Postgres tables (PGlite). The logic and invariants remain in
 * MockDataProvider (which works on an in-memory copy); this layer loads state from the tables at startup and
 * saves it back after mutations — instead of a JSON snapshot. Money (micro-USDC, bigint) ↔ numeric(20,0) as
 * strings; objects ↔ jsonb; Iso strings ↔ timestamptz (on read we convert Date → ISO).
 *
 * Built out entity by entity (stage 2 — realms/configs/profiles); the remaining tables are added in later stages,
 * after which store.ts switches from the JSON snapshot to these functions.
 */

// PG timestamptz → Iso string (PGlite returns a Date); everything else as-is.
const toIso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
// jsonb arrives already parsed; just in case, we also support a string.
const asJson = <T>(v: unknown, fallback: T): T =>
  v == null ? fallback : typeof v === "string" ? (JSON.parse(v) as T) : (v as T);

// ───────────────────────── channels ─────────────────────────
export async function saveChannels(db: PGlite, channels: Channel[]): Promise<void> {
  for (const c of channels) {
    await db.query(
      `INSERT INTO channels (id, owner_address, payout_address, payout_attestation, handle, status, activated_at, config_version, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         owner_address=$2, payout_address=$3, payout_attestation=$4, handle=$5, status=$6, activated_at=$7, config_version=$8, created_at=$9`,
      [
        c.id,
        c.ownerAddress,
        c.payoutAddress,
        c.payoutAttestation ?? null,
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
    payoutAttestation: (row.payout_attestation as string | null) ?? undefined,
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
            message_max_len, name_mode, text_show_mode, moderators, enabled_games,
            min_reputation_to_task, min_reputation_to_dispute, goal_target, goal_label, updated_at, page_theme)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT (channel_id, version) DO UPDATE SET
           hash=$3, description=$4, tiers=$5, min_donation=$6, min_donation_with_text=$7,
           message_max_len=$8, name_mode=$9, text_show_mode=$10, moderators=$11, enabled_games=$12,
           min_reputation_to_task=$13, min_reputation_to_dispute=$14, goal_target=$15, goal_label=$16,
           updated_at=$17, page_theme=$18`,
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
          JSON.stringify(cfg.enabledGames ?? []),
          cfg.minReputationToTask,
          cfg.minReputationToDispute,
          cfg.goalTarget != null ? String(cfg.goalTarget) : null,
          cfg.goalLabel ?? null,
          cfg.updatedAt,
          cfg.pageTheme != null ? JSON.stringify(cfg.pageTheme) : null,
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
      goalTarget: row.goal_target != null ? BigInt(row.goal_target as string) : undefined,
      goalLabel: (row.goal_label as string | null) ?? undefined,
      pageTheme: asJson<PageTheme | undefined>(row.page_theme, undefined),
      tiers: asJson(row.tiers, []),
      minDonation: BigInt(row.min_donation as string),
      minDonationWithText: BigInt(row.min_donation_with_text as string),
      minReputationToTask: Number(row.min_reputation_to_task ?? 0),
      minReputationToDispute: Number(row.min_reputation_to_dispute ?? 0),
      messageMaxLen: Number(row.message_max_len),
      nameMode: row.name_mode as ChannelConfig["nameMode"],
      textShowMode: row.text_show_mode as ChannelConfig["textShowMode"],
      moderators: asJson(row.moderators, []),
      enabledGames: asJson(row.enabled_games, []),
      updatedAt: toIso(row.updated_at),
    };
    const arr = m.get(cfg.channelId);
    if (arr) arr.push(cfg);
    else m.set(cfg.channelId, [cfg]);
  }
  return m;
}

// ───────────────────────── light_profiles ─────────────────────────
export async function saveProfiles(db: PGlite, profiles: Map<string, LightProfile>): Promise<void> {
  for (const p of profiles.values()) {
    await db.query(
      `INSERT INTO light_profiles (address, display_name, avatar_url, bio, links)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (address) DO UPDATE SET display_name=$2, avatar_url=$3, bio=$4, links=$5`,
      [
        p.address,
        p.displayName ?? null,
        p.avatarUrl ?? null,
        p.bio ?? null,
        JSON.stringify(p.links ?? []),
      ],
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

// ───────────────────────── ledger_events (source of truth) ─────────────────────────
export async function saveLedger(db: PGlite, ledger: LedgerEvent[]): Promise<void> {
  for (const e of ledger) {
    await db.query(
      `INSERT INTO ledger_events (id, donor, creator, type, amount, points_delta, config_version, tx_signature, ts)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         donor=$2, creator=$3, type=$4, amount=$5, points_delta=$6, config_version=$7, tx_signature=$8, ts=$9`,
      [
        e.id,
        e.donor,
        e.creator,
        e.type,
        String(e.amount),
        e.pointsDelta,
        e.configVersion,
        e.txSignature ?? null,
        e.ts,
      ],
    );
  }
}

export async function loadLedger(db: PGlite): Promise<LedgerEvent[]> {
  const r = await db.query<Record<string, unknown>>("SELECT * FROM ledger_events ORDER BY ts");
  return r.rows.map((row) => ({
    id: row.id as string,
    donor: row.donor as string,
    creator: row.creator as string,
    type: row.type as LedgerEvent["type"],
    amount: BigInt(row.amount as string),
    pointsDelta: Number(row.points_delta),
    configVersion: Number(row.config_version),
    txSignature: (row.tx_signature as string | null) ?? undefined,
    ts: toIso(row.ts),
  }));
}

// ───────────────────────── donations (without message — it's in messages) ─────────────────────────
export async function saveDonations(db: PGlite, donations: Donation[]): Promise<void> {
  for (const d of donations) {
    await db.query(
      `INSERT INTO donations (id, channel_id, donor, amount, fee_amount, net_to_streamer, tx_signature, final, ts)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         channel_id=$2, donor=$3, amount=$4, fee_amount=$5, net_to_streamer=$6, tx_signature=$7, final=$8, ts=$9`,
      [
        d.id,
        d.channelId,
        d.donor,
        String(d.amount),
        String(d.feeAmount),
        String(d.netToStreamer),
        d.txSignature ?? null,
        d.final,
        d.ts,
      ],
    );
  }
}

export async function loadDonations(db: PGlite): Promise<Donation[]> {
  const r = await db.query<Record<string, unknown>>("SELECT * FROM donations ORDER BY ts");
  return r.rows.map((row) => ({
    id: row.id as string,
    channelId: row.channel_id as string,
    donor: row.donor as string,
    amount: BigInt(row.amount as string),
    feeAmount: BigInt(row.fee_amount as string),
    netToStreamer: BigInt(row.net_to_streamer as string),
    txSignature: (row.tx_signature as string | null) ?? undefined,
    final: true as const,
    ts: toIso(row.ts),
  }));
}

// ───────────────────────── messages ─────────────────────────
export async function saveMessages(db: PGlite, messages: Map<string, MessageRef>): Promise<void> {
  for (const m of messages.values()) {
    await db.query(
      `INSERT INTO messages (id, donation_id, channel_id, text, lang, state, auto_verdict, content_hash, shown_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET
         donation_id=$2, channel_id=$3, text=$4, lang=$5, state=$6, auto_verdict=$7, content_hash=$8, shown_at=$9, created_at=$10`,
      [
        m.id,
        m.donationId,
        m.channelId,
        m.text,
        m.lang ?? null,
        m.state,
        m.autoVerdict ?? null,
        m.contentHash,
        m.shownAt ?? null,
        m.createdAt,
      ],
    );
  }
}

export async function loadMessages(db: PGlite): Promise<Map<string, MessageRef>> {
  const r = await db.query<Record<string, unknown>>("SELECT * FROM messages");
  const map = new Map<string, MessageRef>();
  for (const row of r.rows) {
    map.set(row.id as string, {
      id: row.id as string,
      donationId: row.donation_id as string,
      channelId: row.channel_id as string,
      text: row.text as string,
      lang: (row.lang as string | null) ?? undefined,
      state: row.state as MessageRef["state"],
      autoVerdict: (row.auto_verdict as MessageRef["autoVerdict"]) ?? undefined,
      contentHash: row.content_hash as string,
      shownAt: row.shown_at ? toIso(row.shown_at) : undefined,
      createdAt: toIso(row.created_at),
    });
  }
  return map;
}

// ───────────────────────── channel_blocks ─────────────────────────
export async function saveBlocks(db: PGlite, blocks: ChannelBlock[]): Promise<void> {
  for (const b of blocks) {
    await db.query(
      `INSERT INTO channel_blocks (channel_id, blocked_address, reason, by_moderator, ts)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (channel_id, blocked_address) DO UPDATE SET reason=$3, by_moderator=$4, ts=$5`,
      [b.channelId, b.blockedAddress, b.reason ?? null, b.byModerator, b.ts],
    );
  }
}

export async function loadBlocks(db: PGlite): Promise<ChannelBlock[]> {
  const r = await db.query<Record<string, unknown>>("SELECT * FROM channel_blocks");
  return r.rows.map((row) => ({
    channelId: row.channel_id as string,
    blockedAddress: row.blocked_address as string,
    reason: (row.reason as string | null) ?? undefined,
    byModerator: row.by_moderator as string,
    ts: toIso(row.ts),
  }));
}

// ───────────────────────── operator_actions ─────────────────────────
export async function saveOperatorActions(db: PGlite, actions: OperatorAction[]): Promise<void> {
  for (const a of actions) {
    await db.query(
      `INSERT INTO operator_actions (id, action, target_channel_id, target_address, reason, by_operator, preservation, reported, ts)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         action=$2, target_channel_id=$3, target_address=$4, reason=$5, by_operator=$6, preservation=$7, reported=$8, ts=$9`,
      [
        a.id,
        a.action,
        a.targetChannelId ?? null,
        a.targetAddress ?? null,
        a.reason,
        a.byOperator,
        a.preservation ?? null,
        a.reported ?? null,
        a.ts,
      ],
    );
  }
}

export async function loadOperatorActions(db: PGlite): Promise<OperatorAction[]> {
  const r = await db.query<Record<string, unknown>>("SELECT * FROM operator_actions ORDER BY ts");
  return r.rows.map((row) => ({
    id: row.id as string,
    action: row.action as OperatorAction["action"],
    targetChannelId: (row.target_channel_id as string | null) ?? undefined,
    targetAddress: (row.target_address as string | null) ?? undefined,
    reason: row.reason as string,
    byOperator: row.by_operator as string,
    preservation: (row.preservation as boolean | null) ?? undefined,
    reported: (row.reported as boolean | null) ?? undefined,
    ts: toIso(row.ts),
  }));
}

// ───────────────────────── incident_logs ─────────────────────────
export async function saveIncidents(db: PGlite, incidents: IncidentLog[]): Promise<void> {
  for (const i of incidents) {
    await db.query(
      `INSERT INTO incident_logs (id, channel_id, address, kind, detail, text, resolution, ts)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         channel_id=$2, address=$3, kind=$4, detail=$5, text=$6, resolution=$7, ts=$8`,
      [
        i.id,
        i.channelId ?? null,
        i.address ?? null,
        i.kind,
        i.detail,
        i.text ?? null,
        i.resolution ?? null,
        i.ts,
      ],
    );
  }
}

export async function loadIncidents(db: PGlite): Promise<IncidentLog[]> {
  const r = await db.query<Record<string, unknown>>("SELECT * FROM incident_logs ORDER BY ts");
  return r.rows.map((row) => ({
    id: row.id as string,
    channelId: (row.channel_id as string | null) ?? undefined,
    address: (row.address as string | null) ?? undefined,
    kind: row.kind as IncidentLog["kind"],
    detail: row.detail as string,
    text: (row.text as string | null) ?? undefined,
    resolution: (row.resolution as string | null) ?? undefined,
    ts: toIso(row.ts),
  }));
}

// ───────────────────────── reports + seq (internal state) ─────────────────────────
export async function saveReports(db: PGlite, reports: ReportRecord[]): Promise<void> {
  for (const rep of reports) {
    await db.query(
      `INSERT INTO reports (message_id, channel_id, reporter, reason, ts)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (message_id, reporter) DO UPDATE SET channel_id=$2, reason=$4, ts=$5`,
      [rep.messageId, rep.channelId, rep.reporter, rep.reason ?? null, rep.ts],
    );
  }
}

export async function loadReports(db: PGlite): Promise<ReportRecord[]> {
  const r = await db.query<Record<string, unknown>>("SELECT * FROM reports");
  return r.rows.map((row) => ({
    messageId: row.message_id as string,
    channelId: row.channel_id as string,
    reporter: row.reporter as string,
    reason: (row.reason as string | null) ?? undefined,
    ts: toIso(row.ts),
  }));
}

// ───────────────────────── game_state (mini-games, ADR 0016) ─────────────────────────
export async function saveGameState(db: PGlite, gameState: [string, unknown][]): Promise<void> {
  for (const [gameId, state] of gameState) {
    await db.query(
      `INSERT INTO game_state (game_id, state) VALUES ($1,$2)
       ON CONFLICT (game_id) DO UPDATE SET state=$2`,
      [gameId, JSON.stringify(state)],
    );
  }
}

export async function loadGameState(db: PGlite): Promise<[string, unknown][]> {
  const r = await db.query<Record<string, unknown>>("SELECT * FROM game_state");
  return r.rows.map((row) => [row.game_id as string, asJson(row.state, {})]);
}

export async function saveSeq(db: PGlite, seq: number): Promise<void> {
  await db.query(
    `INSERT INTO meta (key, value) VALUES ('seq', $1) ON CONFLICT (key) DO UPDATE SET value=$1`,
    [String(seq)],
  );
}

export async function loadSeq(db: PGlite): Promise<number> {
  const r = await db.query<{ value: string }>("SELECT value FROM meta WHERE key = 'seq'");
  return r.rows[0] ? Number(r.rows[0].value) : 0;
}

// An arbitrary key in meta (service state, e.g. the indexer cursor). Survives a restart.
export async function getMeta(key: string): Promise<string | null> {
  const db = await getDb();
  const r = await db.query<{ value: string }>("SELECT value FROM meta WHERE key = $1", [key]);
  return r.rows[0]?.value ?? null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.query(
    "INSERT INTO meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2",
    [key, value],
  );
}

// ───────────────────────── assembling the whole snapshot ↔ Postgres ─────────────────────────
/**
 * Read all state from Postgres into StoreSnapshot form. Returns null if the DB isn't initialized yet
 * (no 'initialized' marker) — in which case the caller migrates the data from the JSON snapshot. modCache isn't persisted
 * (a dedup cache — it will be rebuilt). donation.message is re-linked to the same object as in messages.
 */
export async function loadStore(): Promise<StoreSnapshot | null> {
  const db = await getDb();
  const init = await db.query("SELECT value FROM meta WHERE key = 'initialized'");
  if (init.rows.length === 0) return null;

  const channels = await loadChannels(db);
  const configs = await loadConfigs(db);
  const profiles = await loadProfiles(db);
  const ledger = await loadLedger(db);
  const donations = await loadDonations(db);
  const messages = await loadMessages(db);
  const blocks = await loadBlocks(db);
  const incidents = await loadIncidents(db);
  const operatorActions = await loadOperatorActions(db);
  const reports = await loadReports(db);
  const gameState = await loadGameState(db);
  const seq = await loadSeq(db);

  const byDonation = new Map<string, MessageRef>();
  for (const m of messages.values()) byDonation.set(m.donationId, m);
  for (const d of donations) {
    const m = byDonation.get(d.id);
    if (m) d.message = m;
  }

  return {
    channelsById: channels.map((c) => [c.id, c]),
    handleToId: channels.map((c) => [c.handle, c.id]),
    configsByChannel: [...configs.entries()],
    profiles: [...profiles.entries()],
    ledger,
    donations,
    messages: [...messages.entries()],
    blocks,
    incidents,
    operatorActions,
    modCache: [],
    reports,
    gameState,
    seq,
  };
}

/**
 * Write the whole snapshot to Postgres (called after mutations). Append-only/updatable entities use upsert;
 * channel_blocks is replaced entirely (to support unblocking). Sets the 'initialized' marker.
 */
export async function saveStore(snap: StoreSnapshot): Promise<void> {
  const db = await getDb();
  // B2: we write the whole snapshot IN A SINGLE TRANSACTION. Otherwise a crash between `DELETE channel_blocks` and the re-insert
  // would lose all realm bans (a security control), and a partial write would produce a "torn" snapshot.
  // PGlite is a single connection, so BEGIN/COMMIT on `db` wraps all the save* helpers too (we pass them the same `db`).
  await db.exec("BEGIN");
  try {
    await saveChannels(
      db,
      snap.channelsById.map(([, c]) => c),
    );
    await saveConfigs(db, new Map(snap.configsByChannel));
    await saveProfiles(db, new Map(snap.profiles));
    await saveLedger(db, snap.ledger);
    await saveDonations(db, snap.donations);
    await saveMessages(db, new Map(snap.messages));
    await db.exec("DELETE FROM channel_blocks");
    await saveBlocks(db, snap.blocks);
    await saveOperatorActions(db, snap.operatorActions);
    await saveIncidents(db, snap.incidents);
    await saveReports(db, snap.reports);
    await saveGameState(db, snap.gameState);
    await saveSeq(db, snap.seq);
    await db.query(
      "INSERT INTO meta (key, value) VALUES ('initialized', '1') ON CONFLICT (key) DO NOTHING",
    );
    await db.exec("COMMIT");
  } catch (e) {
    await db.exec("ROLLBACK");
    throw e;
  }
}
