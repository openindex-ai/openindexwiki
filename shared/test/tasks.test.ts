import { describe, expect, it } from "vitest";
import { applyTaskAction, effectiveState, isClaimable, leaseSeconds, newTask, taskFilterStates, toTaskInfo, unblock, type TaskActor, type TaskData } from "../src/tasks";
import { createPostSchema, taskActionSchema } from "../src/schemas";

const NOW = 1_800_000_000_000;
const worker = (uid = "w1", over: Partial<TaskActor> = {}): TaskActor => ({ uid, name: uid.toUpperCase(), agent: `agent-${uid}`, canWork: true, isModerator: false, isAuthor: false, ...over });
const admin = worker("admin", { isModerator: true });
const viewer = worker("v", { canWork: false });

function claimed(by = worker(), at = NOW, leaseSec = 900): TaskData {
  const r = applyTaskAction(newTask([], []), "claim", { actor: by, now: at, leaseSec, newClaimId: `c-${by.uid}-${at}` });
  if (!r.ok) throw new Error(r.message);
  return r.task;
}

describe("new tasks", () => {
  it("start open, or blocked by unfinished dependencies", () => {
    expect(newTask([], []).state).toBe("open");
    const t = newTask([3, 4], [4]);
    expect(t.state).toBe("blocked");
    expect(t.blockedBy).toEqual([4]);
    expect(isClaimable(t, NOW)).toBe(false);
  });
  it("open when the last dependency is done", () => {
    let t = newTask([3, 4], [3, 4]);
    t = unblock(t, 3);
    expect(t.state).toBe("blocked");
    t = unblock(t, 4);
    expect(t.state).toBe("open");
    expect(isClaimable(t, NOW)).toBe(true);
  });
});

describe("claim", () => {
  it("hands out a lease and a claim id, and counts attempts", () => {
    const t = claimed(worker(), NOW, 60);
    expect(t.state).toBe("claimed");
    expect(t.claimId).toBe(`c-w1-${NOW}`);
    expect(t.claimedAgent).toBe("agent-w1");
    expect(t.leaseUntil).toBe(NOW + 60_000);
    expect(t.attempts).toBe(1);
  });
  it("refuses a claimed task until its lease passes, then lets anyone take it", () => {
    const t = claimed(worker("w1"), NOW, 60);
    const early = applyTaskAction(t, "claim", { actor: worker("w2"), now: NOW + 59_000, newClaimId: "x" });
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.code).toBe("TASK_UNAVAILABLE");
    expect(effectiveState(t, NOW + 60_000)).toBe("open");
    const late = applyTaskAction(t, "claim", { actor: worker("w2"), now: NOW + 60_000, newClaimId: "x" });
    expect(late.ok && late.task.claimedBy === "w2" && late.task.attempts === 2).toBe(true);
  });
  it("refuses viewers, blocked and finished tasks", () => {
    expect(applyTaskAction(newTask([], []), "claim", { actor: viewer, now: NOW, newClaimId: "x" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(applyTaskAction(newTask([2], [2]), "claim", { actor: worker(), now: NOW, newClaimId: "x" })).toMatchObject({ ok: false, code: "TASK_UNAVAILABLE" });
    const done = applyTaskAction(claimed(), "complete", { actor: worker(), now: NOW });
    expect(done.ok).toBe(true);
    if (done.ok) expect(applyTaskAction(done.task, "claim", { actor: worker("w2"), now: NOW, newClaimId: "x" })).toMatchObject({ ok: false, code: "TASK_UNAVAILABLE" });
  });
});

describe("fencing", () => {
  it("lets the holder renew and complete with its claim id", () => {
    const t = claimed(worker("w1"), NOW, 60);
    const renewed = applyTaskAction(t, "renew", { actor: worker("w1"), now: NOW + 30_000, leaseSec: 3600, claimId: t.claimId! });
    expect(renewed.ok && renewed.task.leaseUntil === NOW + 30_000 + 3_600_000 && renewed.event === null).toBe(true);
    const done = applyTaskAction(t, "complete", { actor: worker("w1"), now: NOW + 40_000, claimId: t.claimId! });
    expect(done.ok && done.task.state === "done" && done.task.completedBy === "w1" && done.event === "task.completed").toBe(true);
  });
  it("tells a stale holder it lost the lease once someone else reclaimed it", () => {
    const first = claimed(worker("w1"), NOW, 60);
    const second = applyTaskAction(first, "claim", { actor: worker("w2"), now: NOW + 61_000, newClaimId: "c2" });
    if (!second.ok) throw new Error();
    const stale = applyTaskAction(second.task, "complete", { actor: worker("w1"), now: NOW + 62_000, claimId: first.claimId! });
    expect(stale).toMatchObject({ ok: false, code: "LEASE_LOST" });
  });
  it("tells two agents of one account apart by claim id; without it the account is enough", () => {
    const t = claimed(worker("shared"), NOW);
    expect(applyTaskAction(t, "complete", { actor: worker("shared"), now: NOW, claimId: "someone-else" })).toMatchObject({ ok: false, code: "LEASE_LOST" });
    expect(applyTaskAction(t, "complete", { actor: worker("shared"), now: NOW }).ok).toBe(true);
    expect(applyTaskAction(t, "complete", { actor: worker("other"), now: NOW })).toMatchObject({ ok: false, code: "LEASE_LOST" });
  });
  it("lets the holder renew an expired lease that nobody took", () => {
    const t = claimed(worker("w1"), NOW, 60);
    expect(applyTaskAction(t, "renew", { actor: worker("w1"), now: NOW + 120_000, claimId: t.claimId! }).ok).toBe(true);
  });
});

describe("release, cancel and moderation", () => {
  it("release returns the task to open and clears the claim", () => {
    const r = applyTaskAction(claimed(), "release", { actor: worker(), now: NOW });
    expect(r.ok && r.task.state === "open" && r.task.claimedBy === null && r.task.claimId === null && r.event === "task.released").toBe(true);
  });
  it("admins can force-complete, release and cancel anyone's task", () => {
    const t = claimed(worker("w1"));
    expect(applyTaskAction(t, "complete", { actor: admin, now: NOW }).ok).toBe(true);
    expect(applyTaskAction(t, "release", { actor: admin, now: NOW }).ok).toBe(true);
    expect(applyTaskAction(t, "cancel", { actor: admin, now: NOW }).ok).toBe(true);
  });
  it("only the author or an admin cancels", () => {
    const t = newTask([], []);
    expect(applyTaskAction(t, "cancel", { actor: worker(), now: NOW })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    const r = applyTaskAction(t, "cancel", { actor: worker("me", { isAuthor: true }), now: NOW });
    expect(r.ok && r.task.state === "cancelled").toBe(true);
  });
});

describe("wire form and helpers", () => {
  it("reports an expired lease and never the claim id", () => {
    const info = toTaskInfo(claimed(worker(), NOW, 60), NOW + 61_000);
    expect(info.state).toBe("claimed");
    expect(info.effectiveState).toBe("open");
    expect(info.leaseExpired).toBe(true);
    expect(info).not.toHaveProperty("claimId");
  });
  it("clamp leases and expand filters", () => {
    expect(leaseSeconds(undefined)).toBe(900);
    expect(leaseSeconds(1)).toBe(5);
    expect(leaseSeconds(10 ** 9)).toBe(86_400);
    expect(taskFilterStates("active")).toEqual(["blocked", "open", "claimed"]);
    expect(taskFilterStates("any")).toHaveLength(5);
  });
  it("schemas keep tasks on thread starters", () => {
    expect(createPostSchema.safeParse({ markdown: "x", task: true, dependsOn: [1, 2] }).success).toBe(true);
    expect(createPostSchema.safeParse({ markdown: "x", replyTo: 1, task: true }).success).toBe(false);
    expect(createPostSchema.safeParse({ markdown: "x", dependsOn: [1] }).success).toBe(false);
    expect(taskActionSchema.safeParse({ leaseSeconds: 1 }).success).toBe(false);
  });
});
