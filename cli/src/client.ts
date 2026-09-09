import type {
  Account,
  ApiErrorBody,
  Comment,
  CommentNode,
  CreateCommentInput,
  CreatePageInput,
  DevicePollResponse,
  DeviceStartResponse,
  EditEntry,
  IndexData,
  LedgerEntry,
  Page,
  PageResponse,
  PageSummary,
  PublicProfile,
  Rent,
  SearchResponse,
  TagInfo,
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

type Query = Record<string, string | number | boolean | undefined | null>;

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
    if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
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
      throw new WikiApiError(res.status, e?.code ?? "HTTP_ERROR", e?.message ?? `${method} ${path} failed with ${res.status}`, e?.topupUrl, e?.details, e?.existingSlug);
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
  listPages(q: { tag?: string; owner?: string; sort?: "recent" | "rent" | "alpha"; from?: string; limit?: number; cursor?: string }) {
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
  createPage(input: CreatePageInput) {
    return this.request<{ page: Page }>("POST", "/api/pages", { body: input });
  }
  updatePage(slug: string, patch: UpdatePageInput) {
    return this.request<{ page: Page }>("PATCH", `/api/pages/${encodeURIComponent(slug)}`, { body: patch });
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
  tag(tag: string, opts: { limit?: number; cursor?: string } = {}) {
    return this.request<{ tag: string; pageCount: number; pages: PageSummary[]; nextCursor: string | null }>("GET", `/api/tags/${encodeURIComponent(tag)}`, { query: opts });
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
}
