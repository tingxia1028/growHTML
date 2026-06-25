import { describe, expect, it } from "vitest";
import { rematchAnchor, rematchText } from "./rematch";

describe("rematchText", () => {
  const text = "The render thread submits commands. The render thread then waits for the GPU.";

  it("matches exactly via prefix + quote + suffix", () => {
    const r = rematchText(text, { quote: "render thread", contextBefore: "The ", contextAfter: " submits" });
    expect(r.status).toBe("matched");
    expect(r.text?.quote).toBe("render thread");
    expect(text.slice(r.text!.index, r.text!.index + "render thread".length)).toBe("render thread");
    // the FIRST occurrence (the one whose suffix is " submits")
    expect(r.text!.index).toBe(text.indexOf("render thread"));
  });

  it("matches a single unambiguous quote occurrence", () => {
    const r = rematchText("only one needle here", { quote: "needle" });
    expect(r.status).toBe("matched");
    expect(r.text?.index).toBe("only one ".length);
  });

  it("disambiguates multiple occurrences using context → matched at the right one", () => {
    const r = rematchText(text, { quote: "render thread", contextAfter: " then waits" });
    expect(r.status).toBe("matched");
    // second occurrence (followed by " then waits")
    expect(r.text?.index).toBe(text.indexOf("render thread", 20));
  });

  it("returns fuzzy for multiple occurrences with no usable context", () => {
    const r = rematchText(text, { quote: "render thread" });
    expect(r.status).toBe("fuzzy");
    expect(r.text?.quote).toBe("render thread");
  });

  it("returns fuzzy on whitespace/case differences", () => {
    const r = rematchText("The   Render    Thread submits.", { quote: "render thread" });
    expect(r.status).toBe("fuzzy");
    expect(r.text?.quote.toLowerCase().replace(/\s+/g, " ")).toBe("render thread");
  });

  it("returns unmatched when the quote is absent", () => {
    expect(rematchText(text, { quote: "vertex shader" }).status).toBe("unmatched");
  });

  it("returns unmatched for an empty quote or empty text", () => {
    expect(rematchText(text, { quote: "   " }).status).toBe("unmatched");
    expect(rematchText("", { quote: "render thread" }).status).toBe("unmatched");
  });
});

describe("rematchAnchor (dispatch by kind)", () => {
  it("text kinds re-locate against ctx.text", () => {
    const r = rematchAnchor(
      { anchorKind: "html_selection", quote: "render thread" },
      { text: "the render thread loops" }
    );
    expect(r.status).toBe("matched");
  });

  it("pdf text quote re-locates against the page text", () => {
    const r = rematchAnchor(
      { anchorKind: "pdf_selection", page: 2, quote: "frame budget" },
      { pageText: (p) => (p === 2 ? "we blew the frame budget" : undefined) }
    );
    expect(r.status).toBe("matched");
  });

  it("pdf figure region (no quote) matches by rect when the binary is the same", () => {
    expect(
      rematchAnchor({ anchorKind: "pdf_selection", page: 1, quote: "", rect: [0.1, 0.1, 0.3, 0.2] }, { sameBinary: true })
        .status
    ).toBe("matched");
    expect(
      rematchAnchor({ anchorKind: "pdf_selection", page: 1, quote: "", rect: [0.1, 0.1, 0.3, 0.2] }, { sameBinary: false })
        .status
    ).toBe("fuzzy");
  });

  it("image region matches by rect (sameBinary), fuzzy otherwise, unmatched without a rect", () => {
    expect(rematchAnchor({ anchorKind: "image_region", quote: "", rect: [0, 0, 1, 1] }, { sameBinary: true }).status).toBe(
      "matched"
    );
    expect(rematchAnchor({ anchorKind: "image_region", quote: "", rect: [0, 0, 1, 1] }, { sameBinary: false }).status).toBe(
      "fuzzy"
    );
    expect(rematchAnchor({ anchorKind: "image_region", quote: "" }, {}).status).toBe("unmatched");
  });

  it("code_range falls back to symbol presence when there is no quote", () => {
    expect(
      rematchAnchor({ anchorKind: "code_range", quote: "", symbol: "renderFrame" }, { text: "void renderFrame() {}" }).status
    ).toBe("fuzzy");
    expect(rematchAnchor({ anchorKind: "code_range", quote: "", symbol: "missing" }, { text: "nope" }).status).toBe(
      "unmatched"
    );
  });
});
