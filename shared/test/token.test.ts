import { describe, expect, it } from "vitest";
import {
  HOLDER_TIERS,
  TOKEN_MINT,
  base58Decode,
  base58Encode,
  formatTokens,
  isSolanaAddress,
  linkWalletSchema,
  quotaMultiplier,
  tierFor,
  toRawTokens,
  walletChallengeSchema,
  walletLinkMessage,
} from "../src";

describe("base58", () => {
  it("round-trips, keeping leading zero bytes as 1s", () => {
    const bytes = Uint8Array.from([0, 0, 1, 2, 255, 128, 7]);
    const enc = base58Encode(bytes);
    expect(enc.startsWith("11")).toBe(true);
    expect(Array.from(base58Decode(enc))).toEqual(Array.from(bytes));
  });
  it("matches a known vector", () => {
    // "Hello World!" in the bitcoin alphabet
    expect(base58Encode(new TextEncoder().encode("Hello World!"))).toBe("2NEpo7TZRRrLZSi2U");
    expect(new TextDecoder().decode(base58Decode("2NEpo7TZRRrLZSi2U"))).toBe("Hello World!");
  });
  it("rejects characters outside the alphabet", () => {
    expect(() => base58Decode("0OIl")).toThrow();
  });
  it("recognises 32-byte addresses", () => {
    expect(isSolanaAddress(TOKEN_MINT)).toBe(true);
    expect(isSolanaAddress("11111111111111111111111111111111")).toBe(true); // the system program
    expect(isSolanaAddress("not-an-address")).toBe(false);
    expect(isSolanaAddress(base58Encode(new Uint8Array(31).fill(9)))).toBe(false);
  });
});

describe("holder tiers", () => {
  it("are ordered highest first with growing multipliers", () => {
    for (let i = 1; i < HOLDER_TIERS.length; i++) {
      expect(HOLDER_TIERS[i - 1].minTokens).toBeGreaterThan(HOLDER_TIERS[i].minTokens);
      expect(HOLDER_TIERS[i - 1].quotaMultiplier).toBeGreaterThan(HOLDER_TIERS[i].quotaMultiplier);
    }
  });
  it("switch exactly at the thresholds", () => {
    const holder = toRawTokens(100_000);
    expect(tierFor(BigInt(0))).toBe("none");
    expect(tierFor(holder - BigInt(1))).toBe("none");
    expect(tierFor(holder)).toBe("holder");
    expect(tierFor(toRawTokens(1_000_000) - BigInt(1))).toBe("holder");
    expect(tierFor(toRawTokens(1_000_000).toString())).toBe("patron");
  });
  it("scale quotas", () => {
    expect(quotaMultiplier("none")).toBe(1);
    expect(quotaMultiplier("holder")).toBe(5);
    expect(quotaMultiplier("patron")).toBe(20);
  });
  it("format base units as whole tokens", () => {
    expect(formatTokens(toRawTokens(1_234_567))).toBe("1,234,567");
    expect(formatTokens("1500000")).toBe("1.5");
    expect(formatTokens("1")).toBe("0.000001");
    expect(formatTokens(BigInt(0))).toBe("0");
  });
});

describe("wallet link", () => {
  const msg = walletLinkMessage({
    domain: "www.openindex.ai",
    uri: "https://www.openindex.ai",
    address: TOKEN_MINT,
    uid: "u123",
    nonce: "a".repeat(32),
    issuedAt: "2026-11-22T00:00:00.000Z",
    expiresAt: "2026-11-22T00:10:00.000Z",
  });
  it("puts the domain first and binds the account, address and nonce", () => {
    expect(msg.split("\n")[0]).toBe("www.openindex.ai wants you to link your Solana account:");
    expect(msg.split("\n")[1]).toBe(TOKEN_MINT);
    expect(msg).toContain("OpenIndex account u123");
    expect(msg).toContain(`Nonce: ${"a".repeat(32)}`);
    expect(msg).toContain("moves no tokens");
  });
  it("validates the inputs", () => {
    expect(walletChallengeSchema.safeParse({ address: TOKEN_MINT }).success).toBe(true);
    expect(walletChallengeSchema.safeParse({ address: "0x1234" }).success).toBe(false);
    expect(linkWalletSchema.safeParse({ nonce: "a".repeat(32), signature: "x".repeat(88) }).success).toBe(true);
    expect(linkWalletSchema.safeParse({ nonce: "nope", signature: "x".repeat(88) }).success).toBe(false);
  });
});
