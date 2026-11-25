/**
 * Handles: short, human-readable names for accounts (`@tito`, `openindex.ai/@tito`), bought by
 * humans on the web by burning $OpenIndex, usable everywhere (profile URL, messaging, sharing,
 * referrals). An account may hold several. Pure rules: format, reserved names, prices, and the
 * lifecycle (active → grace → held → free again). The chain and Firestore are in web/lib/handles.ts.
 */

export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 30;
/** Handles one account may hold at once (active, in grace or held). */
export const HANDLE_MAX_PER_ACCOUNT = 10;
/** A renewal may push the expiry at most this many years ahead. */
export const HANDLE_MAX_YEARS_AHEAD = 5;

const DAY_MS = 24 * 60 * 60 * 1000;
/** After expiry the handle still resolves and only its owner can renew it. */
export const HANDLE_GRACE_MS = 30 * DAY_MS;
/** Then it stops resolving, and for this long only its previous owner can register it again. */
export const HANDLE_HOLD_MS = 90 * DAY_MS;
/** A submitted purchase keeps the handle from others while its transaction settles. */
export const HANDLE_PENDING_MS = 30 * 60 * 1000;
/** Renewal reminder emails, this long before expiry. */
export const HANDLE_REMINDERS_MS = [30 * DAY_MS, 7 * DAY_MS] as const;

export const HANDLE_TERMS = ["1y", "2y", "3y", "4y", "lifetime"] as const;
export type HandleTerm = (typeof HANDLE_TERMS)[number];
export type HandleYears = 1 | 2 | 3 | 4;

/** Price of each fixed term, in USD cents. */
export const HANDLE_TERM_PRICES_CENTS: Record<Exclude<HandleTerm, "lifetime">, number> = {
  "1y": 1000,
  "2y": 1500,
  "3y": 1800,
  "4y": 2000,
};

/**
 * Lifetime handles get cheaper the earlier they are bought: the first ones at the first price,
 * and so on. The tier sizes are not published (the web shows a "limited-time" price only).
 */
export const HANDLE_LIFETIME_TIERS: ReadonlyArray<{ upTo: number; cents: number }> = [
  { upTo: 100, cents: 5000 },
  { upTo: 400, cents: 8000 },
  { upTo: Number.POSITIVE_INFINITY, cents: 10_000 },
];

/** Price of the next lifetime handle, given how many are already claimed (sold or in flight). */
export function lifetimePriceCents(claimed: number): number {
  const n = Math.max(0, Math.floor(claimed));
  return HANDLE_LIFETIME_TIERS.find((t) => n < t.upTo)!.cents;
}

/**
 * Premium handles: shorter than HANDLE_PREMIUM_BELOW characters (so 3 to 5), scarcer. Fixed terms
 * (renewals included) cost HANDLE_PREMIUM_MULTIPLIER times as much; lifetime is a flat
 * HANDLE_PREMIUM_LIFETIME_CENTS, with no introductory tiers, and does not use up their slots.
 */
export const HANDLE_PREMIUM_BELOW = 6;
export const HANDLE_PREMIUM_MULTIPLIER = 5;
export const HANDLE_PREMIUM_LIFETIME_CENTS = 50_000;
export const isPremiumHandle = (handle: string) => handle.length < HANDLE_PREMIUM_BELOW;

/** True while the lifetime price is below the final one (shown as a limited-time offer). */
export const lifetimeIsIntroductory = (claimed: number) => lifetimePriceCents(claimed) < HANDLE_LIFETIME_TIERS[HANDLE_LIFETIME_TIERS.length - 1].cents;

/** Whether buying this term takes one of the tiered lifetime slots (standard lifetime handles only). */
export const usesLifetimeSlot = (term: HandleTerm, handle: string) => term === "lifetime" && !isPremiumHandle(handle);

/** Price of a term for this handle, in cents: premium fixed terms cost HANDLE_PREMIUM_MULTIPLIER times as much, premium lifetime is flat. */
export function handleTermPriceCents(term: HandleTerm, lifetimeClaimed: number, handle: string): number {
  const premium = isPremiumHandle(handle);
  if (term === "lifetime") return premium ? HANDLE_PREMIUM_LIFETIME_CENTS : lifetimePriceCents(lifetimeClaimed);
  return premium ? HANDLE_TERM_PRICES_CENTS[term] * HANDLE_PREMIUM_MULTIPLIER : HANDLE_TERM_PRICES_CENTS[term];
}

export const termYears = (term: Exclude<HandleTerm, "lifetime">): HandleYears => Number(term.slice(0, 1)) as HandleYears;

/**
 * Names nobody can register: the site's own top-level routes (now and likely later), system and
 * role words, and OpenIndex itself. Impersonation and trademark disputes are handled by ops
 * (revocation), not by this list.
 */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  // routes and files
  "about", "account", "accounts", "agent", "agents", "api", "app", "apps", "auth", "blog", "channel", "channels",
  "cli", "contact", "credits", "dashboard", "docs", "download", "explore", "faq", "feed", "handle", "handles",
  "home", "index", "invite", "invites", "learn", "llms", "login", "logout", "mcp", "me", "message", "messages",
  "new", "news", "oauth", "page", "pages", "paid", "payouts", "pricing", "privacy", "profile", "robots", "rss",
  "search", "settings", "signin", "signup", "sitemap", "skill", "skills", "status", "tag", "tags", "terms",
  "type", "types", "u", "user", "users", "wallet", "wellknown", "wiki",
  // roles and system words
  "abuse", "admin", "administrator", "all", "anonymous", "billing", "bot", "everyone", "help", "here",
  "hostmaster", "info", "legal", "mod", "moderator", "noreply", "no_reply", "null", "official", "owner",
  "postmaster", "press", "root", "security", "staff", "support", "system", "team", "undefined", "webmaster",
  "you",
  // the house
  "openindex", "open_index", "openindexai", "openindex_ai", "oi",
]);

export type HandleFormatProblem = "length" | "characters" | "underscores" | "reserved";

/** Lowercase, trimmed, without a leading `@`. Does not validate. */
export function normalizeHandle(input: string): string {
  let s = input.trim();
  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep raw */
  }
  return s.replace(/^@+/, "").trim().toLowerCase();
}

/** Why a normalized handle cannot be registered, or null if its format is fine. */
export function handleFormatProblem(handle: string): HandleFormatProblem | null {
  if (handle.length < HANDLE_MIN_LENGTH || handle.length > HANDLE_MAX_LENGTH) return "length";
  if (!/^[a-z0-9_]+$/.test(handle)) return "characters";
  if (handle.startsWith("_") || handle.endsWith("_") || handle.includes("__")) return "underscores";
  if (RESERVED_HANDLES.has(handle) || handle.startsWith("openindex")) return "reserved";
  return null;
}

export const isValidHandle = (handle: string) => handleFormatProblem(handle) === null;

/** Syntactically a handle (any length 1..30, same characters), reserved or not: for resolving `@x` input. */
export const looksLikeHandle = (input: string) => /^@?[a-zA-Z0-9_]{1,30}$/.test(input.trim());

export function handleFormatMessage(p: HandleFormatProblem): string {
  switch (p) {
    case "length":
      return `A handle has ${HANDLE_MIN_LENGTH} to ${HANDLE_MAX_LENGTH} characters`;
    case "characters":
      return "A handle uses lowercase letters, digits and underscores only";
    case "underscores":
      return "A handle cannot start or end with an underscore or contain two in a row";
    case "reserved":
      return "This handle is reserved";
  }
}

export const formatHandle = (handle: string) => `@${handle}`;
export const handlePath = (handle: string) => `/@${handle}`;

/* ------------------------------ lifecycle ------------------------------ */

/** The parts of a handle record the rules look at (times in ms). */
export interface HandleRecordState {
  /** current or last owner; null when never sold */
  uid: string | null;
  status: "active" | "revoked";
  lifetime: boolean;
  /** null for lifetime handles and never-sold records */
  expiresAt: number | null;
  /** a submitted purchase in flight */
  pendingUid?: string | null;
  pendingUntil?: number | null;
}

/**
 * - available: anyone can register it
 * - active: owned and resolving
 * - grace: expired less than HANDLE_GRACE_MS ago; still resolves, only the owner can renew
 * - held: expired longer ago; no longer resolves, only the previous owner can register it again
 * - pending: a purchase is settling on-chain
 * - revoked: taken down by ops; nobody can register it
 */
export type HandleState = "available" | "active" | "grace" | "held" | "pending" | "revoked";

export function handleState(r: HandleRecordState | null, now: number): HandleState {
  if (!r) return "available";
  if (r.status === "revoked") return "revoked";
  if (r.pendingUid && r.pendingUntil && r.pendingUntil > now) return "pending";
  if (!r.uid) return "available";
  if (r.lifetime || r.expiresAt === null) return "active";
  if (now < r.expiresAt) return "active";
  if (now < r.expiresAt + HANDLE_GRACE_MS) return "grace";
  if (now < r.expiresAt + HANDLE_GRACE_MS + HANDLE_HOLD_MS) return "held";
  return "available";
}

/** Whether `@handle` points at its owner (profile, messages, sharing, referrals). */
export const handleResolves = (s: HandleState) => s === "active" || s === "grace";

/** Whether the handle counts against its owner's HANDLE_MAX_PER_ACCOUNT. */
export const handleHeld = (s: HandleState) => s === "active" || s === "grace" || s === "held" || s === "pending";

export type HandlePurchaseKind = "register" | "renew" | "upgrade";

export type HandlePurchaseCheck =
  | { ok: true; kind: HandlePurchaseKind }
  | { ok: false; code: "HANDLE_TAKEN" | "HANDLE_PENDING" | "HANDLE_REVOKED" | "HANDLE_LIFETIME" | "HANDLE_TOO_FAR"; message: string };

const addYears = (ms: number, years: number) => {
  const d = new Date(ms);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.getTime();
};

/**
 * Whether `uid` may buy `term` for this handle now, and what kind of purchase it is. The owner
 * renews (or upgrades to lifetime) while active, in grace or held; anyone else only registers an
 * available handle.
 */
export function checkHandlePurchase(r: HandleRecordState | null, uid: string, term: HandleTerm, now: number): HandlePurchaseCheck {
  const state = handleState(r, now);
  const own = r?.uid === uid;
  if (state === "revoked") return { ok: false, code: "HANDLE_REVOKED", message: "This handle is not available" };
  if (state === "pending") {
    return r?.pendingUid === uid
      ? { ok: false, code: "HANDLE_PENDING", message: "Your purchase of this handle is still settling; wait for it to confirm" }
      : { ok: false, code: "HANDLE_PENDING", message: "Someone is buying this handle right now" };
  }
  if (state === "available") return { ok: true, kind: "register" };
  if (!own) {
    return {
      ok: false,
      code: "HANDLE_TAKEN",
      message: state === "held" ? "This handle expired recently and is held for its previous owner" : "This handle is taken",
    };
  }
  if (r!.lifetime) return { ok: false, code: "HANDLE_LIFETIME", message: "You already own this handle for life" };
  if (term === "lifetime") return { ok: true, kind: "upgrade" };
  const next = handleExpiryAfter(r, uid, term, now)!;
  if (next > addYears(now, HANDLE_MAX_YEARS_AHEAD)) {
    return { ok: false, code: "HANDLE_TOO_FAR", message: `A handle can be paid at most ${HANDLE_MAX_YEARS_AHEAD} years ahead; choose a shorter term` };
  }
  return { ok: true, kind: state === "held" ? "register" : "renew" };
}

/**
 * The expiry after buying `term` (null for lifetime): a renewal while active adds to the current
 * expiry; anything else counts from now.
 */
export function handleExpiryAfter(r: HandleRecordState | null, uid: string, term: HandleTerm, now: number): number | null {
  if (term === "lifetime") return null;
  const base = r?.uid === uid && !r.lifetime && r.expiresAt !== null && r.expiresAt > now ? r.expiresAt : now;
  return addYears(base, termYears(term));
}

/** Lifetime handles say so; others show the expiry date. */
export function describeHandleTerm(lifetime: boolean, expiresAt: number | null): string {
  return lifetime || expiresAt === null ? "Lifetime" : `until ${new Date(expiresAt).toISOString().slice(0, 10)}`;
}
