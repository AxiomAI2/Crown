import { PublicKey } from "@solana/web3.js";
import { DEVNET_USDC_MINT, TREASURY_OWNER } from "./addresses";

/**
 * Ончейн-конфиг с PublicKey-обёртками (Фаза 3, yellow-paper §3.4). Сеть — devnet. Строковые адреса/
 * константы — в ./addresses (без web3.js). Стек на web3.js v1 (wallet-adapter-совместимость, ADR 0004).
 */
export * from "./addresses";

/** SPL Memo program. */
export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

export const mintPubkey = () => new PublicKey(DEVNET_USDC_MINT);
export const treasuryPubkey = () => new PublicKey(TREASURY_OWNER);
