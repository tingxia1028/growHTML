// NoteTypeRegistry — the CLIENT half of a note type. It pairs with the core
// `NoteContentSpec` (src/core/notes/contentTypes.ts), which owns the React-free
// half: the zod `schema`, `createDefault()`, and `toSearchText()`. A client plugin
// adds the two React halves on top:
//
//   • render(input) — how a SAVED note of this type is shown (in the note list).
//   • edit(input)   — the composer editor that authors a note's structured content.
//
// The split is deliberate (redesign §6 / P4): note CONTENT (validated by the core
// spec) is decoupled from its EDITOR and its RENDERER. Adding a note type = register
// one core spec + one client plugin; nothing in App/Workspace changes.
//
// IRON LAW: a plugin must NOT redefine the schema — it imports the core spec via
// `spec()` so validation/defaults live in exactly one place (server + client share
// the core spec; only the React lives here).

import type { ReactNode } from "react";
import {
  getNoteContentSpec,
  type NoteContentSpec
} from "../../core/notes/contentTypes";
import type { NoteRecord } from "../data/entityClient";

// What a renderer is handed: the parsed `content` (already validated by the core
// spec before it was stored), the whole note (for ids / attachments), and an
// optional render context the host can thread through (unused by built-ins today).
export type NoteRenderInput = {
  content: unknown;
  note?: NoteRecord;
  ctx?: unknown;
};

// What an editor is handed: the current draft `content` (seeded from the spec's
// `createDefault()`), and an `onChange` it calls with the next content on every
// edit. The editor never persists — the composer collects `content` and POSTs it.
export type NoteEditInput = {
  content: unknown;
  onChange(next: unknown): void;
};

export type NoteTypePlugin = {
  contentType: string;
  /** Render a stored note's content for display. */
  render(input: NoteRenderInput): ReactNode;
  /** The editor that authors this type's structured content. */
  edit(input: NoteEditInput): ReactNode;
  /** Optional friendly label for the composer's type picker (defaults to contentType). */
  label?: string;
};

const registry = new Map<string, NoteTypePlugin>();

export function registerNoteType(plugin: NoteTypePlugin): void {
  registry.set(plugin.contentType, plugin);
}

export function getNoteType(contentType: string): NoteTypePlugin | undefined {
  return registry.get(contentType);
}

export function listNoteTypes(): readonly NoteTypePlugin[] {
  return Array.from(registry.values());
}

/**
 * The core spec a plugin pairs with. A plugin owns ONLY the React; this is how it
 * reaches its schema / createDefault / toSearchText without redefining them. Throws
 * if a plugin references a contentType with no registered core spec (a wiring bug).
 */
export function spec(contentType: string): NoteContentSpec {
  const found = getNoteContentSpec(contentType);
  if (!found) throw new Error(`No core NoteContentSpec for contentType: ${contentType}`);
  return found;
}

/** A blank value to seed a new note of this type in the composer editor. */
export function createDefaultContent(contentType: string): unknown {
  return getNoteContentSpec(contentType)?.createDefault();
}

/**
 * Whether this type's content is a plain STRING (markdown, plain-text, mermaid,
 * markmap, …). Decided by the core spec's own default, so it stays correct as
 * types are added. The composer uses it to route string types to the shared text
 * textarea (the `.composer-input` the existing e2e drives) and object types
 * (flashcard, quiz, image, …) to the plugin's structured `edit()` editor.
 */
export function isTextContentType(contentType: string): boolean {
  return typeof getNoteContentSpec(contentType)?.createDefault() === "string";
}
