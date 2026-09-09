import { describe, expect, it } from "vitest";
import { tokenize, bm25Metrics, jsonPairTerms, tokenizeQuery, parseSearchQuery, matchesFilters } from "../src/tokenizer";
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
    expect(tokenizeQuery('discoveredBy:"Galileo Galilei"')).toEqual(["discoveredby:galileo_galilei"]); // quoted = exact joined form
    expect(tokenizeQuery("discoveredby:galileo_galilei")).toEqual(["discoveredby:galileo_galilei"]);
    expect(tokenizeQuery("Type:Planet habitable:false n:87.97")).toEqual(["type:planet", "habitable:false", "n:87.97"]);
  });
});

describe("parseSearchQuery + matchesFilters", () => {
  it("separates text from grouped filters", () => {
    expect(parseSearchQuery("orbital resonance type:planet Type:moon habitable:false")).toEqual({
      text: "orbital resonance",
      words: ["orbital", "resonance"],
      filters: { type: ["type:planet", "type:moon"], habitable: ["habitable:false"] },
    });
  });
  it("uses the exact joined form for quoted or underscored values", () => {
    expect(parseSearchQuery('discoveredBy:"Galileo Galilei"').filters).toEqual({ discoveredby: ["discoveredby:galileo_galilei"] });
    expect(parseSearchQuery("discoveredby:galileo").filters).toEqual({ discoveredby: ["discoveredby:galileo"] });
  });
  it("matches OR within a key and AND across keys", () => {
    const filters = { type: ["type:planet", "type:moon"], habitable: ["habitable:false"] };
    expect(matchesFilters({ "type:moon": 1, "habitable:false": 1 }, filters)).toBe(true);
    expect(matchesFilters({ "type:planet": 1 }, filters)).toBe(false);
    expect(matchesFilters(undefined, {})).toBe(true);
  });
});
