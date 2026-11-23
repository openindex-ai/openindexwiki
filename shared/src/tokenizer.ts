import { LIMITS } from "./constants";
import type { JsonValue } from "./types";

const STOPWORDS = new Set(
  (
    "a an and are as at be but by for from has have he her his if in into is it its of on or " +
    "she so than that the their them then there these they this to was we were what when where " +
    "which who will with would you your not no can our us all any do does did"
  ).split(" "),
);

/** One tokenizer for documents and queries. */
export function tokenize(text: string): string[] {
  if (!text) return [];
  const norm = text
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}+/gu, "");
  return norm
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2 && t.length <= 40 && !STOPWORDS.has(t));
}

/* ------------------------------ JSON key:value pairs ------------------------------ */

const MAX_PAIR_TERMS = 500;
const MAX_KEY_CHARS = 60;
const MAX_VALUE_CHARS = 80;

function normalizeKey(key: string): string {
  return key
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^a-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_KEY_CHARS);
}

/** Search terms for one JSON leaf: key:token per word plus key:full_value for multi-word strings. */
/**
 * Words of a key:value pair value. Unlike prose tokens, stopwords and single characters are kept:
 * structured values such as "in_stock", "us" or "a5" carry meaning.
 */
function tokenizeValue(text: string): string[] {
  if (!text) return [];
  return text
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 1 && t.length <= 40);
}

function pairTermsFor(key: string, value: string | number | boolean | null): string[] {
  const k = normalizeKey(key);
  if (!k) return [];
  if (value === null) return [`${k}:null`];
  if (typeof value === "boolean") return [`${k}:${value}`];
  if (typeof value === "number") return Number.isFinite(value) ? [`${k}:${String(value).toLowerCase()}`] : [];
  const words = tokenizeValue(value);
  if (words.length === 0) return [];
  const out = words.map((w) => `${k}:${w}`);
  if (words.length > 1) {
    const joined = words.join("_");
    if (joined.length <= MAX_VALUE_CHARS) out.push(`${k}:${joined}`);
  }
  return out;
}

/**
 * key:value search terms for a JSON document, using each leaf's own key (arrays use the array's key;
 * objects inside arrays contribute their own keys). Example: {"type":"planet","aliases":["Hermes"]}
 * -> ["type:planet", "aliases:hermes"]. Deduped and capped.
 */
export function jsonPairTerms(json: JsonValue | null | undefined): string[] {
  if (json === null || json === undefined || typeof json !== "object") return [];
  const out = new Set<string>();
  const walk = (key: string | null, v: JsonValue) => {
    if (out.size >= MAX_PAIR_TERMS) return;
    if (v === null || typeof v !== "object") {
      if (key !== null) for (const t of pairTermsFor(key, v)) out.add(t);
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) walk(key, item);
    } else {
      for (const [k, item] of Object.entries(v)) walk(k, item);
    }
  };
  walk(null, json);
  return Array.from(out).slice(0, MAX_PAIR_TERMS);
}

const QUERY_PAIR_RE = /([\p{L}\p{N}_.-]+):("[^"]+"|[\p{L}\p{N}_.-]+)/gu;

export interface ParsedQuery {
  /** free-text part of the query (key:value expressions removed) */
  text: string;
  /** plain word tokens of `text` */
  words: string[];
  /** key -> pair terms; a page must match at least one term of every key (OR within a key, AND across keys) */
  filters: Record<string, string[]>;
}

/**
 * Split a query into free text and key:value filters. `type:planet type:moon orbital` ->
 * { text: "orbital", words: ["orbital"], filters: { type: ["type:planet", "type:moon"] } }.
 * Quoted or underscore-joined multi-word values match the exact joined form only.
 */
export function parseSearchQuery(query: string): ParsedQuery {
  const text = query.replace(QUERY_PAIR_RE, " ").replace(/\s+/g, " ").trim();
  const words = Array.from(new Set(tokenize(text)));
  const filters: Record<string, string[]> = {};
  for (const m of query.matchAll(QUERY_PAIR_RE)) {
    const key = normalizeKey(m[1]);
    if (!key) continue;
    const quoted = m[2].startsWith('"');
    const raw = m[2].replace(/^"|"$/g, "");
    const num = Number(raw);
    const value: string | number | boolean | null =
      raw === "null" ? null : raw === "true" ? true : raw === "false" ? false : raw !== "" && Number.isFinite(num) && /^-?\d+(\.\d+)?$/.test(raw) ? num : raw.replace(/_/g, " ");
    const pairs = pairTermsFor(key, value);
    // Quoted or underscore-joined values mean the exact joined form (the value part, not the key, must contain "_").
    const exact = typeof value === "string" && (quoted || raw.includes("_")) ? pairs.filter((t) => t.slice(key.length + 1).includes("_")) : [];
    const chosen = exact.length ? exact : pairs;
    if (chosen.length === 0) continue;
    filters[key] = Array.from(new Set([...(filters[key] ?? []), ...chosen]));
  }
  return { text, words, filters };
}

/** True when the term-frequency map satisfies every filter group (OR within a key, AND across keys). */
export function matchesFilters(tf: Record<string, number> | undefined, filters: Record<string, string[]>): boolean {
  for (const terms of Object.values(filters)) {
    if (!terms.some((t) => (tf?.[t] ?? 0) > 0)) return false;
  }
  return true;
}

/** Query tokens: the plain words plus every key:value pair term (used for candidate retrieval and IDF lookups). */
export function tokenizeQuery(query: string): string[] {
  const { words, filters } = parseSearchQuery(query);
  return Array.from(new Set([...words, ...Object.values(filters).flat()]));
}

export interface Bm25Metrics {
  uniqueTerms: string[];
  tf: Record<string, number>;
  docLength: number;
}

/** Term statistics for a document; `extraTerms` (e.g. JSON key:value pairs) count once each. */
export function bm25Metrics(text: string, extraTerms: string[] = []): Bm25Metrics {
  const tokens = [...tokenize(text), ...extraTerms];
  const tf: Record<string, number> = {};
  for (const t of tokens) tf[t] = (tf[t] ?? 0) + 1;
  let uniqueTerms = Object.keys(tf);
  if (uniqueTerms.length > LIMITS.maxUniqueTerms) {
    uniqueTerms = uniqueTerms.sort((a, b) => tf[b] - tf[a]).slice(0, LIMITS.maxUniqueTerms);
    const kept: Record<string, number> = {};
    for (const t of uniqueTerms) kept[t] = tf[t];
    return { uniqueTerms, tf: kept, docLength: tokens.length };
  }
  return { uniqueTerms, tf, docLength: tokens.length };
}
