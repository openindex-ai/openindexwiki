import { LIMITS } from "./constants";
import type { JsonValue } from "./types";
import { stripCode } from "./links";

/** Keys and primitive values of a JSON document, space separated (for indexing). */
export function flattenJsonValues(value: JsonValue | null | undefined, maxChars = 50_000): string {
  if (value === null || value === undefined) return "";
  const parts: string[] = [];
  let size = 0;
  const push = (s: string) => {
    if (size >= maxChars) return;
    parts.push(s);
    size += s.length + 1;
  };
  const walk = (v: JsonValue) => {
    if (size >= maxChars) return;
    if (v === null) return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
    } else if (typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        push(k);
        walk(x);
      }
    } else {
      push(String(v));
    }
  };
  walk(value);
  return parts.join(" ");
}

/** Plain-text excerpt of markdown for lists and search results. */
export function summarize(markdown: string | null | undefined, json?: JsonValue | null, max = LIMITS.summaryChars): string {
  let text = "";
  if (markdown) {
    text = stripCode(markdown)
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, a, b) => b ?? a)
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^[>\-*+]\s+/gm, "")
      .replace(/[*_~`]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  if (!text && json) {
    text = flattenJsonValues(json, max * 2).replace(/\s+/g, " ").trim();
  }
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

/** Text that gets tokenized (BM25) and embedded. */
export function buildIndexText(p: { title: string; markdown?: string | null; json?: JsonValue | null; tags?: string[] }): string {
  const parts = [p.title];
  if (p.markdown) parts.push(p.markdown);
  if (p.json) parts.push(flattenJsonValues(p.json));
  if (p.tags?.length) parts.push(p.tags.map((t) => `#${t}`).join(" "));
  return parts.join("\n\n");
}
