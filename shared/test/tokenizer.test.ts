import { describe, expect, it } from "vitest";
import { tokenize, bm25Metrics } from "../src/tokenizer";
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
