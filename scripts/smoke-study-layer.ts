// Study Layer V2 smoke setup. Seeds an HTML source into the dev vault and writes a
// `docs/samples/sample.studypack` whose anchors are deliberately constructed to hit
// all THREE rematch states against that source, so you can exercise the whole import
// UX by hand:
//   • a1 → an EXACT quote from the source            → matched
//   • a2 → the same quote, different case (no ctx)    → fuzzy
//   • a3 → a fabricated quote not in the source       → unmatched
//
// Run:  STUDY_VAULT_ROOT=<dev vault>  npx tsx scripts/smoke-study-layer.ts
// (defaults to ./.vault-dev — the same root `npm run electron` uses here).

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createEntityId } from "../src/core/ids";
import { openVault } from "../src/core/vault";
import { ingestHtmlSource, listSources } from "../src/core/store/sources";
import { ensureOwnedLayer } from "../src/core/study-layer/layers";
import { fingerprintForSource } from "../src/core/study-layer/fingerprint";
import { studyPackSchema } from "../src/core/study-layer/pack";

const TITLE = "Study Layer Smoke — Rendering Notes";

// One sentence we'll quote exactly (matched) + case-mangle (fuzzy); the source text.
const EXACT = "the render thread submits draw commands to the GPU each frame";
const SOURCE_HTML = `<article>
  <section>
    <h1>Rendering Pipeline</h1>
    <p>In a typical engine ${EXACT}, while the simulation runs a frame ahead.</p>
    <p>Double buffering lets the CPU prepare the next frame without tearing.</p>
  </section>
</article>`;

async function main() {
  const rootDir = process.env.STUDY_VAULT_ROOT ?? path.resolve(process.cwd(), ".vault-dev");
  const vault = await openVault({ rootDir });

  // Reuse the smoke source across runs (so re-running doesn't pile up duplicates).
  const existing = (await listSources(vault)).find((s) => s.title === TITLE);
  const source = existing ?? (await ingestHtmlSource(vault, { title: TITLE, content: SOURCE_HTML, createdBy: "system" }));
  // Make sure the switcher shows the owned layer immediately (pre-import).
  await ensureOwnedLayer(vault, source);

  const pack = studyPackSchema.parse({
    packId: createEntityId("layer"),
    createdAt: new Date().toISOString(),
    app: "ai-study-vault",
    // contentHash makes the importer match THIS exact source copy.
    sourceFingerprint: fingerprintForSource(source),
    layer: {
      title: "Alex's rendering highlights",
      description: "Shared sample layer for the import smoke test.",
      author: { name: "Alex" },
      visibility: "public"
    },
    anchors: [
      // matched — exact quote, single occurrence.
      { refId: "a1", anchorKind: "html_selection", quote: EXACT, contextBefore: "", contextAfter: "" },
      // fuzzy — same words, different case, no context → only the flexible tier hits.
      {
        refId: "a2",
        anchorKind: "html_selection",
        quote: "The Render Thread Submits Draw Commands",
        contextBefore: "",
        contextAfter: ""
      },
      // unmatched — not present anywhere in the source.
      {
        refId: "a3",
        anchorKind: "html_selection",
        quote: "quantum entanglement of the bytecode interpreter",
        contextBefore: "",
        contextAfter: ""
      }
    ],
    notes: [
      { contentType: "markdown", content: "**Key idea:** the render thread is one frame behind.", anchorRefs: ["a1"], conceptRefs: [] },
      { contentType: "markdown", content: "Note hanging off the fuzzy + missing anchors.", anchorRefs: ["a2", "a3"], conceptRefs: [] }
    ]
  });

  const outDir = path.resolve(process.cwd(), "docs", "samples");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "sample.studypack");
  await writeFile(outPath, JSON.stringify(pack, null, 2), "utf8");

  console.log("Study Layer smoke ready.");
  console.log(`  vault:   ${rootDir}`);
  console.log(`  source:  ${source.title}  [${source.id}]`);
  console.log(`  pack:    ${outPath}`);
  console.log("");
  console.log("Manual smoke steps (in the running client):");
  console.log(`  1. Open the source "${TITLE}" in the Library.`);
  console.log("  2. In the right-most Layers pane, click \"Import Layer\" and pick docs/samples/sample.studypack.");
  console.log("  3. The preview should show: Matched 1, Fuzzy 1, Unmatched 1. Click Import.");
  console.log("  4. A new layer \"Alex's rendering highlights\" appears; the matched passage is highlighted in the reader.");
  console.log("  5. Untick the new layer's checkbox → its highlight disappears; tick it → it returns.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
