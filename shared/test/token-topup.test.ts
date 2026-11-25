import { describe, expect, it } from "vitest";
import {
  MAX_TOKEN_TOPUP_CENTS,
  MIN_TOKEN_TOPUP_CENTS,
  TOKEN_BURN_BPS,
  conservativeTokenPrice,
  tokensForCents,
  deviationBps,
  quoteTokenTopup,
  timeWeightedAverage,
  tokenTopupBonus,
  tokenTopupMemo,
  tokenTopupQuoteSchema,
  tokenTopupSubmitSchema,
  utcDay,
} from "../src";

describe("quoteTokenTopup", () => {
  it("prices the paid value, adds the 30% bonus and splits 70/30", () => {
    const q = quoteTokenTopup({ cents: 1000, priceUsd: 0.0005 });
    expect(q.tokensRaw).toBe(BigInt(20_000) * BigInt(1_000_000)); // $10 / $0.0005 = 20,000 tokens
    expect(q.bonusCents).toBe(300);
    expect(q.creditCents).toBe(1300);
    expect(q.burnRaw).toBe(BigInt(14_000) * BigInt(1_000_000));
    expect(q.treasuryRaw).toBe(BigInt(6_000) * BigInt(1_000_000));
    expect(q.burnRaw + q.treasuryRaw).toBe(q.tokensRaw);
  });

  it("rounds the tokens up to the base unit, the burn down, and gives the treasury the rest", () => {
    const q = quoteTokenTopup({ cents: 100, priceUsd: 0.0003 });
    const exact = (1 / 0.0003) * 1e6;
    expect(Number(q.tokensRaw)).toBeGreaterThanOrEqual(exact);
    expect(Number(q.tokensRaw) - exact).toBeLessThan(1.0001);
    expect(q.burnRaw).toBe((q.tokensRaw * BigInt(TOKEN_BURN_BPS)) / BigInt(10_000));
    expect(q.burnRaw + q.treasuryRaw).toBe(q.tokensRaw);
  });

  it("rounds the bonus down", () => {
    expect(tokenTopupBonus(101)).toBe(30);
    expect(tokenTopupBonus(MAX_TOKEN_TOPUP_CENTS)).toBe(3000);
  });

  it("refuses amounts outside the limits and bad prices", () => {
    expect(() => quoteTokenTopup({ cents: MIN_TOKEN_TOPUP_CENTS - 1, priceUsd: 1 })).toThrow(RangeError);
    expect(() => quoteTokenTopup({ cents: MAX_TOKEN_TOPUP_CENTS + 1, priceUsd: 1 })).toThrow(RangeError);
    expect(() => quoteTokenTopup({ cents: 150.5, priceUsd: 1 })).toThrow(RangeError);
    expect(() => quoteTokenTopup({ cents: 500, priceUsd: 0 })).toThrow(RangeError);
    expect(() => quoteTokenTopup({ cents: 500, priceUsd: Number.NaN })).toThrow(RangeError);
    expect(() => quoteTokenTopup({ cents: 10_000, priceUsd: 1e-12 })).toThrow(/too low/);
  });
});

describe("timeWeightedAverage", () => {
  it("weights each sample by how long it held", () => {
    const now = 60_000;
    // 1.0 for 45 s, then 2.0 for 15 s
    expect(timeWeightedAverage([{ at: 0, value: 1 }, { at: 45_000, value: 2 }], now, 60_000)).toBeCloseTo(1.25);
  });
  it("ignores samples outside the window, in the future or invalid", () => {
    const now = 100_000;
    const avg = timeWeightedAverage(
      [
        { at: 0, value: 1000 },
        { at: 50_000, value: 2 },
        { at: 200_000, value: 1000 },
        { at: 60_000, value: Number.NaN },
      ],
      now,
      60_000,
    );
    expect(avg).toBeCloseTo(2);
  });
  it("is null without samples", () => {
    expect(timeWeightedAverage([], 0, 1000)).toBeNull();
  });
});

describe("top-up helpers", () => {
  it("formats the memo, the UTC day and deviations", () => {
    expect(tokenTopupMemo("tq_abc")).toBe("oi:tq_abc");
    expect(utcDay(Date.UTC(2026, 10, 23, 23, 59))).toBe("2026-11-23");
    expect(deviationBps(1.2, 1)).toBe(2000);
    expect(deviationBps(0.8, 1)).toBe(2000);
  });
  it("prices conservatively: the lower of spot and average, minus half their gap up to 10%", () => {
    expect(conservativeTokenPrice(1, 1)).toEqual({ priceUsd: 1, deviationBps: 0, bufferBps: 0 });
    const up = conservativeTokenPrice(1.1, 1); // spot 10% above the average: the average, minus 5%
    expect(up.bufferBps).toBe(500);
    expect(up.priceUsd).toBeCloseTo(0.95, 10);
    const down = conservativeTokenPrice(0.8, 1); // spot 20% below: spot, minus 10%
    expect(down.bufferBps).toBe(1000);
    expect(down.priceUsd).toBeCloseTo(0.72, 10);
    expect(conservativeTokenPrice(0.6, 1).bufferBps).toBe(1000); // capped
    expect(tokensForCents(1000, conservativeTokenPrice(0.8, 1).priceUsd)).toBeGreaterThan(tokensForCents(1000, 0.8));
  });
  it("validates quote and submit requests", () => {
    expect(tokenTopupQuoteSchema.safeParse({ cents: 500 }).success).toBe(true);
    expect(tokenTopupQuoteSchema.safeParse({ cents: 50 }).success).toBe(false);
    expect(tokenTopupSubmitSchema.safeParse({ signature: "5".repeat(88) }).success).toBe(true);
    expect(tokenTopupSubmitSchema.safeParse({}).success).toBe(false);
    expect(tokenTopupSubmitSchema.safeParse({ signature: "5".repeat(88), transaction: "A".repeat(200) }).success).toBe(false);
  });
});
