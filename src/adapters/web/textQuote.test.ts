import { describe, expect, it } from "vitest";
import { createTextQuoteSelector, resolveTextQuote } from "./textQuote";

describe("TextQuoteSelector", () => {
  const text = "The render thread submits commands. Later the render thread also blocks on the GPU.";

  it("builds exact/prefix/suffix from a selection range", () => {
    const start = text.indexOf("submits");
    const selector = createTextQuoteSelector(text, start, start + "submits".length, 10);
    expect(selector.exact).toBe("submits");
    expect(selector.prefix).toBe("er thread ");
    expect(selector.suffix).toBe(" commands.");
  });

  it("resolves a unique quote", () => {
    const range = resolveTextQuote(text, { exact: "submits commands", prefix: "", suffix: "" });
    expect(range).not.toBeNull();
    expect(text.slice(range!.start, range!.end)).toBe("submits commands");
  });

  it("disambiguates repeated quotes using prefix/suffix context", () => {
    // "render thread" appears twice; suffix picks the second one.
    const range = resolveTextQuote(text, { exact: "render thread", prefix: "the ", suffix: " also" });
    expect(range).not.toBeNull();
    expect(range!.start).toBe(text.lastIndexOf("render thread"));
  });

  it("returns null when the quote is absent", () => {
    expect(resolveTextQuote(text, { exact: "nonexistent", prefix: "", suffix: "" })).toBeNull();
  });

  it("round-trips: a created selector resolves back to the same range", () => {
    const start = text.lastIndexOf("render thread");
    const end = start + "render thread".length;
    const selector = createTextQuoteSelector(text, start, end);
    const resolved = resolveTextQuote(text, selector);
    expect(resolved).toEqual({ start, end });
  });
});
