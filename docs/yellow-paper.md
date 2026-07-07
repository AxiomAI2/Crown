# Standing — Yellow Paper: техническая спецификация системы по коду

> **Источник истины — код** (ветка `main`, 2026-07-05, после M2 миграции на канистры, ADR 0021).
> Этот документ построен полным разбором исходников, а НЕ пересказом спек. Устаревшие фазовые
> спеки (core-spec, crypto/spec, backend/spec, frontend/* и спеки игр) **удалены при чистке доков
> 2026-07-05** — их история в git; их расхождения с кодом зафиксированы в §18.5. При изменении
> кода правь соответствующий раздел здесь; при конфликте документов этот — старший после кода.
>
> Каждая фича помечена слоем доверия: **[КОСТЬ]** — трастлесс/ончейн (держится даже при злом
> операторе), **[МЫШЦЫ]** — детерминированные читатели цепи (доверенно, но перевычислимо третьей
> стороной), **[КОЖА]** — централизованный продукт (оператор/стример вправе менять). Философия
> слоёв — `docs/trust-layers.md`; здесь — сами детали.

---

## 0. Как читать документ

- **Слои**: [КОСТЬ] / [МЫШЦЫ] / [КОЖА] после названия фичи. Пограничные помечены двойным тегом.
- **Режимы работы** (`NEXT_PUBLIC_DATA_SOURCE`): `mock` (всё в браузере, без сервера), `api`
  (сервер + in-memory/PGlite-стор, деньги симулируются), `chain` (деньги реальные, devnet;
  основной режим). Отдельно серверный флаг `CHAIN_MODE` (см. §16) включает денежные гейты.
- Деньги везде в **micro-USDC** (`bigint`, 1 USDC = 1 000 000), очки — дробные `number`
  с micro-точностью. Форматирование — только на границе UI.
- Ссылки на находки аудитов (C/H/M/L, A, R, B, ESC, WP, CR, MOD) — это `docs/audit-map.md`.

---

## 1. Система с высоты

**Акторы:**

| Актор | Ключ/гвард | Права (кратко) |
|---|---|---|
| Донор | кошелёк ed25519 | донатит, шлёт задания, отменяет в грейсе, спорит/голосует (не по своим), забирает возвраты |
| Стример (владелец канала) | `requireChannelOwner` | канал, конфиг, аттестация payout, accept/reject/done заданий, показ/скрытие текстов |
| Модератор канала | `ChannelConfig.moderators`, `requireChannelManager` (scope `queue` / `queue_and_block`) | очередь HELD, show/hide, скрыть все сообщения донора; со scope block — канальный блок-лист |
| Оператор платформы | `OPERATOR_ADDRESS`, `requireOperator` | /ops: лестница наказаний, карантин, инциденты, БД-смотрелка. Репутацию и деньги НЕ трогает |
| Резолвер спора (devnet) | `RESOLVER` pubkey, зашит в контракт | только `mark_disputed` / `resolve_dispute(bool)` — выбор стороны, не адресата |
| Якорный ключ | `ANCHOR_SIGNER_KEYPAIR` | публикует memo-дайджесты; платит только свой газ |

**Потоки данных:**

```
кошелёк донора ──tx──► Solana devnet ◄──tx── кошелёк стримера / резолвера / якоря
                          │  (finalized)
                          ▼
        [МЫШЦЫ] ingest / indexer-service / escrow-verify / event-индексер
                          │ детерминированная запись
                          ▼
        журнал ledger_events (append-only) ──► движок reputation.ts ──► цифры
                          │
                          ▼
        [КОЖА] стор (профили/тексты/баны/конфиги) ──RPC──► UI (DataProvider)
```

Команды «вниз» (в цепь) идут ТОЛЬКО транзакциями, подписанными кошельком пользователя.
Сервер сам никогда не подписывает денежные tx (у якоря денег нет).

---

## 2. Идентичность, сессии и роли

### 2.1 Кошелёк как корень [КОСТЬ]

Единственная идентичность — Solana-адрес (ed25519). Профиль опционален (`address_only` по
умолчанию). Все права выводятся из проверенного адреса.

### 2.2 SIWS-аутентификация [МЫШЦЫ] — `src/server/auth.ts`, `src/lib/chain/siws.ts`

Поток: `__authNonce(address)` → сервер выдаёт одноразовый nonce (24 байта hex, TTL **5 мин**) и
каноническое сообщение → кошелёк подписывает (`signMessage`, без газа) → `__authVerify` — сервер
гасит nonce (one-time, в любом исходе), проверяет ed25519 (node:crypto, SPKI-обёртка
`302a300506032b6570032100` + raw pubkey; подпись ровно 64 байта) → session-токен (32 байта hex,
TTL **12 ч**).

Формат сообщения (байт-в-байт, M1 — привязка к домену/времени):

```
<domain> просит вас войти в Standing.

Подписывая это сообщение, вы подтверждаете владение адресом для входа в Standing. Это не транзакция: деньги не двигаются и газ не списывается.

address: <address>
domain: <APP_DOMAIN, дефолт standing.local>
nonce: <hex>
issued-at: <ISO>
expires-at: <ISO>
```

- Сторы nonce/сессий — Map на globalThis, потолки **50 000** каждый; `prune` чистит протухшие,
  затем FIFO. Сессии персистятся в `.data/auth.json` (переживают рестарт); nonce — нет.
- Клиент (chain) хранит токен в `localStorage["standing.siws.v1"]` — **открытая находка L3**
  (XSS → угон сессии; деньги не под угрозой — они требуют подписи кошелька).
- `ensureAuth()` в chain-провайдере: идемпотентен, single-flight; сохранённый токен проверяется
  против сервера; отказ от подписи — штатный (дисконнект без ошибки).

### 2.3 Роли и гварды [КОЖА, механика — МЫШЦЫ] — `mock-provider.ts`

- `session()`: `isCreator` — скан каналов по owner; `isOperator` — адрес равен непустому
  `OPERATOR_ADDRESS` (пустой в проде → оператора нет, fail-closed). Поле `level`/`ProfileLevel`
  удалено как легаси (чистка 2026-07-02).
- `requireSession` → `NO_SESSION`; `requireOperator` → `FORBIDDEN`; `requireChannelOwner`;
  `requireChannelManager(id, needBlock)` — владелец ИЛИ модератор конфига (needBlock требует
  scope `queue_and_block`); `requireNotBanned` → `WALLET_BANNED` (null-личность — no-op, для
  фонового сеттлера).
- Личность на сервере — per-request `AsyncLocalStorage` (H3, ADR 0010), не поле синглтона.
  Dev-вход по голому адресу — только `!IS_PROD && !CHAIN_MODE` (R10).

---

## 3. Деньги [КОСТЬ]

### 3.1 Донат-транзакция — `src/lib/chain/donation-tx.ts`, `memo.ts`

Одна tx, собирает клиент, подписывает донор; оператор денег не касается (§4.1):

1. (опц.) CreateATA стримера — если payout-ATA нет (платит донор, rent ~0.002 SOL);
2. (опц.) CreateATA трежери;
3. `transferChecked` **97%** donorATA → streamerATA;
4. `transferChecked` **3%** donorATA → treasuryATA;
5. Memo: `{"c":"<channelId>","d":"<donationId>","m":"<sha256(text)|null>"}`.

`splitAmount(amount)`: `fee = amount·300/10000` (целочисленно, bigint), `net = amount − fee`.
`FEE_BPS = 300` — единый источник ставки (`lib/chain/addresses.ts`), продублирован в Rust.
Текст в цепь НЕ идёт — только его SHA-256 (коммитмент; §8.1). Самоконтроль комиссии: перевод
без точного сплита/memo индексер не признаёт донатом → обход комиссии = «не донат» (ни
репутации, ни текста).

### 3.2 Активация канала — сбор ~$2

`ACTIVATION_FEE_MICRO = 2_000_000n`. Одна tx: (опц. CreateATA) + `transferChecked` payer →
treasuryATA + memo `{"act":"<channelId>"}`. Сбор, не залог (возврат вернул бы кастодиальный
риск). Сервер проверяет: `payer === ownerAddress` канала, сумма ≥ фиксированной, finalized.

### 3.3 Аттестация payout (H1 закрыт, ADR 0019) — `src/lib/chain/attestation.ts`

Payout-адрес канала валиден только с ed25519-подписью владельца над каноническим сообщением
(текст фиксирован, версия `v: 1`; поля `owner:`/`payout:`). Подписывается кошельком при
создании канала (прозрачно) или кнопкой «Sign payout address» в Personal Space → Customization. Проверяют:
**клиент донора** до сборки донат-tx и эскроу-fund (`assertPayoutAttested` → `PAYOUT_UNATTESTED`),
**сервер на ОБЕИХ денежных ветках** — обычный донат при зачёте (`ingest`, CHAIN_MODE) И
эскроу-задание при `create` (game-bus, гейт на `escrowTaskId`: chain-эскроу к неподтверждённому
payout не привязывается — `PAYOUT_UNATTESTED`; предвычислено провайдером в `channelPayoutAttested`).
Серверная проверка держит, даже если клиентскую обойти руками собранным запросом. Канал без
подписи → донаты приостановлены (честный disabled-state). Остаточное доверие: привязка
handle→owner — платформенная. Модуль изоморфен (bs58 + tweetnacl).

### 3.4 Денежный конфиг и fail-closed — `addresses.ts`, `instrumentation.ts`

- Дефолты devnet (`devnetOnly()`: в проде — пустая строка): трежери `9tSW…trpe` (ключ ПУБЛИЧЕН,
  `.treasury-devnet.json`), USDC-mint Circle `4zMM…ncDU`, программа `GPP2…7GU4`, резолвер
  `6F5Y…B5xR`; оператор вне прода = трежери.
- `assertMoneyConfig()` (зовётся при старте сервера и на денежном пути): в проде БРОСАЕТ, если
  не заданы env трежери/оператора/минта, если трежери = devnet-адрес, или трежери = оператор
  (одноключевой риск). **Не проверяет** `ESCROW_PROGRAM_ID` (§18.2; `ESCROW_RESOLVER` удалён в M2 —
  резолвер зашит в программе = тресхолд-адрес канистры).

---

## 4. Эскроу-программа escrow-task [КОСТЬ] — `anchor/programs/escrow-task/src/lib.rs`

Program ID devnet: `GPP2BCNMp8peLh3uySuEqPb2gWanr4xw5Lf3X7Kx7GU4`; upgrade authority — один
кошелёк `G1vJ…uz14` (осознанно на devnet; гейт mainnet — §18.2). Деньги в PDA; получатели и
сумма зашиты при `fund`; claim-модель (получатель забирает сам); из каждого нетерминального
состояния есть permissionless-выход.

**Редеплой M2 (2026-07-05, upgrade-подпись `3iuD1Rpx…`):** константа `RESOLVER` = тресхолд-адрес
core-канистры ICP `EekhckAL…i1SZ` (прежний операторский — `6F5Y…B5xR`). Резолвер пишется в эскроу
ПРИ `fund` → лётные эскроу доживают со старым резолвером (операторские кнопки для них валидны),
новые рождаются с канистрой: `mark_disputed`/`resolve_dispute` подписывает тресхолд-ключ по
вердикту голосования (arbiter.rs), человека в цепочке решения нет. Живой прогон —
`scripts/dispute-smoke.ts` (§15).

### 4.1 Аккаунт и PDA

`Escrow` (243 байта: 8 дискр. + 235): `task_id[32]` (seed PDA = коммитмент текста, §7.6),
`donor`, `streamer`, `treasury`, `mint`, `resolver` (Pubkey×5), `amount u64`,
`execution_window i64`, `state u8`, `resolution u8`, `accept_deadline i64` (= конец грейса
отмены), `done_deadline i64` (= fund + execution_window), `dispute_deadline i64`, `bump`.
PDA: `["escrow", task_id]`. Vault: ATA(mint, authority=escrow-PDA).
`TaskState`: 0 Pending, 1 Accepted, 2 Done, 3 Resolved, 4 Disputed.
`Resolution`: 0 Unresolved, 1 ToStreamer, 2 ToDonor.

### 4.2 Константы (⚠️ активен ТЕСТ-набор)

| Константа | Сейчас (тест) | Прод (закомментирован) |
|---|---|---|
| `DISPUTE_WINDOW` | **120 с** | 12 ч |
| `VOTING_WINDOW` | **120 с** | 24 ч |
| `CANCEL_GRACE` | **60 с** | ~2 мин |
| `EXEC_WINDOW_MIN` / `MAX` | 60 с / 90 дней | (без прод-варианта — §18.2) |
| `FEE_BPS` / `BPS_DENOM` | 300 / 10 000 | — |
| `RESOLVER` | `Eekh…i1SZ` — **тресхолд-адрес core-канистры** (M2-редеплой 2026-07-05; захардкожен, ESC-1). Пишется в эскроу при `fund` → лётные эскроу доживают со старым операторским `6F5Y…B5xR` | mainnet-редеплой (M5) |
| `TREASURY` | `9tSW…trpe` (захардкожен) | редеплой |

### 4.3 Инструкции и переходы

| Инструкция | Signer | Guard'ы | Переход |
|---|---|---|---|
| `fund(task_id, amount, window)` | донор | amount>0; window ∈ [60с..90д] и > CANCEL_GRACE (ESC-17); init PDA+vault; CPI transfer donor→vault | → Pending |
| `accept` | стример | Pending; now ≤ done_deadline | → Accepted (ESC-19: обязателен до mark_done; сигнал раскрытия текста) |
| `reject` | стример | Pending\|Accepted | → Resolved(ToDonor) |
| `cancel` | донор | Pending\|Accepted; now ≤ accept_deadline (грейс) | → Resolved(ToDonor) |
| `mark_done` | стример | Accepted (ESC-19); now ≤ done_deadline (ESC-2); now > accept_deadline (ESC-13) | → Done; dispute_deadline = now+DISPUTE_WINDOW |
| `mark_disputed` | резолвер (= тресхолд-ключ канистры, M2) | Done; now ≤ dispute_deadline (ESC-11) | → Disputed; deadline = now+VOTING_WINDOW |
| `resolve_dispute(bool)` | резолвер (= тресхолд-ключ канистры, M2) | Disputed (ESC-3); Unresolved | → Resolved(сторона) |
| `resolve_timeout` | **кто угодно** | Pending\|Accepted и просрочен done → ToDonor; Done и просрочен dispute → ToStreamer; Disputed и просрочен → ToStreamer (tiebreaker §11, ESC-4) | → Resolved |
| `claim_streamer` | стример | Resolved+ToStreamer; выплата **от живого баланса vault** (ESC-10): 97% стримеру, 3% трежери; vault и escrow закрываются, рента → донору | закрытие |
| `claim_donor` | донор | Resolved+ToDonor; 100% живого баланса (комиссии нет) | закрытие |

Ошибки: `BadAmount, BadWindow, BadState, Expired, NotDue, AlreadyResolved, WrongOutcome,
Forbidden, GraceActive, BadOwner, BadMint`.

Подтверждено контр-аудитом: получатели читаются только из PDA (даже резолвер не перенаправит
деньги третьему); reinit/double-claim нет; `resolve_timeout` реально permissionless; mint
ончейн НЕ запинен к USDC (ESC-7, смягчено серверной сверкой — вернуть к mainnet).

### 4.4 TS-мост [мост в КОСТЬ] — `src/lib/chain/escrow-tx.ts`

Билдеры инструкций без anchor-IDL: 8-байтовые дискриминаторы `sha256("global:<fn>")[..8]`
захардкожены (таблица `DISC`); Borsh-аргументы вручную; `decodeEscrow` — ручное зеркало
раскладки struct; `decodeEscrowClaims` — M3-декодер claim-инструкций из подписей программы
(данные base58; `claim_streamer`→accounts[2], `claim_donor`→accounts[1]) — истина денег,
переживающая закрытие аккаунта. Любая правка Rust требует синхронной правки TS (§18.4).

---

## 5. Чтение цепи [МЫШЦЫ]

### 5.1 Разбор доната — `src/lib/chain/indexer.ts → extractDonation` (чистая)

Tx признаётся донатом, только если ВСЁ выполнено: tx без ошибки; среди **top-level** parsed-
инструкций — spl-memo (валидный `{c,d,m}`; берётся последний) и **ровно 2** `transferChecked`
нужного mint (R2 — лишние ноги = отказ); одна нога в treasuryATA (fee), вторая — нет (net);
один плательщик обеих ног; `splitAmount(fee+net)` даёт ровно эти fee/net (самоконтроль 3%).
Результат: донор = authority, streamerAta = dest 97%-ноги. CPI-инструкции не видны (§18.3).

### 5.2 Разбор активации — `extractActivation`

Ровно 1 нога нужного mint в treasuryATA + memo `{act}`. Сумму проверяет ingest.

### 5.3 Трастлесс-приём — `src/server/ingest.ts`

`ingestSignature(store, sig, text?)` по порядку: `assertMoneyConfig` → fetch tx с commitment
`finalized` в CHAIN_MODE (M2, анти-реорг; не видна → `{pending:true}`, вызывающий ретраит) →
`extractDonation` → канал из `memo.c` → 97%-нога строго на payout-ATA канала → **аттестация
payout** (CHAIN_MODE, H1) → минимум канала (B7) → трастлесс-привязка текста: принимается
только при `len ≤ messageMaxLen` ∧ `amount ≥ minDonationWithText` ∧ `sha256(text) === memo.m`
(иначе текст молча отбрасывается, деньги/очки не зависят) → `recordDonationFromChain`
(идемпотентно по подписи, сериализовано — B1). `ingestActivation`: аналогично + `payer ===
owner` + сумма ≥ $2 → `activateFromChain` (идемпотентно).

### 5.4 Фоновый индексер — `src/server/indexer-service.ts`

Только chain-режим, стартует из `store.ts`, один цикл на процесс, `POLL_MS = 20 000`.
Порядок тика: (1) новые подписи treasury-ATA (`limit: 50`, курсор meta `indexerCursor`;
`pending` → break, курсор не двигается) → ingest донат/активация; (2) M3 event-индексер
эскроу-программы (курсор `escrowIndexerCursor`; B3: tx не отдалась → break) → исходы claim в
meta `escrowOutcome:<pda>`; (3) сеттлер: `settleDue` по всем каналам (идемпотентно); (4)
пруф-якорь `maybeAnchor`. Все блоки в отдельных try/catch. On-demand `scanEscrowClaimsNow()` —
горячий путь claim (самолечение гонки «claim прошёл, индексер не успел»).

### 5.5 Серверные сверки эскроу — `src/server/escrow-verify.ts`

`verifyEscrowOnChain(id, {donor, amount, streamer})` — fail-closed: donor ∧ amount ∧ mint ∧
streamer=payout канала (ESC-6) ∧ `state === Pending` (свежий, не переиспользован).
`readEscrowOutcome` — живая resolution ИЛИ M3-запись meta (закрытый аккаунт); null = неизвестно
→ банковка откладывается. `readEscrowState` — сырое состояние для ESC-19-раскрытия.

---

## 6. Репутация [МЫШЦЫ]

### 6.1 Журнал — единственный источник истины

`LedgerEvent { id, donor, creator(channelId), type, amount, pointsDelta, configVersion,
txSignature?, ts }`, append-only (`ledger_events`). Типы: `DONATION` (+, единственный рост
ядра), `DISPUTE_WON` (+win, дефолт 10, игра), `DISPUTE_LOST` (−loss, дефолт 50, ЕДИНСТВЕННОЕ протокольное
списание; в icp обе величины — редактируемый параметр канала, §18.5-8c; операторского списания не
существует — CR-1), `GAME`/`REFUND` — зарезервированы, не эмитятся.

### 6.2 Формула — `src/lib/reputation.ts`

- `POINTS_PER_USDC = 1` (фиксирован, ADR 0007; стример курс НЕ настраивает — только пороги).
- `pointsForAmount(micro)` = `micro / 1e6` — точно, БЕЗ округления (A3: нейтрально к дроблению).
- `computePoints(events)` — свёртка в ЦЕЛЫХ micro-очках (`Math.round(delta·1e6)`), деление в
  конце, `Math.max(0, …)` — кламп к нулю (float-дрейф исключён, §4.4).
- `computePointsAsOf(events, asOf)` — та же свёртка по `ts ≤ asOf` (вес голоса на снэпшоте).
- `resolveTier(points, tiers)` — последний достигнутый порог (включительно), progress 0..1.

### 6.3 Банкинг

Очки банкуются в момент доната по текущей формуле и пишутся дельтой в журнал; смена формулы
прошлое не переписывает (историческое: события до фикса A3 несут старые дельты — легально).
⚠️ Заявленное «банкинг по версии конфига» — не работает: версия навсегда 1 (§18.4-1).

### 6.4 Производные

- `standingFor`: свёртка событий донора по каналу + тир по последнему конфигу.
- `computeLeaderboard(period)`: `all_time` / скользящие 30 дней (`month`; период `top_donor_month`
  удалён — оверлея, который его читал, в коде нет); очки ≤ 0 отбрасываются; ники только при `allow_display_names` и
  не-заблокированному донору; **tie-break полный** (детерминизм §4.4): points ↓ →
  totalDonated ↓ → адрес ↑; top-50.
- `getDonorOverview`: агрегат по всем каналам; деньги суммируются, **очки НЕ суммируются**
  (§4.3 — глобального рейтинга нет); topStanding — канал с max локальных очков.
- `homeFeed` (ADR 0018): свои открытые циклы (claimable/grace/dispute_window/voting/awaiting,
  сортировка по срочности) + «живые каналы» (ранг по РАЗНЫМ участникам, анти-whale; не по сумме).

---

## 7. Мини-игры: game-bus и «задание-донат»

### 7.1 Архитектура «игры-как-модули» [КОЖА, шов в МЫШЦЫ] — ADR 0016

- Данные-манифест: `GameModule { id, title, tagline, status: building|available, specDoc }`;
  реестр `GAMES = [escrowTask]`; UI-реестр `GAME_PANELS { Rail, Hub, Rules, Icon }` отдельно.
- Весь трафик — два метода интерфейса: `gameAction(req)` / `gameQuery(req)`,
  `req = { gameId, channelId, op, payload }`. Маршрутизация `dispatchGame` → `GAME_HANDLERS`
  (заполняется в `games/index.ts`, не в bus — нет циклов). Ошибки `GameBusError(code)` →
  `DataError(code)`.
- Слайс состояния — **один на игру для ВСЕХ каналов** (`gameState.get(gameId)`); мутации
  сериализуются глобальной очередью по gameId (ESC-15).
- Выключенная игра (`enabledGames`) блокирует ТОЛЬКО `create` (`GAME_NOT_ENABLED`) — чтения и
  довинчивание живых партий работают всегда (деньги должны дойти).
- `GameContext` (строит `dispatchGameOp` стора): identity, channelOwner/Payout,
  isChannelManager, `minTaskAmountMicro = max(minDonation, minDonationWithText)`,
  minReputationToTask/Dispute, textMaxLen, textShowMode, now/newId, state.get/set,
  `reputationAsOf` (вес = очки на момент), `bankLedger` (пишет LedgerEvent), `moderate` =
  `classifyTaskText`, `verifyTextCommitment` (CR-4, чистая крипта), `isContentBlocked`
  (операторский тейкдаун) + серверные хуки `verifyEscrow` / `escrowOutcome` / `escrowState`
  (инжект из `store.ts`, в браузере отсутствуют).

### 7.2 Оффчейн-машина [МЫШЦЫ, зеркало КОСТИ] — `machine.ts`, чистая, время параметром

Статусы `PENDING → ACCEPTED → DONE → DISPUTED → RESOLVED` + `textState SHOWN|HELD|HIDDEN`,
`hidden` (отклонено стримером), `operatorBlocked` (вычисляется). Окна `WINDOWS`
(⚠️ `FAST_TEST_WINDOWS = true`): grace **1 мин** (прод 2 мин), executionMin **2 мин** (прод
5 мин), executionMax 90 дней, disputeWindow **2 мин** (прод 12 ч), voting **2 мин** (прод 24 ч);
окна `accept` больше нет (рудимент удалён 2026-07-02): отдельного окна принятия не существует —
дедлайны от создания, паритет с контрактом. `DISPUTE_WIN_BONUS = 10`,
`DISPUTE_LOSS_PENALTY = 50` — это ДЕФОЛТЫ: в icp награды спора стали редактируемыми governance-параметрами
канала (`dispute_win_bonus_micro`/`dispute_loss_penalty_micro`, подпись владельца + таймлок, канон `v: 3`,
§18.5-8c); константы остаются фолбэком и путём mock/api/chain.

Ключевые guard'ы (зеркала ончейн): markDone не в грейсе (`GRACE_ACTIVE`) и не после дедлайна
(`EXEC_OVER`); cancel только в грейсе (`GRACE_OVER`); accept до дедлайна и **раскрывает текст**
(SHOWN); спор только в окне; голос один на адрес; авто-скрытие по жалобам (порог 3) — только в
PENDING (после accept текст обязан быть виден, ESC-19). `dueResolution` — исход по времени:
PENDING/ACCEPTED просрочен → to_donor (expired/no_show); DONE просрочен → to_streamer
(completed); DISPUTED просрочен → `tally`.

### 7.3 Спор и голосование [КОСТЬ №2 с M2] — `canister/core/src/{disputes,arbiter}.rs`

С M2 (2026-07-05) спор **chain-задачи** целиком живёт в core-канистре — площадка в исходе не
участвует (трастлесс-контур, живой светофор — `scripts/dispute-smoke.ts`):

- **Открытие** — ed25519-подпись инициатора канон-сообщения (`POST /dispute/open`; канон запинен
  парными тестами TS↔Rust через общую фикстуру `testdata/golden/messages.json`). Эскроу канистра
  читает ИЗ ЦЕПОЧКИ (`getAccountInfo`, проверка владельца-программы; раскладка запинена живой
  devnet-фикстурой). Право спора: любой, кроме сторон; порог `minReputationToDispute` —
  governance-параметр канала (§11.5). Привязка эскроу→канал: `streamer == владелец канала` (v1).
- **Вес голоса** = свёртка журнала канистры на момент открытия (снэпшот; накрутка задним числом
  невозможна). Голос — подпись канон-сообщения с выбором внутри текста (`POST /dispute/vote`),
  стороны не голосуют.
- **Кворум — фикс от стримера**: governance `quorum_micro` (дефолт 1 очко); √-формула убрана
  решением владельца 2026-07-05 (§18.5-8c). `tally`: нет кворума → to_streamer (no_quorum);
  ничья → to_streamer (презумпция стримера); иначе по большинству весов.
- **Табло и голоса открыты живьём** — решение владельца 2026-07-05 (спека прятала до вердикта;
  риск стадности/прицельного подкупа принят; конверты для крупных споров — мейннет-план).
- **Исполнение** — канистра сама шлёт ончейн тресхолд-ключом (сборщик `sol_tx.rs`, эталон
  web3.js): `mark_disputed` при открытии (блокирует `resolve_timeout` на время голосования),
  `resolve_dispute` по вердикту таймера; недоставленное ретраится каждым тиком. **Кламп-защита
  от гонки с `resolve_timeout`**: после финализации `mark_disputed` канистра читает ончейн
  `dispute_deadline` и укорачивает своё окно голосования до `deadline − 40 с`
  (`RESOLVE_SAFETY_MARGIN_MS`) — вердикт гарантированно успевает раньше таймер-презумпции.
- Санкции спора — только репутация (денежных наказаний нет — решение владельца, §18.5-8b):
  инициатор выиграл → `DISPUTE_WON +win` (дефолт 10); проиграл → `DISPUTE_LOST −loss` (дефолт 50; в icp
  обе величины редактируемы владельцем, §18.5-8c(3), и порог открытия спора флорится штрафом §18.5-8c(4) —
  нельзя спорить, не покрыв списание). Свёртки журнала стали знаковыми с клампом на нуле.

Задачи БЕЗ эскроу (mock/api-эпоха) спорятся по-старому оффчейн в сторе (`machine.ts`) — ветка
сохранена; порт Rust↔TS удерживается 21 golden-сценарием (`npm run golden && cargo test`).

### 7.4 Обработчики — `handlers.ts` (все op)

| op | Кто | Главные проверки / эффекты |
|---|---|---|
| `create` | донор | BAD_AMOUNT, NO_TEXT, TOO_LONG, BELOW_MIN, LOW_REP (порог §10), модерация → ILLEGAL_TASK; chain: ESCROW_REUSED (ESC-18), NO_PAYOUT (ESC-6 fail-closed), **PAYOUT_UNATTESTED (H1: payout не подписан владельцем — та же серверная проверка, что у обычного доната; §3.3)**, ESCROW_INVALID (сверка ончейн), ESCROW_TEXT_MISMATCH (CR-4); textState по textShowMode |
| `accept`/`reject`/`markDone` | владелец | `requireOwner` → машина |
| `cancel` | донор | только автор |
| `hide` | владелец | отклонить без газа (PENDING; деньги вернутся таймером) |
| `setTextState` | владелец | «Show» после резолва / «Hide» не в PENDING → TEXT_LOCKED |
| `report` | вошедший | SELF_REPORT, ALREADY_REPORTED; порог 3 → скрытие (только PENDING) |
| `raiseDispute` | вошедший ≠ стример | LOW_REP по `minReputationToDispute` |
| `vote` | вошедший ≠ стороны | BAD_CHOICE; вес по снэпшоту; голос weight 0 допустим |
| `claim` | победитель | сначала settle; ESC-14: резолв коммитится ДО проверки победителя; NOT_WINNER/ALREADY_CLAIMED |
| `settleDue` | **permissionless** (сеттлер) | revealFromChain (ESC-19) + settle всех дозревших |

`settle`: chain-backed задание банкуется **только при известном ончейн-исходе**
(`escrowOutcome`; null → отложить — M3/ESC-12/16); `reconcile` — при расхождении с оффчейн-
ожиданием исход берётся у ДЕНЕГ, reason синтезируется. `repEffects`: to_streamer → донору
`DONATION +points(amount)`; возврат донору очков не даёт.

### 7.5 Тексты заданий [КОЖА + коммитмент в КОСТИ]

Текст — оффчейн (слайс игры, plaintext). Ончейн — коммитмент: `task_id = SHA-256(nonce16 ‖
text)` — сам seed эскроу-PDA (CR-4; подмена/скрытие текста ловится пересчётом). `textNonce`
публичен, хранится на задании. Видимость: `redactTask` (сервер, паритет §4.6) — операторский
тейкдаун прячет ото всех; иначе публичный текст, либо донор+менеджеры. Раскрытие: `accept`
(UI или ончейн через `revealFromChain`) → SHOWN принудительно — «взял деньги ⇒ комьюнити
видит задание до окна спора» (ESC-19).

### 7.6 UI игры [КОЖА]

`GameActionRail` (правый рейл: донат по умолчанию + пикер игр), `EscrowTaskRail` (форма:
пресеты 5/10/25/100, текст ≤ `messageMaxLen` канала, гейт по `minReputationToTask` с подсказкой,
срок с валидацией по WINDOWS, варнинг заморозки
>7 дней — WP-5, подтверждение с FeeSplit), `EscrowTaskHub`/`TaskCard` (живые таймеры;
ролевые кнопки; ручные кнопки резолвера УДАЛЕНЫ в M2 — спор chain-задачи ведёт канистра:
оверлей `CanisterDisputeBlock` (открытое табло/вердикт/подпись резолвера, живой обратный
отсчёт `until`), голоса — те же кнопки `vote`, которые IcpDataProvider уводит в арбитр
подписью кошелька; «Забрать» при канистровом споре гейтится НАСТОЯЩИМ исходом
(`task.resolution`), а не дозреванием по времени — эскроу ончейн в Disputed, программа
отклонила бы claim), `TaskFeedRow` (строка в общей ленте; спор канистры виден и здесь —
слияние §11.5), `DisputeTally`, `DisputePage` (`/c/[handle]/dispute/[taskId]`, пагинация
голосов по 50, фильтры/сортировки/поиск; для канистровых споров кормится тем же слиянием —
ссылка «Участники и голоса» есть у обоих контуров), `EscrowTaskRules` (окна/пороги спора —
ДЕЙСТВУЮЩИЕ параметры канала из канистры, когда доступны; иначе WINDOWS — донор видит
правила ДО открытия спора).

**Полировка UI 2026-07-06 (icp-режим, находки владельца):**
- **`markDone` идемпотентен/само-исцеляющий** (`chain-provider.ts`): первый mark_done мог пройти
  ОНЧЕЙН, а оффчейн-зеркало отстать (сеть упала после отправки tx) → эскроу уже Done, а повтор
  ревертил `0x1772` «недопустимый статус». Теперь перед отправкой читаем ончейн-состояние: если уже
  Done+ (или аккаунт заклеймлен) — tx НЕ шлём, только досинхронизируем оффчейн.
- **`TaskFeedRow` приведён к виду `DonationCard`** (аватар-`Monogram` + компактная мета): тяжёлое
  инлайн-табло голосов убрано из ленты, вместо него ОДНА строка-ссылка «Спор · N голосов →» на
  `DisputePage` (полный расклад — там). Исход спора виден в бейдже статуса.
- **Reign-журнал `ActivityRow`** (`donor-profile.tsx`): у `DISPUTE_WON/LOST` появился ↗ → табло
  спора (пруф: открывший, его ed25519-подпись проверила канистра). Ссылку строит `IcpDataProvider`
  (эскроу-PDA из псевдо-подписи `dispute:<pda>:<kind>` → off-chain `taskId` маппингом по задачам
  канала). Подпись открытия спора — НЕ Solana-tx (ed25519 в канистру), поэтому в explorer её нет —
  табло и есть её проверяемое представление.
- **График «Total crowned»** строится из ДЕНЕЖНЫХ `pointEvents` (`DONATION`+`GAME_DONATION`), а не
  из серверных `overview.donations`: в icp это канон канистры — иначе график не читал канистру, терял
  эскроу-донаты и расходился с числом сверху (тоже канистровым).
- **Dispute governance (Mini-games)**: поля сгруппированы (кто открывает/голосует · тайминги ·
  ставки) + живой «Floor to open a dispute»; изменение штрафа авто-поднимает порог открытия
  (эффективный пол = `max(порог, штраф)`, ADR 0023 — поднявший обязан покрыть проигрыш).

---

## 8. Тексты и модерация [КОЖА]

> Два РАЗНЫХ субъекта: **канальная модерация** (стример + его модераторы, локальная власть,
> `requireChannelManager`) и **операторский T&S** (площадка, `requireOperator`). Общее правило:
> модерация решает судьбу ТЕКСТА, никогда — денег и репутации (§4.7).

### 8.1 Жизненный цикл текста доната

`HELD` (дефолт: видят стример+модераторы; сервер вырезает текст в публичных чтениях —
`redactDonation`) → «Show» → `SHOWN` (лента/…) или «Hide» → `HIDDEN`; `QUARANTINED` —
авто-карантин HARD_BLOCK. `textShowMode: auto_if_clean` — авто-SHOWN при вердикте CLEAR
(hard-block не авто-показывается никогда). Деньги и очки от судьбы текста не зависят.

### 8.2 Авто-конвейер [инфраструктура оператора] — `moderation.ts`

- Политика: мат/оскорбления НЕ цензурятся (вкус стримера); авто-слой ловит только запрещёнку.
- Локальный слой (без ключа): словарь `DEFAULT_HARD_LIST` + regex `CSAM_EXPLICIT` (ru/en) —
  только CSAM-класс; остальное CLEAR.
- OpenAI (`OPENAI_API_KEY`, только сервер): **сообщения** — `omni-moderation-latest`;
  `sexual/minors` — блок всегда; CSAM-комбо-бэкстоп (sexual ≥ 0.3 + маркер несовершеннолетия);
  пороги severity: violence 0.8, violence/graphic 0.6, harassment/threatening 0.5,
  hate/threatening 0.5; сбой API → **FLAG** (в HELD, fail-safe). **Задания**
  (`classifyTaskText`) — строже: блок ПО ФЛАГУ категорий (illicit, violence, self-harm/
  instructions и др.) + LLM-судья легальности `gpt-4o-mini` (temp 0, ответ ILLEGAL/OK);
  без ключа → CLEAR кроме CSAM (**fail-open, MOD-2 — осознанный размен**, флаг к mainnet);
  401/403 → кулдаун 10 мин (B6). Вердикт-кэш заданий по хэшу, TTL 10 мин (один ответ для
  префлайта и create — эскроу необратим).
- Дедуп: `runPipeline` кэширует вердикт по `channelId:sha256(норм. текста)` — флуд повтором
  схлопывается, `MOD_CACHE_CAP = 5000`.
- `hashContent` = SHA-256 нормализованного текста (A1: полный, криптостойкий — это и
  коммитмент memo.m, и ключ кэша).

### 8.3 Канальная модерация (стример + модераторы)

Очередь HELD (FLAG первыми), `setMessageState` (показ при операторском тейкдауне →
`BLOCKED_BY_OPERATOR`), `hideDonorMessages` (все сообщения донора → HIDDEN), блок-лист
(`addChannelBlock`/`remove`, scope `queue_and_block`; блокированный может донатить БЕЗ текста —
в chain деньги принимаются, текст режется). Жалобы зрителей: `reportMessage` — по одной на
пару (сообщение, репортер), причина ≤500; первая жалоба → инцидент; **≥3 жалоб → авто-HIDDEN**
+ инцидент.

**Спам-фильтр realm** (владелец, панель Moderation settings прямо в очереди): (1) `blockedWords` —
регистронезависимый substring-хит в тексте крона → `autoVerdict=FLAG`, текст всегда HELD (никогда
не авто-публикуется даже при `auto_if_clean`); (2) `removeLinks` — best-effort вырезание ссылок
(`stripLinks`, moderation.ts: URL со схемой/`www.` + голые домены с латинским TLD 2–24 или «рф»;
проза с точками «т.е.»/«ул.Ленина» не задевается) из текста НА ВХОДЕ (`record`) — очередь, лента и
виджеты видят уже чищеный текст; текст-только-ссылка → крон без текста. На chain-пути срез идёт
ПОСЛЕ сверки `memo.m` (донор подписал оригинал; что ПУБЛИКОВАТЬ — решение realm). Обе опции не
трогают деньги/Reign (§4.7).

### 8.4 Операторский T&S — `applyOperatorAction`, консоль `/ops`

Лестница (`PenaltyAction`): `HIDE_MESSAGE` (тейкдаун по targetContentId — донат-сообщение или
задание; перебивает стримера и авто-раскрытие), `CHANNEL_BLOCK`, `SUSPEND_CHANNEL` (обратимо),
`BAN_CREATOR_ROLE` (канал BANNED; кошелёк может завести новый), `BAN_WALLET_FULL` (оффчейн-бан:
не голосует/не спорит/не донатит/не создаёт; число репутации остаётся честным),
`REINSTATE_CHANNEL` (восстановление; BASIC не трогается — иначе обход платной активации).
Цели валидируются (`BAD_TARGET`); действия пишутся в журнал `operatorActions` — источник
истины; наборы `operatorBlockedContent`/`bannedWallets` ПЕРЕВЫЧИСЛЯЮТСЯ из журнала
(`rebuildOperatorOverrides`, последнее действие по цели побеждает). Инциденты (`IncidentLog`:
report/hard_block/sanction_hit/flood; приватный текст виден только оператору) + preservation/
reported (NCMEC). Репутацию оператор не редактирует (CR-1), деньги не трогает (§4.1).

---

## 9. Конфиг канала [КОЖА → потребляется МЫШЦАМИ]

### 9.1 Поля и дефолты (`defaultChannelConfig`, fixtures.ts)

| Поле | Дефолт | Лимит/валидация |
|---|---|---|
| `description` | — | ≤ 280 (`CHANNEL_DESC_MAX`) + модерация HARD_BLOCK |
| `tiers` | 5 тиров: Новичок 0 / Свой 5 / Постоянный 50 / VIP 500 / Легенда 2 000 очков (= $5/$50/$500/$2000) | ≤ 20 (`MAX_TIERS`); описание тира ≤ 140 + модерация; пересчитаны под курс 1:1 (чистка 2026-07-02) |
| `minDonation` | 0.1 USDC | — |
| `minDonationWithText` | 0.5 USDC | — |
| `minReputationToTask` | 0 | 0..1e9, конечное (§10 — право прислать задание) |
| `minReputationToDispute` | 1 | 0..1e9 (§10 — право поднять спор; НЕ вес и не исход) |
| `messageMaxLen` | 200 | — |
| `nameMode` | `addresses_only` | ники в лентах/лидербордах только при `allow_display_names` |
| `textShowMode` | `manual` | `auto_if_clean` — авто-показ CLEAR |
| `moderators` | [] | scope `queue` / `queue_and_block` |
| `blockedWords` | [] | ≤200 слов по ≤40 симв. (`MAX_BLOCKED_WORDS`/`BLOCKED_WORD_MAX_LEN`), trim+дедуп без регистра; хит → текст HELD (§8.3) |
| `removeLinks` | false | вырезать ссылки из текста крона на входе (`stripLinks`, §8.3) |
| `enabledGames` | [] | id из реестра игр |
| `version` / `hash` | 1 / `cfg-<id>-v1` | ⚠️ НЕ растут — версионирование не реализовано (§18.4-1) |

`getChannelConfig` публичен без гварда — конфиг (включая адреса модераторов) виден любому
(осознанно: конфиг = публичная формула §4.4).

### 9.2 Смежное: профиль и ссылки

`LightProfile`: имя ≤40, bio ≤280 (+модерация), `avatarUrl` ВСЕГДА отбрасывается (аватар-URL
отключены). Ссылки — allowlist 8 платформ (`channel-links.ts`): строгие regex «только страница
профиля», канонизация в https, query/hash срезаются, ≤10, дубли отбрасываются. Имя и ссылки
КАНАЛА берутся из профиля владельца (один ник на человека).

---

## 10. Прозрачность [МЫШЦЫ] — ADR 0019

- **`GET /api/v1/export/channel/[handle]`** — канал (с аттестацией) + все версии конфига +
  журнал канала + лидерборд (сверяемая цифра). Ссылка «Скачать журнал и пересчитать» — на
  странице канала.
- **`GET /api/v1/export/anchor`** — полный журнал + конфиги + пер-записные хэши операторского
  лога (инциденты/действия; контент приватен) + текущие дайджесты + последний якорь.
- **Пруф-якорь** (`server/anchor.ts` + тик индексера): при изменении состояния, не чаще
  `ANCHOR_INTERVAL_MS` (деф. 1 ч), memo-tx `{std:"standing-anchor/1", t, n, j: sha256(журнал),
  c: sha256(конфиги), o: sha256(операторский лог)}`; каноникализация — `stableStringify`
  (сортировка ключей, bigint-тег) + `sha256Hex` БЕЗ нормализации. Ключ `ANCHOR_SIGNER_KEYPAIR`
  (путь или inline-массив); без ключа выключен. Meta: `anchorLast`.
- **`scripts/verify-export.ts`** — независимый пересчёт: подпись payout (H1), репутация =
  свёртка журнала, дайджесты; `--chain` — memo якоря из цепи + `--deep N` сверка донатов по tx.

---

## 11. Слой данных: DataProvider и четыре реализации

### 11.1 Контракт (`provider.ts`) — 33 метода (+3 опциональных)

Сессия: `getSession, connect, disconnect, getProfile, updateProfile`. Каналы: `listChannels
(ACTIVE+BASIC; SUSPENDED/BANNED скрыты), getChannel, getMyChannel, getManagedChannels,
getOperatorChannels, getChannelConfig, createChannel, activateChannel, attestPayout,
updateChannelConfig`. Репутация: `getStanding, getLeaderboard, getDonorOverview, homeFeed`
(личность из сессии — приватные циклы). Донаты: `createDonation, listDonations`. Модерация:
`getModerationQueue, setMessageState, hideDonorMessages, reportMessage`. Блок-лист:
`getChannelBlocklist, addChannelBlock, removeChannelBlock, getMyChannelBlock`. Оператор:
`getOperatorQueue, applyOperatorAction` (`getIncidentLog` удалён как мёртвый, 2026-07-02). Игры: `gameAction, gameQuery`.
Опциональные (только IcpDataProvider, M1/M2 ADR 0021): `getDisputeParams?, setDisputeParams?` —
governance-параметры споров из канистры (запись = подпись кошельком владельца, §11.5);
`getCanisterDispute?` — состояние спора из арбитра канистры (кормит оверлей `CanisterDisputeBlock`, §7.6).

### 11.2 MockDataProvider [КОЖА+МЫШЦЫ в одном файле] — серверный стор

In-memory состояние (§13), персистится снапшотом. Смешение слоёв (см. Приложение B): МЫШЦЫ —
`record` (банк очков: `pointsForAmount` → Donation + LedgerEvent, независимо от текста §4.7),
`recordDonationFromChain` (B1-сериализация по подписи; поздняя привязка текста R7),
`computeLeaderboard`, `dispatchGameOp`; КОЖА — профили, модерация, баны, операторские действия.
Dev-механика: `gate()` — псевдослучайная задержка 120–500 мс × latencyScale (на сервере 0);
`failMode` бросает `MOCK_FAIL` на 10 читающих методах (`FAILABLE`).

### 11.3 ApiDataProvider [транспорт]

Каждый метод → POST `/api/v1/rpc` `{method, args, token, address, failMode}` через кодек
(bigint как `{__bigint:"дец"}`, кап 40 цифр — L2 анти-DoS). Вне интерфейса: `ingestSignature`,
`ingestActivation`, `precheckText`, `authNonce`, `authVerify`.

### 11.4 ChainDataProvider [мост в КОСТЬ]

Композиция над Api: все чтения и оффчейн-мутации — делегат; сам делает деньги и подписи:
`createDonation` (префлайт текста → аттестация → сборка 97/3+memo → подпись → confirmed →
`ingestWithRetry` 24×3с до finalized — иначе «деньги ушли, зачёта нет»), `activateChannel`,
`createChannel` (+подпись аттестации), `attestPayout`, `gameAction` create/accept/reject/
markDone/cancel/claim (+ авто-`resolve_timeout` одной tx). Ончейн-действий резолвера здесь НЕТ
с M2 (`markDisputed`/`resolveDispute` удалены — их шлёт арбитр канистры; билдер `mark_disputed`
в `escrow-tx.ts` живёт только для негативного смоука аудита #1). SIWS — §2.2. Кошелёк
инжектится React-мостом (`ChainWalletBridge`).

### 11.5 IcpDataProvider [мост в КОСТЬ №2] — режим `icp` (M1+M2, ADR 0021)

`extends ChainDataProvider`. **Чтение репутации (M1):** `getStanding`/`getLeaderboard`/
`getDonorOverview` — браузер читает канон напрямую из HTTP-экспорта core-канистры
(`/standing`, `/leaderboard`, `/donor`; CORS открыт на чтение) МИМО нашего сервера. Профиль
донора (/me, /u) — слияние: цифры по каналам из канистры, кожа (имена/handle/активность) с
сервера; каналы без ончейн-активации (mock-эпоха) остаются с серверными цифрами; «Журнал
репутации» для канистровых каналов — детализация из `events` канистры (`DONATION`/
`GAME_DONATION`/`DISPUTE_*` — перечень сходится с числом сверху), текст доната к событию
подтягивается с сервера по tx-подписи. Тиры — `resolveTier` по конфигу канала (кожа); имена
доноров на лидерборде — join с серверным лидербордом (косметика; сервер упал → цифры без имён).
**Споры chain-задач (M2):** `gameAction` уводит `raiseDispute`/`vote` в арбитр (подпись
канонического сообщения кошельком → POST `/dispute/open`|`/dispute/vote`), а чтения
СЛИВАЮТ спор канистры в задачи: `gameQuery` list/get подмешивает статус/голоса из
`/disputes?channel=` (кэш 10с; ключ — `escrowTaskId`; RESOLVED сервера не понижается),
`disputeVotes` для канистрового спора собирается той же чистой `machine.disputeVotesView`,
`homeFeed` дозревает цикл «окно оспаривания» → «идёт голосование». Без слияния серверное
зеркало (которое спор не видит) показывало бы DONE и предлагало «Забрать» во время
голосования. Канистра недоступна → слияние деградирует до серверного зеркала (пустая карта,
тоже кэш 10с); точечный `getCanisterDispute` ошибку не прячет. Внутренние вызовы записи
(`createDonation`→standing) остаются на api-пути. Дельта канона на переходе — §18.5-8a.
Включение: `NEXT_PUBLIC_DATA_SOURCE=icp` + `NEXT_PUBLIC_ICP_CANISTER_URL`; откат — `=chain`
(миграция M1, `docs/migration-plan.md` §3; ОТКАТ НЕ ВОЗВРАЩАЕТ ручной резолвер — в chain-режиме
спор chain-задачи исхода на цепь не доводит). Серверный индексер в icp-режиме работает
(двойная бухгалтерия: сервер — дублёр).

---

## 12. HTTP-поверхность

### 12.1 `/api/v1/rpc` [МЫШЦЫ-граница]

Вайтлист `ALLOWED` (ровно методы DataProvider + `precheckText`); не в списке → `BAD_METHOD`.
`CHAIN_FORBIDDEN = {createDonation, activateChannel}` в CHAIN_MODE → 403 (C1: репутация только
через ingest). `MUTATING` → `persistStore()` после успеха. Спец-ветки: `__authNonce`,
`__authVerify`, `__reset` (только dev), `ingestSignature`, `ingestActivation`. Личность:
`resolveToken(token)`, dev-адрес — только `!IS_PROD && !CHAIN_MODE`; диспатч в
`runWithIdentity` (AsyncLocalStorage, H3). Ошибки: DataError — как есть; прочее — общий текст,
детали в лог (R4). `failMode` принимается только вне прода.

### 12.2 Прочее

`GET /api/v1/export/*` (§10, публичные). `/api/dev/db` → 307 на страницу; `POST
/api/dev/db/data` — данные 11 таблиц (лимит 500 строк), гейт: в проде 404 (паритет с /dev/*) +
SIWS-токен === оператор (fail-closed при пустом OPERATOR_ADDRESS). Оверлея/SSE — НЕТ
(§18.5-1).

---

## 13. Персистентность [МЫШЦЫ-хранилище]

- **PGlite** (Postgres в WASM, `.data/pg/`, ADR 0014), singleton, схема идемпотентна.
  Таблицы: `light_profiles`, `channels` (+`payout_attestation`;
  частичный уникальный индекс owner WHERE status≠BANNED — один канал на кошелёк),
  `channel_configs` (PK channel+version; +`goal_target`/`goal_label` для goal-оверлея, +`page_theme` jsonb —
  тема публичной страницы, +`blocked_words` jsonb/`remove_links` boolean — спам-фильтр §8.3,
  всё через `ADD COLUMN IF NOT EXISTS`), `ledger_events` (append-only; индексы
  creator+donor / creator+ts; points_delta numeric — миграция с bigint), `donations`,
  `messages` (+content_hash индекс), `channel_blocks`,
  `operator_actions`, `incident_logs`, `reports` (PK message+reporter), `meta` (KV),
  `game_state` (jsonb на игру).
- **`saveStore`** — весь снимок ОДНОЙ транзакцией (B2; включая `DELETE channel_blocks` +
  вставка); писатель один (коалесценция `makeSaver`). Не инкрементально (остаток Фазы 4).
- `.data/store.json` — легаси-снимок (только одноразовая миграция в PG); `.data/auth.json` —
  SIWS-сессии (живой; токены в открытом виде — dev-допущение). Запись атомарна
  (tmp+rename), троттл 250 мс.
- Meta-ключи: `seq`, `initialized`, `indexerCursor`, `escrowIndexerCursor`,
  `escrowOutcome:<pda>`, `anchorLast`.

---

## 14. UI: карта экранов [КОЖА]

| Маршрут | Содержимое, гейты |
|---|---|
| `/` | залогинен → `DonorProfile editable` (личная база ADR 0018: OpenCycles «Требует тебя» + донаты + журнал очков); гость → LiveNow (живые каналы по участникам) |
| `/discovery` | каталог каналов (`ChannelBrowser`: поиск, пагинация 6/12/24/48), параметр `?q` |
| `/overlay/[handle]/[widget]` | публичные OBS-оверлеи (browser source), только чтение по handle, без сессии, прозрачный фон: `alerts` (анимированный алерт на каждый новый Crown, текст — только при SHOWN §4.6; опц. TTS по `?tts=1`), `goal` (полоса цели по `ChannelConfig.goalTarget`), `top` (топ-5 саппортеров), `total` (счётчик Crowned), `list` (конфигурируемый список: тип last/top, период all/month, count, шаблон строки `{username}/{amount}/{message}` — всё в query URL, без бэкенда; {message} только при SHOWN §4.6). Живость — polling (§18.1) |
| `/c/[handle]` | канал: сворачивающаяся шапка (имя/ссылки из профиля владельца), правый рейл `GameActionRail` (донат + пикер игр), табы «Активные» (игры) / «Донаты» (единая лента донатов+заданий, поиск) / «Тиры»; SUSPENDED/BANNED → «Канал недоступен»; внизу — ссылка §4.4 на экспорт |
| `/c/[handle]/donors` | лидерборд (периоды all_time/month, фильтр по тиру, подсветка себя) |
| `/c/[handle]/dispute/[taskId]` | страница спора (пагинация голосов по 50) |
| `/me`, `/u/[address]` | свой (editable) / публичный профиль донора |
| `/me/profile` | редактор профиля (гидрация один раз на адрес) |
| `/space` | **Personal Space** (владелец + патрон, бренд Crown, ADR 0022). **My Holdings** — Dashboard донора (`PersonalDashboard`). **My Realm** — нет канала → `CreateChannelForm`; есть → Dashboard (`RealmDashboard`: кумулятивные графики Crowned/Patrons, диапазоны 1Д..Всё, история; + карточка «Fundraising goal» — кольцо прогресса, Collected/Remaining, те же цифры, что goal-оверлей: оборот all-time / `goalTarget`; без цели — ссылка в Widgets), **Customization** (`CustomizationTab` — контейнер под-вкладок: **Page** = `RealmPageBuilder` [конструктор публичной страницы: ссылка+Copy, тема фона color/gradient/image + accent-цвет, живое телефон-превью; полная свобода цветов по решению владельца; сохраняется в `ChannelConfig.pageTheme`, применяется к КАРТЕ `/c/[handle]` и Crown-CTA, НЕ к чрому приложения] + **Settings** = `ChannelSettingsEditor`: Payout address [аттестация H1, только chain] / Description / Tiers / Crowns [минимумы, лимит текста] / Names & display / Moderators; draft-модель с плавающим «Save»), **Mini-games** (`RealmGamesSettings` — единый дом настроек игр: тумблеры игр + пороги §10 [задание/спор] + исход спора по Reign [+win/−loss: read-only вне icp, редактируемо в icp] + **Dispute params** [icp: кворум/окна/вес/мин.реп/награды — подпись владельца → канистра, таймлок §8.9, канон `v: 3`, §18.5-8c]), **Widgets** (`RealmWidgets` — OBS browser-source оверлеи `alerts`/`top`/`total`: копируемые публичные URL + превью, §18.1), **Moderation queue** (HELD, FLAG первыми; HARD_BLOCK — карантин; + задания). Отдельной вкладки Blocklist нет — блок/разблок кошелька в меню «…» на донате (`ModerationMenu`). **Settings** — Profile |
| `/admin`, `/admin/{realms,users,games,moderation,tests,settings}` | платформенная консоль оператора (read-only аналитика + dev-инструменты): Dashboard (KPI по всем realms), Realms (таблица), Users, Mini-games (статистика escrow-task), Moderation (песочница → `/api/dev/moderation`, тот же конвейер), Tests (dev-логин за адрес, только mock), Settings |
| `/ops` | консоль T&S enforcement (гейт isOperator): лестница наказаний, форма действия с подтверждением, инцидент-лог с «Разобрать →» |
| `/dev/db`, `/dev/kitchen-sink` | смотрелка БД (оператор), витрина компонентов; серверный гейт `IS_PROD → 404` |

Ключевые встроенные правила UI: DonateWidget — пресеты 5/10/25/100, потолок 1 000 000 USDC,
санитайзер суммы (6 знаков дроби), `canDonate` (сессия ∧ сумма ∧ минимум ∧ текст ∧ не-BASIC-c-
текстом ∧ баланс), SOFT_WORDS-предупреждение, honest-disabled при неаттестованном payout;
подтверждение «Донат необратим»; FinalityMoment после finalized. Баланс USDC — чип в шапке
(refetch 30 с), DonateWidget подписан на тот же кэш-ключ. Chain-подключение: адаптеры Phantom/
Solflare/Coinbase/Trust/Ledger/WalletConnect + Wallet Standard; autoConnect только к
установленным; свой WalletPicker; `ChainWalletBridge` инжектит кошелёк в провайдер и гоняет
SIWS. Дизайн-токены: тёмная тема, CSS-переменные (`--money #3dd6a0`, `--danger`, `--info`,
`--status`), шрифты Manrope/Inter/JetBrains Mono, money-вариант кнопки только для денежных
действий.

---

## 15. Скрипты (`npx tsx scripts/<имя>.ts`)

| Скрипт | Назначение |
|---|---|
| `indexer.ts` | внешний поллер донатов (8 с) → POST ingest; legacy-дубль встроенного индексера |
| `escrow-indexer.ts` | read-only обзор всех эскроу программы (getProgramAccounts, dataSize 243) |
| `escrow-smoke.ts` | E2E живой программы: happy/refund/DUST(ESC-10)/грейс(ESC-13)/ESC-17/ESC-19 |
| `devnet-smoke.ts` | E2E донат-механики без браузера (⚠️ устаревшая проверка очков, §18.4-3) |
| `chain-verify.ts` | верификация билдеров/индексера без airdrop (⚠️ секция очков устарела, §18.4-3) |
| `recover-activation.ts` | починка активации после гонки confirmed↔finalized (`--ingest`) |
| `scan-treasury.ts` | классификация tx трежери + доначисление (`--ingest`) |
| `prune-moneyless-tasks.ts` | разовая чистка заданий без эскроу (при остановленном сервере) |
| `snapshot-running.ts` | разовый мост: каналы из работающего сервера → store.json |
| `verify-export.ts` | независимый пересчёт (§10); `--canister <url>` — сверка ТРЁХ источников (Solana ↔ core-канистра ↔ сервер, M0 ADR 0021) донат-в-донат |
| `dispute-smoke.ts` | M2-светофор: живой спор через канистру на devnet-эскроу целиком (открытие/голос подписями → mark_disputed/resolve_dispute тресхолдом → claim). Нужен стенд канистры |
| `export-golden.ts` (`npm run golden`) | эталон паритета TS↔Rust для миграции на канистры (M-1): вызывает живые `extractDonation`/`computePoints*`/машину споров → `testdata/golden/*.json`; их же читает `cargo test` в `canister/` |

---

## 16. Конфигурация (все ENV)

| Переменная | Назначение |
|---|---|
| `NEXT_PUBLIC_DATA_SOURCE` | mock \| api \| chain \| icp (выбор провайдера; icp = chain + канон чтения из канистры, §11.5) |
| `NEXT_PUBLIC_ICP_CANISTER_URL` | база HTTP-экспорта core-канистры (raw-домен; только режим icp) |
| `CHAIN_MODE` (сервер) | ≠"off" в проде / ="on" в dev → денежные гейты C1/M2 + требование аттестации |
| `NEXT_PUBLIC_DEVNET_RPC` | RPC (деф. публичный devnet); из него же кластер эксплорера |
| `NEXT_PUBLIC_DEVNET_USDC_MINT` / `NEXT_PUBLIC_TREASURY_OWNER` / `NEXT_PUBLIC_OPERATOR_ADDRESS` | денежный конфиг; в проде обязательны (fail-closed C2) |
| `NEXT_PUBLIC_ESCROW_PROGRAM_ID` | эскроу-программа (`NEXT_PUBLIC_ESCROW_RESOLVER` удалён в M2: резолвер = тресхолд-адрес канистры, зашит в контракте) |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | опц., включает WalletConnect |
| `APP_DOMAIN` | домен SIWS-сообщения (деф. standing.local) |
| `OPENAI_API_KEY` | авто-модерация (нет → словарь/CLEAR-кроме-CSAM) |
| `ANCHOR_SIGNER_KEYPAIR` / `ANCHOR_INTERVAL_MS` | пруф-якорь (нет ключа → выключен) / период (1 ч) |
| `NEXT_PUBLIC_MOCK_FAIL` | инъекция ошибок в mock |
| `STANDING_API` (скрипты) | URL RPC (деф. localhost:3000) |

---

## 17. Сводка инвариантов и кто их держит

| Инвариант | Держит | Слой |
|---|---|---|
| §4.1 Некастодиальность | сборка tx без аккаунта оператора; PDA-эскроу; ingest сверяет payout; аттестация H1 | КОСТЬ+МЫШЦЫ |
| §4.2 Деньги финальны | нет путей возврата в коде; эскроу — по правилам контракта | КОСТЬ |
| §4.3 Репутация непередаваема | нет transfer/sell; очки по каналам не суммируются; лидерборд live-каналов — по участникам | МЫШЦЫ+КОЖА |
| §4.4 Детерминизм/перевычислимость | чистый движок, целые micro-очки, tie-break, экспорт+verify-скрипт, якорь | МЫШЦЫ (⚠️ дыра: версии конфига, §18.4-1) |
| §4.5 Только рост; оператор не редактирует | `Math.max(0)`; единственный минус — DISPUTE_LOST; ADMIN_VOID удалён | МЫШЦЫ |
| §4.6 Текст приватен до показа | `redactDonation`/`redactTask` на сервере; HELD-дефолт | КОЖА (серверная) |
| §4.7 Деньги ≠ показ | `record` банкует до/независимо от модерации; ingest принимает без текста | МЫШЦЫ |
| Эскроу: из любого состояния есть выход | `resolve_timeout` permissionless | КОСТЬ |
| Текст неподделываем | sha256 в memo.m; task_id-коммитмент (CR-4) | КОСТЬ |
| Прошлое не переписываемо незаметно | пруф-якорь + экспорт | МЫШЦЫ→КОСТЬ |

---

## 18. ПРОБЛЕМЫ И КОНФЛИКТЫ (по состоянию кода на 2026-07-05, после M2)

### 18.1 Конфликты КОСТЬ ↔ КОЖА (структурные, признанные)

| # | Конфликт | Статус/замок |
|---|---|---|
| 1 | ✅ **ЗАКРЫТ M2 (2026-07-05)**: спор chain-задачи целиком в канистре (§7.3) — голоса подписями, вердикт и ончейн-резолв тресхолд-ключом канистры; ручной резолвер-оператор и `ESCROW_RESOLVER` удалены. Точка доверия сместилась с оператора на подсеть ICP (canister-architecture §1). Остаток: споры mock/api-задач — по-старому оффчейн | закрыто для chain-задач; страховка `resolve_timeout` жива |
| 2 | **Бан кошелька глушит raiseDispute/vote** — подавление явки жюри → no_quorum → to_streamer | принято (CR-3); ответ — G3b |
| 3 | **Тейкдаун текста ослепляет жюри** (redactTask перебивает ESC-19) | принято, won't-fix на денежном слое (CR-2): защита — модерация ДО фандинга; авто-возврата нет намеренно (детеррент) |
| 4 | **Модерационный гейт до fund** — централизованный недетерминированный вердикт (OpenAI за ключом) решает, кто вообще войдёт в игру | принято (CR-5); митигация в плане: мультиподпись/таймлок |
| 5 | **Ban-evasion ончейн (MOD-1)**: полный бан кошелька — оффчейн; забаненный может слать сырые переводы/двигать свои эскроу напрямую | по построению (бан = отказ в сервисе, не в деньгах); фрикшен — активация $2 |
| 6 | **Кворум/ничья → стримеру** (no_quorum, tie) + подавление явки из #2/#3 — структурный перекос спора в сторону стримера | презумпция §11, задокументировано; калибровка кворума впереди |

### 18.2 Кость условная (гейты mainnet)

1. **Upgrade authority программы — один кошелёк** `G1vJ…uz14`: может заменить код → все
   ончейн-гарантии условны. Devnet-удобство (решение владельца 2026-07-02); до mainnet —
   мультисиг + таймлок (окно выхода через `resolve_timeout`/`claim`), в идеале сжечь после G3b.
2. **Тестовые окна активны в ОБОИХ местах**: Rust (`DISPUTE_WINDOW/VOTING_WINDOW` 120 с,
   `CANCEL_GRACE` 60 с) и TS (`FAST_TEST_WINDOWS = true`). Возврат в прод = правка обеих +
   редеплой; значения обязаны совпадать.
3. **`EXEC_WINDOW_MIN = 60 с` в Rust без прод-варианта** — при прод-грейсе 2 мин минимум
   станет меньше грейса (комментарий в lib.rs сам предупреждает).
4. **Mint не запинен ончейн** (ESC-7) — fund принимает любой mint; держится серверной сверкой.
5. **RESOLVER/TREASURY захардкожены в программе** — devnet-адреса; ключ devnet-трежери публичен
   в `.treasury-devnet.json`; `assertMoneyConfig` НЕ проверяет `ESCROW_PROGRAM_ID`.
6. **`emit!`-событий нет** (хвост ESC-9) — индексер декодирует инструкции (работает, но хрупче).

### 18.3 Мышцы: точки доверия и хрупкость

1. **Один RPC** (`NEXT_PUBLIC_DEVNET_RPC`) — ingest/индексеры/якорь верят одному эндпоинту;
   ложь RPC = ложный зачёт/отказ. Имя `DEVNET_RPC` вводит в заблуждение (это общий RPC).
2. **`getSignaturesForAddress limit: 50` без пагинации** — >50 tx между опросами → потеря
   старших подписей.
3. **Залипание курсора (обратная сторона B3)** — перманентно недоставаемая tx навсегда
   останавливает курсор (treasury и escrow).
4. **Индексер смотрит только top-level инструкции** — донат через CPI (мультисиг-кошелёк)
   не распознаётся.
5. ✅ **LOW_REP-разрыв закрыт (2026-07-02)**: порог `minReputationToTask` проверяется в
   chain-префлайте ДО `fund` (и форма задания гейтится заранее с подсказкой) — заморозка денег
   об известный отказ исключена.
6. **handle → owner — платформенная привязка** (остаточное доверие H1, задокументировано).
7. **L3 открыт**: SIWS-токен в localStorage (XSS); `.data/auth.json` — токены в открытую.
8. **Один Node-процесс** — стор in-memory + встроенный индексер; horizontal scale требует
   выноса (заявлено в коде); `saveStore` переписывает снимок целиком.
9. **`failMode` — глобальный флаг синглтона** (личность в ALS, а failMode нет) — dev-гонка.
10. **Рейт-лимитов нет вообще** (MOD-3/B5) — заявлено «на краю» (Cloudflare/nginx), в коде
    отсутствуют; FIFO-вытеснение 50k сессий/nonce — теоретический DoS.
11. ✅ Сеттлер логирует ошибки (кроме штатного GAME_NOT_ENABLED) — «репутация не начислилась»
    больше не маскируется под «нечего начислять» (2026-07-02).
12. ✅ `taskVerdictCache` получил кап 5000 с FIFO-вытеснением (2026-07-02).

### 18.4 Битое/устаревшее в коде

> **Чистка 2026-07-02**: пункты с ✅ исправлены/удалены тем же днём (коммит «chore(cleanup)»).

1. **Версионирование конфига НЕ реализовано** (остаётся — дизайн-решение, не мусор):
   `updateChannelConfig` мутирует последнюю версию на месте; `version` навсегда 1,
   `LedgerEvent.configVersion` всегда 1. Пока курс фиксирован (ADR 0007) — безвредно; решить
   отдельно: реализовать версии или честно убрать поля.
2. ✅ Дефолтные пороги тиров пересчитаны под курс 1:1: 5 / 50 / 500 / 2 000 очков
   ($5/$50/$500/$2000); комментарий «1$=100» в fixtures убран.
3. ✅ `chain-verify.ts` и `devnet-smoke.ts` переведены на текущую формулу (1:1, дробные,
   проверка нейтральности дробления) — больше не падают.
4. ✅ `WINDOWS.accept` удалён (рудимент); комментарий у `FAST_TEST_WINDOWS` называет реальные
   ончейн-зеркала (DISPUTE/VOTING/CANCEL_GRACE) и фиксирует «окна принятия нет».
5. ✅ `EscrowTaskRules` рендерит окна из `WINDOWS` (`fmtWindow`) — UI-правила не врут при
   fast-режиме и калибровке.
6. ✅ Поиск шапки ведёт на `/discovery?q=…` (раньше — на `/`, где `q` не читался).
7. ✅ `.env.example` вычищен: `ADMIN_VOID`, оверлей, мёртвая `NEXT_PUBLIC_MOCK_SEED`.
8. `markDisputed`/`resolveDispute` нет в серверных handlers (остаётся): осознанная асимметрия —
   это ончейн-операции резолвера; из mock/api UI недостижимы.
9. ✅ `/api/dev/db/data` в проде теперь 404 (паритет с гейтом страниц `/dev/*`).
10. ✅ Мёртвые поверхности удалены: таблица `identities` (+DROP-миграция), колонка
    `messages.reported`, метод `getIncidentLog` (интерфейс/3 провайдера/вайтлист/qk),
    `ProfileLevel`/`Session.level`, `ChannelCard.isLive`, период `top_donor_month`,
    `PROFILE_LIMITS.url/link`. `LedgerType.GAME`/`REFUND` оставлены как резерв (ADR 0015);
    неточный комментарий про REFUND в chain-provider поправлен.
11. Хардкоды-дубли: ✅ `IS_CHAIN` (wallet-connect) и `SIWS_STORAGE_KEY` (dev/db ↔ chain-provider)
    сведены к единому источнику `addresses.ts`. Остальные дубли (лимиты 40/280 в profile-UI,
    `PRESETS` ×2, `HEADER_H`, TREASURY в escrow-smoke,
    `ESCROW_SIZE=243`, списки причин ×2, талли ×2, санитайзеры ×3) — рефакторинг, не мусор:
    живут в «Отложенной чистке» audit-map.
12. Два индексера донатов (внешний `scripts/indexer.ts` и встроенный) — оставлено: скрипт
    пригодится при выносе индексера из Next-процесса (serverless-прод).
13. ✅ Устаревшие комментарии поправлены: manifest («пока building»), handlers/EscrowTaskPanel
    («деньги — мок, эскроу — G3»), games/types («модерация на G2»), `buildCancelIx`
    («до принятия»), fixtures («1$=100»), chain-provider («DONATION/REFUND»),
    header-search/app-header (маршруты после ADR 0018).
14. Мелкие UX-разрывы: ✅ блок донора учтён в `canDonate`; ✅ LOW_REP-префлайт до `fund`
    (§18.3-5); ✅ `tierChanged` честен на первом донате (база — тир нулевых очков); ✅ textarea
    задания берёт лимит из `messageMaxLen`. Остались (мелочь, дизайн-решения): REINSTATE с двумя
    целями не снимает полный бан кошелька (тонкость rebuild); голос весом 0 занимает дедуп-слот.

### 18.5 Расхождения код ↔ спеки

> **Чистка доков 2026-07-05**: устаревшие фазовые спеки (core-spec, data-model, architecture,
> crypto/spec, backend/spec, frontend/* кроме design-system, спеки игр) УДАЛЕНЫ — история в git.
> Их расхождения с кодом, всё ещё значимые как решения, сведены ниже; остальное — закрыто.

1. Оверлеи ВЕРНУЛИСЬ как публичные polling-виджеты для OBS (не SSE): роут `/overlay/[handle]/[widget]`
   (`alerts`/`goal`/`top`/`total`), только чтение по handle, без сессии/кошелька; фон принудительно прозрачный
   (страница правит `document.body.background`). Управление — вкладка **Widgets** в `/space` My Realm
   (`RealmWidgets`: копируемые browser-source URL + превью). Живость — `refetchInterval` react-query
   (alerts 4с, top 15с, total 10с), НЕ realtime SSE (это следующий шаг, если понадобится). Инвариант §4.6
   держится: alerts показывает сумму/имя всегда, а текст доната — ТОЛЬКО при `message.state === "SHOWN"`.
   Мок-стор пер-браузерный → реальный OBS-захват работает на api/chain, не на локальном mock.
   **TTS** (`alerts`): опционально по `?tts=1` в URL — браузерный `speechSynthesis` зачитывает имя+сумму,
   а текст доната — ТОЛЬКО при SHOWN (§4.6); адрес кошелька вслух не читается (fallback «Someone»).
   **Donation goal** (`goal`): новые поля конфига `ChannelConfig.goalTarget` (micro-USDC, 0/undefined → нет
   цели) и `goalLabel` — инертны для Reign, как `description` (§4.4); задаются в `/space` → Widgets
   (`GoalEditor` → `updateChannelConfig`); прогресс = Σ`totalDonated` лидерборда / target. Персист —
   колонки `channel_configs.goal_target/goal_label` (миграция `ADD COLUMN IF NOT EXISTS`, db.ts §13).
2. Формула репутации ФИКСИРОВАНА: 1 USDC = 1 очко (ADR 0007), стример настраивает только пороги
   тиров; настраиваемых кривых/decay из ранних спек в коде нет и не планируется.
3. Версионирование конфига канала в коде отсутствует — версия навсегда 1 (§18.4-1).
4. Игра «задание-донат»: окна принятия нет — грейс и срок сдачи идут от СОЗДАНИЯ; активен
   FAST_TEST_WINDOWS; возврат денег при тейкдауне текста не реализован НАМЕРЕННО (WP-3/CR-2 —
   у оператора нет денежного рычага).
5. Крипто-стек: web3.js v1 (ADR 0004, совместимость wallet-adapter), а не kit/gill из ранней
   спеки; отдельная инструкция-якорь хэша текста не нужна — хэш едет в memo.m.
6. Retention/TTL карантина — план, в коде нет.

(нумерация 8a–8c сохранена — на неё ссылаются runbook, migration-plan и manual-testing)

8a. **Дельта канона на переключении M1 (dev-стенд; найдено сверкой M0, измерено при включении
   icp-режима 2026-07-04).** Канистра пересобирает репутацию из ПЕРВОИСТОЧНИКА (ончейн-донаты,
   текущая формула) — серверная история содержит три класса событий, которых в каноне нет.
   Пример на живом донор-владельце jesusavgn: сервер 13 очков, канистра 75.6. Состав разрыва:
   (а) **исторический `ADMIN_VOID` −65** — тип изъят из протокола аудитом CR-1 («оператор не
   редактирует число»); канон его не воспроизводит ПО ПОСТРОЕНИЮ — это не потеря данных, а
   применение действующих правил ко всей истории; (б) **2 mock-эпохи доната (+2)** без
   ончейн-провенанса — игрушки дев-стенда; (в) **легаси-округления (+0.4)** — 4 доната,
   банкованные доисторической формулой (0.5 USDC → 1 очко; до ADR 0007). Ревизор `--canister`
   распознаёт класс (в) механически (ℹ️, не провал); любое иное расхождение — красное.
   **Законный переходный класс — `DISPUTE_*`** (протокольные, переезжают в канистру на M2):
   до M2 витринное число icp-режима НЕ включает −50/+10 игровых дельт, а игровые гейты/веса продолжает
   считать сервер по своему журналу → витрина и игровая механика могут расходиться у
   наказанных доноров. Окно M1→M2 держать коротким; на mainnet всех трёх dev-классов не будет.
   **⚠️ Грабля локального стенда (M2): дельты спора НЕ переживают рестарт канистры.** С M2 арбитр
   пишет `DISPUTE_WON`(+бонус)/`DISPUTE_LOST`(−штраф) в журнал при финализации спора — но это
   ЧИСТО КАНИСТРОВОЕ состояние (кто открыл спор + вердикт), из цепочки НЕ реконструируемое (открытие
   спора — ed25519-подпись в канистру, не Solana-tx; ончейн виден лишь резолв, но не получатель ±дельты).
   Донаты канистра восстанавливает из трежери, а споры — нет. Значит `dfx start --clean` / reinstall
   локальной реплики (нужен после ребута/краха/смены конфига) СТИРАЕТ все прошлые дельты споров, и они
   НЕ возвращаются — только новый спор, открытый и зарезолвленный уже в текущей жизни канистры, снова их
   даст. На mainnet (persistent-канистра) не случается. Для теста: держать окно между рестартами, либо
   переоткрыть спор после рестарта.
   **✓ Закрыто (2026-07-06): эскроу-донаты заданий (`GameDonation`) канистра теперь индексирует.**
   Раньше канистра видела только обычные донаты 97/3 через трежери; эскроу-claim'ы (донат дошёл
   стримеру через задание G3a) шли мимо → в icp профиль их не показывал в «Журнале Reign» и число
   репутации их недосчитывало. Модуль `canister/core/src/escrow_index.rs` (M2, требует `escrow_program`
   в конфиге) отдельным курсором опрашивает подписи эскроу-программы, декодит `fund`/`claim_streamer`/
   `claim_donor` по anchor-дискриминаторам (зеркало `escrow-tx.ts`): `fund` → снимок {донор, стример,
   сумма} в stable-карту (эскроу-аккаунт закрывается при claim); `claim_streamer` → `GameDonation`
   донору на канал стримера (очки = полная сумма 1:1, паритет `repEffects`); `claim_donor` (возврат)
   → репутации нет. Дедуп с оспоренными (их банкует арбитр при финализации) — через `arbiter::case_of`;
   идемпотентность — по подписи claim (SEEN). Привязка стример→канал: активация канала в журнале
   (actor = владелец = payout, допущение v1); канал mock-эпохи без ончейн-активации не резолвится
   → эскроу-донат пропускается (та же дельта, что у чтений выше).
   **Текст задания в журнале Reign** (как у обычных донатов, 2026-07-06): текст — КОЖА, **в канистре
   его нет и не будет** (канистра — только деньги/репутация; текст-слоем займётся отдельная канистра
   позже, пока он на сервере). Серверный `getDonorOverview` кладёт эскроу-события с текстом,
   **отредактированным по show-статусу** (`isTextPublic`: SHOWN и не снят оператором — иначе `text:""`,
   паритет `redactDonation`); в chain-режиме они идут в журнал напрямую. В icp-режиме `IcpDataProvider`
   джойнит серверный текст к каноничной записи канистры по паре **(канал, сумма)** (одну эскроу-запись
   описывают оба источника; список+`shift()` разводит редкий случай двух заданий одной суммы на канале).
   Канистра-запись НИКАКОГО ключа задания не несёт. Рендер показывает текст только при `state=SHOWN`.
8b. **Табло споров открыто до вердикта (решение владельца 2026-07-05) — принятый компромисс.**
   Спека голосования прятала промежуточный счёт и голоса до финализации (замок против
   стадности и прицельного подкупа «докупить недостающий перевес», атака §8.5). Владелец
   предпочёл прозрачность (голосование добровольно и наград не даёт): `/dispute` и `/disputes`
   отдают текущее табло и список голосов живьём (arbiter/http.rs::case_json). НЕ баг —
   осознанный размен; для крупных споров на мейннете остаётся план конвертов (§3.1-4).
8c. **Экономика споров упрощена (решения владельца 2026-07-05; спека голосования v1.1
   удалена при чистке доков — экономический замысел см. ADR 0020, реализация — §7.3).** (1) Депозит/пошлина/залог удалены ЦЕЛИКОМ — «не сжигаем ничьи
   деньги, сжигаем только репутацию»: наказание за ложный спор — DISPUTE_LOST −50, анти-спам —
   порог репутации на открытие. (2) √-кворум `K·√суммы` заменён ФИКСИРОВАННЫМ кворумом от
   стримера (governance-параметр `quorum_micro`, дефолт 1 очко) — кворум не зависит от суммы.
   Канон-сообщение параметров сменило формат → `v: 2` (старые подписи невалидны; парные пины
   dispute-params.test.ts ↔ governance.rs обновлены). Сообщение открытия спора тоже → `v: 2`
   (текст про депозит заменён на честное «−50 репутации за проигрыш»). (3) **Позже награды спора
   сделаны параметром канала** (решение владельца): `DISPUTE_WIN_BONUS/LOSS_PENALTY` из фикс-констант
   стали governance-полями `dispute_win_bonus_micro`/`dispute_loss_penalty_micro` (дефолты 10/50 очков),
   редактируются подписью владельца + таймлок, как кворум/окна; канон-сообщение → `v: 3` (пины обновлены).
   Инвариант §4.5 держится: величину калибрует ВЛАДЕЛЕЦ своей игры, а применяет дельту ПРОТОКОЛ по исходу
   голосования (не оператор). Награды читаются на резолве (`arbiter.rs` → `effective_params`); кворум/окна
   по-прежнему снапшотятся при открытии. Вне icp (mock/api/chain) награды пока фикс-константы machine.ts.
   (4) **Порог открытия спора флорится штрафом** (icp, `arbiter.rs::open_dispute`): эффективный минимум =
   `max(min_reputation_to_dispute_micro, dispute_loss_penalty_micro)` — нельзя поднять спор, не имея
   репутации покрыть возможное списание (у кого репутация ниже, чем у него заберут, — не спорит). Оффчейн
   (mock/api, `handlers.ts`) пока гейтит только заданным порогом.
9. **Tally: float в TS vs целые micro в канистре (решение M2, зафиксировано 2026-07-04).**
   TS-`tally` (machine.ts) суммирует веса голосов в `number`: на адверсариальных дробях
   (0.1+0.2 против 0.3) float-сумма может дать «не ничья» там, где точная арифметика даёт ничью.
   В реальных данных веса — кратные 1e-6 (из `computePointsAsOf`), и на этом домене расхождения
   нет; golden-векторы таких случаев намеренно не содержат (README эталона, п.6). Канистра (M2)
   обязана считать tally в ЦЕЛЫХ micro-очках — это спецификация, а не отклонение от паритета;
   Rust-порт `canister/core/src/disputes.rs` уже так делает.

### 18.6 Пробелы тестов

Покрыто: reputation (плотно), moderation (офлайн-контракт), canonical, attestation,
machine/handlers (ESC-кейсы), bus, escrow-tx (декодер claim), operator-actions (4 кейса).
НЕ покрыто юнитами: денежный путь mock-provider (record/createDonation/
recordDonationFromChain — B1-гонка, поздняя привязка текста), reportMessage-порог,
computeLeaderboard (tie-break/периоды), redactDonation, codec, channel-links, auth (SIWS
nonce/replay), ingest (все ветки отказов), anchor/дайджесты. Контракт не компилируется в
среде разработки (нет тулчейна) — канон: `escrow-smoke.ts` против живого devnet.

---

## 19. Дорожная карта, зашитая в код и решения

- **G2 (бэкенд игры)**: серверные таймеры, снэпшот-чтения, инцидент-лог игры, прод-модерация
  задания (ключи + fail-closed политика — MOD-2).
- **G3b (до mainnet)**: ончейн commit-reveal голосование (снимает §18.1-1/2/3), депозит спора,
  D_max молодых каналов, commit-reveal ≥$50 (whitepaper); `ESCROW_RESOLVER` ушёл (M2 ✅). Субстрат —
  канистры ICP (ADR 0021, `docs/migration-plan.md`). **Сделано M-1 (2026-07-04)**: golden-эталон
  `testdata/golden/` (donations/reputation/disputes; порождается `npm run golden`, руками не
  правится) + Rust-workspace `canister/` (dfx.json, `core.did`, крейт `standing-core`) с портами
  `computePoints*`/`extractDonation`/`extractActivation`/`tally`, проходящими golden-паритет
  (`cargo test`, 7 тестов). **Сделано M0 (2026-07-04, локальный стенд)**: канистра-наблюдатель —
  индексер devnet (таймер → HTTPS-outcalls JSON-RPC → golden-порт разбора → журнал и курсор
  в stable memory, бэкфилл всей истории трежери из первоисточника), query-API (standing/
  leaderboard/journal/status) + HTTP-экспорт `/export` (raw-домен), ревизор `verify-export
  --canister` сверяет три источника (зелёный: 34/34 доната); **тресхолд-Ed25519** — канистра
  владеет Solana-адресом (schnorr key `key_1` локально; ключа целиком не существует), сборка
  legacy-tx своя (`sol_tx.rs`, эталонный тест против web3.js), живая memo-tx в devnet прошла
  (контур резолвера M2 доказан до денег). К продовому чтению НЕ подключена (это M1,
  `IcpDataProvider`). Мейннет-хвост (SOL RPC canister, durable nonce, certified data, циклы) —
  M5-гейты (⏸ владелец, 2026-07-04). Полный порт машины споров — M2.
- **Чек-лист mainnet** (сводно): §18.2 полностью (upgrade authority, окна, EXEC_WINDOW_MIN,
  ESC-7 mint-pin, свежие TREASURY/RESOLVER/program id, emit!-события) + юр-консультация
  (мастер-переменная: юрисдикция/США) + L3 (httpOnly-cookie) + рейт-лимиты на краю + вынос
  индексера в воркер + настоящий Postgres + SIWS-сессии в БД.
- **Калибровки** (tестнет): кворум спора, размер активации, retention карантина, окна игры,
  пороги тиров под курс 1:1.

---

## Приложение A. Коды ошибок (DataError / GameBusError)

`NO_SESSION, FORBIDDEN, NO_CHANNEL, NO_CONFIG, NO_MESSAGE, NO_TASK, MOCK_FAIL, TOO_LONG,
PROFILE_BLOCKED, CHANNEL_BLOCKED, BAD_HANDLE, BAD_PAYOUT, HANDLE_TAKEN, CHANNEL_ALREADY_EXISTS,
TEXT_REQUIRES_ACTIVE_CHANNEL, BAD_ATTESTATION, PAYOUT_UNATTESTED, TOO_MANY_TIERS, BAD_CONFIG,
BELOW_MIN, BLOCKED, WALLET_BANNED, NOT_REPORTABLE, ALREADY_REPORTED, BLOCKED_BY_OPERATOR,
BAD_TARGET, GAME_NOT_ENABLED, UNKNOWN_GAME, UNKNOWN_OP, BAD_AMOUNT, NO_TEXT, LOW_REP,
ILLEGAL_TASK, ESCROW_REUSED, NO_PAYOUT, ESCROW_INVALID, ESCROW_TEXT_MISMATCH, NOT_PENDING,
NOT_OPEN, NOT_DONE, NOT_DISPUTED, NOT_RESOLVED, NOT_WINNER, ALREADY_CLAIMED, ALREADY_VOTED,
BAD_CHOICE, ACCEPT_EXPIRED, GRACE_OVER, GRACE_ACTIVE, EXEC_OVER, DISPUTE_WINDOW_OVER,
VOTING_OVER, TEXT_LOCKED, SELF_REPORT, NETWORK, BAD_RESPONSE, RPC_ERROR, BAD_METHOD, BAD_ARGS,
BAD_BODY, CHAIN_MODE, AUTH_BAD_ADDRESS, AUTH_FAILED, INGEST_ERROR, NO_WALLET, NO_SIGN,
NOT_CONFIGURED, TEXT_BLOCKED, DONATION_PENDING, ACTIVATION_FAILED, NOT_OWNER, NO_ESCROW,
CHAIN_VIA_PROVIDERS, BAD_DATA_SOURCE`. Ончейн: `BadAmount, BadWindow, BadState, Expired,
NotDue, AlreadyResolved, WrongOutcome, Forbidden, GraceActive, BadOwner, BadMint`.

## Приложение B. Карта файлов → слой

- **КОСТЬ**: `anchor/programs/escrow-task/src/lib.rs`; программы SPL Token/ATA/Memo; ключи
  пользователей.
- **КОСТЬ №2 (строится, ADR 0021)**: `canister/core/src/` — `donation.rs`/`reputation.rs`
  (порты трастлесс-логики), `disputes.rs` (M2: ПОЛНЫЙ порт машины споров machine.ts — переходы,
  окна параметром, tally и веса в целых micro, репут-эффекты; 21 golden-сценарий); паритет с TS
  держат golden-тесты (`canister/core/tests/golden.rs` ↔ `testdata/golden/`, экспортёр
  `scripts/export-golden.ts`),
  `indexer.rs`+`sol_rpc.rs`+`state.rs` (наблюдатель devnet: outcalls → журнал в stable memory),
  `arbiter.rs` (M2: споры в канистре — открытие/голоса подписями кошельков, эскроу из цепочки,
  вес-снимки из журнала, ФИКС-кворум из governance-параметров (депозитов нет — §18.5-8c),
  финализация таймером → вердикт + журнал + ончейн mark_disputed/resolve_dispute тресхолд-подписью;
  канон-сообщения запинены парно с `src/lib/chain/dispute-vote.ts`),
  `signer.rs`+`sol_tx.rs` (тресхолд-Ed25519 + сборка Solana-tx), `governance.rs` (параметры
  споров канала: подпись владельца-из-цепочки + версия-нонс + таймлок §8.9; канонное сообщение
  запинено unit-тестом — TS-сторона обязана строить байт-в-байт), `http.rs` (публичный /export,
  /standing, /leaderboard, /donor (+`events`-детализация журнала), /dispute, /disputes,
  /dispute-params GET/POST, /dispute/open, /dispute/vote), `lib.rs` (эндпоинты/таймеры).
- **Мост в кость**: `lib/chain/donation-tx.ts`, `escrow-tx.ts`, `memo.ts`, `attestation.ts`,
  `siws.ts`; `hashContent`/`taskTextCommitment` (moderation.ts); `server/anchor.ts`.
- **МЫШЦЫ**: `server/{ingest,indexer-service,escrow-verify,auth,store,store-db,db,persist,
  request-context,runtime}.ts`; `lib/chain/{indexer,addresses,config}.ts`; `lib/reputation.ts`;
  `lib/data/{codec,canonical}.ts`; `games/escrow-task/machine.ts`; `app/api/v1/**`;
  `scripts/{indexer,escrow-indexer,verify-export,recover-activation,scan-treasury}.ts`.
- **КОЖА**: `app/**` (страницы), `components/**`, `lib/data/{moderation,fixtures,context,
  hooks}.ts`, игровые UI, dev-поверхность.
- **Смешанные**: `lib/data/mock-provider.ts` (МЫШЦЫ: record/recordDonationFromChain/
  leaderboard/dispatchGameOp; КОЖА: профили/модерация/баны/оператор); `games/escrow-task/
  handlers.ts` (МЫШЦЫ: settle/claim/сверки; КОЖА: гейты create, спор); `lib/data/
  chain-provider.ts` (мост + UX-префлайты); `app/api/v1/rpc/route.ts` (транспорт КОЖИ с
  замками МЫШЦ).

## Приложение C. Данные на диске

`.data/pg/` (PGlite), `.data/store.json` (легаси-миграция), `.data/auth.json` (сессии),
`.treasury-devnet.json` (devnet-ключ трежери, ПУБЛИЧЕН — только devnet). Meta-ключи — §13.
