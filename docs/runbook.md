# Runbook — запуск, грабли, ключи

> Операционные знания, которые иначе переоткрываются об стену. Как система УСТРОЕНА —
> `docs/yellow-paper.md`; первый запуск по шагам — README («Разработка» / «Запуск на devnet»);
> как ПРОВЕРИТЬ, что всё работает, без чтения кода — `docs/manual-testing.md`.
> Здесь — то, что узнаёшь, только набив шишку. Наступил на новую — допиши сюда.

## Запуск (кратко)

- `npm install && npm run dev` → http://localhost:3000. ENV — по `.env.example`
  (дефолт: `chain` + devnet; фоновый индексер стартует сам вместе с сервером).
- Полный сброс данных: остановить сервер → удалить `.data/`.

## Грабли окружения

1. **Крашнулся/убит dev-сервер → `rm -rf .next` перед перезапуском.** Иначе Next поднимается на
   битом кэше: ошибка `vendor-chunks` либо страницы без стилей. Та же болезнь, если запустить
   **`npm run build` при работающем `npm run dev`** — они делят `.next`, сборка перетирает кэш
   под ногами сервера (страница «голый текст без стилей»). Правило: build — только при
   остановленном dev, после — `rm -rf .next` и перезапуск.
2. **Серверный стор — singleton на globalThis**: данные переживают HMR, но код — нет. Изменил код
   `mock-provider`/`server/*` → перезапусти `npm run dev`, иначе крутится старый инстанс класса.
3. **Донат «висит» ~15–30 с после подписи — это норма.** Сервер зачитывает только `finalized`
   (анти-реорг, M2); клиент ретраит приём до 72 с. «Готово» в UI честно ждёт финализации.
4. **Публичный devnet-RPC и фасеты лимитят (429).** Смена провайдера — env
   `NEXT_PUBLIC_DEVNET_RPC`, код не трогается. SOL-фасет часто пуст — держи запас на тест-кошельках.
5. **Тестовые окна игры активны** (`FAST_TEST_WINDOWS`: грейс 1 мин, спор/голосование по 2 мин) —
   полный цикл задания прогоняется за минуты. Перед mainnet вернуть прод-набор И константы
   контракта + редеплой (yellow-paper §18.2).
6. **Новый/старый канал не принимает донаты** → стример не подписал адрес выплат: студия →
   Настройки → «Подписать адрес выплат» (H1, fail-closed; одна подпись без газа).
7. **Эскроу-контракт локально НЕ собирается** (нет тулчейна) — канонический прогон против живой
   devnet-программы: `scripts/escrow-smoke.ts`. Правишь `lib.rs` → синхронно правь TS-зеркала
   (`escrow-tx.ts`, `machine.ts`) — единого источника констант нет (yellow-paper §18.2).

## Эскроу-программа (`anchor/`) — сборка и редеплой

- **Program id неизменен** `GPP2…7GU4` (ENV `NEXT_PUBLIC_ESCROW_PROGRAM_ID`); история редеплоев —
  audit-map §ESC. Тулчейн, которым программа реально собрана и задеплоена: **Solana CLI (Agave)
  4.0.2 / platform-tools v1.53 / rustc 1.89, Anchor 0.31.1 (avm)**; для хост-сборки proc-макросов
  нужен `build-essential`. `anchor/Cargo.lock` ЗАПИНЕН под этот тулчейн — не обновляй зависимости
  «заодно».
- Редеплой: `cd anchor && anchor build && anchor deploy --provider.cluster devnet` (id уже вписан —
  `anchor keys sync` нужен только новой программе). Upgrade authority — `~/.config/solana/id.json`
  (`G1vJ…uz14`); буфер деплоя требует ~2.01 SOL НА ВРЕМЯ деплоя (возвращается).
- Правишь `lib.rs` → синхронно TS-зеркала (`escrow-tx.ts`, `machine.ts`, yellow-paper §18.2) и,
  если менялись константы окон, — Rust-порт канистры; проверка — `scripts/escrow-smoke.ts` против
  живой программы + `npm run golden && (cd canister && cargo test)`.

## Канистры ICP (миграция v3, с M-1)

- **Тулчейн:** `dfx` 0.32 при вызове предупреждает «dfx is deprecated, use icp-cli» — DFINITY мигрирует
  CLI; на M0 оценить переезд на `icp-cli` (cli.internetcomputer.org), пока всё работает на dfx.
  Ставится офиц. скриптом `sh -c "$(curl -fsSL https://internetcomputer.org/install.sh)"`
  (это dfxvm; бинарь и версии — в `$XDG_DATA_HOME/dfx`, дефолт `~/.local/share/dfx`). ⚠️ Грабля:
  если запускаешь из snap-приложения (VSCodium), `XDG_DATA_HOME` указывает в каталог snap-ревизии —
  ставь/зови с `XDG_DATA_HOME="$HOME/.local/share"`, иначе после обновления snap dfx «исчезнет»
  (`dfx 0.32.0 is not installed`). PATH: `export PATH="$HOME/.local/share/dfx/bin:$PATH"`.
  Rust-таргет: `rustup target add wasm32-unknown-unknown`.
- **Golden-паритет** (правишь `reputation.ts`/`indexer.ts`/`machine.ts` ИЛИ `canister/core/src/*`):
  `npm run golden && (cd canister && cargo test)` — оба обязаны быть зелёными В ОДНОМ коммите с
  правкой. Диф `testdata/golden/*.json` без правки логики = красный флаг (эталон руками не трогаем).
- **Локальный стенд M0 (канистра-наблюдатель):**
  ```bash
  cd canister && dfx start --background --clean
  dfx deploy core --argument '(record { rpc_url = "https://api.devnet.solana.com";
    treasury_ata = "GzBQqH16CHT5m8v5JWAG6fTPcRohTfZQFvgW8Jx8AoKX";
    usdc_mint = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"; poll_secs = 20 : nat64 })'
  ```
  Канистра сама бэкфиллит ВСЮ историю трежери с devnet (минута-две) и дальше опрашивает
  каждые 20 с. Смотреть: `http://<canister-id>.raw.localhost:4943/status` и `/export`
  (id печатает deploy; ⚠️ без `.raw.` шлюз требует certified-ответов — их пока нет, хвост M0).
  Сверка трёх источников: `npx tsx scripts/verify-export.ts --channel <handle>
  --canister http://<canister-id>.raw.localhost:4943`. Остановка — `dfx stop`.
  ⚠️ Локальная сеть ephemeral: после `dfx stop`/ребута состояние канистры стирается —
  редеплой с тем же аргументом, бэкфилл повторится сам (журнал пересобирается из цепочки);
  бэкфилл занимает минуту-две — сверку гонять после того, как `/status` покажет polls ≥ 2.
- **Режим `icp` (M1, канон чтения из канистры):** в `.env.local` —
  `NEXT_PUBLIC_DATA_SOURCE=icp` + `NEXT_PUBLIC_ICP_CANISTER_URL=http://<canister-id>.raw.localhost:4943`,
  перезапустить `npm run dev`. Требует ПОДНЯТОГО локального стенда канистры (см. выше) — иначе
  стендинг/лидерборд покажут ошибку сети (остальной сайт живёт: деньги/тексты канистры не
  касаются). **Откат:** `NEXT_PUBLIC_DATA_SOURCE=chain` + перезапуск. ⚠️ Цифры репутации в icp
  отличаются от chain на dev-стенде — это смена канона, состав разрыва: yellow-paper §18.5-8a.
- **Governance-параметры споров (M1):** чтение —
  `curl "$CANISTER/dispute-params?channel=<id>"` (владелец выводится из активации в журнале;
  `isDefault: true` = канал ничего не менял). Запись — POST туда же с ed25519-подписью владельца
  (канон-строка — `governance.rs::build_params_message`, пин в тестах; живой пример —
  scratchpad-смоук gov-smoke). Таймлок: изменение лежит в `pending` до `effectiveAtNs`
  (≥ цикла спора текущих правил, пол 300 с), дозревает таймером индексера.
- **Споры через канистру (M2):** штатный светофор — `npx tsx scripts/dispute-smoke.ts`
  (~5–7 мин: живой эскроу на devnet, спор/голос подписями, вердикт тресхолдом, возврат денег).
  Нужны: стенд канистры, SOL на `id.json` и `.treasury-devnet.json` (каждый прогон ест
  ~0.002 SOL ренты хранилища + комиссии), USDC в трежери. Газ резолвера: тресхолд-адресу
  канистры нужен SOL на `mark_disputed`+`resolve_dispute` (по 5000 lamports); вернуть излишек —
  `dfx canister call core withdraw_sol '("<куда>", <lamports>)'` (только контроллер).
- **Тресхолд-подпись (M0-светофор, контур резолвера M2):** локальные тестовые chain-ключи
  зовутся `key_1` (НЕ `dfx_test_key`) — имя в init-аргументе `schnorr_key_name`.
  Адрес канистры: `dfx canister call core solana_address` (после reinstall НЕ меняется —
  выводится из id канистры + derivation path). Ему нужен devnet-SOL на комиссии (~0.05):
  `solana transfer <адрес> 0.05 --url https://api.devnet.solana.com --allow-unfunded-recipient`.
  Живой прогон: `dfx canister call core test_sign_and_send '("текст memo")'` → подпись tx;
  только контроллер канистры.
- **Пайп-грабля dfx:** `dfx start --background | tail` ВИСНЕТ (реплика держит stdout пайпа
  открытым) — редиректь в файл или запускай без пайпа.
- **Убитая реплика (ребут/обрыв сессии) → `dfx start` падает** циклом «Failed to initialize
  PocketIC … 400 Bad Request» (несовместимый недобитый стейт). Лечение: `dfx stop`, затем
  `dfx start --background --clean` + redeploy с тем же аргументом. Терять нечего: id канистры
  и её тресхолд-Solana-адрес на свежей локальной сети ДЕТЕРМИНИРОВАНЫ (проверено: адрес
  `EekhckAL…` пережил чистый рестарт, SOL на нём цел), журнал пересобирается из цепочки сам.
- **Кошелёк циклов — ⏸ отложено вместе с мейннетом** (решение владельца 2026-07-04): вся
  разработка M0–M2 идёт на локальной реплике бесплатно. Когда дойдёт до mainnet ICP: ~$25 в
  ICP → циклы (или бесплатный купон DFINITY, Discord #cycles-faucet); freezing threshold =
  пустой баланс замораживает канистру (деньги пользователей НЕ страдают — `resolve_timeout`
  permissionless; но индексация/споры встанут).

## Ключи и внешние сервисы

- **`OPENAI_API_KEY`** — авто-модерация. Нужен API-ключ с дефолтными/unrestricted правами
  (`model.request`); **подписка ChatGPT ≠ доступ к API**. Без ключа: сообщения — локальный
  CSAM-словарь, задания — CLEAR кроме CSAM (fail-open, осознанный dev-размен MOD-2 — закрыть к mainnet).
- **`ANCHOR_SIGNER_KEYPAIR`** — путь к keypair.json (или inline JSON-массив) с devnet-SOL:
  включает пруф-якорь. Не задан → якорь тихо выключен (аддитивная фича).
- **`.treasury-devnet.json`** — ключ devnet-трежери, лежит в репо ПУБЛИЧНО: только devnet.
  В проде `assertMoneyConfig` не даст стартовать с ним (C2 fail-closed).
- **`~/.config/solana/id.json`** — нужен `scripts/escrow-smoke.ts` (+ devnet-SOL на нём);
  это же upgrade authority devnet-программы (`G1vJ…uz14`).

## Проверки перед коммитом

- `npm run typecheck && npm test && npm run lint` — обязательный минимум; `npm run build` — если
  трогал типы/страницы/роуты.
- `npx tsx scripts/verify-export.ts --channel <handle> [--chain]` — независимый пересчёт
  репутации/аттестации/якоря против живого сервера.
- Полный список скриптов — yellow-paper §15.

## Данные на диске

`.data/pg/` — PGlite (вся правда оффчейна; переживает рестарт), `.data/auth.json` — SIWS-сессии,
`.data/store.json` — легаси-снимок (только миграция). Смотрелка БД — `/dev/db` (только оператор,
в проде не существует).
