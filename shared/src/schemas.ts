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
