import type { Command } from "commander";
import { MIN_TOPUP_CENTS, formatCents } from "@openindex/wiki-shared";
import { announce, login, openBrowser, waitForApproval } from "../auth";
import { clearConfig, readConfig } from "../config";
import { getClient, requireAuth } from "../context";
import { UsageError, cents, fail, isJsonMode, log, print } from "../output";

export function registerAuthCommands(program: Command) {
  program
    .command("login")
    .description("Log in with Google via the web app (device flow) and save an API key locally")
    .option("--no-browser", "do not try to open a browser")
    .option("--no-wait", "print the URL/code and exit; continue later with --device-code")
    .option("--device-code <code>", "continue a login started with --no-wait")
    .option("--client-name <name>", "label shown on the approval page", "openindexwiki CLI")
    .action(async (opts: { browser: boolean; wait: boolean; deviceCode?: string; clientName: string }) => {
      try {
        const client = getClient();
        if (opts.deviceCode) {
          const result = await waitForApproval(client, { deviceCode: opts.deviceCode, interval: 5, expiresIn: 600 });
          print(result, (r: typeof result) => `Logged in as ${r.displayName} (${r.uid})`);
          return;
        }
        if (!opts.wait) {
          const start = await client.deviceStart(opts.clientName);
          announce(start);
          if (opts.browser && process.stdout.isTTY) openBrowser(start.verificationUrlComplete);
          print(
            { ...start, next: `openindexwiki login --device-code ${start.deviceCode}` },
            (s: typeof start) => `Approve at ${s.verificationUrlComplete} then run: openindexwiki login --device-code ${s.deviceCode}`,
          );
          return;
        }
        const result = await login(client, { noBrowser: !opts.browser, clientName: opts.clientName });
        print(result, (r: typeof result) => `Logged in as ${r.displayName} (${r.uid})`);
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("logout")
    .description("Remove the saved credentials")
    .option("--revoke", "also revoke the API key on the server")
    .action(async (opts: { revoke?: boolean }) => {
      try {
        const cfg = readConfig();
        if (opts.revoke && cfg.keyId && cfg.apiKey) {
          try {
            await getClient().revokeKey(cfg.keyId);
            log("API key revoked.");
          } catch (err) {
            log(`Could not revoke the key: ${(err as Error).message}`);
          }
        }
        clearConfig();
        print({ ok: true }, () => "Logged out.");
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("whoami")
    .description("Show the authenticated account")
    .action(async () => {
      try {
        const { account, via } = await requireAuth().me();
        print({ ...account, via }, (a: typeof account) => `${a.displayName} (${a.uid}) · balance ${cents(a.balance)} · ${a.counts.pages} pages · ${a.counts.comments} comments`);
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("balance")
    .description("Show the credit balance in cents")
    .action(async () => {
      try {
        const { account } = await requireAuth().me();
        print({ balance: account.balance, formatted: formatCents(account.balance), topupUrl: account.topupUrl }, (b: { formatted: string; topupUrl: string }) => `${b.formatted} (top up: ${b.topupUrl})`);
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("topup")
    .description("Get a URL to buy credits (optionally start a Stripe checkout for an amount in USD)")
    .option("--amount <usd>", "amount in US dollars (min $5)")
    .option("--open", "open the URL in a browser")
    .action(async (opts: { amount?: string; open?: boolean }) => {
      try {
        const client = getClient();
        let url = `${client.baseUrl}/credits`;
        if (opts.amount) {
          const c = Math.round(Number(opts.amount) * 100);
          if (!Number.isFinite(c) || c < MIN_TOPUP_CENTS) throw new UsageError(`Amount must be at least ${formatCents(MIN_TOPUP_CENTS)}`);
          const res = await requireAuth().checkout(c);
          url = res.url;
        }
        if (opts.open) openBrowser(url);
        print({ url }, (u: { url: string }) => `Top up credits at: ${u.url}`);
        if (!isJsonMode()) log("A human needs to complete the payment in a browser.");
      } catch (err) {
        fail(err);
      }
    });
}
