/**
 * Дефолты для НОВЫХ каналов. Стаб-каналы (lumi/nova/kebab) и dev-личности удалены: теперь личность —
 * реальный адрес кошелька, каналы создают реальные пользователи (Фаза 3, ADR 0004/0005).
 */
import { toMicro } from "../utils";
import type { ChannelConfig, Tier } from "./types";

// Потолок числа тиров на канал (анти-«бесконечный список»). Дефолтных — 5, потолок — 20.
export const MAX_TIERS = 20;

// Лимит длины описания тира (UGC, опц.). Короче описания канала — это подпись к тиру, не блок текста.
export const TIER_DESC_MAX = 140;

// — Тиры по умолчанию (yellow-paper §9.1, цвета — design-system.md §2). Пороги — в очках (= USDC при
// курсе 1:1, ADR 0007): $5 / $50 / $500 / $2000 суммарных донатов. Стартовые дефолты, калибруются. —
export const DEFAULT_TIERS: Tier[] = [
  { name: "Новичок", threshold: 0, color: "#9AA1B2", badge: "rookie", perks: [] },
  {
    name: "Свой",
    threshold: 5,
    color: "#7FA7C9",
    badge: "regular",
    perks: [{ label: "Цветной ник" }],
  },
  {
    name: "Постоянный",
    threshold: 50,
    color: "#6FC3A6",
    badge: "frequent",
    perks: [{ label: "Эмодзи в чате" }],
  },
  {
    name: "VIP",
    threshold: 500,
    color: "#C9A24B",
    badge: "vip",
    perks: [{ label: "Приоритет алерта" }],
  },
  {
    name: "Легенда",
    threshold: 2_000,
    color: "#E8B04B",
    badge: "legend",
    perks: [{ label: "Закреплённый бейдж" }],
  },
];

/** Конфиг нового канала по умолчанию (курс фиксирован: 1 USDC = 1 очко, ADR 0007; настраиваются тиры и минимумы). */
export function defaultChannelConfig(channelId: string): ChannelConfig {
  return {
    channelId,
    version: 1,
    hash: `cfg-${channelId}-v1`,
    tiers: DEFAULT_TIERS,
    minDonation: toMicro(0.1),
    minDonationWithText: toMicro(0.5),
    minReputationToTask: 0, // §10: по умолчанию без порога; стример поднимает для антиспама заданий
    minReputationToDispute: 1, // §10: право поднять спор — от 1 очка (≈ 1 USDC доната), стример настраивает
    messageMaxLen: 200,
    nameMode: "addresses_only",
    textShowMode: "manual",
    moderators: [],
    enabledGames: [], // мини-игры по умолчанию выключены (cold-start; ADR 0016)
    updatedAt: new Date().toISOString(),
  };
}
