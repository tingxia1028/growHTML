// CommandRegistry — user actions registered as commands instead of being inlined
// in components. The same command definition can back the composer buttons, a
// selection menu, a command palette, or an AI action list. Commands collaborate
// with the rest of the app only through the FocusContext, the EntityClient, and
// the small `actions` surface the host wires in — never by reaching into nodes.

import type {
  ChatContext,
  ChatMessage,
  EntityClient,
  NoteRecord,
  PatchRecord
} from "../data/entityClient";
import type { FocusContextValue } from "../focus/FocusContext";

export type CommandActions = {
  onNoteCreated?(note: NoteRecord): void;
  onPatchCreated?(patch: PatchRecord): void;
  onChatHistory?(messages: ChatMessage[]): void;
  onAssistantMessage?(message: ChatMessage): void;
};

export type CommandContext = {
  focus: FocusContextValue;
  client: Pick<EntityClient, "createNote" | "createPatch" | "chat">;
  /** The source the user is currently reading, if any. */
  sourceId?: string;
  /** Per-invocation inputs (composer text, patch body, …). */
  payload: {
    text?: string;
    contentType?: string;
    newContent?: string;
    oldText?: string;
  };
  /** Current chat history (for ask-ai). */
  chatMessages?: ChatMessage[];
  /** Where/what the assistant is answering about. */
  chatContext?: ChatContext;
  actions: CommandActions;
};

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

const addNote: Command = {
  id: "anchor.add-note",
  title: "Add Note",
  group: "anchor",
  // A note can be anchored or standalone, so a source OR a focus is enough.
  isAvailable: (ctx) =>
    !!ctx.payload.text?.trim() && (!!ctx.sourceId || !!ctx.focus.anchor || !!ctx.focus.draft),
  run: async (ctx) => {
    const text = ctx.payload.text?.trim();
    if (!text) return;
    // Materialize the current selection into an anchor if there is one (else save
    // the note unanchored).
    const anchor = await ctx.focus.materializeAnchor();
    const { note } = await ctx.client.createNote({
      sourceId: ctx.sourceId,
      anchorIds: anchor ? [anchor.id] : [],
      contentType: ctx.payload.contentType ?? "markdown",
      content: text
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

for (const command of [askAi, addNote, createPatch]) registerCommand(command);
