import { describe, expect, it } from "vitest";
import { applyLabelChanges, channelIdBase, formatLabels, isValidChannelId, labelPairs, labelTerm, normalizeChannelId, normalizeLabels, parseLabelArg } from "../src/channels";
import { formatDuration, parseDuration } from "../src/duration";
import { createPostSchema, inviteChannelMemberSchema, listThreadsQuerySchema, updatePostSchema } from "../src/schemas";

describe("channel ids", () => {
  it("slugify the name into [a-z0-9_] and keep at most 40 characters", () => {
    expect(channelIdBase("Security Findings")).toBe("security_findings");
    expect(channelIdBase("  Café — R&D (2026) ")).toBe("cafe_rd_2026");
    expect(channelIdBase("v0.factory-dev")).toBe("v0_factory_dev");
    expect(channelIdBase("!!!")).toBe("channel");
    expect(channelIdBase("a".repeat(60)).length).toBe(40);
  });
  it("accept only base_suffix ids", () => {
    expect(isValidChannelId("security_findings_k3x9qa")).toBe(true);
    expect(isValidChannelId("channel_000000")).toBe(true);
    expect(isValidChannelId("security_findings")).toBe(false);
    expect(isValidChannelId("Security_k3x9qa")).toBe(false);
    expect(isValidChannelId("_k3x9qa")).toBe(false);
    expect(isValidChannelId("../etc_k3x9qa")).toBe(false);
    expect(isValidChannelId(`${"a".repeat(41)}_k3x9qa`)).toBe(false);
  });
  it("normalize what users paste", () => {
    expect(normalizeChannelId(" #Ops_k3x9qa ")).toBe("ops_k3x9qa");
    expect(normalizeChannelId("https://www.openindex.ai/channel/ops_k3x9qa/12")).toBe("ops_k3x9qa");
    expect(normalizeChannelId("/channel/ops_k3x9qa")).toBe("ops_k3x9qa");
  });
});

describe("labels", () => {
  it("parse key=value arguments, key= removes", () => {
    expect(parseLabelArg("Status=Open")).toEqual({ key: "status", value: "Open" });
    expect(parseLabelArg("pr=https://github.com/a/b/pull/1")).toEqual({ key: "pr", value: "https://github.com/a/b/pull/1" });
    expect(parseLabelArg("status=")).toEqual({ key: "status", value: null });
    expect(() => parseLabelArg("status")).toThrow();
    expect(() => parseLabelArg("bad key=x")).toThrow();
  });
  it("normalize and cap a labels map", () => {
    expect(normalizeLabels({ Kind: " bug " })).toEqual({ kind: "bug" });
    expect(() => normalizeLabels({ kind: "" })).toThrow();
    expect(() => normalizeLabels({ kind: "a\nb" })).toThrow();
    const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, "v"]));
    expect(() => normalizeLabels(many)).toThrow(/at most 20/);
  });
  it("merge changes, null or empty removes", () => {
    expect(applyLabelChanges({ status: "open", kind: "bug" }, { status: "done", kind: null, pr: "12" })).toEqual({ status: "done", pr: "12" });
    expect(applyLabelChanges(undefined, { status: "" })).toEqual({});
  });
  it("index both key and key=value, lowercased, so either form filters with one query", () => {
    expect(labelPairs({ Status: "Open", kind: "bug" })).toEqual(["kind", "kind=bug", "status", "status=open"]);
    expect(labelTerm("Status=Open")).toBe("status=open");
    expect(labelTerm("Status")).toBe("status");
    expect(labelPairs({ status: "Open" })).toContain(labelTerm("STATUS=open"));
    expect(formatLabels({ status: "open", kind: "bug" })).toBe("status=open kind=bug");
  });
});

describe("channel schemas", () => {
  it("default channel invites to editor", () => {
    expect(inviteChannelMemberSchema.parse({ email: "A@Example.com" })).toEqual({ email: "a@example.com", role: "editor" });
  });
  it("need content, and keep labels off replies", () => {
    expect(createPostSchema.safeParse({}).success).toBe(false);
    expect(createPostSchema.safeParse({ markdown: "  " }).success).toBe(false);
    expect(createPostSchema.safeParse({ json: { ok: true } }).success).toBe(true);
    expect(createPostSchema.safeParse({ markdown: "hi", replyTo: 3, labels: { status: "open" } }).success).toBe(false);
    expect(createPostSchema.safeParse({ markdown: "hi", agent: "reviewer-3" }).success).toBe(true);
    expect(createPostSchema.safeParse({ markdown: "hi", agent: "line\nbreak" }).success).toBe(false);
  });
  it("refuse an empty update and accept label removals", () => {
    expect(updatePostSchema.safeParse({}).success).toBe(false);
    expect(updatePostSchema.safeParse({ labels: { status: null } }).success).toBe(true);
  });
  it("take repeated label filters", () => {
    expect(listThreadsQuerySchema.parse({ label: ["status=open", "kind"] }).label).toEqual(["status=open", "kind"]);
    expect(listThreadsQuerySchema.parse({}).label).toEqual([]);
  });
});

describe("durations", () => {
  it("parse the CLI forms", () => {
    expect(parseDuration("90")).toBe(90);
    expect(parseDuration("30s")).toBe(30);
    expect(parseDuration("15m")).toBe(900);
    expect(parseDuration("1h30m")).toBe(5400);
    expect(parseDuration("2d")).toBe(172_800);
    expect(() => parseDuration("soon")).toThrow();
    expect(() => parseDuration("10x")).toThrow();
  });
  it("format back", () => {
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(900)).toBe("15m");
    expect(formatDuration(5400)).toBe("1h30m");
  });
});
