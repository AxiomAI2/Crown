//! core-канистра «Standing» — кость №2 (архитектура v3, ADR 0021; docs/canister-architecture.md).
//!
//! M0 «канистра-наблюдатель» (docs/migration-plan.md §2): таймер опрашивает Solana devnet,
//! разбирает донаты/активации трежери golden-проверенным портом (donation.rs), ведёт журнал
//! в stable memory и отдаёт репутацию query-вызовами + JSON-экспорт по HTTP (/export).
//! Канистра НИЧЕГО не решает: сервер работает как раньше, ревизор `verify-export --canister`
//! сверяет три источника (Solana ↔ канистра ↔ сервер). Откат = выключить канистру.
//!
//! Инварианты слоёв: никаких текстов (только хэши, §3.1-7), донат-путь не трогаем (кость №1).
//! Дальше: M0-live (mainnet ICP: SOL RPC canister + тресхолд-Ed25519), M2 — споры (disputes.rs).

pub mod arbiter;

/// Тестовые фикстуры кросс-языковых пинов (testdata/golden — порождает `npm run golden`).
#[cfg(test)]
pub mod test_fixtures {
    pub fn canonical_message(key: &str) -> String {
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../testdata/golden/messages.json");
        let raw = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("нет {} ({e}) — сначала `npm run golden`", path.display()));
        let v: serde_json::Value = serde_json::from_str(&raw).expect("messages.json не парсится");
        v[key].as_str().unwrap_or_else(|| panic!("нет ключа {key}")).to_string()
    }
}
pub mod disputes;
pub mod donation;
pub mod governance;
pub mod http;
pub mod indexer;
pub mod reputation;
pub mod signer;
pub mod sol_rpc;
pub mod sol_tx;
pub mod state;

use candid::CandidType;
use ic_management_canister_types::{HttpRequestResult, TransformArgs};
use serde::Serialize;
use state::{Config, JournalEntry};
use std::time::Duration;

fn schedule_polling() {
    let secs = state::config().poll_secs.max(5);
    // Первый тик почти сразу (бэкфилл), дальше — интервалом. Таймеры не переживают
    // апгрейд — post_upgrade обязан перезаводить (операционная шишка ICP).
    ic_cdk_timers::set_timer(Duration::from_secs(2), indexer::poll());
    ic_cdk_timers::set_timer_interval(Duration::from_secs(secs), || indexer::poll());
}

#[ic_cdk::init]
fn init(cfg: Config) {
    state::set_config(cfg);
    schedule_polling();
}

#[ic_cdk::post_upgrade]
fn post_upgrade() {
    schedule_polling();
}

/// Версия сборки — светофор «канистра жива» (сверяется с ADR-логом апгрейдов при деплое).
#[ic_cdk::query]
fn version() -> String {
    format!("standing-core {} (M0 observer)", env!("CARGO_PKG_VERSION"))
}

#[derive(CandidType, Serialize)]
struct Status {
    journal_len: u64,
    cursor: Option<String>,
    polls: u64,
    last_batch_appended: u64,
    last_error: Option<String>,
    tx_unavailable: u64,
    last_poll_ok_ns: u64,
    last_test_tx: Option<String>,
    config: Config,
}

#[ic_cdk::query]
fn status() -> Status {
    let st = state::STATUS.with(|s| s.borrow().clone());
    Status {
        journal_len: state::journal_len(),
        cursor: state::cursor(),
        polls: st.polls,
        last_batch_appended: st.last_batch_appended,
        last_error: st.last_error,
        tx_unavailable: st.tx_unavailable,
        last_poll_ok_ns: st.last_poll_ok_ns,
        last_test_tx: st.last_test_tx,
        config: state::config(),
    }
}

// ─────────── тресхолд-Ed25519 (M0: контур будущего резолвера M2) ───────────

/// Solana-адрес канистры (тресхолд-пабкей). Update-вызов: под капотом management-канистра.
#[ic_cdk::update]
async fn solana_address() -> Result<String, String> {
    signer::solana_address().await
}

/// M0-светофор: живая memo-транзакция в devnet от тресхолд-адреса. Только контроллеры —
/// это тестовый рычаг (циклы + внешние вызовы), журнал/истину он не трогает.
#[ic_cdk::update]
async fn test_sign_and_send(memo: String) -> Result<String, String> {
    if !ic_cdk::api::is_controller(&ic_cdk::api::msg_caller()) {
        return Err("только контроллер канистры".into());
    }
    signer::test_sign_and_send(memo).await
}

/// Перевод SOL с тресхолд-адреса (газовые деньги резолвера; деньги пользователей тут не ходят).
/// Только контроллеры.
#[ic_cdk::update]
async fn withdraw_sol(to: String, lamports: u64) -> Result<String, String> {
    if !ic_cdk::api::is_controller(&ic_cdk::api::msg_caller()) {
        return Err("только контроллер канистры".into());
    }
    signer::send_sol(&to, lamports).await
}

/// Репутация донора на канале в micro-очках: свёртка журнала на лету (§4.4 — журнал
/// единственный источник, никакого хранимого «числа»). Масштабы M0 — сотни записей.
#[ic_cdk::query]
fn standing(channel_id: String, address: String) -> u64 {
    fold_donations(&channel_id)
        .into_iter()
        .filter(|(addr, _)| *addr == address)
        .map(|(_, micro)| micro)
        .next()
        .unwrap_or(0)
}

/// Лидерборд канала: адрес → micro-очки, по убыванию.
#[ic_cdk::query]
fn leaderboard(channel_id: String, limit: u32) -> Vec<(String, u64)> {
    let mut rows = fold_donations(&channel_id);
    rows.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    rows.truncate(limit.min(1000) as usize);
    rows
}

fn fold_donations(channel_id: &str) -> Vec<(String, u64)> {
    // С M2 в журнале есть спор-эффекты со знаком: сумма знаковая, кламп ≥0 ОДИН раз в конце
    // (та же семантика, что computePoints §4.4).
    let mut acc: std::collections::BTreeMap<String, i128> = Default::default();
    for i in 0..state::journal_len() {
        let Some(e) = state::journal_get(i) else { continue };
        if e.kind != state::EntryKind::Activation && e.channel_id == channel_id {
            *acc.entry(e.actor).or_default() += e.points_delta_micro as i128;
        }
    }
    acc.into_iter().map(|(a, micro)| (a, micro.max(0) as u64)).collect()
}

#[ic_cdk::query]
fn journal(offset: u64, limit: u32) -> Vec<JournalEntry> {
    let len = state::journal_len();
    (offset..len.min(offset + limit.min(1000) as u64))
        .filter_map(state::journal_get)
        .collect()
}

#[ic_cdk::query]
fn journal_len() -> u64 {
    state::journal_len()
}

/// Публичный HTTP-экспорт через шлюз ICP: /export, /standing, /leaderboard, /dispute-params, /status.
#[ic_cdk::query]
fn http_request(req: http::HttpRequest) -> http::HttpResponse {
    http::handle(req)
}

/// UPDATE-путь HTTP-шлюза: записи подписями кошельков — governance-параметры
/// (/dispute-params), открытие спора (/dispute/open), голос (/dispute/vote).
/// Авторизация — НЕ caller, а ed25519-подпись в теле (governance.rs / arbiter.rs).
#[ic_cdk::update]
async fn http_request_update(req: http::HttpRequest) -> http::HttpResponse {
    http::handle_update(req).await
}

/// Governance-параметры споров канала: (effective на сейчас, полное состояние).
#[ic_cdk::query]
fn dispute_params(channel_id: String) -> (governance::DisputeParams, governance::ChannelParamsState) {
    governance::effective_params(&channel_id, ic_cdk::api::time())
}

/// Транформ HTTPS-outcall'ов: реплики подсети должны сойтись на байт-в-байт ответе,
/// поэтому срезаем недетерминированное (заголовки), оставляя только тело и статус.
#[ic_cdk::query]
fn transform_http(args: TransformArgs) -> HttpRequestResult {
    HttpRequestResult {
        status: args.response.status,
        headers: vec![],
        body: args.response.body,
    }
}
