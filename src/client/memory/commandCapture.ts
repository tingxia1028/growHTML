// runCommand → learner-memory bridge (MEM-1). An EXPLICIT whitelist maps command ids
// onto the CLOSED core verb enum (learner-memory.md §3) — an unmapped command records
// NOTHING (the enum never stretches to fit a command). Deliberately unmapped:
// anchor.create-patch, concept.create, relation.create, layer.toggle — none of them is
// honestly a note/AI verb, and patch/concept/relation/filter verbs don't exist in the
// closed set. Hardcoding the textbook kit's four generate commands here is a MEM-1
// stopgap; MEM-3's registerBehaviorTaxonomy moves kit knowledge back into kits.

import { BOOKMARK_CONTENT_TYPE } from "../../core/notes/contentTypes";
import type { CommandContext } from "../commands/registry";
import type { MemorySubject, MemoryVerb } from "../data/entityClient";
import { recordMemoryEvent } from "./capture";

type CommandCaptureRule = {
  verb: MemoryVerb;
  /** Disambiguates flavors sharing a verb (rides payload.action, e.g. note.edit). */
  action?: string;
  /** Static output contentType when the command always produces one. */
  contentType?: string;
};

export const commandVerbWhitelist: Readonly<Record<string, CommandCaptureRule>> = {
  // —— AI asks / generations ——
  "anchor.ask-ai": { verb: "ai.ask" },
  "note.generate-block": { verb: "ai.generate" },
  "operation.run": { verb: "ai.generate" },
  "textbook.explain-concept": { verb: "ai.generate", contentType: "textbook.explanation" },
  "textbook.generate-practice": { verb: "ai.generate", contentType: "textbook.exercise" },
  "textbook.mark-as-mistake": { verb: "ai.generate", contentType: "textbook.mistake" },
  "textbook.generate-review-pack": { verb: "ai.generate", contentType: "textbook.review-pack" },
  // —— Note creation ——
  "anchor.add-note": { verb: "note.create" },
  "bookmark.add": { verb: "note.create", action: "bookmark", contentType: BOOKMARK_CONTENT_TYPE },
  // —— Note mutation (all run through updateNote/deleteNote on an existing note) ——
  "note.edit": { verb: "note.edit", action: "edit" },
  "note.delete": { verb: "note.edit", action: "delete" },
  "note.set-layers": { verb: "note.edit", action: "set-layers" },
  "note.link-anchor": { verb: "note.edit", action: "link-anchor" },
  "concept.link-note": { verb: "note.edit", action: "link-concept" }
};

/**
 * Queue a memory event for a command that JUST ran successfully; unmapped command
 * ids are ignored. Subject comes from the dispatch-time CommandContext: the active
 * source, the anchor in focus (a draft materialized DURING the command isn't visible
 * on this snapshot — acceptable MEM-1 fidelity), and the payload's note/concept ids.
 */
export function recordCommandMemory(commandId: string, ctx: CommandContext): void {
  const rule = commandVerbWhitelist[commandId];
  if (!rule) return;

  const subject: MemorySubject = {};
  if (ctx.sourceId) subject.sourceId = ctx.sourceId;
  if (ctx.focus.anchor?.id) subject.anchorId = ctx.focus.anchor.id;
  const noteId = ctx.payload.noteId ?? ctx.payload.layerNoteId;
  if (noteId) subject.noteId = noteId;
  if (ctx.payload.conceptId) subject.conceptId = ctx.payload.conceptId;
  const contentType = rule.contentType ?? ctx.payload.contentType ?? ctx.payload.outputType;
  if (contentType) subject.contentType = contentType;

  const payload: Record<string, unknown> = { commandId };
  if (rule.action) payload.action = rule.action;
  if (commandId === "operation.run" && ctx.payload.operationId) payload.promptId = ctx.payload.operationId;

  recordMemoryEvent(rule.verb, subject, payload);
}
