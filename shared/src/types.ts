/** Wire types (JSON over HTTP). Timestamps are ISO-8601 strings. */
import type { InviteStatus, MemberRole, PageRole, PageVisibility } from "./access";
import type { CapabilityStatus, CommissionCancelReason, CommissionStatus, PayoutsState, SaleSource, SaleStatus } from "./sales";

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
  /** private pages are only readable by the owner and members and are not indexed */
  visibility: PageVisibility;
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
  changed: { title: boolean; markdown: boolean; json: boolean; visibility?: boolean };
  title: string;
  markdown: string | null;
  json: JsonValue | null;
  visibility?: PageVisibility;
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

/** An app connected to the account through OAuth (e.g. ChatGPT), as listed on the account page. */
export interface OAuthGrantInfo {
  id: string;
  clientName: string;
  /** host of the client's metadata URL or redirect URI, shown next to the name */
  clientHost: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string;
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

export interface PageMember {
  uid: string;
  displayName: string;
  photoURL: string | null;
  role: PageRole;
}

/** A pending (or recently settled) email invite to a page. */
export interface PageInvite {
  id: string;
  email: string;
  role: MemberRole;
  status: InviteStatus;
  invitedBy: string;
  invitedByName: string;
  createdAt: string;
  expiresAt: string;
}

export interface MembersResponse {
  slug: string;
  visibility: PageVisibility;
  viewerRole: PageRole | null;
  owner: PageMember;
  members: PageMember[];
  /** only present for the owner and admins (invite emails are private) */
  invites?: PageInvite[];
}

export type InviteResult =
  | { status: "added"; member: PageMember; updated: boolean; emailSent: boolean }
  | { status: "invited"; invite: PageInvite; emailSent: boolean };

/** What the /invite/{token} page shows before the invitee signs in. */
export interface InvitePreview {
  id: string;
  pageSlug: string;
  pageTitle: string;
  pageUrl: string;
  role: MemberRole;
  invitedByName: string;
  /** masked, e.g. t***@example.com */
  emailHint: string;
  status: InviteStatus;
  expiresAt: string;
}

/** Result of accepting an invite. */
export interface AcceptedInvite {
  slug: string;
  pageTitle: string;
  url: string;
  role: PageRole;
}

export interface PageResponse {
  page: Page;
  backlinks: PageSummary[];
  backlinkCount: number;
  linkTargets: LinkTarget[];
}

/** Your Stripe Connect status for selling and for receiving referral commissions. */
export interface PayoutsStatus {
  /** Stripe connected account id (acct_…), null until setup starts */
  accountId: string | null;
  state: PayoutsState;
  canSell: boolean;
  canReceiveCommissions: boolean;
  /** Stripe card_payments (selling) */
  cardPayments: CapabilityStatus;
  /** Stripe stripe_balance.stripe_transfers (receiving commissions) */
  stripeTransfers: CapabilityStatus;
  /** Stripe needs more information; continue onboarding */
  requirementsDue: boolean;
  /** when the status was last read from Stripe */
  checkedAt: string | null;
  /** platform commission on your sales (basis points) */
  platformFeeBps: number;
  /** referral commission you pay affiliates (basis points; 0 = referrals off) */
  referralFeeBps: number;
  maxReferralFeeBps: number;
  /** days before an affiliate commission is paid */
  commissionHoldDays: number;
  /** the web page to set up payouts or continue onboarding */
  setupUrl: string;
  /** the Stripe Dashboard, where sellers manage payments, refunds, disputes and payouts */
  dashboardUrl: string;
}

export interface SaleCommission {
  status: CommissionStatus;
  /** quoted at sale time; the final amount once paid */
  cents: number;
  releaseAt: string | null;
  paidAt: string | null;
  cancelReason: CommissionCancelReason | null;
  /** why the last payout attempt did not go through */
  lastError: string | null;
}

export interface Sale {
  id: string;
  source: SaleSource;
  status: SaleStatus;
  sellerUid: string;
  sellerName: string;
  affiliateUid: string | null;
  affiliateName: string | null;
  description: string;
  amountCents: number;
  currency: string;
  platformFeeBps: number;
  referralFeeBps: number;
  platformFeeCents: number;
  referralFeeCents: number;
  applicationFeeCents: number;
  /** only for the seller, while the checkout is open */
  checkoutUrl: string | null;
  checkoutExpiresAt: string;
  paidAt: string | null;
  commission: SaleCommission;
  createdAt: string;
}

export interface SaleCheckoutResult {
  /** Stripe-hosted checkout for the buyer: one payment, expires at expiresAt */
  url: string;
  sessionId: string;
  expiresAt: string;
  sale: Sale;
}

export interface PayoutsOnboardingLink {
  /** Stripe-hosted onboarding; single use and short-lived, open it in a browser */
  url: string;
  expiresAt: string | null;
  /** stable fallback: the wiki page that creates a fresh onboarding link */
  setupUrl: string;
  payouts: PayoutsStatus;
}
