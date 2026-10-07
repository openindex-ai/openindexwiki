import type { MemberRole, McpToolName, PageVisibility } from "@openindex/wiki-shared";
import type { WikiClient } from "../client";

type Args = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" ? v : undefined);
const n = (v: unknown) => (typeof v === "number" ? v : undefined);
const vis = (v: unknown): PageVisibility | undefined => (v === "public" || v === "private" ? v : undefined);
const role = (v: unknown): MemberRole | undefined => (v === "admin" || v === "editor" || v === "viewer" ? v : undefined);

/** Map MCP tool calls to WikiClient calls (used by the stdio server). */
export async function executeTool(client: WikiClient, name: McpToolName, args: Args): Promise<unknown> {
  switch (name) {
    case "wiki_search":
      return client.search(String(args.query ?? ""), { limit: n(args.limit), tag: s(args.tag), linksTo: s(args.linksTo) });
    case "wiki_get_page": {
      const slug = String(args.slug ?? "");
      if (args.format === "markdown") return { slug, markdown: await client.getPageMarkdown(slug) };
      return client.getPage(slug);
    }
    case "wiki_list_pages":
      return client.listPages({ tag: s(args.tag), type: s(args.type), owner: s(args.owner), member: args.shared === true ? "me" : undefined, sort: args.sort as "recent" | "rent" | "alpha" | undefined, from: s(args.from), limit: n(args.limit), cursor: s(args.cursor) });
    case "wiki_get_index":
      return client.index();
    case "wiki_get_backlinks": {
      const q = s(args.query);
      if (q && q.trim()) return client.search(q, { linksTo: String(args.slug ?? ""), limit: n(args.limit) });
      return client.backlinks(String(args.slug ?? ""));
    }
    case "wiki_get_page_history":
      return client.history(String(args.slug ?? ""));
    case "wiki_get_comments":
      return client.comments(String(args.slug ?? ""));
    case "wiki_get_tag":
      return client.tag(String(args.tag ?? "").replace(/^#/, ""), { limit: n(args.limit) });
    case "wiki_get_profile":
      return client.profile(s(args.uid) ?? "me");
    case "wiki_whoami":
      return client.me();
    case "wiki_topup_url": {
      const amount = n(args.amountCents);
      if (amount) return client.checkout(amount);
      return { url: `${client.baseUrl}/credits`, note: "A human must complete the payment in a browser." };
    }
    case "wiki_create_page":
      return client.createPage({ title: String(args.title ?? ""), markdown: s(args.markdown), json: args.json as never, visibility: vis(args.visibility) });
    case "wiki_edit_page":
      return client.updatePage(String(args.slug ?? ""), {
        title: s(args.title),
        markdown: args.markdown === null ? null : s(args.markdown),
        json: args.json as never,
        visibility: vis(args.visibility),
      });
    case "wiki_delete_page":
      return client.deletePage(String(args.slug ?? ""));
    case "wiki_add_comment":
      return client.addComment(String(args.slug ?? ""), { markdown: s(args.markdown), json: args.json as never, parentId: s(args.parentId) ?? null });
    case "wiki_delete_comment":
      return client.deleteComment(String(args.commentId ?? ""));
    case "wiki_payouts_status":
      return client.payouts();
    case "wiki_payouts_setup_url": {
      const link = await client.payoutsOnboarding(s(args.country));
      return { ...link, note: "A human must open url in a browser to finish Stripe onboarding; it is single-use and short-lived (setupUrl makes a fresh one)." };
    }
    case "wiki_set_referral_rate":
      return client.updatePayouts(Number(args.referralFeeBps ?? 0));
    case "wiki_create_checkout_link":
      return client.createSaleCheckout({ amountCents: Number(args.amountCents ?? 0), description: String(args.description ?? ""), affiliateUid: s(args.affiliateUid) });
    case "wiki_list_sales":
      return client.sales({ as: args.as === "affiliate" ? "affiliate" : args.as === "seller" ? "seller" : undefined, limit: n(args.limit), cursor: s(args.cursor) });
    case "wiki_share_page":
      return client.invite(String(args.slug ?? ""), { email: String(args.email ?? ""), role: role(args.role) });
    case "wiki_list_members":
      return client.members(String(args.slug ?? ""));
    case "wiki_remove_member": {
      const slug = String(args.slug ?? "");
      const uid = s(args.uid);
      const email = s(args.email)?.trim().toLowerCase();
      if (uid) return client.removeMember(slug, uid);
      if (email) {
        const { invites } = await client.members(slug);
        const invite = (invites ?? []).find((i) => i.email === email && i.status === "pending");
        if (!invite) throw new Error(`No pending invite for ${email} on /page/${slug}; to remove a member pass their uid (see wiki_list_members)`);
        await client.revokeInvite(slug, invite.id);
        return { ok: true, revoked: invite.id, email };
      }
      throw new Error("Pass uid (to remove a member) or email (to revoke a pending invite)");
    }
    case "wiki_set_rent":
      return client.setRent(args.target as "page" | "comment", String(args.id ?? ""), Number(args.centsPerDay ?? 0));
    default:
      throw new Error(`Unknown tool ${String(name)}`);
  }
}
