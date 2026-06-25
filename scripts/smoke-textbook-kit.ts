// Textbook Learning Kit MVP smoke setup (user spec §16). Seeds a textbook source into
// the dev vault, fills its OWNED layer with all four Study Block types
// (explanation / exercise / mistake / review-pack), then EXPORTS that layer to a
// `docs/samples/teacher-layer.studypack` — asserting the propagation policy strips the
// student's mistakes (only the shareable blocks travel). You then run the §16 loop by
// hand in the client.
//
// Run:  STUDY_VAULT_ROOT=<dev vault>  npx tsx scripts/smoke-textbook-kit.ts
// (defaults to ./.vault-dev — the same root `npm run electron` uses here).

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createEntityId } from "../src/core/ids";
import { noteSchema, type NoteRecord } from "../src/core/schema";
import { openVault } from "../src/core/vault";
import { ingestHtmlSource, listSources } from "../src/core/store/sources";
import { ensureOwnedLayer } from "../src/core/study-layer/layers";
import { installServerKits } from "../src/kits/server";
import { buildStudyPack } from "../src/server/studyLayer";

const TITLE = "Textbook Smoke — Cell Biology";
const SOURCE_HTML = `<article>
  <section>
    <h1>The Cell Membrane</h1>
    <p>The cell membrane controls what enters and leaves the cell, acting as a selective barrier.</p>
    <p>Mitochondria are the powerhouse of the cell, producing ATP through respiration.</p>
  </section>
</article>`;

// Build a valid note record in the given layer.
function makeNote(
  sourceId: string,
  layerId: string,
  contentType: string,
  content: unknown,
  visibility: "private" | "shared" | "public" = "private"
): NoteRecord {
  const now = new Date().toISOString();
  return noteSchema.parse({
    id: createEntityId("note"),
    type: "note",
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: "system",
    sourceId,
    anchorIds: [],
    conceptIds: [],
    contentType,
    content,
    visibility,
    layerId,
    metadata: {}
  });
}

async function main() {
  const rootDir = process.env.STUDY_VAULT_ROOT ?? path.resolve(process.cwd(), ".vault-dev");
  const vault = await openVault({ rootDir });
  installServerKits(); // register kit content specs + layer policy (export filter)

  const existing = (await listSources(vault)).find((s) => s.title === TITLE);
  const source = existing ?? (await ingestHtmlSource(vault, { title: TITLE, content: SOURCE_HTML, createdBy: "system" }));
  const ownedLayer = await ensureOwnedLayer(vault, source);

  // Seed the four Study Block types once (idempotent across re-runs).
  const already = (await vault.stores.notes.list()).filter(
    (n) => n.layerId === ownedLayer.id && n.contentType.startsWith("textbook.")
  );
  if (already.length === 0) {
    const notes: NoteRecord[] = [
      makeNote(source.id, ownedLayer.id, "textbook.explanation", {
        title: "What the cell membrane does",
        level: "standard",
        explanation: "The membrane is a selective barrier: it decides what gets in and out.",
        analogy: "Like a bouncer at a club checking who may enter.",
        keyPoints: ["Selective barrier", "Controls transport"],
        commonMisunderstandings: ["It is not a solid wall"]
      }),
      makeNote(source.id, ownedLayer.id, "textbook.exercise", {
        question: "What is the main role of the cell membrane?",
        type: "single-choice",
        options: ["Energy production", "Selective barrier", "Storing DNA"],
        answer: "Selective barrier",
        explanation: "It regulates what enters and leaves the cell.",
        difficulty: "easy",
        relatedKnowledgePoints: ["transport"]
      }),
      // Mistake — PRIVATE; the policy must keep this out of the exported pack.
      makeNote(source.id, ownedLayer.id, "textbook.mistake", {
        question: "What is the main role of the cell membrane?",
        wrongAnswer: "Energy production",
        correctAnswer: "Selective barrier",
        mistakeReason: "Confused the membrane with the mitochondria.",
        retryCount: 1,
        mastery: "weak"
      }),
      makeNote(source.id, ownedLayer.id, "textbook.review-pack", {
        title: "Review Pack: The Cell",
        scope: { sourceId: source.id },
        summary: "Membrane = selective barrier; mitochondria = ATP.",
        keyPoints: ["Membrane controls transport"],
        weakPoints: ["Membrane vs mitochondria"],
        flashcards: [{ front: "Cell membrane role?", back: "Selective barrier" }],
        exercises: []
      })
    ];
    for (const note of notes) await vault.stores.notes.upsert(note);
  }

  // Export the owned layer → a teacher-shareable pack (policy strips mistakes).
  const pack = await buildStudyPack(vault, ownedLayer.id);
  if (!pack) throw new Error("export failed: no pack built");

  const exportedTypes = pack.notes.map((n) => n.contentType);
  const hasMistake = exportedTypes.includes("textbook.mistake");
  if (hasMistake) throw new Error("PROPAGATION POLICY FAILED: exported pack contains a textbook.mistake note");

  const outDir = path.resolve(process.cwd(), "docs", "samples");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "teacher-layer.studypack");
  await writeFile(outPath, JSON.stringify(pack, null, 2), "utf8");

  console.log("Textbook Kit smoke ready.");
  console.log(`  vault:        ${rootDir}`);
  console.log(`  source:       ${source.title}  [${source.id}]`);
  console.log(`  teacher pack: ${outPath}`);
  console.log(`  exported note types: ${exportedTypes.join(", ") || "(none)"}`);
  console.log("  ✓ policy check: textbook.mistake EXCLUDED from the exported teacher pack.");
  console.log("");
  console.log("Manual MVP loop (user spec §16) in the running client:");
  console.log(`  1. Open "${TITLE}". Select a passage → toolbar "Explain"  → an Explanation Study Block.`);
  console.log("  2. Select a passage → toolbar \"Practice\"               → an Exercise (Practice) block.");
  console.log("  3. Select a passage → toolbar \"Mistake\"                → a Mistake block (stays PRIVATE).");
  console.log("  4. Top of the study panel → \"Review Pack\"             → a chapter Review Pack block.");
  console.log("  5. Right-most Layers pane → Export the owned layer       → a teacher .studypack (no mistakes).");
  console.log(`  6. Layers pane → "Import Layer" → pick ${path.relative(process.cwd(), outPath)} → preview → Import.`);
  console.log("  7. Confirm the imported layer has Explanation/Practice/Review-Pack but NO Mistake block.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
