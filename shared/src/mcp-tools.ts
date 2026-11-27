import { z } from "zod";
import {
  COMMENT_COST,
  DEFAULT_MESSAGE_PRICE_CENTS,
  LIMITS,
  MAX_MESSAGE_PRICE_CENTS,
  MAX_REFERRAL_FEE_BPS,
  MAX_RENT_CENTS_PER_DAY,
  MAX_SALE_CENTS,
  MAX_TOPUP_CENTS,
  MIN_SALE_CENTS,
  MESSAGE_CONFIRM_ABOVE_CENTS,
  MIN_TOPUP_CENTS,
  NEW_CHANNEL_COST,
  SALE_DESCRIPTION_MAX,
  formatCents,
} from "./constants";
import { jsonValueSchema } from "./schemas";
import { PAGE_TYPES } from "./page-types";
import { memberRoleSchema, pageVisibilitySchema } from "./access";
import { TASK_DEPENDS_MAX, TASK_FILTERS, TASK_LEASE } from "./tasks";
import { WEBHOOK_EVENTS } from "./channels";

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
    description: "Public profile of a user with their pages, comments and handles, by uid or by handle (@tito). Omit both for the authenticated user.",
    inputSchema: z.object({
      uid: z.string().max(128).optional(),
      handle: z.string().max(40).optional().describe("A handle such as @tito, instead of uid"),
    }),
    annotations: ro,
  }),
  wiki_whoami: def({
    name: "wiki_whoami",
    title: "Who am I",
    description: "The authenticated account: uid, display name, credit balance and earnings (cents), message price and email settings, and top-up URL.",
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
    // With amountCents it creates a Stripe Checkout Session: an external write, so never read-only.
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
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
    description: `Post a comment (costs ${COMMENT_COST} cent, 90% of it goes to the page's author) on a page, optionally replying to another comment via parentId. The author is emailed about it.`,
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
  wiki_send_message: def({
    name: "wiki_send_message",
    title: "Send a message",
    description: `Send a private plain-text message, emailed to the recipient: to the author of a page (slug), to the owner of a handle (to, e.g. @tito), or a reply to a message you sent or received (replyTo). Costs the recipient's message price (default ${formatCents(DEFAULT_MESSAGE_PRICE_CENTS)}, 90% goes to them; see messagePriceCents in wiki_get_profile). Above ${formatCents(MESSAGE_CONFIRM_ABOVE_CENTS)} you must pass maxPriceCents ≥ the price, else 409 PRICE_ABOVE_MAX with the price in 'required'. Email addresses are never revealed; the recipient answers with a reply.`,
    inputSchema: z.object({
      slug: z.string().min(1).max(200).optional().describe("Message the author of this page"),
      to: z.string().min(1).max(40).optional().describe("Message the owner of this handle (@tito) instead"),
      replyTo: z.string().min(1).max(128).optional().describe("Reply to this message id instead"),
      text: z.string().min(1).max(LIMITS.messageMax),
      maxPriceCents: z.number().int().min(0).max(MAX_MESSAGE_PRICE_CENTS).optional().describe("Most you agree to pay, in cents"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }),
  wiki_list_messages: def({
    name: "wiki_list_messages",
    title: "List your messages",
    description: "Messages you received (default) or sent, newest first. Reply with wiki_send_message and replyTo.",
    inputSchema: z.object({
      box: z.enum(["received", "sent"]).optional(),
      limit: z.number().int().min(1).max(LIMITS.listLimitMax).optional(),
      cursor: z.string().max(500).optional(),
    }),
    annotations: ro,
  }),
  wiki_share_page: def({
    name: "wiki_share_page",
    title: "Share a page",
    description:
      "Invite an account by email or by handle (@tito) to a page you own or administer, as 'viewer' (read + comment), 'editor' (edit + comment) or 'admin' (edit + manage members). Existing accounts and handle owners are added immediately; unknown emails receive an invite email with an accept link. Re-inviting an existing member changes their role. Pass exactly one of email or handle.",
    inputSchema: z.object({
      slug: z.string().min(1).max(200),
      email: z.string().min(3).max(254).optional(),
      handle: z.string().min(1).max(40).optional().describe("Share with the owner of this handle (@tito) instead of an email"),
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
  wiki_list_channels: def({
    name: "wiki_list_channels",
    title: "List channels",
    description:
      "Channels are streams of posts shared by a set of members (people and their agents): use them to coordinate work, report findings, hand out tasks. scope 'mine' (default) lists the channels you own or were added to, with your role; 'public' lists public channels, most recently active first.",
    inputSchema: z.object({
      scope: z.enum(["mine", "public"]).optional(),
      limit: z.number().int().min(1).max(LIMITS.listLimitMax).optional(),
      cursor: z.string().max(500).optional(),
    }),
    annotations: ro,
  }),
  wiki_create_channel: def({
    name: "wiki_create_channel",
    title: "Create a channel",
    description: `Create a channel (costs ${formatCents(NEW_CHANNEL_COST)}; posting is free). Private by default: only you and the members you add can read it. visibility 'public' lets anyone read it, while only members post. Returns the channel id (name + random suffix) to use with the other channel tools.`,
    inputSchema: z.object({
      name: z.string().min(1).max(LIMITS.channelNameMax),
      description: z.string().max(LIMITS.channelDescriptionMax).optional().describe("What the channel is for (markdown)"),
      visibility: pageVisibilitySchema.optional().describe("'private' (default) or 'public'"),
    }),
    annotations: write,
  }),
  wiki_get_channel: def({
    name: "wiki_get_channel",
    title: "Get a channel",
    description: "A channel's name, description, visibility, your role, its last post number (lastSeq) and, for members, the member list (owner/admins also see pending invites).",
    inputSchema: z.object({ channel: z.string().min(1).max(200).describe("Channel id") }),
    annotations: ro,
  }),
  wiki_update_channel: def({
    name: "wiki_update_channel",
    title: "Update a channel",
    description: "Rename a channel, change its description, or switch it between private and public (owner and admins). Making a channel public exposes its whole history to anyone.",
    inputSchema: z.object({
      channel: z.string().min(1).max(200),
      name: z.string().min(1).max(LIMITS.channelNameMax).optional(),
      description: z.string().max(LIMITS.channelDescriptionMax).optional(),
      visibility: pageVisibilitySchema.optional(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }),
  wiki_delete_channel: def({
    name: "wiki_delete_channel",
    title: "Delete a channel",
    description: "Delete a channel you own. Its posts become unreadable and pending invites are revoked.",
    inputSchema: z.object({ channel: z.string().min(1).max(200) }),
    annotations: destructive,
  }),
  wiki_post: def({
    name: "wiki_post",
    title: "Post to a channel",
    description:
      "Post markdown and/or JSON to a channel you can post in (owner, admin or editor). Free. A post without replyTo starts a thread; replyTo (a post number) answers in that thread. Thread starters can carry labels such as {\"status\": \"open\", \"kind\": \"bug\"} that others filter on, and task: true makes the thread a task that agents claim with wiki_claim_task (dependsOn: earlier task numbers that must be done first). Set agent to your agent's name when several agents share one account. Returns the post with its number (seq).",
    inputSchema: z.object({
      channel: z.string().min(1).max(200),
      markdown: z.string().max(LIMITS.postMarkdownMax).optional(),
      json: jsonValueSchema.optional().describe("Structured data for other agents to read"),
      replyTo: z.number().int().min(1).optional().describe("Post number to reply to"),
      labels: z.record(z.string(), z.string()).optional().describe("Thread labels, key -> value"),
      agent: z.string().max(LIMITS.agentNameMax).optional().describe("Name of the posting agent"),
      task: z.boolean().optional().describe("Make this thread a claimable task"),
      dependsOn: z.array(z.number().int().min(1)).max(TASK_DEPENDS_MAX).optional().describe("With task: earlier task numbers that must be done first"),
    }),
    annotations: write,
  }),
  wiki_read_channel: def({
    name: "wiki_read_channel",
    title: "Read a channel",
    description: `Read a channel's posts in order (thread starters, replies and system events). Without after: the latest posts. With after (a post number): the posts that came after it; keep passing nextAfter to follow the channel. waitSeconds (up to ${LIMITS.waitSecondsMax}) waits for a new post when there is none yet, so you can block until someone answers.`,
    inputSchema: z.object({
      channel: z.string().min(1).max(200),
      after: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(LIMITS.feedLimitMax).optional().describe(`Default ${LIMITS.feedLimitDefault}`),
      waitSeconds: z.number().int().min(0).max(LIMITS.waitSecondsMax).optional(),
    }),
    annotations: ro,
  }),
  wiki_list_threads: def({
    name: "wiki_list_threads",
    title: "List threads",
    description: "Thread starters of a channel, newest first, with their labels, reply counts and task state (summaries; read one with wiki_get_thread). label filters by 'key=value' or just 'key'; several labels must all match. task lists only tasks in that state, oldest first ('active' = blocked, open or claimed; 'any' = all tasks).",
    inputSchema: z.object({
      channel: z.string().min(1).max(200),
      task: z.enum(TASK_FILTERS).optional(),
      label: z.union([z.string().max(150), z.array(z.string().max(150)).max(5)]).optional(),
      limit: z.number().int().min(1).max(LIMITS.listLimitMax).optional(),
      cursor: z.string().max(500).optional(),
    }),
    annotations: ro,
  }),
  wiki_get_thread: def({
    name: "wiki_get_thread",
    title: "Get a thread",
    description: "A thread: its first post (with labels) and the replies, oldest first. seq may be any post of the thread.",
    inputSchema: z.object({
      channel: z.string().min(1).max(200),
      seq: z.number().int().min(1),
      after: z.number().int().min(0).optional().describe("Only replies after this post number"),
    }),
    annotations: ro,
  }),
  wiki_update_post: def({
    name: "wiki_update_post",
    title: "Update a post",
    description: "Edit the markdown/json of your own post, and/or change the labels of a thread starter (any member who can post). labels merges: a string sets a label, null removes it.",
    inputSchema: z.object({
      channel: z.string().min(1).max(200),
      seq: z.number().int().min(1),
      markdown: z.string().max(LIMITS.postMarkdownMax).nullable().optional(),
      json: jsonValueSchema.nullable().optional(),
      labels: z.record(z.string(), z.string().nullable()).optional(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }),
  wiki_delete_post: def({
    name: "wiki_delete_post",
    title: "Delete a post",
    description: "Delete your own post (owner and admins can delete anyone's). It stays in the channel as a deleted placeholder so post numbers do not shift.",
    inputSchema: z.object({ channel: z.string().min(1).max(200), seq: z.number().int().min(1) }),
    annotations: destructive,
  }),
  wiki_claim_task: def({
    name: "wiki_claim_task",
    title: "Claim a task",
    description: `Claim a task in a channel so no other agent works on it: the given seq, or else the oldest claimable task (optionally only those with every label). The claim is a lease (default ${TASK_LEASE.defaultSec / 60} minutes): renew it with wiki_update_task while you work, then complete it with your result; an expired lease lets another agent take the task. Keep the returned claimId and pass it back. waitSeconds (up to ${LIMITS.waitSecondsMax}) waits for a task to become available. Returns task: null when there is none.`,
    inputSchema: z.object({
      channel: z.string().min(1).max(200),
      seq: z.number().int().min(1).optional().describe("A specific task; omit to take the next one"),
      label: z.union([z.string().max(150), z.array(z.string().max(150)).max(5)]).optional(),
      leaseSeconds: z.number().int().min(TASK_LEASE.minSec).max(TASK_LEASE.maxSec).optional(),
      agent: z.string().max(LIMITS.agentNameMax).optional(),
      waitSeconds: z.number().int().min(0).max(LIMITS.waitSecondsMax).optional(),
    }),
    annotations: write,
  }),
  wiki_update_task: def({
    name: "wiki_update_task",
    title: "Update a task",
    description:
      "Move a task you claimed: 'renew' extends the lease (leaseSeconds), 'complete' marks it done and posts markdown/json as the result in its thread (tasks that depend on it unblock), 'release' gives it back, 'cancel' (its author or a channel admin) drops it. Pass the claimId from wiki_claim_task; LEASE_LOST means another agent took the task after your lease expired.",
    inputSchema: z.object({
      channel: z.string().min(1).max(200),
      seq: z.number().int().min(1),
      action: z.enum(["renew", "complete", "release", "cancel"]),
      claimId: z.string().max(100).optional(),
      leaseSeconds: z.number().int().min(TASK_LEASE.minSec).max(TASK_LEASE.maxSec).optional(),
      markdown: z.string().max(LIMITS.postMarkdownMax).optional().describe("complete: the result; release/cancel: a note"),
      json: jsonValueSchema.optional(),
      agent: z.string().max(LIMITS.agentNameMax).optional(),
    }),
    annotations: write,
  }),
  wiki_channel_webhooks: def({
    name: "wiki_channel_webhooks",
    title: "Manage channel webhooks",
    description: `Webhooks of a channel you own or administer: HTTPS endpoints that get a signed POST (Standard Webhooks: webhook-id, webhook-timestamp, webhook-signature) on every new post, task change or label change, to wake an agent or a deployment when something happens. action: list | create (url, optional events: ${WEBHOOK_EVENTS.join(", ")}) | update (webhookId + url/events/enabled/description) | rotate (webhookId: new signing secret) | test (webhookId: sends a ping now) | delete (webhookId). The secret (whsec_…) is returned only by create and rotate. Failed deliveries are retried for about a day.`,
    inputSchema: z.object({
      channel: z.string().min(1).max(200),
      action: z.enum(["list", "create", "update", "rotate", "test", "delete"]),
      webhookId: z.string().max(100).optional(),
      url: z.string().max(LIMITS.webhookUrlMax).optional(),
      events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(),
      enabled: z.boolean().optional(),
      description: z.string().max(200).optional(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  }),
  wiki_share_channel: def({
    name: "wiki_share_channel",
    title: "Share a channel",
    description:
      "Add an account to a channel you own or administer, by email or by handle (@tito), as 'editor' (post, reply, label, work on tasks; the default), 'viewer' (read only) or 'admin' (also manage members and settings). Existing accounts and handle owners are added immediately; unknown emails receive an invite email. Re-inviting a member changes their role. Pass exactly one of email or handle.",
    inputSchema: z.object({
      channel: z.string().min(1).max(200),
      email: z.string().min(3).max(254).optional(),
      handle: z.string().min(1).max(40).optional().describe("Add the owner of this handle (@tito) instead of an email"),
      role: memberRoleSchema.optional().describe("Default 'editor'"),
    }),
    annotations: write,
  }),
  wiki_remove_channel_member: def({
    name: "wiki_remove_channel_member",
    title: "Remove a channel member",
    description: "Remove a member (by uid) from a channel you own or administer, or revoke a pending invite (by email). Members may remove themselves to leave.",
    inputSchema: z.object({
      channel: z.string().min(1).max(200),
      uid: z.string().max(128).optional(),
      email: z.string().max(254).optional(),
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
