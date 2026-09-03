import { LIMITS } from "./constants";

/**
 * Wikipedia-style slug: lowercase, spaces → "_", ASCII letters/digits plus "_ - . ( )".
 * Diacritics are stripped (é → e). Immutable once a page is created.
 */
export function slugify(title: string): string {
  let s = title.normalize("NFKC").trim();
  // strip diacritics
  s = s.normalize("NFD").replace(/\p{M}+/gu, "");
  s = s.toLowerCase();
  s = s.replace(/\s+/g, "_");
  s = s.replace(/[^a-z0-9_\-.()]/g, "");
  s = s.replace(/_+/g, "_");
  s = s.replace(/^[_.\-]+|[_.\-]+$/g, "");
  s = s.replace(/\.md$/i, "");
  s = s.replace(/^[_.\-]+|[_.\-]+$/g, "");
  if (s.length > LIMITS.slugMax) s = s.slice(0, LIMITS.slugMax).replace(/[_.\-]+$/g, "");
  return s;
}

export function isValidSlug(slug: string): boolean {
  if (!slug || slug.length > LIMITS.slugMax) return false;
  if (slug === "." || slug === "..") return false;
  if (slug.startsWith("__")) return false;
  return /^[a-z0-9][a-z0-9_\-.()]*$/.test(slug);
}

/** Normalize user-provided slug input (from URLs, CLI args, links). */
export function normalizeSlug(input: string): string {
  let s = input.trim();
  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep raw */
  }
  s = s.replace(/\.md$/i, "");
  return slugify(s);
}

/** Human-readable title suggestion for a slug ("theory_of_mind" -> "Theory of mind"). */
export function titleFromSlug(slug: string): string {
  const words = slug.replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!words) return slug;
  return words.charAt(0).toUpperCase() + words.slice(1);
}
