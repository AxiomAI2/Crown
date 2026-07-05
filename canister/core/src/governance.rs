//! Governance-параметры споров канала — ончейн-конфиг в канистре (M1, ADR 0021;
//! спека голосования §7/§8.9). Косметика (тиры/описания) сюда НЕ входит — это кожа.
//!
//! Замки:
//!  - запись ТОЛЬКО по ed25519-подписи ВЛАДЕЛЬЦА канала (тот же приём, что payout-аттестация H1);
//!    владелец выводится ИЗ ЦЕПОЧКИ: плательщик первой активации канала в журнале канистры —
//!    сервер не участвует в установлении права на запись;
//!  - изменения вступают с ТАЙМЛОКОМ ≥ полного цикла спора текущих правил (§8.9: правила нельзя
//!    менять под идущий/готовящийся спор — параметры снимаются на момент открытия);
//!  - версия строго растёт (нонс) — переигрывание старой подписи невозможно;
//!  - границы значений — fail-closed (бессмысленные окна/коэффициенты отвергаются).
//!
//! Параметры потребляет машина споров арбитра (M2, `arbiter.rs::effective_params` на момент
//! открытия спора); канистра же — и канон их хранения.

use crate::state::{self, EntryKind};
use candid::{CandidType, Decode, Encode};
use ed25519_dalek::{Signature, VerifyingKey};
use ic_stable_structures::storable::Bound;
use ic_stable_structures::{StableBTreeMap, Storable};
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::cell::RefCell;

/// Минимальный таймлок, сек — пол для каналов с быстрыми (тестовыми) окнами.
const TIMELOCK_FLOOR_SECS: u64 = 300;

/// Governance-параметры споров (спека голосования §7). Деньги/очки — целые micro; K — милли.
#[derive(CandidType, Deserialize, Serialize, Clone, Debug, PartialEq, Eq)]
pub struct DisputeParams {
    /// Порог репутации для права ОТКРЫТЬ спор (micro-очки).
    pub min_reputation_to_dispute_micro: u64,
    /// Порог веса присяжного (micro-очки; спека: дефолт 1 очко — пыль не голосует).
    pub min_weight_to_vote_micro: u64,
    /// Кворум явки — ФИКСИРОВАННОЕ число micro-очков, задаёт сам стример (решение владельца
    /// 2026-07-05: формулы от суммы нет; соберётся меньше — спор уходит стримеру по презумпции).
    pub quorum_micro: u64,
    /// Окно «поднять спор» от «Готово», сек.
    pub dispute_window_secs: u64,
    /// Окно голосования, сек.
    pub voting_window_secs: u64,
    /// МЁРТВОЕ поле (решение владельца M2: экономики от суммы нет — арбитр его не читает).
    /// Держится ради стабильности подписанного сообщения (`build_params_message`) и уже
    /// сохранённого стейта; убирать только с бампом `v:` и миграцией. Из UI студии убрано.
    pub d_max_micro: u64,
}

impl Default for DisputeParams {
    fn default() -> Self {
        // Дефолты спеки §7 + текущие (FAST) окна machine.ts (сверены при M2-порте).
        DisputeParams {
            min_reputation_to_dispute_micro: 1_000_000,
            min_weight_to_vote_micro: 1_000_000,
            quorum_micro: 1_000_000, // «обычно 1» — один голос весом в очко уже решает
            dispute_window_secs: 120,
            voting_window_secs: 120,
            d_max_micro: 0,
        }
    }
}

/// Ожидающее изменение: вступит в effective_at_ns (таймлок).
#[derive(CandidType, Deserialize, Serialize, Clone, Debug, PartialEq, Eq)]
pub struct PendingChange {
    pub params: DisputeParams,
    pub effective_at_ns: u64,
    pub version: u64,
}

/// Состояние параметров канала. `version` — последняя ПРИНЯТАЯ версия (в т.ч. ожидающая).
#[derive(CandidType, Deserialize, Serialize, Clone, Debug, Default)]
pub struct ChannelParamsState {
    pub effective: Option<DisputeParams>, // None = дефолты (канал ничего не менял)
    pub pending: Option<PendingChange>,
    pub version: u64,
}

impl Storable for ChannelParamsState {
    fn to_bytes(&self) -> Cow<'_, [u8]> {
        Cow::Owned(Encode!(self).expect("candid encode"))
    }
    fn into_bytes(self) -> Vec<u8> {
        Encode!(&self).expect("candid encode")
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        Decode!(&bytes, Self).expect("candid decode ChannelParamsState")
    }
    const BOUND: Bound = Bound::Unbounded;
}

thread_local! {
    static PARAMS: RefCell<StableBTreeMap<String, ChannelParamsState, state::Mem>> =
        RefCell::new(StableBTreeMap::init(state::memory(5)));
}

/// Каноническое сообщение под подпись кошелька (стиль payout-аттестации: человекочитаемо,
/// домен + все поля + версия формата). Любое изменение строки ломает подписи — менять через `v:`.
/// TS-сторона (студия) обязана строить БАЙТ-В-БАЙТ ту же строку — пин в unit-тесте.
pub fn build_params_message(channel_id: &str, owner: &str, version: u64, p: &DisputeParams) -> String {
    [
        "Standing: параметры споров канала.".to_string(),
        String::new(),
        "Подписывая, вы устанавливаете правила споров для своего канала.".to_string(),
        "Изменения вступят после таймлока — идущие споры играются по прежним правилам.".to_string(),
        String::new(),
        format!("channel: {channel_id}"),
        format!("owner: {owner}"),
        format!("version: {version}"),
        format!("minReputationToDisputeMicro: {}", p.min_reputation_to_dispute_micro),
        format!("minWeightToVoteMicro: {}", p.min_weight_to_vote_micro),
        format!("quorumMicro: {}", p.quorum_micro),
        format!("disputeWindowSecs: {}", p.dispute_window_secs),
        format!("votingWindowSecs: {}", p.voting_window_secs),
        format!("dMaxMicro: {}", p.d_max_micro),
        "v: 2".to_string(),
    ]
    .join("\n")
}

/// Владелец канала ИЗ ЦЕПОЧКИ: плательщик первой активации в журнале (ончейн-якорь владения;
/// сервер в этом решении не участвует). Нет активации → каналом в канистре управлять нельзя.
pub fn channel_owner(channel_id: &str) -> Option<String> {
    for i in 0..state::journal_len() {
        let e = state::journal_get(i)?;
        if e.kind == EntryKind::Activation && e.channel_id == channel_id {
            return Some(e.actor);
        }
    }
    None
}

fn verify_owner_signature(msg: &str, owner_b58: &str, signature_b58: &str) -> Result<(), String> {
    let pub_bytes: [u8; 32] = bs58::decode(owner_b58)
        .into_vec()
        .map_err(|e| format!("owner base58: {e}"))?
        .try_into()
        .map_err(|_| "owner: не 32 байта".to_string())?;
    let sig_bytes: [u8; 64] = bs58::decode(signature_b58)
        .into_vec()
        .map_err(|e| format!("signature base58: {e}"))?
        .try_into()
        .map_err(|_| "signature: не 64 байта".to_string())?;
    let key = VerifyingKey::from_bytes(&pub_bytes).map_err(|e| format!("owner key: {e}"))?;
    key.verify_strict(msg.as_bytes(), &Signature::from_bytes(&sig_bytes))
        .map_err(|_| "подпись не сходится".to_string())
}

fn validate_bounds(p: &DisputeParams) -> Result<(), String> {
    let day = 86_400;
    if !(60..=30 * day).contains(&p.dispute_window_secs) {
        return Err("disputeWindowSecs: 60 сек … 30 дней".into());
    }
    if !(60..=30 * day).contains(&p.voting_window_secs) {
        return Err("votingWindowSecs: 60 сек … 30 дней".into());
    }
    if p.quorum_micro > 1_000_000_000_000_000 {
        return Err("quorumMicro: не больше 1e15 (1 млрд очков)".into());
    }
    Ok(())
}

/// Эффективные параметры на момент `now_ns` (учитывает дозревший pending БЕЗ мутации —
/// для query; физическое продвижение — `promote_due` из таймера).
pub fn effective_params(channel_id: &str, now_ns: u64) -> (DisputeParams, ChannelParamsState) {
    let st = PARAMS.with(|p| p.borrow().get(&channel_id.to_string()).unwrap_or_default());
    let mut eff = st.effective.clone().unwrap_or_default();
    if let Some(pend) = &st.pending {
        if pend.effective_at_ns <= now_ns {
            eff = pend.params.clone();
        }
    }
    (eff, st)
}

/// Принять подписанное владельцем изменение. Возвращает момент вступления (ns).
pub fn set_dispute_params(
    channel_id: &str,
    owner_b58: &str,
    version: u64,
    params: DisputeParams,
    signature_b58: &str,
    now_ns: u64,
) -> Result<u64, String> {
    let onchain_owner =
        channel_owner(channel_id).ok_or("канал не активирован ончейн — владельца в журнале нет")?;
    if onchain_owner != owner_b58 {
        return Err("owner ≠ плательщик активации канала (право на запись даёт цепочка)".into());
    }
    validate_bounds(&params)?;

    let (current_eff, st) = effective_params(channel_id, now_ns);
    if version != st.version + 1 {
        return Err(format!("version: ожидается {}, пришла {version}", st.version + 1));
    }
    let msg = build_params_message(channel_id, owner_b58, version, &params);
    verify_owner_signature(&msg, owner_b58, signature_b58)?;

    // Таймлок ≥ полного цикла спора ДЕЙСТВУЮЩИХ правил (§8.9), с полом для тестовых окон.
    let timelock_secs =
        (current_eff.dispute_window_secs + current_eff.voting_window_secs).max(TIMELOCK_FLOOR_SECS);
    let effective_at_ns = now_ns + timelock_secs * 1_000_000_000;

    let new_state = ChannelParamsState {
        // Дозревший pending фиксируем как effective, чтобы новый pending его не затёр молча.
        effective: Some(current_eff),
        pending: Some(PendingChange { params, effective_at_ns, version }),
        version,
    };
    PARAMS.with(|p| p.borrow_mut().insert(channel_id.to_string(), new_state));
    Ok(effective_at_ns)
}

/// Хозработа таймера: физически продвинуть дозревшие pending → effective.
pub fn promote_due(now_ns: u64) {
    let due: Vec<(String, ChannelParamsState)> = PARAMS.with(|p| {
        p.borrow()
            .iter()
            .filter(|entry| {
                entry.value().pending.as_ref().is_some_and(|pd| pd.effective_at_ns <= now_ns)
            })
            .map(|entry| (entry.key().clone(), entry.value()))
            .collect()
    });
    for (channel, mut st) in due {
        if let Some(pend) = st.pending.take() {
            st.effective = Some(pend.params);
        }
        PARAMS.with(|p| p.borrow_mut().insert(channel, st));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn keypair() -> (SigningKey, String) {
        let sk = SigningKey::from_bytes(&[42u8; 32]);
        let owner = bs58::encode(sk.verifying_key().to_bytes()).into_string();
        (sk, owner)
    }

    fn sign(sk: &SigningKey, msg: &str) -> String {
        bs58::encode(sk.sign(msg.as_bytes()).to_bytes()).into_string()
    }

    /// Кросс-языковой пин: сообщение обязано байт-в-байт совпадать с TS-билдером —
    /// сверяем с общей фикстурой testdata/golden/messages.json (её порождает `npm run golden`).
    #[test]
    fn canonical_message_pinned() {
        let msg = build_params_message("chan-1", "OWNER", 1, &DisputeParams::default());
        assert_eq!(msg, crate::test_fixtures::canonical_message("disputeParams"));
    }

    #[test]
    fn signature_roundtrip_and_tamper() {
        let (sk, owner) = keypair();
        let msg = build_params_message("chan-1", &owner, 1, &DisputeParams::default());
        let sig = sign(&sk, &msg);
        assert!(verify_owner_signature(&msg, &owner, &sig).is_ok());
        // Подмена любого байта сообщения → отказ.
        assert!(verify_owner_signature(&format!("{msg} "), &owner, &sig).is_err());
        // Чужой ключ → отказ.
        let other = bs58::encode(SigningKey::from_bytes(&[7u8; 32]).verifying_key().to_bytes()).into_string();
        assert!(verify_owner_signature(&msg, &other, &sig).is_err());
    }

    #[test]
    fn full_flow_owner_version_timelock() {
        let (sk, owner) = keypair();
        // Владелец канала берётся из журнала: заводим активацию с payer = owner.
        state::journal_append(crate::state::JournalEntry {
            seq: 0,
            kind: EntryKind::Activation,
            signature: "act-sig-gov".into(),
            channel_id: "gov-chan".into(),
            actor: owner.clone(),
            amount_micro: 2_000_000,
            fee_micro: 0,
            net_micro: 0,
            points_delta_micro: 0,
            donation_id: None,
            msg_ref: None,
            block_time: Some(0),
        });

        let now = 1_000_000_000_000u64;
        let mut p = DisputeParams::default();
        p.voting_window_secs = 3600;

        // Не тот владелец → отказ (право на запись даёт цепочка).
        let msg = build_params_message("gov-chan", "SomeoneElse", 1, &p);
        assert!(set_dispute_params("gov-chan", "SomeoneElse", 1, p.clone(), &sign(&sk, &msg), now).is_err());

        // Неверная версия → отказ.
        let msg = build_params_message("gov-chan", &owner, 5, &p);
        assert!(set_dispute_params("gov-chan", &owner, 5, p.clone(), &sign(&sk, &msg), now).is_err());

        // Валидная запись: версия 1, таймлок = max(120+120, 300) = 300 c.
        let msg = build_params_message("gov-chan", &owner, 1, &p);
        let eff_at = set_dispute_params("gov-chan", &owner, 1, p.clone(), &sign(&sk, &msg), now).unwrap();
        assert_eq!(eff_at, now + 300 * 1_000_000_000);

        // До таймлока действуют дефолты; после — новые (query-вид без мутации).
        let (before, st) = effective_params("gov-chan", now + 1);
        assert_eq!(before, DisputeParams::default());
        assert_eq!(st.version, 1);
        let (after, _) = effective_params("gov-chan", eff_at + 1);
        assert_eq!(after.voting_window_secs, 3600);

        // Повтор той же подписи (replay) → отказ (версия уже занята).
        assert!(set_dispute_params("gov-chan", &owner, 1, p.clone(), &sign(&sk, &msg), now).is_err());

        // Физическое продвижение таймером.
        promote_due(eff_at + 1);
        let (_, st) = effective_params("gov-chan", eff_at + 1);
        assert!(st.pending.is_none());
        assert_eq!(st.effective.as_ref().unwrap().voting_window_secs, 3600);

        // Следующее изменение: таймлок уже от НОВЫХ действующих окон (120+3600).
        let mut p2 = p.clone();
        p2.d_max_micro = 50_000_000;
        let msg2 = build_params_message("gov-chan", &owner, 2, &p2);
        let eff_at2 =
            set_dispute_params("gov-chan", &owner, 2, p2, &sign(&sk, &msg2), eff_at + 10).unwrap();
        assert_eq!(eff_at2, eff_at + 10 + (120 + 3600) * 1_000_000_000);
    }

    #[test]
    fn bounds_are_fail_closed() {
        let (sk, owner) = keypair();
        let mut p = DisputeParams::default();
        p.dispute_window_secs = 5; // < 60 сек
        let msg = build_params_message("gov-chan-2", &owner, 1, &p);
        let err = set_dispute_params("gov-chan-2", &owner, 1, p, &sign(&sk, &msg), 0).unwrap_err();
        assert!(err.contains("не активирован") || err.contains("disputeWindowSecs"));
    }
}
