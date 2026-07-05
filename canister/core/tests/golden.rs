//! Golden-паритет TS ↔ Rust (docs/migration-plan.md §0.1): эти тесты читают ТЕ ЖЕ векторы,
//! что породил `npm run golden` из живой TS-логики, и требуют совпадения байт-в-байт.
//! Расхождение хоть в одном векторе = стоп миграции.
//!
//! Светофор: `npm run golden && (cd canister && cargo test)`.

use serde_json::Value;
use standing_core::disputes::{
    accept, apply_resolution, cancel, cast_vote, claim, create_task, due_resolution, mark_done,
    raise_dispute, rep_effects, tally, CreateTaskInput, MachineError, Task, TaskVote, VoteChoice,
    Windows,
};
use standing_core::donation::{extract_activation, extract_donation, ParsedTx};
use standing_core::reputation::{
    compute_points_micro, compute_points_micro_as_of, points_for_amount_micro, LedgerEntry,
};
use std::path::PathBuf;

fn golden(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../testdata/golden")
        .join(name);
    let raw = std::fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "не найден {} ({e}) — сначала выгрузи эталон: `npm run golden`",
            path.display()
        )
    });
    serde_json::from_str(&raw).expect("golden-файл не парсится")
}

fn as_vec<'a>(v: &'a Value, key: &str) -> &'a Vec<Value> {
    v.get(key)
        .and_then(Value::as_array)
        .unwrap_or_else(|| panic!("в golden нет массива `{key}`"))
}

// ─────────────── время: ISO эталона → epoch мс (машина живёт в мс) ───────────────

/// Дни от эпохи по календарной дате (алгоритм civil_from_days Говарда Хиннанта, инверсия).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// "YYYY-MM-DDTHH:MM:SS.mmmZ" → epoch мс (формат `Date.toISOString()`, только он).
fn parse_iso_ms(s: &str) -> i64 {
    let b = s.as_bytes();
    assert!(b.len() == 24 && b[23] == b'Z', "не ISO-строка эталона: {s}");
    let num = |from: usize, to: usize| -> i64 { s[from..to].parse().expect("число в ISO") };
    days_from_civil(num(0, 4), num(5, 7), num(8, 10)) * 86_400_000
        + num(11, 13) * 3_600_000
        + num(14, 16) * 60_000
        + num(17, 19) * 1_000
        + num(20, 23)
}

// ─────────────── donations.json ───────────────

fn parse_tx(v: &Value) -> Option<ParsedTx> {
    if v.is_null() {
        None
    } else {
        Some(serde_json::from_value(v.clone()).expect("tx-срез не парсится в ParsedTx"))
    }
}

#[test]
fn golden_donations() {
    let g = golden("donations.json");
    let mint = g["addresses"]["MINT"].as_str().unwrap();
    let treasury = g["addresses"]["TREASURY_ATA"].as_str().unwrap();

    for vector in as_vec(&g, "donations") {
        let name = vector["name"].as_str().unwrap();
        let tx = parse_tx(&vector["tx"]);
        let signature = vector["signature"].as_str().unwrap();
        let got = extract_donation(tx.as_ref(), signature, mint, treasury)
            .map(|d| d.to_json())
            .unwrap_or(Value::Null);
        assert_eq!(got, vector["expected"], "donation vector `{name}` разошёлся");
    }
}

#[test]
fn golden_activations() {
    let g = golden("donations.json");
    let mint = g["addresses"]["MINT"].as_str().unwrap();
    let treasury = g["addresses"]["TREASURY_ATA"].as_str().unwrap();

    for vector in as_vec(&g, "activations") {
        let name = vector["name"].as_str().unwrap();
        let tx = parse_tx(&vector["tx"]);
        let signature = vector["signature"].as_str().unwrap();
        let got = extract_activation(tx.as_ref(), signature, mint, treasury)
            .map(|a| a.to_json())
            .unwrap_or(Value::Null);
        assert_eq!(got, vector["expected"], "activation vector `{name}` разошёлся");
    }
}

// ─────────────── reputation.json ───────────────

fn entries(v: &Value) -> Vec<LedgerEntry> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|e| LedgerEntry {
            points_delta_micro: e["pointsDeltaMicro"].as_i64().unwrap() as i128,
            ts_ms: e["tsMs"].as_i64().unwrap(),
        })
        .collect()
}

#[test]
fn golden_points_for_amount() {
    let g = golden("reputation.json");
    for vector in as_vec(&g, "pointsForAmount") {
        let amount: i128 = vector["amountMicro"].as_str().unwrap().parse().unwrap();
        let expected = vector["expectedMicroPoints"].as_i64().unwrap() as i128;
        assert_eq!(points_for_amount_micro(amount), expected, "pointsForAmount({amount})");
    }
}

#[test]
fn golden_compute_points() {
    let g = golden("reputation.json");
    for vector in as_vec(&g, "computePoints") {
        let name = vector["name"].as_str().unwrap();
        let got =
            compute_points_micro(entries(&vector["events"]).iter().map(|e| e.points_delta_micro));
        let expected = vector["expectedMicroPoints"].as_i64().unwrap() as i128;
        assert_eq!(got, expected, "computePoints `{name}`");
    }
}

#[test]
fn golden_compute_points_as_of() {
    let g = golden("reputation.json");
    for vector in as_vec(&g, "computePointsAsOf") {
        let name = vector["name"].as_str().unwrap();
        let got = compute_points_micro_as_of(
            &entries(&vector["events"]),
            vector["asOfMs"].as_i64().unwrap(),
        );
        let expected = vector["expectedMicroPoints"].as_i64().unwrap() as i128;
        assert_eq!(got, expected, "computePointsAsOf `{name}`");
    }
}

// ─────────────── disputes.json: tally ───────────────

fn choice_of(s: &str) -> VoteChoice {
    match s {
        "completed" => VoteChoice::Completed,
        "not_completed" => VoteChoice::NotCompleted,
        other => panic!("неизвестный choice `{other}`"),
    }
}

fn parse_tally_votes(v: &Value) -> Vec<TaskVote> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|vote| TaskVote {
            voter: vote["voter"].as_str().unwrap().to_string(),
            choice: choice_of(vote["choice"].as_str().unwrap()),
            weight_micro: vote["weightMicro"].as_i64().unwrap() as i128,
            at_ms: 0,
        })
        .collect()
}

#[test]
fn golden_tally() {
    let g = golden("disputes.json");
    for vector in as_vec(&g, "tally") {
        let name = vector["name"].as_str().unwrap();
        let votes = parse_tally_votes(&vector["dispute"]["votes"]);
        let quorum = vector["dispute"]["quorumMicro"].as_i64().unwrap() as i128;
        let (outcome, reason) = tally(&votes, quorum);
        assert_eq!(
            outcome.as_str(),
            vector["expected"]["outcome"].as_str().unwrap(),
            "tally `{name}` outcome"
        );
        assert_eq!(
            reason.as_str(),
            vector["expected"]["reason"].as_str().unwrap(),
            "tally `{name}` reason"
        );
    }
}

// ─────────────── disputes.json: сценарии машины (полный порт M2) ───────────────

fn windows_of(g: &Value) -> Windows {
    let w = &g["constants"]["WINDOWS"];
    let ms = |k: &str| w[k].as_i64().unwrap_or_else(|| panic!("нет WINDOWS.{k}"));
    Windows {
        grace_ms: ms("grace"),
        execution_default_ms: ms("executionDefault"),
        execution_min_ms: ms("executionMin"),
        execution_max_ms: ms("executionMax"),
        dispute_window_ms: ms("disputeWindow"),
        voting_ms: ms("voting"),
    }
}

/// f64-очки эталона → целые micro (домен — кратные 1e-6, конверсия точна).
fn micro_of(v: &Value) -> i128 {
    (v.as_f64().expect("число очков") * 1e6).round() as i128
}

/// Сверка состояния порта со снапшотом TS. Текст-поля (text/textState/reports/hidden/
/// operatorBlocked/escrow*) — кожа и ончейн-склейка, канистре не принадлежат — игнорируются.
fn assert_task(task: &Task, snap: &Value, ctx: &str) {
    let s = |k: &str| snap[k].as_str().unwrap_or_else(|| panic!("{ctx}: нет `{k}`"));
    assert_eq!(task.id, s("id"), "{ctx}: id");
    assert_eq!(task.channel_id, s("channelId"), "{ctx}: channelId");
    assert_eq!(task.donor, s("donor"), "{ctx}: donor");
    assert_eq!(task.amount_micro, s("amount").parse::<u64>().unwrap(), "{ctx}: amount");
    assert_eq!(task.status.as_str(), s("status"), "{ctx}: status");
    assert_eq!(task.created_at_ms, parse_iso_ms(s("createdAt")), "{ctx}: createdAt");
    assert_eq!(
        task.execution_deadline_ms,
        parse_iso_ms(s("executionDeadline")),
        "{ctx}: executionDeadline"
    );
    assert_eq!(task.grace_until_ms, parse_iso_ms(s("graceUntil")), "{ctx}: graceUntil");

    match snap.get("disputeWindowEndsAt").and_then(Value::as_str) {
        Some(iso) => assert_eq!(
            task.dispute_window_ends_at_ms,
            Some(parse_iso_ms(iso)),
            "{ctx}: disputeWindowEndsAt"
        ),
        None => assert_eq!(task.dispute_window_ends_at_ms, None, "{ctx}: disputeWindowEndsAt None"),
    }

    match snap.get("dispute").filter(|d| !d.is_null()) {
        Some(d) => {
            let td = task.dispute.as_ref().unwrap_or_else(|| panic!("{ctx}: нет dispute в порте"));
            assert_eq!(td.by, d["by"].as_str().unwrap(), "{ctx}: dispute.by");
            assert_eq!(
                td.opened_at_ms,
                parse_iso_ms(d["openedAt"].as_str().unwrap()),
                "{ctx}: dispute.openedAt"
            );
            assert_eq!(
                td.voting_ends_at_ms,
                parse_iso_ms(d["votingEndsAt"].as_str().unwrap()),
                "{ctx}: dispute.votingEndsAt"
            );
            assert_eq!(td.quorum_micro, micro_of(&d["quorum"]), "{ctx}: dispute.quorum");
            let votes = d["votes"].as_array().unwrap();
            assert_eq!(td.votes.len(), votes.len(), "{ctx}: число голосов");
            for (got, want) in td.votes.iter().zip(votes) {
                assert_eq!(got.voter, want["voter"].as_str().unwrap(), "{ctx}: voter");
                assert_eq!(got.choice.as_str(), want["choice"].as_str().unwrap(), "{ctx}: choice");
                assert_eq!(got.weight_micro, micro_of(&want["weight"]), "{ctx}: weight");
                assert_eq!(got.at_ms, parse_iso_ms(want["at"].as_str().unwrap()), "{ctx}: vote.at");
            }
        }
        None => assert!(task.dispute.is_none(), "{ctx}: dispute должен отсутствовать"),
    }

    match snap.get("resolution").filter(|r| !r.is_null()) {
        Some(r) => {
            let tr =
                task.resolution.as_ref().unwrap_or_else(|| panic!("{ctx}: нет resolution в порте"));
            assert_eq!(tr.outcome.as_str(), r["outcome"].as_str().unwrap(), "{ctx}: outcome");
            assert_eq!(tr.reason.as_str(), r["reason"].as_str().unwrap(), "{ctx}: reason");
            assert_eq!(
                tr.resolved_at_ms,
                parse_iso_ms(r["resolvedAt"].as_str().unwrap()),
                "{ctx}: resolvedAt"
            );
            assert_eq!(tr.claimed, r["claimed"].as_bool().unwrap(), "{ctx}: claimed");
        }
        None => assert!(task.resolution.is_none(), "{ctx}: resolution должен отсутствовать"),
    }
}

fn assert_effects(
    got: &[standing_core::disputes::RepEffect],
    expected: &Value,
    ctx: &str,
) {
    let want = expected.as_array().unwrap_or_else(|| panic!("{ctx}: repEffects не массив"));
    assert_eq!(got.len(), want.len(), "{ctx}: число эффектов");
    for (g, w) in got.iter().zip(want) {
        assert_eq!(g.address, w["address"].as_str().unwrap(), "{ctx}: effect.address");
        assert_eq!(g.kind, w["type"].as_str().unwrap(), "{ctx}: effect.type");
        assert_eq!(
            g.points_delta_micro,
            w["pointsDeltaMicro"].as_i64().unwrap() as i128,
            "{ctx}: effect.pointsDeltaMicro"
        );
        match w.get("amount").and_then(Value::as_str) {
            Some(a) => assert_eq!(g.amount_micro, Some(a.parse::<u64>().unwrap()), "{ctx}: effect.amount"),
            None => assert_eq!(g.amount_micro, None, "{ctx}: effect.amount None"),
        }
    }
}

fn run_op(task: &Task, op: &str, step: &Value, w: &Windows, now: i64) -> Result<Task, MachineError> {
    let args = &step["args"];
    match op {
        "accept" => accept(task, now),
        "reject" => reject_op(task, now),
        "cancel" => cancel(task, now),
        "markDone" => mark_done(task, w, now),
        "raiseDispute" => raise_dispute(
            task,
            args["by"].as_str().unwrap(),
            args["quorumMicro"].as_i64().unwrap() as i128,
            w,
            now,
        ),
        "castVote" => {
            let v = &args["vote"];
            cast_vote(
                task,
                TaskVote {
                    voter: v["voter"].as_str().unwrap().to_string(),
                    choice: choice_of(v["choice"].as_str().unwrap()),
                    weight_micro: v["weightMicro"].as_i64().unwrap() as i128,
                    at_ms: parse_iso_ms(v["at"].as_str().unwrap()),
                },
                now,
            )
        }
        "claim" => claim(
            task,
            args["by"].as_str().unwrap(),
            args["streamerAddress"].as_str().unwrap(),
            now,
        ),
        other => panic!("неизвестный op `{other}`"),
    }
}

// reject — не ключевое слово, но алиас для симметрии run_op.
fn reject_op(task: &Task, now: i64) -> Result<Task, MachineError> {
    standing_core::disputes::reject(task, now)
}

fn assert_due(due: Option<(standing_core::disputes::TaskOutcome, standing_core::disputes::ResolutionReason)>, expected: &Value, ctx: &str) {
    if expected.is_null() {
        assert!(due.is_none(), "{ctx}: ожидался null-исход, порт дал {due:?}");
    } else {
        let (o, r) = due.unwrap_or_else(|| panic!("{ctx}: порт дал None, ожидался исход"));
        assert_eq!(o.as_str(), expected["outcome"].as_str().unwrap(), "{ctx}: due.outcome");
        assert_eq!(r.as_str(), expected["reason"].as_str().unwrap(), "{ctx}: due.reason");
    }
}

#[test]
fn golden_scenarios() {
    let g = golden("disputes.json");
    let w = windows_of(&g);
    let scenarios = as_vec(&g, "scenarios");
    assert!(!scenarios.is_empty(), "сценарии пусты");

    for s in scenarios {
        let name = s["name"].as_str().unwrap();
        let t0 = s["t0Ms"].as_i64().unwrap();
        let input = &s["create"]["input"];
        let mut task = create_task(
            CreateTaskInput {
                id: input["id"].as_str().unwrap().to_string(),
                channel_id: input["channelId"].as_str().unwrap().to_string(),
                donor: input["donor"].as_str().unwrap().to_string(),
                amount_micro: input["amount"].as_str().unwrap().parse().unwrap(),
                execution_ms: input.get("executionMs").and_then(Value::as_i64),
            },
            &w,
            t0,
        );
        assert_task(&task, &s["create"]["expected"], &format!("{name}/create"));

        for (i, step) in s["steps"].as_array().unwrap().iter().enumerate() {
            let now = step["atMs"].as_i64().unwrap();
            let op = step["op"].as_str().unwrap();
            let expected = &step["expected"];
            let ctx = format!("{name}/step{i}:{op}");

            if let Some(code) = expected.get("error").and_then(Value::as_str) {
                // Ошибочный шаг: код 1:1 с GameBusError, состояние НЕ меняется.
                let got = run_op(&task, op, step, &w, now)
                    .expect_err(&format!("{ctx}: ожидалась ошибка {code}"));
                assert_eq!(got.code, code, "{ctx}: код ошибки");
                continue;
            }
            match op {
                "dueResolution" => assert_due(due_resolution(&task, now), &expected["due"], &ctx),
                "applyDue" => {
                    let (o, r) = due_resolution(&task, now)
                        .unwrap_or_else(|| panic!("{ctx}: dueResolution дал None"));
                    assert_due(Some((o, r)), &expected["due"], &ctx);
                    // Эффекты считаются на состоянии ДО применения (как в раннере эталона).
                    assert_effects(&rep_effects(&task, o, r), &expected["repEffects"], &ctx);
                    task = apply_resolution(&task, o, r, now);
                    assert_task(&task, &expected["task"], &ctx);
                }
                _ => {
                    task = run_op(&task, op, step, &w, now)
                        .unwrap_or_else(|e| panic!("{ctx}: неожиданная ошибка {}", e.code));
                    assert_task(&task, &expected["task"], &ctx);
                }
            }
        }

        // Финал: состояние + эффекты от финального resolution (null = задание не разрешено).
        assert_task(&task, &s["final"]["task"], &format!("{name}/final"));
        let final_effects = &s["final"]["repEffects"];
        if final_effects.is_null() {
            assert!(task.resolution.is_none(), "{name}: repEffects null, но resolution есть");
        } else {
            let res = task.resolution.as_ref().unwrap();
            assert_effects(
                &rep_effects(&task, res.outcome, res.reason),
                final_effects,
                &format!("{name}/final-effects"),
            );
        }
    }
}
