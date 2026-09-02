import { LIMITS, PUBLIC_HOSTS } from "./constants";
import { normalizeSlug, isValidSlug, slugify } from "./slug";

/**
 * Regex for segments that must not be scanned for hashtags / wiki-links:
 * fenced code, inline code, markdown links/images, autolinks, bare URLs.
 */
const PROTECTED_RE =
  /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`|!?\[[^\]\n]*\]\([^)\n]*\)|<https?:\/\/[^>\s]+>|https?:\/\/[^\s<>()]+)/g;

/** Apply fn to the parts of markdown that are outside protected segments. */
export function mapOutsideProtected(md: string, fn: (text: string) => string): string {
  let out = "";
  let last = 0;
  for (const m of md.matchAll(PROTECTED_RE)) {
    const idx = m.index ?? 0;
    out += fn(md.slice(last, idx)) + m[0];
    last = idx + m[0].length;
  }
  out += fn(md.slice(last));
  return out;
}

const CODE_RE = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g;

/** Remove fenced and inline code. */
export function stripCode(md: string): string {
  return md.replace(CODE_RE, " ");
}

const WIKILINK_RE = /\[\[([^\]|\n]+?)(?:\|([^\]\n]+?))?\]\]/g;

/** Rewrite [[target]] / [[target|text]] into [text](/page/slug). Code is left untouched. */
export function expandWikiLinks(md: string): string {
  if (!md.includes("[[")) return md;
  return mapOutsideProtected(md, (text) =>
    text.replace(WIKILINK_RE, (_m, target: string, label?: string) => {
      const slug = slugify(target);
      if (!slug) return _m;
      const display = (label ?? target).trim();
      return `[${display}](/page/${slug})`;
    }),
  );
}

const MD_LINK_RE = /!?\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'(][^)]*)?\)/g;

/** Parse a link destination into a wiki page slug, or null if it is not an internal page link. */
export function linkTargetToSlug(dest: string, hosts: string[] = PUBLIC_HOSTS): string | null {
  let path = dest.trim();
  if (/^https?:\/\//i.test(path)) {
    try {
      const u = new URL(path);
      if (!hosts.includes(u.host)) return null;
      path = u.pathname;
    } catch {
      return null;
    }
  }
  if (!path.startsWith("/page/")) return null;
  let rest = path.slice("/page/".length);
  rest = rest.split(/[?#]/)[0];
  if (!rest || rest.includes("/")) return null;
  const slug = normalizeSlug(rest);
  return isValidSlug(slug) ? slug : null;
}

/** Outgoing wiki-link slugs in a markdown document (deduped, self-link removed). */
export function extractLinks(markdown: string | null | undefined, selfSlug?: string, hosts?: string[]): string[] {
  if (!markdown) return [];
  const md = expandWikiLinks(stripCode(markdown));
  const out = new Set<string>();
  const add = (dest: string) => {
    if (out.size >= LIMITS.maxLinks) return;
    const slug = linkTargetToSlug(dest, hosts);
    if (slug && slug !== selfSlug) out.add(slug);
  };
  for (const m of md.matchAll(MD_LINK_RE)) {
    if (m[0].startsWith("!")) continue; // images
    add(m[1]);
  }
  // Bare / autolinked absolute URLs (remark-gfm renders them as links).
  const withoutLinks = md.replace(MD_LINK_RE, " ");
  for (const m of withoutLinks.matchAll(/<?(https?:\/\/[^\s<>()]+)>?/g)) add(m[1]);
  return [...out];
}

/** Hashtag: "#" preceded by start/space/punctuation, then word chars; must contain a letter. */
export const HASHTAG_RE = /(^|[^\p{L}\p{N}_&/#])#([\p{L}\p{N}_][\p{L}\p{N}_\-]{0,49})(?![\p{L}\p{N}_\-])/gu;

export function normalizeTag(tag: string): string {
  return tag.toLowerCase().replace(/^-+|-+$/g, "");
}

export function isValidTag(tag: string): boolean {
  return /^[\p{L}\p{N}_][\p{L}\p{N}_\-]{0,49}$/u.test(tag) && /\p{L}/u.test(tag);
}

/** Hashtags mentioned in markdown (outside code, links and URLs). Lowercased, deduped. */
export function extractTags(markdown: string | null | undefined): string[] {
  if (!markdown || !markdown.includes("#")) return [];
  const out = new Set<string>();
  mapOutsideProtected(markdown, (text) => {
    for (const m of text.matchAll(HASHTAG_RE)) {
      const tag = normalizeTag(m[2]);
      if (isValidTag(tag)) out.add(tag);
      if (out.size >= LIMITS.maxTags) break;
    }
    return text;
  });
  return [...out];
}

/** Turn #hashtags into markdown links to /tag/{tag} (outside code, links and URLs). */
export function linkifyHashtags(markdown: string): string {
  if (!markdown.includes("#")) return markdown;
  return mapOutsideProtected(markdown, (text) =>
    text.replace(HASHTAG_RE, (m, pre: string, tag: string) => {
      const norm = normalizeTag(tag);
      if (!isValidTag(norm)) return m;
      return `${pre}[#${tag}](/tag/${encodeURIComponent(norm)})`;
    }),
  );
}

/** Full render-time transform: [[wiki links]] and #hashtags become standard markdown links. */
export function prepareMarkdownForRender(markdown: string): string {
  return linkifyHashtags(expandWikiLinks(markdown));
}
