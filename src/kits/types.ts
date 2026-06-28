// Product Kit — the plugin-pack seam. A kit is a VERTICAL product (Textbook,
// Research Paper, …) that does NOT invent new core entities; it only REGISTERS a
// bundle into the existing registries (NoteTypeRegistry, CommandRegistry,
// ViewRegistry, layouts, surface contributions) + a domain language map.
//
// Iron law (user spec §15): a Product Kit does not OWN core data structures
// (Source / Anchor / Note / StudyLayer / Workspace) — it owns "the way those
// structures are interpreted". So nothing here changes the core schema; kits use
// domain-prefixed note contentTypes (e.g. `textbook.explanation`) over the existing
// `Note.content = unknown` + `NoteContentSpec`.

import type { ReactNode } from "react";
import type { NoteContentSpec } from "../core/notes/contentTypes";
import type { NoteEditInput, NoteRenderInput } from "../client/notes/noteTypeRegistry";
import type { Command } from "../client/commands/registry";
import type { KitLayerPolicy } from "./policy";

// The React half of a kit note type (the core half is its NoteContentSpec). Same
// shape as a NoteTypePlugin minus `contentType`, which is taken from the spec.
export type KitNoteTypePlugin = {
  render(input: NoteRenderInput): ReactNode;
  edit(input: NoteEditInput): ReactNode;
  /** Friendly label for the composer type picker (defaults to the domain name). */
  label?: string;
};

// Domain language: how the kit RENAMES the generic core vocabulary for its product.
// e.g. Textbook kit: Source→"Textbook", Anchor→"Knowledge Point", Note→"Study Block".
export type KitLanguage = {
  source?: string;
  anchor?: string;
  note?: string;
  layer?: string;
  /** Per-contentType display names (e.g. `textbook.explanation` → "Explanation"). */
  contentTypes?: Record<string, string>;
};

// A kit command IS a host Command (phase 2 wires these into the CommandRegistry).
export type KitCommand = Command;
export type KitView = unknown; // phase 3
export type KitLayout = unknown; // phase 3

// A surface contribution — a command surfaced as a button in a UI slot (e.g. the
// selection toolbar). `commandId` points at a registered Command; the rest is
// presentation (user spec §6).
export type KitSurfaceItem = {
  commandId: string;
  title: string;
  icon?: string;
  group?: string;
  priority?: number;
};

// A prompt-pack entry: builds the LLM prompt for a structured generation and
// carries a deterministic, schema-valid `mockContent` so offline/e2e runs are
// stable (user spec §9). React-free, so the server can use it.
export type KitPrompt<Input = Record<string, unknown>> = {
  id: string;
  /** The note contentType this prompt's output must validate against. */
  outputType: string;
  build(input: Input): string;
  /** Deterministic valid sample the mock provider echoes (real providers ignore). */
  mockContent?(input: Input): unknown;
  /**
   * OPTIONAL placeholder params a built-in prompt's `build()` already reads (e.g.
   * grade/difficulty/language). They advertise which keys the per-vault
   * `operation-prefs.json` may fill — the server merges these values into `input`
   * BEFORE `build()` runs. They NEVER let a user override the固化 prompt body; only
   * the declared placeholders are fillable. React-free (the manager UI reads it).
   */
  params?: {
    name: string;
    label?: string;
    kind?: "grade" | "difficulty" | "language" | "text";
    default?: string;
  }[];
};

// What a kit's `install(ctx)` is handed — typed sinks into the host registries.
export type KitInstallContext = {
  noteTypes: { register(spec: NoteContentSpec, plugin: KitNoteTypePlugin): void };
  language: { register(language: KitLanguage): void };
  commands: { register(command: KitCommand): void };
  views: { register(id: string, view: KitView): void };
  layouts: { register(layout: KitLayout): void };
  surfaces: { contribute(slot: string, items: KitSurfaceItem[]): void };
};

export type ProductKit = {
  id: string;
  name: string;
  description: string;
  // The React-free content specs (server + client both register these so the API
  // can validate the kit's note content). Kept separate from `install` so the
  // SERVER can register them WITHOUT importing the kit's React plugins.
  contentSpecs?: NoteContentSpec[];
  // React-free prompt pack — registered by the SERVER (structured generation runs
  // server-side), like contentSpecs, without importing the kit's React plugins.
  prompts?: KitPrompt[];
  // React-free layer-propagation policy — registered by the SERVER so the export
  // filter can strip private-by-default content types (user spec §11).
  layerPolicy?: KitLayerPolicy;
  // The client-side install: registers note-type plugins, language, commands, and
  // (later) views/layouts/surfaces. Runs only where React is available.
  install(ctx: KitInstallContext): void;
};
