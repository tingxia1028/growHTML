// SRC-3 — patch APPLY engine (docs/design/source-authoring.md §4). Service level:
//   • accepted/pending → applied verifies oldText at the anchor, then REWRITES the
//     stored source content THROUGH the SRC-2 pipeline (re-hash → revision bump →
//     re-project anchors) and stamps appliedAt.
//   • oldText drift → conflict (persisted), NOT applied — the stored bytes are untouched.
//   • reverted restores the pre-apply bytes and stamps revertedAt.
//   • the apply/revert clock is injectable (deterministic appliedAt/revertedAt).
// The engine works on IMPORTED sources — patches are the sanctioned imported-source
// edit route (§3), distinct from the authored-only updateAuthoredSource.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHtmlSelectionAnchor } from "../../adapters/html/anchor";
import { readSourceContent } from "../../core/store/sources";
import { type HtmlSelectionAnchor } from "../../core/schema";
import { type StudyVault } from "../../core/vault";
import { openTestVault } from "../../core/testing/openTestVault";
import { ConflictError } from "./errors";
import { createPatch, updatePatchStatus } from "./patches";
import { ingestHtml, renderSource } from "./sources";

let tempDir = "";
let vault: StudyVault;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "study-vault-patches-"));
  vault = await openTestVault({ rootDir: tempDir });
});

afterEach(async () => {
  vault?.close(); // STORE-SQL Stage-3: release sqlite handles before rm (no-op on jsonl)
  await rm(tempDir, { recursive: true, force: true });
});

const deps = () => ({ vault });
const FIXED = new Date("2026-07-04T12:00:00.000Z");
const clockDeps = () => ({ vault, now: () => FIXED });

const HTML_BODY = [
  "<article>",
  "<p>The mitochondrion is the powerhouse of the cell.</p>",
  "<p>Ribosomes translate messenger RNA into protein.</p>",
  "</article>"
].join("");

// Seed an IMPORTED html source (study ids stamped by ingest) + an html_selection anchor
// bound to the first paragraph, so patches have a real target.
async function seedImportedWithAnchor() {
  const { source } = await ingestHtml(deps(), { title: "Cell biology", content: HTML_BODY });
  const stored = await readSourceContent(vault, source);
  const studyId = /<p data-study-id="([^"]+)">The mitochondrion/.exec(stored)?.[1];
  expect(studyId).toBeTruthy();
  const anchor = createHtmlSelectionAnchor({
    sourceId: source.id,
    studyId: studyId!,
    quote: "The mitochondrion is the powerhouse of the cell.",
    contextBefore: "",
    contextAfter: ""
  });
  await vault.stores.anchors.upsert(anchor);
  return { source, anchor };
}

describe("SRC-3 — apply engine (oldText matches)", () => {
  it("bakes the edit into the STORED content via the SRC-2 pipeline + stamps appliedAt", async () => {
    const { source, anchor } = await seedImportedWithAnchor();
    const patch = await createPatch(deps(), {
      sourceId: source.id,
      anchorId: anchor.id,
      action: "replace_selection",
      oldText: "The mitochondrion is the powerhouse of the cell.",
      newContent: '<p data-study-id="p-cell">Updated mitochondrion text.</p>'
    });

    const applied = await updatePatchStatus(clockDeps(), { patchId: patch.id, status: "applied" });
    expect(applied.status).toBe("applied");
    expect(applied.appliedAt).toBe(FIXED.toISOString());

    // The rewrite went to STORAGE (not just render-time materialization).
    const reloaded = await vault.stores.sources.get(source.id);
    expect(reloaded?.revision).toBe(2); // pipeline bumped the revision
    expect(reloaded?.contentHash).not.toBe(source.contentHash); // re-hashed
    const stored = await readSourceContent(vault, reloaded!);
    expect(stored).toContain("Updated mitochondrion text.");
    expect(stored).not.toContain("powerhouse of the cell");

    // renderSource does NOT double-apply an already-baked patch.
    const rendered = await renderSource(deps(), { sourceId: source.id });
    expect(rendered.content).toContain("Updated mitochondrion text.");
    expect((rendered.content.match(/Updated mitochondrion text\./g) ?? []).length).toBe(1);
  });

  it("re-projects the source's anchors on apply (they follow the rewritten content)", async () => {
    const { source, anchor } = await seedImportedWithAnchor();
    // A second anchor on the UNTOUCHED paragraph must stay matched after apply.
    const stored = await readSourceContent(vault, source);
    const otherStudyId = /<p data-study-id="([^"]+)">Ribosomes/.exec(stored)?.[1];
    const otherAnchor = createHtmlSelectionAnchor({
      sourceId: source.id,
      studyId: otherStudyId!,
      quote: "Ribosomes translate messenger RNA into protein."
    });
    await vault.stores.anchors.upsert(otherAnchor);

    const patch = await createPatch(deps(), {
      sourceId: source.id,
      anchorId: anchor.id,
      action: "replace_selection",
      oldText: "The mitochondrion is the powerhouse of the cell.",
      newContent: '<p data-study-id="p-cell">Chloroplasts capture light energy.</p>'
    });
    await updatePatchStatus(deps(), { patchId: patch.id, status: "applied" });

    // The untouched-paragraph anchor re-projected as matched against the new content.
    const savedOther = (await vault.stores.anchors.list()).find(
      (a) => a.id === otherAnchor.id
    ) as HtmlSelectionAnchor;
    expect(savedOther.matchStatus).toBe("matched");
    const newStored = await readSourceContent(vault, (await vault.stores.sources.get(source.id))!);
    expect(newStored).toContain(`data-study-id="${savedOther.studyId}"`);
  });
});

describe("SRC-3 — conflict (oldText drifted)", () => {
  it("flips to conflict and does NOT rewrite the stored content", async () => {
    const { source, anchor } = await seedImportedWithAnchor();
    const patch = await createPatch(deps(), {
      sourceId: source.id,
      anchorId: anchor.id,
      action: "replace_selection",
      // The anchored paragraph no longer contains this text → drift.
      oldText: "text that is no longer present at the anchor",
      newContent: "<p>should never land</p>"
    });

    await expect(updatePatchStatus(deps(), { patchId: patch.id, status: "applied" })).rejects.toBeInstanceOf(
      ConflictError
    );

    // The record was flipped to conflict (persisted side effect)…
    const reloaded = await vault.stores.patches.get(patch.id);
    expect(reloaded?.status).toBe("conflict");
    // …and the stored source is byte-for-byte untouched (revision unchanged, not applied).
    const reloadedSource = await vault.stores.sources.get(source.id);
    expect(reloadedSource?.revision).toBe(1);
    await expect(readSourceContent(vault, reloadedSource!)).resolves.toContain("powerhouse of the cell");
    expect(reloadedSource?.contentHash).toBe(source.contentHash);
  });

  it("carries { patch, conflict } on the ConflictError body (no `error` field)", async () => {
    const { source, anchor } = await seedImportedWithAnchor();
    const patch = await createPatch(deps(), {
      sourceId: source.id,
      anchorId: anchor.id,
      action: "replace_selection",
      oldText: "drifted text",
      newContent: "<p>x</p>"
    });
    try {
      await updatePatchStatus(deps(), { patchId: patch.id, status: "applied" });
      throw new Error("expected a conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictError);
      const body = (error as ConflictError).body as { patch: { status: string }; conflict: { reason: string } };
      expect(body.patch.status).toBe("conflict");
      expect(body.conflict.reason).toBe("text_mismatch");
      expect((body as { error?: string }).error).toBeUndefined();
    }
  });
});

describe("SRC-3 — revert restores the prior bytes", () => {
  it("reverts stored content byte-for-byte and stamps revertedAt", async () => {
    const { source, anchor } = await seedImportedWithAnchor();
    const before = await readSourceContent(vault, source);
    const beforeHash = source.contentHash;

    const patch = await createPatch(deps(), {
      sourceId: source.id,
      anchorId: anchor.id,
      action: "replace_selection",
      oldText: "The mitochondrion is the powerhouse of the cell.",
      newContent: '<p data-study-id="p-cell">Edited.</p>'
    });
    await updatePatchStatus(deps(), { patchId: patch.id, status: "applied" });
    // Sanity: apply changed the bytes.
    const afterApply = await vault.stores.sources.get(source.id);
    expect(await readSourceContent(vault, afterApply!)).not.toBe(before);

    const reverted = await updatePatchStatus(clockDeps(), { patchId: patch.id, status: "reverted" });
    expect(reverted.status).toBe("reverted");
    expect(reverted.revertedAt).toBe(FIXED.toISOString());

    const afterRevert = await vault.stores.sources.get(source.id);
    await expect(readSourceContent(vault, afterRevert!)).resolves.toBe(before);
    expect(afterRevert?.contentHash).toBe(beforeHash);
  });
});

describe("SRC-3 — state machine guards (preserved)", () => {
  it("rejects an illegal transition (pending → reverted) with a plain ConflictError", async () => {
    const { source, anchor } = await seedImportedWithAnchor();
    const patch = await createPatch(deps(), {
      sourceId: source.id,
      anchorId: anchor.id,
      action: "replace_selection",
      oldText: "x",
      newContent: "<p>y</p>"
    });
    await expect(
      updatePatchStatus(deps(), { patchId: patch.id, status: "reverted" })
    ).rejects.toThrow(/Invalid patch transition/);
  });
});
