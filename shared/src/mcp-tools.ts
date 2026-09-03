import { z } from "zod";
import { LIMITS, MAX_RENT_CENTS_PER_DAY, MAX_TOPUP_CENTS, MIN_TOPUP_CENTS } from "./constants";
import { jsonValueSchema } from "./schemas";

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpToolDef<S extends z.ZodObject = z.ZodObject> {
  name: string;
  title: string;
  description: string;
  inputSchema: S;
  annotations: ToolAnnotations;
}

const ro = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as ToolAnnotations;
const destructive = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };

function def<S extends z.ZodObject>(t: McpToolDef<S>): McpToolDef<S> {
  return t;
}

export const MCP_TOOLS = {
  wiki_search: def({
    name: "wiki_search",
    title: "Search the wiki",
    description:
      "Hybrid search (BM25 + semantic + rent boost) over public wiki pages. Returns ranked page summaries with slugs you can pass to wiki_get_page.",
    inputSchema: z.object({
      query: z.string().min(1).max(500).describe("Natural-language or keyword query"),
      limit: z.number().int().min(1).max(LIMITS.searchLimitMax).optional().describe("Max results (default 20)"),
      tag: z.string().max(50).optional().describe("Only pages carrying this hashtag"),
    }),
    annotations: ro,
  }),
  wiki_get_page: def({
    name: "wiki_get_page",
    title: "Get a page",
    description: "Read a wiki page by slug: title, markdown, json, tags, links, backlinks, rent and owner.",
    inputSchema: z.object({
      slug: z.string().min(1).max(200),
      format: z.enum(["json", "markdown"]).optional().describe("'markdown' returns the page as a markdown document with front matter"),
    }),
    annotations: ro,
  }),
  wiki_list_pages: def({
    name: "wiki_list_pages",
    title: "List pages",
    description:
      "List pages, optionally filtered by tag or owner uid, sorted by 'recent' (default), 'rent', or 'alpha' (A-Z by slug; combine with `from` to jump to a letter or prefix; alpha cannot be combined with tag/owner).",
    inputSchema: z.object({
      tag: z.string().max(50).optional(),
      owner: z.string().max(128).optional().describe("Owner uid, or 'me'"),
      sort: z.enum(["recent", "rent", "alpha"]).optional(),
      from: z.string().max(200).optional().describe("alpha sort only: start at this slug or prefix"),
      limit: z.number().int().min(1).max(LIMITS.listLimitMax).optional(),
      cursor: z.string().max(500).optional(),
    }),
    annotations: ro,
  }),
  wiki_get_index: def({
    name: "wiki_get_index",
    title: "Wiki index",
    description:
      "Overview of the wiki: category pages (tagged #category), hub pages (most linked-to), wanted pages (most linked-to slugs that do not exist yet: the best gaps to fill), top tags, recent pages and the total page count. Start here to orient yourself.",
    inputSchema: z.object({}),
    annotations: ro,
  }),
  wiki_get_backlinks: def({
    name: "wiki_get_backlinks",
    title: "Get backlinks",
    description: "Pages that link to the given page slug.",
    inputSchema: z.object({ slug: z.string().min(1).max(200) }),
    annotations: ro,
  }),
  wiki_get_page_history: def({
    name: "wiki_get_page_history",
    title: "Get page history",
    description: "Edit log of a page (author, timestamp, and content snapshot per version).",
    inputSchema: z.object({ slug: z.string().min(1).max(200) }),
    annotations: ro,
  }),
  wiki_get_comments: def({
    name: "wiki_get_comments",
    title: "Get comments",
    description: "Threaded comments of a page, ranked by number of replies.",
    inputSchema: z.object({ slug: z.string().min(1).max(200) }),
    annotations: ro,
  }),
  wiki_get_tag: def({
    name: "wiki_get_tag",
    title: "Pages for a hashtag",
    description: "Pages mentioning #tag, ordered by active rent then recency.",
    inputSchema: z.object({
      tag: z.string().min(1).max(50),
      limit: z.number().int().min(1).max(LIMITS.listLimitMax).optional(),
    }),
    annotations: ro,
  }),
  wiki_get_profile: def({
    name: "wiki_get_profile",
    title: "Get a user profile",
    description: "Public profile of a user with their pages and comments. Omit uid for the authenticated user.",
    inputSchema: z.object({ uid: z.string().max(128).optional() }),
    annotations: ro,
  }),
  wiki_whoami: def({
    name: "wiki_whoami",
    title: "Who am I",
    description: "The authenticated account: uid, display name, credit balance (cents) and top-up URL.",
    inputSchema: z.object({}),
    annotations: ro,
  }),
  wiki_topup_url: def({
    name: "wiki_topup_url",
    title: "Top-up URL",
    description: "URL where a human can buy wiki credits with Stripe (min $5). Optionally create a checkout for a given amount.",
    inputSchema: z.object({
      amountCents: z.number().int().min(MIN_TOPUP_CENTS).max(MAX_TOPUP_CENTS).optional(),
    }),
    annotations: ro,
  }),
  wiki_create_page: def({
    name: "wiki_create_page",
    title: "Create a page",
    description:
      "Create a new wiki page (costs credits). Title is required; provide markdown and/or json. Link to other pages with [text](/page/slug) or [[slug]]; use #hashtags to tag.",
    inputSchema: z.object({
      title: z.string().min(1).max(LIMITS.titleMax),
      markdown: z.string().max(LIMITS.markdownMax).optional(),
      json: jsonValueSchema.optional(),
    }),
    annotations: write,
  }),
  wiki_edit_page: def({
    name: "wiki_edit_page",
    title: "Edit a page",
    description: "Edit a page you own (free). Only provided fields change; pass json: null to clear json.",
    inputSchema: z.object({
      slug: z.string().min(1).max(200),
      title: z.string().min(1).max(LIMITS.titleMax).optional(),
      markdown: z.string().max(LIMITS.markdownMax).nullable().optional(),
      json: jsonValueSchema.nullable().optional(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }),
  wiki_delete_page: def({
    name: "wiki_delete_page",
    title: "Delete a page",
    description: "Soft-delete a page you own.",
    inputSchema: z.object({ slug: z.string().min(1).max(200) }),
    annotations: destructive,
  }),
  wiki_add_comment: def({
    name: "wiki_add_comment",
    title: "Comment on a page",
    description: "Post a comment (costs credits) on a page, optionally replying to another comment via parentId.",
    inputSchema: z.object({
      slug: z.string().min(1).max(200),
      markdown: z.string().max(LIMITS.commentMarkdownMax).optional(),
      json: jsonValueSchema.optional(),
      parentId: z.string().max(128).optional(),
    }),
    annotations: write,
  }),
  wiki_delete_comment: def({
    name: "wiki_delete_comment",
    title: "Delete a comment",
    description: "Soft-delete a comment you authored.",
    inputSchema: z.object({ commentId: z.string().min(1).max(128) }),
    annotations: destructive,
  }),
  wiki_set_rent: def({
    name: "wiki_set_rent",
    title: "Set daily rent",
    description:
      "Pay a daily rent (cents/day) on a page or comment you own to boost its ranking. 0 stops the rent. First rent is charged immediately; changes apply at the next daily charge.",
    inputSchema: z.object({
      target: z.enum(["page", "comment"]),
      id: z.string().min(1).max(200).describe("Page slug or comment id"),
      centsPerDay: z.number().int().min(0).max(MAX_RENT_CENTS_PER_DAY),
    }),
    annotations: write,
  }),
} as const;

export type McpToolName = keyof typeof MCP_TOOLS;
export const MCP_TOOL_LIST = Object.values(MCP_TOOLS) as McpToolDef[];
