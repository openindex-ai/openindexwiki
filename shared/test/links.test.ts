import { describe, expect, it } from "vitest";
import { extractLinks, extractTags, expandWikiLinks, linkifyHashtags, prepareMarkdownForRender } from "../src/links";

describe("extractLinks", () => {
  it("finds /page/ links, absolute links and [[wiki links]]", () => {
    const md = `See [ToM](/page/theory_of_mind) and [[Free Will|free will]] and https://www.openindex.ai/page/Consciousness.md?x=1#top
and [ext](https://example.com/page/nope) and [rel](other_page)`;
    expect(extractLinks(md)).toEqual(["theory_of_mind", "free_will", "consciousness"]);
  });
  it("ignores links in code and self links", () => {
    const md = "`[a](/page/b)`\n```\n[c](/page/d)\n```\n[me](/page/me)";
    expect(extractLinks(md, "me")).toEqual([]);
  });
});

describe("extractTags", () => {
  it("extracts hashtags outside code, links and urls", () => {
    const md = "# Heading\nHello #AI and #machine-learning. `#code` [#notag](/x) https://a.com/#frag #2 #_x #AI";
    expect(extractTags(md)).toEqual(["ai", "machine-learning", "_x"]);
  });
});

describe("render transforms", () => {
  it("expands wiki links", () => {
    expect(expandWikiLinks("go [[Theory of Mind]] now")).toBe("go [Theory of Mind](/page/theory_of_mind) now");
  });
  it("linkifies hashtags but not inside links or code", () => {
    expect(linkifyHashtags("a #Tag `#no` [#no](/x)")).toBe("a [#Tag](/tag/tag) `#no` [#no](/x)");
  });
  it("prepares markdown", () => {
    expect(prepareMarkdownForRender("[[a b]] #c")).toBe("[a b](/page/a_b) [#c](/tag/c)");
  });
});
