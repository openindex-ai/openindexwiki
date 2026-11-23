import { WikiClient } from "./client";
import { resolveBaseUrl, resolveToken } from "./config";
import { AuthRequiredError, configureOutput } from "./output";

export interface GlobalOpts {
  json?: boolean;
  pretty?: boolean;
  quiet?: boolean;
  url?: string;
  token?: string;
}

let client: WikiClient | null = null;

export function initContext(opts: GlobalOpts): WikiClient {
  configureOutput({ json: opts.json, pretty: opts.pretty, quiet: opts.quiet });
  client = new WikiClient({ baseUrl: resolveBaseUrl(opts.url), token: resolveToken(opts.token) });
  return client;
}

export function getClient(): WikiClient {
  if (!client) throw new Error("CLI context not initialized");
  return client;
}

export function requireAuth(): WikiClient {
  const c = getClient();
  if (!c.hasToken) throw new AuthRequiredError();
  return c;
}
