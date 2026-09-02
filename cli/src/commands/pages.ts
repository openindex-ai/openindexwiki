import type { Command } from "commander";
import type { EditEntry, Page, PageSummary, SearchResponse } from "@openindex/wiki-shared";
import { resolveContent, type ContentFlags } from "../content";
import { getClient, requireAuth } from "../context";
import { UsageError, fail, print, table, truncate, cents } from "../output";

function contentOptions(cmd: Command): Command {
  return cmd
    .option("--markdown <text>", "markdown content (use - to read stdin)")
    .option("--markdown-file <path>", "read markdown from a file")
    .option("--stdin", "read markdown from stdin")
    .option("-d, --data <json>", "JSON content (use - to read stdin)")
    .option("--data-file <path>", "read JSON content from a file");
}

export function pageLine(p: PageSummary): string[] {
  return [p.slug, truncate(p.title, 40), p.rentActive > 0 ? cents(p.rentActive) + "/d" : "", String(p.commentCount), p.ownerName, p.updatedAt.slice(0, 10)];
}

export function pagesTable(pages: PageSummary[]): string {
  if (pages.length === 0) return "(no pages)";
  return table(
    pages.map(pageLine),
    ["slug", "title", "rent", "comments", "owner", "updated"],
  );
}

function pageText(page: Page, backlinks: PageSummary[]): string {
  const lines = [`# ${page.title}`, `${page.url}  ·  by ${page.ownerName}  ·  v${page.version}  ·  updated ${page.updatedAt.slice(0, 10)}`];
  if (page.tags.length) lines.push(`tags: ${page.tags.map((t) => "#" + t).join(" ")}`);
  if (page.rent.active > 0) lines.push(`rent: ${cents(page.rent.active)}/day (${page.rent.status})`);
  lines.push("");
  if (page.markdown) lines.push(page.markdown.trim(), "");
  if (page.json !== null && page.json !== undefined) lines.push("```json", JSON.stringify(page.json, null, 2), "```", "");
  if (page.links.length) lines.push(`links: ${page.links.join(", ")}`);
  lines.push(`backlinks (${backlinks.length}): ${backlinks.map((b) => b.slug).join(", ") || "none"}`);
  return lines.join("\n");
}

export function registerPageCommands(program: Command) {
  program
    .command("search <query>")
    .description("Hybrid search (keywords + semantic + rent)")
    .option("-l, --limit <n>", "max results", "20")
    .option("-t, --tag <tag>", "only pages with this hashtag")
    .action(async (query: string, opts: { limit: string; tag?: string }) => {
      try {
        const res = await getClient().search(query, { limit: Number(opts.limit), tag: opts.tag });
        print(res, (r: SearchResponse) =>
          r.results.length === 0
            ? `No results for "${r.query}".`
            : table(
                r.results.map((x, i) => [String(i + 1), x.slug, truncate(x.title, 40), x.signals.bm25Rank ? `kw#${x.signals.bm25Rank}` : "", x.signals.semanticRank ? `sem#${x.signals.semanticRank}` : "", x.rentActive > 0 ? cents(x.rentActive) + "/d" : ""]),
                ["#", "slug", "title", "keyword", "semantic", "rent"],
              ) + `\n(${r.results.length} results, ${r.took} ms)`,
        );
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("get <slug>")
    .description("Read a page")
    .option("-f, --format <fmt>", "json | md | text", "text")
    .action(async (slug: string, opts: { format: string }) => {
      try {
        const client = getClient();
        if (opts.format === "md") {
          const md = await client.getPageMarkdown(slug);
          print({ markdown: md }, () => md);
          return;
        }
        const res = await client.getPage(slug);
        if (opts.format === "json") print(res, (r: typeof res) => JSON.stringify(r, null, 2));
        else print(res, (r: typeof res) => pageText(r.page, r.backlinks));
      } catch (err) {
        fail(err);
      }
    });

  contentOptions(program.command("create").description("Create a page (costs credits)").requiredOption("-t, --title <title>", "page title")).action(
    async (opts: { title: string } & ContentFlags) => {
      try {
        const content = await resolveContent(opts);
        const { page } = await requireAuth().createPage({ title: opts.title, markdown: content.markdown, json: content.json });
        print(page, (p: Page) => `Created ${p.url} (v${p.version})`);
      } catch (err) {
        fail(err);
      }
    },
  );

  contentOptions(program.command("edit <slug>").description("Edit a page you own (free)").option("-t, --title <title>", "new title").option("--clear-data", "remove the JSON content")).action(
    async (slug: string, opts: { title?: string; clearData?: boolean } & ContentFlags) => {
      try {
        const content = await resolveContent(opts);
        const patch: Record<string, unknown> = {};
        if (opts.title) patch.title = opts.title;
        if (content.markdown !== undefined) patch.markdown = content.markdown;
        if (content.json !== undefined) patch.json = content.json;
        if (opts.clearData) patch.json = null;
        if (Object.keys(patch).length === 0) throw new UsageError("Nothing to change: pass --title, --markdown/--markdown-file/--stdin, --data/--data-file or --clear-data");
        const { page } = await requireAuth().updatePage(slug, patch);
        print(page, (p: Page) => `Updated ${p.url} (v${p.version})`);
      } catch (err) {
        fail(err);
      }
    },
  );

  program
    .command("delete <slug>")
    .description("Soft-delete a page you own")
    .option("-y, --yes", "skip confirmation")
    .action(async (slug: string, opts: { yes?: boolean }) => {
      try {
        if (!opts.yes && process.stdin.isTTY && process.stdout.isTTY) {
          const rl = await import("node:readline/promises");
          const i = rl.createInterface({ input: process.stdin, output: process.stderr });
          const answer = await i.question(`Delete /page/${slug}? [y/N] `);
          i.close();
          if (!/^y(es)?$/i.test(answer.trim())) {
            print({ ok: false, cancelled: true }, () => "Cancelled.");
            return;
          }
        }
        await requireAuth().deletePage(slug);
        print({ ok: true, slug }, () => `Deleted /page/${slug}`);
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("list")
    .description("List pages")
    .option("-o, --owner <uid>", "owner uid, or 'me'")
    .option("-t, --tag <tag>", "filter by hashtag")
    .option("-s, --sort <sort>", "recent | rent", "recent")
    .option("-l, --limit <n>", "max results", "20")
    .option("--cursor <cursor>", "pagination cursor from a previous call")
    .action(async (opts: { owner?: string; tag?: string; sort: "recent" | "rent"; limit: string; cursor?: string }) => {
      try {
        const client = opts.owner === "me" ? requireAuth() : getClient();
        const res = await client.listPages({ owner: opts.owner, tag: opts.tag, sort: opts.sort, limit: Number(opts.limit), cursor: opts.cursor });
        print(res, (r: typeof res) => pagesTable(r.pages) + (r.nextCursor ? `\nnext: --cursor ${r.nextCursor}` : ""));
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("backlinks <slug>")
    .description("Pages linking to a page")
    .action(async (slug: string) => {
      try {
        const res = await getClient().backlinks(slug);
        print(res, (r: typeof res) => pagesTable(r.pages));
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("history <slug>")
    .description("Edit log of a page")
    .action(async (slug: string) => {
      try {
        const res = await getClient().history(slug);
        print(res, (r: { edits: EditEntry[] }) => table(r.edits.map((e) => [`v${e.version}`, e.kind, e.editorName, e.createdAt, truncate(e.title, 40)]), ["version", "kind", "editor", "at", "title"]));
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("tag <tag>")
    .description("Pages mentioning a hashtag (by active rent, then newest)")
    .option("-l, --limit <n>", "max results", "50")
    .option("--cursor <cursor>", "pagination cursor")
    .action(async (tag: string, opts: { limit: string; cursor?: string }) => {
      try {
        const res = await getClient().tag(tag.replace(/^#/, ""), { limit: Number(opts.limit), cursor: opts.cursor });
        print(res, (r: typeof res) => `#${r.tag} (${r.pageCount} pages)\n` + pagesTable(r.pages) + (r.nextCursor ? `\nnext: --cursor ${r.nextCursor}` : ""));
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("tags")
    .description("Most used hashtags")
    .option("-l, --limit <n>", "max results", "100")
    .action(async (opts: { limit: string }) => {
      try {
        const res = await getClient().tags(Number(opts.limit));
        print(res, (r: typeof res) => table(r.tags.map((t) => [`#${t.tag}`, String(t.pageCount)]), ["tag", "pages"]));
      } catch (err) {
        fail(err);
      }
    });
}
