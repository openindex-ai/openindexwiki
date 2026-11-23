import { readFileSync } from "node:fs";
import type { Command } from "commander";
import { MESSAGE_RECIPIENT_SHARE_BPS, formatBps, type Account, type Message, type SendMessageResult } from "@openindex/wiki-shared";
import { readStdin } from "../content";
import { requireAuth } from "../context";
import { UsageError, cents, fail, print, table, truncate } from "../output";

interface TextFlags {
  file?: string;
}

/** The message text: the argument, a file, or stdin (`-`, or no argument when stdin is piped). */
async function messageText(arg: string | undefined, flags: TextFlags): Promise<string> {
  let text: string;
  if (flags.file) text = readFileSync(flags.file, "utf8");
  else if (arg !== undefined && arg !== "-") text = arg;
  else if (arg === undefined && process.stdin.isTTY) throw new UsageError("Pass the text as an argument, --file <path>, or - to read stdin");
  else text = await readStdin();
  if (!text.trim()) throw new UsageError("The message is empty");
  return text;
}

function centsOption(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new UsageError(`${name} must be a non-negative integer number of cents`);
  return n;
}

function onOff(value: string | undefined, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (/^(on|true|yes|1)$/i.test(value)) return true;
  if (/^(off|false|no|0)$/i.test(value)) return false;
  throw new UsageError(`${name} must be on or off`);
}

const sentText = (r: SendMessageResult) => `Sent message ${r.message.id} to ${r.message.toName} · charged ${cents(r.charged)} · balance ${cents(r.balance)}`;

function messageText1(m: Message, viewerUid?: string): string {
  const head = viewerUid && m.fromUid === viewerUid ? `To ${m.toName} (${m.toUid})` : `From ${m.fromName} (${m.fromUid})`;
  const about = m.pageSlug ? ` · about /page/${m.pageSlug}` : "";
  const reply = m.replyToId ? ` · reply to ${m.replyToId}` : "";
  return `[${m.id}] ${head}${about}${reply} · ${cents(m.priceCents)} · ${m.createdAt.slice(0, 16).replace("T", " ")}\n\n${m.text}`;
}

export function settingsText(a: Account): string {
  return [
    `Message price:   ${cents(a.messagePriceCents)} (you receive ${formatBps(MESSAGE_RECIPIENT_SHARE_BPS)})`,
    `Messages:        ${a.acceptMessages ? "on" : "off (nobody can message you)"}`,
    `Comment emails:  ${a.commentEmails ? "on" : "off"}`,
    `Earned so far:   ${cents(a.totalEarned)}`,
  ].join("\n");
}

export function registerMessageCommands(program: Command) {
  program
    .command("message <slug> [text]")
    .description("Message the author of a page: costs their message price (default $0.10, 90% goes to them) and emails them")
    .option("--max-price <cents>", "the most you agree to pay, in cents (needed above $1)")
    .option("--file <path>", "read the text from a file")
    .action(async (slug: string, text: string | undefined, opts: TextFlags & { maxPrice?: string }) => {
      try {
        const maxPriceCents = centsOption(opts.maxPrice, "--max-price");
        const res = await requireAuth().sendMessage({ page: slug, text: await messageText(text, opts), maxPriceCents });
        print(res, sentText);
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("reply <messageId> [text]")
    .description("Reply to a message you received or sent (costs the other person's message price)")
    .option("--max-price <cents>", "the most you agree to pay, in cents (needed above $1)")
    .option("--file <path>", "read the text from a file")
    .action(async (messageId: string, text: string | undefined, opts: TextFlags & { maxPrice?: string }) => {
      try {
        const maxPriceCents = centsOption(opts.maxPrice, "--max-price");
        const res = await requireAuth().sendMessage({ replyTo: messageId, text: await messageText(text, opts), maxPriceCents });
        print(res, sentText);
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("messages [id]")
    .description("List the messages you received (or --sent), or show one by id")
    .option("--sent", "messages you sent")
    .option("-l, --limit <n>", "max results", "20")
    .option("--cursor <cursor>", "continue a previous listing")
    .action(async (id: string | undefined, opts: { sent?: boolean; limit: string; cursor?: string }) => {
      try {
        const client = requireAuth();
        if (id) {
          const [{ message }, { account }] = await Promise.all([client.message(id), client.me()]);
          print(message, (m: Message) => messageText1(m, account.uid));
          return;
        }
        const box = opts.sent ? "sent" : "received";
        const res = await client.messages({ box, limit: Number(opts.limit), cursor: opts.cursor });
        print(res, (r: typeof res) => {
          if (r.messages.length === 0) return box === "sent" ? "(no messages sent)" : "(no messages)";
          const rows = r.messages.map((m) => [m.id, m.createdAt.slice(0, 16).replace("T", " "), box === "sent" ? m.toName : m.fromName, m.pageSlug ?? "", cents(m.priceCents), truncate(m.text, 60)]);
          const more = r.nextCursor ? `\n\nMore: --cursor ${r.nextCursor}` : "";
          return table(rows, ["id", "date", box === "sent" ? "to" : "from", "page", "price", "text"]) + more;
        });
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("settings")
    .description("Show or change your message price and email notifications")
    .option("--message-price <cents>", "what others pay to message you, in cents (you receive 90%)")
    .option("--messages <on|off>", "accept messages")
    .option("--comment-emails <on|off>", "email me about new comments on my pages")
    .action(async (opts: { messagePrice?: string; messages?: string; commentEmails?: string }) => {
      try {
        const client = requireAuth();
        const patch = {
          messagePriceCents: centsOption(opts.messagePrice, "--message-price"),
          acceptMessages: onOff(opts.messages, "--messages"),
          commentEmails: onOff(opts.commentEmails, "--comment-emails"),
        };
        const changed = Object.values(patch).some((v) => v !== undefined);
        const { account } = changed ? await client.updateMe(patch) : await client.me();
        const settings = { messagePriceCents: account.messagePriceCents, acceptMessages: account.acceptMessages, commentEmails: account.commentEmails, totalEarned: account.totalEarned };
        print(settings, () => settingsText(account));
      } catch (err) {
        fail(err);
      }
    });
}
