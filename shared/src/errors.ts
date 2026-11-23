export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "PAGE_PRIVATE"
  | "CHANNEL_PRIVATE"
  | "NOT_FOUND"
  | "VALIDATION"
  | "PAYLOAD_TOO_LARGE"
  | "SLUG_TAKEN"
  | "INSUFFICIENT_CREDITS"
  | "RATE_LIMITED"
  | "CONFLICT"
  | "PAYOUTS_NOT_READY"
  | "PRICE_ABOVE_MAX"
  | "MESSAGES_OFF"
  | "TASK_UNAVAILABLE"
  | "LEASE_LOST"
  // wallets
  | "WALLET_IN_USE"
  | "WALLET_ALREADY_LINKED"
  | "INVALID_SIGNATURE"
  | "CHALLENGE_EXPIRED"
  | "SOLANA_UNAVAILABLE"
  // $OpenIndex top-ups
  | "WALLET_NOT_LINKED"
  | "INSUFFICIENT_TOKENS"
  | "QUOTE_EXPIRED"
  | "TOKEN_TOPUP_LIMIT"
  | "TOKEN_TOPUP_UNAVAILABLE"
  | "INVALID_TRANSACTION"
  | "INTERNAL"
  // device flow
  | "authorization_pending"
  | "slow_down"
  | "expired_token"
  | "access_denied";

export interface ApiErrorBody {
  error: {
    code: ErrorCode | string;
    message: string;
    details?: unknown;
    required?: number;
    balance?: number;
    topupUrl?: string;
    existingSlug?: string;
    /** PAYOUTS_NOT_READY: where to set up or finish Stripe onboarding */
    setupUrl?: string;
  };
}

/** CLI process exit codes. */
export const EXIT_CODES = {
  ok: 0,
  unexpected: 1,
  usage: 2,
  auth: 3,
  notFound: 4,
  credits: 5,
  forbidden: 6,
  conflict: 7,
  network: 8,
} as const;

export function exitCodeFor(code: string | undefined, status?: number): number {
  switch (code) {
    case "UNAUTHORIZED":
      return EXIT_CODES.auth;
    case "FORBIDDEN":
    case "PAGE_PRIVATE":
    case "CHANNEL_PRIVATE":
    case "MESSAGES_OFF":
      return EXIT_CODES.forbidden;
    case "NOT_FOUND":
      return EXIT_CODES.notFound;
    case "VALIDATION":
    case "PAYLOAD_TOO_LARGE":
      return EXIT_CODES.usage;
    case "INSUFFICIENT_CREDITS":
      return EXIT_CODES.credits;
    case "SLUG_TAKEN":
    case "CONFLICT":
    case "PAYOUTS_NOT_READY":
    case "PRICE_ABOVE_MAX":
    case "TASK_UNAVAILABLE":
    case "LEASE_LOST":
    case "WALLET_IN_USE":
    case "WALLET_ALREADY_LINKED":
    case "CHALLENGE_EXPIRED":
    case "WALLET_NOT_LINKED":
    case "INSUFFICIENT_TOKENS":
    case "QUOTE_EXPIRED":
    case "TOKEN_TOPUP_LIMIT":
      return EXIT_CODES.conflict;
    case "INVALID_SIGNATURE":
    case "INVALID_TRANSACTION":
      return EXIT_CODES.usage;
    case "SOLANA_UNAVAILABLE":
    case "TOKEN_TOPUP_UNAVAILABLE":
      return EXIT_CODES.network;
    default:
      if (status === 401) return EXIT_CODES.auth;
      if (status === 403) return EXIT_CODES.forbidden;
      if (status === 404) return EXIT_CODES.notFound;
      if (status === 402) return EXIT_CODES.credits;
      if (status === 409) return EXIT_CODES.conflict;
      if (status && status >= 400 && status < 500) return EXIT_CODES.usage;
      return EXIT_CODES.unexpected;
  }
}
