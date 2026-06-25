// CommandRegistry — user actions registered as commands instead of being inlined
// in components. The same command definition can back the composer buttons, a
// selection menu, a command palette, or an AI action list. Commands collaborate
// with the rest of the app only through the FocusContext, the EntityClient, and
// the small `actions` surface the host wires in — never by reaching into nodes.

import type {
  ChatContext,
  ChatMessage,
  ConceptRecord,
  EntityClient,
  NodeRef,
  NoteRecord,
  PatchRecord,
  RelationRecord
} from "../data/entityClient";
import type { FocusContextValue } from "../focus/FocusContext";

export type CommandActions = {
  onNoteCreated?(note: NoteRecord): void;
  onPatchCreated?(patch: PatchRecord): void;
  onChatHistory?(messages: ChatMessage[]): void;
  onAssistantMessage?(message: ChatMessage): void;
  /** A concept was created or a note↔concept link changed. */
  onConceptChanged?(concept?: ConceptRecord): void;
  /** A relation was created or deleted. */
  onRelationChanged?(relation?: RelationRecord): void;
  /** A study layer changed (toggled / imported) — reload the list + repaint anchors. */
  onLayersChanged?(): void;
};

export type CommandContext = {
  focus: FocusContextValue;
  client: Pick<
    EntityClient,
    | "createNote"
    | "createPatch"
    | "chat"
    | "createConcept"
    | "updateNote"
    | "createRelation"
    | "patchLayer"
    | "generateStructured"
    | "notes"
  >;
  /** The source the user is currently reading, if any. */
  sourceId?: string;
  /** Per-invocation inputs (composer text, patch body, concept/relation fields…). */
  payload: {
    text?: string;
    contentType?: string;
    /**
     * Structured note content (object) for non-text note types (flashcard, quiz,
     * image, …). When present it is the note's content verbatim and takes
     * precedence over `text` (which is the markdown/plain-text path). The core spec
     * for `contentType` has already validated it client-side before dispatch.
     */
    content?: unknown;
    newContent?: string;
    oldText?: string;
    // —— concept / relation ——
    /** New concept name (concept.create). */
    conceptName?: string;
    /** New concept description (concept.create). */
    conceptDescription?: string;
    /** The note to (un)link (concept.link-note). */
    noteId?: string;
    /** Its current concept links, so link-note can append without dropping others. */
    noteConceptIds?: string[];
    /** The concept a note is linked to / a relation endpoint (concept.link-note, relation.create). */
    conceptId?: string;
    /** relation.create endpoints + kind. */
    fromConceptId?: string;
    toConceptId?: string;
    relationKind?: string;
    relationLabel?: string;
    // —— study layer ——
    /** The layer to toggle (layer.toggle). */
    layerId?: string;
    /** The layer's next enabled state (layer.toggle). */
    enabled?: boolean;
  };
  /** Current chat history (for ask-ai). */
  chatMessages?: ChatMessage[];
  /** Where/what the assistant is answering about. */
  chatContext?: ChatContext;
  actions: CommandActions;
};

const conceptRef = (id: string): NodeRef => ({ type: "concept", id });

export type Command = {
  id: string;
  title: string;
  group?: string;
  isAvailable(ctx: CommandContext): boolean;
  run(ctx: CommandContext): Promise<void> | void;
};

const askAi: Command = {
  id: "anchor.ask-ai",
  title: "Ask AI",
  group: "anchor",
  isAvailable: (ctx) => !!ctx.payload.text?.trim() && !!ctx.sourceId,
  run: async (ctx) => {
    const text = ctx.payload.text?.trim();
    if (!text) return;
    const history: ChatMessage[] = [...(ctx.chatMessages ?? []), { role: "user", content: text }];
    ctx.actions.onChatHistory?.(history);
    const { message } = await ctx.client.chat({ messages: history, context: ctx.chatContext });
    ctx.actions.onAssistantMessage?.(message);
  }
};

// True when the payload carries note content — either non-empty text (the
// markdown/plain-text path) or a defined structured `content` object (flashcard,
// quiz, image, …). Structured editors always supply `content`, even when "empty"
// (e.g. a blank flashcard), so its mere presence is what enables Save.
const hasNoteContent = (payload: CommandContext["payload"]): boolean =>
  payload.content !== undefined || !!payload.text?.trim();

const addNote: Command = {
  id: "anchor.add-note",
  title: "Add Note",
  group: "anchor",
  // A note can be anchored or standalone, so a source OR a focus is enough.
  isAvailable: (ctx) =>
    hasNoteContent(ctx.payload) && (!!ctx.sourceId || !!ctx.focus.anchor || !!ctx.focus.draft),
  run: async (ctx) => {
    if (!hasNoteContent(ctx.payload)) return;
    // Structured content (object) wins; otherwise the note is the trimmed text.
    const content = ctx.payload.content !== undefined ? ctx.payload.content : ctx.payload.text?.trim();
    if (content === undefined) return;
    // Materialize the current selection into an anchor if there is one (else save
    // the note unanchored).
    const anchor = await ctx.focus.materializeAnchor();
    const { note } = await ctx.client.createNote({
      sourceId: ctx.sourceId,
      anchorIds: anchor ? [anchor.id] : [],
      contentType: ctx.payload.contentType ?? "markdown",
      content
    });
    ctx.actions.onNoteCreated?.(note);
  }
};

const createPatch: Command = {
  id: "anchor.create-patch",
  title: "Create Patch",
  group: "anchor",
  isAvailable: (ctx) =>
    !!ctx.payload.newContent?.trim() && !!ctx.sourceId && (!!ctx.focus.anchor || !!ctx.focus.draft),
  run: async (ctx) => {
    const newContent = ctx.payload.newContent?.trim();
    if (!newContent || !ctx.sourceId) return;
    const anchor = await ctx.focus.materializeAnchor();
    if (!anchor) return;
    const { patch } = await ctx.client.createPatch({
      sourceId: ctx.sourceId,
      anchorId: anchor.id,
      oldText: ctx.payload.oldText ?? "",
      newContent
    });
    ctx.actions.onPatchCreated?.(patch);
  }
};

// —— Concept / Relation (manual) —————————————————————————————————————————
// These are the manual P5 actions. They collaborate only through the entity client
// + the action callbacks, exactly like the anchor commands.

const createConcept: Command = {
  id: "concept.create",
  title: "New Concept",
  group: "concept",
  isAvailable: (ctx) => !!ctx.payload.conceptName?.trim(),
  run: async (ctx) => {
    const name = ctx.payload.conceptName?.trim();
    if (!name) return;
    const description = ctx.payload.conceptDescription?.trim();
    const { concept } = await ctx.client.createConcept({
      name,
      description: description || undefined
    });
    ctx.actions.onConceptChanged?.(concept);
  }
};

const linkNote: Command = {
  id: "concept.link-note",
  title: "Link Note to Concept",
  group: "concept",
  // Needs a note to link and a concept to link it to.
  isAvailable: (ctx) => !!ctx.payload.noteId && !!ctx.payload.conceptId,
  run: async (ctx) => {
    const { noteId, conceptId } = ctx.payload;
    if (!noteId || !conceptId) return;
    // Append to the note's existing concept links (idempotent — don't duplicate).
    const current = ctx.payload.noteConceptIds ?? [];
    const next = current.includes(conceptId) ? current : [...current, conceptId];
    await ctx.client.updateNote(noteId, { conceptIds: next });
    ctx.actions.onConceptChanged?.();
  }
};

const createRelation: Command = {
  id: "relation.create",
  title: "Create Relation",
  group: "relation",
  // Two distinct concepts + a relation kind (no self-relations).
  isAvailable: (ctx) =>
    !!ctx.payload.fromConceptId &&
    !!ctx.payload.toConceptId &&
    ctx.payload.fromConceptId !== ctx.payload.toConceptId &&
    !!ctx.payload.relationKind,
  run: async (ctx) => {
    const { fromConceptId, toConceptId, relationKind, relationLabel } = ctx.payload;
    if (!fromConceptId || !toConceptId || !relationKind || fromConceptId === toConceptId) return;
    const { relation } = await ctx.client.createRelation({
      from: conceptRef(fromConceptId),
      to: conceptRef(toConceptId),
      relationKind,
      label: relationLabel?.trim() || undefined
    });
    ctx.actions.onRelationChanged?.(relation);
  }
};

// —— Study Layer ————————————————————————————————————————————————————————
// Toggling a layer's `enabled` flips whether its anchors are painted. Export and the
// two-step file import live in the layer.switcher view (file IO + an interactive
// preview), mirroring how URL-import / file dialogs are view/context actions, not
// commands. The shared `onLayersChanged` action reloads the list + repaints anchors.
const toggleLayer: Command = {
  id: "layer.toggle",
  title: "Toggle Layer",
  group: "layer",
  isAvailable: (ctx) => !!ctx.payload.layerId && typeof ctx.payload.enabled === "boolean",
  run: async (ctx) => {
    const { layerId, enabled } = ctx.payload;
    if (!layerId || typeof enabled !== "boolean") return;
    await ctx.client.patchLayer(layerId, { enabled });
    ctx.actions.onLayersChanged?.();
  }
};

const registry = new Map<string, Command>();

export function registerCommand(command: Command): void {
  registry.set(command.id, command);
}

export function getCommand(id: string): Command | undefined {
  return registry.get(id);
}

export function listCommands(): readonly Command[] {
  return Array.from(registry.values());
}

/** Run a command by id if it is available; returns whether it ran. */
export async function runCommand(id: string, ctx: CommandContext): Promise<boolean> {
  const command = registry.get(id);
  if (!command || !command.isAvailable(ctx)) return false;
  await command.run(ctx);
  return true;
}

for (const command of [askAi, addNote, createPatch, createConcept, linkNote, createRelation, toggleLayer])
  registerCommand(command);
