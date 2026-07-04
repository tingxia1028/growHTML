// dispatchSlashEntry (SC-2) — the ONE shared pick→dispatch decision for a slash
// palette entry, extracted verbatim from the SC-1 chat composer's `pickSlashEntry`
// (views.tsx) so the chat AND the toolbar mounts (selection floating toolbar / anchor
// action bar, SC-2) route a pick through IDENTICAL logic. No React, no registry
// imports: the mount supplies its live `dispatch` + `openManualEditor` and the parsed
// instruction; this helper only decides which command fires.
//
// Three branches (locked, mirror slash-composer.md §5):
//   • operation row  → the shipped `operation.run` (operationRunPayload assembles the
//     command id + payload; scope rides on the entry).
//   • noteType, bare (no instruction) → MANUAL: openManualEditor(id) opens the D5
//     floating editor seeded with the type's createDefault().
//   • noteType + instruction → AI: `note.generate-block` with the form-router hint
//     string. The toolbar surfaces (SC-2) never pass an instruction (no mini-composer),
//     so from a toolbar a note-type pick is ALWAYS the manual branch; the instruction
//     path stays chat-only.

import type { SlashEntry } from "./engine";
import { operationRunPayload } from "./operationAdapter";

export type DispatchSlashDeps = {
  /** Run a registered command with its payload (WorkspaceContext.dispatch). */
  dispatch(commandId: string, payload: Record<string, unknown>): Promise<void> | void;
  /** Open the D5 floating editor seeded with a note type's createDefault(). */
  openManualEditor(contentType: string): void;
};

// The form-router hint a `/type + instruction` pick carries — LOCKED string (the
// server's form router reads the picked type as an explicit hint from it). Kept as a
// single builder so the chat mount and any future toolbar mini-composer produce the
// exact same text.
export function generateBlockText(title: string, id: string, instruction: string): string {
  return `以「${title}」(${id}) 的形式：${instruction}`;
}

/**
 * Route a palette pick to its command. `instruction` is the composer remainder after
 * the `/type` query ("" = bare → manual mode); toolbar mounts always pass "".
 *   • operation   → operation.run (operationRunPayload)
 *   • noteType, no instruction → openManualEditor(id)
 *   • noteType + instruction   → note.generate-block(generateBlockText(...))
 */
export function dispatchSlashEntry(entry: SlashEntry, instruction: string, deps: DispatchSlashDeps): void {
  // SC-3: an operation row runs the shipped operation.run (built-in prompt id or op_
  // id both resolve server-side); scope rides on the entry, output stays AUTO.
  if (entry.kind === "operation") {
    const { commandId, payload } = operationRunPayload(entry);
    void deps.dispatch(commandId, payload);
    return;
  }
  if (entry.kind !== "noteType") return;
  // Bare `/type` = MANUAL — open the D5 floating editor seeded with createDefault().
  if (!instruction) {
    deps.openManualEditor(entry.id);
    return;
  }
  // `/type + instruction` = AI — dispatch the form-router generation carrying the
  // picked type as an explicit hint (the draft parks in the same floating editor).
  void deps.dispatch("note.generate-block", { text: generateBlockText(entry.title, entry.id, instruction) });
}
