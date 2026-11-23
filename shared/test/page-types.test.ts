import { describe, expect, it } from "vitest";
import { PAGE_TYPES, PAGE_TYPE_ALIASES, isRecommendedPageType, normalizePageType, pageTypeHint, pageTypeOf } from "../src/page-types";
import { jsonPairTerms, parseSearchQuery } from "../src/tokenizer";

describe("normalizePageType", () => {
  it("lowercases, strips accents and joins words with underscores", () => {
    expect(normalizePageType("Person")).toBe("person");
    expect(normalizePageType(" MCP Server ")).toBe("mcp_server");
    expect(normalizePageType("mcp-server")).toBe("mcp_server");
    expect(normalizePageType("Organización")).toBe("organizacion");
  });
  it("rejects empty, letterless and overlong values", () => {
    expect(normalizePageType("")).toBeNull();
    expect(normalizePageType(" -- ")).toBeNull();
    expect(normalizePageType("1234")).toBeNull();
    expect(normalizePageType("x".repeat(41))).toBeNull();
  });
  it("matches the type: search filter for the same value", () => {
    for (const raw of ["Person", "MCP Server", "mcp_server", "Open-Source Model"]) {
      const type = normalizePageType(raw)!;
      const filter = parseSearchQuery(`type:${type}`).filters.type;
      expect(jsonPairTerms({ type: raw })).toEqual(expect.arrayContaining(filter));
    }
  });
});

describe("pageTypeOf", () => {
  it("reads only the top-level type string", () => {
    expect(pageTypeOf({ type: "Person", name: "Ada" })).toBe("person");
    expect(pageTypeOf({ author: { type: "organization" } })).toBeNull();
    expect(pageTypeOf([{ type: "person" }])).toBeNull();
    expect(pageTypeOf({ type: 3 })).toBeNull();
    expect(pageTypeOf(null)).toBeNull();
    expect(pageTypeOf(undefined)).toBeNull();
    expect(pageTypeOf("person")).toBeNull();
  });
});

describe("pageTypeHint", () => {
  it("is silent for recommended types", () => {
    for (const t of PAGE_TYPES) expect(pageTypeHint({ type: t })).toBeNull();
    expect(pageTypeHint({ type: "MCP Server" })).toBeNull();
  });
  it("asks for a type when there is none", () => {
    expect(pageTypeHint(null)).toMatch(/no type/);
    expect(pageTypeHint({ name: "x" })).toMatch(/no type/);
    expect(pageTypeHint({ author: { type: "person" } })).toMatch(/no type/);
  });
  it("flags malformed values", () => {
    expect(pageTypeHint({ type: 42 })).toMatch(/short word/);
    expect(pageTypeHint({ type: "" })).toMatch(/short word/);
  });
  it("suggests the recommended type for a synonym, with its kind", () => {
    expect(pageTypeHint({ type: "Company" })).toContain('{"type": "organization", "kind": "company"}');
    expect(pageTypeHint({ type: "LLM" })).toContain('{"type": "model"}');
  });
  it("points unknown types at the list", () => {
    expect(pageTypeHint({ type: "planet" })).toMatch(/not one of the recommended types/);
  });
});

describe("PAGE_TYPE_ALIASES", () => {
  it("maps normalized synonyms onto recommended types and never shadows one", () => {
    for (const [alias, target] of Object.entries(PAGE_TYPE_ALIASES)) {
      expect(normalizePageType(alias)).toBe(alias);
      expect(isRecommendedPageType(alias)).toBe(false);
      expect(isRecommendedPageType(target.type)).toBe(true);
    }
  });
});
