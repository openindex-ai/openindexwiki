import { EXIT_CODES, exitCodeFor } from "@openindex/wiki-shared";
import { NetworkError, WikiApiError } from "./client";

let jsonMode = false;
let quietMode = false;

export function configureOutput(opts: { json?: boolean; pretty?: boolean; quiet?: boolean }) {
  jsonMode = !!opts.json || (!opts.pretty && !process.stdout.isTTY);
  quietMode = !!opts.quiet;
}

export function isJsonMode(): boolean {
  return jsonMode;
}

/** Diagnostics go to stderr so stdout stays machine-readable. */
export function log(msg: string): void {
  if (!quietMode) process.stderr.write(msg + "\n");
}

export function print(data: unknown, human?: (d: never) => string): void {
  if (jsonMode) {
    process.stdout.write(JSON.stringify({ ok: true, data }) + "\n");
    return;
  }
  const text = human ? human(data as never) : JSON.stringify(data, null, 2);
  process.stdout.write(text.endsWith("\n") ? text : text + "\n");
}

export function fail(err: unknown): never {
  let code = "INTERNAL";
  let message = String((err as Error)?.message ?? err);
  let status: number | undefined;
  let extra: Record<string, unknown> = {};
  let exit: number = EXIT_CODES.unexpected;
  if (err instanceof WikiApiError) {
    code = err.code;
    status = err.status;
    extra = { status: err.status, topupUrl: err.topupUrl, details: err.details, existingSlug: err.existingSlug };
    exit = exitCodeFor(err.code, err.status);
  } else if (err instanceof NetworkError) {
    code = "NETWORK";
    exit = EXIT_CODES.network;
  } else if (err instanceof UsageError) {
    code = "USAGE";
    exit = EXIT_CODES.usage;
  } else if (err instanceof AuthRequiredError) {
    code = "UNAUTHORIZED";
    exit = EXIT_CODES.auth;
  }
  if (jsonMode) {
    const clean = Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined));
    process.stdout.write(JSON.stringify({ ok: false, error: { code, message, ...clean } }) + "\n");
  } else {
    process.stderr.write(`Error${status ? ` (${status})` : ""}: ${message}\n`);
    if (code === "INSUFFICIENT_CREDITS" && extra.topupUrl) process.stderr.write(`Top up your credits here: ${extra.topupUrl}\n`);
    if (code === "UNAUTHORIZED") process.stderr.write(`Run \`openindexwiki login\` or set OPENINDEX_WIKI_TOKEN.\n`);
    if (code === "SLUG_TAKEN" && extra.existingSlug) process.stderr.write(`Existing page: /page/${extra.existingSlug}\n`);
  }
  process.exit(exit);
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export class AuthRequiredError extends Error {
  constructor(message = "Not logged in. Run `openindexwiki login` or set OPENINDEX_WIKI_TOKEN.") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

/* ---------- human formatting helpers ---------- */

export function table(rows: string[][], header?: string[]): string {
  const all = header ? [header, ...rows] : rows;
  if (all.length === 0) return "";
  const widths: number[] = [];
  for (const r of all) r.forEach((c, i) => (widths[i] = Math.max(widths[i] ?? 0, c.length)));
  const line = (r: string[]) => r.map((c, i) => c.padEnd(widths[i])).join("  ").trimEnd();
  const out = all.map(line);
  if (header) out.splice(1, 0, widths.map((w) => "-".repeat(w)).join("  "));
  return out.join("\n");
}

export function truncate(s: string, n: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
}

export function cents(c: number): string {
  return `$${(c / 100).toFixed(2)}`;
}
