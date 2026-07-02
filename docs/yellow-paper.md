# Standing — Yellow Paper: техническая спецификация системы по коду

> **Источник истины — код** (ветка `main`, 2026-07-02, после ADR 0019). Этот документ построен
> полным разбором исходников, а НЕ пересказом спек: там, где спека (`core-spec`, `crypto/spec`,
> `frontend/*`, ROADMAP) расходится с кодом, здесь описано поведение кода, а расхождение занесено
> в §18.5. При изменении кода правь соответствующий раздел здесь; при конфликте документов этот —
> старший после самого кода.
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
  `OPERATOR_ADDRESS` (пустой в проде → оператора нет, fail-closed); `level` всегда
  `"address_only"` (уровни light/creator — легаси-заготовка).
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
создании канала (прозрачно) или кнопкой «Подписать адрес выплат» в студии. Проверяют:
**клиент донора** до сборки донат-tx и эскроу-fund (`assertPayoutAttested` → `PAYOUT_UNATTESTED`),
**сервер** при создании/дозакреплении и при зачёте (`ingest`, только CHAIN_MODE). Канал без
подписи → донаты приостановлены (честный disabled-state). Остаточное доверие: привязка
handle→owner — платформенная. Модуль изоморфен (bs58 + tweetnacl).

### 3.4 Денежный конфиг и fail-closed — `addresses.ts`, `instrumentation.ts`

- Дефолты devnet (`devnetOnly()`: в проде — пустая строка): трежери `9tSW…trpe` (ключ ПУБЛИЧЕН,
  `.treasury-devnet.json`), USDC-mint Circle `4zMM…ncDU`, программа `GPP2…7GU4`, резолвер
  `6F5Y…B5xR`; оператор вне прода = трежери.
- `assertMoneyConfig()` (зовётся при старте сервера и на денежном пути): в проде БРОСАЕТ, если
  не заданы env трежери/оператора/минта, если трежери = devnet-адрес, или трежери = оператор
  (одноключевой риск). **Не проверяет** `ESCROW_PROGRAM_ID`/`ESCROW_RESOLVER` (§18.2).

---

## 4. Эскроу-программа escrow-task [КОСТЬ] — `anchor/programs/escrow-task/src/lib.rs`

Program ID devnet: `GPP2BCNMp8peLh3uySuEqPb2gWanr4xw5Lf3X7Kx7GU4`; upgrade authority — один
кошелёк `G1vJ…uz14` (осознанно на devnet; гейт mainnet — §18.2). Деньги в PDA; получатели и
сумма зашиты при `fund`; claim-модель (получатель забирает сам); из каждого нетерминального
состояния есть permissionless-выход.

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
| `RESOLVER` | `6F5Y…B5xR` (захардкожен, ESC-1) | config-PDA в G3b |
| `TREASURY` | `9tSW…trpe` (захардкожен) | редеплой |

### 4.3 Инструкции и переходы

| Инструкция | Signer | Guard'ы | Переход |
|---|---|---|---|
| `fund(task_id, amount, window)` | донор | amount>0; window ∈ [60с..90д] и > CANCEL_GRACE (ESC-17); init PDA+vault; CPI transfer donor→vault | → Pending |
| `accept` | стример | Pending; now ≤ done_deadline | → Accepted (ESC-19: обязателен до mark_done; сигнал раскрытия текста) |
| `reject` | стример | Pending\|Accepted | → Resolved(ToDonor) |
| `cancel` | донор | Pending\|Accepted; now ≤ accept_deadline (грейс) | → Resolved(ToDonor) |
| `mark_done` | стример | Accepted (ESC-19); now ≤ done_deadline (ESC-2); now > accept_deadline (ESC-13) | → Done; dispute_deadline = now+DISPUTE_WINDOW |
| `mark_disputed` | резолвер | Done; now ≤ dispute_deadline (ESC-11) | → Disputed; deadline = now+VOTING_WINDOW |
| `resolve_dispute(bool)` | резолвер | Disputed (ESC-3); Unresolved | → Resolved(сторона) |
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
ядра), `DISPUTE_WON` (+10, игра), `DISPUTE_LOST` (−50, ЕДИНСТВЕННОЕ протокольное списание;
операторского списания не существует — CR-1), `GAME`/`REFUND` — зарезервированы, не эмитятся.

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
- `computeLeaderboard(period)`: `all_time` / скользящие 30 дней (`month`; `top_donor_month` —
  тот же фильтр, top-1); очки ≤ 0 отбрасываются; ники только при `allow_display_names` и
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
`accept` (3 мин / 72 ч) — **рудимент, машиной не используется** (отдельного окна принятия нет —
дедлайны от создания, паритет с контрактом). `DISPUTE_WIN_BONUS = 10`,
`DISPUTE_LOSS_PENALTY = 50`.

Ключевые guard'ы (зеркала ончейн): markDone не в грейсе (`GRACE_ACTIVE`) и не после дедлайна
(`EXEC_OVER`); cancel только в грейсе (`GRACE_OVER`); accept до дедлайна и **раскрывает текст**
(SHOWN); спор только в окне; голос один на адрес; авто-скрытие по жалобам (порог 3) — только в
PENDING (после accept текст обязан быть виден, ESC-19). `dueResolution` — исход по времени:
PENDING/ACCEPTED просрочен → to_donor (expired/no_show); DONE просрочен → to_streamer
(completed); DISPUTED просрочен → `tally`.

### 7.3 Спор и голосование [сейчас КОЖА/МЫШЦЫ — главный шов; цель G3b: КОСТЬ]

- Право спора: любой вошедший, кроме сторон; порог `minReputationToDispute` (рычаг стримера §10).
- Кворум: `max(1, pointsForAmount(amount))` — «мок-дефолт», калибровка впереди.
- Вес голоса = `computePointsAsOf(voter, dispute.openedAt)` — снэпшот на секунду открытия спора
  (накрутка задним числом невозможна; оператор дельты не пишет — вес честный).
- `tally`: кворум не собран → to_streamer (no_quorum); больше «выполнил» → to_streamer; больше
  «не выполнил» → to_donor; **ничья → to_streamer** (презумпция стримера §11).
- Деньги двигает резолвер-оператор: ончейн `mark_disputed` (заморозка от таймаута) и
  `resolve_dispute(toStreamer из тальи)`. Эти op существуют ТОЛЬКО в chain-провайдере (D1/D2).
- Санкции спора: инициатор выиграл → `DISPUTE_WON +10`; проиграл голосованием → `DISPUTE_LOST
  −50` (ложный спор EV-отрицателен).

### 7.4 Обработчики — `handlers.ts` (все op)

| op | Кто | Главные проверки / эффекты |
|---|---|---|
| `create` | донор | BAD_AMOUNT, NO_TEXT, TOO_LONG, BELOW_MIN, LOW_REP (порог §10), модерация → ILLEGAL_TASK; chain: ESCROW_REUSED (ESC-18), NO_PAYOUT (ESC-6 fail-closed), ESCROW_INVALID (сверка ончейн), ESCROW_TEXT_MISMATCH (CR-4); textState по textShowMode |
| `accept`/`reject`/`markDone` | владелец | `requireOwner` → машина |
| `cancel` | донор | только автор |
| `hide` | владелец | отклонить без газа (PENDING; деньги вернутся таймером) |
| `setTextState` | владелец | «Показать» после резолва / «Скрыть» не в PENDING → TEXT_LOCKED |
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
пресеты 5/10/25/100, текст ≤280 хардкод, срок с валидацией по WINDOWS, варнинг заморозки
>7 дней — WP-5, подтверждение с FeeSplit), `EscrowTaskHub`/`TaskCard` (живые таймеры;
ролевые кнопки, включая кнопки резолвера при `viewer === ESCROW_RESOLVER`), `TaskFeedRow`
(строка в общей ленте), `DisputeTally`, `DisputePage` (`/c/[handle]/dispute/[taskId]`,
серверная пагинация голосов по 50, фильтры/сортировки/поиск), `EscrowTaskRules` (⚠️ хардкодит
прод-окна 12ч/24ч — врёт при fast-режиме).

---

## 8. Тексты и модерация [КОЖА]

> Два РАЗНЫХ субъекта: **канальная модерация** (стример + его модераторы, локальная власть,
> `requireChannelManager`) и **операторский T&S** (площадка, `requireOperator`). Общее правило:
> модерация решает судьбу ТЕКСТА, никогда — денег и репутации (§4.7).

### 8.1 Жизненный цикл текста доната

`HELD` (дефолт: видят стример+модераторы; сервер вырезает текст в публичных чтениях —
`redactDonation`) → «Показать» → `SHOWN` (лента/…) или «Скрыть» → `HIDDEN`; `QUARANTINED` —
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
| `tiers` | 5 тиров: Новичок 0 / Свой 500 / Постоянный 5 000 / VIP 50 000 / Легенда 200 000 очков | ≤ 20 (`MAX_TIERS`); описание тира ≤ 140 + модерация. ⚠️ пороги калиброваны под СТАРЫЙ курс 1$=100 (§18.4-2) |
| `minDonation` | 0.1 USDC | — |
| `minDonationWithText` | 0.5 USDC | — |
| `minReputationToTask` | 0 | 0..1e9, конечное (§10 — право прислать задание) |
| `minReputationToDispute` | 1 | 0..1e9 (§10 — право поднять спор; НЕ вес и не исход) |
| `messageMaxLen` | 200 | — |
| `nameMode` | `addresses_only` | ники в лентах/лидербордах только при `allow_display_names` |
| `textShowMode` | `manual` | `auto_if_clean` — авто-показ CLEAR |
| `moderators` | [] | scope `queue` / `queue_and_block` |
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

## 11. Слой данных: DataProvider и три реализации

### 11.1 Контракт (`provider.ts`) — 33 метода

Сессия: `getSession, connect, disconnect, getProfile, updateProfile`. Каналы: `listChannels
(ACTIVE+BASIC; SUSPENDED/BANNED скрыты), getChannel, getMyChannel, getManagedChannels,
getOperatorChannels, getChannelConfig, createChannel, activateChannel, attestPayout,
updateChannelConfig`. Репутация: `getStanding, getLeaderboard, getDonorOverview, homeFeed`
(личность из сессии — приватные циклы). Донаты: `createDonation, listDonations`. Модерация:
`getModerationQueue, setMessageState, hideDonorMessages, reportMessage`. Блок-лист:
`getChannelBlocklist, addChannelBlock, removeChannelBlock, getMyChannelBlock`. Оператор:
`getOperatorQueue, applyOperatorAction, getIncidentLog`. Игры: `gameAction, gameQuery`.

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
markDone/cancel/claim (+ авто-`resolve_timeout` одной tx) / markDisputed / resolveDispute
(резолвер). SIWS — §2.2. Кошелёк инжектится React-мостом (`ChainWalletBridge`).

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
/api/dev/db/data` — данные 11 таблиц (лимит 500 строк), гейт: SIWS-токен === оператор
(fail-closed при пустом OPERATOR_ADDRESS); ⚠️ IS_PROD-гейта нет (§18.4-9). Оверлея/SSE — НЕТ
(§18.5-1).

---

## 13. Персистентность [МЫШЦЫ-хранилище]

- **PGlite** (Postgres в WASM, `.data/pg/`, ADR 0014), singleton, схема идемпотентна.
  Таблицы: `identities` (⚠️ мёртвая), `light_profiles`, `channels` (+`payout_attestation`;
  частичный уникальный индекс owner WHERE status≠BANNED — один канал на кошелёк),
  `channel_configs` (PK channel+version), `ledger_events` (append-only; индексы
  creator+donor / creator+ts; points_delta numeric — миграция с bigint), `donations`,
  `messages` (+content_hash индекс; колонка `reported` не маппится), `channel_blocks`,
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
| `/c/[handle]` | канал: сворачивающаяся шапка (имя/ссылки из профиля владельца), правый рейл `GameActionRail` (донат + пикер игр), табы «Активные» (игры) / «Донаты» (единая лента донатов+заданий, поиск) / «Тиры»; SUSPENDED/BANNED → «Канал недоступен»; внизу — ссылка §4.4 на экспорт |
| `/c/[handle]/donors` | лидерборд (периоды all_time/month, фильтр по тиру, подсветка себя) |
| `/c/[handle]/dispute/[taskId]` | страница спора (пагинация голосов по 50) |
| `/me`, `/u/[address]` | свой (editable) / публичный профиль донора |
| `/me/profile` | редактор профиля (гидрация один раз на адрес) |
| `/studio` | обзор: нет канала → `CreateChannelForm` inline; аналитика (кумулятивные графики Оборот/Донатёры, диапазоны 1Д..Всё), история донатов |
| `/studio/queue` | очередь HELD (по managed-каналам, FLAG первыми; HARD_BLOCK — только карантин) + задания на модерации; бейдж-счётчик в сайдбаре |
| `/studio/settings` | секции: Адрес выплат (аттестация H1, только chain) / Описание / Тиры / Донаты (минимумы, лимит текста) / Имена и показ / Модераторы; draft-модель с плавающим «Сохранить» |
| `/studio/games` | тумблеры игр из реестра + пороги репутации §10 |
| `/studio/blocklist` | канальные блоки (7 причин) |
| `/ops` | консоль T&S (гейт isOperator): лестница наказаний, форма действия с подтверждением, инцидент-лог с «Разобрать →» |
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
| `verify-export.ts` | независимый пересчёт (§10) |

---

## 16. Конфигурация (все ENV)

| Переменная | Назначение |
|---|---|
| `NEXT_PUBLIC_DATA_SOURCE` | mock \| api \| chain (выбор провайдера и chain-дерева) |
| `CHAIN_MODE` (сервер) | ≠"off" в проде / ="on" в dev → денежные гейты C1/M2 + требование аттестации |
| `NEXT_PUBLIC_DEVNET_RPC` | RPC (деф. публичный devnet); из него же кластер эксплорера |
| `NEXT_PUBLIC_DEVNET_USDC_MINT` / `NEXT_PUBLIC_TREASURY_OWNER` / `NEXT_PUBLIC_OPERATOR_ADDRESS` | денежный конфиг; в проде обязательны (fail-closed C2) |
| `NEXT_PUBLIC_ESCROW_PROGRAM_ID` / `NEXT_PUBLIC_ESCROW_RESOLVER` | эскроу-программа/резолвер (резолвер обязан совпадать с константой контракта) |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | опц., включает WalletConnect |
| `APP_DOMAIN` | домен SIWS-сообщения (деф. standing.local) |
| `OPENAI_API_KEY` | авто-модерация (нет → словарь/CLEAR-кроме-CSAM) |
| `ANCHOR_SIGNER_KEYPAIR` / `ANCHOR_INTERVAL_MS` | пруф-якорь (нет ключа → выключен) / период (1 ч) |
| `NEXT_PUBLIC_MOCK_FAIL` | инъекция ошибок в mock |
| `STANDING_API` (скрипты) | URL RPC (деф. localhost:3000) |
| `NEXT_PUBLIC_MOCK_SEED` | ⚠️ мёртвая (только в .env.example) |

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

## 18. ПРОБЛЕМЫ И КОНФЛИКТЫ (по состоянию кода на 2026-07-02)

### 18.1 Конфликты КОСТЬ ↔ КОЖА (структурные, признанные)

| # | Конфликт | Статус/замок |
|---|---|---|
| 1 | **Спор целиком оффчейн**: голоса/тальи в сторе; на цепь исход двигает единственный резолвер-оператор (`mark_disputed`/`resolve_dispute`). Деньги при его бездействии спасает `resolve_timeout` (→ стримеру), но ИСХОД спора — точка доверия к оператору | принято до G3b (commit-reveal ончейн); D1/D2 |
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
   в `.treasury-devnet.json`; `assertMoneyConfig` НЕ проверяет `ESCROW_PROGRAM_ID`/`ESCROW_RESOLVER`.
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
5. **LOW_REP-разрыв в chain-create задания**: префлайт до fund проверяет минимум/длину/
   модерацию/аттестацию, но НЕ `minReputationToTask` → донор ниже порога может профандить
   эскроу, чей оффчейн-create откажет (`LOW_REP`) — деньги зависают до таймаута возврата.
   Кандидат на фикс: добавить порог в префлайт chain-провайдера.
6. **handle → owner — платформенная привязка** (остаточное доверие H1, задокументировано).
7. **L3 открыт**: SIWS-токен в localStorage (XSS); `.data/auth.json` — токены в открытую.
8. **Один Node-процесс** — стор in-memory + встроенный индексер; horizontal scale требует
   выноса (заявлено в коде); `saveStore` переписывает снимок целиком.
9. **`failMode` — глобальный флаг синглтона** (личность в ALS, а failMode нет) — dev-гонка.
10. **Рейт-лимитов нет вообще** (MOD-3/B5) — заявлено «на краю» (Cloudflare/nginx), в коде
    отсутствуют; FIFO-вытеснение 50k сессий/nonce — теоретический DoS.
11. **Сеттлер глотает ошибки** (`catch {}` без лога) — «игра не включена» неотличима от бага.
12. **taskVerdictCache без вытеснения** (TTL есть, очистки нет) — медленный рост памяти.

### 18.4 Битое/устаревшее в коде (упорядочено по важности)

1. **Версионирование конфига НЕ реализовано**: `updateChannelConfig` мутирует последнюю версию
   на месте; `version` навсегда 1, `hash` — `cfg-<id>-v1`; `LedgerEvent.configVersion` всегда 1.
   Заявленный механизм «банкинг по версии» (data-model, architecture.md, trust-layers) —
   декларация. Пока курс фиксирован (ADR 0007) это безвредно для очков, но «смена формулы не
   переписывает прошлое» держится только неизменяемостью формулы, а дайджест конфигов в якоре
   не защищает историю версий (её нет).
2. **Дефолтные пороги тиров под старый курс**: 500/5000/50000/200000 очков = $500…$200 000 при
   курсе 1:1 (комментарий в fixtures «1$=100» устарел). «Легенда» за $200k — нереалистично.
3. **`scripts/chain-verify.ts` (секция очков) и `devnet-smoke.ts` СЕЙЧАС ПАДАЮТ**: ожидают
   старую формулу (1 USDC→100, округление вверх; smoke: 10 USDC→1000). Движок давно 1:1
   дробный (A3). Скрипты надо обновить или секции убрать.
4. **`WINDOWS.accept` — рудимент** (72ч/3мин): машиной не используется, отдельного окна
   принятия нет. Комментарий при константе вводит в заблуждение.
5. **`EscrowTaskRules` хардкодит «12 ч / 24 ч»** — при активном fast-режиме UI-правила врут;
   не генерируются из WINDOWS.
6. **Поиск шапки ведёт на `/?q=…`, а `q` читает только `/discovery`** — сломан после ADR 0018.
7. **`.env.example` устарел**: упоминает удалённый `ADMIN_VOID`, несуществующий оверлей,
   мёртвую `NEXT_PUBLIC_MOCK_SEED`.
8. **`markDisputed`/`resolveDispute` нет в серверных handlers** — существуют только в
   chain-провайдере; в mock/api → `UNKNOWN_OP` (практически недостижимо, но асимметрия).
9. **`/api/dev/db/data` доступен в проде** (гейт только по оператор-токену; страницы /dev — 404,
   API — нет).
10. **Мёртвые поверхности**: таблица `identities`; колонка `messages.reported`;
    `getIncidentLog` (в интерфейсе/вайтлисте, UI не использует); `ProfileLevel` light/creator;
    `ChannelCard.isLive`; `PROFILE_LIMITS.url/link`; `LedgerType.GAME/REFUND` (не эмитятся,
    комментарий в chain-provider про «DONATION/REFUND» неточен).
11. **Хардкоды-дубли**: лимиты 40/280 в profile-UI vs `PROFILE_LIMITS`; textarea задания 280 vs
    `messageMaxLen` (деф. 200!) — UI разрешает больше, сервер откажет; report-dialog 280 vs
    `REASON_MAX` 500; `PRESETS` в двух файлах; `HEADER_H=60` vs CSS-переменная; `IS_CHAIN`
    пересчитан в wallet-connect.tsx; ключ localStorage SIWS продублирован в /dev/db;
    TREASURY в escrow-smoke; `ESCROW_SIZE=243`; два похожих списка причин жалоб; два
    компонента талли (`Tally`/`DisputeTally`); санитайзер суммы — 3 разных реализации.
12. **Два индексера донатов** (внешний `scripts/indexer.ts` 8 с и встроенный 20 с) —
    функциональный дубль; скрипт — legacy/ручной инструмент.
13. **Устаревшие комментарии**: `manifest.ts` «пока building» (уже available); `handlers.ts`/
    `EscrowTaskPanel` «деньги — мок, эскроу — G3» (G3a реализован); `types.ts` «модерация на
    G2» (уже есть); `buildCancelIx` «до принятия» (cancel работает и из Accepted); fixtures
    «1$=100»; комментарий про «динамический импорт web3 в escrow-verify» (импорт статический);
    `header-search` «Enter → Discovery».
14. **Мелкие UX-разрывы**: блок донора не отражён в `canDonate` (сервер откажет позже);
    `EscrowTaskRail` не гейтит по `minReputationToTask` заранее; `tierChanged` при первом
    донате всегда false (тир-ап анимация не срабатывает); REINSTATE с двумя целями не снимает
    полный бан кошелька (тонкость rebuild — оператору легко ошибиться); голос с весом 0
    занимает дедуп-слот.

### 18.5 Расхождения код ↔ спеки (спеки устарели)

1. **Оверлей/SSE**: ROADMAP Фаза 2 отмечает «[x] Живой оверлей — SSE /api/v1/overlay —
   проверено», в коде НЕТ ни маршрута, ни EventSource (удалён, вероятно, при переходе на
   реальные кошельки ADR 0005). `frontend/screens.md` («Overlay view для OBS») — не реализован.
   `top_donor_month` живёт «для оверлея», которого нет.
2. **CLAUDE.md §7** «очки репутации — целые» ↔ код: дробные с micro-точностью (A3/ADR 0007).
3. **core-spec/frontend/screens**: «репутационная формула linear/sublinear/bracket, множители,
   decay» — в коде формула фиксирована, настраиваются только пороги тиров (ADR 0007).
4. **data-model/architecture**: «конфиги версионируются и хэшируются; событие помнит
   config_version» — механизм существует только как поля (см. 18.4-1).
5. **Спека игры §5**: «72ч окно принятия + грейс после принятия» — в коде окна принятия нет,
   грейс и срок сдачи от СОЗДАНИЯ (учтено в audit-map, спека не исправлена).
6. **crypto/spec §6** «опциональный ончейн-якорь content_hash» — не реализован для донатов
   отдельной инструкцией (memo.m уже несёт хэш; отдельного якоря нет).
7. **`glossary.md`** упоминает QUARANTINED-бакет с retention — retention-механики в коде нет
   (карантин = state без TTL).

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
  D_max молодых каналов, commit-reveal ≥$50 (whitepaper), уход `ESCROW_RESOLVER`.
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
