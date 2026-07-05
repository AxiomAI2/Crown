//! Состояние core-канистры (M0): конфиг, журнал, курсор — всё в stable memory
//! (переживает апгрейды; архитектура §3.1-2). Журнал append-only: канистра пересобирает
//! его из ПЕРВОИСТОЧНИКА (транзакции трежери-ATA на Solana), а не из экспорта сервера.

use candid::{CandidType, Decode, Encode};
use ic_stable_structures::memory_manager::{MemoryId, MemoryManager, VirtualMemory};
use ic_stable_structures::storable::Bound;
use ic_stable_structures::{DefaultMemoryImpl, StableBTreeMap, StableCell, StableLog, Storable};
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::cell::RefCell;

pub type Mem = VirtualMemory<DefaultMemoryImpl>;

/// Init-конфиг канистры (candid-аргумент деплоя). Хранится в stable cell.
#[derive(CandidType, Deserialize, Serialize, Clone, Debug, Default)]
pub struct Config {
    /// JSON-RPC эндпоинт Solana. M0-local: прямые HTTPS-outcalls (одиночная реплика — консенсус
    /// не нужен); M0-live на mainnet ICP: заменить транспорт на SOL RPC canister (3-из-N провайдеров).
    pub rpc_url: String,
    /// ATA трежери — единственный адрес, за которым наблюдаем (как серверный индексер).
    pub treasury_ata: String,
    /// mint USDC (devnet) — фильтр ног transferChecked.
    pub usdc_mint: String,
    /// Период опроса цепи таймером, сек.
    pub poll_secs: u64,
    /// Имя тресхолд-ключа schnorr: локальная реплика — "dfx_test_key" (дефолт при None);
    /// mainnet ICP — "key_1" (гейт M5). Опционально — старые stable-байты декодятся в None.
    pub schnorr_key_name: Option<String>,
    /// Program id эскроу-программы (M2): арбитр принимает споры только по аккаунтам,
    /// которыми владеет ОНА (иначе подделка эскроу-данных тривиальна). None = споры выключены.
    pub escrow_program: Option<String>,
}

/// Тип записи журнала. M0: ядро-донаты и активации из цепочки. M2: исходы споров пишет
/// арбитр-модуль канистры (arbiter.rs) — GameDonation (донат дошёл стримеру через эскроу),
/// DisputeWon/DisputeLost (±эффекты инициатору). Их подписи синтетические (`dispute:<id>:…`).
#[derive(CandidType, Deserialize, Serialize, Clone, Debug, PartialEq, Eq)]
pub enum EntryKind {
    Donation,
    Activation,
    GameDonation,
    DisputeWon,
    DisputeLost,
}

/// Запись журнала — реконструкция из ончейн-транзакции (порт server ingest, без текстов:
/// канистра хранит только хэш msg_ref, приватное не заезжает никогда — §3.1-7).
#[derive(CandidType, Deserialize, Serialize, Clone, Debug)]
pub struct JournalEntry {
    pub seq: u64,
    pub kind: EntryKind,
    pub signature: String,
    /// channelId из memo (`c` доната / `act` активации).
    pub channel_id: String,
    /// Донор (authority ног) / плательщик активации.
    pub actor: String,
    /// Полная сумма micro-USDC (донат: нетто+комиссия; активация: перевод в трежери).
    pub amount_micro: u64,
    pub fee_micro: u64,
    pub net_micro: u64,
    /// Дельта репутации в micro-очках СО ЗНАКОМ: донат = amount_micro 1:1 (ADR 0007),
    /// активация = 0, DisputeLost — отрицательная (единственный протокольный минус, §4.5).
    pub points_delta_micro: i64,
    /// memo.d доната (для сверки с серверным журналом).
    pub donation_id: Option<String>,
    /// memo.m — хэш текста (сам текст — кожа, в канистре его нет).
    pub msg_ref: Option<String>,
    pub block_time: Option<i64>,
}

fn candid_bytes<T: CandidType>(v: &T) -> Cow<'_, [u8]> {
    Cow::Owned(Encode!(v).expect("candid encode"))
}

impl Storable for Config {
    fn to_bytes(&self) -> Cow<'_, [u8]> {
        candid_bytes(self)
    }
    fn into_bytes(self) -> Vec<u8> {
        Encode!(&self).expect("candid encode")
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        Decode!(&bytes, Self).expect("candid decode Config")
    }
    const BOUND: Bound = Bound::Unbounded;
}

impl Storable for JournalEntry {
    fn to_bytes(&self) -> Cow<'_, [u8]> {
        candid_bytes(self)
    }
    fn into_bytes(self) -> Vec<u8> {
        Encode!(&self).expect("candid encode")
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        Decode!(&bytes, Self).expect("candid decode JournalEntry")
    }
    const BOUND: Bound = Bound::Unbounded;
}

/// Виртуальная память по id — для стейта других модулей (governance и далее).
/// Занято: 0 config, 1 cursor, 2/3 journal, 4 seen, 5 dispute-params.
pub fn memory(id: u8) -> Mem {
    MM.with(|m| m.borrow().get(MemoryId::new(id)))
}

thread_local! {
    static MM: RefCell<MemoryManager<DefaultMemoryImpl>> =
        RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));

    static CONFIG: RefCell<StableCell<Config, Mem>> = RefCell::new(StableCell::init(
        MM.with(|m| m.borrow().get(MemoryId::new(0))),
        Config::default(),
    ));

    /// Курсор индексера — подпись НОВЕЙШЕЙ обработанной транзакции (пусто = бэкфилл не начат).
    static CURSOR: RefCell<StableCell<String, Mem>> = RefCell::new(StableCell::init(
        MM.with(|m| m.borrow().get(MemoryId::new(1))),
        String::new(),
    ));

    static JOURNAL: RefCell<StableLog<JournalEntry, Mem, Mem>> = RefCell::new(StableLog::init(
        MM.with(|m| m.borrow().get(MemoryId::new(2))),
        MM.with(|m| m.borrow().get(MemoryId::new(3))),
    ));

    /// Дедуп: подпись → seq (идемпотентность приёма, как серверный `runSerialized`+find).
    static SEEN: RefCell<StableBTreeMap<String, u64, Mem>> = RefCell::new(StableBTreeMap::init(
        MM.with(|m| m.borrow().get(MemoryId::new(4))),
    ));

    /// Диагностика последних опросов (НЕ stable — обнуляется апгрейдом, это ок).
    pub static STATUS: RefCell<RuntimeStatus> = RefCell::new(RuntimeStatus::default());
}

#[derive(CandidType, Serialize, Clone, Debug, Default)]
pub struct RuntimeStatus {
    pub polls: u64,
    pub last_poll_start_ns: u64,
    pub last_poll_ok_ns: u64,
    pub last_batch_appended: u64,
    pub last_error: Option<String>,
    /// getTransaction вернул null (за пределами retention RPC) — журнал в этом месте неполон.
    pub tx_unavailable: u64,
    pub polling: bool,
    /// Подпись последней ТЕСТОВОЙ memo-транзакции тресхолд-адреса (M0-светофор контура подписи).
    pub last_test_tx: Option<String>,
}

// ─────────── аккуратные аксессоры (единственная дверь к thread_local) ───────────

pub fn config() -> Config {
    CONFIG.with(|c| c.borrow().get().clone())
}

pub fn set_config(cfg: Config) {
    CONFIG.with(|c| {
        c.borrow_mut().set(cfg);
    });
}

pub fn cursor() -> Option<String> {
    CURSOR.with(|c| {
        let v = c.borrow().get().clone();
        if v.is_empty() {
            None
        } else {
            Some(v)
        }
    })
}

pub fn set_cursor(sig: &str) {
    CURSOR.with(|c| {
        c.borrow_mut().set(sig.to_string());
    });
}

pub fn journal_len() -> u64 {
    JOURNAL.with(|j| j.borrow().len())
}

pub fn journal_get(idx: u64) -> Option<JournalEntry> {
    JOURNAL.with(|j| j.borrow().get(idx))
}

pub fn journal_append(mut entry: JournalEntry) -> u64 {
    JOURNAL.with(|j| {
        let log = j.borrow_mut();
        entry.seq = log.len();
        let seq = entry.seq;
        log.append(&entry).expect("journal append");
        SEEN.with(|s| s.borrow_mut().insert(entry.signature.clone(), seq));
        seq
    })
}

pub fn seen(signature: &str) -> bool {
    SEEN.with(|s| s.borrow().contains_key(&signature.to_string()))
}
