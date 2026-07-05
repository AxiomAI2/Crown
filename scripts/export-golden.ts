/**
 * Экспорт GOLDEN-векторов для миграции на канистры (docs/migration-plan.md M-1, ADR 0021).
 *
 * Принцип golden-паритета: канистра НЕ «пишется заново» — Rust-порт обязан проходить те же
 * тест-векторы, что и наша TS-логика, байт-в-байт. Этот скрипт ВЫЗЫВАЕТ реальные TS-функции
 * (extractDonation/extractActivation, computePoints/computePointsAsOf, машину споров) на
 * фиксированных входах и записывает их фактический выход — эталон строится по коду, не от руки.
 *
 *   npm run golden          → testdata/golden/{donations,reputation,disputes}.json
 *
 * Детерминизм: все адреса — фиксированные 32-байтовые ключи, все времена — константы от
 * T0 = 2026-01-01T00:00:00Z. Повторный запуск даёт байт-в-байт тот же файл (диф = изменение
 * поведения TS-логики → сознательное обновление эталона в том же коммите).
 *
 * Rust-сторона: canister/core читает эти же файлы в юнит-тестах (`cargo test`).
 * Один светофор паритета: `npm run golden && cargo test` (см. docs/manual-testing.md).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PublicKey, type ParsedTransactionWithMeta } from "@solana/web3.js";
import {
  FEE_BPS,
  ACTIVATION_FEE_MICRO,
  USDC_DECIMALS,
  splitAmount,
} from "../src/lib/chain/addresses";
import { extractActivation, extractDonation } from "../src/lib/chain/indexer";
import {
  computePoints,
  computePointsAsOf,
  pointsForAmount,
  POINTS_PER_USDC,
} from "../src/lib/reputation";
import type { LedgerEvent, LedgerType } from "../src/lib/data/types";
import {
  accept,
  applyResolution,
  cancel,
  castVote,
  claim,
  createTask,
  dueResolution,
  DISPUTE_LOSS_PENALTY,
  DISPUTE_WIN_BONUS,
  markDone,
  raiseDispute,
  reject,
  repEffects,
  tally,
  WINDOWS,
  type CreateTaskInput,
} from "../src/games/escrow-task/machine";
import type { EscrowTask, TaskDispute, VoteChoice } from "../src/games/escrow-task/types";
import { GameBusError } from "../src/games/bus";
import { buildDisputeParamsMessage } from "../src/lib/chain/dispute-params";
import { buildOpenDisputeMessage, buildVoteMessage } from "../src/lib/chain/dispute-vote";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "testdata", "golden");

/** micro-очки — каноническое целочисленное представление очков (§4.4 детерминизм). */
const MICRO_PER_POINT = 1_000_000;
const toMicro = (points: number) => Math.round(points * MICRO_PER_POINT);

/** bigint → десятичная строка при сериализации (деньги в JSON — строкой, конвенция репо). */
const jsonify = <T>(v: T): unknown =>
  v === null
    ? null
    : JSON.parse(JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val)));

const write = (name: string, data: unknown) => {
  const path = join(OUT_DIR, name);
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
  console.log(`✅ ${name}`);
};

// ───────────────────────── детерминированные адреса ─────────────────────────
// PublicKey из фиксированных 32 байт — валидный base58, одинаковый при каждом запуске.
const pk = (fill: number) => new PublicKey(new Uint8Array(32).fill(fill)).toBase58();
const MINT = pk(1);
const TREASURY_ATA = pk(2);
const DONOR = pk(3);
const STREAMER_ATA = pk(4);
const OTHER = pk(5);
const DONOR_ATA = pk(6);
const WRONG_MINT = pk(7);

const T0_ISO = "2026-01-01T00:00:00.000Z";
const T0 = Date.parse(T0_ISO);
const BLOCK_TIME = Math.floor(T0 / 1000);

// ═════════════════════════ 1. donations.json ═════════════════════════

interface Ix {
  program?: string;
  parsed?: unknown;
  programId?: string;
  accounts?: string[];
  data?: string;
}

const tokenLeg = (
  dest: string,
  amount: bigint,
  authority = DONOR,
  mint = MINT,
  type = "transferChecked",
): Ix => ({
  program: "spl-token",
  parsed: {
    type,
    info: {
      authority,
      destination: dest,
      mint,
      source: DONOR_ATA,
      tokenAmount: { amount: amount.toString(), decimals: USDC_DECIMALS },
    },
  },
});
const memoIx = (raw: string): Ix => ({ program: "spl-memo", parsed: raw });
/** Инструкция без `parsed` (PartiallyDecoded) — парсер обязан её игнорировать. */
const rawIx: Ix = { programId: pk(8), accounts: [], data: "3Bxs4h24hBtQy9rw" };

const makeTx = (instructions: Ix[], opts?: { err?: unknown; blockTime?: number | null }) =>
  ({
    blockTime: opts && "blockTime" in opts ? opts.blockTime : BLOCK_TIME,
    meta: { err: opts?.err ?? null },
    transaction: { message: { instructions } },
  }) as unknown as ParsedTransactionWithMeta;

const donationMemo = (m: string | null = null) => JSON.stringify({ c: "chan-1", d: "don-1", m });

/** Валидная пара ног 97/3 для суммы `amount` (сборка через тот же splitAmount, что и прод-код). */
const legsFor = (amount: bigint): Ix[] => {
  const { fee, net } = splitAmount(amount);
  return [tokenLeg(STREAMER_ATA, net), tokenLeg(TREASURY_ATA, fee)];
};

function donationVectors() {
  const opts = { mint: new PublicKey(MINT), treasuryAta: new PublicKey(TREASURY_ATA) };
  const cases: {
    name: string;
    note?: string;
    tx: ParsedTransactionWithMeta | null;
    blockTimeNull?: boolean;
  }[] = [
    { name: "valid-100usdc", tx: makeTx([...legsFor(100_000_000n), memoIx(donationMemo())]) },
    {
      name: "valid-fractional-floor",
      note: "fee = floor(amount*300/10000): 1000001 → fee 30000, net 970001",
      tx: makeTx([...legsFor(1_000_001n), memoIx(donationMemo())]),
    },
    {
      name: "valid-small-fee-zero",
      note: "33 micro → fee 0 (целочисленный floor), нога комиссии с amount=0 легитимна",
      tx: makeTx([...legsFor(33n), memoIx(donationMemo())]),
    },
    { name: "valid-msg-ref", tx: makeTx([...legsFor(5_000_000n), memoIx(donationMemo("msg-42"))]) },
    {
      name: "valid-with-noise",
      note: "лишние инструкции (raw без parsed, чужой mint, не-transferChecked) игнорируются",
      tx: makeTx([
        rawIx,
        tokenLeg(OTHER, 999n, DONOR, WRONG_MINT),
        tokenLeg(OTHER, 999n, DONOR, MINT, "transfer"),
        ...legsFor(10_000_000n),
        memoIx(donationMemo()),
      ]),
    },
    {
      name: "valid-null-blocktime",
      tx: makeTx([...legsFor(2_000_000n), memoIx(donationMemo())], { blockTime: null }),
    },
    { name: "null-tx", tx: null },
    {
      name: "failed-tx",
      tx: makeTx([...legsFor(100_000_000n), memoIx(donationMemo())], {
        err: { InstructionError: [0, "Custom"] },
      }),
    },
    { name: "no-memo", tx: makeTx(legsFor(100_000_000n)) },
    { name: "memo-not-json", tx: makeTx([...legsFor(100_000_000n), memoIx("hello")]) },
    {
      name: "memo-missing-d",
      tx: makeTx([...legsFor(100_000_000n), memoIx(JSON.stringify({ c: "chan-1" }))]),
    },
    {
      name: "memo-activation-shape",
      tx: makeTx([...legsFor(100_000_000n), memoIx(JSON.stringify({ act: "chan-1" }))]),
    },
    { name: "one-leg", tx: makeTx([tokenLeg(TREASURY_ATA, 3_000_000n), memoIx(donationMemo())]) },
    {
      name: "three-legs",
      tx: makeTx([...legsFor(100_000_000n), tokenLeg(OTHER, 1n), memoIx(donationMemo())]),
    },
    {
      name: "no-treasury-leg",
      tx: makeTx([
        tokenLeg(STREAMER_ATA, 97_000_000n),
        tokenLeg(OTHER, 3_000_000n),
        memoIx(donationMemo()),
      ]),
    },
    {
      name: "both-legs-to-treasury",
      tx: makeTx([
        tokenLeg(TREASURY_ATA, 97_000_000n),
        tokenLeg(TREASURY_ATA, 3_000_000n),
        memoIx(donationMemo()),
      ]),
    },
    {
      name: "authority-mismatch",
      tx: makeTx([
        tokenLeg(STREAMER_ATA, 97_000_000n, DONOR),
        tokenLeg(TREASURY_ATA, 3_000_000n, OTHER),
        memoIx(donationMemo()),
      ]),
    },
    {
      name: "wrong-split",
      note: "fee на 1 micro больше эталона → сырой перевод, не донат",
      tx: makeTx([
        tokenLeg(STREAMER_ATA, 96_999_999n),
        tokenLeg(TREASURY_ATA, 3_000_001n),
        memoIx(donationMemo()),
      ]),
    },
    {
      name: "zero-amount",
      note: "текущее поведение парсера: пара ног 0/0 проходит самоконтроль (порог — забота ingest)",
      tx: makeTx([...legsFor(0n), memoIx(donationMemo())]),
    },
  ];
  return cases.map((c, i) => {
    const signature = `golden-don-${String(i + 1).padStart(3, "0")}`;
    return {
      name: c.name,
      ...(c.note ? { note: c.note } : {}),
      signature,
      tx: jsonify(c.tx),
      expected: jsonify(extractDonation(c.tx, signature, opts)),
    };
  });
}

function activationVectors() {
  const opts = { mint: new PublicKey(MINT), treasuryAta: new PublicKey(TREASURY_ATA) };
  const actMemo = JSON.stringify({ act: "chan-1" });
  const cases: { name: string; note?: string; tx: ParsedTransactionWithMeta | null }[] = [
    {
      name: "valid-activation",
      tx: makeTx([tokenLeg(TREASURY_ATA, ACTIVATION_FEE_MICRO, OTHER), memoIx(actMemo)]),
    },
    {
      name: "valid-below-threshold",
      note: "сумму парсер НЕ валидирует (порог ACTIVATION_FEE_MICRO проверяет ingest)",
      tx: makeTx([tokenLeg(TREASURY_ATA, 1n, OTHER), memoIx(actMemo)]),
    },
    {
      name: "valid-last-memo-wins",
      note: "невалидный memo раньше валидного не сбрасывает act (`?? act`)",
      tx: makeTx([
        memoIx("junk"),
        tokenLeg(TREASURY_ATA, ACTIVATION_FEE_MICRO, OTHER),
        memoIx(actMemo),
      ]),
    },
    { name: "null-tx", tx: null },
    {
      name: "failed-tx",
      tx: makeTx([tokenLeg(TREASURY_ATA, ACTIVATION_FEE_MICRO, OTHER), memoIx(actMemo)], {
        err: {},
      }),
    },
    { name: "no-memo", tx: makeTx([tokenLeg(TREASURY_ATA, ACTIVATION_FEE_MICRO, OTHER)]) },
    {
      name: "donation-memo-instead",
      tx: makeTx([tokenLeg(TREASURY_ATA, ACTIVATION_FEE_MICRO, OTHER), memoIx(donationMemo())]),
    },
    {
      name: "two-legs",
      tx: makeTx([
        tokenLeg(TREASURY_ATA, 1_000_000n, OTHER),
        tokenLeg(TREASURY_ATA, 1_000_000n, OTHER),
        memoIx(actMemo),
      ]),
    },
    {
      name: "leg-not-to-treasury",
      tx: makeTx([tokenLeg(STREAMER_ATA, ACTIVATION_FEE_MICRO, OTHER), memoIx(actMemo)]),
    },
  ];
  return cases.map((c, i) => {
    const signature = `golden-act-${String(i + 1).padStart(3, "0")}`;
    return {
      name: c.name,
      ...(c.note ? { note: c.note } : {}),
      signature,
      tx: jsonify(c.tx),
      expected: jsonify(extractActivation(c.tx, signature, opts)),
    };
  });
}

// ═════════════════════════ 2. reputation.json ═════════════════════════

let evSeq = 0;
function ev(type: LedgerType, pointsDelta: number, amountMicro: bigint, ts = T0_ISO): LedgerEvent {
  evSeq += 1;
  return {
    id: `golden-ev-${evSeq}`,
    donor: DONOR,
    creator: "chan-1",
    type,
    amount: amountMicro,
    pointsDelta,
    configVersion: 1,
    ts,
  };
}
const don = (amountMicro: bigint, ts = T0_ISO) =>
  ev("DONATION", pointsForAmount(amountMicro), amountMicro, ts);

/** Сериализация события: amount строкой + КАНОНИЧЕСКОЕ целое pointsDeltaMicro + tsMs (канистре не нужен ISO-парсер). */
const serializeEvent = (e: LedgerEvent) => ({
  id: e.id,
  donor: e.donor,
  creator: e.creator,
  type: e.type,
  amount: e.amount.toString(),
  pointsDelta: e.pointsDelta,
  pointsDeltaMicro: toMicro(e.pointsDelta),
  configVersion: e.configVersion,
  ts: e.ts,
  tsMs: Date.parse(e.ts),
});

function reputationGolden() {
  const t = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

  const foldCases: { name: string; note?: string; events: LedgerEvent[] }[] = [
    { name: "empty", events: [] },
    { name: "single-2.5usdc", events: [don(2_500_000n)] },
    {
      name: "cents-exact",
      note: "0.01+0.02+0.07 = ровно 0.10 (свёртка в целых micro)",
      events: [don(10_000n), don(20_000n), don(70_000n)],
    },
    {
      name: "float-repr-0.1+0.2",
      note: "классика float: в micro-очках ровно 0.3",
      events: [don(100_000n), don(200_000n)],
    },
    {
      name: "split-neutrality-half+half",
      note: "дробление доната нейтрально: 0.5+0.5 == 1.0",
      events: [don(500_000n), don(500_000n)],
    },
    { name: "split-neutrality-whole", events: [don(1_000_000n)] },
    {
      name: "float-repr-4.85",
      note: "4.85*1e6 = 4849999.999… → Math.round → 4850000",
      events: [don(4_850_000n)],
    },
    {
      name: "dispute-lost-subtracts",
      events: [don(100_000_000n), ev("DISPUTE_LOST", -DISPUTE_LOSS_PENALTY, 0n)],
    },
    {
      name: "dispute-won-adds",
      events: [don(1_000_000n), ev("DISPUTE_WON", DISPUTE_WIN_BONUS, 0n)],
    },
    {
      name: "clamp-to-zero",
      note: "итог < 0 → 0 (кламп ОДИН раз в конце свёртки, не по шагам)",
      events: [
        don(5_000_000n),
        ev("DISPUTE_LOST", -DISPUTE_LOSS_PENALTY, 0n),
        ev("DISPUTE_WON", DISPUTE_WIN_BONUS, 0n),
      ],
    },
    {
      name: "order-independence-a",
      events: [ev("DISPUTE_LOST", -DISPUTE_LOSS_PENALTY, 0n), don(60_000_000n)],
    },
    {
      name: "order-independence-b",
      events: [don(60_000_000n), ev("DISPUTE_LOST", -DISPUTE_LOSS_PENALTY, 0n)],
    },
    {
      name: "large-sum",
      note: "потолок точности Number: 9e9 USDC = 9e15 micro-очков < 2^53",
      events: [don(9_000_000_000_000_000n)],
    },
  ];

  const asOfEvents = [
    don(10_000_000n, t(0)),
    ev("DISPUTE_LOST", -DISPUTE_LOSS_PENALTY, 0n, t(60_000)),
    don(100_000_000n, t(120_000)),
  ];
  const asOfCases: { name: string; note?: string; events: LedgerEvent[]; asOf: string }[] = [
    { name: "asof-before-all", events: asOfEvents, asOf: new Date(T0 - 1).toISOString() },
    {
      name: "asof-first-exact",
      note: "граница ВКЛЮЧИТЕЛЬНА: ts == asOf входит в срез",
      events: asOfEvents,
      asOf: t(0),
    },
    {
      name: "asof-mid-clamps-slice",
      note: "срез до второго события: 10−50 → кламп 0",
      events: asOfEvents,
      asOf: t(60_000),
    },
    { name: "asof-just-before-second", events: asOfEvents, asOf: t(59_999) },
    { name: "asof-future-full", events: asOfEvents, asOf: t(999_999_999) },
  ];

  return {
    _readme:
      "Эталон движка репутации. КАНОН — целые micro-очки (pointsDeltaMicro/expectedMicroPoints); дробные поля — производные для UI. См. testdata/golden/README.md",
    constants: { POINTS_PER_USDC, MICRO_PER_POINT, DISPUTE_WIN_BONUS, DISPUTE_LOSS_PENALTY },
    pointsForAmount: [
      0n,
      1n,
      33n,
      500_000n,
      1_000_000n,
      2_500_000n,
      4_850_000n,
      100_000_000n,
      9_000_000_000_000_000n,
    ].map((amountMicro) => ({
      amountMicro: amountMicro.toString(),
      expectedPoints: pointsForAmount(amountMicro),
      expectedMicroPoints: toMicro(pointsForAmount(amountMicro)),
    })),
    computePoints: foldCases.map((c) => ({
      name: c.name,
      ...(c.note ? { note: c.note } : {}),
      events: c.events.map(serializeEvent),
      expectedPoints: computePoints(c.events),
      expectedMicroPoints: toMicro(computePoints(c.events)),
    })),
    computePointsAsOf: asOfCases.map((c) => ({
      name: c.name,
      ...(c.note ? { note: c.note } : {}),
      events: c.events.map(serializeEvent),
      asOf: c.asOf,
      asOfMs: Date.parse(c.asOf),
      expectedPoints: computePointsAsOf(c.events, c.asOf),
      expectedMicroPoints: toMicro(computePointsAsOf(c.events, c.asOf)),
    })),
  };
}

// ═════════════════════════ 3. disputes.json ═════════════════════════

const iso = (msVal: number) => new Date(msVal).toISOString();

function tallyVectors() {
  let vSeq = 0;
  const vote = (choice: VoteChoice, weight: number, voter?: string) => {
    vSeq += 1;
    return {
      voter: voter ?? `voter-${vSeq}`,
      choice,
      weight,
      weightMicro: toMicro(weight),
      at: T0_ISO,
    };
  };
  const disp = (votes: ReturnType<typeof vote>[], quorum: number) => ({
    by: OTHER,
    openedAt: T0_ISO,
    votingEndsAt: iso(T0 + WINDOWS.voting),
    quorum,
    quorumMicro: toMicro(quorum),
    votes,
  });
  const cases: { name: string; note?: string; dispute: ReturnType<typeof disp> }[] = [
    { name: "no-votes-quorum1", dispute: disp([], 1) },
    {
      name: "no-votes-quorum0",
      note: "сумма 0 НЕ меньше кворума 0 → сравнение голосов → ничья → стримеру",
      dispute: disp([], 0),
    },
    { name: "below-quorum", dispute: disp([vote("not_completed", 10), vote("completed", 2)], 13) },
    {
      name: "exact-quorum-counts",
      note: "кворум по сумме весов ВКЛЮЧИТЕЛЬНО: 10+3 == 13 → голоса считаются",
      dispute: disp([vote("completed", 10), vote("not_completed", 3)], 13),
    },
    { name: "completed-wins", dispute: disp([vote("completed", 10), vote("not_completed", 3)], 5) },
    {
      name: "not-completed-wins",
      dispute: disp([vote("not_completed", 10), vote("completed", 3)], 5),
    },
    { name: "tie-to-streamer", dispute: disp([vote("completed", 7), vote("not_completed", 7)], 5) },
    {
      name: "fractional-weights",
      note: "веса дробные (репутация с копейками); домен — кратные 1e-6",
      dispute: disp(
        [vote("completed", 2.5), vote("not_completed", 2.25), vote("not_completed", 0.5)],
        1,
      ),
    },
  ];
  return cases.map((c) => {
    const { quorumMicro: _qm, votes, ...d } = c.dispute;
    const td: TaskDispute = { ...d, votes: votes.map(({ weightMicro: _wm, ...v }) => v) };
    return {
      name: c.name,
      ...(c.note ? { note: c.note } : {}),
      dispute: c.dispute,
      expected: tally(td),
    };
  });
}

/** Сценарный прогон машины: последовательность операций с абсолютным временем → снапшот после каждого шага. */
interface StepDef {
  offsetMs: number;
  op:
    | "accept"
    | "reject"
    | "cancel"
    | "markDone"
    | "raiseDispute"
    | "castVote"
    | "dueResolution"
    | "applyDue"
    | "claim";
  by?: string;
  quorum?: number;
  voter?: string;
  choice?: VoteChoice;
  weight?: number;
  streamerAddress?: string;
  note?: string;
}

function runScenario(
  name: string,
  input: Partial<CreateTaskInput>,
  steps: StepDef[],
  note?: string,
) {
  const createInput: CreateTaskInput = {
    id: `golden-task-${name}`,
    channelId: "chan-1",
    donor: DONOR,
    amount: "5000000",
    text: "golden task",
    ...input,
  };
  let task = createTask(createInput, T0);
  const outSteps = steps.map((s) => {
    const now = T0 + s.offsetMs;
    const base = { op: s.op, atMs: now, at: iso(now), ...(s.note ? { note: s.note } : {}) };
    const args: Record<string, unknown> = {};
    try {
      switch (s.op) {
        case "accept":
          task = accept(task, now);
          break;
        case "reject":
          task = reject(task, now);
          break;
        case "cancel":
          task = cancel(task, now);
          break;
        case "markDone":
          task = markDone(task, now);
          break;
        case "raiseDispute":
          args.by = s.by ?? OTHER;
          args.quorum = s.quorum ?? 1;
          args.quorumMicro = toMicro(s.quorum ?? 1);
          task = raiseDispute(task, s.by ?? OTHER, s.quorum ?? 1, now);
          break;
        case "castVote": {
          const v = { voter: s.voter!, choice: s.choice!, weight: s.weight!, at: iso(now) };
          args.vote = { ...v, weightMicro: toMicro(v.weight) };
          task = castVote(task, v, now);
          break;
        }
        case "dueResolution":
          return { ...base, expected: { due: dueResolution(task, now) } };
        case "applyDue": {
          const due = dueResolution(task, now);
          if (!due) throw new Error(`applyDue при null-исходе в сценарии ${name}`);
          const effects = repEffects(task, due).map((e) => ({
            ...e,
            pointsDeltaMicro: toMicro(e.pointsDelta),
          }));
          task = applyResolution(task, due, now);
          return { ...base, expected: { due, task: jsonify(task), repEffects: effects } };
        }
        case "claim":
          args.by = s.by;
          args.streamerAddress = s.streamerAddress ?? STREAMER_ATA;
          task = claim(task, s.by!, s.streamerAddress ?? STREAMER_ATA, now);
          break;
      }
      return {
        ...base,
        ...(Object.keys(args).length ? { args } : {}),
        expected: { task: jsonify(task) },
      };
    } catch (e) {
      if (e instanceof GameBusError)
        return {
          ...base,
          ...(Object.keys(args).length ? { args } : {}),
          expected: { error: e.code },
        };
      throw e;
    }
  });
  const finalEffects = task.resolution
    ? repEffects(task, task.resolution).map((e) => ({
        ...e,
        pointsDeltaMicro: toMicro(e.pointsDelta),
      }))
    : null;
  return {
    name,
    ...(note ? { note } : {}),
    t0Ms: T0,
    t0: T0_ISO,
    create: { input: createInput, expected: jsonify(createTask(createInput, T0)) },
    steps: outSteps,
    final: { task: jsonify(task), repEffects: finalEffects },
  };
}

function disputeScenarios() {
  const G = WINDOWS.grace;
  const E = WINDOWS.executionDefault;
  const D = WINDOWS.disputeWindow;
  const V = WINDOWS.voting;
  const done = G + 10_000; // штатная сдача: после грейса, до дедлайна
  const disputeAt = done + 30_000;

  return [
    runScenario("happy-path-completed", {}, [
      { offsetMs: 10_000, op: "accept" },
      { offsetMs: done, op: "markDone" },
      {
        offsetMs: done + D,
        op: "dueResolution",
        note: "ровно на границе окна спора → ещё null (строгое >)",
      },
      { offsetMs: done + D + 1, op: "applyDue" },
    ]),
    runScenario("pending-expired", {}, [
      { offsetMs: E, op: "dueResolution", note: "ровно на дедлайне → null (строгое >)" },
      { offsetMs: E + 1, op: "applyDue" },
    ]),
    runScenario("accepted-no-show", {}, [
      { offsetMs: 10_000, op: "accept" },
      { offsetMs: E + 1, op: "applyDue" },
    ]),
    runScenario("reject-to-donor", {}, [{ offsetMs: 10_000, op: "reject" }]),
    runScenario("cancel-at-grace-edge", {}, [
      { offsetMs: 10_000, op: "accept" },
      { offsetMs: G, op: "cancel", note: "ровно конец грейса — ещё можно (строгое >)" },
    ]),
    runScenario("cancel-after-grace-error", {}, [{ offsetMs: G + 1, op: "cancel" }]),
    runScenario("markdone-grace-boundaries", {}, [
      { offsetMs: 5_000, op: "accept" },
      { offsetMs: G, op: "markDone", note: "ровно конец грейса — ещё нельзя (нестрогое <=)" },
      { offsetMs: G + 1, op: "markDone" },
    ]),
    runScenario("accept-deadline-boundaries", {}, [
      { offsetMs: E, op: "accept", note: "ровно на дедлайне — ещё можно (строгое >)" },
    ]),
    runScenario("accept-expired-error", {}, [{ offsetMs: E + 1, op: "accept" }]),
    runScenario(
      "dispute-won-by-initiator",
      {},
      [
        { offsetMs: 10_000, op: "accept" },
        { offsetMs: done, op: "markDone" },
        { offsetMs: disputeAt, op: "raiseDispute", by: OTHER, quorum: 5 },
        {
          offsetMs: disputeAt + 10_000,
          op: "castVote",
          voter: "juror-a",
          choice: "not_completed",
          weight: 10,
        },
        {
          offsetMs: disputeAt + 20_000,
          op: "castVote",
          voter: "juror-b",
          choice: "completed",
          weight: 3,
        },
        { offsetMs: disputeAt + V, op: "dueResolution", note: "ровно конец голосования → null" },
        { offsetMs: disputeAt + V + 1, op: "applyDue" },
      ],
      "исход vote_not_completed: деньги донору, инициатору DISPUTE_WON +10",
    ),
    runScenario(
      "dispute-lost-by-initiator",
      {},
      [
        { offsetMs: 10_000, op: "accept" },
        { offsetMs: done, op: "markDone" },
        { offsetMs: disputeAt, op: "raiseDispute", by: OTHER, quorum: 5 },
        {
          offsetMs: disputeAt + 10_000,
          op: "castVote",
          voter: "juror-a",
          choice: "completed",
          weight: 10,
        },
        {
          offsetMs: disputeAt + 20_000,
          op: "castVote",
          voter: "juror-b",
          choice: "not_completed",
          weight: 3,
        },
        { offsetMs: disputeAt + V + 1, op: "applyDue" },
      ],
      "исход vote_completed: деньги стримеру (DONATION донору), инициатору DISPUTE_LOST −50",
    ),
    runScenario(
      "dispute-no-quorum",
      {},
      [
        { offsetMs: 10_000, op: "accept" },
        { offsetMs: done, op: "markDone" },
        { offsetMs: disputeAt, op: "raiseDispute", by: OTHER, quorum: 100 },
        {
          offsetMs: disputeAt + 10_000,
          op: "castVote",
          voter: "juror-a",
          choice: "not_completed",
          weight: 5,
        },
        { offsetMs: disputeAt + V + 1, op: "applyDue" },
      ],
      "нет кворума → стримеру, инициатор НЕ наказан (наказание только за активный проигрыш)",
    ),
    runScenario(
      "dispute-tie",
      {},
      [
        { offsetMs: 10_000, op: "accept" },
        { offsetMs: done, op: "markDone" },
        { offsetMs: disputeAt, op: "raiseDispute", by: OTHER, quorum: 5 },
        {
          offsetMs: disputeAt + 10_000,
          op: "castVote",
          voter: "juror-a",
          choice: "completed",
          weight: 7,
        },
        {
          offsetMs: disputeAt + 20_000,
          op: "castVote",
          voter: "juror-b",
          choice: "not_completed",
          weight: 7,
        },
        { offsetMs: disputeAt + V + 1, op: "applyDue" },
      ],
      "ничья → стримеру (презумпция), инициатор не наказан",
    ),
    runScenario("vote-guards", {}, [
      {
        offsetMs: 10_000,
        op: "castVote",
        voter: "juror-a",
        choice: "completed",
        weight: 1,
        note: "голос вне спора",
      },
      { offsetMs: 10_000, op: "accept" },
      { offsetMs: done, op: "markDone" },
      { offsetMs: disputeAt, op: "raiseDispute", by: OTHER, quorum: 5 },
      {
        offsetMs: disputeAt + 10_000,
        op: "castVote",
        voter: "juror-a",
        choice: "not_completed",
        weight: 10,
      },
      {
        offsetMs: disputeAt + 20_000,
        op: "castVote",
        voter: "juror-a",
        choice: "completed",
        weight: 10,
        note: "повторный голос того же адреса",
      },
      {
        offsetMs: disputeAt + V,
        op: "castVote",
        voter: "juror-b",
        choice: "completed",
        weight: 1,
        note: "ровно конец окна — ещё можно (строгое >)",
      },
      {
        offsetMs: disputeAt + V + 1,
        op: "castVote",
        voter: "juror-c",
        choice: "completed",
        weight: 1,
      },
    ]),
    runScenario("dispute-window-boundaries", {}, [
      { offsetMs: 10_000, op: "accept" },
      { offsetMs: done, op: "markDone" },
      {
        offsetMs: done + D,
        op: "raiseDispute",
        by: OTHER,
        quorum: 1,
        note: "ровно конец окна спора — ещё можно (строгое >)",
      },
    ]),
    runScenario("dispute-window-over-error", {}, [
      { offsetMs: 10_000, op: "accept" },
      { offsetMs: done, op: "markDone" },
      { offsetMs: done + D + 1, op: "raiseDispute", by: OTHER, quorum: 1 },
    ]),
    runScenario("dispute-before-done-error", {}, [
      { offsetMs: 10_000, op: "raiseDispute", by: OTHER, quorum: 1 },
    ]),
    runScenario("claim-flow", {}, [
      { offsetMs: 10_000, op: "accept" },
      { offsetMs: done, op: "markDone" },
      {
        offsetMs: done + 1_000,
        op: "claim",
        by: STREAMER_ATA,
        note: "до разрешения забирать нечего",
      },
      { offsetMs: done + D + 1, op: "applyDue" },
      { offsetMs: done + D + 2_000, op: "claim", by: DONOR, note: "не получатель (to_streamer)" },
      { offsetMs: done + D + 3_000, op: "claim", by: STREAMER_ATA },
      { offsetMs: done + D + 4_000, op: "claim", by: STREAMER_ATA, note: "повторный клейм" },
    ]),
    runScenario(
      "execution-clamp-min",
      { executionMs: 1_000 },
      [],
      "срок < минимума → кламп к max(executionMin, grace+1)",
    ),
    runScenario(
      "execution-clamp-max",
      { executionMs: 100 * 24 * 3_600_000 },
      [],
      "срок > 90 дней → кламп к executionMax",
    ),
    runScenario(
      "fractional-amount-effects",
      { amount: "2500001" },
      [
        { offsetMs: 10_000, op: "accept" },
        { offsetMs: done, op: "markDone" },
        { offsetMs: done + D + 1, op: "applyDue" },
      ],
      "дробные очки в DONATION-эффекте: 2.500001",
    ),
  ];
}

// ═════════════════════════ запись ═════════════════════════

mkdirSync(OUT_DIR, { recursive: true });

write("donations.json", {
  _readme:
    "Эталон разбора ончейн-транзакций (extractDonation/extractActivation). tx — минимальный срез ParsedTransactionWithMeta (только читаемые парсером поля). Деньги — десятичными строками micro-USDC. См. testdata/golden/README.md",
  constants: {
    USDC_DECIMALS,
    FEE_BPS,
    ACTIVATION_FEE_MICRO: ACTIVATION_FEE_MICRO.toString(),
    splitRule: "fee = floor(amount * FEE_BPS / 10000); net = amount - fee",
  },
  addresses: { MINT, TREASURY_ATA, DONOR, STREAMER_ATA, OTHER, DONOR_ATA, WRONG_MINT },
  donations: donationVectors(),
  activations: activationVectors(),
});

write("reputation.json", reputationGolden());

// Канон-сообщения подписи (кросс-языковой пин: Rust-тесты канистры читают ЭТОТ файл —
// расхождение текстов TS↔Rust ловится сборкой, а не отказом подписи на живом стенде).
write("messages.json", {
  _readme:
    "Канонические строки под подпись кошелька, порождены TS-билдерами. Rust-тесты (governance.rs, arbiter.rs) сверяют свои билдеры с этим файлом байт-в-байт.",
  disputeParams: buildDisputeParamsMessage("chan-1", "OWNER", 1, {
    minReputationToDisputeMicro: 1_000_000n,
    minWeightToVoteMicro: 1_000_000n,
    quorumMicro: 1_000_000n,
    disputeWindowSecs: 120,
    votingWindowSecs: 120,
    dMaxMicro: 0n,
  }),
  openDispute: buildOpenDisputeMessage("ESCROW", "chan-1", "BY"),
  vote: buildVoteMessage("ESCROW", "chan-1", "VOTER", "not_completed"),
});

write("disputes.json", {
  _readme:
    "Эталон машины споров (tally + сценарии переходов). Канон весов/дельт — целые micro (weightMicro/pointsDeltaMicro). expected.error — код GameBusError, состояние не меняется. См. testdata/golden/README.md",
  constants: { WINDOWS, DISPUTE_WIN_BONUS, DISPUTE_LOSS_PENALTY },
  tally: tallyVectors(),
  scenarios: disputeScenarios(),
});

console.log(`\nGolden-векторы выгружены в ${OUT_DIR}`);
