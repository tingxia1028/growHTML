import { describe, expect, it } from "vitest";
import { renderNoteContent } from "./render";

describe("renderNoteContent", () => {
  it("renders markdown headings, bold, lists, and code", () => {
    const { html } = renderNoteContent("markdown", "# Title\n\nSome **bold** and `code`\n\n- one\n- two");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<li>two</li>");
  });

  it("escapes HTML so notes cannot inject markup", () => {
    const { html } = renderNoteContent("markdown", "<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("only keeps http(s)/relative links, dropping javascript: URLs", () => {
    const safe = renderNoteContent("markdown", "[ok](https://example.com)").html;
    expect(safe).toContain('href="https://example.com"');
    const unsafe = renderNoteContent("markdown", "[x](javascript:alert(1))").html;
    expect(unsafe).not.toContain("<a "); // no anchor emitted — rendered as inert text
    expect(unsafe).not.toContain("href=");
    expect(unsafe).toContain("[x](javascript:alert(1))");
  });

  it("renders a mindmap as a nested tree", () => {
    const content = JSON.stringify({ title: "Root", children: [{ title: "A" }, { title: "B", children: [{ title: "B1" }] }] });
    const { html } = renderNoteContent("mindmap", content);
    expect(html).toContain('class="sv-mindmap"');
    expect(html).toContain("Root");
    expect(html).toContain("B1");
    expect(html.match(/<ul>/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("renders a flashcard with front and back", () => {
    const { html } = renderNoteContent("flashcard", JSON.stringify({ front: "Q?", back: "A!" }));
    expect(html).toContain("<summary>Q?</summary>");
    expect(html).toContain("A!");
  });

  it("falls back to escaped plain text for unknown content types", () => {
    const { html } = renderNoteContent("totally-new-form", "<b>raw</b>");
    expect(html).toContain('class="sv-plain"');
    expect(html).toContain("&lt;b&gt;raw&lt;/b&gt;");
  });

  it("falls back safely when structured content fails to parse", () => {
    const result = renderNoteContent("mindmap", "not json");
    expect(result.error).toBeTruthy();
    expect(result.html).toContain("sv-plain");
  });
});
