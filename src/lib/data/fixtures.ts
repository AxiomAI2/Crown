/**
 * Дефолты для НОВЫХ каналов. Стаб-каналы (lumi/nova/kebab) и dev-личности удалены: теперь личность —
 * реальный адрес кошелька, каналы создают реальные пользователи (Фаза 3, ADR 0004/0005).
 */
import { toMicro } from "../utils";
import type { ChannelConfig, Tier } from "./types";

// Потолок числа тиров на канал (анти-«бесконечный список»). Дефолтных — 5, потолок — 20.
export const MAX_TIERS = 20;

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
  { name: "VIP", threshold: 50_000, color: "#C9A24B", badge: "vip", perks: [{ label: "Приоритет алерта" }] },
  {
    name: "Легенда",
    threshold: 200_000,
    color: "#E8B04B",
    badge: "legend",
    perks: [{ label: "Закреплённый бейдж" }],
  },
];

/** Конфиг нового канала по умолчанию (курс репутации фиксирован 1$=100; настраиваются тиры и минимумы). */
export function defaultChannelConfig(channelId: string): ChannelConfig {
  return {
    channelId,
    version: 1,
    hash: `cfg-${channelId}-v1`,
    tiers: DEFAULT_TIERS,
    minDonation: toMicro(0.1),
    minDonationWithText: toMicro(0.5),
    messageMaxLen: 200,
    profanityPolicy: "queue",
    nameMode: "addresses_only",
    textShowMode: "manual",
    overlay: { style: "default", sound: false, minAmountToShow: toMicro(0.1), tts: false },
    moderators: [],
    updatedAt: new Date().toISOString(),
  };
}
