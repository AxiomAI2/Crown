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
`src/games/escrow-task/machine.ts` + билдеры `src/lib/chain/escrow-tx.ts` + сверка `src/server/escrow-verify.ts`
+ сеттлер/банковка репутации (`src/server/indexer-service.ts`, `src/games/escrow-task/handlers.ts`).
Редеплои с патчами (program id неизменен `GPP2BCNMp8peLh3uySuEqPb2gWanr4xw5Lf3X7Kx7GU4`): раунд 1 (ESC-1…5) —
devnet tx `51o1WLv8uRTwghpo4ZCkLmMSVHuGZJKsjBRq3suDdmtJrJnyyJSpaDZ5DdZ8r65jcuX58gy5VBGUEiaqfTGNm6nS`;
раунд 2 (ESC-10/ESC-11) — tx `4ev52BPL7AzPUQMuYsxyxYGg7fG8TB3RMoPfmJvK9uJdkwtYc4rND8ERqDV4ygwuMpcASxYinQNSfx12rbytejEz`;
раунд 3 (ESC-13 контракт; ESC-12 + ESC-6 — серверные) — tx `LDESFuePHUi1CLpPRfz2BzU5E37PLWvtdq5Jb26vccc8mgvpL6YGZgvi8cS6Bv6kuQgDcWJzpoe7avXGQJSTNMB`;
раунд 4 (ESC-17 контракт; ESC-14/ESC-15/ESC-16 — серверные) — tx `uaryR9At2WrHco7NFVYWRHEcudjq8u6R7uagfwzZbicwfYi4tUzU13npE6y6j12x42A14fA2kd7y9qtkFZYTxhx`;
раунд 5 (ESC-18 + ESC-6 fail-closed + кламп окна + `graceUntil` — БЕЗ редеплоя, серверные/клиентские/доки);
раунд 6 (**M3** event-индексер claim'ов + `settle` строго по ончейн-исходу — БЕЗ редеплоя, серверные);
раунд 7 (повторный аудит: ESC-15 лок по `gameId` вместо канала + ESC-17 off-chain `executionMin > grace` — БЕЗ редеплоя);
раунд 8 (минимизация, поведение неизменно: убран мёртвый `present` из `escrowOutcome`; off-chain `acceptDeadline`
схлопнут в `executionDeadline` (были равны); общий `readEscrowAccount` в `escrow-verify`; снят мёртвый `DISC.accept`);
раунд 9 (минимизация: сняты write-only поля `proposedExecutionMs`/`acceptedAt`/`doneAt` — нигде не читались; `DecodedIx`
больше не экспортируется). on-chain `Accepted` НЕ трогаем — это намеренный legacy-совместимый escape-hatch (его снятие
заперло бы средства старых Accepted-эскроу), а не мёртвый код.
Все исправления подтверждены `scripts/escrow-smoke.ts` (DUST-атака ESC-10; mark_done-в-грейсе ESC-13; bad-window ESC-17)
и vitest (ESC-14 повторный claim не чеканит репутацию; ESC-18 повторный escrowTaskId отклонён; ESC-6 fail-closed).

| ESC | Severity | Находка | Статус | Где исправлено |
|-----|----------|---------|--------|----------------|
| ESC-1 | **CRITICAL** | `resolver`/`treasury` задавал вызывающий `fund` → донор назначал резолвером себя и забирал донат назад после выполнения (clawback) | **закрыто** | `lib.rs` — `RESOLVER`/`TREASURY` теперь протокольные `pubkey!`-константы; `fund` пишет `e.resolver = RESOLVER`/`e.treasury = TREASURY`; `Fund` accounts больше не принимает эти аккаунты. `escrow-tx.ts` — `FundParams` без них. Смоук: чужой ключ не может `mark_disputed` |
| ESC-2 | **HIGH** | `mark_done` не проверял срок → просрочивший стример (no-show) перехватывал деньги, бесконечно продлевая дедлайн | **закрыто** | `lib.rs → mark_done`: `require!(now <= e.done_deadline)` (как `EXEC_OVER` в `machine.ts`) |
| ESC-3 | MEDIUM | `resolve_dispute` работал из `Done` без поднятого спора → резолвер мог развернуть любой выполненный эскроу | **закрыто** | `lib.rs → resolve_dispute`: `require!(state == Disputed)`; разворот только после `mark_disputed` |
| ESC-4 | MEDIUM | `Disputed` — ловушка ликвидности: нет таймаут-выхода, бездействие резолвера = деньги заперты навсегда | **закрыто** | `lib.rs → resolve_timeout`: `Disputed` после `dispute_deadline` → `ToStreamer` (tiebreaker §11), permissionless |
| ESC-5 | MEDIUM | `cancel` без предела → донор отменял в любой момент до «Готово», обнуляя работу стримера | **закрыто** | `lib.rs → cancel`: `Pending` И `now <= e.accept_deadline` (grace = `CANCEL_GRACE`); `machine.ts → cancel` — то же (`GRACE_OVER`) |
| ESC-6 | LOW | `verifyEscrowOnChain` сверял donor/amount/mint, но не streamer и не состояние → задание канала C могло ссылаться на эскроу с чужим streamer | **закрыто** | `escrow-verify.ts`: сверяет `e.streamer == channel.payoutAddress` (payout канала прокинут через `GameContext.channelPayout`) + `state == Pending`. **fail-closed (раунд 5):** chain-эскроу без payout канала → `create` бросает `NO_PAYOUT` (раньше streamer-сверка молча пропускалась). `resolver`/`treasury` уже неподделываемы (ESC-1) |
| ESC-7 | LOW | `mint` на цепочке не привязан к USDC — `fund` принимает любой mint | **открыто** (отложено) | смягчено серверной сверкой `mint` (`escrow-verify.ts`); ончейн-пин сломал бы смоук на тестовом mint; вернуть перед mainnet |
| ESC-8 | INFO | anchor-тест звал удалённую `accept()` — не компилировался | **закрыто** | `anchor/tests/escrow-task.ts` переписан под новую модель (refund + проверка ESC-1); каноническая проверка — `scripts/escrow-smoke.ts` |
| ESC-9 | INFO | тестовые окна + плейсхолдер program id + нет `emit!`-событий + гонка спора у дедлайна | частично | program id уже реальный (задеплоен); окна — намеренно короткие под тест (`FAST_TEST_WINDOWS` + consts в `lib.rs`, вернуть перед mainnet одной правкой). `emit!` — открыто (INFO; индексер декодирует аккаунты). Гонку дедлайна закрыл ESC-11 |
| ESC-10 | **HIGH** | перманентная заморозка: любой шлёт «пыль» на публичный ATA хранилища → `claim` выводит ровно `e.amount`, остаток валит `close_account` (`NonNativeHasBalance`) → tx claim откатывается навсегда; деньги и рента заперты, цена атаки — пыль+газ | **закрыто** | `lib.rs → claim_streamer`/`claim_donor`: выплата от ЖИВОГО баланса `vault.amount` (не `e.amount`) → пыль распределяется/возвращается, vault обнуляется и закрывается. Смоук: обе ветки с DUST-атакой проходят |
| ESC-11 | LOW→MED | `mark_disputed` без верхней границы окна: без кипера `Done` висит долго, резолвер мог пометить спор вне окна оспаривания и развернуть к донору (ончейн слабее `machine.ts`) | **закрыто** | `lib.rs → mark_disputed`: `require!(now <= e.dispute_deadline)` (паритет с `raiseDispute`); заодно закрывает гонку ESC-9 (`mark_disputed` и `resolve_timeout`-ветка Done больше не пересекаются во времени) |
| ESC-12 | **HIGH** | репутация банкуется по офчейн-таймеру без сверки с ончейн-исходом (`settleDue` падал в api, не читал `escrow.resolution`) → liveness-резолвера: офчейн-вердикт `to_donor`, а деньги по `resolve_timeout` ушли стримеру → репутация ≠ деньги (открытые H1/M3, бьющие по продукту) | **закрыто** | `handlers.ts → settle` async: для chain-backed задания читает ончейн-исход (`GameContext.escrowOutcome` → `readEscrowOutcome`) и банкует по ДЕНЬГАМ (`reconcile`), исход неизвестен → откладывает. Хвост (эскроу закрыт до чтения resolution) закрыт **M3** (event-индексер, ниже) |
| ESC-13 | MEDIUM | `mark_done` из `Pending` затирал грейс-окно: стример фронт-раннил «Готово» сразу после `fund` → донорская отмена (`cancel` только из Pending) мертва, ошибочный донат невозвратен | **закрыто** | `lib.rs → mark_done`: `require!(now > e.accept_deadline)` (нельзя сдать в грейсе); зеркало `machine.ts → markDone` (`GRACE_ACTIVE`). Смоук: mark_done-в-грейсе отклонён. Требует `execution_window > CANCEL_GRACE` → ESC-17 |
| ESC-14 | **HIGH** | бесконечная накрутка репутации: `claim` банковал в `settle` (сайд-эффект) ДО `M.claim`; бросок `NOT_WINNER` оставлял статус не-RESOLVED → повторный claim неполучателем чеканил `DONATION`/`DISPUTE_WON` без предела (пробивает Замок 2 — вес голоса = репутация) | **закрыто** | `handlers.ts → claim`: ПЕРСИСТ резолва (`commit settled`) ДО `M.claim` → бросок не оставляет недосохранённого состояния, `settle` идемпотентен (RESOLVED → ранний выход). Тест `handlers.test.ts` ESC-14 |
| ESC-15 | MEDIUM | гонка от async-`settle` (ESC-12): сеттлер и claim/settleDue/create/vote читают общий слайс, ждут RPC, пишут весь массив → двойная банковка + потеря обновлений (мьютекса нет) | **закрыто** | `mock-provider.ts → serializeGameAction` сериализует мутации игры по **`gameId`** (раунд 7; слайс `gameState.get(gameId)` один на ВСЕ каналы — лок по каналу не закрывал межканальную потерю обновлений). Один писатель за раз → снимок не устаревает |
| ESC-16 | MEDIUM | ESC-12 неполный: при сбое RPC `escrowOutcome` возвращал `null` → `settle` падал в офчейн-таймер и фиксировал RESOLVED (репутация ≠ деньги; не самолечится) | **закрыто** | `handlers.ts → settle`: банкуем ТОЛЬКО при известном ончейн-исходе; `null`/неизвестно → откладываем. Офчейн-таймера для chain-backed задания больше нет совсем (M3) |
| ESC-17 | LOW | окно сдачи ≤ грейса → окно `mark_done` пустое/вырожденное (ESC-13): стример не сдаст никогда → вечный no-show | **закрыто** | on-chain: `lib.rs → fund` `require!(execution_window > CANCEL_GRACE)` (смоук подтверждает). off-chain: `WINDOWS.executionMin > grace` (раунд 7 — было `1min ≤ grace`, давало вырожденное окно 1мс); `createTask` и `chain-provider` клампят к `executionMin` (согласованы on/off-chain) |
| ESC-18 | MEDIUM | `create` не проверял уникальность `escrowTaskId` → один профинансированный эскроу (ОДИН платёж) зеркалится в N офчейн-заданий; каждое при `to_streamer` банкует `DONATION` донору → инфляция репутации (§4.4) + удешевление clawback | **закрыто** | `handlers.ts → create`: `escrowTaskId`, уже привязанный к заданию канала, → `ESCROW_REUSED`. Тест `handlers.test.ts` ESC-18 |
| ESC-19 | **HIGH** (продукт) | show-before-accept — ТОЛЬКО офчейн-гейт: контракт не знает текст задания (он офчейн, приватен до показа §4.6). Стример МИНУЯ UI может `mark_done` из `Pending` (ончейн-`accept` нет) → окно спора без диспута → `resolve_timeout` `ToStreamer` → `claim_streamer`, ни разу не показав текст. Никто не узнал о задании → не оспорит → выплата без публичной проверки («молчание = оплата» + скрытый текст = невидимая выплата) | **открыто** (крипто-фаза) | **Рекомендованный фикс (крипто-фаза, Rust + редеплой + аудит):** ончейн-`accept` (Pending→Accepted, подпись = streamer эскроу) + `mark_done` ТРЕБУЕТ `Accepted` → денег без ончейн-accept нет. Индексер (уже есть, M3) ловит accept-tx по PDA/подписи стримера и РАСКРЫВАЕТ текст офчейн (`textState=SHOWN`) — независимо от UI. Итог: деньги ⇒ был accept ⇒ текст раскрыт для комьюнити (успевает до окна спора). Чужим кошельком accept не пройдёт (контракт сверяет signer=streamer). Чище переворота дефолта — модель «сделал → получил» сохраняется. Альтернатива (запасная): дефолт = возврат донору при отсутствии подтверждения. Сейчас `machine.accept` требует `textState=SHOWN` — это **UI/сервер-гейт, ончейн-гарантии НЕ даёт** (помечено в коде) |
| M3 | **HIGH** (продукт) | «репутация ≠ деньги»: эскроу закрывается (claim) в той же tx, что и resolve_timeout → живое чтение аккаунта опаздывает, банковка падала в офчейн-таймер. Главный остаточный фронт (ESC-12/16/18 — его частные случаи) | **закрыто** | event-индексер программы: `indexer-service.scanEscrowClaims` сканирует подписи программы, `escrow-tx.decodeEscrowClaims` декодирует `claim_streamer`/`claim_donor` из инструкций (истина денег переживает закрытие аккаунта), пишет исход в `meta` по PDA; `readEscrowOutcome` читает эту запись для закрытого эскроу. `settle` банкует строго по известному ончейн-исходу. Декодер проверен на реальных claim-tx devnet + юнит-тесты |

Мелочи/робастность (раунд 5): клиентский `execution_window` теперь клампится в `chain-provider.create` к `> grace`
(паритет с `createTask`/ESC-17 — не шлём заведомо ревертящий `fund`); `graceUntil` задаётся в `createTask` от
СОЗДАНИЯ (= ончейн `accept_deadline`), `accept` его не переопределяет (раньше писал `acceptedAt+grace`, расходясь
с реальным окном отмены и сбивая UI-гейт кнопки отмены).

Известно открытым (не патч — политика/прод-настройка): модерация задания fail-open (только HARD_BLOCK; без
`OPENAI_API_KEY` → CLEAR кроме CSAM) — осознанный размен (память проекта), флаг §12 к mainnet; **ESC-7** (пин
`mint` к USDC) и хвост **ESC-9** (длинные прод-окна + `FAST_TEST_WINDOWS=false` + редеплой; `emit!`-события —
сейчас индексер декодирует инструкции, M3) — вернуть перед mainnet; **ESC-19** (show-before-accept — офчейн-гейт,
ончейн `mark_done` из Pending его обходит) — фикс на контракте в крипто-фазе. Зависимость M3: event-индексер обязан
работать в chain-режиме (запускается из `store.ts`); без него chain-backed задания не банкуются (fail-safe —
лучше не начислить, чем начислить не за теми деньгами). Спека §5 разошлась с реализацией (нет «72ч окна
принятия»/«грейса после принятия» — срок сдачи и грейс от СОЗДАНИЯ); учтено здесь.

Подтверждено корректным (контр-аудит): получатели зашиты в PDA и читаются в `claim` только из `escrow`
(даже резолвер не направит деньги третьему — держит некастодиальность маршрутизации); `overflow-checks`;
нет reinit/double-claim; канонический PDA + ATA в `claim`; `resolve_timeout` реально permissionless.

---

## 6. Независимый аудит бэкенда (пространство имён **B**)

Параллельный аудит 5 агентов по зонам (приём денег, авторизация/RPC, стор/репутация, персистентность/модерация,
минимализм); каждая находка перепроверена по коду вручную. Денежный путь и авторизация по сути держатся (подделки
доната/личности, обхода вайтлиста, SQL-инъекций, утечки приватного текста — нет). Найдено и **исправлено** (всё
off-chain, без редеплоя; 69 тестов + typecheck + lint зелёные):

| B | Severity | Находка | Где исправлено |
|---|----------|---------|----------------|
| B1 | MEDIUM | гонка двойного зачисления: `recordDonationFromChain` дедупил по подписи через «нашёл→await(модерация)→записал» без сериализации → 2 параллельных приёма одной подписи (RPC + индексер) зачисляли донат+репутацию дважды | `mock-provider.ts`: `recordDonationFromChain` обёрнут в `runSerialized(ingestTails, signature, …)` (тот же механизм, что ESC-15) |
| B2 | MEDIUM | `saveStore` не транзакционный: `DELETE channel_blocks`+вставка без BEGIN/COMMIT → краш теряет все баны каналов | `store-db.ts`: весь снимок в одной транзакции (BEGIN/COMMIT/ROLLBACK на едином PGlite-соединении) |
| B3 | MEDIUM | escrow event-индексер двигал курсор при `null`-tx (транзиентный RPC) → исход claim'а пропускался навсегда (хвост M3) | `indexer-service.ts → scanEscrowClaims`: `if (!tx) break` — не двигаем курсор, повторим |
| B4 | MEDIUM | нет лимита длины текста у `createDonation`/`precheckText` (chain-приём капал, off-chain нет) → DoS/амплификация OpenAI | `mock-provider.ts`: `createDonation` отклоняет `> messageMaxLen`; `precheckText` режет до лимита перед модерацией |
| B5 | MEDIUM | нет рейт-лимита на `__authNonce`/`__authVerify` (availability, не подделка) | `auth.ts`: `prune` и так чистит протухшие первыми; поднят `MAX_NONCES` (запас). **Настоящая защита — рейт-лимит на краю (Cloudflare/nginx)**, не app-код — задокументировано |
| B6 | LOW→MED | `llmLegalityDisabled` — вечная защёлка: один 401/403 глушил legality-LLM до перезапуска | `moderation.ts`: кулдаун 10 мин вместо защёлки (самовосстановление) |
| B7 | LOW | chain-приём не проверял мин. сумму доната (off-chain проверяет) — обход спам-порога/текст-порога | `ingest.ts`: `amountMicro < cfg.minDonation` → отказ; текст требует `≥ minDonationWithText` |

Ложная тревога (отклонена на перепроверке): «донат-индексер теряет tx при throw» — НЕВЕРНО: `setMeta(курсор)`
стоит после успешной обработки, при throw курсор остаётся на последнем успехе, бросивший sig подтянется на
следующем опросе (`until` эксклюзивный).

Минимализм (мёртвый код удалён, поведение неизменно): снят `parseActivationTx` (0 ссылок), `USDC_MINT_MAINNET`
(0 ссылок), мёртвая ветка `DEFAULT_FLAG_LIST`; сняты лишние `export` (`isValidAddress`, `localAutoModerator`,
`createOpenAiModerator`, `detectLang`, `EscrowOutcome`, `ACTIVATION_FEE_USDC`).

Известный пробел тестов: data-слой (`mock-provider`, `ingest`) и `auth` не покрыты прямыми юнит-тестами —
рекомендуется добавить (B1-гонка, B4-кап, SIWS-nonce). B1 опирается на уже доказанный сериализатор ESC-15.

---

## 5. Как читать код под аудит

- Денежный путь: `chain-provider.ts` (сборка/подпись) → цепочка → `ingest.ts` (трастлесс-приём) →
  `mock-provider.ts → record` (банк очков/журнал).
- Авторизация: все мутации `mock-provider.ts` идут через `requireSession`/`requireOperator`/
  `requireChannelOwner`/`requireChannelManager` — личность приходит per-request (ADR 0010).
- Выбор провайдера: `lib/data/provider.ts → createDataProvider` (mock/api), chain — отдельно через
  `app/providers.tsx` → `lib/chain/chain-providers.tsx` (Solana-стек вне bundle mock/api, ADR 0004).

---

## 7. Аудит кода (корректность + элегантность) — волны A–C

5 параллельных аудиторов по всему `src/`, каждая находка перепроверена вручную (3 ложные тревоги отсеяны).
Исправлено и запушено (тесты + typecheck + lint зелёные, приложение поднимается):
- **Волна A** (`513409f`): tie-break лидерборда (детерминизм §4.4); 3%-комиссия в один источник (`splitAmount`
  в `addresses.ts`); дефолт `ESCROW_RESOLVER` приведён к program-RESOLVER; `resolveTier` 0/0-guard; кодек
  `encode` симметричен `decode`; объединён `TEXT_TOO_LONG`→`TOO_LONG`; мёртвый код; устаревшие комментарии.
- **Волна B** (`f7544ce`): счётчик `Textarea` при контролируемом value; `/me/profile` не затирает правки при
  рефетче; спиннер модерации; дробный ввод сумм (`UsdcAmountInput`); утечки таймеров copy-кнопок (`useCopied`).
- **Волна C** (`fc09316`): money-форматтер ×3→`formatUSDCNumber`; `IS_CHAIN` ×3→1; удалён мёртвый
  `standing-list.tsx` (ProfileAvatar → donor-profile); валидация адреса ×3→`isLikelyBase58Address`.

### Отложенная чистка (НЕ баги — глубокая полировка, делать отдельными шагами)
- [ ] UI-счётчики (`donor-profile`, `me/profile`, `report-dialog`, `EscrowTaskPanel`) хардкодят лимиты
      (40/280) вместо общего `PROFILE_LIMITS` (`mock-provider.ts`) — экспортировать и переиспользовать.
- [ ] Санитайзер суммы расходится: `DonateWidget` (`sanitizeAmount`, 6-знаков) vs `EscrowTaskRail`
      (только `,`→`.`) — свести к одному.
- [ ] Дедуп пагинации: `pager.tsx` есть, но `donation-history.tsx` и `DisputePage.tsx` повторяют логику.
- [ ] Дедуп таблицы спора: `DisputeTally` (EscrowTaskPanel) и `Tally` (DisputePage) почти идентичны.
- [ ] Переименование `LedgerEvent.creator`→`channelId` (одна сущность под двумя именами) — **затрагивает
      колонку БД `creator`**, нужна миграция; оформить отдельным планом, не бить вслепую.
- [ ] Пробел тестов data-слоя/`auth` (см. §6): добавить юнит-тесты (B1-гонка, B4-кап, SIWS-nonce).
