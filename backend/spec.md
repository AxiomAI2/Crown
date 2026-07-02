# Backend — спецификация (Фаза 2)

Бэкенд появляется **после** готового фронта на моках. Его задача — реализовать тот самый интерфейс
`DataProvider` (`frontend/mock-data.md` §1) по-настоящему: БД, детерминированный движок репутации,
версионирование конфига, модерация, баны/инцидент-лог. Фронт переключается флагом
`NEXT_PUBLIC_DATA_SOURCE=api` и **не меняется**.

В этой фазе деньги ещё не ончейн. Донат можно эмулировать «подтверждённым» на стороне сервиса
(как делал мок), либо подключить devnet раньше — но привязка к реальной цепочке формально в Фазе 3.

---

## 1. Что считается истиной

- **Источник истины репутации — журнал событий** (`LedgerEvent`, append-only). Репутация нигде не
  хранится как «настоящее число»; она **всегда** перевычисляется движком из журнала + конфига.
  Можно кэшировать результат, но кэш — производное, не истина (инвариант детерминированности).
- **Деньги финальны.** Нет таблицы «возвратов», нет статуса доната кроме `final: true`. Единственное
  отрицательное событие — протокольный `DISPUTE_LOST` (проигранный ложный спор); оператор репутацию не
  редактирует (ручного `ADMIN_VOID` больше нет, CR-1).
- **Текст — оффчейн и снимаемый.** Хранится отдельно от финансовой записи; удаление текста не трогает
  `Donation`/`LedgerEvent`.

---

## 2. Хранилище (Postgres)

Таблицы повторяют `docs/data-model.md`. Деньги — `numeric(20,0)` в micro-USDC (или `bigint`), очки — `bigint`.

```
identities        (address PK, level, sns, created_at)
light_profiles    (address PK→identities, display_name, avatar_url, bio, links jsonb)
channels          (id PK, owner_address, payout_address, handle UNIQUE, status,
                   activated_at, config_version, created_at)
channel_configs   (channel_id, version, hash, reputation jsonb, tiers jsonb,
                   min_donation, min_donation_with_text, message_max_len,
                   profanity_policy, name_mode, text_show_mode, overlay jsonb,
                   moderators jsonb, updated_at,  PRIMARY KEY (channel_id, version))
ledger_events     (id PK, donor, creator→channels.id, type, amount, points_delta,
                   config_version, tx_signature NULL, ts)         -- append-only
donations         (id PK, channel_id, donor, amount, fee_amount, net_to_streamer,
                   tx_signature NULL, final bool, ts)
messages          (id PK, donation_id→donations, channel_id, text, lang, state,
                   auto_verdict, content_hash, shown_at, created_at)
channel_blocks    (channel_id, blocked_address, reason, by_moderator, ts,
                   PRIMARY KEY (channel_id, blocked_address))
operator_actions  (id PK, action, target_channel_id, target_address, reason,
                   by_operator, preservation, reported, ts)
incident_logs     (id PK, channel_id, address, kind, detail, resolution, ts)
```

Индексы: `ledger_events(creator, donor)` (свёртка standing), `ledger_events(creator, ts)` (лидерборд),
`messages(channel_id, state)` (очередь модерации), `donations(channel_id, ts)`, `channels(handle)`,
`content_hash` (дедуп карантина).

`config_versions` хранятся **все** — банкинг требует уметь посчитать историческое событие по той
версии, по которой оно забанковано.

---

## 3. Движок репутации (та же чистая функция, что в моке)

> ⚠️ **Заменено ADR 0007:** курс ФИКСИРОВАН `1 USDC = 1 очко`, без кривых/множителей/decay и без
> версионирования/банкинга формулы. Код ниже (curvePoints/bankPoints/decay/config-versioning) —
> исторический; фактическая реализация: `pointsForAmount(amount)=round(usdc×100)` и
> `computePoints(events)=Σ points_delta (≥0)`. Стример настраивает только тиры/пороги.

Один модуль, импортируемый и фронтовым моком (Фаза 1), и бэкендом. Это физически гарантирует
инвариант «детерминирована и перевычислима».

```ts
function curvePoints(amountMicro: bigint, curve: Curve): number {
  switch (curve.kind) {
    case "linear":    return usdc(amountMicro) * curve.pointsPerUSDC;            // дефолт 100
    case "sublinear": return Math.pow(usdc(amountMicro), curve.alpha) * 100;     // amount^α
    case "bracket":   return bracketPoints(usdc(amountMicro), curve.brackets);   // маргинальные ставки
  }
}

function bankPoints(amountMicro: bigint, cfg: ReputationConfig, ctx: BankCtx): number {
  let p = curvePoints(amountMicro, cfg.curve);
  for (const m of cfg.multipliers) if (applies(m, ctx)) p *= m.factor;   // first/streak/event
  return Math.round(p);   // банкуется целым в момент доната
}

// свёртка журнала донора по каналу → текущие очки
function computePoints(events: LedgerEvent[], cfg: ReputationConfig, now: Iso): Points {
  let total = 0;
  for (const e of events) {
    let d = e.pointsDelta;                                  // забанковано в момент события
    if (cfg.decay.enabled) d *= decayFactor(e.ts, now, cfg.decay.halfLifeDays!);
    total += d;                                             // DISPUTE_LOST уже отрицателен
  }
  return Math.max(0, Math.round(total));
}
```

**Банкинг:** при создании `DONATION` сервер считает `pointsDelta = bankPoints(amount, configAtNow)`
и записывает `config_version`. Последующая смена кривой/rate **не** пересчитывает прошлые события.
`computePoints` затем лишь применяет `decay` (если включён) поверх забанкованных дельт.

Тиры/косметика применяются к итоговому числу на чтении (свободно меняются).

---

## 4. Версионирование и хэш конфига

- Любое изменение `reputation` (curve/multipliers/decay) → **новая версия**: `version++`, новая строка
  `channel_configs`, новый `hash = sha256(canonicalJSON(reputation))`. Старые версии остаются.
- Изменение только тиров/цвета/оверлея/модераторов → версия **не** растёт (косметика/презентация).
- `hash` публичен → любой может проверить, по какому конфигу забанкованы события (трастлесс-учёт).

---

## 5. API-поверхность

Один-к-одному с `DataProvider` (§1 `mock-data.md`). Транспорт — REST или tRPC (tRPC удобнее: типы
шарятся с фронтом). Примерное соответствие REST:

```
GET    /session                         getSession
POST   /session/connect                 connect            (Фаза 2: подпись/JWT; Фаза 3: SIWS)
GET    /channels                        listChannels
POST   /channels                        createChannel
GET    /channels/:handle                getChannel
GET    /channels/:id/config             getChannelConfig
PATCH  /channels/:id/config             updateChannelConfig
POST   /channels/:id/activate           activateChannel
GET    /channels/:id/standing/:addr     getStanding
GET    /channels/:id/leaderboard        getLeaderboard?period=
POST   /channels/:id/donations          createDonation
GET    /channels/:id/donations          listDonations
GET    /channels/:id/moderation         getModerationQueue
PATCH  /messages/:id                    setMessageState
GET    /channels/:id/blocklist          getChannelBlocklist
POST   /channels/:id/blocklist          addChannelBlock
DELETE /channels/:id/blocklist/:addr    removeChannelBlock
GET    /ops/queue                       getOperatorQueue
POST   /ops/actions                     applyOperatorAction
GET    /ops/incidents                   getIncidentLog
WS     /channels/:id/overlay            subscribeOverlay   (SSE/WebSocket)
```

**Авторизация:** действия привязаны к адресу (подпись/JWT в Фазе 2, SIWS в Фазе 3). Скоупы: владелец
канала и модераторы → модерация/конфиг своего канала; оператор → `/ops`. Проверять, что вызывающий
имеет право на ресурс (модератор не правит чужой канал, стример не банит платформенно).

---

## 6. Донат-флоу на сервере (Фаза 2)

`createDonation`:
1. Загрузить канал + текущий конфиг. Проверки: канал `ACTIVE` (для текста), сумма ≥ минимума,
   донор не в блок-листе (для текста), длина текста ≤ лимита.
2. Расщепить сумму: `fee = round(amount * 0.03)`, `net = amount - fee` (целое в micro-USDC).
3. Записать `donations` (`final: true`) и `ledger_events` (`DONATION`, `pointsDelta = bankPoints(...)`,
   `config_version`). **Атомарно** (одна транзакция БД).
4. Если есть текст → записать `messages` (`state: HELD`, `content_hash`), запустить модерацию (§7).
5. Пересчитать standing донора (`computePoints`), вернуть `DonationResult` (+ `tierChanged`).

В Фазе 2 «подтверждение» доната — доверенное серверу. В Фазе 3 шаг 3 запускается **индексером** по факту
ончейн-инфлоу в трежери, а не по запросу клиента (см. `crypto/spec.md`).

---

## 7. Модерация (конвейер `docs/core-spec.md` §8; карантин/баны — §9)

```
[ВВОД]   локальный wordlist/regex (по языкам)
  ▼
[ЯЗЫК]   детект языка → словарь + маршрут
  ▼
[АВТО]   OpenAI omni-moderation-latest (бесплатно, мультиязык) [+опц. Azure/Sightengine]
  ▼
[РОУТИНГ] HARD_BLOCK → QUARANTINED + инцидент + (если CSAM) preservation/репорт (§legal)
          FLAG       → HELD, наверх очереди, помечен
          CLEAR      → HELD (ручное «Показать») | авто-SHOWN если textShowMode=auto_if_clean
  ▼
[ЧЕЛОВЕК] стример/модераторы: SHOWN / HIDDEN
  ▼
[ЭСКАЛАЦИЯ] репорт-кнопка зрителей → очередь оператора
```

- **Профанити** не отменяет донат (деньги финальны) — влияет только на показ; политика канала
  (`mask`/`hide`/`queue`).
- **Дедуп по `content_hash`** — повтор берётся из кэша вердикта, без повторного ревью/репорта (флуд
  одинаковым контентом схлопывается в O(1)).
- **Цены инструментов меняются — сверять перед стройкой.** Perspective API не использовать (закрывается).
- Карантинное хранилище — закрытый бакет с retention-политикой (`docs/legal-and-risk.md`).

---

## 8. Баны, инцидент-лог, оператор

- Канальный блок (стример): только в пределах канала — адрес не шлёт донаты-с-текстом сюда.
- Платформенные действия (оператор): лестница `HIDE → CHANNEL_BLOCK → SUSPEND → BAN_CREATOR_ROLE →
  BAN_WALLET_FULL → юр-эскалация`. Каждое → запись `operator_actions` + `incident_logs`.
- `SUSPENDED` (авто, до ревью) ≠ `BANNED` (после T&S). Нужен путь ревью/восстановления (минимальный,
  но обязательный).
- **Оператор репутацию не редактирует** (ручного `ADMIN_VOID` больше нет, CR-1). Наказание нарушителя —
  БЛОК (`BAN_WALLET_FULL`/`CHANNEL_BLOCK`): вся ценность репутации обнуляется (не голосует/не спорит/не
  донатит-с-текстом), но само число остаётся честной свёрткой журнала (§4.4). Единственное списание очков —
  протокольный `DISPUTE_LOST` (игра escrow-task), не операторская кнопка.
- Бан канала: убрать из дискавери/лидербордов, отклонять новые текст-донаты, выключить оверлей,
  скрыть отображение репутации, блок-лист роли, инцидент-лог + preservation/репорт если применимо.

---

## 9. Анти-флуд

Реализуется здесь (калибруется на тестнете, `docs/core-spec.md` §9 и §12):
- сбор активации (~$2) как якорь против цикла «бан → пересоздание»;
- rate-limit (токен-бакет) на текст-донаты с адреса/на канал;
- дедуп по `content_hash`;
- «нет публичной индексации для свежих каналов» уже даёт двухуровневая модель канала.

---

## 10. `ApiDataProvider` (фронт)

Тонкая реализация интерфейса §1 поверх HTTP/tRPC-клиента. Маппит методы на эндпойнты §5,
парсит в те же типы `docs/data-model.md`. Никакой бизнес-логики на клиенте — она вся на сервере и
в общем движке репутации. После готовности — флаг `NEXT_PUBLIC_DATA_SOURCE=api`, прогнать те же
`user-flows.md`, что и на моке: поведение экранов идентично.

---

## Критерии готовности Фазы 2

- Все методы `DataProvider` реализованы сервером; фронт работает на `api` без правок экранов.
- `computePoints` импортируется из общего модуля; цифры мок == API на одинаковых данных.
- Банкинг и версионирование конфига работают (смена кривой не трогает прошлое).
- Модерационный конвейер проходит текст до состояния; дедуп и карантин работают.
- Лестница наказаний и инцидент-лог функциональны; `SUSPENDED`/`BANNED` различимы; есть путь ревью.
