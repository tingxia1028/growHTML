// SRC-4 — the LAZY / bundle-weight guard for the rich editor decision.
//
// THE VERDICT (richEditor.ts header): SRC-4 rich editing adopts NO heavy editor library
// (not GrapesJS ~1.1 MB, not TipTap/Lexical schema editors). It extends SRC-2b's zero-dep
// in-place editing with a pure-DOM block toolbar + templates. The task's "lazy-load
// boundary" gate therefore becomes a HARDER invariant to keep proving over time: the rich
// editor module graph — and the whole client — must import NO such library, so it is
// provably absent from the main bundle entry (the build confirms grapesjs never appears
// in dist/). This test statically reads the SRC-4 sources + package.json and fails if a
// heavy WYSIWYG dep is ever wired in without re-taking the (measured) decision.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = join(HERE, "..", "..", "..");

// Editor libraries whose bundle cost / schema-lossiness ruled them out for SRC-4.
const FORBIDDEN_IMPORTS = [
  "grapesjs",
  "grapesjs-preset-webpage",
  "@tiptap/",
  "prosemirror-",
  "lexical",
  "@lexical/",
  "ckeditor",
  "quill"
];

const SRC4_FILES = ["richEditor.ts", "sourceTemplates.ts", "HtmlInPlaceEditor.tsx", "sourceEditor.tsx"];

describe("SRC-4 rich editor imports no heavy WYSIWYG lib (stays out of the main bundle)", () => {
  it("the SRC-4 sources import only the DOM + local modules — no page-builder / schema editor", () => {
    for (const file of SRC4_FILES) {
      const text = readFileSync(join(HERE, file), "utf8");
      const imports = [...text.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
      for (const spec of imports) {
        for (const forbidden of FORBIDDEN_IMPORTS) {
          expect(spec.includes(forbidden), `${file} must not import ${forbidden}`).toBe(false);
        }
      }
    }
  });

  it("NO client source anywhere imports grapesjs (it is a paid-for dep left deliberately unwired)", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
          const text = readFileSync(full, "utf8");
          if (/from\s+["']grapesjs/.test(text) || /import\(["']grapesjs/.test(text)) {
            offenders.push(full);
          }
        }
      }
    };
    walk(join(REPO, "src"));
    expect(offenders).toEqual([]);
  });
});
