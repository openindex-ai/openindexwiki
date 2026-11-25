import { describe, expect, it } from "vitest";
import {
  HANDLE_GRACE_MS,
  HANDLE_HOLD_MS,
  checkHandlePurchase,
  handleExpiryAfter,
  handleFormatProblem,
  handleResolves,
  handleState,
  handleTermPriceCents,
  inviteMemberSchema,
  isPremiumHandle,
  usesLifetimeSlot,
  lifetimeIsIntroductory,
  lifetimePriceCents,
  normalizeHandle,
  sendMessageSchema,
  tokensForCents,
  type HandleRecordState,
} from "../src";

const NOW = Date.UTC(2026, 10, 25, 12);
const YEAR = Date.UTC(2027, 10, 25, 12) - NOW;
const DAY = 24 * 60 * 60 * 1000;
const owned = (over: Partial<HandleRecordState> = {}): HandleRecordState => ({ uid: "alice", status: "active", lifetime: false, expiresAt: NOW + 100 * DAY, ...over });

describe("handle format", () => {
  it("normalizes input", () => {
    expect(normalizeHandle("  @Tito ")).toBe("tito");
    expect(normalizeHandle("%40tito")).toBe("tito");
    expect(normalizeHandle("@@x")).toBe("x");
  });

  it("accepts 3-30 lowercase letters, digits and single inner underscores", () => {
    expect(handleFormatProblem("tito")).toBeNull();
    expect(handleFormatProblem("a_b_9")).toBeNull();
    expect(handleFormatProblem("abc")).toBeNull();
    expect(handleFormatProblem("x".repeat(30))).toBeNull();
    expect(handleFormatProblem("ab")).toBe("length");
    expect(handleFormatProblem("x".repeat(31))).toBe("length");
    expect(handleFormatProblem("Tito")).toBe("characters");
    expect(handleFormatProblem("ti-to")).toBe("characters");
    expect(handleFormatProblem("ti.to")).toBe("characters");
    expect(handleFormatProblem("_tito")).toBe("underscores");
    expect(handleFormatProblem("tito_")).toBe("underscores");
    expect(handleFormatProblem("ti__to")).toBe("underscores");
  });

  it("reserves routes, roles and the house name", () => {
    for (const h of ["docs", "page", "handles", "admin", "support", "openindex", "openindex_team", "wiki"]) expect(handleFormatProblem(h), h).toBe("reserved");
  });
});

describe("prices", () => {
  it("prices fixed terms with a falling yearly rate", () => {
    expect((["1y", "2y", "3y", "4y"] as const).map((t) => handleTermPriceCents(t, 0, "titoc"))).not.toEqual([1000, 1500, 1800, 2000]);
    expect((["1y", "2y", "3y", "4y"] as const).map((t) => handleTermPriceCents(t, 0, "tito_c"))).toEqual([1000, 1500, 1800, 2000]);
  });

  it("raises the lifetime price after the first 100 and the next 300", () => {
    expect(lifetimePriceCents(0)).toBe(5000);
    expect(lifetimePriceCents(99)).toBe(5000);
    expect(lifetimePriceCents(100)).toBe(8000);
    expect(lifetimePriceCents(399)).toBe(8000);
    expect(lifetimePriceCents(400)).toBe(10_000);
    expect(lifetimePriceCents(1e6)).toBe(10_000);
    expect(handleTermPriceCents("lifetime", 150, "standard")).toBe(8000);
    expect(lifetimeIsIntroductory(399)).toBe(true);
    expect(lifetimeIsIntroductory(400)).toBe(false);
  });

  it("charges five times as much for premium handles (fewer than 6 characters), and a flat lifetime price", () => {
    expect(isPremiumHandle("abc")).toBe(true);
    expect(isPremiumHandle("abcde")).toBe(true);
    expect(isPremiumHandle("abcdef")).toBe(false);
    expect((["1y", "2y", "3y", "4y"] as const).map((t) => handleTermPriceCents(t, 0, "tito"))).toEqual([5000, 7500, 9000, 10_000]);
    for (const claimed of [0, 100, 400]) expect(handleTermPriceCents("lifetime", claimed, "tito")).toBe(50_000);
    expect(handleTermPriceCents("lifetime", 0, "titooo")).toBe(5000);
    expect(usesLifetimeSlot("lifetime", "tito")).toBe(false);
    expect(usesLifetimeSlot("lifetime", "titooo")).toBe(true);
    expect(usesLifetimeSlot("4y", "titooo")).toBe(false);
  });

  it("converts a dollar price into tokens, rounding up", () => {
    expect(tokensForCents(1000, 0.001)).toBe(BigInt(10_000_000_000)); // 10,000 tokens, 6 decimals
    expect(tokensForCents(1, 3)).toBe(BigInt(3334));
  });
});

describe("lifecycle", () => {
  it("moves from active to grace to held to available", () => {
    const r = owned({ expiresAt: NOW });
    expect(handleState(null, NOW)).toBe("available");
    expect(handleState(r, NOW - 1)).toBe("active");
    expect(handleState(r, NOW)).toBe("grace");
    expect(handleState(r, NOW + HANDLE_GRACE_MS)).toBe("held");
    expect(handleState(r, NOW + HANDLE_GRACE_MS + HANDLE_HOLD_MS)).toBe("available");
    expect(handleResolves("grace")).toBe(true);
    expect(handleResolves("held")).toBe(false);
  });

  it("never expires lifetime handles, and revocation wins", () => {
    expect(handleState(owned({ lifetime: true, expiresAt: null }), NOW + 50 * YEAR)).toBe("active");
    expect(handleState(owned({ status: "revoked" }), NOW)).toBe("revoked");
  });

  it("shows a live pending purchase, and ignores a lapsed one", () => {
    const fresh: HandleRecordState = { uid: null, status: "active", lifetime: false, expiresAt: null, pendingUid: "bob", pendingUntil: NOW + 1000 };
    expect(handleState(fresh, NOW)).toBe("pending");
    expect(handleState(fresh, NOW + 1000)).toBe("available");
  });
});

describe("purchases", () => {
  it("lets anyone register an available handle", () => {
    expect(checkHandlePurchase(null, "bob", "1y", NOW)).toEqual({ ok: true, kind: "register" });
    expect(checkHandlePurchase(owned({ expiresAt: NOW - HANDLE_GRACE_MS - HANDLE_HOLD_MS }), "bob", "lifetime", NOW)).toEqual({ ok: true, kind: "register" });
  });

  it("refuses others while the owner holds it, including grace and hold", () => {
    for (const at of [NOW, NOW + 100 * DAY, NOW + 100 * DAY + HANDLE_GRACE_MS]) {
      const c = checkHandlePurchase(owned(), "bob", "1y", at);
      expect(c.ok).toBe(false);
      if (!c.ok) expect(c.code).toBe("HANDLE_TAKEN");
    }
  });

  it("lets the owner renew, re-register while held, and upgrade", () => {
    expect(checkHandlePurchase(owned(), "alice", "1y", NOW)).toEqual({ ok: true, kind: "renew" });
    expect(checkHandlePurchase(owned({ expiresAt: NOW - DAY }), "alice", "2y", NOW)).toEqual({ ok: true, kind: "renew" });
    expect(checkHandlePurchase(owned({ expiresAt: NOW - HANDLE_GRACE_MS - DAY }), "alice", "1y", NOW)).toEqual({ ok: true, kind: "register" });
    expect(checkHandlePurchase(owned(), "alice", "lifetime", NOW)).toEqual({ ok: true, kind: "upgrade" });
  });

  it("refuses renewing a lifetime handle, a revoked one, or one being bought", () => {
    const life = checkHandlePurchase(owned({ lifetime: true, expiresAt: null }), "alice", "1y", NOW);
    expect(life.ok || life.code).toBe("HANDLE_LIFETIME");
    const rev = checkHandlePurchase(owned({ status: "revoked" }), "alice", "1y", NOW);
    expect(rev.ok || rev.code).toBe("HANDLE_REVOKED");
    const pend = checkHandlePurchase({ uid: null, status: "active", lifetime: false, expiresAt: null, pendingUid: "bob", pendingUntil: NOW + 1 }, "carol", "1y", NOW);
    expect(pend.ok || pend.code).toBe("HANDLE_PENDING");
  });

  it("caps renewals at five years ahead", () => {
    const r = owned({ expiresAt: NOW + 2 * YEAR });
    expect(checkHandlePurchase(r, "alice", "3y", NOW).ok).toBe(true);
    const far = checkHandlePurchase(r, "alice", "4y", NOW);
    expect(far.ok || far.code).toBe("HANDLE_TOO_FAR");
  });

  it("adds a renewal to the current expiry, and counts anything else from now", () => {
    const exp = NOW + 100 * DAY;
    const renewed = new Date(handleExpiryAfter(owned({ expiresAt: exp }), "alice", "1y", NOW)!);
    const base = new Date(exp);
    expect([renewed.getUTCFullYear(), renewed.getUTCMonth(), renewed.getUTCDate()]).toEqual([base.getUTCFullYear() + 1, base.getUTCMonth(), base.getUTCDate()]);
    expect(handleExpiryAfter(owned({ expiresAt: NOW - DAY }), "alice", "1y", NOW)).toBe(NOW + YEAR);
    expect(handleExpiryAfter(null, "bob", "2y", NOW)).toBe(Date.UTC(2028, 10, 25, 12));
    expect(handleExpiryAfter(owned(), "alice", "lifetime", NOW)).toBeNull();
  });
});

describe("handle inputs", () => {
  it("messages a handle", () => {
    expect(sendMessageSchema.parse({ to: "@Tito", text: "hi" }).to).toBe("tito");
    expect(() => sendMessageSchema.parse({ to: "tito", page: "x", text: "hi" })).toThrow();
    expect(() => sendMessageSchema.parse({ to: "ti to", text: "hi" })).toThrow();
  });

  it("shares with exactly one of an email or a handle", () => {
    expect(inviteMemberSchema.parse({ handle: "@acme" })).toEqual({ handle: "acme", role: "viewer" });
    expect(() => inviteMemberSchema.parse({})).toThrow();
    expect(() => inviteMemberSchema.parse({ email: "a@b.co", handle: "acme" })).toThrow();
  });
});
