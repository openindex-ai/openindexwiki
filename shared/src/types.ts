/** Wire types (JSON over HTTP). Timestamps are ISO-8601 strings. */
import type { InviteStatus, MemberRole, PageRole, PageVisibility, ResourceKind } from "./access";
import type { CapabilityStatus, CommissionCancelReason, CommissionStatus, PayoutsState, SaleSource, SaleStatus } from "./sales";
import type { HolderTier } from "./token";
import type { TokenTopupStatus } from "./token-topup";
import type { HandleFormatProblem, HandlePurchaseKind, HandleState, HandleTerm } from "./handles";

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
  /** what the page describes: its top-level json.type, normalized (see page-types.ts); null when it has none */
  type: string | null;
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
  /** credits received from other users: comments on your pages and messages to you */
  totalEarned: number;
  counts: { pages: number; comments: number };
  createdAt: string;
  topupUrl: string;
  /** what others pay to send you a message (you receive MESSAGE_RECIPIENT_SHARE_BPS of it) */
  messagePriceCents: number;
  /** false: nobody can message you */
  acceptMessages: boolean;
  /** email me when someone comments on one of my pages */
  commentEmails: boolean;
  /** the Solana wallet linked to this account, if any */
  wallet: LinkedWallet | null;
  /** the linked wallet's $OpenIndex balance and the tier it unlocks; null without a wallet */
  holder: HolderStatus | null;
  /** your primary handle (without the @) while it resolves, else null; all of them: GET /api/me/handles */
  handle: string | null;
}

export interface LinkedWallet {
  address: string;
  linkedAt: string;
}

export interface HolderStatus {
  tier: HolderTier;
  /** balance in base units (6 decimals), as a decimal string */
  tokensRaw: string;
  /** the same balance in whole tokens, formatted ("123,456.5") */
  tokens: string;
  /** when the balance was last read from Solana */
  checkedAt: string;
}

/** GET /api/wallet: your wallet, your tier and what each tier unlocks. */
export interface WalletStatus {
  wallet: LinkedWallet | null;
  holder: HolderStatus | null;
  mint: string;
  tiers: Array<{ tier: Exclude<HolderTier, "none">; minTokens: number; quotaMultiplier: number }>;
}

/** POST /api/wallet/challenge: sign `message` with the wallet, then link it with the nonce and signature. */
export interface WalletChallenge {
  nonce: string;
  message: string;
  expiresAt: string;
}

export interface PublicProfile {
  uid: string;
  displayName: string;
  photoURL: string | null;
  counts: { pages: number; comments: number };
  createdAt: string;
  /** what it costs to message this user (POST /api/messages with a page they own) */
  messagePriceCents: number;
  acceptsMessages: boolean;
  /** $OpenIndex holder tier of the linked wallet (the address is never public); null below the first tier */
  holderTier: Exclude<HolderTier, "none"> | null;
  /** the account's primary handle (without the @) while it resolves, else null */
  handle: string | null;
  /** whether that handle is a lifetime one (shown as a badge) */
  handleLifetime: boolean;
}

/** A handle as anyone can see it (GET /api/handles/{handle}). */
export interface HandleInfo {
  handle: string;
  /** "/@handle" */
  url: string;
  state: HandleState;
  /** the owner while the handle resolves (active or in grace), else null */
  owner: PublicProfile | null;
  lifetime: boolean;
  /** null for lifetime handles */
  expiresAt: string | null;
  /** when the current owner first registered it */
  since: string | null;
}

/** One of your handles (GET /api/handles?mine=1). */
export interface OwnedHandle {
  handle: string;
  url: string;
  state: HandleState;
  lifetime: boolean;
  expiresAt: string | null;
  since: string;
  primary: boolean;
  /** the last moment you can renew before anyone else may register it (null for lifetime) */
  renewableUntil: string | null;
}

/** GET /api/handles/{handle}/availability: whether you can buy it, and the prices. */
export interface HandleAvailability {
  handle: string;
  /** null when the format is fine */
  problem: HandleFormatProblem | null;
  problemMessage: string | null;
  state: HandleState | null;
  /** what buying it would be for you: register, renew, upgrade (lifetime), or null if you cannot */
  kind: HandlePurchaseKind | null;
  reason: string | null;
  /** prices in USD cents per term; terms you cannot buy now are absent */
  prices: Partial<Record<HandleTerm, number>>;
  /** the lifetime price is introductory (a limited-time offer) */
  lifetimeOffer: boolean;
  /** shorter than HANDLE_PREMIUM_BELOW characters: every term costs HANDLE_PREMIUM_MULTIPLIER times as much */
  premium: boolean;
}

export type HandleQuoteStatus = TokenTopupStatus;

/** A handle purchase paid by burning $OpenIndex (POST /api/handles/quote). */
export interface HandleQuote {
  quoteId: string;
  status: HandleQuoteStatus;
  handle: string;
  term: HandleTerm;
  kind: HandlePurchaseKind;
  /** a premium (short) handle, priced HANDLE_PREMIUM_MULTIPLIER times */
  premium: boolean;
  wallet: string;
  /** price in USD cents */
  cents: number;
  tokensRaw: string;
  tokens: string;
  /** all of it is burned */
  burnRaw: string;
  priceUsd: number;
  transaction: string;
  message: string;
  expiresAt: string;
  signature: string | null;
  error: string | null;
  createdAt: string;
  confirmedAt: string | null;
}

/** A paid message from one user to another, about one of the recipient's pages or as a reply. */
export interface Message {
  id: string;
  fromUid: string;
  fromName: string;
  toUid: string;
  toName: string;
  /** the page the conversation is about (kept on replies), null when there is none */
  pageSlug: string | null;
  pageTitle: string | null;
  /** the message this one answers */
  replyToId: string | null;
  text: string;
  /** what the sender paid */
  priceCents: number;
  createdAt: string;
}

export interface SendMessageResult {
  message: Message;
  /** cents charged to the sender */
  charged: number;
  /** the sender's balance after the charge */
  balance: number;
}

export type LedgerType =
  | "welcome"
  | "topup"
  | "page_create"
  | "comment_create"
  | "rent_first"
  | "rent"
  | "adjustment"
  /** the page author's share of a comment on their page */
  | "comment_earning"
  | "message_send"
  /** the recipient's share of a message */
  | "message_earning"
  | "channel_create"
  /** credits bought with $OpenIndex (paid value plus the bonus) */
  | "token_topup";

export type LedgerRefKind = "page" | "comment" | "message" | "channel" | "stripe" | "solana" | "system";

export interface LedgerEntry {
  id: string;
  type: LedgerType;
  amount: number;
  balanceAfter: number;
  ref: { kind: LedgerRefKind; id: string } | null;
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

/** A page type and how many public pages carry it. */
export interface TypeInfo {
  type: string;
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
  /** page types by number of public pages */
  types: TypeInfo[];
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

/** A channel's members (the same shape as a page's, keyed by `channelId`). */
export interface ChannelMembersResponse extends Omit<MembersResponse, "slug"> {
  channelId: string;
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
  /** the invite id */
  id: string;
  /** what the invite opens: a page or a channel */
  kind: ResourceKind;
  /** the page slug or the channel id */
  targetId: string;
  title: string;
  url: string;
  /** @deprecated use targetId (kept for CLI ≤ 0.7; holds the channel id on channel invites) */
  pageSlug: string;
  /** @deprecated use title */
  pageTitle: string;
  /** @deprecated use url */
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
  kind: ResourceKind;
  /** the page slug or the channel id */
  targetId: string;
  title: string;
  url: string;
  role: PageRole;
  /** @deprecated use targetId (kept for CLI ≤ 0.7) */
  slug: string;
  /** @deprecated use title */
  pageTitle: string;
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
