//! Арбитр споров (M2, ADR 0021): канистра принимает споры по ончейн-эскроу, голоса-подписи
//! и выносит вердикты БЕЗ участия площадки. Вес = снимок репутации на момент открытия спора.
//!
//! Экономика ПО РЕШЕНИЯМ ВЛАДЕЛЬЦА (2026-07-05; расхождения со спекой v1.1 записаны в
//! yellow-paper §18.5-8b/8c):
//!  - ДЕНЕЖНЫХ наказаний нет вообще: ни депозита, ни пошлины, ни залога — «сжигаем только
//!    репутацию» (−50 инициатору за ложный спор, DISPUTE_LOST). Анти-спам держат порог
//!    репутации на открытие + сам штраф.
//!  - Кворум — ФИКСИРОВАННОЕ число очков от стримера (governance), дефолт 1 очко; формулы
//!    от суммы нет. Не собрался — спор уходит стримеру по презумпции.
//!  - Голосование одношаговое и добровольное (наград не даёт), табло и голоса ОТКРЫТЫ живьём.
//!
//! Трастлесс-опоры:
//!  - эскроу читается ИЗ ЦЕПОЧКИ (getAccountInfo) и принимается только если аккаунтом
//!    владеет эскроу-программа из конфига — подделать вход нельзя;
//!  - голос/открытие — ed25519-подписи кошельков (канон-сообщения ниже, анти-replay:
//!    адрес эскроу + канал + выбор внутри подписанного текста);
//!  - вес и право голоса — свёртка СОБСТВЕННОГО журнала канистры на момент открытия спора;
//!  - пороги/окно голосования — governance-параметры канала (пишутся только владельцем);
//!  - финализация — таймером канистры; исход пишет DISPUTE_*/GameDonation в журнал.
//!
//! Отправка `resolve_dispute` в Solana тресхолд-подписью — СЛЕДУЮЩИЙ шов M2 (вместе с
//! редеплоем эскроу: до него RESOLVER лётных эскроу — операторский ключ, канистру контракт
//! не послушает). Вердикт уже вычисляется и хранится здесь.
//!
//! Известное допущение v1 (devnet): привязка эскроу→канал проверяется как
//! `escrow.streamer == владелец канала из журнала` — если payout-адрес канала не равен
//! кошельку владельца, спор не откроется (расширение привязки — на интеграции UI).

use crate::disputes::{
    self, ResolutionReason, Task, TaskOutcome, TaskStatus, TaskVote, VoteChoice,
    Windows,
};
use crate::governance;
use crate::signer;
use crate::sol_rpc;
use crate::sol_tx;
use crate::state::{self, EntryKind, JournalEntry};
use base64::Engine;
use candid::{CandidType, Decode, Encode};
use ed25519_dalek::{Signature, VerifyingKey};
use ic_stable_structures::storable::Bound;
use ic_stable_structures::{StableBTreeMap, Storable};
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::cell::RefCell;

// ─────────────── ончейн-эскроу: раскладка аккаунта (порт decodeEscrow) ───────────────

/// Срез аккаунта Escrow (раскладка — anchor `Escrow`, 243 байта; порт `decodeEscrow` TS).
#[derive(CandidType, Deserialize, Serialize, Clone, Debug)]
pub struct EscrowInfo {
    pub task_id_hex: String,
    pub donor: String,
    pub streamer: String,
    pub resolver: String,
    pub amount_micro: u64,
    pub execution_window_secs: i64,
    /// 0 Pending, 1 Accepted, 2 Done, 3 Resolved, 4 Disputed.
    pub state: u8,
    pub accept_deadline_secs: i64,
    pub done_deadline_secs: i64,
    pub dispute_deadline_secs: i64,
}

pub const ESCROW_STATE_DONE: u8 = 2;
const ESCROW_ACCOUNT_SIZE: usize = 243;

/// Anchor-дискриминаторы инструкций эскроу (1:1 с escrow-tx.ts DISC).
const DISC_MARK_DISPUTED: [u8; 8] = [136, 86, 152, 120, 3, 21, 223, 251];
const DISC_RESOLVE_DISPUTE: [u8; 8] = [231, 6, 202, 6, 96, 103, 12, 230];

pub fn decode_escrow_account(data: &[u8]) -> Result<EscrowInfo, String> {
    if data.len() != ESCROW_ACCOUNT_SIZE {
        return Err(format!("эскроу-аккаунт: {} байт, ожидалось {ESCROW_ACCOUNT_SIZE}", data.len()));
    }
    let pk = |off: usize| bs58::encode(&data[off..off + 32]).into_string();
    let u64le = |off: usize| u64::from_le_bytes(data[off..off + 8].try_into().unwrap());
    let i64le = |off: usize| i64::from_le_bytes(data[off..off + 8].try_into().unwrap());
    // 8 дискриминатор + task_id 32 + donor/streamer/treasury/mint/resolver по 32.
    Ok(EscrowInfo {
        task_id_hex: hex(&data[8..40]),
        donor: pk(40),
        streamer: pk(72),
        resolver: pk(168),
        amount_micro: u64le(200),
        execution_window_secs: i64le(208),
        state: data[216],
        accept_deadline_secs: i64le(218),
        done_deadline_secs: i64le(226),
        dispute_deadline_secs: i64le(234),
    })
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

// ─────────────── хранилище споров ───────────────

#[derive(CandidType, Deserialize, Serialize, Clone, Debug)]
pub struct Verdict {
    pub outcome: TaskOutcome,
    pub reason: ResolutionReason,
    pub tally_completed_micro: i128,
    pub tally_not_completed_micro: i128,
    pub finalized_at_ms: i64,
}

#[derive(CandidType, Deserialize, Serialize, Clone, Debug)]
pub struct DisputeCase {
    /// Ключ — адрес эскроу-аккаунта (base58): уникален и проверяем по цепочке.
    pub escrow_account: String,
    pub channel_id: String,
    pub escrow: EscrowInfo,
    /// Машинное состояние (порт machine.ts): статус/окна/голоса.
    pub task: Task,
    pub verdict: Option<Verdict>,
    /// Подпись ончейн `mark_disputed` (блокирует resolve_timeout на время голосования).
    pub mark_disputed_tx: Option<String>,
    /// Подпись ончейн `resolve_dispute` — исполнение вердикта тресхолд-резолвером.
    pub resolve_tx: Option<String>,
    /// Последняя ошибка отправки (ретраится каждым тиком таймера, пока подпись не встанет).
    pub last_send_error: Option<String>,
}

impl Storable for DisputeCase {
    fn to_bytes(&self) -> Cow<'_, [u8]> {
        Cow::Owned(Encode!(self).expect("candid encode"))
    }
    fn into_bytes(self) -> Vec<u8> {
        Encode!(&self).expect("candid encode")
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        Decode!(&bytes, Self).expect("candid decode DisputeCase")
    }
    const BOUND: Bound = Bound::Unbounded;
}

thread_local! {
    static CASES: RefCell<StableBTreeMap<String, DisputeCase, state::Mem>> =
        RefCell::new(StableBTreeMap::init(state::memory(6)));
}

pub fn case_of(escrow_account: &str) -> Option<DisputeCase> {
    CASES.with(|c| c.borrow().get(&escrow_account.to_string()))
}

pub fn list_cases() -> Vec<DisputeCase> {
    CASES.with(|c| c.borrow().iter().map(|e| e.value()).collect())
}

fn put_case(case: DisputeCase) {
    CASES.with(|c| c.borrow_mut().insert(case.escrow_account.clone(), case));
}

// ─────────────── канонические сообщения (пины: dispute-vote.test.ts ↔ тесты ниже) ───────────────

pub fn build_open_message(escrow_account: &str, channel_id: &str, by: &str) -> String {
    [
        "Standing: открытие спора по заданию-донату.".to_string(),
        String::new(),
        "Подписывая, вы оспариваете выполнение задания. Денег это не стоит,".to_string(),
        "но проигранный ложный спор снимет 50 очков вашей репутации.".to_string(),
        String::new(),
        format!("escrow: {escrow_account}"),
        format!("channel: {channel_id}"),
        format!("by: {by}"),
        "v: 2".to_string(),
    ]
    .join("\n")
}

pub fn build_vote_message(
    escrow_account: &str,
    channel_id: &str,
    voter: &str,
    choice: VoteChoice,
) -> String {
    [
        "Standing: голос в споре по заданию-донату.".to_string(),
        String::new(),
        "Подписывая, вы голосуете весом своей репутации на этом канале.".to_string(),
        String::new(),
        format!("escrow: {escrow_account}"),
        format!("channel: {channel_id}"),
        format!("voter: {voter}"),
        format!("choice: {}", choice.as_str()),
        "v: 1".to_string(),
    ]
    .join("\n")
}

fn verify_signature(msg: &str, signer_b58: &str, signature_b58: &str) -> Result<(), String> {
    let pub_bytes: [u8; 32] = bs58::decode(signer_b58)
        .into_vec()
        .map_err(|e| format!("подписант base58: {e}"))?
        .try_into()
        .map_err(|_| "подписант: не 32 байта".to_string())?;
    let sig_bytes: [u8; 64] = bs58::decode(signature_b58)
        .into_vec()
        .map_err(|e| format!("signature base58: {e}"))?
        .try_into()
        .map_err(|_| "signature: не 64 байта".to_string())?;
    let key = VerifyingKey::from_bytes(&pub_bytes).map_err(|e| format!("ключ: {e}"))?;
    key.verify_strict(msg.as_bytes(), &Signature::from_bytes(&sig_bytes))
        .map_err(|_| "подпись не сходится".to_string())
}

// ─────────────── вес: снимок репутации из журнала канистры ───────────────

/// Репутация адреса на канале НА МОМЕНТ времени (micro): знаковая свёртка журнала по
/// block_time ≤ момента, кламп ≥0 (порт computePointsAsOf; §4.4). Записи без block_time
/// в снимок не входят (честная граница — у ончейн-записей время есть всегда).
pub fn weight_as_of_micro(channel_id: &str, address: &str, at_ms: i64) -> i128 {
    let mut sum: i128 = 0;
    for i in 0..state::journal_len() {
        let Some(e) = state::journal_get(i) else { continue };
        if e.kind == EntryKind::Activation || e.channel_id != channel_id || e.actor != address {
            continue;
        }
        match e.block_time {
            Some(bt) if bt.saturating_mul(1000) <= at_ms => sum += e.points_delta_micro as i128,
            _ => {}
        }
    }
    sum.max(0)
}

// ─────────────── открытие спора ───────────────

pub struct OpenDisputeArgs {
    pub escrow_account: String,
    pub channel_id: String,
    pub by: String,
    pub signature_b58: String,
}

/// Чистая часть открытия (тестируемая): эскроу уже прочитан и проверен на владельца-программу.
pub fn open_dispute_with_escrow(
    args: &OpenDisputeArgs,
    escrow: EscrowInfo,
    expected_resolver: Option<&str>,
    now_ms: i64,
) -> Result<DisputeCase, String> {
    // Переходная модель M2: канистра арбитрирует только эскроу, где резолвер — ОНА
    // (созданные после редеплоя); лётные со старым резолвером доживают у оператора.
    if let Some(r) = expected_resolver {
        if escrow.resolver != r {
            return Err(format!(
                "резолвер эскроу {} — не канистра: спор ведёт прежний резолвер",
                escrow.resolver
            ));
        }
    }
    if case_of(&args.escrow_account).is_some() {
        return Err("спор по этому эскроу уже открыт".into());
    }
    let msg = build_open_message(&args.escrow_account, &args.channel_id, &args.by);
    verify_signature(&msg, &args.by, &args.signature_b58)?;

    // Привязка эскроу → канал (допущение v1, см. шапку): payout-получатель == владелец канала.
    let owner = governance::channel_owner(&args.channel_id)
        .ok_or("канал не активирован ончейн — журнал не знает владельца")?;
    if escrow.streamer != owner {
        return Err("эскроу не принадлежит этому каналу (streamer ≠ владелец канала)".into());
    }
    if args.by == escrow.streamer {
        return Err("стример не может оспаривать собственное задание (спека §4.1)".into());
    }

    if escrow.state != ESCROW_STATE_DONE {
        return Err(format!("эскроу не в состоянии Done (state={})", escrow.state));
    }
    if now_ms > escrow.dispute_deadline_secs.saturating_mul(1000) {
        return Err("ончейн-окно оспаривания закрыто".into());
    }

    let (params, _) = governance::effective_params(&args.channel_id, (now_ms as u64) * 1_000_000);
    let weight = weight_as_of_micro(&args.channel_id, &args.by, now_ms);
    if weight < params.min_reputation_to_dispute_micro as i128 {
        return Err(format!(
            "вес {} micro-очков ниже порога открытия спора {}",
            weight, params.min_reputation_to_dispute_micro
        ));
    }

    // Машинное состояние из ончейн-фактов: задание в Done, окно спора — ончейн-дедлайн.
    let created_ms = (escrow.done_deadline_secs - escrow.execution_window_secs) * 1000;
    let task = Task {
        id: escrow.task_id_hex.clone(),
        channel_id: args.channel_id.clone(),
        donor: escrow.donor.clone(),
        amount_micro: escrow.amount_micro,
        created_at_ms: created_ms,
        execution_deadline_ms: escrow.done_deadline_secs * 1000,
        grace_until_ms: escrow.accept_deadline_secs * 1000,
        status: TaskStatus::Done,
        dispute_window_ends_at_ms: Some(escrow.dispute_deadline_secs * 1000),
        dispute: None,
        resolution: None,
    };
    let windows = Windows {
        grace_ms: 0,
        execution_default_ms: 0,
        execution_min_ms: 0,
        execution_max_ms: i64::MAX,
        dispute_window_ms: 0, // окно уже зашито в task.dispute_window_ends_at_ms
        voting_ms: (params.voting_window_secs as i64) * 1000,
    };
    let quorum = params.quorum_micro as i128; // фикс от стримера (дефолт 1 очко)
    let task = disputes::raise_dispute(&task, &args.by, quorum, &windows, now_ms)
        .map_err(|e| format!("машина отклонила спор: {}", e.code))?;

    let case = DisputeCase {
        escrow_account: args.escrow_account.clone(),
        channel_id: args.channel_id.clone(),
        escrow,
        task,
        verdict: None,
        mark_disputed_tx: None,
        resolve_tx: None,
        last_send_error: None,
    };
    put_case(case.clone());
    Ok(case)
}

/// Полное открытие: читает эскроу ИЗ ЦЕПОЧКИ и проверяет владельца-программу.
pub async fn open_dispute(args: OpenDisputeArgs, now_ms: i64) -> Result<DisputeCase, String> {
    let cfg = state::config();
    let program = cfg.escrow_program.ok_or("escrow_program не задан в конфиге — споры выключены")?;
    let info = sol_rpc::get_account_info(&cfg.rpc_url, &args.escrow_account)
        .await?
        .ok_or("эскроу-аккаунт не найден в цепочке")?;
    if info.owner != program {
        return Err(format!("аккаунтом владеет {} — не эскроу-программа", info.owner));
    }
    let raw = base64::engine::general_purpose::STANDARD
        .decode(info.data_base64)
        .map_err(|e| format!("base64: {e}"))?;
    let escrow = decode_escrow_account(&raw)?;
    let resolver_b58 = signer::solana_address().await?;
    let case = open_dispute_with_escrow(&args, escrow, Some(&resolver_b58), now_ms)?;
    // Сразу блокируем resolve_timeout на время голосования; неудача не валит спор — ретрай таймером.
    let case = try_send_mark_disputed(case).await;
    Ok(case)
}

fn bs58_32(s: &str) -> Result<[u8; 32], String> {
    bs58::decode(s)
        .into_vec()
        .map_err(|e| format!("base58: {e}"))?
        .try_into()
        .map_err(|_| "не 32 байта".to_string())
}

/// Транзакция резолвера (mark_disputed / resolve_dispute): fee payer = тресхолд-адрес канистры.
async fn send_resolver_ix(escrow_account: &str, data: Vec<u8>) -> Result<String, String> {
    let cfg = state::config();
    let program = bs58_32(&cfg.escrow_program.ok_or("escrow_program не задан")?)?;
    let escrow = bs58_32(escrow_account)?;
    let resolver = signer::threshold_pubkey().await?;

    let blockhash_b58 = sol_rpc::get_latest_blockhash(&cfg.rpc_url).await?;
    let blockhash = bs58_32(&blockhash_b58)?;

    let msg = sol_tx::build_message(
        &resolver,
        &blockhash,
        &[sol_tx::Instruction {
            program_id: program,
            accounts: vec![
                sol_tx::AccountMeta { pubkey: resolver, is_signer: true, is_writable: false },
                sol_tx::AccountMeta { pubkey: escrow, is_signer: false, is_writable: true },
            ],
            data,
        }],
    );
    let sig = signer::sign(msg.clone()).await?;
    let tx = sol_tx::assemble_tx(&sig, &msg)?;
    sol_rpc::send_transaction(&cfg.rpc_url, &base64::engine::general_purpose::STANDARD.encode(tx))
        .await
}

async fn try_send_mark_disputed(mut case: DisputeCase) -> DisputeCase {
    match send_resolver_ix(&case.escrow_account, DISC_MARK_DISPUTED.to_vec()).await {
        Ok(sig) => {
            case.mark_disputed_tx = Some(sig);
            case.last_send_error = None;
        }
        Err(e) => case.last_send_error = Some(format!("mark_disputed: {e}")),
    }
    put_case(case.clone());
    case
}

/// Ретраи отправок (тик таймера): недоставленный mark_disputed идущего спора и
/// resolve_dispute вынесенного вердикта. Идемпотентно: подпись есть → не шлём.
pub async fn send_pending_txs() {
    for case in list_cases() {
        if case.verdict.is_none()
            && case.task.status == TaskStatus::Disputed
            && case.mark_disputed_tx.is_none()
        {
            try_send_mark_disputed(case).await;
        } else if let Some(v) = &case.verdict {
            if case.resolve_tx.is_none() {
                let mut case = case.clone();
                let to_streamer = matches!(v.outcome, TaskOutcome::ToStreamer);
                let mut data = DISC_RESOLVE_DISPUTE.to_vec();
                data.push(to_streamer as u8);
                match send_resolver_ix(&case.escrow_account, data).await {
                    Ok(sig) => {
                        case.resolve_tx = Some(sig);
                        case.last_send_error = None;
                    }
                    Err(e) => case.last_send_error = Some(format!("resolve_dispute: {e}")),
                }
                put_case(case);
            }
        }
    }
}

// ─────────────── голос ───────────────

pub struct CastVoteArgs {
    pub escrow_account: String,
    pub voter: String,
    pub choice: VoteChoice,
    pub signature_b58: String,
}

pub fn cast_vote(args: &CastVoteArgs, now_ms: i64) -> Result<DisputeCase, String> {
    let mut case = case_of(&args.escrow_account).ok_or("спор не найден")?;
    let msg = build_vote_message(&args.escrow_account, &case.channel_id, &args.voter, args.choice);
    verify_signature(&msg, &args.voter, &args.signature_b58)?;

    let opened_at = case.task.dispute.as_ref().map(|d| d.opened_at_ms).ok_or("спор без диспута")?;
    let (params, _) = governance::effective_params(&case.channel_id, (now_ms as u64) * 1_000_000);
    // Вес и право голоса — по ОДНОМУ снимку на момент открытия спора (спека §4.2).
    let weight = weight_as_of_micro(&case.channel_id, &args.voter, opened_at);
    if weight < params.min_weight_to_vote_micro as i128 {
        return Err(format!(
            "вес {} micro-очков ниже порога голоса {}",
            weight, params.min_weight_to_vote_micro
        ));
    }

    let vote = TaskVote { voter: args.voter.clone(), choice: args.choice, weight_micro: weight, at_ms: now_ms };
    case.task = disputes::cast_vote(&case.task, vote, now_ms)
        .map_err(|e| match e.code {
            "VOTING_OVER" => "голосование завершено".to_string(),
            "ALREADY_VOTED" => "этот кошелёк уже голосовал".to_string(),
            other => format!("машина отклонила голос: {other}"),
        })?;
    put_case(case.clone());
    Ok(case)
}

// ─────────────── финализация (таймер) ───────────────

/// Дозревшие споры: вердикт + учёт депозита + записи журнала. Отправка resolve в Solana —
/// следующий шов M2 (редеплой эскроу с RESOLVER = тресхолд-адрес канистры).
pub fn finalize_due(now_ms: i64) -> u64 {
    let due: Vec<DisputeCase> = CASES.with(|c| {
        c.borrow()
            .iter()
            .map(|e| e.value())
            .filter(|case| case.verdict.is_none())
            .collect()
    });
    let mut finalized = 0;
    for mut case in due {
        let Some((outcome, reason)) = disputes::due_resolution(&case.task, now_ms) else {
            continue;
        };
        let effects = disputes::rep_effects(&case.task, outcome, reason);
        let d = case.task.dispute.as_ref().expect("dispute");
        let (mut completed, mut not) = (0i128, 0i128);
        for v in &d.votes {
            match v.choice {
                VoteChoice::Completed => completed += v.weight_micro,
                VoteChoice::NotCompleted => not += v.weight_micro,
            }
        }
        case.task = disputes::apply_resolution(&case.task, outcome, reason, now_ms);
        case.verdict = Some(Verdict {
            outcome,
            reason,
            tally_completed_micro: completed,
            tally_not_completed_micro: not,
            finalized_at_ms: now_ms,
        });
        // Исход → журнал (репутация; деньги двигает ончейн-клейм по вердикту резолвера).
        let bt = Some(now_ms / 1000);
        for eff in &effects {
            let kind = match eff.kind {
                "DONATION" => EntryKind::GameDonation,
                "DISPUTE_WON" => EntryKind::DisputeWon,
                _ => EntryKind::DisputeLost,
            };
            state::journal_append(JournalEntry {
                seq: 0,
                kind,
                signature: format!("dispute:{}:{}", case.escrow_account, eff.kind),
                channel_id: case.channel_id.clone(),
                actor: eff.address.clone(),
                amount_micro: eff.amount_micro.unwrap_or(0),
                fee_micro: 0,
                net_micro: 0,
                points_delta_micro: eff.points_delta_micro as i64,
                donation_id: None,
                msg_ref: None,
                block_time: bt,
            });
        }
        put_case(case);
        finalized += 1;
    }
    finalized
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn key(seed: u8) -> (SigningKey, String) {
        let sk = SigningKey::from_bytes(&[seed; 32]);
        let addr = bs58::encode(sk.verifying_key().to_bytes()).into_string();
        (sk, addr)
    }
    fn sig(sk: &SigningKey, msg: &str) -> String {
        bs58::encode(sk.sign(msg.as_bytes()).to_bytes()).into_string()
    }
    fn journal(kind: EntryKind, channel: &str, actor: &str, delta: i64, bt: i64, sig_id: &str) {
        state::journal_append(JournalEntry {
            seq: 0,
            kind,
            signature: sig_id.into(),
            channel_id: channel.into(),
            actor: actor.into(),
            amount_micro: delta.unsigned_abs(),
            fee_micro: 0,
            net_micro: 0,
            points_delta_micro: delta,
            donation_id: None,
            msg_ref: None,
            block_time: Some(bt),
        });
    }

    /// Живой Done-эскроу с devnet (C17zQ5oS…): парсер обязан его читать. Фикстура реальная.
    const DEVNET_ESCROW_B64: &str = "H9V7u7oW2puP/Tvhk79FY4gitzrefNqvbLkgtN9ALKVOJwh7yJNKEd8bkUNETKzLOuOF20Ko8lS4+w28QDPmhpXC18kT4RQXj7pGQKw+ngnIyEsV1o93pQv7yE8O213+wmQmroEETgiECvcjZPG4mIT4xflTBhdyKMX7SOYg7a27FcDUb6im1/YomtB3mkslCvxX0QXF+BrtctAvsfWfoOSZZwzd/uXXTeWxrmL6os555XozEMyFlNFQ4KRtv052CjBUzbs9Kc5AS0wAAAAAAFgCAAAAAAAAAgAW5UNqAAAAADLnQ2oAAAAAluVDagAAAAD/";

    #[test]
    fn decodes_live_devnet_escrow() {
        let raw = base64::engine::general_purpose::STANDARD.decode(DEVNET_ESCROW_B64).unwrap();
        let e = decode_escrow_account(&raw).unwrap();
        assert_eq!(e.state, ESCROW_STATE_DONE);
        assert!(e.amount_micro > 0);
        assert!(e.dispute_deadline_secs > e.done_deadline_secs - e.execution_window_secs);
        assert_eq!(e.task_id_hex.len(), 64);
        // Реальные поля живого эскроу — донор/стример/резолвер валидные base58 по 32 байта.
        for addr in [&e.donor, &e.streamer, &e.resolver] {
            assert_eq!(bs58::decode(addr).into_vec().unwrap().len(), 32);
        }
    }

    /// Полный цикл: открытие по подписи → голоса-подписи → финализация таймером →
    /// вердикт + журнал-эффекты + учёт депозита.
    #[test]
    fn full_dispute_flow() {
        let ch = "arb-chan";
        let (owner_sk, owner) = key(11); // владелец канала = streamer эскроу (допущение v1)
        let _ = owner_sk;
        let (init_sk, initiator) = key(12);
        let (j1_sk, juror1) = key(13);
        let (j2_sk, juror2) = key(14);

        // Журнал: активация (владелец) + веса инициатора и присяжных на канале.
        journal(EntryKind::Activation, ch, &owner, 0, 100, "arb-act");
        journal(EntryKind::Donation, ch, &initiator, 5_000_000, 200, "arb-d1"); // 5 очков
        journal(EntryKind::Donation, ch, &juror1, 10_000_000, 200, "arb-d2");
        journal(EntryKind::Donation, ch, &juror2, 3_000_000, 200, "arb-d3");

        let now = 1_000_000_000_000i64; // мс
        let escrow = EscrowInfo {
            task_id_hex: "ab".repeat(32),
            donor: "DonorAddr111".into(),
            streamer: owner.clone(),
            resolver: "ResolverAddr".into(),
            amount_micro: 25_000_000, // $25 → кворум K=2: ceil(2·5)=10 очков
            execution_window_secs: 120,
            state: ESCROW_STATE_DONE,
            accept_deadline_secs: now / 1000 - 100,
            done_deadline_secs: now / 1000 - 50,
            dispute_deadline_secs: now / 1000 + 100,
        };

        // Не тот подписант → отказ.
        let args = OpenDisputeArgs {
            escrow_account: "EscrowAcc111".into(),
            channel_id: ch.into(),
            by: initiator.clone(),
            signature_b58: sig(&j1_sk, &build_open_message("EscrowAcc111", ch, &initiator)),
        };
        assert!(open_dispute_with_escrow(&args, escrow.clone(), None, now).is_err());

        // Валидное открытие.
        let args = OpenDisputeArgs {
            signature_b58: sig(&init_sk, &build_open_message("EscrowAcc111", ch, &initiator)),
            ..args
        };
        let case = open_dispute_with_escrow(&args, escrow.clone(), None, now).unwrap();
        assert_eq!(case.task.status.as_str(), "DISPUTED");
        // Кворум — фикс от стримера (без записи параметров действует дефолт 1 очко).
        assert_eq!(case.task.dispute.as_ref().unwrap().quorum_micro, 1_000_000);
        // Повторное открытие → отказ.
        assert!(open_dispute_with_escrow(&args, escrow.clone(), None, now).is_err());

        // Голоса: juror1 «не выполнил» (вес 10), juror2 «выполнил» (вес 3).
        let vmsg = build_vote_message("EscrowAcc111", ch, &juror1, VoteChoice::NotCompleted);
        cast_vote(
            &CastVoteArgs {
                escrow_account: "EscrowAcc111".into(),
                voter: juror1.clone(),
                choice: VoteChoice::NotCompleted,
                signature_b58: sig(&j1_sk, &vmsg),
            },
            now + 10_000,
        )
        .unwrap();
        // Подпись за ДРУГОЙ выбор не подойдёт (choice внутри сообщения).
        assert!(cast_vote(
            &CastVoteArgs {
                escrow_account: "EscrowAcc111".into(),
                voter: juror2.clone(),
                choice: VoteChoice::NotCompleted,
                signature_b58: sig(&j2_sk, &build_vote_message("EscrowAcc111", ch, &juror2, VoteChoice::Completed)),
            },
            now + 11_000,
        )
        .is_err());
        cast_vote(
            &CastVoteArgs {
                escrow_account: "EscrowAcc111".into(),
                voter: juror2.clone(),
                choice: VoteChoice::Completed,
                signature_b58: sig(&j2_sk, &build_vote_message("EscrowAcc111", ch, &juror2, VoteChoice::Completed)),
            },
            now + 11_000,
        )
        .unwrap();

        // До конца окна финализация не срабатывает (дефолтное окно голосования 120 с).
        assert_eq!(finalize_due(now + 60_000), 0);
        // После конца: 13 очков ≥ кворума 10; «не выполнил» 10 > 3 → донору, инициатору +10.
        assert_eq!(finalize_due(now + 121_000), 1);
        let done = case_of("EscrowAcc111").unwrap();
        let v = done.verdict.as_ref().unwrap();
        assert_eq!(v.outcome.as_str(), "to_donor");
        assert_eq!(v.reason.as_str(), "vote_not_completed");
        assert_eq!(v.tally_not_completed_micro, 10_000_000);

        // Журнал получил DISPUTE_WON (+10 очков) инициатору; вес инициатора вырос.
        let w_before = weight_as_of_micro(ch, &initiator, now);
        let w_after = weight_as_of_micro(ch, &initiator, now + 122_000);
        assert_eq!(w_before, 5_000_000);
        assert_eq!(w_after, 15_000_000);
    }

    /// Кросс-языковой пин: сообщения сверяются с общей фикстурой testdata/golden/messages.json
    /// (порождает TS `npm run golden`) — тексты TS↔Rust не могут разойтись молча.
    #[test]
    fn canonical_messages_pinned() {
        assert_eq!(
            build_open_message("ESCROW", "chan-1", "BY"),
            crate::test_fixtures::canonical_message("openDispute")
        );
        assert_eq!(
            build_vote_message("ESCROW", "chan-1", "VOTER", VoteChoice::NotCompleted),
            crate::test_fixtures::canonical_message("vote")
        );
    }
}
