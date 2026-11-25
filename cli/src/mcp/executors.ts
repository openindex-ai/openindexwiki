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
      return client.profile(s(args.handle) ? `@${String(args.handle).replace(/^@+/, "")}` : (s(args.uid) ?? "me"));
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
    case "wiki_send_message":
      return client.sendMessage({ page: s(args.slug), to: s(args.to), replyTo: s(args.replyTo), text: String(args.text ?? ""), maxPriceCents: n(args.maxPriceCents) });
    case "wiki_list_messages":
      return client.messages({ box: args.box === "sent" ? "sent" : args.box === "received" ? "received" : undefined, limit: n(args.limit), cursor: s(args.cursor) });
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
      return client.invite(String(args.slug ?? ""), { ...shareArg(args), role: role(args.role) });
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
    case "wiki_list_channels":
      return client.channels({ scope: args.scope === "public" ? "public" : args.scope === "mine" ? "mine" : undefined, limit: n(args.limit), cursor: s(args.cursor) });
    case "wiki_create_channel":
      return client.createChannel({ name: String(args.name ?? ""), description: s(args.description), visibility: vis(args.visibility) });
    case "wiki_get_channel": {
      const res = await client.channel(String(args.channel ?? ""));
      if (!res.channel.role) return res;
      return { ...res, members: await client.channelMembers(res.channel.id) };
    }
    case "wiki_update_channel":
      return client.updateChannel(String(args.channel ?? ""), { name: s(args.name), description: s(args.description), visibility: vis(args.visibility) });
    case "wiki_delete_channel":
      return client.deleteChannel(String(args.channel ?? ""));
    case "wiki_post":
      return client.post(String(args.channel ?? ""), {
        markdown: s(args.markdown),
        json: args.json as never,
        replyTo: n(args.replyTo),
        labels: args.labels as Record<string, string> | undefined,
        agent: s(args.agent) ?? (process.env.OPENINDEX_WIKI_AGENT?.trim() || undefined),
        task: args.task === true ? true : undefined,
        dependsOn: Array.isArray(args.dependsOn) ? args.dependsOn.map(Number) : undefined,
      });
    case "wiki_read_channel":
      return client.feed(String(args.channel ?? ""), { after: n(args.after), limit: n(args.limit), wait: n(args.waitSeconds) });
    case "wiki_list_threads": {
      const label = args.label === undefined ? undefined : Array.isArray(args.label) ? args.label.map(String) : [String(args.label)];
      return client.threads(String(args.channel ?? ""), { label, task: s(args.task), limit: n(args.limit), cursor: s(args.cursor) });
    }
    case "wiki_get_thread":
      return client.thread(String(args.channel ?? ""), Number(args.seq), { after: n(args.after) });
    case "wiki_update_post":
      return client.updatePost(String(args.channel ?? ""), Number(args.seq), {
        markdown: args.markdown === null ? null : s(args.markdown),
        json: args.json as never,
        labels: args.labels as Record<string, string | null> | undefined,
      });
    case "wiki_delete_post":
      return client.deletePost(String(args.channel ?? ""), Number(args.seq));
    case "wiki_claim_task": {
      const label = args.label === undefined ? undefined : Array.isArray(args.label) ? args.label.map(String) : [String(args.label)];
      return client.claimTask(String(args.channel ?? ""), {
        seq: n(args.seq),
        label,
        leaseSeconds: n(args.leaseSeconds),
        agent: s(args.agent) ?? (process.env.OPENINDEX_WIKI_AGENT?.trim() || undefined),
        waitSeconds: n(args.waitSeconds),
      });
    }
    case "wiki_update_task": {
      const action = String(args.action ?? "");
      if (action !== "renew" && action !== "complete" && action !== "release" && action !== "cancel") throw new Error("action must be renew, complete, release or cancel");
      return client.taskAction(String(args.channel ?? ""), Number(args.seq), action, {
        claimId: s(args.claimId),
        leaseSeconds: n(args.leaseSeconds),
        markdown: s(args.markdown),
        json: args.json as never,
        agent: s(args.agent) ?? (process.env.OPENINDEX_WIKI_AGENT?.trim() || undefined),
      });
    }
    case "wiki_channel_webhooks": {
      const channel = String(args.channel ?? "");
      const webhookId = (): string => {
        const w = s(args.webhookId);
        if (!w) throw new Error("Pass webhookId (see action: list)");
        return w;
      };
      const events = Array.isArray(args.events) ? (args.events as never) : undefined;
      switch (args.action) {
        case "list":
          return client.webhooks(channel);
        case "create":
          return client.createWebhook(channel, { url: String(args.url ?? ""), events, description: s(args.description) });
        case "update":
          return client.updateWebhook(channel, webhookId(), { url: s(args.url), events, enabled: typeof args.enabled === "boolean" ? args.enabled : undefined, description: s(args.description) });
        case "rotate":
          return client.updateWebhook(channel, webhookId(), { rotateSecret: true });
        case "test":
          return client.testWebhook(channel, webhookId());
        case "delete":
          return client.deleteWebhook(channel, webhookId());
        default:
          throw new Error("action must be list, create, update, rotate, test or delete");
      }
    }
    case "wiki_share_channel":
      return client.inviteToChannel(String(args.channel ?? ""), { ...shareArg(args), role: role(args.role) });
    case "wiki_remove_channel_member": {
      const channel = String(args.channel ?? "");
      const uid = s(args.uid);
      const email = s(args.email)?.trim().toLowerCase();
      if (uid) return client.removeChannelMember(channel, uid);
      if (email) {
        const { invites } = await client.channelMembers(channel);
        const invite = (invites ?? []).find((i) => i.email === email && i.status === "pending");
        if (!invite) throw new Error(`No pending invite for ${email} on channel ${channel}; to remove a member pass their uid (see wiki_get_channel)`);
        await client.revokeChannelInvite(channel, invite.id);
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

/** wiki_share_page / wiki_share_channel: a handle when given, else the email. */
function shareArg(args: Record<string, unknown>): { email: string } | { handle: string } {
  return typeof args.handle === "string" && args.handle.trim() ? { handle: args.handle.trim() } : { email: String(args.email ?? "") };
}
