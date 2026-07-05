//! Машина заданий-донатов и споров — ПОЛНЫЙ порт `src/games/escrow-task/machine.ts` (M2).
//! Паритет с TS держат golden-сценарии (`testdata/golden/disputes.json`, 21 сценарий:
//! все переходы, коды ошибок, граничные `>`/`<=`, репут-эффекты) — tests/golden.rs.
//!
//! Нативные единицы канистры: время — epoch мс (i64), деньги — micro-USDC (u64),
//! веса/кворум/дельты — ЦЕЛЫЕ micro-очки (i128; решение M2 — yellow-paper §18.5-9:
//! никакого float, TS-градус свободы у границы «ничья» закрыт целочисленной арифметикой).
//!
//! Окна процесса приходят ПАРАМЕТРОМ (`Windows`): на интеграции M2 их даёт governance-конфиг
//! канала (dispute/voting) + константы эскроу (grace/execution). Машина, как и в TS, проверяет
//! только СОСТОЯНИЕ и ВРЕМЯ; авторизацию и вычисление веса/кворума делает вызывающий слой.
//!
//! Вне порта — намеренно (кожа, канистра текстов не касается): text/textState/reports/hidden/
//! operatorBlocked и переходы report/setTextState/hide/isTextPublic.

/// Изменение репутации за спор (micro-очки): +10 за подтверждённый, −50 инициатору за проигранный.
pub const DISPUTE_WIN_BONUS_MICRO: i128 = 10_000_000;
pub const DISPUTE_LOSS_PENALTY_MICRO: i128 = 50_000_000;

/// Окна процесса, мс (порт `WINDOWS` из machine.ts; значения задаёт вызывающий слой).
#[derive(Debug, Clone, Copy)]
pub struct Windows {
    pub grace_ms: i64,
    pub execution_default_ms: i64,
    pub execution_min_ms: i64,
    pub execution_max_ms: i64,
    pub dispute_window_ms: i64,
    pub voting_ms: i64,
}

use candid::CandidType;
use serde::{Deserialize, Serialize};

#[derive(CandidType, Deserialize, Serialize, Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskStatus {
    Pending,
    Accepted,
    Done,
    Disputed,
    Resolved,
}

impl TaskStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            TaskStatus::Pending => "PENDING",
            TaskStatus::Accepted => "ACCEPTED",
            TaskStatus::Done => "DONE",
            TaskStatus::Disputed => "DISPUTED",
            TaskStatus::Resolved => "RESOLVED",
        }
    }
}

#[derive(CandidType, Deserialize, Serialize, Debug, Clone, Copy, PartialEq, Eq)]
pub enum VoteChoice {
    Completed,
    NotCompleted,
}

impl VoteChoice {
    pub fn as_str(&self) -> &'static str {
        match self {
            VoteChoice::Completed => "completed",
            VoteChoice::NotCompleted => "not_completed",
        }
    }
}

#[derive(CandidType, Deserialize, Serialize, Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskOutcome {
    ToStreamer,
    ToDonor,
}

impl TaskOutcome {
    pub fn as_str(&self) -> &'static str {
        match self {
            TaskOutcome::ToStreamer => "to_streamer",
            TaskOutcome::ToDonor => "to_donor",
        }
    }
}

/// Полный набор причин исхода (порт `ResolutionReason`).
#[derive(CandidType, Deserialize, Serialize, Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResolutionReason {
    Rejected,
    Expired,
    Canceled,
    NoShow,
    Completed,
    VoteCompleted,
    VoteNotCompleted,
    NoQuorum,
    Tie,
}

impl ResolutionReason {
    pub fn as_str(&self) -> &'static str {
        match self {
            ResolutionReason::Rejected => "rejected",
            ResolutionReason::Expired => "expired",
            ResolutionReason::Canceled => "canceled",
            ResolutionReason::NoShow => "no_show",
            ResolutionReason::Completed => "completed",
            ResolutionReason::VoteCompleted => "vote_completed",
            ResolutionReason::VoteNotCompleted => "vote_not_completed",
            ResolutionReason::NoQuorum => "no_quorum",
            ResolutionReason::Tie => "tie",
        }
    }
}

#[derive(CandidType, Deserialize, Serialize, Debug, Clone)]
pub struct TaskVote {
    pub voter: String,
    pub choice: VoteChoice,
    pub weight_micro: i128,
    pub at_ms: i64,
}

#[derive(CandidType, Deserialize, Serialize, Debug, Clone)]
pub struct TaskDispute {
    pub by: String,
    pub opened_at_ms: i64,
    pub voting_ends_at_ms: i64,
    pub quorum_micro: i128,
    pub votes: Vec<TaskVote>,
}

#[derive(CandidType, Deserialize, Serialize, Debug, Clone)]
pub struct TaskResolution {
    pub outcome: TaskOutcome,
    pub reason: ResolutionReason,
    pub resolved_at_ms: i64,
    pub claimed: bool,
}

/// Задание-донат (хранимая часть машины; текст/кожа — вне канистры).
#[derive(CandidType, Deserialize, Serialize, Debug, Clone)]
pub struct Task {
    pub id: String,
    pub channel_id: String,
    pub donor: String,
    pub amount_micro: u64,
    pub created_at_ms: i64,
    /// Срок сдачи от СОЗДАНИЯ (= ончейн done_deadline).
    pub execution_deadline_ms: i64,
    /// Грейс-окно отмены донора от создания; accept его НЕ сбрасывает.
    pub grace_until_ms: i64,
    pub status: TaskStatus,
    pub dispute_window_ends_at_ms: Option<i64>,
    pub dispute: Option<TaskDispute>,
    pub resolution: Option<TaskResolution>,
}

/// Ошибка перехода: код 1:1 с `GameBusError` TS (их сверяют golden-сценарии).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MachineError {
    pub code: &'static str,
}

fn err<T>(code: &'static str) -> Result<T, MachineError> {
    Err(MachineError { code })
}

/// Эффект на репутацию по разрешению (банкует вызывающий слой).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepEffect {
    pub address: String,
    /// "DONATION" | "DISPUTE_WON" | "DISPUTE_LOST" — как в журнале.
    pub kind: &'static str,
    pub points_delta_micro: i128,
    pub amount_micro: Option<u64>,
}

// ───────────────────────── переходы (порт machine.ts) ─────────────────────────

pub struct CreateTaskInput {
    pub id: String,
    pub channel_id: String,
    pub donor: String,
    pub amount_micro: u64,
    /// Предложенный донором срок сдачи, мс (клампится в границы окна).
    pub execution_ms: Option<i64>,
}

pub fn create_task(input: CreateTaskInput, w: &Windows, now_ms: i64) -> Task {
    // ESC-17: нижняя граница срока сдачи ОБЯЗАНА превышать грейс (иначе окно mark_done пустое).
    let proposed = input
        .execution_ms
        .unwrap_or(w.execution_default_ms)
        .clamp(w.execution_min_ms.max(w.grace_ms + 1), w.execution_max_ms);
    Task {
        id: input.id,
        channel_id: input.channel_id,
        donor: input.donor,
        amount_micro: input.amount_micro,
        created_at_ms: now_ms,
        execution_deadline_ms: now_ms + proposed,
        grace_until_ms: now_ms + w.grace_ms,
        status: TaskStatus::Pending,
        dispute_window_ends_at_ms: None,
        dispute: None,
        resolution: None,
    }
}

pub fn accept(task: &Task, now_ms: i64) -> Result<Task, MachineError> {
    if task.status != TaskStatus::Pending {
        return err("NOT_PENDING");
    }
    if now_ms > task.execution_deadline_ms {
        return err("ACCEPT_EXPIRED");
    }
    // ESC-19 (раскрытие текста при accept) — кожа, здесь только статус.
    Ok(Task { status: TaskStatus::Accepted, ..task.clone() })
}

pub fn reject(task: &Task, now_ms: i64) -> Result<Task, MachineError> {
    if task.status != TaskStatus::Pending && task.status != TaskStatus::Accepted {
        return err("NOT_OPEN");
    }
    Ok(apply_resolution(task, TaskOutcome::ToDonor, ResolutionReason::Rejected, now_ms))
}

pub fn cancel(task: &Task, now_ms: i64) -> Result<Task, MachineError> {
    if task.status != TaskStatus::Pending && task.status != TaskStatus::Accepted {
        return err("NOT_OPEN");
    }
    // Грейс-окно от создания (= grace_until_ms; accept не сбрасывает) — граница НЕстрогая.
    if now_ms > task.grace_until_ms {
        return err("GRACE_OVER");
    }
    Ok(apply_resolution(task, TaskOutcome::ToDonor, ResolutionReason::Canceled, now_ms))
}

pub fn mark_done(task: &Task, w: &Windows, now_ms: i64) -> Result<Task, MachineError> {
    if task.status != TaskStatus::Pending && task.status != TaskStatus::Accepted {
        return err("NOT_OPEN");
    }
    // ESC-13: нельзя сдать в грейс-окне отмены донора (граница ВКЛЮЧИТЕЛЬНО, `<=` как в TS).
    if now_ms <= task.grace_until_ms {
        return err("GRACE_ACTIVE");
    }
    if now_ms > task.execution_deadline_ms {
        return err("EXEC_OVER");
    }
    Ok(Task {
        status: TaskStatus::Done,
        dispute_window_ends_at_ms: Some(now_ms + w.dispute_window_ms),
        ..task.clone()
    })
}

pub fn raise_dispute(
    task: &Task,
    by: &str,
    quorum_micro: i128,
    w: &Windows,
    now_ms: i64,
) -> Result<Task, MachineError> {
    if task.status != TaskStatus::Done {
        return err("NOT_DONE");
    }
    // Как в TS: `?? task.createdAt` — фоллбек недостижим из DONE, но семантику сохраняем.
    if now_ms > task.dispute_window_ends_at_ms.unwrap_or(task.created_at_ms) {
        return err("DISPUTE_WINDOW_OVER");
    }
    Ok(Task {
        status: TaskStatus::Disputed,
        dispute: Some(TaskDispute {
            by: by.to_string(),
            opened_at_ms: now_ms,
            voting_ends_at_ms: now_ms + w.voting_ms,
            quorum_micro,
            votes: Vec::new(),
        }),
        ..task.clone()
    })
}

pub fn cast_vote(task: &Task, vote: TaskVote, now_ms: i64) -> Result<Task, MachineError> {
    let Some(dispute) = &task.dispute else {
        return err("NOT_DISPUTED");
    };
    if task.status != TaskStatus::Disputed {
        return err("NOT_DISPUTED");
    }
    if now_ms > dispute.voting_ends_at_ms {
        return err("VOTING_OVER");
    }
    if dispute.votes.iter().any(|v| v.voter == vote.voter) {
        return err("ALREADY_VOTED");
    }
    let mut next = task.clone();
    next.dispute.as_mut().expect("dispute").votes.push(vote);
    Ok(next)
}

// ───────────────────────── разрешение (время + голоса) ─────────────────────────

/// Порт `tally`: кворум по СУММЕ весов включительно; ничья и недобор → стримеру (презумпция §11).
pub fn tally(votes: &[TaskVote], quorum_micro: i128) -> (TaskOutcome, ResolutionReason) {
    let mut completed: i128 = 0;
    let mut not: i128 = 0;
    for v in votes {
        match v.choice {
            VoteChoice::Completed => completed += v.weight_micro,
            VoteChoice::NotCompleted => not += v.weight_micro,
        }
    }
    if completed + not < quorum_micro {
        return (TaskOutcome::ToStreamer, ResolutionReason::NoQuorum);
    }
    if completed > not {
        (TaskOutcome::ToStreamer, ResolutionReason::VoteCompleted)
    } else if not > completed {
        (TaskOutcome::ToDonor, ResolutionReason::VoteNotCompleted)
    } else {
        (TaskOutcome::ToStreamer, ResolutionReason::Tie)
    }
}

/// Терминальный исход, наступивший ПО ВРЕМЕНИ (все границы строгие `>`, как в TS). None — рано.
pub fn due_resolution(task: &Task, now_ms: i64) -> Option<(TaskOutcome, ResolutionReason)> {
    match task.status {
        TaskStatus::Pending => (now_ms > task.execution_deadline_ms)
            .then_some((TaskOutcome::ToDonor, ResolutionReason::Expired)),
        TaskStatus::Accepted => (now_ms > task.execution_deadline_ms)
            .then_some((TaskOutcome::ToDonor, ResolutionReason::NoShow)),
        TaskStatus::Done => match task.dispute_window_ends_at_ms {
            Some(ends) if now_ms > ends => {
                Some((TaskOutcome::ToStreamer, ResolutionReason::Completed))
            }
            _ => None,
        },
        TaskStatus::Disputed => match &task.dispute {
            Some(d) if now_ms > d.voting_ends_at_ms => Some(tally(&d.votes, d.quorum_micro)),
            _ => None,
        },
        TaskStatus::Resolved => None,
    }
}

pub fn apply_resolution(
    task: &Task,
    outcome: TaskOutcome,
    reason: ResolutionReason,
    now_ms: i64,
) -> Task {
    Task {
        status: TaskStatus::Resolved,
        resolution: Some(TaskResolution { outcome, reason, resolved_at_ms: now_ms, claimed: false }),
        ..task.clone()
    }
}

/// Эффекты на репутацию (порт `repEffects`, ADR 0015): деньги дошли стримеру → DONATION донору;
/// проигранный спор → −50 инициатору; подтверждённый → +10. Возврат донору репутации не даёт.
pub fn rep_effects(task: &Task, outcome: TaskOutcome, reason: ResolutionReason) -> Vec<RepEffect> {
    let mut out = Vec::new();
    if outcome == TaskOutcome::ToStreamer {
        out.push(RepEffect {
            address: task.donor.clone(),
            kind: "DONATION",
            // Курс ADR 0007: micro-очки == micro-USDC полной суммы 1:1.
            points_delta_micro: crate::reputation::points_for_amount_micro(task.amount_micro as i128),
            amount_micro: Some(task.amount_micro),
        });
    }
    if let Some(d) = &task.dispute {
        if reason == ResolutionReason::VoteCompleted {
            out.push(RepEffect {
                address: d.by.clone(),
                kind: "DISPUTE_LOST",
                points_delta_micro: -DISPUTE_LOSS_PENALTY_MICRO,
                amount_micro: None,
            });
        }
        if reason == ResolutionReason::VoteNotCompleted {
            out.push(RepEffect {
                address: d.by.clone(),
                kind: "DISPUTE_WON",
                points_delta_micro: DISPUTE_WIN_BONUS_MICRO,
                amount_micro: None,
            });
        }
    }
    out
}

/// Забрать деньги: только получатель, один раз (claim-модель ADR 0015).
pub fn claim(
    task: &Task,
    by: &str,
    streamer_address: &str,
    _now_ms: i64,
) -> Result<Task, MachineError> {
    let Some(res) = &task.resolution else {
        return err("NOT_RESOLVED");
    };
    if task.status != TaskStatus::Resolved {
        return err("NOT_RESOLVED");
    }
    if res.claimed {
        return err("ALREADY_CLAIMED");
    }
    let winner = match res.outcome {
        TaskOutcome::ToStreamer => streamer_address,
        TaskOutcome::ToDonor => task.donor.as_str(),
    };
    if by != winner {
        return err("NOT_WINNER");
    }
    let mut next = task.clone();
    next.resolution.as_mut().expect("resolution").claimed = true;
    Ok(next)
}
