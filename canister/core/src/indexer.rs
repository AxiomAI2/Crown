//! Индексер-наблюдатель (M0): таймер → Solana RPC → разбор донатов/активаций тем же
//! golden-проверенным портом (donation.rs) → журнал в stable memory.
//!
//! Дисциплина как у серверного индексера: только finalized, только пара 97/3 + memo
//! (иное — не наша транзакция, пропуск), идемпотентность по подписи, курсор двигается
//! ПО КАЖДОЙ обработанной подписи (обрыв посреди пачки безопасен — продолжим с места).

use crate::donation::{extract_activation, extract_donation, ParsedTx};
use crate::sol_rpc::{get_signatures_since, get_transaction_parsed};
use crate::state::{self, Config, EntryKind, JournalEntry};

/// Один тик опроса. Reentrancy-guard: тик может занять дольше интервала таймера
/// (бэкфилл, медленный RPC) — параллельные тики недопустимы (сломают курсор).
pub async fn poll() {
    let already = state::STATUS.with(|s| {
        let mut st = s.borrow_mut();
        if st.polling {
            return true;
        }
        st.polling = true;
        st.polls += 1;
        st.last_poll_start_ns = ic_cdk::api::time();
        false
    });
    if already {
        return;
    }

    let result = run_poll().await;

    // Хозработа губернанса: дозревшие по таймлоку параметры каналов становятся действующими.
    crate::governance::promote_due(ic_cdk::api::time());
    // Арбитр: споры с истёкшим голосованием финализируются (вердикт + журнал-эффекты),
    // затем ретраятся ончейн-отправки (mark_disputed / resolve_dispute тресхолд-подписью).
    crate::arbiter::finalize_due((ic_cdk::api::time() / 1_000_000) as i64);
    crate::arbiter::send_pending_txs().await;

    state::STATUS.with(|s| {
        let mut st = s.borrow_mut();
        st.polling = false;
        match result {
            Ok(appended) => {
                st.last_batch_appended = appended;
                st.last_error = None;
                st.last_poll_ok_ns = ic_cdk::api::time();
            }
            Err(e) => st.last_error = Some(e),
        }
    });
}

async fn run_poll() -> Result<u64, String> {
    let cfg = state::config();
    if cfg.rpc_url.is_empty() || cfg.treasury_ata.is_empty() {
        return Err("канистра не сконфигурирована (init-аргумент)".into());
    }

    let cursor = state::cursor();
    // Пусто = первый запуск: полный бэкфилл истории трежери (журнал из первоисточника).
    let sigs = get_signatures_since(&cfg.rpc_url, &cfg.treasury_ata, cursor.as_deref()).await?;

    let mut appended = 0u64;
    for sig in &sigs {
        // Упавшие транзакции журнал не трогают, но курсор двигают (как фильтр !err сервера).
        if !sig.err && !state::seen(&sig.signature) {
            match get_transaction_parsed(&cfg.rpc_url, &sig.signature).await? {
                Some(tx_json) => {
                    if let Some(entry) = build_entry(&cfg, &sig.signature, &tx_json) {
                        state::journal_append(entry);
                        appended += 1;
                    }
                }
                None => {
                    // За retention RPC: журнал в этом месте неполон — честно светим в статусе,
                    // сверка verify-export покажет дыру. На mainnet (архивный RPC) не случается.
                    state::STATUS.with(|s| s.borrow_mut().tx_unavailable += 1);
                }
            }
        }
        state::set_cursor(&sig.signature);
    }
    Ok(appended)
}

/// jsonParsed-транзакция → запись журнала. Не наша транзакция (нет пары 97/3+memo и не
/// активация) → None: трежери видит и клеймы эскроу-программы, они игнорируются здесь
/// и появятся в журнале канистры только с M2 (споры/эскроу переезжают).
fn build_entry(cfg: &Config, signature: &str, tx_json: &serde_json::Value) -> Option<JournalEntry> {
    let tx: ParsedTx = serde_json::from_value(tx_json.clone()).ok()?;

    if let Some(d) = extract_donation(Some(&tx), signature, &cfg.usdc_mint, &cfg.treasury_ata) {
        return Some(JournalEntry {
            seq: 0, // проставит journal_append
            kind: EntryKind::Donation,
            signature: d.signature,
            channel_id: d.memo.c,
            actor: d.donor,
            amount_micro: u64::try_from(d.amount_micro).ok()?,
            fee_micro: u64::try_from(d.fee_micro).ok()?,
            net_micro: u64::try_from(d.net_micro).ok()?,
            // Курс ADR 0007: 1 USDC = 1 очко ⇒ micro-очки == micro-USDC полной суммы
            // (паритет с сервером: pointsDelta = pointsForAmount(amount)).
            points_delta_micro: i64::try_from(d.amount_micro).ok()?,
            donation_id: Some(d.memo.d),
            msg_ref: d.memo.m,
            block_time: d.block_time,
        });
    }

    if let Some(a) = extract_activation(Some(&tx), signature, &cfg.usdc_mint, &cfg.treasury_ata) {
        return Some(JournalEntry {
            seq: 0,
            kind: EntryKind::Activation,
            signature: a.signature,
            channel_id: a.channel_id,
            actor: a.payer,
            amount_micro: u64::try_from(a.amount_micro).ok()?,
            fee_micro: 0,
            net_micro: 0,
            points_delta_micro: 0, // активация — анти-флуд-якорь, не репутация
            donation_id: None,
            msg_ref: None,
            block_time: a.block_time,
        });
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> Config {
        Config {
            rpc_url: "http://unused".into(),
            treasury_ata: "TREASURY".into(),
            usdc_mint: "MINT".into(),
            poll_secs: 20,
            schnorr_key_name: None,
            escrow_program: None,
        }
    }

    fn donation_tx() -> serde_json::Value {
        serde_json::json!({
            "blockTime": 1767225600,
            "meta": { "err": null },
            "transaction": { "message": { "instructions": [
                { "program": "spl-token", "parsed": { "type": "transferChecked", "info": {
                    "authority": "DONOR", "destination": "STREAMER", "mint": "MINT",
                    "source": "SRC", "tokenAmount": { "amount": "97000000", "decimals": 6 } } } },
                { "program": "spl-token", "parsed": { "type": "transferChecked", "info": {
                    "authority": "DONOR", "destination": "TREASURY", "mint": "MINT",
                    "source": "SRC", "tokenAmount": { "amount": "3000000", "decimals": 6 } } } },
                { "program": "spl-memo", "parsed": "{\"c\":\"chan-1\",\"d\":\"don-1\",\"m\":null}" }
            ] } }
        })
    }

    #[test]
    fn builds_donation_entry_with_full_amount_points() {
        let e = build_entry(&cfg(), "sig-1", &donation_tx()).expect("donation");
        assert_eq!(e.kind, EntryKind::Donation);
        assert_eq!(e.channel_id, "chan-1");
        assert_eq!(e.amount_micro, 100_000_000);
        assert_eq!(e.points_delta_micro, 100_000_000); // полная сумма 1:1, как у сервера
        assert_eq!(e.fee_micro, 3_000_000);
    }

    #[test]
    fn foreign_tx_is_skipped() {
        let tx = serde_json::json!({
            "blockTime": 1767225600, "meta": { "err": null },
            "transaction": { "message": { "instructions": [
                { "program": "spl-token", "parsed": { "type": "transferChecked", "info": {
                    "authority": "X", "destination": "TREASURY", "mint": "MINT",
                    "source": "S", "tokenAmount": { "amount": "1", "decimals": 6 } } } }
            ] } }
        });
        assert!(build_entry(&cfg(), "sig-2", &tx).is_none()); // одна нога без memo — не наша
    }
}
