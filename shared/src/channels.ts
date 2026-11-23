import { LIMITS } from "./constants";
import { slugify } from "./slug";
import type { PageRole, PageVisibility } from "./access";
import type { JsonValue } from "./types";
import type { TaskAction, TaskEvent, TaskInfo, TaskState } from "./tasks";

/**
 * Channels: a stream of posts for a set of members (the same owner/admin/editor/viewer roles and
 * email invites as private pages). Posts are numbered per channel (`seq` 1, 2, 3…), so `after=N`
 * is a gap-free cursor. A post is a thread root or a reply to one (one level, like Slack); roots
 * carry labels (key=value) and, optionally, a task.
 */

/* ------------------------------ Channel ids ------------------------------ */

/** `{name slug}_{6 random [a-z0-9]}`: readable, immutable, and unguessable so private names cannot be probed. */
export const CHANNEL_ID_SUFFIX_LENGTH = 6;
const CHANNEL_ID_BASE_MAX = 40;
const CHANNEL_ID_RE = /^[a-z0-9][a-z0-9_]*_[a-z0-9]{6}$/;

/** The readable part of a channel id: the name as a slug of [a-z0-9_], at most 40 characters. */
export function channelIdBase(name: string): string {
  let s = slugify(name).replace(/[^a-z0-9_]+/g, "_");
  s = s.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  if (s.length > CHANNEL_ID_BASE_MAX) s = s.slice(0, CHANNEL_ID_BASE_MAX).replace(/_+$/g, "");
  return s || "channel";
}

export function isValidChannelId(id: string): boolean {
  return id.length <= CHANNEL_ID_BASE_MAX + 1 + CHANNEL_ID_SUFFIX_LENGTH && CHANNEL_ID_RE.test(id);
}

/** Accept `id`, `#id`, `/channel/id` or a full channel URL from users and agents. */
export function normalizeChannelId(input: string): string {
  let s = input.trim();
  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep raw */
  }
  const m = /\/channel\/([^/?#]+)/.exec(s);
  if (m) s = m[1];
  return s.replace(/^#/, "").toLowerCase();
}

/* ------------------------------ Labels ------------------------------ */

const LABEL_KEY_RE = /^[a-z0-9][a-z0-9_.-]{0,39}$/;

export function isValidLabelKey(key: string): boolean {
  return LABEL_KEY_RE.test(key);
}

/** One label assignment, `key=value`; an empty value (`key=`) removes the label. */
export function parseLabelArg(arg: string): { key: string; value: string | null } {
  const eq = arg.indexOf("=");
  if (eq <= 0) throw new Error(`Label "${arg}" must look like key=value (key= removes it)`);
  const key = arg.slice(0, eq).trim().toLowerCase();
  const value = arg.slice(eq + 1).trim();
  if (!isValidLabelKey(key)) throw new Error(`Invalid label key "${key}": lowercase letters, digits, "_", "." or "-", at most ${LIMITS.labelKeyMax} characters`);
  if (value.length > LIMITS.labelValueMax) throw new Error(`Label "${key}" is longer than ${LIMITS.labelValueMax} characters`);
  return { key, value: value || null };
}

/** Validate a labels map (keys normalized to lowercase, values trimmed); throws a readable Error. */
export function normalizeLabels(labels: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(labels)) {
    const key = rawKey.trim().toLowerCase();
    const value = String(rawValue).trim();
    if (!isValidLabelKey(key)) throw new Error(`Invalid label key "${rawKey}": lowercase letters, digits, "_", "." or "-", at most ${LIMITS.labelKeyMax} characters`);
    if (!value) throw new Error(`Label "${key}" needs a value`);
    if (value.length > LIMITS.labelValueMax || /[\r\n]/.test(value)) throw new Error(`Label "${key}" must be one line of at most ${LIMITS.labelValueMax} characters`);
    out[key] = value;
  }
  if (Object.keys(out).length > LIMITS.labelsPerThread) throw new Error(`A thread can have at most ${LIMITS.labelsPerThread} labels`);
  return out;
}

/** Apply set/remove changes (null removes) to a labels map. */
export function applyLabelChanges(current: Record<string, string> | null | undefined, changes: Record<string, string | null>): Record<string, string> {
  const next: Record<string, string> = { ...(current ?? {}) };
  for (const [rawKey, value] of Object.entries(changes)) {
    const key = rawKey.trim().toLowerCase();
    if (value === null || value.trim() === "") delete next[key];
    else next[key] = value;
  }
  return normalizeLabels(next);
}

/**
 * What a label filter matches: `key=value` (case-insensitive) or a bare `key` (any value).
 * Stored on thread roots as `labelPairs` so either form is a single array-contains query.
 */
export function labelTerm(filter: string): string {
  const eq = filter.indexOf("=");
  if (eq < 0) return filter.trim().toLowerCase();
  return `${filter.slice(0, eq).trim().toLowerCase()}=${filter.slice(eq + 1).trim().toLowerCase()}`;
}

export function labelPairs(labels: Record<string, string> | null | undefined): string[] {
  const out = new Set<string>();
  for (const [k, v] of Object.entries(labels ?? {})) {
    out.add(k.toLowerCase());
    out.add(`${k.toLowerCase()}=${v.toLowerCase()}`);
  }
  return Array.from(out).sort();
}

export function formatLabels(labels: Record<string, string> | null | undefined): string {
  return Object.entries(labels ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
}

/* ------------------------------ Wire types ------------------------------ */

export type ChannelStatus = "active" | "deleted";
export type PostKind = "post" | "event";

export interface Channel {
  id: string;
  url: string;
  name: string;
  description: string;
  visibility: PageVisibility;
  status: ChannelStatus;
  ownerId: string;
  ownerName: string;
  /** members besides the owner */
  memberCount: number;
  /** the number of the last post (posts are numbered 1, 2, 3…; 0 = empty) */
  lastSeq: number;
  threadCount: number;
  /** tasks per stored state (a claimed task whose lease passed still counts as claimed) */
  taskCounts: Partial<Record<TaskState, number>>;
  lastPostAt: string;
  createdAt: string;
  updatedAt: string;
  /** the caller's role; null for anonymous callers and non-members of a public channel */
  role: PageRole | null;
}

export interface ChannelPost {
  channelId: string;
  /** the post's number in the channel */
  seq: number;
  /** the thread it belongs to: its root's seq (equal to seq on a root) */
  threadSeq: number;
  /** true for a thread root (a top-level post) */
  root: boolean;
  /** "event": written by the system (e.g. a task changed state) */
  kind: PostKind;
  authorId: string;
  authorName: string;
  /** self-declared name of the agent that posted, when several share one account */
  agent: string | null;
  markdown: string | null;
  json: JsonValue | null;
  status: ChannelStatus;
  createdAt: string;
  editedAt: string | null;
  url: string;
  /** thread roots only */
  replyCount?: number;
  lastReplyAt?: string | null;
  labels?: Record<string, string>;
  /** thread roots that are tasks */
  task?: TaskInfo | null;
  /** event posts: what happened */
  event?: TaskEvent | null;
}

/** A thread root in a list: a plain-text summary instead of the full content. */
export interface ThreadSummary extends Omit<ChannelPost, "markdown" | "json"> {
  summary: string;
}

export interface ChannelListResponse {
  channels: Channel[];
  nextCursor: string | null;
}

export interface FeedResponse {
  channelId: string;
  /** ascending by seq */
  posts: ChannelPost[];
  /** pass as `after` to read on: the last seq returned (or the `after` you sent when nothing came back) */
  nextAfter: number;
  /** more posts exist after nextAfter right now */
  hasMore: boolean;
  /** the channel's last seq when the request was answered */
  lastSeq: number;
}

export interface ThreadListResponse {
  channelId: string;
  threads: ThreadSummary[];
  nextCursor: string | null;
}

export interface ThreadResponse {
  channelId: string;
  thread: ChannelPost;
  /** ascending by seq */
  replies: ChannelPost[];
  nextAfter: number;
  hasMore: boolean;
}

/** A successful claim: the task (its thread's first post) and the fencing token for renew/complete/release. */
export interface ClaimResult {
  task: ChannelPost | null;
  /** present the claim id to renew, complete or release (a stale holder then gets LEASE_LOST) */
  claimId: string | null;
}

export interface TaskActionResult {
  task: ChannelPost;
  /** the event reply the action added to the thread (null for renew) */
  event: ChannelPost | null;
}

export interface PostResult {
  post: ChannelPost;
  channel: Pick<Channel, "id" | "lastSeq">;
}

/* ------------------------------ Webhooks ------------------------------ */

/** What a channel webhook can subscribe to (`ping` is only sent by the test endpoint). */
export const WEBHOOK_EVENTS = ["post.created", "task.updated", "thread.labels_changed"] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number] | "ping";

export interface WebhookInfo {
  id: string;
  channelId: string;
  url: string;
  events: WebhookEventType[];
  description: string;
  enabled: boolean;
  /** the start of the signing secret (the full secret is shown once, on create and rotate) */
  secretHint: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  consecutiveFailures: number;
  /** HTTP status of the last delivery attempt (null: no response) */
  lastStatus: number | null;
  lastDeliveryAt: string | null;
  lastError: string | null;
  /** why the webhook was turned off automatically (410 Gone, too many failures) */
  disabledReason: string | null;
}

export interface WebhookSecretResult {
  webhook: WebhookInfo;
  /** `whsec_…`: verify deliveries with it (Standard Webhooks); shown only now */
  secret: string;
}

export interface WebhookTestResult {
  ok: boolean;
  status: number | null;
  durationMs: number;
  error: string | null;
}

/** The JSON body of a delivery (signed per Standard Webhooks; `id` equals the webhook-id header). */
export interface WebhookPayload {
  type: WebhookEventType;
  id: string;
  timestamp: string;
  channel: { id: string; name: string; visibility: PageVisibility; url: string };
  /** post.created, thread.labels_changed */
  post?: ChannelPost;
  /** task.updated: the task (its thread's first post) after the change */
  task?: ChannelPost;
  /** task.updated: what happened (an unblock has no event post) */
  action?: TaskAction | "unblock";
  /** task.updated: the event reply the change added to the thread */
  event?: ChannelPost | null;
}
