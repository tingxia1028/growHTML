// Slash composer operation adapter (SC-3; docs/design/slash-composer.md §1/§2/§5 —
// "Operations … are palette entries too"). The mirror of slashEntriesFromNoteTypes
// for the OTHER kind of `/` pick: an AI operation. Two sources, one derivation:
//
//   • BUILT-IN kit actions — a surface item (Explain / Practice / …) whose commandId
//     is a KitPrompt id. Only EFFECTIVE-INSTALLED, non-disabled items appear (that
//     gate rides kitSurfaceItems for free, the F4 seam the toolbars already use), so
//     uninstalling a kit removes its operation from the palette exactly as it removes
//     its create affordance — same story as note types.
//   • CUSTOM operations — the per-vault Operation records (op_ ids). These are React
//     STATE (loaded into WorkspaceContext), not a static registry, so they arrive as
//     an ARGUMENT; the note-type adapter reads its static registry directly, this one
//     is handed its live list. `disabled` (operation-prefs) drops a row, matching the
//     action manager's on/off toggle.
//
// Picking one dispatches the SHIPPED `operation.run` (never reimplemented here): both
// a built-in prompt id and an op_ id resolve through the server's resolvePrompt, so
// the entry's `id` IS the operationId. operationRunPayload() below assembles the exact
// command payload the mount dispatches — the whole "run an operation" is one existing
// command, threaded from the slash module without touching the command registry.

import { kitSurfaceItems } from "../../kits/clientContext";
import { productKits } from "../../kits/clientKits";
import { resolveText } from "../i18n";
import type { KitPrompt } from "../../kits/types";
import type { SlashEntry } from "./engine";

// The built-in prompt lookup (React-free data): a surface item's commandId IS its
// prompt id, so a built-in ACTION is a runnable operation iff a KitPrompt backs it.
// (Mirrors operationViews.tsx's builtinPromptsById; kept local so this module has no
// dependency on the view.)
const builtinPromptsById = new Map<string, KitPrompt>();
for (const kit of productKits) {
  for (const prompt of kit.prompts ?? []) builtinPromptsById.set(prompt.id, prompt);
}

// The minimal shape of a custom operation this adapter reads — a structural subset of
// the OperationRecord (name + id + scope), so the slash module never imports the
// W2-owned entityClient type nor the core schema. Anything satisfying it works.
export type SlashOperationLike = {
  id: string;
  name: string;
  scope?: "anchor" | "source";
  /** 中文/English match keys beyond the name (optional — a custom op rarely has any). */
  aliases?: string[];
};

export type SlashOperationSources = {
  /** The per-vault custom operations (WorkspaceContext.operations). Default []. */
  operations?: readonly SlashOperationLike[];
  /** Ids switched off in operation-prefs (built-in commandIds + op_ ids). Default []. */
  disabled?: readonly string[];
  /** Active kit ids for the focused source — floats the active kit's built-in actions
      to the front of the built-in group (kitSurfaceItems foregrounding). Default: no
      foregrounding (plain priority order). */
  foregroundKitIds?: readonly string[];
};

// The two toolbar slots whose items are AI operations. Their scope maps 1:1: a
// selection-toolbar action reads the focused passage (anchor scope); a source-actions
// action synthesizes over the whole source. (Mirrors listBuiltinActions in the view.)
const OPERATION_SLOTS: { slot: string; scope: "anchor" | "source" }[] = [
  { slot: "selection-toolbar", scope: "anchor" },
  { slot: "source-actions", scope: "source" }
];

/**
 * Built-in kit actions as operation palette entries. Only items whose commandId is a
 * KitPrompt (a runnable AI operation — not e.g. bookmark.add) are included; the
 * effective-installed + not-disabled gate is kitSurfaceItems' own (foreground ordering
 * applied when `foregroundKitIds` is given). The entry `id` is the prompt id = the
 * operationId operation.run resolves.
 */
export function slashEntriesFromBuiltinOperations(sources: SlashOperationSources = {}): SlashEntry[] {
  const disabled = new Set(sources.disabled ?? []);
  const entries: SlashEntry[] = [];
  const seen = new Set<string>();
  for (const { slot, scope } of OPERATION_SLOTS) {
    for (const item of kitSurfaceItems(slot, sources.foregroundKitIds)) {
      const prompt = builtinPromptsById.get(item.commandId);
      if (!prompt) continue; // a non-generative action (bookmark…) is not an operation
      if (disabled.has(item.commandId) || seen.has(item.commandId)) continue;
      seen.add(item.commandId);
      entries.push({
        kind: "operation",
        id: item.commandId,
        title: resolveText(item.title),
        aliases: [],
        icon: item.icon,
        // scope rides on the entry so the pick dispatches operation.run correctly.
        scope
      });
    }
  }
  return entries;
}

/**
 * Custom operations (op_ records) as operation palette entries. Disabled ids drop out
 * (the manager's on/off). Order = the caller's list order (WorkspaceContext already
 * keeps operation-prefs order); the combined adapter re-groups active-kit-first.
 */
export function slashEntriesFromCustomOperations(sources: SlashOperationSources = {}): SlashEntry[] {
  const disabled = new Set(sources.disabled ?? []);
  return (sources.operations ?? [])
    .filter((op) => !disabled.has(op.id))
    .map((op) => ({
      kind: "operation" as const,
      id: op.id,
      title: op.name,
      aliases: op.aliases ?? [],
      scope: op.scope ?? "anchor"
    }));
}

/**
 * Every runnable operation as a palette entry: built-in kit actions THEN custom ops
 * (built-ins first is the toolbar's own convention). The mount merges these with the
 * note-type entries via slashEntries() in adapters.ts.
 */
export function slashEntriesFromOperations(sources: SlashOperationSources = {}): SlashEntry[] {
  return [...slashEntriesFromBuiltinOperations(sources), ...slashEntriesFromCustomOperations(sources)];
}

// The `operation.run` command payload (client/commands/registry.ts). Kept as a plain
// type here (never imported from registry.ts — W2 owns it) so a mount can dispatch a
// picked operation entry with one line and nothing else in the slash module reaches
// into the command layer.
export type OperationRunPayload = {
  operationId: string;
  outputType?: string;
  scope: "anchor" | "source";
  variables: never[];
};

/**
 * The command id + payload a picked OPERATION entry dispatches — the existing
 * `operation.run`. `scope` rides on the entry (source vs anchor decides where the run
 * command materializes); `variables` is [] (built-in prompts read their params from
 * operation-prefs server-side; a simple/custom op with no slash-supplied vars runs on
 * the auto-context envelope). `outputType` is left AUTO (the form router / the op's own
 * pinned type decides) — the slash entry carries no output pin.
 *
 * A mount wires it in one line:
 *   const { commandId, payload } = operationRunPayload(entry);
 *   void dispatch(commandId, payload);
 */
export function operationRunPayload(entry: SlashEntry): { commandId: "operation.run"; payload: OperationRunPayload } {
  return {
    commandId: "operation.run",
    payload: { operationId: entry.id, scope: entry.scope ?? "anchor", variables: [] }
  };
}
