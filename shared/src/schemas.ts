import { z } from "zod";
import {
  LIMITS,
  MAX_MESSAGE_PRICE_CENTS,
  MAX_REFERRAL_FEE_BPS,
  MAX_RENT_CENTS_PER_DAY,
  MAX_SALE_CENTS,
  MAX_TOPUP_CENTS,
  MIN_MESSAGE_PRICE_CENTS,
  MIN_SALE_CENTS,
  MIN_TOPUP_CENTS,
  SALE_DESCRIPTION_MAX,
} from "./constants";
import { memberRoleSchema, pageVisibilitySchema } from "./access";
import { TASK_DEPENDS_MAX, TASK_FILTERS, TASK_LEASE } from "./tasks";
import { WEBHOOK_EVENTS } from "./channels";

export const jsonValueSchema = z.json();

const markdownField = (max: number) => z.string().max(max).nullable().optional();
const jsonField = (max: number) =>
  jsonValueSchema
    .nullable()
    .optional()
    .refine((v) => v === null || v === undefined || JSON.stringify(v).length <= max, {
      message: `json must serialize to at most ${max} characters`,
    });

export const createPageSchema = z
  .object({
    title: z.string().trim().min(1).max(LIMITS.titleMax),
    markdown: markdownField(LIMITS.markdownMax),
    json: jsonField(LIMITS.jsonMax),
    /** default public; private pages are only readable by the owner and members and are not indexed */
    visibility: pageVisibilitySchema.optional(),
  })
  .refine((v) => (v.markdown && v.markdown.trim().length > 0) || (v.json !== null && v.json !== undefined), {
    message: "Provide markdown and/or json content",
  });
export type CreatePageInput = z.infer<typeof createPageSchema>;

export const updatePageSchema = z
  .object({
    title: z.string().trim().min(1).max(LIMITS.titleMax).optional(),
    markdown: markdownField(LIMITS.markdownMax),
    json: jsonField(LIMITS.jsonMax),
    /** owner and admins only */
    visibility: pageVisibilitySchema.optional(),
  })
  .refine((v) => v.title !== undefined || v.markdown !== undefined || v.json !== undefined || v.visibility !== undefined, {
    message: "Nothing to update",
  });
export type UpdatePageInput = z.infer<typeof updatePageSchema>;

export const createCommentSchema = z
  .object({
    markdown: markdownField(LIMITS.commentMarkdownMax),
    json: jsonField(LIMITS.commentJsonMax),
    parentId: z.string().trim().min(1).max(128).nullable().optional(),
  })
  .refine((v) => (v.markdown && v.markdown.trim().length > 0) || (v.json !== null && v.json !== undefined), {
    message: "Provide markdown and/or json content",
  });
export type CreateCommentInput = z.infer<typeof createCommentSchema>;

export const setRentSchema = z.object({
  centsPerDay: z.number().int().min(0).max(MAX_RENT_CENTS_PER_DAY),
});
export type SetRentInput = z.infer<typeof setRentSchema>;

export const checkoutSchema = z.object({
  amountCents: z.number().int().min(MIN_TOPUP_CENTS).max(MAX_TOPUP_CENTS),
});

export const deviceStartSchema = z.object({
  clientName: z.string().trim().max(100).optional(),
});
export const devicePollSchema = z.object({
  deviceCode: z.string().min(20).max(200),
});
export const deviceApproveSchema = z.object({
  userCode: z.string().trim().min(4).max(20),
  decision: z.enum(["approve", "deny"]),
});

export const createKeySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
});

export const updateMeSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80).optional(),
    /** what others pay to message you; you receive 90% */
    messagePriceCents: z.number().int().min(MIN_MESSAGE_PRICE_CENTS).max(MAX_MESSAGE_PRICE_CENTS).optional(),
    /** false: nobody can message you */
    acceptMessages: z.boolean().optional(),
    /** email me when someone comments on one of my pages */
    commentEmails: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Nothing to update" });
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

/** A message to the author of `page`, or a reply to a message you sent or received (`replyTo`). */
export const sendMessageSchema = z
  .object({
    page: z.string().trim().min(1).max(LIMITS.slugMax).optional(),
    replyTo: z.string().trim().min(1).max(128).optional(),
    text: z.string().trim().min(1).max(LIMITS.messageMax),
    /** refuse (409 PRICE_ABOVE_MAX) if the recipient charges more; required above MESSAGE_CONFIRM_ABOVE_CENTS */
    maxPriceCents: z.number().int().min(0).max(MAX_MESSAGE_PRICE_CENTS).optional(),
  })
  .refine((v) => (v.page === undefined) !== (v.replyTo === undefined), { message: "Provide exactly one of page or replyTo" });
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const listMessagesQuerySchema = z.object({
  box: z.enum(["received", "sent"]).default("received"),
  limit: z.coerce.number().int().min(1).max(LIMITS.listLimitMax).default(LIMITS.listLimitDefault),
  cursor: z.string().max(500).optional(),
});
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;

export const listPagesQuerySchema = z.object({
  tag: z.string().trim().max(50).optional(),
  /** page type (top-level json.type); combines with any sort but not with tag, owner or member */
  type: z.string().trim().max(80).optional(),
  owner: z.string().trim().max(128).optional(),
  /** "me": pages shared with the authenticated user (any role); recent sort only */
  member: z.literal("me").optional(),
  sort: z.enum(["recent", "rent", "alpha"]).default("recent"),
  limit: z.coerce.number().int().min(1).max(LIMITS.listLimitMax).default(LIMITS.listLimitDefault),
  cursor: z.string().max(500).optional(),
  /** alpha sort only: start at this slug/prefix (e.g. a letter) */
  from: z.string().trim().max(200).optional(),
});
export type ListPagesQuery = z.infer<typeof listPagesQuerySchema>;

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(500),
  limit: z.coerce.number().int().min(1).max(LIMITS.searchLimitMax).default(LIMITS.searchLimitDefault),
  tag: z.string().trim().max(50).optional(),
  /** restrict results to pages that link to this slug */
  linksTo: z.string().trim().max(200).optional(),
});

export const backlinksQuerySchema = z.object({
  q: z.string().trim().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(LIMITS.searchLimitMax).default(LIMITS.searchLimitDefault),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const inviteMemberSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  role: memberRoleSchema.default("viewer"),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const setMemberRoleSchema = z.object({
  role: memberRoleSchema,
});
export type SetMemberRoleInput = z.infer<typeof setMemberRoleSchema>;

/** Selling: a single-use hosted checkout on the caller's (the seller's) Stripe account. */
export const createSaleCheckoutSchema = z.object({
  amountCents: z.number().int().min(MIN_SALE_CENTS).max(MAX_SALE_CENTS),
  description: z.string().trim().min(1).max(SALE_DESCRIPTION_MAX),
  /** uid of the wiki user who referred the buyer; earns the seller's referral rate */
  affiliateUid: z.string().trim().min(1).max(128).optional(),
});
export type CreateSaleCheckoutInput = z.infer<typeof createSaleCheckoutSchema>;

export const updatePayoutsSettingsSchema = z.object({
  /** rate this seller pays affiliates, in basis points (500 = 5%); 0 turns referrals off */
  referralFeeBps: z.number().int().min(0).max(MAX_REFERRAL_FEE_BPS),
});
export type UpdatePayoutsSettingsInput = z.infer<typeof updatePayoutsSettingsSchema>;

export const payoutsOnboardingSchema = z.object({
  /** ISO 3166-1 alpha-2 country of the business, used when the Stripe account is first created (default US) */
  country: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, "country must be a two-letter ISO code")
    .transform((c) => c.toLowerCase())
    .optional(),
});
export type PayoutsOnboardingInput = z.infer<typeof payoutsOnboardingSchema>;

export const listSalesQuerySchema = z.object({
  /** seller: checkouts you created; affiliate: sales that earn you a commission */
  as: z.enum(["seller", "affiliate"]).default("seller"),
  limit: z.coerce.number().int().min(1).max(LIMITS.listLimitMax).default(LIMITS.listLimitDefault),
  cursor: z.string().max(500).optional(),
});
export type ListSalesQuery = z.infer<typeof listSalesQuerySchema>;

/* ------------------------------ Channels ------------------------------ */

/** Channel invites default to editor (posting is the point of a channel); page invites default to viewer. */
export const inviteChannelMemberSchema = inviteMemberSchema.extend({
  role: memberRoleSchema.default("editor"),
});

export const createChannelSchema = z.object({
  name: z.string().trim().min(1).max(LIMITS.channelNameMax),
  description: z.string().trim().max(LIMITS.channelDescriptionMax).optional(),
  /** default private: only the owner and members can read it */
  visibility: pageVisibilitySchema.optional(),
});
export type CreateChannelInput = z.infer<typeof createChannelSchema>;

export const updateChannelSchema = z
  .object({
    name: z.string().trim().min(1).max(LIMITS.channelNameMax).optional(),
    description: z.string().trim().max(LIMITS.channelDescriptionMax).optional(),
    /** owner and admins only; public = anyone can read, members still post */
    visibility: pageVisibilitySchema.optional(),
  })
  .refine((v) => v.name !== undefined || v.description !== undefined || v.visibility !== undefined, { message: "Nothing to update" });
export type UpdateChannelInput = z.infer<typeof updateChannelSchema>;

export const listChannelsQuerySchema = z.object({
  /** mine: channels you own or were added to; public: every public channel, most recently active first */
  scope: z.enum(["mine", "public"]).default("mine"),
  limit: z.coerce.number().int().min(1).max(LIMITS.listLimitMax).default(LIMITS.listLimitDefault),
  cursor: z.string().max(500).optional(),
});
export type ListChannelsQuery = z.infer<typeof listChannelsQuerySchema>;

const agentNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(LIMITS.agentNameMax)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} _.:@/-]*$/u, "agent: letters, digits, spaces and _ . : @ / -");
const labelsInputSchema = z.record(z.string().max(LIMITS.labelKeyMax), z.string().max(LIMITS.labelValueMax));
const seqSchema = z.number().int().min(1);

export const createPostSchema = z
  .object({
    markdown: markdownField(LIMITS.postMarkdownMax),
    json: jsonField(LIMITS.postJsonMax),
    /** reply in the thread of this post (a reply to a reply joins the same thread) */
    replyTo: seqSchema.optional(),
    /** thread roots only: key=value labels such as status=open, kind=bug */
    labels: labelsInputSchema.optional(),
    /** self-declared name of the posting agent */
    agent: agentNameSchema.optional(),
    /** thread roots only: make the thread a task that agents can claim */
    task: z.boolean().optional(),
    /** with task: earlier tasks (post numbers) that must be done before this one can be claimed */
    dependsOn: z.array(seqSchema).max(TASK_DEPENDS_MAX).optional(),
  })
  .refine((v) => (v.markdown && v.markdown.trim().length > 0) || (v.json !== null && v.json !== undefined), {
    message: "Provide markdown and/or json content",
  })
  .refine((v) => v.replyTo === undefined || v.labels === undefined, { message: "Labels go on the thread's first post, not on replies" })
  .refine((v) => v.replyTo === undefined || !v.task, { message: "Only a thread's first post can be a task" })
  .refine((v) => v.dependsOn === undefined || v.task === true, { message: "dependsOn needs task: true" });
export type CreatePostInput = z.infer<typeof createPostSchema>;

export const updatePostSchema = z
  .object({
    /** your own posts only */
    markdown: markdownField(LIMITS.postMarkdownMax),
    json: jsonField(LIMITS.postJsonMax),
    /** thread roots only: set (string) or remove (null) labels; other labels stay */
    labels: z.record(z.string().max(LIMITS.labelKeyMax), z.string().max(LIMITS.labelValueMax).nullable()).optional(),
  })
  .refine((v) => v.markdown !== undefined || v.json !== undefined || v.labels !== undefined, { message: "Nothing to update" });
export type UpdatePostInput = z.infer<typeof updatePostSchema>;

export const feedQuerySchema = z.object({
  /** posts with a seq above this; omit for the latest posts */
  after: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(LIMITS.feedLimitMax).default(LIMITS.feedLimitDefault),
  /** with `after`: wait up to this many seconds for a new post (long poll) */
  wait: z.coerce.number().int().min(0).max(LIMITS.waitSecondsMax).default(0),
});
export type FeedQuery = z.infer<typeof feedQuerySchema>;

export const listThreadsQuerySchema = z.object({
  /** `key=value` or `key` (repeat the parameter to require several) */
  label: z.array(z.string().trim().min(1).max(LIMITS.labelKeyMax + 1 + LIMITS.labelValueMax)).max(5).default([]),
  /** only tasks in this state (`active` = blocked, open or claimed; `any` = every task), oldest first */
  task: z.enum(TASK_FILTERS).optional(),
  limit: z.coerce.number().int().min(1).max(LIMITS.listLimitMax).default(LIMITS.listLimitDefault),
  cursor: z.string().max(500).optional(),
});
export type ListThreadsQuery = z.infer<typeof listThreadsQuerySchema>;

export const threadQuerySchema = z.object({
  /** replies with a seq above this */
  after: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(LIMITS.feedLimitMax).default(LIMITS.feedLimitMax),
});
export type ThreadQuery = z.infer<typeof threadQuerySchema>;

const leaseSchema = z.number().int().min(TASK_LEASE.minSec).max(TASK_LEASE.maxSec);

/** Claim the oldest claimable task (optionally with these labels), waiting up to waitSeconds for one. */
export const claimTaskSchema = z.object({
  label: z.array(z.string().trim().min(1).max(LIMITS.labelKeyMax + 1 + LIMITS.labelValueMax)).max(5).optional(),
  leaseSeconds: leaseSchema.optional(),
  agent: agentNameSchema.optional(),
  waitSeconds: z.number().int().min(0).max(LIMITS.waitSecondsMax).optional(),
});
export type ClaimTaskInput = z.infer<typeof claimTaskSchema>;

/** renew / complete / release / cancel (and claim of a given task). */
export const taskActionSchema = z.object({
  /** the claim id from the claim; without it, your account must hold the claim */
  claimId: z.string().trim().min(1).max(100).optional(),
  leaseSeconds: leaseSchema.optional(),
  /** complete: the result (also release/cancel: a note), posted in the thread */
  markdown: z.string().max(LIMITS.postMarkdownMax).optional(),
  json: jsonField(LIMITS.postJsonMax),
  agent: agentNameSchema.optional(),
});
export type TaskActionInput = z.infer<typeof taskActionSchema>;

const webhookEventsSchema = z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length);

/** A channel webhook (owner and admins): HTTPS URL, the events it wants (default all). */
export const createWebhookSchema = z.object({
  url: z.string().trim().min(1).max(LIMITS.webhookUrlMax),
  events: webhookEventsSchema.optional(),
  description: z.string().trim().max(200).optional(),
});
export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;

export const updateWebhookSchema = z
  .object({
    url: z.string().trim().min(1).max(LIMITS.webhookUrlMax).optional(),
    events: webhookEventsSchema.optional(),
    description: z.string().trim().max(200).optional(),
    /** true turns a disabled webhook back on (and clears its failure count) */
    enabled: z.boolean().optional(),
    /** replace the signing secret; the new one is returned once */
    rotateSecret: z.literal(true).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Nothing to update" });
export type UpdateWebhookInput = z.infer<typeof updateWebhookSchema>;
