import { describe, expect, it } from "vitest";
import {
  BPS_DENOMINATOR,
  COMMENT_AUTHOR_SHARE_BPS,
  COMMENT_COST,
  DEFAULT_MESSAGE_PRICE_CENTS,
  MAX_MESSAGE_PRICE_CENTS,
  MESSAGE_RECIPIENT_SHARE_BPS,
  MIN_MESSAGE_PRICE_CENTS,
} from "../src/constants";
import { resolveMessagePrice, shareWithCarry } from "../src/sales";
import { listMessagesQuerySchema, sendMessageSchema, updateMeSchema } from "../src/schemas";

/** Apply `n` payments of `cents` and return what the earner was credited and the carry left. */
function accrue(n: number, cents: number, bps: number, carry = 0) {
  let credited = 0;
  for (let i = 0; i < n; i++) {
    const r = shareWithCarry(cents, bps, carry);
    credited += r.creditCents;
    carry = r.carry;
  }
  return { credited, carry };
}

describe("shareWithCarry", () => {
  it("pays the author 9 cents for ten 1-cent comments", () => {
    expect(COMMENT_COST).toBe(1);
    const first = shareWithCarry(COMMENT_COST, COMMENT_AUTHOR_SHARE_BPS, 0);
    expect(first).toEqual({ creditCents: 0, carry: 9000 });
    const second = shareWithCarry(COMMENT_COST, COMMENT_AUTHOR_SHARE_BPS, first.carry);
    expect(second).toEqual({ creditCents: 1, carry: 8000 });
    expect(accrue(10, COMMENT_COST, COMMENT_AUTHOR_SHARE_BPS)).toEqual({ credited: 9, carry: 0 });
    expect(accrue(1000, COMMENT_COST, COMMENT_AUTHOR_SHARE_BPS)).toEqual({ credited: 900, carry: 0 });
  });

  it("pays 9 cents of a default 10-cent message with no carry", () => {
    expect(shareWithCarry(DEFAULT_MESSAGE_PRICE_CENTS, MESSAGE_RECIPIENT_SHARE_BPS, 0)).toEqual({ creditCents: 9, carry: 0 });
  });

  it("carries across comment and message earnings", () => {
    const afterComment = shareWithCarry(1, COMMENT_AUTHOR_SHARE_BPS, 0); // 0.9 cent pending
    const afterMessage = shareWithCarry(15, MESSAGE_RECIPIENT_SHARE_BPS, afterComment.carry); // 13.5 + 0.9 = 14.4
    expect(afterMessage).toEqual({ creditCents: 14, carry: 4000 });
  });

  it("never credits more than the share, and the platform keeps the rest", () => {
    for (const cents of [1, 3, 7, 10, 99, 101, 12345]) {
      const { credited, carry } = accrue(7, cents, 9000);
      const exact = (7 * cents * 9000) / BPS_DENOMINATOR;
      expect(credited).toBe(Math.floor(exact));
      expect(credited + carry / BPS_DENOMINATOR).toBeCloseTo(exact, 10);
    }
  });

  it("handles zero amounts and rates", () => {
    expect(shareWithCarry(0, 9000, 1234)).toEqual({ creditCents: 0, carry: 1234 });
    expect(shareWithCarry(50, 0, 0)).toEqual({ creditCents: 0, carry: 0 });
    expect(shareWithCarry(50, BPS_DENOMINATOR, 0)).toEqual({ creditCents: 50, carry: 0 });
  });

  it("treats a missing or corrupt carry as zero", () => {
    expect(shareWithCarry(1, 9000, undefined)).toEqual({ creditCents: 0, carry: 9000 });
    expect(shareWithCarry(1, 9000, null)).toEqual({ creditCents: 0, carry: 9000 });
    expect(shareWithCarry(1, 9000, -5)).toEqual({ creditCents: 0, carry: 9000 });
    expect(shareWithCarry(1, 9000, BPS_DENOMINATOR)).toEqual({ creditCents: 0, carry: 9000 });
    expect(shareWithCarry(1, 9000, 1.5)).toEqual({ creditCents: 0, carry: 9000 });
  });

  it("rejects invalid amounts and rates", () => {
    expect(() => shareWithCarry(-1, 9000, 0)).toThrow(RangeError);
    expect(() => shareWithCarry(1.5, 9000, 0)).toThrow(RangeError);
    expect(() => shareWithCarry(1, BPS_DENOMINATOR + 1, 0)).toThrow(RangeError);
    expect(() => shareWithCarry(1, -1, 0)).toThrow(RangeError);
  });
});

describe("resolveMessagePrice", () => {
  it("defaults to 10 cents", () => {
    expect(DEFAULT_MESSAGE_PRICE_CENTS).toBe(10);
    expect(resolveMessagePrice(undefined)).toBe(10);
    expect(resolveMessagePrice(null)).toBe(10);
  });
  it("keeps valid prices and replaces invalid ones", () => {
    expect(resolveMessagePrice(MIN_MESSAGE_PRICE_CENTS)).toBe(MIN_MESSAGE_PRICE_CENTS);
    expect(resolveMessagePrice(250)).toBe(250);
    expect(resolveMessagePrice(MAX_MESSAGE_PRICE_CENTS)).toBe(MAX_MESSAGE_PRICE_CENTS);
    expect(resolveMessagePrice(0)).toBe(10);
    expect(resolveMessagePrice(MAX_MESSAGE_PRICE_CENTS + 1)).toBe(10);
    expect(resolveMessagePrice(2.5)).toBe(10);
  });
});

describe("message schemas", () => {
  it("needs exactly one of page and replyTo", () => {
    expect(sendMessageSchema.safeParse({ page: "mars", text: "hi" }).success).toBe(true);
    expect(sendMessageSchema.safeParse({ replyTo: "abc", text: "hi" }).success).toBe(true);
    expect(sendMessageSchema.safeParse({ text: "hi" }).success).toBe(false);
    expect(sendMessageSchema.safeParse({ page: "mars", replyTo: "abc", text: "hi" }).success).toBe(false);
  });
  it("rejects empty text and bad prices", () => {
    expect(sendMessageSchema.safeParse({ page: "mars", text: "   " }).success).toBe(false);
    expect(sendMessageSchema.safeParse({ page: "mars", text: "hi", maxPriceCents: -1 }).success).toBe(false);
    expect(sendMessageSchema.safeParse({ page: "mars", text: "hi", maxPriceCents: 1.5 }).success).toBe(false);
  });
  it("defaults the inbox to received", () => {
    expect(listMessagesQuerySchema.parse({})).toMatchObject({ box: "received" });
  });
  it("accepts any one setting on /api/me but not none", () => {
    expect(updateMeSchema.safeParse({ messagePriceCents: 25 }).success).toBe(true);
    expect(updateMeSchema.safeParse({ acceptMessages: false }).success).toBe(true);
    expect(updateMeSchema.safeParse({ commentEmails: false }).success).toBe(true);
    expect(updateMeSchema.safeParse({ displayName: "Ada" }).success).toBe(true);
    expect(updateMeSchema.safeParse({}).success).toBe(false);
    expect(updateMeSchema.safeParse({ messagePriceCents: 0 }).success).toBe(false);
  });
});
