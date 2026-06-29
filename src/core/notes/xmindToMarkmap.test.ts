import { describe, it, expect } from "vitest";
import { xmindToMarkmap, xmindJsonToMarkmap, xmindXmlToMarkmap } from "./xmindToMarkmap";
import { classifyContent } from "./classifyContent";
import { parseNoteContent } from "./contentTypes";

// Phase 4 item 3 — the PURE .xmind → markmap converter. Covers BOTH source shapes
// (content.json object tree + content.xml string), nested depths, multi-sheet, and
// edge cases. The output must be a markmap-renderable outline (and round-trip through
// the real `markmap` core spec).

describe("xmindToMarkmap — content.json (modern XMind) tree", () => {
  const sheet = {
    rootTopic: {
      title: "Water Cycle",
      children: {
        attached: [
          { title: "Evaporation", children: { attached: [{ title: "Sun heats water" }] } },
          {
            title: "Condensation",
            children: {
              attached: [{ title: "Clouds form", children: { attached: [{ title: "Cooling" }] } }]
            }
          },
          { title: "Precipitation" }
        ]
      }
    }
  };

  it("maps root→H1, depth-1→H2, deeper→nested bullets", () => {
    const md = xmindJsonToMarkmap([sheet]);
    expect(md).toBe(
      [
        "# Water Cycle",
        "## Evaporation",
        "- Sun heats water",
        "## Condensation",
        "- Clouds form",
        "  - Cooling",
        "## Precipitation"
      ].join("\n")
    );
  });

  it("accepts a single sheet object (not wrapped in an array)", () => {
    const md = xmindJsonToMarkmap(sheet);
    expect(md.startsWith("# Water Cycle")).toBe(true);
  });

  it("multi-sheet → each sheet is its own H1 root, blank-line separated", () => {
    const md = xmindJsonToMarkmap([
      { rootTopic: { title: "Sheet One", children: { attached: [{ title: "A" }] } } },
      { rootTopic: { title: "Sheet Two", children: { attached: [{ title: "B" }] } } }
    ]);
    expect(md).toBe(["# Sheet One", "## A", "", "# Sheet Two", "## B"].join("\n"));
  });

  it("ignores detached (floating) topics — only children.attached recurse", () => {
    const md = xmindJsonToMarkmap([
      {
        rootTopic: {
          title: "Root",
          children: { attached: [{ title: "Kept" }], detached: [{ title: "Floating" }] }
        }
      }
    ]);
    expect(md).toContain("## Kept");
    expect(md).not.toContain("Floating");
  });

  it("sanitizes multi-line / whitespace-heavy titles to a single line", () => {
    const md = xmindJsonToMarkmap([
      { rootTopic: { title: "Line one\nLine two\t  spaced", children: { attached: [] } } }
    ]);
    expect(md).toBe("# Line one Line two spaced");
  });

  it("a titleless topic still renders (placeholder) without breaking the outline", () => {
    const md = xmindJsonToMarkmap([
      { rootTopic: { title: "Root", children: { attached: [{ title: "", children: { attached: [{ title: "deep" }] } }] } } }
    ]);
    // The titleless mid node is kept (it has children) with a placeholder heading.
    expect(md).toContain("# Root");
    expect(md).toContain("(untitled)");
    expect(md).toContain("- deep");
  });
});

describe("xmindToMarkmap — content.xml (legacy XMind) string", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xmap-content version="2.0">
  <sheet id="s1">
    <topic id="r">
      <title>Project Plan</title>
      <children>
        <topics type="attached">
          <topic id="a"><title>Design</title>
            <children><topics type="attached">
              <topic id="a1"><title>Wireframes</title></topic>
            </topics></children>
          </topic>
          <topic id="b"><title>Build</title></topic>
        </topics>
      </children>
    </topic>
  </sheet>
</xmap-content>`;

  it("parses the legacy XML tree → the same depth mapping", () => {
    const md = xmindXmlToMarkmap(xml);
    expect(md).toBe(["# Project Plan", "## Design", "- Wireframes", "## Build"].join("\n"));
  });

  it("decodes XML entities in titles", () => {
    const md = xmindXmlToMarkmap(
      `<sheet><topic><title>Tom &amp; Jerry &lt;3&gt;</title></topic></sheet>`
    );
    expect(md).toBe("# Tom & Jerry <3>");
  });

  it("handles multiple sheets in one content.xml → multiple H1 roots", () => {
    const md = xmindXmlToMarkmap(
      `<sheet><topic><title>One</title></topic></sheet><sheet><topic><title>Two</title></topic></sheet>`
    );
    expect(md).toBe(["# One", "", "# Two"].join("\n"));
  });
});

describe("xmindToMarkmap — dispatcher + edge cases (never throws)", () => {
  it("dispatches to json when `json` is present", () => {
    expect(xmindToMarkmap({ json: [{ rootTopic: { title: "J" } }] })).toBe("# J");
  });

  it("dispatches to xml when only `xml` is present", () => {
    expect(xmindToMarkmap({ xml: `<topic><title>X</title></topic>` })).toBe("# X");
  });

  it("empty / missing input → a safe placeholder, never throws", () => {
    expect(xmindToMarkmap({})).toBe("# (empty mind map)");
    expect(xmindJsonToMarkmap(null)).toBe("# (empty mind map)");
    expect(xmindJsonToMarkmap([])).toBe("# (empty mind map)");
    expect(xmindXmlToMarkmap("")).toBe("# (empty mind map)");
    // pathological inputs
    expect(() => xmindJsonToMarkmap(123 as unknown)).not.toThrow();
    expect(() => xmindXmlToMarkmap("<<<not xml>>>")).not.toThrow();
    expect(() => xmindToMarkmap({ json: undefined, xml: undefined })).not.toThrow();
  });
});

describe("xmindToMarkmap — output is a real markmap note", () => {
  const md = xmindJsonToMarkmap([
    {
      rootTopic: {
        title: "Topic",
        children: { attached: [{ title: "Child A" }, { title: "Child B" }] }
      }
    }
  ]);

  it("validates against the markmap core spec (so it persists as a markmap note)", () => {
    // markmap's content is the markdown outline STRING.
    expect(() => parseNoteContent("markmap", md)).not.toThrow();
    expect(parseNoteContent("markmap", md)).toBe(md);
  });

  it("the produced outline is itself classified as a markmap form (≥2 heading levels)", () => {
    const result = classifyContent(md);
    expect(result.contentType).toBe("markmap");
    expect(result.confidence).toBe("high");
  });
});
