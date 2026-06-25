// Client kit install — builds a KitInstallContext whose sinks wire into the EXISTING
// host registries (NoteTypeRegistry + kit language). It does NOT create a parallel
// registration system: `noteTypes.register` registers both halves of a note type
// (core spec + client plugin) into the same registries the built-ins use.
//
// Each registration is tagged with its owning `kitId` so the host can gate
// creation/interaction entry-points by a document's active kits (per-source
// activation). Rendering is NOT gated — note-type render + content specs register
// globally, so any contentType displays in any document.

import { registerNoteContentSpec } from "../core/notes/contentTypes";
import { registerNoteType } from "../client/notes/noteTypeRegistry";
import { registerCommand } from "../client/commands/registry";
import { registerKitLanguage } from "./language";
import type {
  KitCommand,
  KitInstallContext,
  KitLayout,
  KitSurfaceItem,
  KitView,
  ProductKit
} from "./types";

// Commands are wired straight into the host CommandRegistry; views/layouts are
// collected for phase-3 consumers; surface contributions feed the toolbars. Each
// carries the owning kitId for per-source activation filtering.
export const kitCommands: { kitId: string; command: KitCommand }[] = [];
export const kitViews: { id: string; view: KitView }[] = [];
export const kitLayouts: KitLayout[] = [];
export const kitSurfaceContributions: { slot: string; kitId: string; items: KitSurfaceItem[] }[] = [];
// contentType → owning kit id. Built-in/core types are absent here (= always available).
export const kitNoteTypeOwners = new Map<string, string>();
// Installed kits (id + display name) — the source for the activation dropdown.
export const installedKits: { id: string; name: string }[] = [];

/**
 * Surface items contributed to a slot, highest priority first. When `kitIds` is
 * provided, only items whose owning kit is in that set are returned (the per-source
 * activation gate); omit it to get every installed kit's items (back-compat).
 */
export function kitSurfaceItems(slot: string, kitIds?: readonly string[]): KitSurfaceItem[] {
  return kitSurfaceContributions
    .filter((entry) => entry.slot === slot && (!kitIds || kitIds.includes(entry.kitId)))
    .flatMap((entry) => entry.items)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

/** The kit that owns a note contentType, or undefined for built-in/core types. */
export function noteTypeOwnerKit(contentType: string): string | undefined {
  return kitNoteTypeOwners.get(contentType);
}

export function createKitInstallContext(kitId: string): KitInstallContext {
  return {
    noteTypes: {
      register(spec, plugin) {
        registerNoteContentSpec(spec);
        registerNoteType({
          contentType: spec.contentType,
          render: plugin.render,
          edit: plugin.edit,
          label: plugin.label
        });
        kitNoteTypeOwners.set(spec.contentType, kitId);
      }
    },
    language: { register: (language) => registerKitLanguage(language, kitId) },
    commands: {
      register: (command) => {
        kitCommands.push({ kitId, command });
        registerCommand(command);
      }
    },
    views: { register: (id, view) => kitViews.push({ id, view }) },
    layouts: { register: (layout) => kitLayouts.push(layout) },
    surfaces: { contribute: (slot, items) => kitSurfaceContributions.push({ slot, kitId, items }) }
  };
}

export function installClientKits(kits: ProductKit[]): void {
  for (const kit of kits) {
    if (!installedKits.some((entry) => entry.id === kit.id)) {
      installedKits.push({ id: kit.id, name: kit.name });
    }
    kit.install(createKitInstallContext(kit.id));
  }
}
