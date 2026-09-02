/**
 * Credit costs and limits. All money amounts are integer USD cents.
 */
export const NEW_PAGE_COST = 10; // cents to create a page
export const COMMENT_COST = 1; // cents to post a comment
export const MIN_PAGE_RENT = 1; // cents/day
export const MIN_COMMENT_RENT = 1; // cents/day
export const MAX_RENT_CENTS_PER_DAY = 100_000; // $1,000/day
export const MIN_TOPUP_CENTS = 500; // $5
export const MAX_TOPUP_CENTS = 100_000; // $1,000
export const TOPUP_PRESETS = [500, 1000, 5000, 10000] as const;
export const WELCOME_CREDITS = 100; // one-time grant on account creation
export const RENT_PERIOD_MS = 24 * 60 * 60 * 1000;

export const LIMITS = {
  titleMax: 200,
  slugMax: 200,
  markdownMax: 200_000,
  jsonMax: 200_000, // serialized length
  commentMarkdownMax: 20_000,
  commentJsonMax: 20_000,
  maxTags: 50,
  maxLinks: 500,
  commentDepth: 12,
  commentThreadMax: 1000,
  maxUniqueTerms: 2000,
  embedChars: 6000,
  summaryChars: 300,
  searchLimitDefault: 20,
  searchLimitMax: 50,
  listLimitDefault: 20,
  listLimitMax: 100,
  apiKeysPerUser: 20,
} as const;

export const SEARCH = {
  rrfK: 60,
  bm25K1: 1.2,
  bm25B: 0.75,
  /** score += rentWeight * log10(1 + rent.active cents/day) */
  rentWeight: 0.004,
  bm25CandidatesPerTerm: 100,
  semanticLimit: 40,
  maxQueryTerms: 12,
  embeddingModel: "gemini-embedding-001",
  embeddingDimensions: 768,
} as const;

export const DEVICE_FLOW = {
  expiresInSec: 600,
  intervalSec: 5,
  userCodeAlphabet: "BCDFGHJKLMNPQRSTVWXZ23456789",
  userCodeLength: 8,
} as const;

export const DEFAULT_API_URL = "https://wiki.openindex.ai";
export const PUBLIC_HOSTS = ["wiki.openindex.ai", "localhost:3000", "127.0.0.1:3000"];
export const API_KEY_PREFIX = "wk_";
export const CONFIG_DIR_NAME = ".openindex";
export const CONFIG_FILE_NAME = "wiki.json";
export const CLI_PACKAGE = "@openindex/openindexwiki";
export const CLI_BIN = "openindexwiki";

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

export function formatRent(centsPerDay: number): string {
  return `${formatCents(centsPerDay)}/day`;
}
