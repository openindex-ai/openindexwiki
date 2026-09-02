import { z } from "zod";
import { LIMITS, MAX_RENT_CENTS_PER_DAY, MAX_TOPUP_CENTS, MIN_TOPUP_CENTS } from "./constants";

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
  })
  .refine((v) => v.title !== undefined || v.markdown !== undefined || v.json !== undefined, {
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

export const updateMeSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
});

export const listPagesQuerySchema = z.object({
  tag: z.string().trim().max(50).optional(),
  owner: z.string().trim().max(128).optional(),
  sort: z.enum(["recent", "rent"]).default("recent"),
  limit: z.coerce.number().int().min(1).max(LIMITS.listLimitMax).default(LIMITS.listLimitDefault),
  cursor: z.string().max(500).optional(),
});
export type ListPagesQuery = z.infer<typeof listPagesQuerySchema>;

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(500),
  limit: z.coerce.number().int().min(1).max(LIMITS.searchLimitMax).default(LIMITS.searchLimitDefault),
  tag: z.string().trim().max(50).optional(),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;
