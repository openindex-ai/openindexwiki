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
function pairTermsFor(key: string, value: string | number | boolean | null): string[] {
  const k = normalizeKey(key);
  if (!k) return [];
  if (value === null) return [`${k}:null`];
  if (typeof value === "boolean") return [`${k}:${value}`];
  if (typeof value === "number") return Number.isFinite(value) ? [`${k}:${String(value).toLowerCase()}`] : [];
  const words = tokenize(value);
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

/** Query tokens: the usual words plus any key:value pairs written in the query (e.g. type:planet). */
export function tokenizeQuery(query: string): string[] {
  // Plain words come from the query with the key:value expressions removed, so "type:planet"
  // contributes only the pair term (not the noise words "type" and "planet").
  const terms = new Set(tokenize(query.replace(QUERY_PAIR_RE, " ")));
  for (const m of query.matchAll(QUERY_PAIR_RE)) {
    const key = m[1];
    const raw = m[2].replace(/^"|"$/g, "");
    const num = Number(raw);
    const value: string | number | boolean | null =
      raw === "null" ? null : raw === "true" ? true : raw === "false" ? false : raw !== "" && Number.isFinite(num) && /^-?\d+(\.\d+)?$/.test(raw) ? num : raw.replace(/_/g, " ");
    const pairs = pairTermsFor(key, value);
    // A multi-word value written with underscores means the exact joined form; keep only that one.
    const exact = typeof value === "string" && raw.includes("_") ? pairs.filter((t) => t.includes("_")) : pairs;
    for (const t of exact.length ? exact : pairs) terms.add(t);
  }
  return Array.from(terms);
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
