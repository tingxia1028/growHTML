// Client kit install — builds a KitInstallContext whose sinks wire into the EXISTING
// host registries (NoteTypeRegistry + kit language). It does NOT create a parallel
// registration system: `noteTypes.register` registers both halves of a note type
// (core spec + client plugin) into the same registries the built-ins use.
//
// Phase 1 fully wires noteTypes + language. Commands/views/layouts/surfaces are
// COLLECTED here (real registration, stable API) and consumed in phases 2–3.

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
// collected for phase-3 consumers; surface contributions feed the selection toolbar.
export const kitCommands: KitCommand[] = [];
export const kitViews: { id: string; view: KitView }[] = [];
export const kitLayouts: KitLayout[] = [];
export const kitSurfaceContributions: { slot: string; items: KitSurfaceItem[] }[] = [];

/** Surface items contributed to a slot, highest priority first. */
export function kitSurfaceItems(slot: string): KitSurfaceItem[] {
  return kitSurfaceContributions
    .filter((entry) => entry.slot === slot)
    .flatMap((entry) => entry.items)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

export function createKitInstallContext(): KitInstallContext {
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
      }
    },
    language: { register: registerKitLanguage },
    commands: {
      register: (command) => {
        kitCommands.push(command);
        registerCommand(command);
      }
    },
    views: { register: (id, view) => kitViews.push({ id, view }) },
    layouts: { register: (layout) => kitLayouts.push(layout) },
    surfaces: { contribute: (slot, items) => kitSurfaceContributions.push({ slot, items }) }
  };
}

export function installClientKits(kits: ProductKit[]): void {
  const ctx = createKitInstallContext();
  for (const kit of kits) kit.install(ctx);
}
