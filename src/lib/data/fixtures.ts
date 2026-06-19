/**
 * Фикстуры сида `standing-v0.1` (frontend/mock-data.md §4). Детерминированные данные: фиксированные
 * таймстампы, очки банкуются ТЕМ ЖЕ движком (lib/reputation.ts) → цифры консистентны с инвариантом §4.4.
 *
 * Покрытие: 3 канала (ACTIVE-витрина / ACTIVE-пустой / BASIC), тиры до «Легенды», сообщения во всех
 * состояниях (SHOWN/HELD CLEAR/FLAG/длинное/др. язык/HIDDEN), пример ADMIN_VOID, блок-лист, инциденты.
 */
import { bankPoints } from "../reputation";
import { toMicro } from "../utils";
import type {
  Channel,
  ChannelBlock,
  ChannelConfig,
  Donation,
  Identity,
  IncidentLog,
  LedgerEvent,
  LightProfile,
  MessageRef,
  MessageState,
  ModerationVerdict,
  Session,
  Tier,
} from "./types";

// — Фиксированное «сейчас» для детерминизма —
export const SEED = "standing-v0.1";
const NOW_MS = Date.parse("2026-06-19T12:00:00.000Z");
const ago = (minutes: number): string => new Date(NOW_MS - minutes * 60_000).toISOString();

// — Адреса (base58-подобные строки) —
export const ADDR = {
  donorA: "7xKpHnQ9aR4dF2sV3fQaYbZc1D2e3F4g5H6j7K8mNpA",
  donorB: "9aR4dF2sV3fQaYbZc1D2e3F4g5H6j7K8mNpQ7xKpHnB",
  creatorL: "Lum1CreatorXyZ8aR4dF2sV3fQaYbZc1D2e3F4g5H6jC",
  operator: "0p3raT0rZc1D2e3F4g5H6j7K8mNpQ7xKpHnQ9aR4dFD",
  novaOwner: "N0vaOwnerF4g5H6j7K8mNpQ7xKpHnQ9aR4dF2sV3fQE",
  kebabOwner: "KebabOwnr5H6j7K8mNpQ7xKpHnQ9aR4dF2sV3fQaYbF",
  d1: "D1xZc1D2e3F4g5H6j7K8mNpQ7xKpHnQ9aR4dF2sV3aG",
  d2: "D2yZc1D2e3F4g5H6j7K8mNpQ7xKpHnQ9aR4dF2sV3bH",
  d3: "D3zZc1D2e3F4g5H6j7K8mNpQ7xKpHnQ9aR4dF2sV3cJ",
  d4: "D4aZc1D2e3F4g5H6j7K8mNpQ7xKpHnQ9aR4dF2sV3dK",
  d5: "D5bZc1D2e3F4g5H6j7K8mNpQ7xKpHnQ9aR4dF2sV3eL",
  d6: "D6cZc1D2e3F4g5H6j7K8mNpQ7xKpHnQ9aR4dF2sV3fM",
  troll: "Tr0llZc1D2e3F4g5H6j7K8mNpQ7xKpHnQ9aR4dF2sgN",
  blocked: "Bl0ckedc1D2e3F4g5H6j7K8mNpQ7xKpHnQ9aR4dF2hP",
} as const;

// — Тиры по умолчанию (core-spec.md §6, цвета — design-system.md §2) —
export const DEFAULT_TIERS: Tier[] = [
  { name: "Новичок", threshold: 0, color: "#9AA1B2", badge: "rookie", perks: [] },
  { name: "Свой", threshold: 500, color: "#7FA7C9", badge: "regular", perks: [{ label: "Цветной ник" }] },
  {
    name: "Постоянный",
    threshold: 5_000,
    color: "#6FC3A6",
    badge: "frequent",
    perks: [{ label: "Эмодзи в чате" }],
  },
  {
    name: "VIP",
    threshold: 50_000,
    color: "#C9A24B",
    badge: "vip",
    perks: [{ label: "Приоритет алерта" }],
  },
  {
    name: "Легенда",
    threshold: 200_000,
    color: "#E8B04B",
    badge: "legend",
    perks: [{ label: "Закреплённый бейдж" }],
  },
];

// — Конфиги каналов —
export const CONFIG_LUMI: ChannelConfig = {
  channelId: "ch-lumi",
  version: 1,
  hash: "cfg-lumi-v1",
  reputation: {
    curve: {
      kind: "bracket",
      brackets: [
        { upToUSDC: 50, rate: 100 },
        { upToUSDC: 200, rate: 60 },
        { upToUSDC: null, rate: 30 },
      ],
    },
    multipliers: [{ kind: "first_donation", factor: 1.5 }],
    decay: { enabled: false },
  },
  tiers: DEFAULT_TIERS,
  minDonation: toMicro(1),
  minDonationWithText: toMicro(2),
  messageMaxLen: 200,
  profanityPolicy: "queue",
  nameMode: "allow_display_names",
  textShowMode: "manual",
  overlay: { style: "default", sound: true, minAmountToShow: toMicro(1), tts: false },
  moderators: [],
  updatedAt: ago(100_000),
};

export const CONFIG_NOVA: ChannelConfig = {
  channelId: "ch-nova",
  version: 1,
  hash: "cfg-nova-v1",
  reputation: {
    curve: { kind: "linear", pointsPerUSDC: 100 },
    multipliers: [],
    decay: { enabled: false },
  },
  tiers: DEFAULT_TIERS,
  minDonation: toMicro(1),
  minDonationWithText: toMicro(2),
  messageMaxLen: 280,
  profanityPolicy: "mask",
  nameMode: "addresses_only",
  textShowMode: "manual",
  overlay: { style: "default", sound: false, minAmountToShow: toMicro(5), tts: false },
  moderators: [],
  updatedAt: ago(5_000),
};

export const CONFIG_KEBAB: ChannelConfig = {
  channelId: "ch-kebab",
  version: 1,
  hash: "cfg-kebab-v1",
  reputation: {
    curve: { kind: "linear", pointsPerUSDC: 100 },
    multipliers: [],
    decay: { enabled: false },
  },
  tiers: DEFAULT_TIERS,
  minDonation: toMicro(1),
  minDonationWithText: toMicro(2),
  messageMaxLen: 200,
  profanityPolicy: "queue",
  nameMode: "addresses_only",
  textShowMode: "manual",
  overlay: { style: "default", sound: false, minAmountToShow: toMicro(1), tts: false },
  moderators: [],
  updatedAt: ago(1_000),
};

export const CHANNELS: Channel[] = [
  {
    id: "ch-lumi",
    ownerAddress: ADDR.creatorL,
    payoutAddress: ADDR.creatorL,
    handle: "lumi",
    status: "ACTIVE",
    activatedAt: ago(150_000),
    configVersion: 1,
    createdAt: ago(200_000),
  },
  {
    id: "ch-nova",
    ownerAddress: ADDR.novaOwner,
    payoutAddress: ADDR.novaOwner,
    handle: "nova",
    status: "ACTIVE",
    activatedAt: ago(6_000),
    configVersion: 1,
    createdAt: ago(8_000),
  },
  {
    id: "ch-kebab",
    ownerAddress: ADDR.kebabOwner,
    payoutAddress: ADDR.kebabOwner,
    handle: "kebab",
    status: "BASIC",
    configVersion: 1,
    createdAt: ago(2_000),
  },
];

// — Спеки донатов → построение Donation/MessageRef/LedgerEvent с банкингом —
interface Spec {
  donor: string;
  usd: number;
  msg?: { text: string; state: MessageState; verdict?: ModerationVerdict; lang?: string };
}

const LONG_TEXT =
  "Спасибо за стрим! Смотрю тебя уже полгода, и это лучший контент про разработку, что я видел. " +
  "Продолжай в том же духе — отдельный респект за разборы архитектуры и честность.";

const LUMI_SPECS: Spec[] = [
  { donor: ADDR.donorB, usd: 5000 },
  { donor: ADDR.donorB, usd: 5000 },
  { donor: ADDR.donorB, usd: 200, msg: { text: "За лучший стрим месяца! 🔥", state: "SHOWN" } },
  { donor: ADDR.donorB, usd: 50 },
  { donor: ADDR.donorA, usd: 50, msg: { text: "Привет с первого доната!", state: "HELD", verdict: "CLEAR" } },
  { donor: ADDR.donorA, usd: 20 },
  { donor: ADDR.donorA, usd: 10 },
  { donor: ADDR.d1, usd: 80, msg: { text: "ты худший стример лол", state: "HELD", verdict: "FLAG" } },
  { donor: ADDR.d2, usd: 40, msg: { text: LONG_TEXT, state: "HELD", verdict: "CLEAR" } },
  { donor: ADDR.d3, usd: 25, msg: { text: "¡Gracias por el directo!", state: "HELD", verdict: "CLEAR", lang: "es" } },
  { donor: ADDR.d4, usd: 15, msg: { text: "(скрыто стримером)", state: "HIDDEN", verdict: "CLEAR" } },
  { donor: ADDR.d5, usd: 10 },
  { donor: ADDR.d6, usd: 3 },
  { donor: ADDR.troll, usd: 30 },
];

function buildChannelData(
  channelId: string,
  cfg: ChannelConfig,
  specs: Spec[],
): { donations: Donation[]; messages: MessageRef[]; ledger: LedgerEvent[] } {
  const donations: Donation[] = [];
  const messages: MessageRef[] = [];
  const ledger: LedgerEvent[] = [];
  const seen = new Set<string>();

  specs.forEach((s, i) => {
    const amount = toMicro(s.usd);
    const fee = (amount * 3n) / 100n;
    const net = amount - fee;
    const isFirst = !seen.has(s.donor);
    seen.add(s.donor);
    const pointsDelta = bankPoints(amount, cfg.reputation, { isFirstDonation: isFirst });
    const ts = ago((specs.length - i) * 53);
    const n = String(i + 1).padStart(3, "0");
    const donationId = `d-${channelId}-${n}`;

    let message: MessageRef | undefined;
    if (s.msg) {
      const messageId = `m-${channelId}-${n}`;
      message = {
        id: messageId,
        donationId,
        channelId,
        text: s.msg.text,
        lang: s.msg.lang,
        state: s.msg.state,
        autoVerdict: s.msg.verdict ?? "CLEAR",
        contentHash: `hash-${messageId}`,
        shownAt: s.msg.state === "SHOWN" ? ts : undefined,
        createdAt: ts,
      };
      messages.push(message);
    }

    donations.push({
      id: donationId,
      channelId,
      donor: s.donor,
      amount,
      feeAmount: fee,
      netToStreamer: net,
      final: true,
      ts,
      message,
    });
    ledger.push({
      id: `l-${channelId}-${n}`,
      donor: s.donor,
      creator: channelId,
      type: "DONATION",
      amount,
      pointsDelta,
      configVersion: cfg.version,
      ts,
    });
  });

  return { donations, messages, ledger };
}

export interface Seed {
  channels: Channel[];
  configs: ChannelConfig[];
  identities: Identity[];
  profiles: LightProfile[];
  donations: Donation[];
  messages: MessageRef[];
  ledger: LedgerEvent[];
  blocks: ChannelBlock[];
  incidents: IncidentLog[];
}

export function buildSeed(): Seed {
  const lumi = buildChannelData("ch-lumi", CONFIG_LUMI, LUMI_SPECS);

  // Пример ADMIN_VOID: тролль получил очки за $30, оператор обнулил за нелегальщину.
  const trollPoints = lumi.ledger
    .filter((e) => e.donor === ADDR.troll)
    .reduce((sum, e) => sum + e.pointsDelta, 0);
  lumi.ledger.push({
    id: "l-ch-lumi-void",
    donor: ADDR.troll,
    creator: "ch-lumi",
    type: "ADMIN_VOID",
    amount: 0n,
    pointsDelta: -trollPoints,
    configVersion: 1,
    ts: ago(20),
  });

  const profiles: LightProfile[] = [
    {
      address: ADDR.donorB,
      displayName: "nova_whale",
      bio: "Поддерживаю любимых стримеров.",
      links: ["https://example.com"],
    },
  ];

  const identities: Identity[] = [
    { address: ADDR.donorA, level: "address_only" },
    { address: ADDR.donorB, level: "light" },
    { address: ADDR.creatorL, level: "creator" },
    { address: ADDR.operator, level: "address_only" },
  ];

  const blocks: ChannelBlock[] = [
    {
      channelId: "ch-lumi",
      blockedAddress: ADDR.blocked,
      reason: "Спам в сообщениях",
      byModerator: ADDR.creatorL,
      ts: ago(500),
    },
  ];

  const incidents: IncidentLog[] = [
    {
      id: "inc-001",
      channelId: "ch-lumi",
      kind: "report",
      detail: "Зритель пожаловался на сообщение в ленте.",
      ts: ago(300),
    },
    {
      id: "inc-002",
      channelId: "ch-kebab",
      kind: "hard_block",
      detail: "Авто-карантин: hard-block в тексте доната.",
      resolution: "QUARANTINED, передано в T&S.",
      ts: ago(120),
    },
    {
      id: "inc-003",
      address: ADDR.blocked,
      kind: "sanction_hit",
      detail: "Адрес найден в санкционном списке (mock-скрин).",
      ts: ago(60),
    },
  ];

  return {
    channels: CHANNELS,
    configs: [CONFIG_LUMI, CONFIG_NOVA, CONFIG_KEBAB],
    identities,
    profiles,
    donations: lumi.donations,
    messages: lumi.messages,
    ledger: lumi.ledger,
    blocks,
    incidents,
  };
}

// — Dev-идентичности (переключаются в /dev/kitchen-sink, mock-data.md §4) —
export type IdentityKey = "guest" | "donorA" | "donorB" | "creatorL" | "operator";

export const DEV_SESSIONS: Record<IdentityKey, Session> = {
  guest: { address: null, level: "address_only", isCreator: false, isOperator: false },
  donorA: { address: ADDR.donorA, level: "address_only", isCreator: false, isOperator: false },
  donorB: { address: ADDR.donorB, level: "light", isCreator: false, isOperator: false },
  creatorL: { address: ADDR.creatorL, level: "creator", isCreator: true, isOperator: false },
  operator: { address: ADDR.operator, level: "address_only", isCreator: false, isOperator: true },
};
