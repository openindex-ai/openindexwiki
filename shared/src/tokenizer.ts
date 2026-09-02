import { LIMITS } from "./constants";

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

export interface Bm25Metrics {
  uniqueTerms: string[];
  tf: Record<string, number>;
  docLength: number;
}

export function bm25Metrics(text: string): Bm25Metrics {
  const tokens = tokenize(text);
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
