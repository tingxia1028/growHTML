import { describe, expect, it } from "vitest";
import { normalizeUrl, snapshotWebpage } from "./snapshot";

describe("normalizeUrl", () => {
  it("strips tracking params, hash, trailing slash, and lowercases host", () => {
    expect(normalizeUrl("HTTPS://Example.com/Post/?utm_source=x&id=7#frag")).toBe(
      "https://example.com/Post?id=7"
    );
  });

  it("keeps the root path slash", () => {
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com/");
  });
});

describe("snapshotWebpage", () => {
  const html = [
    "<!doctype html><html><head><title>  Remote   Page </title></head>",
    '<body><article onclick="evil()">',
    '<p>Hello.</p><a href="/about">about</a><img src="img/x.png">',
    "<script>steal()</script>",
    "</article></body></html>"
  ].join("");

  it("removes scripts and inline handlers, absolutizes URLs, and extracts a title", () => {
    const { title, content } = snapshotWebpage(html, "https://example.com/blog/post");

    expect(title).toBe("Remote Page");
    expect(content).not.toContain("steal()");
    expect(content).not.toContain("onclick");
    expect(content).toContain('href="https://example.com/about"');
    expect(content).toContain('src="https://example.com/blog/img/x.png"');
    expect(content).toContain("Hello.");
  });
});
