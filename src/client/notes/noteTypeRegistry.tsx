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
import type { LocalizedText } from "../i18n";
import {
  getNoteContentSpec,
  resolveNoteContentTypeAlias,
  type NoteContentSpec
} from "../../core/notes/contentTypes";
import type { NoteRecord } from "../data/entityClient";

// What a renderer is handed: the parsed `content` (already validated by the core
// spec before it was stored), the whole note (for ids / attachments), an optional
// render context the host can thread through (unused by built-ins today), and an
// optional `mode`.
//
// `mode` lets the SAME plugin render two presentations through the ONE
// getNoteType(contentType).render(...) path (design plan §3.5 / decision §6.6 — no
// second render path):
//   • "full" (default) — today's behavior: the complete, interactive view a saved
//     note uses (the note list, the generation preview, and the FocusOverlay all
//     pass "full").
//   • "card"           — a lightweight/preview presentation for the ArtifactCard
//     (a thumbnail / first-screen / scaled-or-truncated view). A plugin MAY opt into
//     a nicer card; if it ignores `mode` (most built-ins) the shared GENERIC card
//     fallback (ArtifactCard) supplies a title + snippet so every contentType gets a
//     card for free without bypassing the registry.
export type NoteRenderMode = "card" | "full";

// An optional render context the HOST threads through render() (design §3.5 — a typed
// escape hatch, not a new render path). Today its one field is `initialFace`: the review
// reveal surface passes `"back"` so an interactive FlipCard (flashcard/vocab full) opens
// straight on its ANSWER face — no second manual flip (N4-D7 wrinkle). It only seeds the
// starting face; the card still flips freely. Absent (every non-review render) = front.
export type NoteRenderCtx = {
  /** The face an interactive flip-card should OPEN on. Absent = its natural front. */
  initialFace?: "front" | "back";
  /** Host action: open/import a local file path inside Growte when available. */
  openLocalFile?: (filePath: string) => Promise<void> | void;
};

export type NoteRenderInput = {
  content: unknown;
  note?: NoteRecord;
  ctx?: NoteRenderCtx;
  /** "full" (default) = the complete interactive view; "card" = a compact preview. */
  mode?: NoteRenderMode;
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
  label?: LocalizedText;
  /** Natural display name for the slash palette / list surfaces — 中文 for the
      built-ins (e.g. quiz → "小测"). ADDITIVE + optional (slash-composer §2): the
      adapter falls back to `contentType` when absent, so nothing existing changes. */
  title?: LocalizedText;
  /** Extra slash-palette match keys: 中文 synonyms + English shorthands (e.g.
      quiz → ["判断题", "选择题"]). The contentType itself always matches — never
      repeat it here. Optional; absent = the id/title alone match. */
  aliases?: string[];
  /** Optional glyph STRING for palette rows. Absent (all built-ins) → surfaces fall
      back to the central noteTypeIcon map, so the type keeps ONE icon everywhere. */
  icon?: string;
  /** Hide this type from the composer's generic type picker. Used by types that are
      created only through a dedicated affordance (e.g. `bookmark` via the bookmark.add
      command, which materializes the anchor) — so they aren't authored anchor-less from
      the generic composer. Rendering/editing through the registry is unaffected. */
  hidden?: boolean;
  /** Opt this type into the centered FocusOverlay "Open interactively" affordance in the
      note viewer (it has a richer/interactive full view worth focusing — e.g. an
      interactive html game). A REGISTRY capability flag so the host never branches on
      contentType to decide focusability (design law §0.5-B / contract guard). Diagram
      types are focusable via the diagram registry; this flag covers the rest. */
  focusable?: boolean;
  /** Dup-registration precedence for the exclusive `contentType` slot (design
      plugin-viewer-model §4/§6.1). Higher wins; default 0. A kit that wants to OVERRIDE
      a built-in renderer (e.g. swap the default markdown view) declares a higher priority.
      Equal priority = last-wins + a warning. */
  priority?: number;
  /** The owning plugin/kit id, threaded through for the equal-priority warning (so it
      names WHICH plugins collided) and for the manager panel. Absent for built-ins. */
  pluginId?: string;
};

// Each slot remembers the WINNING plugin's priority so a later, lower-priority
// registration can be rejected without keeping a full history.
const registry = new Map<string, NoteTypePlugin>();

/**
 * Register (or contest) the renderer for a `contentType` — the EXCLUSIVE note-type slot.
 * Free key (nothing registered yet) → bare set as before. Contested key → compare
 * `priority` (default 0): higher wins, lower is ignored, and on an EQUAL priority the
 * later registration wins (last-wins) with a console.warn naming both plugin ids (design
 * §4 precedence chain; §6.1 "last-wins + 警告"). This keeps the slot deterministic while
 * letting a kit deliberately override a built-in with a higher priority.
 */
export function registerNoteType(plugin: NoteTypePlugin): void {
  const existing = registry.get(plugin.contentType);
  if (!existing) {
    registry.set(plugin.contentType, plugin);
    return;
  }
  const incomingPriority = plugin.priority ?? 0;
  const existingPriority = existing.priority ?? 0;
  if (incomingPriority > existingPriority) {
    registry.set(plugin.contentType, plugin);
    return;
  }
  if (incomingPriority < existingPriority) {
    // A lower-priority registration loses to the higher-priority winner already in place.
    return;
  }
  // Equal priority → last-wins, but warn so the collision is visible in dev/CI.
  const who = (p: NoteTypePlugin) => p.pluginId ?? "(unknown)";
  console.warn(
    `[noteTypeRegistry] duplicate registration for contentType "${plugin.contentType}" ` +
      `at equal priority (${incomingPriority}): "${who(plugin)}" overrides "${who(existing)}" (last-wins).`
  );
  registry.set(plugin.contentType, plugin);
}

/** Test hook — clear the note-type registry so a spec starts from empty. */
export function resetNoteTypes(): void {
  registry.clear();
}

export function getNoteType(contentType: string): NoteTypePlugin | undefined {
  const direct = registry.get(contentType);
  if (direct) return direct;
  // Alias-aware fallback (REV-CORE): a legacy persisted id (e.g. "textbook.mistake")
  // renders through its canonical spec's plugin — a DIRECT registration always wins.
  const alias = resolveNoteContentTypeAlias(contentType);
  return alias ? registry.get(alias) : undefined;
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
