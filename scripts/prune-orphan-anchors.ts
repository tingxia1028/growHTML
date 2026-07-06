// Maintenance: delete a source's "orphan" anchors — those referenced by NO note and
// NO patch (the same definition the note-delete cascade uses, deleteAnchorsWithoutNotes).
// Run with the dev server STOPPED (it holds the vault in memory and rewrites jsonl on
// upsert, so editing under a live server gets clobbered).
//   npx tsx scripts/prune-orphan-anchors.ts <sourceId|all> [--dry]
import { openVault } from "../src/core/vault";
import { nodeStorage } from "../src/core/storage/nodeStorage";
import { getDefaultVaultRoot } from "../src/server/vaultRoot";

const arg = process.argv[2];
const dry = process.argv.includes("--dry");
if (!arg) {
  console.error("usage: tsx scripts/prune-orphan-anchors.ts <sourceId|all> [--dry]");
  process.exit(1);
}

const vault = await openVault({ rootDir: getDefaultVaultRoot(), storage: nodeStorage });
const [anchors, notes, patches] = await Promise.all([
  vault.stores.anchors.list(),
  vault.stores.notes.list(),
  vault.stores.patches.list()
]);

const referencedByNote = new Set<string>();
for (const note of notes) for (const id of note.anchorIds) referencedByNote.add(id);
const referencedByPatch = new Set(patches.map((p) => p.anchorId));

const inSource = (a: { sourceId: string }) => arg === "all" || a.sourceId === arg;
const scoped = anchors.filter(inSource);
const orphans = scoped.filter((a) => !referencedByNote.has(a.id) && !referencedByPatch.has(a.id));

// Per-anchor breakdown: which notes (and their contentTypes) reference each anchor.
const notesByAnchor = new Map<string, string[]>();
for (const note of notes) {
  for (const id of note.anchorIds) {
    const list = notesByAnchor.get(id) ?? [];
    list.push(note.contentType ?? "markdown");
    notesByAnchor.set(id, list);
  }
}

console.log(`source=${arg}  anchors(scoped)=${scoped.length}  orphans(no note,no patch)=${orphans.length}`);
if (dry) {
  for (const a of scoped) {
    const types = notesByAnchor.get(a.id) ?? [];
    const patch = referencedByPatch.has(a.id) ? " +patch" : "";
    console.log(`  ${a.id}  kind=${(a as { anchorKind?: string }).anchorKind ?? "?"}  notes=[${types.join(",") || "NONE"}]${patch}`);
  }
  for (const a of orphans) console.log("  would delete", a.id, (a as { anchorKind?: string }).anchorKind ?? "");
  console.log("(dry run — nothing deleted)");
} else {
  for (const a of orphans) await vault.stores.anchors.delete(a.id);
  console.log(`deleted ${orphans.length} orphan anchors`);
}
