import { describe, expect, it } from "vitest";
import { buildAnchorInput, draftQuoteText, type AnchorDraft } from "./FocusContext";

describe("buildAnchorInput", () => {
  it("maps an html quote draft to an html_selection request", () => {
    const draft: AnchorDraft = {
      mode: "quote",
      sourceId: "src_1",
      kind: "html",
      quote: "Render Thread",
      studyId: "p-1",
      selector: '[data-study-id="p-1"]',
      prefix: "the ",
      suffix: " submits"
    };
    expect(buildAnchorInput(draft)).toEqual({
      sourceId: "src_1",
      anchorKind: "html_selection",
      studyId: "p-1",
      selector: '[data-study-id="p-1"]',
      quote: "Render Thread",
      contextBefore: "the ",
      contextAfter: " submits"
    });
  });

  it("maps a web quote draft using the tab url as normalizedUrl", () => {
    const draft: AnchorDraft = {
      mode: "quote",
      sourceId: "src_1",
      kind: "web",
      quote: "render thread",
      url: "https://example.com/post"
    };
    expect(buildAnchorInput(draft)).toMatchObject({
      anchorKind: "web_text_quote",
      normalizedUrl: "https://example.com/post",
      quote: "render thread"
    });
  });

  it("maps a local-HTML selection (web kind keyed by its /api/local url) to a web_text_quote anchor", () => {
    // Local HTML is stored raw with no study-ids, so its selections become
    // web_text_quote anchors keyed by the file's local-serving url.
    const draft: AnchorDraft = {
      mode: "quote",
      sourceId: "src_local",
      kind: "web",
      quote: "the render loop",
      prefix: "about ",
      suffix: " here",
      url: "/api/local/C%3A/docs/intro.html"
    };
    expect(buildAnchorInput(draft)).toEqual({
      sourceId: "src_local",
      anchorKind: "web_text_quote",
      normalizedUrl: "/api/local/C%3A/docs/intro.html",
      quote: "the render loop",
      contextBefore: "about ",
      contextAfter: " here"
    });
  });

  it("omits normalizedUrl for a web draft whose url is blank/whitespace (live-HTML bug)", () => {
    // Regression: webview.getURL() can return "" before the guest attaches. A blank
    // string is NOT nullish, so `draft.url ?? draft.normalizedUrl` used to keep it →
    // the request carried `normalizedUrl: ""`, which (a) fails the server's
    // z.string().min(1) → 400 and (b) blocks the server's metadata.normalizedUrl
    // fallback (again "" isn't nullish). The fix coalesces blank → undefined so the
    // server falls back to the source's stored normalizedUrl and the anchor is made.
    for (const url of ["", "   "]) {
      const draft: AnchorDraft = { mode: "quote", sourceId: "src_live", kind: "web", quote: "render thread", url };
      const input = buildAnchorInput(draft);
      expect(input.anchorKind).toBe("web_text_quote");
      expect(input.normalizedUrl).toBeUndefined();
    }
    // Likewise when neither url nor normalizedUrl is set.
    const noUrl: AnchorDraft = { mode: "quote", sourceId: "src_live", kind: "web", quote: "x" };
    expect(buildAnchorInput(noUrl).normalizedUrl).toBeUndefined();
  });

  it("trims a web draft's url before using it as normalizedUrl", () => {
    const draft: AnchorDraft = {
      mode: "quote",
      sourceId: "src_1",
      kind: "web",
      quote: "q",
      url: "  https://example.com/post  "
    };
    expect(buildAnchorInput(draft).normalizedUrl).toBe("https://example.com/post");
  });

  it("maps a pdf quote draft with its page", () => {
    const draft: AnchorDraft = { mode: "quote", sourceId: "src_1", kind: "pdf", quote: "x", page: 3 };
    expect(buildAnchorInput(draft)).toMatchObject({ anchorKind: "pdf_selection", page: 3, quote: "x" });
  });

  it("maps a pdf REGION draft to a pdf_selection with rect and empty quote", () => {
    const draft: AnchorDraft = {
      mode: "region",
      sourceId: "src_1",
      kind: "pdf",
      page: 2,
      rect: [0.1, 0.2, 0.3, 0.4]
    };
    expect(buildAnchorInput(draft)).toEqual({
      sourceId: "src_1",
      anchorKind: "pdf_selection",
      page: 2,
      rect: [0.1, 0.2, 0.3, 0.4],
      quote: ""
    });
  });

  it("defaults a region pdf draft without a page to page 1", () => {
    const draft: AnchorDraft = { mode: "region", sourceId: "src_1", kind: "pdf", rect: [0, 0, 1, 1] };
    expect(buildAnchorInput(draft)).toMatchObject({ anchorKind: "pdf_selection", page: 1, rect: [0, 0, 1, 1] });
  });

  it("maps an image REGION draft to an image_region anchor", () => {
    const draft: AnchorDraft = {
      mode: "region",
      sourceId: "src_img",
      kind: "image",
      rect: [0.05, 0.1, 0.5, 0.6]
    };
    expect(buildAnchorInput(draft)).toEqual({
      sourceId: "src_img",
      anchorKind: "image_region",
      rect: [0.05, 0.1, 0.5, 0.6],
      quote: ""
    });
  });
});

describe("draftQuoteText", () => {
  it("returns the quote for a quote draft and empty string for a region draft", () => {
    expect(
      draftQuoteText({ mode: "quote", sourceId: "s", kind: "html", quote: "hello" })
    ).toBe("hello");
    expect(draftQuoteText({ mode: "region", sourceId: "s", kind: "image", rect: [0, 0, 1, 1] })).toBe("");
    expect(draftQuoteText(null)).toBe("");
  });
});
