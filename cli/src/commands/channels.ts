import { readFileSync } from "node:fs";
import type { Command } from "commander";
import {
  LIMITS,
  MEMBER_ROLES,
  NEW_CHANNEL_COST,
  TASK_FILTERS,
  WEBHOOK_EVENTS,
  formatCents,
  formatLabels,
  parseDuration,
  parseLabelArg,
  type Channel,
  type ChannelMembersResponse,
  type ChannelPost,
  type FeedResponse,
  type InviteResult,
  type JsonValue,
  type MemberRole,
  type PageMember,
  type TaskInfo,
  type ThreadListResponse,
  type WebhookInfo,
  type WebhookSecretResult,
  type WebhookTestResult,
  type WebhookEventType,
  type ThreadResponse,
} from "@openindex/wiki-shared";
import { readStdin } from "../content";
import { getClient, requireAuth } from "../context";
import { WikiApiError, type WikiClient } from "../client";
import { shareTarget } from "./members";
import { UsageError, fail, isJsonMode, log, print, table, truncate } from "../output";

/* ------------------------------ helpers ------------------------------ */

export const collect = (value: string, previous: string[]) => previous.concat([value]);

function parseRole(v: string | undefined): MemberRole | undefined {
  if (v === undefined) return undefined;
  if (!(MEMBER_ROLES as readonly string[]).includes(v)) throw new UsageError(`role must be one of ${MEMBER_ROLES.join(", ")}`);
  return v as MemberRole;
}

function parseSeq(v: string | undefined, name: string): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(String(v).replace(/^#/, ""));
  if (!Number.isInteger(n) || n < 0) throw new UsageError(`${name} must be a post number`);
  return n;
}

export function seqArg(v: string): number {
  const n = parseSeq(v, "seq");
  if (!n) throw new UsageError("seq must be a post number (1, 2, 3…)");
  return n;
}

export function seconds(v: string | undefined, name: string): number | undefined {
  if (v === undefined) return undefined;
  try {
    return parseDuration(v);
  } catch (err) {
    throw new UsageError(`${name}: ${(err as Error).message}`);
  }
}

function labelsFrom(args: string[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const a of args) {
    try {
      const { key, value } = parseLabelArg(a);
      out[key] = value;
    } catch (err) {
      throw new UsageError((err as Error).message);
    }
  }
  return out;
}

export interface BodyFlags {
  file?: string;
  data?: string;
  dataFile?: string;
}

/** Post text (argument, --file, or stdin) and optional JSON (--data / --data-file). */
export async function postBody(arg: string | undefined, flags: BodyFlags, opts: { required: boolean }): Promise<{ markdown?: string; json?: JsonValue }> {
  const out: { markdown?: string; json?: JsonValue } = {};
  if (flags.data !== undefined && flags.dataFile) throw new UsageError("Use either --data or --data-file");
  const jsonText = flags.dataFile ? readFileSync(flags.dataFile, "utf8") : flags.data;
  if (jsonText !== undefined) {
    try {
      out.json = JSON.parse(jsonText) as JsonValue;
    } catch (err) {
      throw new UsageError(`Invalid JSON: ${(err as Error).message}`);
    }
  }
  if (flags.file) out.markdown = readFileSync(flags.file, "utf8");
  else if (arg !== undefined && arg !== "-") out.markdown = arg;
  else if (arg === "-" || (!process.stdin.isTTY && out.json === undefined)) out.markdown = await readStdin();
  if (opts.required && !out.markdown?.trim() && out.json === undefined) throw new UsageError("Pass the text as an argument, --file <path>, - to read stdin, or --data <json>");
  return out;
}

export function agentOf(flag: string | undefined): string | undefined {
  const a = (flag ?? process.env.OPENINDEX_WIKI_AGENT)?.trim();
  return a ? a : undefined;
}

const who = (p: { authorName: string; agent: string | null }) => (p.agent ? `${p.authorName} · ${p.agent}` : p.authorName);

/** "open", "claimed by Ada · fixer-1 until 14:05", "blocked by #3, #4", "done"… */
export function taskState(t: TaskInfo | null | undefined): string {
  if (!t) return "";
  if (t.effectiveState === "claimed") return `claimed by ${t.claimedByName ?? "?"}${t.claimedAgent ? ` · ${t.claimedAgent}` : ""} until ${t.leaseUntil ? when(t.leaseUntil) : "?"}`;
  if (t.state === "blocked") return `blocked by ${t.blockedBy.map((n) => `#${n}`).join(", ")}`;
  if (t.leaseExpired) return "open (lease expired)";
  return t.effectiveState;
}
const when = (iso: string) => iso.slice(0, 16).replace("T", " ");

export function postText(p: ChannelPost): string {
  const head = p.root ? `#${p.seq}` : `  ↳ #${p.seq} (thread #${p.threadSeq})`;
  const labels = p.root && p.labels && Object.keys(p.labels).length ? `  [${formatLabels(p.labels)}]` : "";
  const replies = p.root && p.replyCount ? ` · ${p.replyCount} ${p.replyCount === 1 ? "reply" : "replies"}` : "";
  const kind = p.kind === "event" ? ` · ${p.event?.type ?? "event"}` : p.task ? ` · task: ${taskState(p.task)}` : "";
  const body = p.status === "deleted" ? "(deleted)" : [p.markdown?.trimEnd(), p.json !== null && p.json !== undefined ? `json: ${JSON.stringify(p.json)}` : null].filter(Boolean).join("\n");
  const indent = p.root ? "    " : "        ";
  return `${head} ${who(p)} · ${when(p.createdAt)}${kind}${replies}${labels}\n${body
    .split("\n")
    .map((l) => indent + l)
    .join("\n")}`;
}

function channelLine(c: Channel): string {
  return `${c.name} (${c.id}) · ${c.visibility}${c.role ? ` · you: ${c.role}` : ""} · ${c.lastSeq} posts · ${c.memberCount + 1} ${c.memberCount === 0 ? "member" : "members"}`;
}

function channelText(c: Channel): string {
  const lines = [channelLine(c), c.url];
  if (c.description) lines.push("", c.description);
  return lines.join("\n");
}

export function channelMembersText(r: ChannelMembersResponse): string {
  const rows = [[r.owner.uid, r.owner.displayName, "owner"], ...r.members.map((m) => [m.uid, m.displayName, m.role])];
  const out = [table(rows, ["uid", "name", "role"])];
  if (r.invites?.length) out.push("", "Pending invites:", table(r.invites.map((i) => [i.email, i.role, i.status, i.expiresAt.slice(0, 10), i.id]), ["email", "role", "status", "expires", "id"]));
  return out.join("\n");
}

function feedText(r: FeedResponse): string {
  if (r.posts.length === 0) return `(no new posts; last post #${r.lastSeq})`;
  const more = r.hasMore ? `\n\nMore: --after ${r.nextAfter}` : "";
  return r.posts.map(postText).join("\n\n") + more;
}

function threadsText(r: ThreadListResponse): string {
  if (r.threads.length === 0) return "(no threads)";
  const anyTask = r.threads.some((t) => t.task);
  const rows = r.threads.map((t) => [`#${t.seq}`, when(t.createdAt), who(t), String(t.replyCount ?? 0), ...(anyTask ? [truncate(taskState(t.task), 40)] : []), formatLabels(t.labels), truncate(t.status === "deleted" ? "(deleted)" : t.summary, 60)]);
  const more = r.nextCursor ? `\n\nMore: --cursor ${r.nextCursor}` : "";
  return table(rows, ["#", "date", "by", "replies", ...(anyTask ? ["task"] : []), "labels", "summary"]) + more;
}

function threadText(r: ThreadResponse): string {
  return [postText(r.thread), ...r.replies.map(postText)].join("\n\n") + (r.hasMore ? `\n\nMore: --after ${r.nextAfter}` : "");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait for posts after `after` for up to `totalSec` (looping over the server's 25s long poll).
 * Returns the first non-empty page, or an empty one at the deadline.
 */
async function waitForPosts(client: WikiClient, channel: string, after: number, totalSec: number, limit?: number): Promise<FeedResponse> {
  const deadline = Date.now() + totalSec * 1000;
  for (;;) {
    const left = Math.ceil((deadline - Date.now()) / 1000);
    const res = await client.feed(channel, { after, limit, wait: Math.max(0, Math.min(LIMITS.waitSecondsMax, left)) });
    if (res.posts.length > 0 || left <= LIMITS.waitSecondsMax) return res;
  }
}

/** Print posts as they arrive, forever (Ctrl-C to stop). NDJSON when piped. */
async function follow(client: WikiClient, channel: string, after: number): Promise<never> {
  let cursor = after;
  let backoff = 1000;
  for (;;) {
    try {
      const res = await client.feed(channel, { after: cursor, wait: LIMITS.waitSecondsMax, limit: LIMITS.feedLimitMax });
      for (const p of res.posts) {
        if (isJsonMode()) print(p);
        else process.stdout.write(postText(p) + "\n\n");
      }
      cursor = res.nextAfter;
      backoff = 1000;
    } catch (err) {
      if (err instanceof WikiApiError && err.status !== 429 && err.status < 500) throw err;
      const wait = err instanceof WikiApiError && err.status === 429 ? 30_000 : backoff;
      log(`(${(err as Error).message}; retrying in ${Math.round(wait / 1000)}s)`);
      await sleep(wait);
      backoff = Math.min(backoff * 2, 30_000);
    }
  }
}

/* ------------------------------ commands ------------------------------ */

export function registerChannelCommands(program: Command) {
  program
    .command("channels")
    .description("List your channels (or --public ones)")
    .option("--public", "public channels, most recently active first")
    .option("-l, --limit <n>", "max results", "20")
    .option("--cursor <cursor>", "continue a previous listing")
    .action(async (opts: { public?: boolean; limit: string; cursor?: string }) => {
      try {
        const client = opts.public ? getClient() : requireAuth();
        const res = await client.channels({ scope: opts.public ? "public" : "mine", limit: Number(opts.limit), cursor: opts.cursor });
        print(res, (r: typeof res) => {
          if (r.channels.length === 0) return opts.public ? "(no public channels)" : "(no channels yet: `channel create <name>`)";
          const rows = r.channels.map((c) => [c.id, c.name, c.visibility, c.role ?? "", String(c.lastSeq), when(c.lastPostAt)]);
          return table(rows, ["id", "name", "visibility", "role", "posts", "last post"]) + (r.nextCursor ? `\n\nMore: --cursor ${r.nextCursor}` : "");
        });
      } catch (err) {
        fail(err);
      }
    });

  const channel = program.command("channel").description("Create and manage channels (subcommands: create, show, edit, delete, share, members, unshare, role, webhooks, webhook)");

  channel
    .command("create <name>")
    .description(`Create a channel (costs ${formatCents(NEW_CHANNEL_COST)}; posting is free). Private unless --public`)
    .option("-d, --description <text>", "what the channel is for (markdown)")
    .option("--public", "anyone can read it (only members post)")
    .action(async (name: string, opts: { description?: string; public?: boolean }) => {
      try {
        const { channel: c } = await requireAuth().createChannel({ name, description: opts.description, visibility: opts.public ? "public" : "private" });
        print(c, (x: Channel) => `Created ${channelLine(x)}\n${x.url}\nPost with: openindexwiki post ${x.id} "hello"`);
      } catch (err) {
        fail(err);
      }
    });

  channel
    .command("show <id>")
    .description("A channel's details and, for members, who is in it")
    .action(async (id: string) => {
      try {
        const client = getClient();
        const { channel: c } = await client.channel(id);
        const members = c.role && client.hasToken ? await client.channelMembers(c.id) : null;
        print({ channel: c, members }, () => channelText(c) + (members ? `\n\n${channelMembersText(members)}` : ""));
      } catch (err) {
        fail(err);
      }
    });

  channel
    .command("edit <id>")
    .description("Rename a channel, change its description or visibility (owner and admins)")
    .option("--name <name>", "new name (the id does not change)")
    .option("-d, --description <text>", "new description")
    .option("--visibility <v>", "private | public (public exposes the whole history)")
    .action(async (id: string, opts: { name?: string; description?: string; visibility?: string }) => {
      try {
        if (opts.visibility && opts.visibility !== "private" && opts.visibility !== "public") throw new UsageError("--visibility must be private or public");
        const { channel: c } = await requireAuth().updateChannel(id, { name: opts.name, description: opts.description, visibility: opts.visibility as "private" | "public" | undefined });
        print(c, channelText);
      } catch (err) {
        fail(err);
      }
    });

  channel
    .command("delete <id>")
    .description("Delete a channel you own")
    .action(async (id: string) => {
      try {
        await requireAuth().deleteChannel(id);
        print({ ok: true, id }, () => `Deleted channel ${id}`);
      } catch (err) {
        fail(err);
      }
    });

  channel
    .command("share <id> <who>")
    .description("Add someone to a channel by email or handle (@tito); existing accounts and handle owners at once, other emails get an invite")
    .option("-r, --role <role>", `${MEMBER_ROLES.join(" | ")} (default editor: can post)`)
    .action(async (id: string, who: string, opts: { role?: string }) => {
      try {
        const res = await requireAuth().inviteToChannel(id, { ...shareTarget(who), role: parseRole(opts.role) });
        print(res, (r: InviteResult) =>
          r.status === "added"
            ? `${r.updated ? "Changed" : "Added"} ${r.member.displayName} (${r.member.uid}) as ${r.member.role} on channel ${id}${r.updated ? "" : r.emailSent ? "; email sent" : "; no email sent"}`
            : `Invited ${r.invite.email} as ${r.invite.role} to channel ${id} (expires ${r.invite.expiresAt.slice(0, 10)}; email ${r.emailSent ? "sent" : "not sent"})`,
        );
      } catch (err) {
        fail(err);
      }
    });

  channel
    .command("members <id>")
    .description("Owner, members and (for owner/admins) pending invites of a channel")
    .action(async (id: string) => {
      try {
        print(await requireAuth().channelMembers(id), channelMembersText);
      } catch (err) {
        fail(err);
      }
    });

  channel
    .command("unshare <id> <uidOrEmail>")
    .description("Remove a member (by uid; your own uid leaves the channel) or revoke a pending invite (by email)")
    .action(async (id: string, target: string) => {
      try {
        const client = requireAuth();
        if (target.includes("@")) {
          const email = target.trim().toLowerCase();
          const { invites } = await client.channelMembers(id);
          const invite = (invites ?? []).find((i) => i.email === email && i.status === "pending");
          if (!invite) throw new UsageError(`No pending invite for ${email} on channel ${id}. To remove a member, pass their uid (see \`channel members ${id}\`).`);
          await client.revokeChannelInvite(id, invite.id);
          print({ ok: true, revoked: invite.id, email }, () => `Revoked the invite for ${email} on channel ${id}`);
          return;
        }
        await client.removeChannelMember(id, target);
        print({ ok: true, id, uid: target }, () => `Removed ${target} from channel ${id}`);
      } catch (err) {
        fail(err);
      }
    });

  channel
    .command("role <id> <uid> <role>")
    .description(`Change a channel member's role (${MEMBER_ROLES.join(" | ")})`)
    .action(async (id: string, uid: string, roleArg: string) => {
      try {
        const { member } = await requireAuth().setChannelMemberRole(id, uid, parseRole(roleArg) as MemberRole);
        print(member, (m: PageMember) => `${m.displayName} (${m.uid}) is now ${m.role} on channel ${id}`);
      } catch (err) {
        fail(err);
      }
    });

  channel
    .command("webhooks <id>")
    .description("List a channel's webhooks (owner and admins)")
    .action(async (id: string) => {
      try {
        const res = await requireAuth().webhooks(id);
        print(res, (r: typeof res) =>
          r.webhooks.length === 0
            ? "(no webhooks: `channel webhook add <id> <https-url>`)"
            : table(
                r.webhooks.map((w) => [w.id, w.enabled ? "on" : `off${w.disabledReason ? ` (${w.disabledReason})` : ""}`, w.url, w.events.join(","), w.lastStatus === null ? (w.lastError ? "error" : "-") : String(w.lastStatus), String(w.consecutiveFailures)]),
                ["id", "state", "url", "events", "last", "failures"],
              ),
        );
      } catch (err) {
        fail(err);
      }
    });

  const webhook = channel.command("webhook").description("Manage a channel's webhooks: signed POSTs on new posts, task changes and label changes (subcommands: add, rm, test, rotate, enable, disable)");
  const parseEvents = (v: string | undefined): Array<Exclude<WebhookEventType, "ping">> | undefined => {
    if (!v) return undefined;
    const list = v.split(/[\s,]+/).filter(Boolean);
    for (const e of list) if (!(WEBHOOK_EVENTS as readonly string[]).includes(e)) throw new UsageError(`events must be among ${WEBHOOK_EVENTS.join(", ")}`);
    return list as Array<Exclude<WebhookEventType, "ping">>;
  };
  const secretText = (r: WebhookSecretResult | { webhook: WebhookInfo; secret?: string }) =>
    `Webhook ${r.webhook.id} -> ${r.webhook.url} (${r.webhook.events.join(", ")})${r.secret ? `\nSigning secret (shown once, store it now): ${r.secret}\nVerify deliveries with any Standard Webhooks library (headers webhook-id, webhook-timestamp, webhook-signature).` : ""}`;

  webhook
    .command("add <id> <url>")
    .description("Add an HTTPS webhook; prints its signing secret once")
    .option("--events <list>", `comma-separated: ${WEBHOOK_EVENTS.join(", ")} (default all)`)
    .option("-d, --description <text>", "what it is for")
    .action(async (id: string, url: string, opts: { events?: string; description?: string }) => {
      try {
        print(await requireAuth().createWebhook(id, { url, events: parseEvents(opts.events), description: opts.description }), secretText);
      } catch (err) {
        fail(err);
      }
    });

  webhook
    .command("rm <id> <webhookId>")
    .description("Delete a webhook")
    .action(async (id: string, webhookId: string) => {
      try {
        await requireAuth().deleteWebhook(id, webhookId);
        print({ ok: true, id, webhookId }, () => `Deleted webhook ${webhookId}`);
      } catch (err) {
        fail(err);
      }
    });

  webhook
    .command("test <id> <webhookId>")
    .description("Send a signed ping now and show the endpoint's answer")
    .action(async (id: string, webhookId: string) => {
      try {
        print(await requireAuth().testWebhook(id, webhookId), (r: WebhookTestResult) => (r.ok ? `OK: HTTP ${r.status} in ${r.durationMs}ms` : `Failed: ${r.error ?? `HTTP ${r.status}`} (${r.durationMs}ms)`));
      } catch (err) {
        fail(err);
      }
    });

  webhook
    .command("rotate <id> <webhookId>")
    .description("Replace the signing secret; prints the new one once")
    .action(async (id: string, webhookId: string) => {
      try {
        print(await requireAuth().updateWebhook(id, webhookId, { rotateSecret: true }), secretText);
      } catch (err) {
        fail(err);
      }
    });

  for (const [name, enabled] of [
    ["enable", true],
    ["disable", false],
  ] as const) {
    webhook
      .command(`${name} <id> <webhookId>`)
      .description(enabled ? "Turn a webhook back on (clears its failure count)" : "Pause a webhook")
      .action(async (id: string, webhookId: string) => {
        try {
          print(await requireAuth().updateWebhook(id, webhookId, { enabled }), secretText);
        } catch (err) {
          fail(err);
        }
      });
  }

  program
    .command("post <channel> [text]")
    .description("Post to a channel: a new thread, or --reply <seq> in an existing one (text, --file, stdin, and/or --data JSON)")
    .option("--reply <seq>", "reply in the thread of this post number")
    .option("--label <key=value>", "thread label (repeatable), e.g. --label status=open --label kind=bug", collect, [])
    .option("--data <json>", "structured JSON payload")
    .option("--data-file <path>", "read the JSON payload from a file")
    .option("--file <path>", "read the text from a file")
    .option("--agent <name>", "name of the posting agent (or OPENINDEX_WIKI_AGENT)")
    .option("--task", "make the thread a task that agents claim (`task claim`)")
    .option("--depends-on <seqs>", "with --task: earlier task numbers that must be done first, e.g. 3,4")
    .action(async (channelId: string, text: string | undefined, opts: BodyFlags & { reply?: string; label: string[]; agent?: string; task?: boolean; dependsOn?: string }) => {
      try {
        const body = await postBody(text, opts, { required: true });
        const labels = opts.label.length ? labelsFrom(opts.label) : undefined;
        if (labels && Object.values(labels).some((v) => v === null)) throw new UsageError("Use key=value labels when posting (key= only removes a label, see `label`)");
        if (opts.dependsOn && !opts.task) throw new UsageError("--depends-on needs --task");
        const dependsOn = opts.dependsOn ? opts.dependsOn.split(/[\s,]+/).filter(Boolean).map((v) => seqArg(v)) : undefined;
        const res = await requireAuth().post(channelId, { ...body, replyTo: parseSeq(opts.reply, "--reply"), labels: labels as Record<string, string> | undefined, agent: agentOf(opts.agent), task: opts.task || undefined, dependsOn });
        print(res, () => `Posted #${res.post.seq}${res.post.root ? "" : ` in thread #${res.post.threadSeq}`}${res.post.task ? ` (task: ${taskState(res.post.task)})` : ""} to ${channelId}\n${res.post.url}`);
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("read <channel>")
    .description("Read a channel's posts in order: the latest, those --after a post number, --wait for new ones, or --follow forever")
    .option("--after <seq>", "only posts after this number")
    .option("-l, --limit <n>", "max posts", String(LIMITS.feedLimitDefault))
    .option("--wait <duration>", "wait up to this long (e.g. 30s, 10m) for a new post, then print it and exit")
    .option("-f, --follow", "keep printing new posts as they arrive (NDJSON when piped); Ctrl-C to stop")
    .action(async (channelId: string, opts: { after?: string; limit: string; wait?: string; follow?: boolean }) => {
      try {
        const client = getClient();
        const limit = Number(opts.limit);
        let after = parseSeq(opts.after, "--after");
        const waitSec = seconds(opts.wait, "--wait");
        if (opts.follow) {
          if (after === undefined) {
            const latest = await client.feed(channelId, { limit: Math.min(limit, 20) });
            for (const p of latest.posts) {
              if (isJsonMode()) print(p);
              else process.stdout.write(postText(p) + "\n\n");
            }
            after = latest.lastSeq;
          }
          log(`Following ${channelId} after #${after} (Ctrl-C to stop)…`);
          await follow(client, channelId, after);
        }
        if (waitSec !== undefined) {
          if (after === undefined) after = (await client.channel(channelId)).channel.lastSeq;
          print(await waitForPosts(client, channelId, after, waitSec, limit), feedText);
          return;
        }
        print(await client.feed(channelId, { after, limit }), feedText);
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("threads <channel>")
    .description("A channel's threads, newest first, optionally filtered by labels")
    .option("--label <key=value|key>", "filter (repeatable; all must match)", collect, [])
    .option("--task <state>", `only tasks: ${TASK_FILTERS.join(" | ")} (oldest first)`)
    .option("-l, --limit <n>", "max results", "20")
    .option("--cursor <cursor>", "continue a previous listing")
    .action(async (channelId: string, opts: { label: string[]; task?: string; limit: string; cursor?: string }) => {
      try {
        if (opts.task && !(TASK_FILTERS as readonly string[]).includes(opts.task)) throw new UsageError(`--task must be one of ${TASK_FILTERS.join(", ")}`);
        print(await getClient().threads(channelId, { label: opts.label, task: opts.task, limit: Number(opts.limit), cursor: opts.cursor }), threadsText);
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("thread <channel> <seq>")
    .description("A thread: its first post and the replies (seq may be any post of it)")
    .option("--after <seq>", "only replies after this number")
    .action(async (channelId: string, seq: string, opts: { after?: string }) => {
      try {
        print(await getClient().thread(channelId, seqArg(seq), { after: parseSeq(opts.after, "--after") }), threadText);
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("label <channel> <seq> <labels...>")
    .description("Set (key=value) or remove (key=) labels on a thread's first post")
    .action(async (channelId: string, seq: string, labelArgs: string[]) => {
      try {
        const { post } = await requireAuth().updatePost(channelId, seqArg(seq), { labels: labelsFrom(labelArgs) });
        print(post, (p: ChannelPost) => `#${p.seq} labels: ${formatLabels(p.labels) || "(none)"}`);
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("edit-post <channel> <seq> [text]")
    .description("Edit one of your posts (text, --file, stdin, and/or --data JSON)")
    .option("--data <json>", "structured JSON payload")
    .option("--data-file <path>", "read the JSON payload from a file")
    .option("--file <path>", "read the text from a file")
    .action(async (channelId: string, seq: string, text: string | undefined, opts: BodyFlags) => {
      try {
        const body = await postBody(text, opts, { required: true });
        const { post } = await requireAuth().updatePost(channelId, seqArg(seq), body);
        print(post, postText);
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("delete-post <channel> <seq>")
    .description("Delete one of your posts (owner/admins: anyone's); a placeholder keeps the numbering")
    .action(async (channelId: string, seq: string) => {
      try {
        await requireAuth().deletePost(channelId, seqArg(seq));
        print({ ok: true, channel: channelId, seq: seqArg(seq) }, () => `Deleted #${seqArg(seq)} in ${channelId}`);
      } catch (err) {
        fail(err);
      }
    });
}
