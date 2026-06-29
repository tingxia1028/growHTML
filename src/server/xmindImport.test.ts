import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { xmindBytesToMarkmap } from "./xmindImport";

// The IMPURE unzip+parse layer. We build a tiny in-memory .xmind (a zip) with fflate
// and assert the bytes → markmap outline path, for both the modern content.json and
// the legacy content.xml archives, plus the error case. (The pure tree→outline mapping
// is exhaustively covered in src/core/notes/xmindToMarkmap.test.ts.)

function buildXmind(entries: Record<string, string>): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const [name, body] of Object.entries(entries)) files[name] = strToU8(body);
  return zipSync(files);
}

describe("xmindBytesToMarkmap — unzip + parse", () => {
  it("modern .xmind (content.json) → markmap outline", () => {
    const content = JSON.stringify([
      {
        rootTopic: {
          title: "Roadmap",
          children: { attached: [{ title: "Q1" }, { title: "Q2" }] }
        }
      }
    ]);
    const bytes = buildXmind({ "content.json": content, "metadata.json": "{}" });
    expect(xmindBytesToMarkmap(bytes)).toBe(["# Roadmap", "## Q1", "## Q2"].join("\n"));
  });

  it("legacy .xmind (content.xml) → markmap outline when no content.json", () => {
    const xml = `<sheet><topic><title>Legacy</title><children><topics type="attached"><topic><title>Old</title></topic></topics></children></topic></sheet>`;
    const bytes = buildXmind({ "content.xml": xml, "meta.xml": "<meta/>" });
    expect(xmindBytesToMarkmap(bytes)).toBe(["# Legacy", "## Old"].join("\n"));
  });

  it("prefers content.json over content.xml when both exist", () => {
    const json = JSON.stringify([{ rootTopic: { title: "FromJson" } }]);
    const xml = `<sheet><topic><title>FromXml</title></topic></sheet>`;
    const bytes = buildXmind({ "content.json": json, "content.xml": xml });
    expect(xmindBytesToMarkmap(bytes)).toBe("# FromJson");
  });

  it("finds content.json even when nested under a folder in the archive", () => {
    const json = JSON.stringify([{ rootTopic: { title: "Nested" } }]);
    const bytes = buildXmind({ "Resources/content.json": json });
    expect(xmindBytesToMarkmap(bytes)).toBe("# Nested");
  });

  it("throws a clear error when neither content.json nor content.xml is present", () => {
    const bytes = buildXmind({ "metadata.json": "{}" });
    expect(() => xmindBytesToMarkmap(bytes)).toThrow(/no content\.json or content\.xml/);
  });
});
