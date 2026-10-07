/**
 * Selling through Stripe Connect: pure fee math and payout-status summaries, shared by the
 * server, the CLI and the tests. All amounts are integer USD cents; rates are basis points.
 *
 * Money flow (direct charges, seller is merchant of record): the buyer pays the seller's Stripe
 * account; Stripe takes its processing fee from the seller; the application fee
 * (platform fee + affiliate referral fee) goes to the platform; after COMMISSION_HOLD_MS the
 * platform transfers the referral fee (less refunds, nothing if disputed) to the affiliate.
 */
import {
  BPS_DENOMINATOR,
  DEFAULT_MESSAGE_PRICE_CENTS,
  DEFAULT_PLATFORM_FEE_BPS,
  DEFAULT_REFERRAL_FEE_BPS,
  MAX_MESSAGE_PRICE_CENTS,
  MAX_PLATFORM_FEE_BPS,
  MAX_REFERRAL_FEE_BPS,
  MAX_SALE_CENTS,
  MIN_MESSAGE_PRICE_CENTS,
  MIN_SALE_CENTS,
} from "./constants";

/** Stripe's capability statuses, plus "not_requested" when there is no account or configuration yet. */
export type CapabilityStatus = "active" | "pending" | "restricted" | "unsupported" | "not_requested";
export type PayoutsState = "not_started" | "onboarding" | "restricted" | "active";
export type SaleStatus = "open" | "processing" | "paid" | "failed" | "expired";
export type CommissionStatus = "none" | "pending" | "paid" | "cancelled";
export type CommissionCancelReason = "disputed" | "refunded" | "affiliate_never_ready";
export type SaleSource = "seller_link";

/** Fee from a rate, rounded down so the platform never takes (or pays) more than the rate. */
export function feeFromBps(amountCents: number, bps: number): number {
  return Math.floor((amountCents * bps) / BPS_DENOMINATOR);
}

/**
 * An earner's share of a payment in whole cents, carrying the sub-cent remainder. `carry` is in
 * 1/BPS_DENOMINATOR of a cent (0 ≤ carry < BPS_DENOMINATOR) and lives on the earner's account, so
 * the split stays exact over time: ten 1-cent payments at 9000 bps credit 9 cents in total.
 */
export function shareWithCarry(amountCents: number, bps: number, carry: number | null | undefined): { creditCents: number; carry: number } {
  if (!Number.isInteger(amountCents) || amountCents < 0) throw new RangeError("amountCents must be a non-negative integer");
  if (!isBps(bps, BPS_DENOMINATOR)) throw new RangeError(`bps must be an integer between 0 and ${BPS_DENOMINATOR}`);
  const start = typeof carry === "number" && Number.isInteger(carry) && carry >= 0 && carry < BPS_DENOMINATOR ? carry : 0;
  const total = start + amountCents * bps;
  return { creditCents: Math.floor(total / BPS_DENOMINATOR), carry: total % BPS_DENOMINATOR };
}

/** The user's price to receive a message when valid, else the default. */
export function resolveMessagePrice(value: number | null | undefined): number {
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_MESSAGE_PRICE_CENTS && value <= MAX_MESSAGE_PRICE_CENTS
    ? value
    : DEFAULT_MESSAGE_PRICE_CENTS;
}

function isBps(v: unknown, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;
}

/** The ops-only per-seller override when valid, else the platform default. */
export function resolvePlatformFeeBps(override: number | null | undefined): number {
  return isBps(override, MAX_PLATFORM_FEE_BPS) ? override : DEFAULT_PLATFORM_FEE_BPS;
}

/** The seller's referral rate when valid (0 = referrals off), else the default. */
export function resolveReferralFeeBps(value: number | null | undefined): number {
  return isBps(value, MAX_REFERRAL_FEE_BPS) ? value : DEFAULT_REFERRAL_FEE_BPS;
}

export interface SaleQuote {
  amountCents: number;
  platformFeeBps: number;
  /** 0 when there is no affiliate, whatever the seller's rate */
  referralFeeBps: number;
  platformFeeCents: number;
  referralFeeCents: number;
  /** Stripe application_fee_amount = platform fee + referral fee */
  applicationFeeCents: number;
  /** what the seller keeps before Stripe's processing fee */
  sellerGrossCents: number;
}

export function quoteSale(input: {
  amountCents: number;
  platformFeeBps: number;
  referralFeeBps: number;
  hasAffiliate: boolean;
}): SaleQuote {
  const { amountCents, platformFeeBps, hasAffiliate } = input;
  if (!Number.isInteger(amountCents) || amountCents < MIN_SALE_CENTS || amountCents > MAX_SALE_CENTS) {
    throw new RangeError(`amountCents must be an integer between ${MIN_SALE_CENTS} and ${MAX_SALE_CENTS}`);
  }
  if (!isBps(platformFeeBps, MAX_PLATFORM_FEE_BPS)) throw new RangeError(`platformFeeBps must be an integer between 0 and ${MAX_PLATFORM_FEE_BPS}`);
  if (!isBps(input.referralFeeBps, MAX_REFERRAL_FEE_BPS)) throw new RangeError(`referralFeeBps must be an integer between 0 and ${MAX_REFERRAL_FEE_BPS}`);
  const referralFeeBps = hasAffiliate ? input.referralFeeBps : 0;
  const platformFeeCents = feeFromBps(amountCents, platformFeeBps);
  const referralFeeCents = feeFromBps(amountCents, referralFeeBps);
  const applicationFeeCents = platformFeeCents + referralFeeCents;
  if (applicationFeeCents >= amountCents) throw new RangeError("fees must be less than the sale amount");
  return {
    amountCents,
    platformFeeBps,
    referralFeeBps,
    platformFeeCents,
    referralFeeCents,
    applicationFeeCents,
    sellerGrossCents: amountCents - applicationFeeCents,
  };
}

export type CommissionOutcome = "pay" | "cancel_disputed" | "cancel_refunded";

/**
 * The affiliate's commission when the hold ends: the referral rate applied to what is left after
 * refunds, never more than the amount quoted at sale time; nothing if the payment was disputed.
 */
export function commissionAtRelease(input: {
  snapshotCents: number;
  referralFeeBps: number;
  amountCents: number;
  amountRefundedCents: number;
  disputed: boolean;
}): { cents: number; outcome: CommissionOutcome } {
  if (input.disputed) return { cents: 0, outcome: "cancel_disputed" };
  const net = Math.max(0, input.amountCents - Math.max(0, input.amountRefundedCents));
  const cents = Math.max(0, Math.min(input.snapshotCents, feeFromBps(net, input.referralFeeBps)));
  return cents > 0 ? { cents, outcome: "pay" } : { cents: 0, outcome: "cancel_refunded" };
}

export interface PayoutsSummary {
  state: PayoutsState;
  /** card_payments is active: the user can create checkout links */
  canSell: boolean;
  /** stripe_transfers is active: the user can be paid referral commissions */
  canReceiveCommissions: boolean;
}

export function summarizePayouts(input: {
  accountId: string | null | undefined;
  cardPayments?: CapabilityStatus;
  stripeTransfers?: CapabilityStatus;
}): PayoutsSummary {
  const canSell = input.cardPayments === "active";
  const canReceiveCommissions = input.stripeTransfers === "active";
  let state: PayoutsState;
  if (!input.accountId) state = "not_started";
  else if (canSell && canReceiveCommissions) state = "active";
  else if ([input.cardPayments, input.stripeTransfers].some((s) => s === "restricted" || s === "unsupported")) state = "restricted";
  else state = "onboarding";
  return { state, canSell, canReceiveCommissions };
}
