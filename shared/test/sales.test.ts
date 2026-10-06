import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLATFORM_FEE_BPS,
  DEFAULT_REFERRAL_FEE_BPS,
  MAX_PLATFORM_FEE_BPS,
  MAX_REFERRAL_FEE_BPS,
  MAX_SALE_CENTS,
  MIN_SALE_CENTS,
  formatBps,
} from "../src/constants";
import {
  commissionAtRelease,
  feeFromBps,
  quoteSale,
  resolvePlatformFeeBps,
  resolveReferralFeeBps,
  summarizePayouts,
} from "../src/sales";
import { createSaleCheckoutSchema, listSalesQuerySchema, payoutsOnboardingSchema, updatePayoutsSettingsSchema } from "../src/schemas";

describe("feeFromBps", () => {
  it("applies basis points and rounds down", () => {
    expect(feeFromBps(1000, 500)).toBe(50);
    expect(feeFromBps(999, 500)).toBe(49);
    expect(feeFromBps(10_000, 250)).toBe(250);
    expect(feeFromBps(1000, 0)).toBe(0);
  });
});

describe("rate resolution", () => {
  it("uses the override only when it is a valid platform rate", () => {
    expect(resolvePlatformFeeBps(undefined)).toBe(DEFAULT_PLATFORM_FEE_BPS);
    expect(resolvePlatformFeeBps(null)).toBe(DEFAULT_PLATFORM_FEE_BPS);
    expect(resolvePlatformFeeBps(300)).toBe(300);
    expect(resolvePlatformFeeBps(0)).toBe(0);
    expect(resolvePlatformFeeBps(MAX_PLATFORM_FEE_BPS + 1)).toBe(DEFAULT_PLATFORM_FEE_BPS);
    expect(resolvePlatformFeeBps(2.5)).toBe(DEFAULT_PLATFORM_FEE_BPS);
  });
  it("keeps 0 (referrals off) and defaults a missing referral rate", () => {
    expect(resolveReferralFeeBps(undefined)).toBe(DEFAULT_REFERRAL_FEE_BPS);
    expect(resolveReferralFeeBps(0)).toBe(0);
    expect(resolveReferralFeeBps(1200)).toBe(1200);
    expect(resolveReferralFeeBps(MAX_REFERRAL_FEE_BPS + 1)).toBe(DEFAULT_REFERRAL_FEE_BPS);
  });
});

describe("quoteSale", () => {
  it("charges only the platform fee without an affiliate, whatever the seller's referral rate", () => {
    const q = quoteSale({ amountCents: 10_000, platformFeeBps: 500, referralFeeBps: 500, hasAffiliate: false });
    expect(q).toEqual({
      amountCents: 10_000,
      platformFeeBps: 500,
      referralFeeBps: 0,
      platformFeeCents: 500,
      referralFeeCents: 0,
      applicationFeeCents: 500,
      sellerGrossCents: 9500,
    });
  });

  it("adds the referral fee on top of the platform fee with an affiliate", () => {
    const q = quoteSale({ amountCents: 10_000, platformFeeBps: 500, referralFeeBps: 500, hasAffiliate: true });
    expect(q.platformFeeCents).toBe(500);
    expect(q.referralFeeCents).toBe(500);
    expect(q.applicationFeeCents).toBe(1000);
    expect(q.sellerGrossCents).toBe(9000);
  });

  it("honours a platform override and rounds each fee down", () => {
    const q = quoteSale({ amountCents: 999, platformFeeBps: 300, referralFeeBps: 750, hasAffiliate: true });
    expect(q.platformFeeCents).toBe(29);
    expect(q.referralFeeCents).toBe(74);
    expect(q.applicationFeeCents).toBe(103);
  });

  it("rejects amounts and rates out of range", () => {
    const base = { platformFeeBps: 500, referralFeeBps: 500, hasAffiliate: true };
    expect(() => quoteSale({ ...base, amountCents: MIN_SALE_CENTS - 1 })).toThrow(RangeError);
    expect(() => quoteSale({ ...base, amountCents: MAX_SALE_CENTS + 1 })).toThrow(RangeError);
    expect(() => quoteSale({ ...base, amountCents: 1000.5 })).toThrow(RangeError);
    expect(() => quoteSale({ ...base, amountCents: 1000, platformFeeBps: MAX_PLATFORM_FEE_BPS + 1 })).toThrow(RangeError);
    expect(() => quoteSale({ ...base, amountCents: 1000, referralFeeBps: -1 })).toThrow(RangeError);
    expect(() => quoteSale({ ...base, amountCents: 1000, referralFeeBps: MAX_REFERRAL_FEE_BPS + 1 })).toThrow(RangeError);
  });

  it("keeps the application fee below the amount even at the maximum rates", () => {
    const q = quoteSale({ amountCents: MIN_SALE_CENTS, platformFeeBps: MAX_PLATFORM_FEE_BPS, referralFeeBps: MAX_REFERRAL_FEE_BPS, hasAffiliate: true });
    expect(q.applicationFeeCents).toBeLessThan(q.amountCents);
  });
});

describe("commissionAtRelease", () => {
  const base = { snapshotCents: 500, referralFeeBps: 500, amountCents: 10_000, amountRefundedCents: 0, disputed: false };

  it("pays the quoted commission when nothing was refunded", () => {
    expect(commissionAtRelease(base)).toEqual({ cents: 500, outcome: "pay" });
  });

  it("applies the rate to what is left after a partial refund", () => {
    expect(commissionAtRelease({ ...base, amountRefundedCents: 4000 })).toEqual({ cents: 300, outcome: "pay" });
  });

  it("cancels after a full refund", () => {
    expect(commissionAtRelease({ ...base, amountRefundedCents: 10_000 })).toEqual({ cents: 0, outcome: "cancel_refunded" });
  });

  it("cancels when the payment was disputed", () => {
    expect(commissionAtRelease({ ...base, disputed: true })).toEqual({ cents: 0, outcome: "cancel_disputed" });
  });

  it("never pays more than the snapshot", () => {
    expect(commissionAtRelease({ ...base, snapshotCents: 120 }).cents).toBe(120);
  });
});

describe("summarizePayouts", () => {
  it("is not_started without an account", () => {
    expect(summarizePayouts({ accountId: null })).toEqual({ state: "not_started", canSell: false, canReceiveCommissions: false });
  });
  it("is onboarding while capabilities are pending", () => {
    expect(summarizePayouts({ accountId: "acct_1", cardPayments: "pending", stripeTransfers: "pending" }).state).toBe("onboarding");
    expect(summarizePayouts({ accountId: "acct_1", cardPayments: "active", stripeTransfers: "pending" })).toEqual({
      state: "onboarding",
      canSell: true,
      canReceiveCommissions: false,
    });
  });
  it("is restricted when a capability is restricted or unsupported", () => {
    expect(summarizePayouts({ accountId: "acct_1", cardPayments: "restricted", stripeTransfers: "active" }).state).toBe("restricted");
    expect(summarizePayouts({ accountId: "acct_1", cardPayments: "active", stripeTransfers: "unsupported" })).toEqual({
      state: "restricted",
      canSell: true,
      canReceiveCommissions: false,
    });
  });
  it("is active when both capabilities are active", () => {
    expect(summarizePayouts({ accountId: "acct_1", cardPayments: "active", stripeTransfers: "active" })).toEqual({
      state: "active",
      canSell: true,
      canReceiveCommissions: true,
    });
  });
});

describe("selling schemas", () => {
  it("bounds checkout amounts and trims descriptions", () => {
    expect(createSaleCheckoutSchema.parse({ amountCents: 1000, description: "  Consulting hour  " }).description).toBe("Consulting hour");
    expect(() => createSaleCheckoutSchema.parse({ amountCents: MIN_SALE_CENTS - 1, description: "x" })).toThrow();
    expect(() => createSaleCheckoutSchema.parse({ amountCents: 1000, description: "   " })).toThrow();
  });
  it("bounds the referral rate", () => {
    expect(updatePayoutsSettingsSchema.parse({ referralFeeBps: 0 }).referralFeeBps).toBe(0);
    expect(() => updatePayoutsSettingsSchema.parse({ referralFeeBps: MAX_REFERRAL_FEE_BPS + 1 })).toThrow();
  });
  it("lowercases a two-letter country", () => {
    expect(payoutsOnboardingSchema.parse({ country: "US" }).country).toBe("us");
    expect(() => payoutsOnboardingSchema.parse({ country: "USA" })).toThrow();
    expect(payoutsOnboardingSchema.parse({}).country).toBeUndefined();
  });
  it("defaults the sales list to the seller view", () => {
    expect(listSalesQuerySchema.parse({}).as).toBe("seller");
    expect(listSalesQuerySchema.parse({ as: "affiliate", limit: "5" })).toMatchObject({ as: "affiliate", limit: 5 });
  });
});

describe("formatBps", () => {
  it("renders percentages without trailing zeros", () => {
    expect(formatBps(500)).toBe("5%");
    expect(formatBps(250)).toBe("2.5%");
    expect(formatBps(1)).toBe("0.01%");
    expect(formatBps(0)).toBe("0%");
  });
});
