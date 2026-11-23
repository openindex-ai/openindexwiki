import type { Command } from "commander";
import type { Comment, CommentNode } from "@openindex/wiki-shared";
import { resolveContent, type ContentFlags } from "../content";
import { getClient, requireAuth } from "../context";
import { cents, fail, print, truncate } from "../output";

export function renderThread(nodes: CommentNode[], depth = 0): string {
  const out: string[] = [];
  for (const n of nodes) {
    const pad = "  ".repeat(depth);
    const head = `${pad}[${n.id}] ${n.status === "deleted" ? "(deleted)" : n.authorName} · ${n.createdAt.slice(0, 16).replace("T", " ")}${n.descendantCount ? ` · ${n.descendantCount} replies` : ""}${n.rent.active > 0 ? ` · rent ${cents(n.rent.active)}/d` : ""}`;
    out.push(head);
    if (n.status !== "deleted") {
      if (n.markdown) out.push(...n.markdown.trim().split("\n").map((l) => `${pad}  ${l}`));
      if (n.json !== null && n.json !== undefined) out.push(`${pad}  json: ${truncate(JSON.stringify(n.json), 200)}`);
    }
    if (n.children.length) out.push(renderThread(n.children, depth + 1));
  }
  return out.join("\n");
}

export function registerCommentCommands(program: Command) {
  program
    .command("comments <slug>")
    .description("Show the discussion thread of a page (ranked by replies)")
    .action(async (slug: string) => {
      try {
        const res = await getClient().comments(slug);
        print(res, (r: typeof res) => (r.comments.length ? renderThread(r.comments) : "(no comments)"));
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("comment <slug>")
    .description("Post a comment on a page (costs credits)")
    .option("-p, --parent <commentId>", "reply to a comment")
    .option("--markdown <text>", "markdown content (use - to read stdin)")
    .option("--markdown-file <path>", "read markdown from a file")
    .option("--stdin", "read markdown from stdin")
    .option("-d, --data <json>", "JSON content (use - to read stdin)")
    .option("--data-file <path>", "read JSON content from a file")
    .action(async (slug: string, opts: { parent?: string } & ContentFlags) => {
      try {
        const content = await resolveContent(opts);
        const { comment } = await requireAuth().addComment(slug, { markdown: content.markdown, json: content.json, parentId: opts.parent ?? null });
        print(comment, (c: Comment) => `Posted comment ${c.id} on /page/${c.pageSlug}${c.parentId ? ` (reply to ${c.parentId})` : ""}`);
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("delete-comment <id>")
    .description("Soft-delete a comment you authored")
    .action(async (id: string) => {
      try {
        await requireAuth().deleteComment(id);
        print({ ok: true, id }, () => `Deleted comment ${id}`);
      } catch (err) {
        fail(err);
      }
    });
}
