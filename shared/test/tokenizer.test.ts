import { describe, expect, it } from "vitest";
import { tokenize, bm25Metrics, jsonPairTerms, tokenizeQuery } from "../src/tokenizer";
import { summarize, flattenJsonValues } from "../src/text";

describe("tokenize", () => {
  it("normalizes, splits and drops stopwords", () => {
    expect(tokenize("The Café of GPT-4 is here!")).toEqual(["cafe", "gpt", "here"]);
  });
  it("computes bm25 metrics", () => {
    const m = bm25Metrics("apple apple banana");
    expect(m.docLength).toBe(3);
    expect(m.tf).toEqual({ apple: 2, banana: 1 });
    expect(new Set(m.uniqueTerms)).toEqual(new Set(["apple", "banana"]));
  });
});

describe("text", () => {
  it("summarizes markdown", () => {
    expect(summarize("# Title\n\nSome **bold** text with [a link](/page/x) and `code`.")).toBe("Title Some bold text with a link and .");
  });
  it("flattens json", () => {
    expect(flattenJsonValues({ a: 1, b: ["x", { c: true }] })).toBe("a 1 b x c true");
  });
});

describe("json key:value terms", () => {
  const doc = {
    type: "planet",
    orbitalPeriodDays: 87.97,
    moons: [],
    discoveredBy: "Galileo Galilei",
    aliases: ["Hermes", "Mercurius"],
    habitable: false,
    ruler: null,
    atmosphere: { composition: ["oxygen", "sodium"], layers: [{ name: "exosphere" }] },
  };
  it("emits key:value pairs for every leaf", () => {
    expect(jsonPairTerms(doc)).toEqual([
      "type:planet",
      "orbitalperioddays:87.97",
      "discoveredby:galileo",
      "discoveredby:galilei",
      "discoveredby:galileo_galilei",
      "aliases:hermes",
      "aliases:mercurius",
      "habitable:false",
      "ruler:null",
      "composition:oxygen",
      "composition:sodium",
      "name:exosphere",
    ]);
  });
  it("ignores non-objects and dedupes", () => {
    expect(jsonPairTerms(null)).toEqual([]);
    expect(jsonPairTerms("x")).toEqual([]);
    expect(jsonPairTerms([{ a: "xy" }, { a: "xy" }])).toEqual(["a:xy"]);
  });
  it("adds pair terms to bm25 metrics", () => {
    const m = bm25Metrics("Mercury planet", jsonPairTerms({ type: "planet" }));
    expect(m.tf["type:planet"]).toBe(1);
    expect(m.docLength).toBe(3);
  });
  it("tokenizes queries with key:value pairs", () => {
    expect(tokenizeQuery("planets type:planet")).toEqual(["planets", "type:planet"]);
    expect(tokenizeQuery('discoveredBy:"Galileo Galilei"')).toEqual(["discoveredby:galileo", "discoveredby:galilei", "discoveredby:galileo_galilei"]);
    expect(tokenizeQuery("discoveredby:galileo_galilei")).toEqual(["discoveredby:galileo_galilei"]);
    expect(tokenizeQuery("Type:Planet habitable:false n:87.97")).toEqual(["type:planet", "habitable:false", "n:87.97"]);
  });
});
