# Карта аудита

> Единая точка входа для код-/секьюрити-аудита ядра. Связывает **инварианты** (CLAUDE.md §4) с кодом,
> который их держит; перечисляет **границы доверия**, **dev-поверхность** и историю **находок → ADR**.
> Источник механики — `docs/core-spec.md`; риски — `docs/legal-and-risk.md`.

---

## 1. Инварианты §4 → код, который их обеспечивает

| # | Инвариант | Где держится (файл → функция) |
|---|-----------|-------------------------------|
| §4.1 | **Некастодиальность** (деньги донор→стример напрямую, оператор не держит) | `lib/chain/donation-tx.ts → buildDonationInstructions` (две `transferChecked`: 97% стримеру, 3% трежери, нет аккаунта оператора); `lib/chain/indexer.ts → extractDonation` (само-контроль расщепления); `server/ingest.ts → ingestSignature` (97%-нога обязана уйти на payout-ATA канала) |
| §4.2 | **Деньги финальны** (нет возвратов/чарджбэков) | `lib/data/mock-provider.ts → record` (`Donation.final = true`; в коде нет пути возврата/отмены денег — единственное списание касается репутации, см. §4.5) |
| §4.3 | **Репутация непередаваема/непродаваема** | нет ни одного метода transfer/sell/exchange репутации; это вычисляемое число от журнала (`lib/reputation.ts`), привязанное к паре (донор, канал) в `ledger`, не токен |
| §4.4 | **Репутация детерминирована/перевычислима** | `lib/reputation.ts` — чистые `pointsForAmount` (целочисленно, R1), `computePoints`, `resolveTier`; одинаковый журнал → одинаковая цифра |
| §4.5 | **Репутация только растёт** (искл. `ADMIN_VOID`) | `lib/reputation.ts → computePoints` (`Math.max(0, …)`); единственная отрицательная дельта — `ADMIN_VOID`, создаётся в `mock-provider.ts → applyOperatorAction` под `requireOperator` |
| §4.6 | **Текст приватен до показа** | `lib/data/mock-provider.ts → redactDonation` + `isChannelManager` (вырезают текст в публичных чтениях); `MessageRef.state` по умолчанию `HELD`; `setMessageState` под `requireChannelManager` |
| §4.7 | **Деньги ≠ показ** | `lib/data/mock-provider.ts → record` (очки/журнал банкуются сразу, независимо от текста); `server/ingest.ts` принимает деньги, даже если текст отклонён/отсутствует |

---

## 2. Границы доверия (что сервер проверяет, не веря клиенту)

- **Приём денег из цепочки** — `server/ingest.ts`: сервер САМ достаёт tx из RPC (`ingestSignature` /
  `ingestActivation`), проверяет расщепление 97/3, payout-ATA канала, привязку текста по хэшу memo,
  `payer === владелец` (активация), порог суммы, и `finalized` в chain-режиме (анти-реорг, ADR 0011/M2).
- **Чистый разбор tx** — `lib/chain/indexer.ts`: само-контроль комиссии и **ровно** ожидаемые ноги (R2).
- **Аутентификация** — `server/auth.ts`: SIWS-nonce одноразовый + TTL, подпись ed25519 (on-curve),
  привязка к домену/времени (ADR 0011/M1). Личность — только из проверенного токена.
- **Граница RPC** — `app/api/v1/rpc/route.ts`: вайтлист методов, `CHAIN_FORBIDDEN` (оффчейн-симуляция
  доната/активации запрещена в chain-режиме, C1/ADR 0008), личность из токена (R10), `args`-валидация (R3),
  не-утечка внутренних ошибок (R4).
- **Кодек** — `lib/data/codec.ts`: лимит длины `__bigint` (анти-DoS, ADR 0011/L2).
- **Денежный конфиг** — `lib/chain/addresses.ts → assertMoneyConfig` + `instrumentation.ts`: fail-closed на
  mainnet (devnet-трежери/ключ запрещены в проде, C2/ADR 0009).

---

## 3. Dev-поверхность и её гейтинг

| Поверхность | Файл | Видна в проде? |
|-------------|------|----------------|
| `__reset` | `route.ts` | Нет — `IS_PROD` → 403 |
| Инъекция сбоев `failMode` | `route.ts` | Нет — только `!IS_PROD` (ADR 0011/L1) |
| Вход по адресу без подписи | `route.ts` | Нет — только `!IS_PROD && !CHAIN_MODE` (R10) |
| `DevToolbar` | `components/layout/dev-toolbar.tsx` | Инертна — провайдер chain не реализует `__setAddress` |
| `/dev/kitchen-sink` | `app/dev/layout.tsx` (гейт) → `…/kitchen-sink/page.tsx` | Нет — серверный `DevLayout` зовёт `notFound()` при `IS_PROD` → 404 (проверено: prod 404, dev 200) |

---

## 4. История находок → ADR → статус

Аудит «как украсть на mainnet» (нумерация C/H/M/L):

| Находка | Описание | Статус | ADR |
|---------|----------|--------|-----|
| C1 | Подделка оффчейн-доната через RPC | закрыто | 0008 |
| C2 | Дефолтный devnet-трежери на mainnet | закрыто (fail-closed) | 0009 |
| H3 | Личность per-request (AsyncLocalStorage) | закрыто | 0010 |
| M1/M2/L1/L2 | SIWS-binding, finalized, failMode, bigint-cap | закрыто | 0011 |
| H2 | Сбор активации ончейн | закрыто | (ончейн-активация) |
| H1 | payout диктуется сервером (нужна ончейн-привязка) | **открыто** | 0011 |
| L3 | Токен в `localStorage` (XSS) | **открыто** | 0011 |
| M3 | Нет фонового индексер-сервиса | **открыто** | 0011 |

Проход по надёжности/аккуратности (нумерация R, отдельное пространство имён — не путать с выше):

| R | Описание | Файл | ADR |
|---|----------|------|-----|
| R1 | Целочисленные очки (детерминизм §4.4) | `lib/reputation.ts` | 0012 |
| R2 | Строгий разбор ног индексера | `lib/chain/indexer.ts` | 0012 |
| R3 | Валидация `args` как массива | `app/api/v1/rpc/route.ts` | 0012 |
| R4 | Не утекать тексты внутренних ошибок | `app/api/v1/rpc/route.ts` | 0012 |
| R5 | Лимит длины текста на ingest | `server/ingest.ts` | 0012 |
| R6 | Граница кэша дедупа модерации | `lib/data/mock-provider.ts` | 0012 |
| R7 | Поздняя привязка текста → успех, не null | `lib/data/mock-provider.ts` | 0012 |
| R8 | `gate` пропускает работу при простое | `lib/data/mock-provider.ts` | 0012 |
| R9 | Явная авторизация `addChannelBlock` | `lib/data/mock-provider.ts` | 0012 |
| R10 | Dev-вход по адресу заглушён и в chain-режиме | `app/api/v1/rpc/route.ts` | 0012 |

Аудит эскроу-контракта escrow-task (G3a; ончейн-игра, не ядро — ADR 0015/0017). Пространство имён **ESC**
(отдельное — не путать с C/H/M/L ядра выше). Объём: `anchor/programs/escrow-task/src/lib.rs` + зеркало
`src/games/escrow-task/machine.ts` + билдеры `src/lib/chain/escrow-tx.ts` + сверка `src/server/escrow-verify.ts`.
Редеплои с патчами (program id неизменен `GPP2BCNMp8peLh3uySuEqPb2gWanr4xw5Lf3X7Kx7GU4`): раунд 1 (ESC-1…5) —
devnet tx `51o1WLv8uRTwghpo4ZCkLmMSVHuGZJKsjBRq3suDdmtJrJnyyJSpaDZ5DdZ8r65jcuX58gy5VBGUEiaqfTGNm6nS`;
раунд 2 (ESC-10/ESC-11) — tx `4ev52BPL7AzPUQMuYsxyxYGg7fG8TB3RMoPfmJvK9uJdkwtYc4rND8ERqDV4ygwuMpcASxYinQNSfx12rbytejEz`.
Все исправления подтверждены `scripts/escrow-smoke.ts` (включая DUST-атаку на хранилище для ESC-10).

| ESC | Severity | Находка | Статус | Где исправлено |
|-----|----------|---------|--------|----------------|
| ESC-1 | **CRITICAL** | `resolver`/`treasury` задавал вызывающий `fund` → донор назначал резолвером себя и забирал донат назад после выполнения (clawback) | **закрыто** | `lib.rs` — `RESOLVER`/`TREASURY` теперь протокольные `pubkey!`-константы; `fund` пишет `e.resolver = RESOLVER`/`e.treasury = TREASURY`; `Fund` accounts больше не принимает эти аккаунты. `escrow-tx.ts` — `FundParams` без них. Смоук: чужой ключ не может `mark_disputed` |
| ESC-2 | **HIGH** | `mark_done` не проверял срок → просрочивший стример (no-show) перехватывал деньги, бесконечно продлевая дедлайн | **закрыто** | `lib.rs → mark_done`: `require!(now <= e.done_deadline)` (как `EXEC_OVER` в `machine.ts`) |
| ESC-3 | MEDIUM | `resolve_dispute` работал из `Done` без поднятого спора → резолвер мог развернуть любой выполненный эскроу | **закрыто** | `lib.rs → resolve_dispute`: `require!(state == Disputed)`; разворот только после `mark_disputed` |
| ESC-4 | MEDIUM | `Disputed` — ловушка ликвидности: нет таймаут-выхода, бездействие резолвера = деньги заперты навсегда | **закрыто** | `lib.rs → resolve_timeout`: `Disputed` после `dispute_deadline` → `ToStreamer` (tiebreaker §11), permissionless |
| ESC-5 | MEDIUM | `cancel` без предела → донор отменял в любой момент до «Готово», обнуляя работу стримера | **закрыто** | `lib.rs → cancel`: `Pending` И `now <= e.accept_deadline` (grace = `CANCEL_GRACE`); `machine.ts → cancel` — то же (`GRACE_OVER`) |
| ESC-6 | LOW | `verifyEscrowOnChain` сверял donor/amount/mint, но не streamer/resolver/treasury (делало ESC-1 достижимым) | снято в корне | ESC-1 закрыл контрактно: `resolver`/`treasury` неподделываемы (константы), сервер на их сверку не полагается. Косметика зеркала по `streamer` — открыто (LOW, только консистентность, не деньги) |
| ESC-7 | LOW | `mint` на цепочке не привязан к USDC — `fund` принимает любой mint | **открыто** (отложено) | смягчено серверной сверкой `mint` (`escrow-verify.ts`); ончейн-пин сломал бы смоук на тестовом mint; вернуть перед mainnet |
| ESC-8 | INFO | anchor-тест звал удалённую `accept()` — не компилировался | **закрыто** | `anchor/tests/escrow-task.ts` переписан под новую модель (refund + проверка ESC-1); каноническая проверка — `scripts/escrow-smoke.ts` |
| ESC-9 | INFO | тестовые окна + плейсхолдер program id + нет `emit!`-событий + гонка спора у дедлайна | частично | program id уже реальный (задеплоен); окна — намеренно короткие под тест (`FAST_TEST_WINDOWS` + consts в `lib.rs`, вернуть перед mainnet одной правкой). `emit!` — открыто (INFO; индексер декодирует аккаунты). Гонку дедлайна закрыл ESC-11 |
| ESC-10 | **HIGH** | перманентная заморозка: любой шлёт «пыль» на публичный ATA хранилища → `claim` выводит ровно `e.amount`, остаток валит `close_account` (`NonNativeHasBalance`) → tx claim откатывается навсегда; деньги и рента заперты, цена атаки — пыль+газ | **закрыто** | `lib.rs → claim_streamer`/`claim_donor`: выплата от ЖИВОГО баланса `vault.amount` (не `e.amount`) → пыль распределяется/возвращается, vault обнуляется и закрывается. Смоук: обе ветки с DUST-атакой проходят |
| ESC-11 | LOW→MED | `mark_disputed` без верхней границы окна: без кипера `Done` висит долго, резолвер мог пометить спор вне окна оспаривания и развернуть к донору (ончейн слабее `machine.ts`) | **закрыто** | `lib.rs → mark_disputed`: `require!(now <= e.dispute_deadline)` (паритет с `raiseDispute`); заодно закрывает гонку ESC-9 (`mark_disputed` и `resolve_timeout`-ветка Done больше не пересекаются во времени) |

Подтверждено корректным (контр-аудит): получатели зашиты в PDA и читаются в `claim` только из `escrow`
(даже резолвер не направит деньги третьему — держит некастодиальность маршрутизации); `overflow-checks`;
нет reinit/double-claim; канонический PDA + ATA в `claim`; `resolve_timeout` реально permissionless.

---

## 5. Как читать код под аудит

- Денежный путь: `chain-provider.ts` (сборка/подпись) → цепочка → `ingest.ts` (трастлесс-приём) →
  `mock-provider.ts → record` (банк очков/журнал).
- Авторизация: все мутации `mock-provider.ts` идут через `requireSession`/`requireOperator`/
  `requireChannelOwner`/`requireChannelManager` — личность приходит per-request (ADR 0010).
- Выбор провайдера: `lib/data/provider.ts → createDataProvider` (mock/api), chain — отдельно через
  `app/providers.tsx` → `lib/chain/chain-providers.tsx` (Solana-стек вне bundle mock/api, ADR 0004).
