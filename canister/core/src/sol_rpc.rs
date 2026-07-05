//! Solana JSON-RPC через HTTPS-outcalls (M0-local: прямой RPC-эндпоинт).
//!
//! ⚠️ Транспортный шов (архитектура §3.1-1): на mainnet ICP прямые outcalls к одному провайдеру
//! не дают консенсуса 3-из-N — там этот модуль обязан ходить через SOL RPC canister
//! (`jsonRequest` с тем же payload'ом; разбор ответов НЕ меняется). Локальная реплика —
//! одиночный узел, прямой вызов честен и бесплатен.

use candid::Principal;
use ic_cdk::call::Call;
use ic_management_canister_types::{
    HttpHeader, HttpMethod, HttpRequestArgs, HttpRequestResult, TransformContext, TransformFunc,
};
use serde_json::{json, Value};

/// Потолки ответов (влияют на цену циклов outcall'а — держим минимально достаточными):
/// страница подписей ~250 Б/шт ×500 + обвязка; jsonParsed-донат ~7 КБ, эскроу-tx крупнее.
const MAX_SIG_PAGE_BYTES: u64 = 256 * 1024;
const MAX_TX_BYTES: u64 = 256 * 1024;

/// Страница пагинации подписей (лимит Solana RPC — 1000).
pub const SIG_PAGE_LIMIT: u32 = 500;

async fn rpc(url: &str, method: &str, params: Value, max_bytes: u64) -> Result<Value, String> {
    let body = serde_json::to_vec(&json!({
        "jsonrpc": "2.0", "id": 1, "method": method, "params": params
    }))
    .map_err(|e| format!("encode: {e}"))?;

    let args = HttpRequestArgs {
        url: url.to_string(),
        max_response_bytes: Some(max_bytes),
        method: HttpMethod::POST,
        headers: vec![HttpHeader {
            name: "Content-Type".into(),
            value: "application/json".into(),
        }],
        body: Some(body.clone()),
        // Транформ срезает заголовки/статус до тела: на mainnet все реплики должны увидеть
        // байт-в-байт одно и то же, иначе консенсус outcall'а не сойдётся.
        transform: Some(TransformContext {
            function: TransformFunc(candid::Func {
                principal: ic_cdk::api::canister_self(),
                method: "transform_http".into(),
            }),
            context: vec![],
        }),
        is_replicated: None,
    };

    let cycles = ic_cdk::api::cost_http_request(
        (body.len() + url.len() + 512) as u64, // запрос + заголовки с запасом
        max_bytes,
    );
    let resp = Call::unbounded_wait(Principal::management_canister(), "http_request")
        .with_arg(&args)
        .with_cycles(cycles)
        .await
        .map_err(|e| format!("outcall {method}: {e:?}"))?;
    let out: HttpRequestResult = resp
        .candid()
        .map_err(|e| format!("outcall decode {method}: {e:?}"))?;

    let v: Value = serde_json::from_slice(&out.body)
        .map_err(|e| format!("{method}: body not JSON ({e})"))?;
    if let Some(err) = v.get("error") {
        if !err.is_null() {
            return Err(format!("{method}: rpc error {err}"));
        }
    }
    Ok(v.get("result").cloned().unwrap_or(Value::Null))
}

#[derive(Debug, Clone)]
pub struct SigInfo {
    pub signature: String,
    pub err: bool,
    pub block_time: Option<i64>,
}

/// `getSignaturesForAddress` (finalized): новые → старые, с пагинацией before/until.
pub async fn get_signatures_page(
    url: &str,
    address: &str,
    before: Option<&str>,
    until: Option<&str>,
    limit: u32,
) -> Result<Vec<SigInfo>, String> {
    let mut opts = json!({ "limit": limit, "commitment": "finalized" });
    if let Some(b) = before {
        opts["before"] = json!(b);
    }
    if let Some(u) = until {
        opts["until"] = json!(u);
    }
    let res = rpc(url, "getSignaturesForAddress", json!([address, opts]), MAX_SIG_PAGE_BYTES).await?;
    let arr = res.as_array().ok_or("getSignaturesForAddress: not an array")?;
    Ok(arr
        .iter()
        .map(|s| SigInfo {
            signature: s["signature"].as_str().unwrap_or_default().to_string(),
            err: !s["err"].is_null(),
            block_time: s["blockTime"].as_i64(),
        })
        .filter(|s| !s.signature.is_empty())
        .collect())
}

/// ВСЕ подписи от `until` (не включая) до новейшей, старые → новые. `until=None` = полный бэкфилл
/// (канистра пересобирает журнал из первоисточника — принцип непрерывности §9).
pub async fn get_signatures_since(
    url: &str,
    address: &str,
    until: Option<&str>,
) -> Result<Vec<SigInfo>, String> {
    let mut pages: Vec<Vec<SigInfo>> = Vec::new();
    let mut before: Option<String> = None;
    // Потолок страниц — защита от бесконечного цикла при сбоящем RPC (25k подписей хватит на годы).
    for _ in 0..50 {
        let page =
            get_signatures_page(url, address, before.as_deref(), until, SIG_PAGE_LIMIT).await?;
        let full = page.len() as u32 == SIG_PAGE_LIMIT;
        before = page.last().map(|s| s.signature.clone());
        pages.push(page);
        if !full {
            break;
        }
    }
    // новые→старые постранично ⇒ разворачиваем всё в старые→новые
    Ok(pages.into_iter().flatten().rev().collect())
}

/// Инфо аккаунта (finalized): владелец-программа + данные base64. None = аккаунта нет.
pub struct AccountInfo {
    pub owner: String,
    pub data_base64: String,
}

pub async fn get_account_info(url: &str, pubkey: &str) -> Result<Option<AccountInfo>, String> {
    let res = rpc(
        url,
        "getAccountInfo",
        json!([pubkey, { "encoding": "base64", "commitment": "finalized" }]),
        16 * 1024,
    )
    .await?;
    let value = &res["value"];
    if value.is_null() {
        return Ok(None);
    }
    Ok(Some(AccountInfo {
        owner: value["owner"].as_str().unwrap_or_default().to_string(),
        data_base64: value["data"][0].as_str().unwrap_or_default().to_string(),
    }))
}

/// `getLatestBlockhash` (finalized) → base58-blockhash для сборки исходящей транзакции.
pub async fn get_latest_blockhash(url: &str) -> Result<String, String> {
    let res = rpc(
        url,
        "getLatestBlockhash",
        json!([{ "commitment": "finalized" }]),
        16 * 1024,
    )
    .await?;
    res["value"]["blockhash"]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| "getLatestBlockhash: нет value.blockhash".into())
}

/// `sendTransaction` (base64) → подпись отправленной транзакции.
pub async fn send_transaction(url: &str, tx_base64: &str) -> Result<String, String> {
    let res = rpc(
        url,
        "sendTransaction",
        json!([tx_base64, { "encoding": "base64", "preflightCommitment": "confirmed" }]),
        16 * 1024,
    )
    .await?;
    res.as_str()
        .map(str::to_string)
        .ok_or_else(|| "sendTransaction: ответ не строка".into())
}

/// `getTransaction` (jsonParsed, finalized) — тот же формат, что у серверного индексера и в
/// golden-векторах. `None` = RPC больше не отдаёт tx (за retention) — честно считаем дырой.
pub async fn get_transaction_parsed(url: &str, signature: &str) -> Result<Option<Value>, String> {
    let res = rpc(
        url,
        "getTransaction",
        json!([signature, {
            "encoding": "jsonParsed",
            "commitment": "finalized",
            "maxSupportedTransactionVersion": 0
        }]),
        MAX_TX_BYTES,
    )
    .await?;
    Ok(if res.is_null() { None } else { Some(res) })
}
