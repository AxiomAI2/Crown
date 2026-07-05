//! Порт `src/lib/chain/indexer.ts` — чистый разбор донат-/активационных транзакций
//! (golden-паритет: testdata/golden/donations.json).
//!
//! Вход — тот же JSON-срез `ParsedTransactionWithMeta`, который отдаёт Solana RPC c
//! `jsonParsed`-энкодингом (и который зафиксирован в golden-векторах): читаются только
//! `blockTime`, `meta.err` и `transaction.message.instructions[].{program,parsed}`.
//! M0 подключит сюда SOL RPC canister; сам разбор от транспорта не зависит.
//!
//! Семантика 1:1 с TS, включая тонкости:
//!  - донат: memo ПЕРЕЗАПИСЫВАЕТСЯ каждым spl-memo (невалидный после валидного → отказ);
//!  - активация: невалидный memo НЕ сбрасывает найденный (`?? act`);
//!  - битая строка суммы — паника (в TS BigInt(...) бросает), а не «тихий null».

use serde::Deserialize;
use serde_json::{json, Value};

/// Комиссия площадки: 3% (basis points). Единый источник в TS — `splitAmount` (addresses.ts).
pub const FEE_BPS: u128 = 300;
const BPS_DENOM: u128 = 10_000;

/// Целочисленное расщепление доната: fee = floor(amount·FEE_BPS/10000), net = остаток.
pub fn split_amount(amount_micro: u128) -> (u128, u128) {
    let fee = amount_micro * FEE_BPS / BPS_DENOM;
    (fee, amount_micro - fee)
}

// ─────────────── входной срез ParsedTransactionWithMeta ───────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedTx {
    #[serde(default)]
    pub block_time: Option<i64>,
    #[serde(default)]
    pub meta: Option<TxMeta>,
    pub transaction: TxBody,
}

#[derive(Debug, Deserialize)]
pub struct TxMeta {
    /// null → None (serde), любой объект/строка → Some = транзакция упала.
    #[serde(default)]
    pub err: Option<Value>,
}

#[derive(Debug, Deserialize)]
pub struct TxBody {
    pub message: TxMessage,
}

#[derive(Debug, Deserialize)]
pub struct TxMessage {
    pub instructions: Vec<Instruction>,
}

/// Инструкция: parsed-вариант несёт `program`+`parsed`; PartiallyDecoded (без `parsed`) игнорируется.
#[derive(Debug, Deserialize)]
pub struct Instruction {
    #[serde(default)]
    pub program: Option<String>,
    #[serde(default)]
    pub parsed: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct SplTransferParsed {
    #[serde(rename = "type")]
    kind: String,
    info: SplTransferInfo,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SplTransferInfo {
    authority: String,
    destination: String,
    mint: String,
    token_amount: TokenAmount,
}

#[derive(Debug, Deserialize)]
struct TokenAmount {
    amount: String,
}

// ─────────────── результаты разбора ───────────────

/// memo-атрибуция доната `{c,d,m}` (docs/yellow-paper.md §5.1).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemoAttribution {
    pub c: String,
    pub d: String,
    pub m: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexedDonation {
    pub signature: String,
    pub donor: String,
    pub amount_micro: u128,
    pub fee_micro: u128,
    pub net_micro: u128,
    pub streamer_ata: String,
    pub memo: MemoAttribution,
    pub block_time: Option<i64>,
}

impl IndexedDonation {
    /// JSON в форме TS-`IndexedDonation` (деньги — десятичными строками) — для golden-сверки и экспорта.
    pub fn to_json(&self) -> Value {
        json!({
            "signature": self.signature,
            "donor": self.donor,
            "amountMicro": self.amount_micro.to_string(),
            "feeMicro": self.fee_micro.to_string(),
            "netMicro": self.net_micro.to_string(),
            "streamerAta": self.streamer_ata,
            "memo": { "c": self.memo.c, "d": self.memo.d, "m": self.memo.m },
            "blockTime": self.block_time,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexedActivation {
    pub signature: String,
    pub payer: String,
    pub amount_micro: u128,
    pub channel_id: String,
    pub block_time: Option<i64>,
}

impl IndexedActivation {
    pub fn to_json(&self) -> Value {
        json!({
            "signature": self.signature,
            "payer": self.payer,
            "amountMicro": self.amount_micro.to_string(),
            "channelId": self.channel_id,
            "blockTime": self.block_time,
        })
    }
}

// ─────────────── memo-декодеры (порт memo.ts) ───────────────

/// Порт `decodeMemo`: JSON с обязательными строками `c`,`d`; `m` — строка или null.
pub fn decode_memo(raw: &str) -> Option<MemoAttribution> {
    let v: Value = serde_json::from_str(raw).ok()?;
    let c = v.get("c")?.as_str()?.to_string();
    let d = v.get("d")?.as_str()?.to_string();
    let m = v.get("m").and_then(Value::as_str).map(str::to_string);
    Some(MemoAttribution { c, d, m })
}

/// Порт `decodeActivationMemo`: JSON `{act: string}`.
pub fn decode_activation_memo(raw: &str) -> Option<String> {
    let v: Value = serde_json::from_str(raw).ok()?;
    Some(v.get("act")?.as_str()?.to_string())
}

// ─────────────── разбор транзакций ───────────────

struct TransferLeg {
    dest: String,
    amount: u128,
    authority: String,
}

fn failed(tx: &ParsedTx) -> bool {
    tx.meta.as_ref().is_some_and(|m| m.err.is_some())
}

/// Ноги transferChecked нужного mint (прочие инструкции/минты/типы игнорируются, как в TS).
fn collect_transfers(tx: &ParsedTx, mint: &str) -> Vec<TransferLeg> {
    let mut out = Vec::new();
    for ix in &tx.transaction.message.instructions {
        if ix.program.as_deref() != Some("spl-token") {
            continue;
        }
        let Some(parsed) = &ix.parsed else { continue };
        let Ok(t) = serde_json::from_value::<SplTransferParsed>(parsed.clone()) else {
            continue;
        };
        if t.kind != "transferChecked" || t.info.mint != mint {
            continue;
        }
        out.push(TransferLeg {
            dest: t.info.destination,
            // Паритет с TS: BigInt(amount) на битой строке бросает — здесь то же (panic/trap).
            amount: t.info.token_amount.amount.parse().expect("bad token amount"),
            authority: t.info.authority,
        });
    }
    out
}

fn memo_instructions<'a>(tx: &'a ParsedTx) -> impl Iterator<Item = &'a str> {
    tx.transaction.message.instructions.iter().filter_map(|ix| {
        if ix.program.as_deref() == Some("spl-memo") {
            ix.parsed.as_ref().and_then(Value::as_str)
        } else {
            None
        }
    })
}

/// Порт `extractDonation`: ровно две ноги нужного mint (нетто + комиссия в трежери) от одного
/// donor + memo `{c,d}`; самоконтроль расщепления 97/3 — иначе это сырой перевод, не донат.
pub fn extract_donation(
    tx: Option<&ParsedTx>,
    signature: &str,
    mint: &str,
    treasury_ata: &str,
) -> Option<IndexedDonation> {
    let tx = tx?;
    if failed(tx) {
        return None;
    }

    // Как в TS: memo перезаписывается КАЖДОЙ spl-memo-инструкцией (в т.ч. невалидной → None).
    let mut memo: Option<MemoAttribution> = None;
    for raw in memo_instructions(tx) {
        memo = decode_memo(raw);
    }
    let transfers = collect_transfers(tx, mint);

    if transfers.len() != 2 {
        return None;
    }
    let memo = memo?;
    let fee_leg = transfers.iter().find(|t| t.dest == treasury_ata)?;
    let net_leg = transfers.iter().find(|t| t.dest != treasury_ata)?;
    if fee_leg.authority != net_leg.authority {
        return None;
    }

    let amount = fee_leg.amount + net_leg.amount;
    let (fee, net) = split_amount(amount);
    if fee != fee_leg.amount || net != net_leg.amount {
        return None;
    }

    Some(IndexedDonation {
        signature: signature.to_string(),
        donor: net_leg.authority.clone(),
        amount_micro: amount,
        fee_micro: fee_leg.amount,
        net_micro: net_leg.amount,
        streamer_ata: net_leg.dest.clone(),
        memo,
        block_time: tx.block_time,
    })
}

/// Порт `extractActivation`: ровно одна нога нужного mint → в трежери + memo `{act}`.
/// Сумму НЕ валидирует (порог ACTIVATION_FEE — забота ingest, как в TS).
pub fn extract_activation(
    tx: Option<&ParsedTx>,
    signature: &str,
    mint: &str,
    treasury_ata: &str,
) -> Option<IndexedActivation> {
    let tx = tx?;
    if failed(tx) {
        return None;
    }

    // Как в TS (`?? act`): невалидный memo НЕ сбрасывает уже найденный канал.
    let mut act: Option<String> = None;
    for raw in memo_instructions(tx) {
        act = decode_activation_memo(raw).or(act);
    }
    let transfers = collect_transfers(tx, mint);

    if transfers.len() != 1 {
        return None;
    }
    let act = act?;
    let leg = &transfers[0];
    if leg.dest != treasury_ata {
        return None;
    }
    Some(IndexedActivation {
        signature: signature.to_string(),
        payer: leg.authority.clone(),
        amount_micro: leg.amount,
        channel_id: act,
        block_time: tx.block_time,
    })
}
