/**
 * The $OpenIndex community token (Solana, Token-2022, 6 decimals) and the holder tiers a linked
 * wallet unlocks. Tiers are set in whole tokens, not dollars, so checking one needs no price feed.
 * Holding only raises quotas: nothing here moves or holds anyone's tokens.
 */

export const TOKEN_MINT = "FuKY3dk7QmpbDdQRjzbjB3G6PiCuqKNvN4dAWDpwpump";
export const TOKEN_SYMBOL = "$OpenIndex";
export const TOKEN_DECIMALS = 6;
/** The mint is owned by Token-2022, not the original SPL Token program. */
export const TOKEN_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/** The PumpSwap pool ($OpenIndex / wrapped SOL) the price is read from, and its two vaults (the pool's associated token accounts). */
export const TOKEN_POOL = "4X1SAtTgzqfyRDu237HxJLtSfTosMHe9EuXNPvRfFbjc";
export const TOKEN_POOL_BASE_VAULT = "3vHDMArwYa7M44QxDycM4uEF8rT5kph9zghgEwiid22x";
export const TOKEN_POOL_QUOTE_VAULT = "GeJQquVQg8WFSwDQRmbXP8QyGnegF8NZSXHLSusxWNRU";
export const WSOL_MINT = "So11111111111111111111111111111111111111112";
export const SPL_TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

export type HolderTier = "none" | "holder" | "patron";

/** Highest first. `quotaMultiplier` scales the channel quotas (posts, task operations, long polls). */
export const HOLDER_TIERS = [
  { tier: "patron", minTokens: 1_000_000, quotaMultiplier: 20 },
  { tier: "holder", minTokens: 100_000, quotaMultiplier: 5 },
] as const satisfies ReadonlyArray<{ tier: Exclude<HolderTier, "none">; minTokens: number; quotaMultiplier: number }>;

/** A linked wallet's balance is re-read when the cached one is older than this. */
export const HOLDER_CHECK_TTL_MS = 10 * 60 * 1000;
/** A wallet-link challenge must be signed within this. */
export const WALLET_CHALLENGE_TTL_MS = 10 * 60 * 1000;
/** After an unlink, the wallet cannot be linked to another account for this long (the same account can relink). */
export const WALLET_RELINK_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

// BigInt() calls, not literals: the web app compiles for ES2017.
const ZERO = BigInt(0);
const EIGHT = BigInt(8);
const FIFTY_EIGHT = BigInt(58);
const BYTE = BigInt(255);
const UNIT = BigInt(10) ** BigInt(TOKEN_DECIMALS);

/** Whole tokens → base units. */
export function toRawTokens(tokens: number): bigint {
  if (!Number.isSafeInteger(tokens) || tokens < 0) throw new Error("tokens must be a non-negative integer");
  return BigInt(tokens) * UNIT;
}

/** Base units → "1,234,567.5" (trailing zeros of the fraction dropped). */
export function formatTokens(raw: bigint | string): string {
  const v = typeof raw === "string" ? BigInt(raw) : raw;
  const neg = v < ZERO;
  const abs = neg ? -v : v;
  const whole = (abs / UNIT).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (abs % UNIT).toString().padStart(TOKEN_DECIMALS, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

export function tierFor(raw: bigint | string): HolderTier {
  const v = typeof raw === "string" ? BigInt(raw) : raw;
  for (const t of HOLDER_TIERS) if (v >= toRawTokens(t.minTokens)) return t.tier;
  return "none";
}

export function quotaMultiplier(tier: HolderTier): number {
  return HOLDER_TIERS.find((t) => t.tier === tier)?.quotaMultiplier ?? 1;
}

/* ------------------------------ base58 ------------------------------ */

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const B58_MAP = new Map([...B58].map((c, i) => [c, i]));

export function base58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  let n = ZERO;
  for (const b of bytes) n = (n << EIGHT) | BigInt(b);
  let out = "";
  while (n > ZERO) {
    out = B58[Number(n % FIFTY_EIGHT)] + out;
    n /= FIFTY_EIGHT;
  }
  return "1".repeat(zeros) + out;
}

/** Throws on characters outside the bitcoin alphabet. */
export function base58Decode(s: string): Uint8Array {
  let zeros = 0;
  while (zeros < s.length && s[zeros] === "1") zeros++;
  let n = ZERO;
  for (const c of s) {
    const v = B58_MAP.get(c);
    if (v === undefined) throw new Error(`invalid base58 character "${c}"`);
    n = n * FIFTY_EIGHT + BigInt(v);
  }
  const body: number[] = [];
  while (n > ZERO) {
    body.unshift(Number(n & BYTE));
    n >>= EIGHT;
  }
  return Uint8Array.from([...new Array<number>(zeros).fill(0), ...body]);
}

/** A Solana address is the base58 form of a 32-byte ed25519 public key. */
export function isSolanaAddress(s: string): boolean {
  if (typeof s !== "string" || s.length < 32 || s.length > 44) return false;
  try {
    return base58Decode(s).length === 32;
  } catch {
    return false;
  }
}

/* --------------------------- wallet link --------------------------- */

export interface WalletLinkMessageInput {
  /** host of the app, e.g. www.openindex.ai */
  domain: string;
  /** the app's URL */
  uri: string;
  address: string;
  uid: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}

/**
 * The text a wallet signs to prove it belongs to whoever links it. Shaped like Sign-In With
 * Solana (domain first, so wallets can warn about a mismatched site), and bound to one account
 * and one nonce, so a signature cannot be replayed elsewhere. The server rebuilds it from the
 * stored challenge rather than trusting a message sent by the client.
 */
export function walletLinkMessage(m: WalletLinkMessageInput): string {
  return [
    `${m.domain} wants you to link your Solana account:`,
    m.address,
    "",
    `Link this wallet to OpenIndex account ${m.uid} to unlock ${TOKEN_SYMBOL} holder tiers. This signs a message only: it is not a transaction and moves no tokens.`,
    "",
    `URI: ${m.uri}`,
    "Version: 1",
    "Chain ID: mainnet",
    `Nonce: ${m.nonce}`,
    `Issued At: ${m.issuedAt}`,
    `Expiration Time: ${m.expiresAt}`,
  ].join("\n");
}
