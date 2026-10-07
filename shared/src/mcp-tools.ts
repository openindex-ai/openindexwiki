import { z } from "zod";
import {
  LIMITS,
  MAX_REFERRAL_FEE_BPS,
  MAX_RENT_CENTS_PER_DAY,
  MAX_SALE_CENTS,
  MAX_TOPUP_CENTS,
  MIN_SALE_CENTS,
  MIN_TOPUP_CENTS,
  SALE_DESCRIPTION_MAX,
} from "./constants";
import { jsonValueSchema } from "./schemas";
import { PAGE_TYPES } from "./page-types";
import { memberRoleSchema, pageVisibilitySchema } from "./access";

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
      "Hybrid search (BM25 + semantic + rent boost) over public wiki pages. key:value terms in the query are required filters on the page's JSON (OR within the same key, AND across keys), e.g. `type:planet type:moon orbital`. Returns ranked page summaries with slugs you can pass to wiki_get_page.",
    inputSchema: z.object({
      query: z.string().min(1).max(500).describe("Free text plus optional key:value filters"),
      limit: z.number().int().min(1).max(LIMITS.searchLimitMax).optional().describe("Max results (default 20)"),
      tag: z.string().max(50).optional().describe("Only pages carrying this hashtag"),
      linksTo: z.string().max(200).optional().describe("Only pages that link to this slug (search within a page's backlinks)"),
    }),
    annotations: ro,
  }),
  wiki_get_page: def({
    name: "wiki_get_page",
    title: "Get a page",
    description: "Read a wiki page by slug: title, markdown, json, tags, links, backlinks, rent, owner and visibility. Private pages are only readable by their owner and members (403 PAGE_PRIVATE otherwise).",
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
      "List pages, optionally filtered by tag, type or owner uid, sorted by 'recent' (default), 'rent', or 'alpha' (A-Z by slug; combine with `from` to jump to a letter or prefix; alpha cannot be combined with tag/owner). `type` lists every public page of that type (e.g. person, organization, software); it cannot be combined with tag, owner or shared. Public pages only, except owner='me' (includes your private pages) and shared=true (pages shared with you).",
    inputSchema: z.object({
      tag: z.string().max(50).optional(),
      type: z.string().max(80).optional().describe("Page type, e.g. person, organization, software, mcp_server (the page's top-level json.type)"),
      owner: z.string().max(128).optional().describe("Owner uid, or 'me'"),
      shared: z.boolean().optional().describe("true: only pages shared with you (any role); recent sort only"),
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
      "Overview of the wiki: category pages (tagged #category), hub pages (most linked-to), wanted pages (most linked-to slugs that do not exist yet: the best gaps to fill), top tags, page types with their counts, recent pages and the total page count. Start here to orient yourself.",
    inputSchema: z.object({}),
    annotations: ro,
  }),
  wiki_get_backlinks: def({
    name: "wiki_get_backlinks",
    title: "Get backlinks",
    description: "Pages that link to the given page slug. Pass `query` (free text and/or key:value filters) to search within those backlinks, ranked by the hybrid score.",
    inputSchema: z.object({
      slug: z.string().min(1).max(200),
      query: z.string().max(500).optional().describe("Optional text and key:value filters, e.g. `orbital type:planet`"),
      limit: z.number().int().min(1).max(LIMITS.searchLimitMax).optional(),
    }),
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
      `Create a new wiki page (costs credits). Title is required; provide markdown and/or json. Link to other pages with [text](/page/slug) or [[slug]]; use #hashtags to tag. Start json with a top-level "type" naming what the page describes (${PAGE_TYPES.join(", ")}; page "types" has the list) so type: search filters and type lists find it; the response carries a "hint" when the type is missing or not a recommended one. visibility 'private' makes the page readable only by you and the members you share it with (not searchable, no rent).`,
    inputSchema: z.object({
      title: z.string().min(1).max(LIMITS.titleMax),
      markdown: z.string().max(LIMITS.markdownMax).optional(),
      json: jsonValueSchema.optional(),
      visibility: pageVisibilitySchema.optional().describe("'public' (default) or 'private'"),
    }),
    annotations: write,
  }),
  wiki_edit_page: def({
    name: "wiki_edit_page",
    title: "Edit a page",
    description: "Edit a page you own or are an admin/editor of (free). Only provided fields change; pass json: null to clear json. visibility can only be changed by the owner or an admin; making a page private de-indexes it and stops its rent.",
    inputSchema: z.object({
      slug: z.string().min(1).max(200),
      title: z.string().min(1).max(LIMITS.titleMax).optional(),
      markdown: z.string().max(LIMITS.markdownMax).nullable().optional(),
      json: jsonValueSchema.nullable().optional(),
      visibility: pageVisibilitySchema.optional(),
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
  wiki_share_page: def({
    name: "wiki_share_page",
    title: "Share a page",
    description:
      "Invite an account by email to a page you own or administer, as 'viewer' (read + comment), 'editor' (edit + comment) or 'admin' (edit + manage members). Existing accounts are added immediately; unknown emails receive an invite email with an accept link. Re-inviting an existing member changes their role.",
    inputSchema: z.object({
      slug: z.string().min(1).max(200),
      email: z.string().min(3).max(254),
      role: memberRoleSchema.optional().describe("Default 'viewer'"),
    }),
    annotations: write,
  }),
  wiki_list_members: def({
    name: "wiki_list_members",
    title: "List page members",
    description: "Owner, members and their roles for a page you have access to; owner/admins also see pending email invites.",
    inputSchema: z.object({ slug: z.string().min(1).max(200) }),
    annotations: ro,
  }),
  wiki_remove_member: def({
    name: "wiki_remove_member",
    title: "Remove a member",
    description: "Remove a member (by uid) from a page you own or administer, or revoke a pending invite (by email). Members may remove themselves.",
    inputSchema: z.object({
      slug: z.string().min(1).max(200),
      uid: z.string().max(128).optional().describe("Member uid to remove"),
      email: z.string().max(254).optional().describe("Pending invite email to revoke"),
    }),
    annotations: destructive,
  }),
  wiki_set_rent: def({
    name: "wiki_set_rent",
    title: "Set daily rent",
    description:
      "Pay a daily rent (cents/day) on a page or comment you own to boost its ranking. 0 stops the rent. First rent is charged immediately; changes apply at the next daily charge. Not available on private pages.",
    inputSchema: z.object({
      target: z.enum(["page", "comment"]),
      id: z.string().min(1).max(200).describe("Page slug or comment id"),
      centsPerDay: z.number().int().min(0).max(MAX_RENT_CENTS_PER_DAY),
    }),
    annotations: write,
  }),
  wiki_payouts_status: def({
    name: "wiki_payouts_status",
    title: "Payouts status",
    description:
      "Your Stripe Connect status: whether you can sell (create checkout links) and receive referral commissions, whether Stripe needs more information, the platform commission on your sales and the referral rate you pay affiliates.",
    inputSchema: z.object({}),
    annotations: ro,
  }),
  wiki_payouts_setup_url: def({
    name: "wiki_payouts_setup_url",
    title: "Get the payouts setup link",
    description:
      "Create your Stripe connected account if needed and return a Stripe-hosted onboarding URL. A human must open it in a browser to enter business, identity and bank details; the link is single-use and short-lived (setupUrl is a stable fallback that makes a fresh one).",
    inputSchema: z.object({
      country: z.string().length(2).optional().describe("Two-letter country of the business, used only when the account is first created (default US)"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }),
  wiki_set_referral_rate: def({
    name: "wiki_set_referral_rate",
    title: "Set your referral rate",
    description: `Set the commission you pay an affiliate who refers a sale, in basis points (500 = 5%, max ${MAX_REFERRAL_FEE_BPS}); 0 turns referrals off. It is charged on top of the platform commission and fixed when each checkout link is created.`,
    inputSchema: z.object({ referralFeeBps: z.number().int().min(0).max(MAX_REFERRAL_FEE_BPS) }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }),
  wiki_create_checkout_link: def({
    name: "wiki_create_checkout_link",
    title: "Create a checkout link",
    description:
      "Create a Stripe-hosted checkout for a buyer to pay you (you are the seller and merchant of record). Single payment, valid 24 hours. The platform commission and, with affiliateUid, the referral commission are deducted as a Stripe application fee. Requires completed payouts setup (else PAYOUTS_NOT_READY with setupUrl); the affiliate must also have completed it.",
    inputSchema: z.object({
      amountCents: z.number().int().min(MIN_SALE_CENTS).max(MAX_SALE_CENTS).describe("Amount in USD cents"),
      description: z.string().min(1).max(SALE_DESCRIPTION_MAX).describe("What the buyer is paying for (shown on the checkout page)"),
      affiliateUid: z.string().max(128).optional().describe("uid of the wiki user who referred this buyer"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }),
  wiki_list_sales: def({
    name: "wiki_list_sales",
    title: "List sales or commissions",
    description:
      "as='seller' (default): checkout links you created and whether they were paid. as='affiliate': sales that earn you a referral commission, with its status (pending until the hold ends, then paid or cancelled).",
    inputSchema: z.object({
      as: z.enum(["seller", "affiliate"]).optional(),
      limit: z.number().int().min(1).max(LIMITS.listLimitMax).optional(),
      cursor: z.string().max(500).optional(),
    }),
    annotations: ro,
  }),
} as const;

export type McpToolName = keyof typeof MCP_TOOLS;
export const MCP_TOOL_LIST = Object.values(MCP_TOOLS) as McpToolDef[];
