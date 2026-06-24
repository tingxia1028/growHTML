import { afterEach, describe, expect, it } from "vitest";
import { getSourceViewer, listSourceViewers, registerSourceViewer } from "./viewers";

describe("SourceViewer registry", () => {
  const originalCount = listSourceViewers().length;

  afterEach(() => {
    // Drop any viewers registered during a test (registerSourceViewer prepends).
    while (listSourceViewers().length > originalCount) {
      (listSourceViewers() as unknown as unknown[]).shift();
    }
  });

  it("maps built-in source types to viewers", () => {
    expect(getSourceViewer("html").id).toBe("html");
    expect(getSourceViewer("webpage").htmlPipeline).toBe(true);
    expect(getSourceViewer("markdown").kind).toBe("html");
    // PDFs render via PDF.js (host-page canvas + text layer) so they can be
    // text-selected AND region-marked.
    expect(getSourceViewer("pdf").id).toBe("pdf");
    expect(getSourceViewer("pdf").kind).toBe("pdfjs");
    expect(getSourceViewer("pdf").htmlPipeline).toBe(false);
    // Images render in a dedicated host-page viewer for region marking.
    expect(getSourceViewer("image").id).toBe("image");
    expect(getSourceViewer("image").kind).toBe("image");
    // Other native files (code/word) still use the generic iframe.
    expect(getSourceViewer("code").kind).toBe("file");
  });

  it("falls back to the HTML viewer for unknown types", () => {
    expect(getSourceViewer(undefined).id).toBe("html");
    expect(getSourceViewer("something-new").id).toBe("html");
  });

  it("lets a plugin register a viewer that takes priority", () => {
    registerSourceViewer({ id: "webview", sourceTypes: ["web_live"], kind: "webview", htmlPipeline: false });
    expect(getSourceViewer("web_live").id).toBe("webview");
    expect(getSourceViewer("web_live").kind).toBe("webview");
  });
});
