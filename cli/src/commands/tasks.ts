import type { Command } from "commander";
import { LIMITS, TASK_LEASE, formatDuration, type ClaimResult, type TaskActionResult } from "@openindex/wiki-shared";
import { requireAuth } from "../context";
import type { WikiClient } from "../client";
import { UsageError, fail, log, print } from "../output";
import { agentOf, collect, postBody, postText, seconds, seqArg, taskState, type BodyFlags } from "./channels";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function claimText(r: ClaimResult): string {
  if (!r.task) return "(no task available)";
  return `${postText(r.task)}\n\nClaimed #${r.task.seq} (${taskState(r.task.task)}). Claim id: ${r.claimId}\nRenew:    openindexwiki task renew ${r.task.channelId} ${r.task.seq} --claim ${r.claimId}\nComplete: openindexwiki task complete ${r.task.channelId} ${r.task.seq} "result" --claim ${r.claimId}`;
}

function actionText(r: TaskActionResult): string {
  return `#${r.task.seq}: ${taskState(r.task.task)}${r.event ? `\n\n${postText(r.event)}` : ""}`;
}

/** Claim with the server's long poll, looping until `totalSec` elapse. */
async function claimWaiting(client: WikiClient, channel: string, input: { label?: string[]; leaseSeconds?: number; agent?: string }, totalSec: number): Promise<ClaimResult> {
  const deadline = Date.now() + totalSec * 1000;
  for (;;) {
    const left = Math.ceil((deadline - Date.now()) / 1000);
    const res = await client.claimTask(channel, { ...input, waitSeconds: Math.max(0, Math.min(LIMITS.waitSecondsMax, left)) });
    if (res.task || left <= LIMITS.waitSecondsMax) return res;
    await sleep(250);
  }
}

export function registerTaskCommands(program: Command) {
  const task = program.command("task").description("Work on a channel's tasks (subcommands: claim, renew, complete, release, cancel); create one with `post <channel> --task`");

  task
    .command("claim <channel> [seq]")
    .description("Claim a task (or the oldest claimable one, optionally with --label) with a lease; prints the claim id")
    .option("--label <key=value|key>", "only tasks with this label (repeatable)", collect, [])
    .option("--lease <duration>", `how long you hold it, e.g. 15m, 1h (default ${formatDuration(TASK_LEASE.defaultSec)})`)
    .option("--wait <duration>", "wait up to this long for a task to become available, e.g. 10m")
    .option("--agent <name>", "name of the claiming agent (or OPENINDEX_WIKI_AGENT)")
    .action(async (channelId: string, seq: string | undefined, opts: { label: string[]; lease?: string; wait?: string; agent?: string }) => {
      try {
        const client = requireAuth();
        const leaseSeconds = seconds(opts.lease, "--lease");
        const waitSec = seconds(opts.wait, "--wait") ?? 0;
        if (seq !== undefined && (opts.label.length || waitSec)) throw new UsageError("--label and --wait only apply when claiming the next task (no seq)");
        const input = { label: opts.label.length ? opts.label : undefined, leaseSeconds, agent: agentOf(opts.agent) };
        if (waitSec > 0) log(`Waiting up to ${formatDuration(waitSec)} for a task in ${channelId}…`);
        const res = seq !== undefined ? await client.claimTask(channelId, { seq: seqArg(seq), ...input }) : waitSec > 0 ? await claimWaiting(client, channelId, input, waitSec) : await client.claimTask(channelId, input);
        print(res, claimText);
        if (!res.task) process.exitCode = 4;
      } catch (err) {
        fail(err);
      }
    });

  task
    .command("renew <channel> <seq>")
    .description("Extend your lease on a task")
    .option("--lease <duration>", `new lease from now (default ${formatDuration(TASK_LEASE.defaultSec)})`)
    .option("--claim <claimId>", "the claim id `task claim` printed")
    .option("--agent <name>", "name of the agent (or OPENINDEX_WIKI_AGENT)")
    .action(async (channelId: string, seq: string, opts: { lease?: string; claim?: string; agent?: string }) => {
      try {
        print(await requireAuth().taskAction(channelId, seqArg(seq), "renew", { claimId: opts.claim, leaseSeconds: seconds(opts.lease, "--lease"), agent: agentOf(opts.agent) }), actionText);
      } catch (err) {
        fail(err);
      }
    });

  for (const action of ["complete", "release", "cancel"] as const) {
    const what = { complete: "Mark a task done, with the result (text, --file, stdin and/or --data JSON) posted in its thread", release: "Give a task back so another agent can claim it", cancel: "Cancel a task (its author or a channel admin)" }[action];
    task
      .command(`${action} <channel> <seq> [text]`)
      .description(what)
      .option("--claim <claimId>", "the claim id `task claim` printed")
      .option("--data <json>", "structured JSON result")
      .option("--data-file <path>", "read the JSON result from a file")
      .option("--file <path>", "read the text from a file")
      .option("--agent <name>", "name of the agent (or OPENINDEX_WIKI_AGENT)")
      .action(async (channelId: string, seq: string, text: string | undefined, opts: BodyFlags & { claim?: string; agent?: string }) => {
        try {
          const body = await postBody(text, opts, { required: false });
          print(await requireAuth().taskAction(channelId, seqArg(seq), action, { ...body, claimId: opts.claim, agent: agentOf(opts.agent) }), actionText);
        } catch (err) {
          fail(err);
        }
      });
  }
}
