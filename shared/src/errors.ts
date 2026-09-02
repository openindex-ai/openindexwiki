export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "PAYLOAD_TOO_LARGE"
  | "SLUG_TAKEN"
  | "INSUFFICIENT_CREDITS"
  | "RATE_LIMITED"
  | "CONFLICT"
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
      return EXIT_CODES.conflict;
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
