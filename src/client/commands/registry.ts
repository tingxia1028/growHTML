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

// A unit of AI output BEFORE it is persisted: the prompt/contentType it came from,
// the input that produced it, the generated `content`, and the anchor/source it
// should attach to on Save. Hosts that wire `onGenerated` divert generation into a
// preview stage instead of auto-saving a note (see the kit AI commands).
export type GeneratedDraft = {
  promptId: string;
  contentType: string;
  input: Record<string, unknown>;
  content: unknown;
  anchorId?: string;
  sourceId?: string;
};

export type CommandActions = {
  onNoteCreated?(note: NoteRecord): void;
  /** A draft was generated (preview stage): the host shows it, Save persists later. */
  onGenerated?(draft: GeneratedDraft): void;
  onPatchCreated?(patch: PatchRecord): void;
  onChatHistory?(messages: ChatMessage[]): void;
  onAssistantMessage?(message: ChatMessage): void;
  /** A streamed delta of the assistant's reply (progressive render). */
  onAssistantChunk?(delta: string): void;
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
    | "createLayer"
    | "deleteLayer"
    | "generateStructured"
    | "notes"
  > &
    // Streaming chat is optional so hosts/tests that only wire `chat` still satisfy
    // the context; `askAi` feature-detects it and falls back to `chat`.
    Partial<Pick<EntityClient, "chatStream">>;
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
    /**
     * Explicit anchor ids to attach the note to, bypassing focus materialization.
     * Used by the generation-preview Save: the generating command already created
     * the anchor, so Save reuses it instead of materializing a duplicate. When
     * present (even as []) it OVERRIDES the materialize-from-focus path.
     */
    anchorIds?: string[];
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
    /** The note whose layer membership to set (note.set-layers). */
    layerNoteId?: string;
    /** The note's next FULL layer membership (note.set-layers — add/remove/move). */
    layerIds?: string[];
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
    // Prefer streaming when the host wired both a stream client and a chunk sink;
    // the progressive deltas build the assistant message as they arrive. If the
    // stream produced no deltas (endpoint unavailable → chatStream fell back to a
    // single non-streaming reply), append the final message instead.
    const onChunk = ctx.actions.onAssistantChunk;
    if (ctx.client.chatStream && onChunk) {
      let streamed = false;
      const { message } = await ctx.client.chatStream(
        { messages: history, context: ctx.chatContext },
        (delta) => {
          streamed = true;
          onChunk(delta);
        }
      );
      if (!streamed) ctx.actions.onAssistantMessage?.(message);
      return;
    }
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
    // Explicit anchorIds (from the generation-preview Save) win and SKIP focus
    // materialization — the generating command already created the anchor, so we
    // attach to it rather than materializing a duplicate. Otherwise materialize the
    // current selection into an anchor if there is one (else save unanchored).
    let anchorIds: string[];
    if (ctx.payload.anchorIds !== undefined) {
      anchorIds = ctx.payload.anchorIds;
    } else {
      const anchor = await ctx.focus.materializeAnchor();
      anchorIds = anchor ? [anchor.id] : [];
    }
    const { note } = await ctx.client.createNote({
      sourceId: ctx.sourceId,
      anchorIds,
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

// Set a note's FULL layer membership (the "move / add to layer" note action). The
// payload's `layerIds` REPLACES the note's membership, so the caller decides add vs
// remove vs move by sending the resulting set. Reuses the note-patch path used for
// concept/anchor links; `onLayersChanged` reloads the switcher + repaints anchors
// (painting is derived from notes' layers).
const setNoteLayers: Command = {
  id: "note.set-layers",
  title: "Set Note Layers",
  group: "layer",
  isAvailable: (ctx) => !!ctx.payload.layerNoteId && Array.isArray(ctx.payload.layerIds),
  run: async (ctx) => {
    const { layerNoteId, layerIds } = ctx.payload;
    if (!layerNoteId || !Array.isArray(layerIds)) return;
    await ctx.client.updateNote(layerNoteId, { layerIds });
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

for (const command of [askAi, addNote, createPatch, createConcept, linkNote, createRelation, toggleLayer, setNoteLayers])
  registerCommand(command);
