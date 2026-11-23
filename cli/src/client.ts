import type {
  AcceptedInvite,
  Account,
  ApiErrorBody,
  Channel,
  ChannelListResponse,
  ChannelMembersResponse,
  ChannelPost,
  ClaimResult,
  ClaimTaskInput,
  CreateChannelInput,
  TaskActionInput,
  TaskActionResult,
  CreatePostInput,
  FeedResponse,
  PostResult,
  ThreadListResponse,
  ThreadResponse,
  UpdateChannelInput,
  UpdatePostInput,
  CreateWebhookInput,
  UpdateWebhookInput,
  WebhookInfo,
  WebhookSecretResult,
  WebhookTestResult,
  Comment,
  CommentNode,
  CreateCommentInput,
  CreatePageInput,
  DevicePollResponse,
  DeviceStartResponse,
  EditEntry,
  IndexData,
  InvitePreview,
  InviteResult,
  LedgerEntry,
  MemberRole,
  Message,
  MembersResponse,
  Page,
  PageMember,
  PageResponse,
  PageSummary,
  PayoutsOnboardingLink,
  PayoutsStatus,
  PublicProfile,
  Rent,
  Sale,
  SaleCheckoutResult,
  SearchResponse,
  SendMessageInput,
  SendMessageResult,
  TagInfo,
  TypeInfo,
  UpdateMeInput,
  UpdatePageInput,
} from "@openindex/wiki-shared";
import { VERSION } from "./version";

export class WikiApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public topupUrl?: string,
    public details?: unknown,
    public existingSlug?: string,
    public setupUrl?: string,
    /** INSUFFICIENT_CREDITS / PRICE_ABOVE_MAX: the cents the action costs */
    public required?: number,
  ) {
    super(message);
    this.name = "WikiApiError";
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

type Query = Record<string, string | number | boolean | string[] | undefined | null>;

export interface WikiClientOptions {
  baseUrl: string;
  token?: string;
}

/** The only HTTP layer in the CLI; commands and MCP tools both go through it. */
export class WikiClient {
  baseUrl: string;
  private token?: string;

  constructor(opts: WikiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
  }

  setToken(token: string | undefined) {
    this.token = token;
  }

  get hasToken(): boolean {
    return !!this.token;
  }

  url(path: string, query?: Query): string {
    const u = new URL(this.baseUrl + path);
    if (query)
      for (const [k, v] of Object.entries(query)) {
        if (Array.isArray(v)) for (const item of v) u.searchParams.append(k, item);
        else if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
      }
    return u.toString();
  }

  private async fetchRaw(method: string, path: string, opts: { body?: unknown; query?: Query; accept?: string } = {}): Promise<Response> {
    const headers: Record<string, string> = { "User-Agent": `openindexwiki-cli/${VERSION}`, Accept: opts.accept ?? "application/json" };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    try {
      return await fetch(this.url(path, opts.query), { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
    } catch (err) {
      throw new NetworkError(`Could not reach ${this.baseUrl}: ${(err as Error).message}`);
    }
  }

  async request<T>(method: string, path: string, opts: { body?: unknown; query?: Query } = {}): Promise<T> {
    const res = await this.fetchRaw(method, path, opts);
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const e = (data as ApiErrorBody | null)?.error;
      throw new WikiApiError(res.status, e?.code ?? "HTTP_ERROR", e?.message ?? `${method} ${path} failed with ${res.status}`, e?.topupUrl, e?.details, e?.existingSlug, e?.setupUrl, e?.required);
    }
    return data as T;
  }

  async requestText(path: string, query?: Query, accept = "text/markdown"): Promise<string> {
    const res = await this.fetchRaw("GET", path, { query, accept });
    const text = await res.text();
    if (!res.ok) {
      let e: ApiErrorBody["error"] | undefined;
      try {
        e = (JSON.parse(text) as ApiErrorBody).error;
      } catch {
        /* not json */
      }
      throw new WikiApiError(res.status, e?.code ?? "HTTP_ERROR", e?.message ?? `GET ${path} failed with ${res.status}`, e?.topupUrl);
    }
    return text;
  }

  /* ---------- auth ---------- */
  me() {
    return this.request<{ account: Account; via: string }>("GET", "/api/me");
  }
  updateMe(input: UpdateMeInput) {
    return this.request<{ account: Account }>("PATCH", "/api/me", { body: input });
  }
  deviceStart(clientName: string) {
    return this.request<DeviceStartResponse>("POST", "/api/cli/device/start", { body: { clientName } });
  }
  async devicePoll(deviceCode: string): Promise<DevicePollResponse> {
    const res = await this.fetchRaw("POST", "/api/cli/device/poll", { body: { deviceCode } });
    const text = await res.text();
    try {
      return JSON.parse(text) as DevicePollResponse;
    } catch {
      throw new WikiApiError(res.status, "HTTP_ERROR", `Unexpected response from device poll (${res.status})`);
    }
  }
  revokeKey(keyId: string) {
    return this.request<{ ok: true }>("DELETE", `/api/keys/${encodeURIComponent(keyId)}`);
  }

  /* ---------- pages ---------- */
  listPages(q: { tag?: string; type?: string; owner?: string; member?: "me"; sort?: "recent" | "rent" | "alpha"; from?: string; limit?: number; cursor?: string }) {
    return this.request<{ pages: PageSummary[]; nextCursor: string | null }>("GET", "/api/pages", { query: q });
  }
  getPage(slug: string) {
    return this.request<PageResponse>("GET", `/api/pages/${encodeURIComponent(slug)}`);
  }
  index() {
    return this.request<IndexData>("GET", "/api/index");
  }
  getPageMarkdown(slug: string) {
    return this.requestText(`/api/pages/${encodeURIComponent(slug)}`, { format: "md" });
  }
  /** `hint` says how to fix the page's type when it is missing or not a recommended one */
  createPage(input: CreatePageInput) {
    return this.request<{ page: Page; hint?: string }>("POST", "/api/pages", { body: input });
  }
  updatePage(slug: string, patch: UpdatePageInput) {
    return this.request<{ page: Page; hint?: string }>("PATCH", `/api/pages/${encodeURIComponent(slug)}`, { body: patch });
  }
  deletePage(slug: string) {
    return this.request<{ ok: true }>("DELETE", `/api/pages/${encodeURIComponent(slug)}`);
  }
  backlinks(slug: string) {
    return this.request<{ slug: string; pages: PageSummary[] }>("GET", `/api/pages/${encodeURIComponent(slug)}/backlinks`);
  }
  history(slug: string) {
    return this.request<{ slug: string; edits: EditEntry[] }>("GET", `/api/pages/${encodeURIComponent(slug)}/edits`);
  }
  search(q: string, opts: { limit?: number; tag?: string; linksTo?: string } = {}) {
    return this.request<SearchResponse>("GET", "/api/search", { query: { q, ...opts } });
  }
  tags(limit?: number) {
    return this.request<{ tags: TagInfo[] }>("GET", "/api/tags", { query: { limit } });
  }
  types(limit?: number) {
    return this.request<{ types: TypeInfo[]; recommended: string[] }>("GET", "/api/types", { query: { limit } });
  }
  tag(tag: string, opts: { limit?: number; cursor?: string } = {}) {
    return this.request<{ tag: string; pageCount: number; pages: PageSummary[]; nextCursor: string | null }>("GET", `/api/tags/${encodeURIComponent(tag)}`, { query: opts });
  }

  /* ---------- members / invites ---------- */
  members(slug: string) {
    return this.request<MembersResponse>("GET", `/api/pages/${encodeURIComponent(slug)}/members`);
  }
  invite(slug: string, input: { email: string; role?: MemberRole }) {
    return this.request<InviteResult>("POST", `/api/pages/${encodeURIComponent(slug)}/invites`, { body: input });
  }
  setMemberRole(slug: string, uid: string, role: MemberRole) {
    return this.request<{ member: PageMember }>("PATCH", `/api/pages/${encodeURIComponent(slug)}/members/${encodeURIComponent(uid)}`, { body: { role } });
  }
  removeMember(slug: string, uid: string) {
    return this.request<{ ok: true }>("DELETE", `/api/pages/${encodeURIComponent(slug)}/members/${encodeURIComponent(uid)}`);
  }
  revokeInvite(slug: string, inviteId: string) {
    return this.request<{ ok: true }>("DELETE", `/api/pages/${encodeURIComponent(slug)}/invites/${encodeURIComponent(inviteId)}`);
  }
  previewInvite(token: string) {
    return this.request<{ invite: InvitePreview }>("GET", `/api/invites/${encodeURIComponent(token)}`);
  }
  acceptInvite(token: string) {
    return this.request<{ accepted: AcceptedInvite }>("POST", `/api/invites/${encodeURIComponent(token)}/accept`);
  }

  /* ---------- comments ---------- */
  comments(slug: string) {
    return this.request<{ slug: string; comments: CommentNode[] }>("GET", `/api/pages/${encodeURIComponent(slug)}/comments`);
  }
  addComment(slug: string, input: CreateCommentInput) {
    return this.request<{ comment: Comment }>("POST", `/api/pages/${encodeURIComponent(slug)}/comments`, { body: input });
  }
  deleteComment(id: string) {
    return this.request<{ ok: true }>("DELETE", `/api/comments/${encodeURIComponent(id)}`);
  }

  /* ---------- rent / profile / credits ---------- */
  setRent(target: "page" | "comment", id: string, centsPerDay: number) {
    const path = target === "page" ? `/api/pages/${encodeURIComponent(id)}/rent` : `/api/comments/${encodeURIComponent(id)}/rent`;
    return this.request<{ rent: Rent }>("PUT", path, { body: { centsPerDay } });
  }
  profile(uid: string) {
    return this.request<{ profile: PublicProfile; pages: PageSummary[]; comments: Comment[] }>("GET", `/api/users/${encodeURIComponent(uid)}`);
  }
  checkout(amountCents: number) {
    return this.request<{ url: string; sessionId: string }>("POST", "/api/credits/checkout", { body: { amountCents } });
  }
  ledger(limit = 50) {
    return this.request<{ entries: LedgerEntry[]; nextCursor: string | null }>("GET", "/api/credits/ledger", { query: { limit } });
  }

  /* ---------- messages ---------- */
  sendMessage(input: SendMessageInput) {
    return this.request<SendMessageResult>("POST", "/api/messages", { body: input });
  }
  messages(q: { box?: "received" | "sent"; limit?: number; cursor?: string } = {}) {
    return this.request<{ messages: Message[]; nextCursor: string | null }>("GET", "/api/messages", { query: q });
  }
  message(id: string) {
    return this.request<{ message: Message }>("GET", `/api/messages/${encodeURIComponent(id)}`);
  }

  /* ---------- channels ---------- */
  channels(q: { scope?: "mine" | "public"; limit?: number; cursor?: string } = {}) {
    return this.request<ChannelListResponse>("GET", "/api/channels", { query: q });
  }
  createChannel(input: CreateChannelInput) {
    return this.request<{ channel: Channel }>("POST", "/api/channels", { body: input });
  }
  channel(id: string) {
    return this.request<{ channel: Channel }>("GET", `/api/channels/${encodeURIComponent(id)}`);
  }
  updateChannel(id: string, input: UpdateChannelInput) {
    return this.request<{ channel: Channel }>("PATCH", `/api/channels/${encodeURIComponent(id)}`, { body: input });
  }
  deleteChannel(id: string) {
    return this.request<{ ok: true }>("DELETE", `/api/channels/${encodeURIComponent(id)}`);
  }
  channelMembers(id: string) {
    return this.request<ChannelMembersResponse>("GET", `/api/channels/${encodeURIComponent(id)}/members`);
  }
  inviteToChannel(id: string, input: { email: string; role?: MemberRole }) {
    return this.request<InviteResult>("POST", `/api/channels/${encodeURIComponent(id)}/invites`, { body: input });
  }
  setChannelMemberRole(id: string, uid: string, role: MemberRole) {
    return this.request<{ member: PageMember }>("PATCH", `/api/channels/${encodeURIComponent(id)}/members/${encodeURIComponent(uid)}`, { body: { role } });
  }
  removeChannelMember(id: string, uid: string) {
    return this.request<{ ok: true }>("DELETE", `/api/channels/${encodeURIComponent(id)}/members/${encodeURIComponent(uid)}`);
  }
  revokeChannelInvite(id: string, inviteId: string) {
    return this.request<{ ok: true }>("DELETE", `/api/channels/${encodeURIComponent(id)}/invites/${encodeURIComponent(inviteId)}`);
  }
  post(id: string, input: CreatePostInput) {
    return this.request<PostResult>("POST", `/api/channels/${encodeURIComponent(id)}/posts`, { body: input });
  }
  feed(id: string, q: { after?: number; limit?: number; wait?: number } = {}) {
    return this.request<FeedResponse>("GET", `/api/channels/${encodeURIComponent(id)}/posts`, { query: q });
  }
  getPost(id: string, seq: number) {
    return this.request<{ post: ChannelPost }>("GET", `/api/channels/${encodeURIComponent(id)}/posts/${seq}`);
  }
  updatePost(id: string, seq: number, input: UpdatePostInput) {
    return this.request<{ post: ChannelPost }>("PATCH", `/api/channels/${encodeURIComponent(id)}/posts/${seq}`, { body: input });
  }
  deletePost(id: string, seq: number) {
    return this.request<{ ok: true }>("DELETE", `/api/channels/${encodeURIComponent(id)}/posts/${seq}`);
  }
  claimTask(id: string, input: ClaimTaskInput & { seq?: number }) {
    const { seq, ...body } = input;
    if (seq !== undefined) return this.request<ClaimResult>("POST", `/api/channels/${encodeURIComponent(id)}/tasks/${seq}/claim`, { body: { leaseSeconds: body.leaseSeconds, agent: body.agent } });
    return this.request<ClaimResult>("POST", `/api/channels/${encodeURIComponent(id)}/tasks/claim`, { body });
  }
  taskAction(id: string, seq: number, action: "renew" | "complete" | "release" | "cancel", input: TaskActionInput = {}) {
    return this.request<TaskActionResult>("POST", `/api/channels/${encodeURIComponent(id)}/tasks/${seq}/${action}`, { body: input });
  }
  webhooks(id: string) {
    return this.request<{ webhooks: WebhookInfo[] }>("GET", `/api/channels/${encodeURIComponent(id)}/webhooks`);
  }
  createWebhook(id: string, input: CreateWebhookInput) {
    return this.request<WebhookSecretResult>("POST", `/api/channels/${encodeURIComponent(id)}/webhooks`, { body: input });
  }
  updateWebhook(id: string, webhookId: string, input: UpdateWebhookInput) {
    return this.request<{ webhook: WebhookInfo; secret?: string }>("PATCH", `/api/channels/${encodeURIComponent(id)}/webhooks/${encodeURIComponent(webhookId)}`, { body: input });
  }
  deleteWebhook(id: string, webhookId: string) {
    return this.request<{ ok: true }>("DELETE", `/api/channels/${encodeURIComponent(id)}/webhooks/${encodeURIComponent(webhookId)}`);
  }
  testWebhook(id: string, webhookId: string) {
    return this.request<WebhookTestResult>("POST", `/api/channels/${encodeURIComponent(id)}/webhooks/${encodeURIComponent(webhookId)}/test`);
  }
  threads(id: string, q: { label?: string[]; task?: string; limit?: number; cursor?: string } = {}) {
    return this.request<ThreadListResponse>("GET", `/api/channels/${encodeURIComponent(id)}/threads`, { query: q });
  }
  thread(id: string, seq: number, q: { after?: number; limit?: number } = {}) {
    return this.request<ThreadResponse>("GET", `/api/channels/${encodeURIComponent(id)}/threads/${seq}`, { query: q });
  }

  /* ---------- selling (Stripe Connect) ---------- */
  payouts(refresh = false) {
    return this.request<{ payouts: PayoutsStatus }>("GET", "/api/payouts", { query: { refresh: refresh ? "1" : undefined } });
  }
  payoutsOnboarding(country?: string) {
    return this.request<PayoutsOnboardingLink>("POST", "/api/payouts/onboarding", { body: country ? { country } : {} });
  }
  updatePayouts(referralFeeBps: number) {
    return this.request<{ payouts: PayoutsStatus }>("PATCH", "/api/payouts", { body: { referralFeeBps } });
  }
  createSaleCheckout(input: { amountCents: number; description: string; affiliateUid?: string }) {
    return this.request<SaleCheckoutResult>("POST", "/api/sales/checkout", { body: input });
  }
  sales(q: { as?: "seller" | "affiliate"; limit?: number; cursor?: string } = {}) {
    return this.request<{ sales: Sale[]; nextCursor: string | null }>("GET", "/api/sales", { query: q });
  }
}
