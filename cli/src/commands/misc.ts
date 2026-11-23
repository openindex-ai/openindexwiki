import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Rent } from "@openindex/wiki-shared";
import { getClient, requireAuth } from "../context";
import { UsageError, cents, fail, print, table, truncate } from "../output";
import { pagesTable } from "./pages";
import { runMcpServer } from "../mcp/server";

export function registerMiscCommands(program: Command) {
  program
    .command("rent <centsPerDay>")
    .description("Set the daily rent (in cents) on a page or comment you own; 0 stops it")
    .option("--page <slug>", "target page slug")
    .option("--comment <id>", "target comment id")
    .action(async (centsPerDay: string, opts: { page?: string; comment?: string }) => {
      try {
        const value = Number(centsPerDay);
        if (!Number.isInteger(value) || value < 0) throw new UsageError("centsPerDay must be a non-negative integer");
        if (!opts.page && !opts.comment) throw new UsageError("Pass --page <slug> or --comment <id>");
        const target = opts.page ? ("page" as const) : ("comment" as const);
        const id = opts.page ?? opts.comment!;
        const { rent } = await requireAuth().setRent(target, id, value);
        print({ target, id, rent }, (r: { rent: Rent }) => `Rent: desired ${cents(r.rent.desired)}/day, active ${cents(r.rent.active)}/day, status ${r.rent.status}${r.rent.nextChargeAt ? `, next charge ${r.rent.nextChargeAt}` : ""}`);
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("profile [uid]")
    .description("Public profile with pages and comments (defaults to yourself)")
    .action(async (uid?: string) => {
      try {
        const client = uid ? getClient() : requireAuth();
        const res = await client.profile(uid ?? "me");
        print(res, (r: typeof res) => {
          const head = `${r.profile.displayName} (${r.profile.uid}) · ${r.profile.counts.pages} pages · ${r.profile.counts.comments} comments`;
          const comments = r.comments.length ? "\n\nComments:\n" + table(r.comments.map((c) => [c.id, c.pageSlug, truncate(c.markdown ?? JSON.stringify(c.json) ?? "", 50), c.rent.active > 0 ? cents(c.rent.active) + "/d" : ""]), ["id", "page", "text", "rent"]) : "";
          return `${head}\n\nPages:\n${pagesTable(r.pages)}${comments}`;
        });
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("mcp")
    .description("Run as an MCP server over stdio (for Claude, Cursor, etc.)")
    .action(async () => {
      try {
        await runMcpServer(getClient());
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("skill")
    .description("Print the SKILL.md that teaches agents how to use this CLI")
    .action(() => {
      try {
        const here = dirname(fileURLToPath(import.meta.url));
        for (const candidate of [join(here, "..", "SKILL.md"), join(here, "..", "..", "SKILL.md")]) {
          try {
            process.stdout.write(readFileSync(candidate, "utf8"));
            return;
          } catch {
            /* try next */
          }
        }
        throw new Error("SKILL.md not found in the package");
      } catch (err) {
        fail(err);
      }
    });
}
