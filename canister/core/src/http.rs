//! HTTP-интерфейс канистры (шлюз ICP → query `http_request`): публичный JSON-экспорт журнала.
//! Это «экспорт и доказуемость» из архитектуры §3.1-6: любой может скачать журнал канистры
//! без agent-js, простым curl. M0 отдаёт без сертификации ответов (certified data — следующий
//! шаг M0/M1); ревизору verify-export этого достаточно — он сверяет содержимое с цепочкой.

use crate::state::{self, EntryKind};
use candid::CandidType;
use serde::Deserialize;
use serde_json::json;

#[derive(CandidType, Deserialize)]
pub struct HttpRequest {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    #[serde(with = "serde_bytes")]
    pub body: Vec<u8>,
}

#[derive(CandidType, Deserialize)]
pub struct HttpResponse {
    pub status_code: u16,
    pub headers: Vec<(String, String)>,
    #[serde(with = "serde_bytes")]
    pub body: Vec<u8>,
    /// true → шлюз повторит запрос как UPDATE-вызов (`http_request_update`) — путь записи
    /// (POST /dispute-params) без agent-js. Query-ответы поле не ставят.
    pub upgrade: Option<bool>,
}

fn json_response(status: u16, body: serde_json::Value) -> HttpResponse {
    HttpResponse {
        status_code: status,
        headers: vec![
            ("Content-Type".into(), "application/json".into()),
            // M1: браузер ходит в канистру напрямую (IcpDataProvider), минуя наш сервер.
            ("Access-Control-Allow-Origin".into(), "*".into()),
            // Для POST /dispute-params браузер шлёт preflight (Content-Type: application/json).
            ("Access-Control-Allow-Methods".into(), "GET, POST, OPTIONS".into()),
            ("Access-Control-Allow-Headers".into(), "Content-Type".into()),
        ],
        body: serde_json::to_vec(&body).unwrap_or_default(),
        upgrade: None,
    }
}

/// Агрегат донора по каналу (свёртка журнала). С M2 в журнале есть спор-эффекты:
/// очки — знаковая сумма ВСЕХ дельт с клампом ≥0 в конце (§4.4, как computePoints);
/// totalDonated/donations — только денежные записи (Donation + GameDonation).
#[derive(Default, Clone)]
struct DonorAgg {
    points_micro_signed: i128,
    total_donated_micro: u64,
    donations: u64,
    first_block_time: Option<i64>,
}

impl DonorAgg {
    fn points_micro(&self) -> u64 {
        self.points_micro_signed.max(0) as u64
    }
}

/// Тип записи для JSON-экспорта (стабильные имена — их читает verify-export и UI).
fn kind_str(kind: &EntryKind) -> &'static str {
    match kind {
        EntryKind::Donation => "DONATION",
        EntryKind::Activation => "ACTIVATION",
        EntryKind::GameDonation => "GAME_DONATION",
        EntryKind::DisputeWon => "DISPUTE_WON",
        EntryKind::DisputeLost => "DISPUTE_LOST",
    }
}

fn is_money(kind: &EntryKind) -> bool {
    matches!(kind, EntryKind::Donation | EntryKind::GameDonation)
}

/// Свёртка журнала по каналу: адрес → агрегат. `since_block_time` — нижняя граница (для
/// месячного лидерборда); записи без block_time под фильтром отбрасываются (честная граница).
fn fold_channel(channel_id: &str, since_block_time: Option<i64>) -> std::collections::BTreeMap<String, DonorAgg> {
    let mut acc: std::collections::BTreeMap<String, DonorAgg> = Default::default();
    for i in 0..state::journal_len() {
        let Some(e) = state::journal_get(i) else { continue };
        if e.kind == EntryKind::Activation || e.channel_id != channel_id {
            continue;
        }
        if let Some(since) = since_block_time {
            if e.block_time.is_none_or(|bt| bt < since) {
                continue;
            }
        }
        let agg = acc.entry(e.actor.clone()).or_default();
        agg.points_micro_signed += e.points_delta_micro as i128;
        if is_money(&e.kind) {
            agg.total_donated_micro += e.amount_micro;
            agg.donations += 1;
            agg.first_block_time = match (agg.first_block_time, e.block_time) {
                (None, bt) => bt,
                (cur, None) => cur,
                (Some(a), Some(b)) => Some(a.min(b)),
            };
        }
    }
    acc
}

fn agg_json(address: &str, a: &DonorAgg) -> serde_json::Value {
    json!({
        "address": address,
        "pointsMicro": a.points_micro().to_string(),
        "totalDonatedMicro": a.total_donated_micro.to_string(),
        "donations": a.donations,
        "firstBlockTime": a.first_block_time,
    })
}

/// Мини-парсер query-строки (без внешних крейтов): `?channel=<id>` с %-декодом.
fn query_param(url: &str, name: &str) -> Option<String> {
    let qs = url.split_once('?')?.1;
    for pair in qs.split('&') {
        let (k, v) = pair.split_once('=')?;
        if k == name {
            return Some(percent_decode(v));
        }
    }
    None
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 3 <= bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
                if let Some(b) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                    out.push(b);
                    i += 3;
                    continue;
                }
                out.push(bytes[i]);
                i += 1;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Дозреватель governance-параметров: pending → effective (виден и в query-ответах).
fn params_json(channel: &str) -> serde_json::Value {
    let now = ic_cdk::api::time();
    let (effective, st) = crate::governance::effective_params(channel, now);
    json!({
        "channelId": channel,
        "owner": crate::governance::channel_owner(channel),
        "version": st.version,
        "effective": param_fields(&effective),
        "pending": st.pending.as_ref().filter(|p| p.effective_at_ns > now).map(|p| json!({
            "params": param_fields(&p.params),
            "effectiveAtNs": p.effective_at_ns.to_string(),
            "version": p.version,
        })),
        "isDefault": st.effective.is_none() && st.pending.is_none(),
    })
}

fn param_fields(p: &crate::governance::DisputeParams) -> serde_json::Value {
    json!({
        "minReputationToDisputeMicro": p.min_reputation_to_dispute_micro,
        "minWeightToVoteMicro": p.min_weight_to_vote_micro,
        "quorumMicro": p.quorum_micro,
        "disputeWindowSecs": p.dispute_window_secs,
        "votingWindowSecs": p.voting_window_secs,
        "dMaxMicro": p.d_max_micro.to_string(),
    })
}

/// Спор-кейс → JSON. Табло и голоса ОТКРЫТЫ живьём — решение владельца 2026-07-05
/// (спека прятала их до вердикта против стадности/прицельного подкупа, атака §8.5;
/// риск принят и записан в migration-plan; конверты для крупных споров — мейннет-план).
fn case_json(case: &crate::arbiter::DisputeCase) -> serde_json::Value {
    let d = case.task.dispute.as_ref();
    let (mut completed, mut not) = (0i128, 0i128);
    if let Some(d) = d {
        for v in &d.votes {
            match v.choice {
                crate::disputes::VoteChoice::Completed => completed += v.weight_micro,
                crate::disputes::VoteChoice::NotCompleted => not += v.weight_micro,
            }
        }
    }
    json!({
        "escrowAccount": case.escrow_account,
        "channelId": case.channel_id,
        "escrowTaskId": case.escrow.task_id_hex,
        "amountMicro": case.escrow.amount_micro.to_string(),
        "donor": case.escrow.donor,
        "streamer": case.escrow.streamer,
        "status": case.task.status.as_str(),
        "openedBy": d.map(|d| d.by.clone()),
        "openedAtMs": d.map(|d| d.opened_at_ms),
        "votingEndsAtMs": d.map(|d| d.voting_ends_at_ms),
        "quorumMicro": d.map(|d| d.quorum_micro.to_string()),
        "votesCount": d.map(|d| d.votes.len()),
        "tally": {
            "completedMicro": completed.to_string(),
            "notCompletedMicro": not.to_string(),
        },
        "votes": d.map(|d| d.votes.iter().map(|vt| json!({
            "voter": vt.voter, "choice": vt.choice.as_str(),
            "weightMicro": vt.weight_micro.to_string(), "atMs": vt.at_ms,
        })).collect::<Vec<_>>()),
        "markDisputedTx": case.mark_disputed_tx,
        "resolveTx": case.resolve_tx,
        "lastSendError": case.last_send_error,
        "verdict": case.verdict.as_ref().map(|v| json!({
            "outcome": v.outcome.as_str(),
            "reason": v.reason.as_str(),
            "tallyCompletedMicro": v.tally_completed_micro.to_string(),
            "tallyNotCompletedMicro": v.tally_not_completed_micro.to_string(),
            "finalizedAtMs": v.finalized_at_ms,
        })),
    })
}

fn now_ms() -> i64 {
    (ic_cdk::api::time() / 1_000_000) as i64
}

/// UPDATE-путь (после upgrade шлюзом): записи подписями кошельков — governance-параметры,
/// открытие спора, голос. Авторизация — подпись в теле, не caller.
pub async fn handle_update(req: HttpRequest) -> HttpResponse {
    let path = req.url.split('?').next().unwrap_or("/").to_string();
    if req.method != "POST" {
        return json_response(405, json!({ "error": "POST only" }));
    }
    let Ok(body) = serde_json::from_slice::<serde_json::Value>(&req.body) else {
        return json_response(400, json!({ "error": "тело не JSON" }));
    };
    let field = |k: &str| body.get(k).and_then(serde_json::Value::as_str).map(str::to_string);

    match path.as_str() {
        "/dispute/open" => {
            let (Some(escrow_account), Some(channel_id), Some(by), Some(signature)) =
                (field("escrowAccount"), field("channelId"), field("by"), field("signature"))
            else {
                return json_response(400, json!({ "error": "нужны escrowAccount, channelId, by, signature" }));
            };
            match crate::arbiter::open_dispute(
                crate::arbiter::OpenDisputeArgs { escrow_account, channel_id, by, signature_b58: signature },
                now_ms(),
            )
            .await
            {
                Ok(case) => json_response(200, json!({ "ok": true, "dispute": case_json(&case) })),
                Err(e) => json_response(403, json!({ "ok": false, "error": e })),
            }
        }
        "/dispute/vote" => {
            let (Some(escrow_account), Some(voter), Some(choice), Some(signature)) =
                (field("escrowAccount"), field("voter"), field("choice"), field("signature"))
            else {
                return json_response(400, json!({ "error": "нужны escrowAccount, voter, choice, signature" }));
            };
            let choice = match choice.as_str() {
                "completed" => crate::disputes::VoteChoice::Completed,
                "not_completed" => crate::disputes::VoteChoice::NotCompleted,
                _ => return json_response(400, json!({ "error": "choice: completed | not_completed" })),
            };
            match crate::arbiter::cast_vote(
                &crate::arbiter::CastVoteArgs { escrow_account, voter, choice, signature_b58: signature },
                now_ms(),
            ) {
                Ok(case) => json_response(200, json!({ "ok": true, "dispute": case_json(&case) })),
                Err(e) => json_response(403, json!({ "ok": false, "error": e })),
            }
        }
        "/dispute-params" => handle_params_update(&body),
        _ => json_response(404, json!({ "error": "POST: /dispute-params, /dispute/open, /dispute/vote" })),
    }
}

/// Запись governance-параметров (вынесено из handle_update при добавлении спор-путей).
fn handle_params_update(body: &serde_json::Value) -> HttpResponse {
    let get_str = |k: &str| body.get(k).and_then(serde_json::Value::as_str).map(str::to_string);
    let get_u64 = |v: &serde_json::Value, k: &str| -> Option<u64> {
        let f = v.get(k)?;
        f.as_u64().or_else(|| f.as_str().and_then(|s| s.parse().ok()))
    };
    let (Some(channel), Some(owner), Some(signature), Some(version), Some(p)) = (
        get_str("channelId"),
        get_str("owner"),
        get_str("signature"),
        get_u64(body, "version"),
        body.get("params"),
    ) else {
        return json_response(400, json!({ "error": "нужны channelId, owner, version, params, signature" }));
    };
    let (Some(a), Some(b), Some(c), Some(d), Some(e), Some(f)) = (
        get_u64(p, "minReputationToDisputeMicro"),
        get_u64(p, "minWeightToVoteMicro"),
        get_u64(p, "quorumMicro"),
        get_u64(p, "disputeWindowSecs"),
        get_u64(p, "votingWindowSecs"),
        get_u64(p, "dMaxMicro"),
    ) else {
        return json_response(400, json!({ "error": "params: шесть полей *Micro/*Milli/*Secs (число или строка)" }));
    };
    let params = crate::governance::DisputeParams {
        min_reputation_to_dispute_micro: a,
        min_weight_to_vote_micro: b,
        quorum_micro: c,
        dispute_window_secs: d,
        voting_window_secs: e,
        d_max_micro: f,
    };
    match crate::governance::set_dispute_params(
        &channel,
        &owner,
        version,
        params,
        &signature,
        ic_cdk::api::time(),
    ) {
        Ok(effective_at_ns) => json_response(
            200,
            json!({ "ok": true, "version": version, "effectiveAtNs": effective_at_ns.to_string() }),
        ),
        Err(e) => json_response(403, json!({ "ok": false, "error": e })),
    }
}

pub fn handle(req: HttpRequest) -> HttpResponse {
    // Preflight для POST из браузера (студия): отвечаем разрешениями без апгрейда.
    if req.method == "OPTIONS" {
        return json_response(200, json!({}));
    }
    // Запись — только через update-вызов: шлюз повторит запрос в http_request_update.
    if req.method == "POST" {
        let mut resp = json_response(200, json!({}));
        resp.upgrade = Some(true);
        return resp;
    }
    if req.method != "GET" {
        return json_response(405, json!({ "error": "GET only" }));
    }
    let path = req.url.split('?').next().unwrap_or("/");

    match path {
        // M2: спор по эскроу (табло скрыто до вердикта) и список споров.
        "/dispute" => {
            let Some(escrow) = query_param(&req.url, "escrow") else {
                return json_response(400, json!({ "error": "нужен ?escrow=<адрес эскроу-аккаунта>" }));
            };
            match crate::arbiter::case_of(&escrow) {
                Some(case) => json_response(200, case_json(&case)),
                None => json_response(404, json!({ "error": "спор не найден" })),
            }
        }
        "/disputes" => {
            let channel = query_param(&req.url, "channel");
            let rows: Vec<_> = crate::arbiter::list_cases()
                .into_iter()
                .filter(|c| channel.as_deref().is_none_or(|ch| ch == c.channel_id))
                .map(|c| case_json(&c))
                .collect();
            json_response(200, json!({ "disputes": rows }))
        }
        // M1: governance-параметры споров канала (чтение; запись — POST тем же путём).
        "/dispute-params" => {
            let Some(channel) = query_param(&req.url, "channel") else {
                return json_response(400, json!({ "error": "нужен ?channel=" }));
            };
            json_response(200, params_json(&channel))
        }
        // M1: канон чтения репутации для IcpDataProvider (свёртка журнала на лету, §4.4).
        "/standing" => {
            let (Some(channel), Some(address)) =
                (query_param(&req.url, "channel"), query_param(&req.url, "address"))
            else {
                return json_response(400, json!({ "error": "нужны ?channel= и ?address=" }));
            };
            let acc = fold_channel(&channel, None);
            let agg = acc.get(&address).cloned().unwrap_or_default();
            json_response(200, json!({ "channelId": channel, "standing": agg_json(&address, &agg) }))
        }
        "/leaderboard" => {
            let Some(channel) = query_param(&req.url, "channel") else {
                return json_response(400, json!({ "error": "нужен ?channel=" }));
            };
            let since = query_param(&req.url, "since").and_then(|s| s.parse::<i64>().ok());
            let limit = query_param(&req.url, "limit")
                .and_then(|s| s.parse::<usize>().ok())
                .unwrap_or(100)
                .min(1000);
            let mut rows: Vec<(String, DonorAgg)> = fold_channel(&channel, since).into_iter().collect();
            rows.sort_by(|a, b| b.1.points_micro().cmp(&a.1.points_micro()).then_with(|| a.0.cmp(&b.0)));
            rows.truncate(limit);
            json_response(
                200,
                json!({
                    "channelId": channel,
                    "since": since,
                    "rows": rows.iter().map(|(addr, a)| agg_json(addr, a)).collect::<Vec<_>>(),
                }),
            )
        }
        "/export" => {
            let channel = query_param(&req.url, "channel");
            let len = state::journal_len();
            let mut entries = Vec::new();
            for i in 0..len {
                let Some(e) = state::journal_get(i) else { continue };
                if channel.as_deref().is_some_and(|c| c != e.channel_id) {
                    continue;
                }
                entries.push(json!({
                    "seq": e.seq,
                    "kind": kind_str(&e.kind),
                    "signature": e.signature,
                    "channelId": e.channel_id,
                    "actor": e.actor,
                    "amountMicro": e.amount_micro.to_string(),
                    "feeMicro": e.fee_micro.to_string(),
                    "netMicro": e.net_micro.to_string(),
                    "pointsDeltaMicro": e.points_delta_micro.to_string(),
                    "donationId": e.donation_id,
                    "msgRef": e.msg_ref,
                    "blockTime": e.block_time,
                }));
            }
            let st = state::STATUS.with(|s| s.borrow().clone());
            json_response(
                200,
                json!({
                    "source": "standing-core canister (M0 observer)",
                    "version": env!("CARGO_PKG_VERSION"),
                    "journalLen": len,
                    "cursor": state::cursor(),
                    "txUnavailable": st.tx_unavailable,
                    "entries": entries,
                }),
            )
        }
        "/status" => {
            let st = state::STATUS.with(|s| s.borrow().clone());
            let cfg = state::config();
            json_response(
                200,
                json!({
                    "version": env!("CARGO_PKG_VERSION"),
                    "journalLen": state::journal_len(),
                    "cursor": state::cursor(),
                    "polls": st.polls,
                    "lastBatchAppended": st.last_batch_appended,
                    "lastError": st.last_error,
                    "txUnavailable": st.tx_unavailable,
                    "lastPollOkNs": st.last_poll_ok_ns.to_string(),
                    "treasuryAta": cfg.treasury_ata,
                    "rpcUrl": cfg.rpc_url,
                    "pollSecs": cfg.poll_secs,
                }),
            )
        }
        _ => json_response(404, json!({ "error": "unknown path", "paths": ["/export", "/export?channel=<id>", "/standing?channel=<id>&address=<addr>", "/leaderboard?channel=<id>[&since=<unix>][&limit=N]", "/status"] })),
    }
}
