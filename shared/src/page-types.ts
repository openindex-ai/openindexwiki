import type { JsonValue } from "./types";

/**
 * Page types. A page's type is the top-level `type` of its JSON (`{"type": "person"}`); it is
 * stored on the page as a derived field, like tags are derived from the markdown. The vocabulary
 * is open: these are the recommended values, documented on content/bootstrap/types.md (whose
 * front matter JSON repeats this list; web/test/page-types.test.ts keeps them in sync).
 */
export const PAGE_TYPES = [
  "person",
  "organization",
  "agent",
  "model",
  "software",
  "api",
  "mcp_server",
  "skill",
  "product",
  "service",
  "dataset",
  "standard",
  "publication",
  "place",
  "event",
  "concept",
] as const;
export type RecommendedPageType = (typeof PAGE_TYPES)[number];

/** Common synonyms and the recommended type to use instead, with the `kind` that keeps the nuance. */
export const PAGE_TYPE_ALIASES: Record<string, { type: RecommendedPageType; kind?: string }> = {
  company: { type: "organization", kind: "company" },
  corporation: { type: "organization", kind: "company" },
  startup: { type: "organization", kind: "company" },
  business: { type: "organization", kind: "company" },
  org: { type: "organization" },
  organisation: { type: "organization" },
  nonprofit: { type: "organization", kind: "nonprofit" },
  lab: { type: "organization", kind: "lab" },
  government: { type: "organization", kind: "government" },
  foundation: { type: "organization", kind: "foundation" },
  people: { type: "person" },
  human: { type: "person" },
  individual: { type: "person" },
  ai_agent: { type: "agent" },
  assistant: { type: "agent" },
  bot: { type: "agent" },
  llm: { type: "model" },
  ai_model: { type: "model" },
  tool: { type: "software" },
  library: { type: "software", kind: "library" },
  framework: { type: "software", kind: "framework" },
  app: { type: "software", kind: "app" },
  application: { type: "software", kind: "app" },
  cli: { type: "software", kind: "cli" },
  package: { type: "software", kind: "library" },
  web_api: { type: "api" },
  mcp: { type: "mcp_server" },
  mcp_servers: { type: "mcp_server" },
  agent_skill: { type: "skill" },
  data: { type: "dataset" },
  data_set: { type: "dataset" },
  protocol: { type: "standard" },
  specification: { type: "standard" },
  spec: { type: "standard" },
  file_format: { type: "standard" },
  paper: { type: "publication", kind: "paper" },
  book: { type: "publication", kind: "book" },
  article: { type: "publication", kind: "article" },
  report: { type: "publication", kind: "report" },
  city: { type: "place", kind: "city" },
  country: { type: "place", kind: "country" },
  location: { type: "place" },
  region: { type: "place", kind: "region" },
  conference: { type: "event", kind: "conference" },
  idea: { type: "concept" },
  technique: { type: "concept" },
  method: { type: "concept" },
  theory: { type: "concept" },
};

export const PAGE_TYPE_MAX = 40;

/**
 * Canonical form of a type value: the words of the value (as JSON pair terms split them) joined
 * with underscores, so `type:<normalized>` is exactly the search filter that selects the page.
 * "MCP Server" -> "mcp_server". Null when nothing usable is left, it has no letter, or it is too long.
 */
export function normalizePageType(value: string): string | null {
  const words = value
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const joined = words.join("_");
  if (!joined || joined.length > PAGE_TYPE_MAX || !/\p{L}/u.test(joined)) return null;
  return joined;
}

function topLevelType(json: JsonValue | null | undefined): { present: boolean; value: JsonValue | undefined } {
  if (json === null || json === undefined || typeof json !== "object" || Array.isArray(json)) return { present: false, value: undefined };
  return Object.prototype.hasOwnProperty.call(json, "type") ? { present: true, value: json.type } : { present: false, value: undefined };
}

/** The page type derived from a page's JSON: its top-level `type` string, normalized. Nested `type` keys never count. */
export function pageTypeOf(json: JsonValue | null | undefined): string | null {
  const { value } = topLevelType(json);
  return typeof value === "string" ? normalizePageType(value) : null;
}

export function isRecommendedPageType(type: string): type is RecommendedPageType {
  return (PAGE_TYPES as readonly string[]).includes(type);
}

const TYPES_PAGE = "/page/types";
const LIST = PAGE_TYPES.join(", ");

/**
 * Advice returned with a page write when its type is missing, malformed, a synonym or outside the
 * recommended list. Null when the type is one of the recommended ones.
 */
export function pageTypeHint(json: JsonValue | null | undefined): string | null {
  const { present, value } = topLevelType(json);
  if (!present) {
    return `This page has no type. Add a top-level "type" to its json naming what it describes (${LIST}), e.g. {"type": "concept"}, so type: filters and the /type lists find it. See ${TYPES_PAGE}.`;
  }
  const type = typeof value === "string" ? normalizePageType(value) : null;
  if (!type) return `json.type should be a short word naming what the page describes (${LIST}). See ${TYPES_PAGE}.`;
  if (isRecommendedPageType(type)) return null;
  const alias = PAGE_TYPE_ALIASES[type];
  if (alias) {
    const suggestion = alias.kind ? `{"type": "${alias.type}", "kind": "${alias.kind}"}` : `{"type": "${alias.type}"}`;
    return `"${type}" is a synonym of a recommended type: use ${suggestion} so the page is listed with the other ${alias.type} pages. See ${TYPES_PAGE}.`;
  }
  return `"${type}" is not one of the recommended types (${LIST}). Reuse one of them if it fits, refining with "kind"; see ${TYPES_PAGE}.`;
}
