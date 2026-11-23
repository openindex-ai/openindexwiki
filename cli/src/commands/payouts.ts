import type { Command } from "commander";
import {
  MAX_REFERRAL_FEE_BPS,
  MAX_SALE_CENTS,
  MIN_SALE_CENTS,
  formatBps,
  formatCents,
  type PayoutsOnboardingLink,
  type PayoutsStatus,
  type Sale,
  type SaleCheckoutResult,
} from "@openindex/wiki-shared";
import { openBrowser } from "../auth";
import { requireAuth } from "../context";
import { UsageError, fail, isJsonMode, log, print, table } from "../output";

const STATE_TEXT: Record<PayoutsStatus["state"], string> = {
  not_started: "not set up",
  onboarding: "setup in progress",
  restricted: "action needed",
  active: "active",
};

export function payoutsText(p: PayoutsStatus): string {
  const lines = [`Payouts: ${STATE_TEXT[p.state]}${p.accountId ? ` (${p.accountId})` : ""}`];
  if (p.accountId) {
    lines.push(`  accept payments:          ${p.cardPayments}`, `  receive commissions:      ${p.stripeTransfers}`);
    if (p.requirementsDue) lines.push("  Stripe needs more information: run `openindexwiki payouts setup`");
  }
  lines.push(
    `  platform commission:      ${formatBps(p.platformFeeBps)}`,
    `  referral rate you pay:    ${p.referralFeeBps === 0 ? "off" : formatBps(p.referralFeeBps)}`,
    `  commissions paid after:   ${p.commissionHoldDays} days`,
  );
  if (p.state !== "active") lines.push(`Set up: ${p.setupUrl}`);
  else lines.push(`Stripe Dashboard: ${p.dashboardUrl}`);
  return lines.join("\n");
}

function commissionText(s: Sale): string {
  const c = s.commission;
  if (c.status === "paid") return `paid ${c.paidAt?.slice(0, 10) ?? ""}`;
  if (c.status === "cancelled") return `cancelled (${c.cancelReason})`;
  if (c.status === "pending") return `pending until ${c.releaseAt?.slice(0, 10) ?? "?"}`;
  return "—";
}

export function registerPayoutsCommands(program: Command) {
  const payouts = program
    .command("payouts")
    .description("Get paid with Stripe: payouts status (subcommands: setup, rate, link, sales)")
    .option("--refresh", "re-read the status from Stripe")
    .action(async (opts: { refresh?: boolean }) => {
      try {
        const { payouts: p } = await requireAuth().payouts(!!opts.refresh);
        print(p, payoutsText);
      } catch (err) {
        fail(err);
      }
    });

  payouts
    .command("setup")
    .description("Get the Stripe onboarding link (creates your Stripe account on first use); a human completes it in a browser")
    .option("--country <cc>", "two-letter country of the business, used only when the account is created (default US)")
    .option("--open", "open the link in a browser")
    .action(async (opts: { country?: string; open?: boolean }) => {
      try {
        if (opts.country && !/^[A-Za-z]{2}$/.test(opts.country)) throw new UsageError("--country must be a two-letter code, e.g. US");
        const link = await requireAuth().payoutsOnboarding(opts.country);
        if (opts.open) openBrowser(link.url);
        print(link, (l: PayoutsOnboardingLink) => `Finish payouts setup on Stripe:\n${l.url}\n(single use; if it expires, open ${l.setupUrl})`);
        if (!isJsonMode()) log("A human needs to enter business, identity and bank details in a browser.");
      } catch (err) {
        fail(err);
      }
    });

  payouts
    .command("rate <percent>")
    .description("Set the referral commission you pay affiliates, in percent (0 turns referrals off)")
    .action(async (percent: string) => {
      try {
        const bps = Math.round(Number(percent.replace(/%$/, "")) * 100);
        if (!Number.isFinite(bps) || bps < 0 || bps > MAX_REFERRAL_FEE_BPS) throw new UsageError(`percent must be between 0 and ${MAX_REFERRAL_FEE_BPS / 100}`);
        const { payouts: p } = await requireAuth().updatePayouts(bps);
        print(p, (x: PayoutsStatus) => (x.referralFeeBps === 0 ? "Referrals are off." : `Referral rate set to ${formatBps(x.referralFeeBps)}.`));
      } catch (err) {
        fail(err);
      }
    });

  payouts
    .command("link <amountUsd> <description>")
    .description("Create a Stripe-hosted checkout link for a buyer to pay you (single payment, valid 24 hours)")
    .option("-a, --affiliate <uid>", "wiki user who referred the buyer; earns your referral rate")
    .option("--open", "open the link in a browser")
    .action(async (amountUsd: string, description: string, opts: { affiliate?: string; open?: boolean }) => {
      try {
        const amountCents = Math.round(Number(amountUsd.replace(/^\$/, "")) * 100);
        if (!Number.isFinite(amountCents) || amountCents < MIN_SALE_CENTS || amountCents > MAX_SALE_CENTS) {
          throw new UsageError(`amount must be between ${formatCents(MIN_SALE_CENTS)} and ${formatCents(MAX_SALE_CENTS)}`);
        }
        const res = await requireAuth().createSaleCheckout({ amountCents, description, affiliateUid: opts.affiliate });
        if (opts.open) openBrowser(res.url);
        print(res, (r: SaleCheckoutResult) =>
          [
            `Checkout link (${formatCents(r.sale.amountCents)}, expires ${r.expiresAt.slice(0, 16).replace("T", " ")} UTC):`,
            r.url,
            `Fees: platform ${formatCents(r.sale.platformFeeCents)}${r.sale.referralFeeCents ? ` + affiliate ${formatCents(r.sale.referralFeeCents)}` : ""}; Stripe's processing fee is billed to you.`,
          ].join("\n"),
        );
      } catch (err) {
        fail(err);
      }
    });

  payouts
    .command("sales")
    .description("Checkout links you created, or (--commissions) the sales that earn you a referral commission")
    .option("-c, --commissions", "show sales where you are the affiliate")
    .option("-n, --limit <n>", "max items (default 20)")
    .action(async (opts: { commissions?: boolean; limit?: string }) => {
      try {
        const as = opts.commissions ? "affiliate" : "seller";
        const res = await requireAuth().sales({ as, limit: opts.limit ? Number(opts.limit) : undefined });
        print(res, (r: { sales: Sale[] }) => {
          if (r.sales.length === 0) return as === "seller" ? "No checkout links yet." : "No referral commissions yet.";
          return as === "seller"
            ? table(
                r.sales.map((s) => [s.createdAt.slice(0, 10), s.id.slice(0, 18), s.status, formatCents(s.amountCents), formatCents(s.applicationFeeCents), s.affiliateName ?? "", s.description]),
                ["date", "id", "status", "amount", "fees", "affiliate", "description"],
              )
            : table(
                r.sales.map((s) => [s.createdAt.slice(0, 10), s.sellerName, formatCents(s.commission.cents), commissionText(s), s.description]),
                ["date", "seller", "commission", "status", "description"],
              );
        });
      } catch (err) {
        fail(err);
      }
    });
}
