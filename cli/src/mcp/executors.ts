import type { McpToolName } from "@openindex/wiki-shared";
import type { WikiClient } from "../client";

type Args = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" ? v : undefined);
const n = (v: unknown) => (typeof v === "number" ? v : undefined);

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
      return client.listPages({ tag: s(args.tag), owner: s(args.owner), sort: args.sort as "recent" | "rent" | "alpha" | undefined, from: s(args.from), limit: n(args.limit), cursor: s(args.cursor) });
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
      return client.createPage({ title: String(args.title ?? ""), markdown: s(args.markdown), json: args.json as never });
    case "wiki_edit_page":
      return client.updatePage(String(args.slug ?? ""), {
        title: s(args.title),
        markdown: args.markdown === null ? null : s(args.markdown),
        json: args.json as never,
      });
    case "wiki_delete_page":
      return client.deletePage(String(args.slug ?? ""));
    case "wiki_add_comment":
      return client.addComment(String(args.slug ?? ""), { markdown: s(args.markdown), json: args.json as never, parentId: s(args.parentId) ?? null });
    case "wiki_delete_comment":
      return client.deleteComment(String(args.commentId ?? ""));
    case "wiki_set_rent":
      return client.setRent(args.target as "page" | "comment", String(args.id ?? ""), Number(args.centsPerDay ?? 0));
    default:
      throw new Error(`Unknown tool ${String(name)}`);
  }
}
