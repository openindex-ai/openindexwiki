/**
 * Topping up credits with $OpenIndex: the user pays a dollar value in tokens and gets that value
 * plus a bonus in credits. 70% of the tokens are burned and 30% go to the treasury, in one
 * transaction the user signs. Pure math and limits; the price feed and the chain are in the web app.
 */

import { TOKEN_DECIMALS } from "./token";

/** Bonus on top of the paid value, in basis points (30%). */
export const TOKEN_TOPUP_BONUS_BPS = 3000;
/** Share of the paid tokens that is burned; the rest goes to the treasury. */
export const TOKEN_BURN_BPS = 7000;
/** Paid value per top-up, in cents. */
export const MIN_TOKEN_TOPUP_CENTS = 100;
export const MAX_TOKEN_TOPUP_CENTS = 10_000;
/** Paid value per user per UTC day, and across all users per UTC day. */
export const TOKEN_TOPUP_USER_DAILY_CENTS = 25_000;
export const TOKEN_TOPUP_GLOBAL_DAILY_CENTS = 500_000;
/** How long a quote's price holds. Its transaction is re-dated before signing (a Solana blockhash lives only ~35 s). */
export const TOKEN_QUOTE_TTL_MS = 90_000;

/**
 * Circuit breakers on the price feed. The deviation breaker only stops quoting on extreme moves or a
 * broken feed (50% between spot and the 1-hour average); ordinary swings are absorbed by the
 * volatility buffer below instead.
 */
export const TOKEN_PRICE_MAX_DEVIATION_BPS = 5000;
/**
 * Volatility buffer, in OpenIndex's favour: quotes use the lower of spot and the 1-hour average,
 * discounted by this share of the gap between them (half), up to `TOKEN_PRICE_MAX_BUFFER_BPS` (10%).
 * A calm market pays the fair price; a swinging one pays up to ~11% more tokens.
 */
export const TOKEN_PRICE_BUFFER_SHARE_BPS = 5000;
export const TOKEN_PRICE_MAX_BUFFER_BPS = 1000;
export const TOKEN_MIN_LIQUIDITY_USD = 15_000;
export const TOKEN_PRICE_MAX_AGE_MS = 15 * 60 * 1000;
/** The time-weighted average covers this window and needs this many samples in it. */
export const TOKEN_TWAP_WINDOW_MS = 60 * 60 * 1000;
export const TOKEN_TWAP_MIN_SAMPLES = 6;

export const TOKEN_TOPUP_PRESETS_CENTS = [500, 1000, 2500, 10_000] as const;

export type TokenTopupStatus = "open" | "submitted" | "confirmed" | "failed" | "expired";

export interface TokenTopupQuote {
  quoteId: string;
  status: TokenTopupStatus;
  /** the linked wallet that must sign */
  wallet: string;
  /** paid value, in cents */
  cents: number;
  bonusCents: number;
  /** credits added on confirmation: cents + bonusCents */
  creditCents: number;
  /** total tokens paid (base units and display) */
  tokensRaw: string;
  tokens: string;
  burnRaw: string;
  treasuryRaw: string;
  /** USD per whole token used for this quote: min(spot, 1h average) */
  priceUsd: number;
  treasury: string;
  /** the unsigned transaction (base64, wire format with an empty signature slot) for a wallet's signTransaction */
  transaction: string;
  /** the message bytes (base64) a keypair signs, e.g. the CLI */
  message: string;
  expiresAt: string;
  signature: string | null;
  error: string | null;
  createdAt: string;
  confirmedAt: string | null;
}

export interface TokenTopupQuoteInput {
  /** paid value in cents */
  cents: number;
  /** USD per whole token */
  priceUsd: number;
}

export interface TokenTopupAmounts {
  cents: number;
  bonusCents: number;
  creditCents: number;
  tokensRaw: bigint;
  burnRaw: bigint;
  treasuryRaw: bigint;
}

const BPS = 10_000;

export function tokenTopupBonus(cents: number): number {
  return Math.floor((cents * TOKEN_TOPUP_BONUS_BPS) / BPS);
}

/** Tokens (base units) worth `cents` at `priceUsd` per whole token, rounded up so the platform never receives less. */
export function tokensForCents(cents: number, priceUsd: number): bigint {
  if (!Number.isInteger(cents) || cents <= 0) throw new RangeError("cents must be a positive integer");
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) throw new RangeError("priceUsd must be a positive number");
  const raw = Math.ceil(((cents / 100) / priceUsd) * 10 ** TOKEN_DECIMALS);
  if (!Number.isSafeInteger(raw)) throw new RangeError("the price is too low to quote safely");
  return BigInt(raw);
}

/**
 * Tokens owed for a paid value at a price, rounded up to the base unit so the platform never
 * receives less than the value, and its split: the burn rounds down, the treasury gets the rest.
 */
export function quoteTokenTopup({ cents, priceUsd }: TokenTopupQuoteInput): TokenTopupAmounts {
  if (!Number.isInteger(cents) || cents < MIN_TOKEN_TOPUP_CENTS || cents > MAX_TOKEN_TOPUP_CENTS) {
    throw new RangeError(`cents must be an integer from ${MIN_TOKEN_TOPUP_CENTS} to ${MAX_TOKEN_TOPUP_CENTS}`);
  }
  const tokensRaw = tokensForCents(cents, priceUsd);
  const burnRaw = (tokensRaw * BigInt(TOKEN_BURN_BPS)) / BigInt(BPS);
  const bonusCents = tokenTopupBonus(cents);
  return { cents, bonusCents, creditCents: cents + bonusCents, tokensRaw, burnRaw, treasuryRaw: tokensRaw - burnRaw };
}

/** The memo binding a transaction to its quote. */
export const tokenTopupMemo = (quoteId: string) => `oi:${quoteId}`;

/** UTC day key for the daily limits. */
export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Time-weighted average of samples over a window (each sample holds until the next one). */
export function timeWeightedAverage(samples: Array<{ at: number; value: number }>, now: number, windowMs: number): number | null {
  const s = samples.filter((x) => x.at <= now && x.at >= now - windowMs && Number.isFinite(x.value) && x.value > 0).sort((a, b) => a.at - b.at);
  if (!s.length) return null;
  let area = 0;
  let span = 0;
  for (let i = 0; i < s.length; i++) {
    const until = i + 1 < s.length ? s[i + 1].at : now;
    const dt = Math.max(0, until - s[i].at);
    area += s[i].value * dt;
    span += dt;
  }
  return span > 0 ? area / span : s[s.length - 1].value;
}

/** Relative deviation in basis points. */
export const deviationBps = (a: number, b: number) => Math.round((Math.abs(a - b) / b) * BPS);

/**
 * The USD price per token to quote with: the lower of spot and the time-weighted average, minus
 * the volatility buffer (half their deviation, capped). Lower price = more tokens per dollar.
 */
export function conservativeTokenPrice(spotUsd: number, twapUsd: number): { priceUsd: number; deviationBps: number; bufferBps: number } {
  const dev = deviationBps(spotUsd, twapUsd);
  const bufferBps = Math.min(Math.round((dev * TOKEN_PRICE_BUFFER_SHARE_BPS) / BPS), TOKEN_PRICE_MAX_BUFFER_BPS);
  return { priceUsd: (Math.min(spotUsd, twapUsd) * (BPS - bufferBps)) / BPS, deviationBps: dev, bufferBps };
}
