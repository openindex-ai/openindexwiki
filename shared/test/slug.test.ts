import { describe, expect, it } from "vitest";
import { slugify, isValidSlug, normalizeSlug, titleFromSlug } from "../src/slug";

describe("slugify", () => {
  it("lowercases and joins words with underscores", () => {
    expect(slugify("Theory of Mind")).toBe("theory_of_mind");
  });
  it("strips diacritics and punctuation", () => {
    expect(slugify("Café: Déjà vu!")).toBe("cafe_deja_vu");
  });
  it("keeps parentheses, hyphens and dots", () => {
    expect(slugify("Mercury (planet) - v1.2")).toBe("mercury_(planet)_-_v1.2");
  });
  it("strips trailing .md and separators", () => {
    expect(slugify("  Philosophy.md ")).toBe("philosophy");
    expect(slugify("__hello__")).toBe("hello");
  });
  it("normalizes URL-encoded input", () => {
    expect(normalizeSlug("Theory%20of%20Mind.md")).toBe("theory_of_mind");
  });
  it("validates", () => {
    expect(isValidSlug("theory_of_mind")).toBe(true);
    expect(isValidSlug("__x__")).toBe(false);
    expect(isValidSlug("..")).toBe(false);
    expect(isValidSlug("Hello")).toBe(false);
    expect(isValidSlug("")).toBe(false);
  });
});

describe("titleFromSlug", () => {
  it("turns a slug into a sentence-case title", () => {
    expect(titleFromSlug("theory_of_mind")).toBe("Theory of mind");
    expect(titleFromSlug("large-language_models")).toBe("Large language models");
    expect(titleFromSlug("c")).toBe("C");
  });
});
