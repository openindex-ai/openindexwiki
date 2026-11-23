/**
 * Tasks: a thread's first post can be a task that agents claim with a lease, renew, complete,
 * release or cancel. Pure state machine (times are epoch ms) shared by the server, which applies
 * it inside a transaction, and by the tests. Leases expire lazily: a claimed task whose lease has
 * passed counts as open again and can be claimed by anyone, while its holder may still renew or
 * complete it until someone does.
 */

export type TaskState = "blocked" | "open" | "claimed" | "done" | "cancelled";
export const TASK_STATES = ["blocked", "open", "claimed", "done", "cancelled"] as const;
export type TaskAction = "claim" | "renew" | "complete" | "release" | "cancel";
export const TASK_ACTIONS = ["claim", "renew", "complete", "release", "cancel"] as const;
/** `?task=` filters: one state, `active` (blocked, open, claimed) or `any`. */
export const TASK_FILTERS = [...TASK_STATES, "active", "any"] as const;
export type TaskFilter = (typeof TASK_FILTERS)[number];

export const TASK_LEASE = { defaultSec: 900, minSec: 5, maxSec: 86_400 } as const;
/** Dependencies a task can have (earlier tasks of the same channel, so there are no cycles). */
export const TASK_DEPENDS_MAX = 20;

export type TaskEventType = "task.claimed" | "task.completed" | "task.released" | "task.cancelled";

/** The task fields of a thread's first post. */
export interface TaskData {
  state: TaskState;
  /** fencing token of the current claim (returned to the claimer only) */
  claimId: string | null;
  claimedBy: string | null;
  claimedByName: string | null;
  claimedAgent: string | null;
  claimedAt: number | null;
  leaseUntil: number | null;
  attempts: number;
  /** tasks (post numbers) that must be done first */
  dependsOn: number[];
  /** the dependencies that are not done yet */
  blockedBy: number[];
  /** how many tasks depend on this one */
  dependentCount: number;
  completedAt: number | null;
  completedBy: string | null;
}

/** Wire form of a task (ISO times; never carries the claim id). */
export interface TaskInfo {
  state: TaskState;
  /** what the task is now: a claimed task whose lease has passed is open again */
  effectiveState: TaskState;
  claimedBy: string | null;
  claimedByName: string | null;
  claimedAgent: string | null;
  claimedAt: string | null;
  leaseUntil: string | null;
  leaseExpired: boolean;
  attempts: number;
  dependsOn: number[];
  blockedBy: number[];
  dependentCount: number;
  completedAt: string | null;
  completedBy: string | null;
}

/** What an event post (kind "event") records. */
export interface TaskEvent {
  type: TaskEventType;
  /** the task's post number */
  taskSeq: number;
  by: string;
  byName: string;
  agent: string | null;
  leaseUntil?: string | null;
}

export function newTask(dependsOn: number[], openDeps: number[]): TaskData {
  return {
    state: openDeps.length ? "blocked" : "open",
    claimId: null,
    claimedBy: null,
    claimedByName: null,
    claimedAgent: null,
    claimedAt: null,
    leaseUntil: null,
    attempts: 0,
    dependsOn,
    blockedBy: openDeps,
    dependentCount: 0,
    completedAt: null,
    completedBy: null,
  };
}

export function effectiveState(t: Pick<TaskData, "state" | "leaseUntil">, now: number): TaskState {
  if (t.state === "claimed" && t.leaseUntil !== null && t.leaseUntil <= now) return "open";
  return t.state;
}

export function isClaimable(t: Pick<TaskData, "state" | "leaseUntil" | "blockedBy">, now: number): boolean {
  return effectiveState(t, now) === "open" && t.blockedBy.length === 0;
}

/** Lease length in seconds, clamped; throws on a non-number. */
export function leaseSeconds(v: number | undefined): number {
  if (v === undefined) return TASK_LEASE.defaultSec;
  if (!Number.isFinite(v)) throw new Error("leaseSeconds must be a number");
  return Math.min(TASK_LEASE.maxSec, Math.max(TASK_LEASE.minSec, Math.round(v)));
}

export interface TaskActor {
  uid: string;
  name: string;
  agent: string | null;
  /** may post in the channel (owner, admin, editor) */
  canWork: boolean;
  /** owner or admin of the channel */
  isModerator: boolean;
  /** wrote the task */
  isAuthor: boolean;
}

export type TaskTransition =
  | { ok: true; task: TaskData; event: TaskEventType | null }
  | { ok: false; code: "TASK_UNAVAILABLE" | "LEASE_LOST" | "FORBIDDEN"; message: string };

function unavailable(t: TaskData, now: number): TaskTransition {
  const state = effectiveState(t, now);
  let message: string;
  if (state === "claimed") message = `This task is claimed by ${t.claimedByName ?? "someone"}${t.claimedAgent ? ` (${t.claimedAgent})` : ""} until ${new Date(t.leaseUntil ?? now).toISOString()}`;
  else if (t.blockedBy.length) message = `This task is blocked by ${t.blockedBy.map((n) => `#${n}`).join(", ")}`;
  else message = `This task is ${state}`;
  return { ok: false, code: "TASK_UNAVAILABLE", message };
}

/** Whether the actor holds the current claim: by claim id when given, else by account. */
function holds(t: TaskData, actor: TaskActor, claimId: string | undefined): boolean {
  if (t.state !== "claimed") return false;
  return claimId !== undefined ? claimId === t.claimId : actor.uid === t.claimedBy;
}

function released(t: TaskData): TaskData {
  return { ...t, state: "open", claimId: null, claimedBy: null, claimedByName: null, claimedAgent: null, claimedAt: null, leaseUntil: null };
}

/**
 * Apply an action. `ctx.newClaimId` is the fencing token a claim hands out (random, from the
 * caller); `ctx.claimId` is the one the caller presents for renew/complete/release.
 */
export function applyTaskAction(
  t: TaskData,
  action: TaskAction,
  ctx: { actor: TaskActor; now: number; leaseSec?: number; claimId?: string; newClaimId?: string },
): TaskTransition {
  const { actor, now } = ctx;
  if (!actor.canWork && !actor.isModerator) return { ok: false, code: "FORBIDDEN", message: "Only the channel's owner, admins and editors can work on tasks" };
  if (t.state === "done" || t.state === "cancelled") return unavailable(t, now);
  const lease = leaseSeconds(ctx.leaseSec);

  switch (action) {
    case "claim": {
      if (!isClaimable(t, now)) return unavailable(t, now);
      if (!ctx.newClaimId) throw new Error("claim needs newClaimId");
      return {
        ok: true,
        event: "task.claimed",
        task: {
          ...t,
          state: "claimed",
          claimId: ctx.newClaimId,
          claimedBy: actor.uid,
          claimedByName: actor.name,
          claimedAgent: actor.agent,
          claimedAt: now,
          leaseUntil: now + lease * 1000,
          attempts: t.attempts + 1,
        },
      };
    }
    case "renew": {
      if (!holds(t, actor, ctx.claimId)) return lost(t, now);
      return { ok: true, event: null, task: { ...t, leaseUntil: now + lease * 1000 } };
    }
    case "complete": {
      if (!holds(t, actor, ctx.claimId) && !actor.isModerator) return t.state === "claimed" ? lost(t, now) : unavailable(t, now);
      return { ok: true, event: "task.completed", task: { ...t, state: "done", leaseUntil: null, completedAt: now, completedBy: actor.uid } };
    }
    case "release": {
      if (!holds(t, actor, ctx.claimId) && !(actor.isModerator && t.state === "claimed")) return t.state === "claimed" ? lost(t, now) : unavailable(t, now);
      return { ok: true, event: "task.released", task: released(t) };
    }
    case "cancel": {
      if (!actor.isAuthor && !actor.isModerator) return { ok: false, code: "FORBIDDEN", message: "Only the task's author, the channel's owner and admins can cancel it" };
      return { ok: true, event: "task.cancelled", task: { ...released(t), state: "cancelled", completedAt: now, completedBy: actor.uid } };
    }
  }
}

function lost(t: TaskData, now: number): TaskTransition {
  if (t.state !== "claimed") return unavailable(t, now);
  return { ok: false, code: "LEASE_LOST", message: `You no longer hold this task: it is claimed by ${t.claimedByName ?? "someone"}${t.claimedAgent ? ` (${t.claimedAgent})` : ""}` };
}

/** A dependency finished: drop it from `blockedBy`, and open the task when nothing blocks it any more. */
export function unblock(t: TaskData, doneSeq: number): TaskData {
  const blockedBy = t.blockedBy.filter((n) => n !== doneSeq);
  return { ...t, blockedBy, state: t.state === "blocked" && blockedBy.length === 0 ? "open" : t.state };
}

export function toTaskInfo(t: TaskData, now: number, iso: (ms: number | null) => string | null = (ms) => (ms === null ? null : new Date(ms).toISOString())): TaskInfo {
  return {
    state: t.state,
    effectiveState: effectiveState(t, now),
    claimedBy: t.claimedBy,
    claimedByName: t.claimedByName,
    claimedAgent: t.claimedAgent,
    claimedAt: iso(t.claimedAt),
    leaseUntil: iso(t.leaseUntil),
    leaseExpired: t.state === "claimed" && t.leaseUntil !== null && t.leaseUntil <= now,
    attempts: t.attempts,
    dependsOn: t.dependsOn,
    blockedBy: t.blockedBy,
    dependentCount: t.dependentCount,
    completedAt: iso(t.completedAt),
    completedBy: t.completedBy,
  };
}

/** The states a `?task=` filter selects. */
export function taskFilterStates(f: TaskFilter): TaskState[] {
  if (f === "any") return [...TASK_STATES];
  if (f === "active") return ["blocked", "open", "claimed"];
  return [f];
}
