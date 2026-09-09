/** Wire types (JSON over HTTP). Timestamps are ISO-8601 strings. */

export type PageStatus = "active" | "deleted";
export type RentStatus = "none" | "active" | "failed";

export interface Rent {
  /** cents/day the owner wants to pay */
  desired: number;
  /** cents/day actually paid for the current 24h window (used for ranking) */
  active: number;
  status: RentStatus;
  nextChargeAt: string | null;
  lastChargedAt: string | null;
  lastChargeAmount: number;
  lastChangedAt: string | null;
  failedAt: string | null;
  totalPaid: number;
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface PageSummary {
  slug: string;
  url: string;
  title: string;
  summary: string;
  tags: string[];
  ownerId: string;
  ownerName: string;
  rentActive: number;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Page extends PageSummary {
  markdown: string | null;
  json: JsonValue | null;
  status: PageStatus;
  version: number;
  editCount: number;
  links: string[];
  rent: Rent;
}

export interface EditEntry {
  version: number;
  editorId: string;
  editorName: string;
  kind: "create" | "edit" | "delete" | "recreate";
  changed: { title: boolean; markdown: boolean; json: boolean };
  title: string;
  markdown: string | null;
  json: JsonValue | null;
  createdAt: string;
}

export interface Comment {
  id: string;
  pageSlug: string;
  parentId: string | null;
  depth: number;
  authorId: string;
  authorName: string;
  markdown: string | null;
  json: JsonValue | null;
  status: PageStatus;
  descendantCount: number;
  rent: Rent;
  createdAt: string;
  updatedAt: string;
}

export interface CommentNode extends Comment {
  children: CommentNode[];
}

export interface Account {
  uid: string;
  displayName: string;
  photoURL: string | null;
  balance: number;
  totalToppedUp: number;
  totalSpent: number;
  counts: { pages: number; comments: number };
  createdAt: string;
  topupUrl: string;
}

export interface PublicProfile {
  uid: string;
  displayName: string;
  photoURL: string | null;
  counts: { pages: number; comments: number };
  createdAt: string;
}

export type LedgerType =
  | "welcome"
  | "topup"
  | "page_create"
  | "comment_create"
  | "rent_first"
  | "rent"
  | "adjustment";

export interface LedgerEntry {
  id: string;
  type: LedgerType;
  amount: number;
  balanceAfter: number;
  ref: { kind: "page" | "comment" | "stripe" | "system"; id: string } | null;
  createdAt: string;
}

export interface SearchSignals {
  bm25Rank: number | null;
  bm25Score: number | null;
  semanticRank: number | null;
  distance: number | null;
  rentBoost: number;
}

export interface SearchResult extends PageSummary {
  score: number;
  signals: SearchSignals;
}

export interface SearchResponse {
  query: string;
  /** free-text words that drove ranking */
  words: string[];
  /** key:value filters that were required (OR within a key, AND across keys) */
  filters: Record<string, string[]>;
  /** when set, results were restricted to pages linking to this slug */
  linksTo?: string;
  took: number;
  results: SearchResult[];
}

export interface ApiKeyInfo {
  id: string;
  name: string;
  prefix: string;
  source: "web" | "device";
  createdAt: string;
  lastUsedAt: string | null;
  useCount: number;
}

export interface DeviceStartResponse {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  verificationUrlComplete: string;
  expiresIn: number;
  interval: number;
}

export type DevicePollResponse =
  | { status: "authorization_pending" }
  | { status: "slow_down" }
  | { status: "expired" }
  | { status: "access_denied" }
  | { status: "approved"; apiKey: string; keyId: string; uid: string; displayName: string };

export interface TagInfo {
  tag: string;
  pageCount: number;
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

/** Resolution of an outgoing link target (exists = an active page with that slug). */
export interface LinkTarget {
  slug: string;
  url: string;
  title: string | null;
  exists: boolean;
}

export interface HubPage extends PageSummary {
  backlinkCount: number;
}

/** A slug that pages link to but that does not exist yet. */
export interface WantedPage {
  slug: string;
  url: string;
  createUrl: string;
  suggestedTitle: string;
  count: number;
}

export interface IndexData {
  categories: PageSummary[];
  hubs: HubPage[];
  wanted: WantedPage[];
  tags: TagInfo[];
  recent: PageSummary[];
  totalPages: number;
}

export interface PageResponse {
  page: Page;
  backlinks: PageSummary[];
  backlinkCount: number;
  linkTargets: LinkTarget[];
}
