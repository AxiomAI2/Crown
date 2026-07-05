//! Сборка legacy-транзакции Solana БЕЗ solana-sdk (он не собирается в wasm канистры;
//! ручная сборка — стандартный приём канистр Chain Fusion). Формат зафиксирован эталонным
//! тестом против web3.js (`golden_memo_message_matches_web3js`) — как golden-векторы M-1.
//!
//! M0: единственная нужная транзакция — memo от тресхолд-адреса (доказательство контура
//! подписи). M2 добавит `resolve_dispute` эскроу-программы — тот же сборщик, другая инструкция.

/// SPL Memo v2 (`MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`).
pub const MEMO_PROGRAM_ID: [u8; 32] = [
    5, 74, 83, 90, 153, 41, 33, 6, 77, 36, 232, 113, 96, 218, 56, 124, 124, 53, 181, 221, 188,
    146, 187, 129, 228, 31, 168, 64, 65, 5, 68, 141,
];

/// compact-u16 («shortvec») — переменная длина списков в формате Solana.
fn compact_u16(mut n: u16, out: &mut Vec<u8>) {
    loop {
        let mut byte = (n & 0x7f) as u8;
        n >>= 7;
        if n != 0 {
            byte |= 0x80;
        }
        out.push(byte);
        if n == 0 {
            break;
        }
    }
}

/// Аккаунт инструкции (аналог web3.js AccountMeta).
#[derive(Debug, Clone)]
pub struct AccountMeta {
    pub pubkey: [u8; 32],
    pub is_signer: bool,
    pub is_writable: bool,
}

/// Инструкция для сборки (аналог TransactionInstruction).
#[derive(Debug, Clone)]
pub struct Instruction {
    pub program_id: [u8; 32],
    pub accounts: Vec<AccountMeta>,
    pub data: Vec<u8>,
}

/// Общий legacy-message: fee payer первым, затем writable-подписанты, readonly-подписанты,
/// writable-неподписанты, readonly-неподписанты (включая программы) — порядок web3.js,
/// запинен эталонным тестом `golden_instruction_message_matches_web3js`.
pub fn build_message(
    fee_payer: &[u8; 32],
    recent_blockhash: &[u8; 32],
    instructions: &[Instruction],
) -> Vec<u8> {
    // Собрать уникальные ключи со слиянием флагов (fee payer всегда signer+writable).
    let mut keys: Vec<[u8; 32]> = vec![*fee_payer];
    let mut flags: Vec<(bool, bool)> = vec![(true, true)]; // (signer, writable)
    let mut upsert = |pk: &[u8; 32], signer: bool, writable: bool| {
        if let Some(i) = keys.iter().position(|k| k == pk) {
            flags[i].0 |= signer;
            flags[i].1 |= writable;
        } else {
            keys.push(*pk);
            flags.push((signer, writable));
        }
    };
    for ix in instructions {
        for a in &ix.accounts {
            upsert(&a.pubkey, a.is_signer, a.is_writable);
        }
        upsert(&ix.program_id, false, false);
    }
    // Сортировка по классам с сохранением порядка внутри класса; fee payer — принудительно первый.
    let class = |i: usize| -> u8 {
        if i == 0 {
            return 0;
        }
        match flags[i] {
            (true, true) => 1,
            (true, false) => 2,
            (false, true) => 3,
            (false, false) => 4,
        }
    };
    let mut order: Vec<usize> = (0..keys.len()).collect();
    order.sort_by_key(|&i| (class(i), i));

    let index_of = |pk: &[u8; 32]| -> u8 {
        order.iter().position(|&i| &keys[i] == pk).expect("ключ в таблице") as u8
    };
    let num_signers = flags.iter().filter(|f| f.0).count() as u8;
    let num_ro_signed = flags.iter().filter(|f| f.0 && !f.1).count() as u8;
    let num_ro_unsigned = flags.iter().filter(|f| !f.0 && !f.1).count() as u8;

    let mut m = Vec::with_capacity(256);
    m.extend_from_slice(&[num_signers, num_ro_signed, num_ro_unsigned]);
    compact_u16(order.len() as u16, &mut m);
    for &i in &order {
        m.extend_from_slice(&keys[i]);
    }
    m.extend_from_slice(recent_blockhash);
    compact_u16(instructions.len() as u16, &mut m);
    for ix in instructions {
        m.push(index_of(&ix.program_id));
        compact_u16(ix.accounts.len() as u16, &mut m);
        for a in &ix.accounts {
            m.push(index_of(&a.pubkey));
        }
        compact_u16(ix.data.len() as u16, &mut m);
        m.extend_from_slice(&ix.data);
    }
    m
}

/// Legacy-message: один подписант (fee payer = тресхолд-адрес) + одна memo-инструкция.
pub fn build_memo_message(signer: &[u8; 32], recent_blockhash: &[u8; 32], memo: &str) -> Vec<u8> {
    build_message(
        signer,
        recent_blockhash,
        &[Instruction {
            program_id: MEMO_PROGRAM_ID,
            accounts: vec![],
            data: memo.as_bytes().to_vec(),
        }],
    )
}

/// Готовая транзакция: compact-массив подписей + message. Подпись Ed25519 — ровно 64 байта.
pub fn assemble_tx(signature: &[u8], message: &[u8]) -> Result<Vec<u8>, String> {
    if signature.len() != 64 {
        return Err(format!("подпись {} байт, ожидалось 64", signature.len()));
    }
    let mut tx = Vec::with_capacity(1 + 64 + message.len());
    compact_u16(1, &mut tx);
    tx.extend_from_slice(signature);
    tx.extend_from_slice(message);
    Ok(tx)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    /// Эталон, порождённый web3.js (`Transaction.compileMessage().serialize()`) на тех же
    /// фиксированных входах — сборка обязана совпасть байт-в-байт.
    #[test]
    fn golden_memo_message_matches_web3js() {
        let signer = [9u8; 32];
        let blockhash = [7u8; 32];
        let msg = build_memo_message(&signer, &blockhash, "standing-core M0 threshold test");
        let expected = base64::engine::general_purpose::STANDARD
            .decode(
                "AQABAgkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJBUpTWpkpIQZNJOhxYNo4fHw1td28kruB5B+oQEEFRI0HBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwEBAB9zdGFuZGluZy1jb3JlIE0wIHRocmVzaG9sZCB0ZXN0",
            )
            .unwrap();
        assert_eq!(msg, expected, "сборка message разошлась с web3.js");
    }

    /// Эталон web3.js для ОБЩЕГО сборщика: resolve_dispute-образная инструкция
    /// (resolver = fee payer + readonly-подписант в инструкции, эскроу writable, программа).
    #[test]
    fn golden_instruction_message_matches_web3js() {
        let resolver = [3u8; 32];
        let escrow = [4u8; 32];
        let program = [5u8; 32];
        let blockhash = [7u8; 32];
        let msg = build_message(
            &resolver,
            &blockhash,
            &[Instruction {
                program_id: program,
                accounts: vec![
                    AccountMeta { pubkey: resolver, is_signer: true, is_writable: false },
                    AccountMeta { pubkey: escrow, is_signer: false, is_writable: true },
                ],
                data: vec![231, 6, 202, 6, 96, 103, 12, 230, 1],
            }],
        );
        let expected = base64::engine::general_purpose::STANDARD
            .decode("AQABAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHAQICAAEJ5wbKBmBnDOYB")
            .unwrap();
        assert_eq!(msg, expected, "общий сборщик message разошёлся с web3.js");
    }

    #[test]
    fn compact_u16_encoding() {
        let enc = |n: u16| {
            let mut v = Vec::new();
            compact_u16(n, &mut v);
            v
        };
        assert_eq!(enc(0), vec![0]);
        assert_eq!(enc(1), vec![1]);
        assert_eq!(enc(127), vec![0x7f]);
        assert_eq!(enc(128), vec![0x80, 0x01]);
        assert_eq!(enc(16383), vec![0xff, 0x7f]);
        assert_eq!(enc(16384), vec![0x80, 0x80, 0x01]);
    }

    #[test]
    fn assemble_requires_64_byte_signature() {
        assert!(assemble_tx(&[0u8; 63], &[1, 2, 3]).is_err());
        let tx = assemble_tx(&[0u8; 64], &[1, 2, 3]).unwrap();
        assert_eq!(tx.len(), 1 + 64 + 3);
        assert_eq!(tx[0], 1); // одна подпись
    }
}
