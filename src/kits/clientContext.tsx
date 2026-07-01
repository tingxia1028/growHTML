// Client kit install — builds a KitInstallContext whose sinks wire into the EXISTING
// host registries (NoteTypeRegistry + kit language). It does NOT create a parallel
// registration system: `noteTypes.register` registers both halves of a note type
// (core spec + client plugin) into the same registries the built-ins use.
//
// Each registration is tagged with its owning `kitId` so the host can gate
// creation/interaction entry-points by a document's active kits (per-source
// activation). Rendering is NOT gated — note-type render + content specs register
// globally, so any contentType displays in any document.
//
// Plugin read model (docs/design/plugin-viewer-model.md): every sink ALSO records a
// Contribution on the owning plugin (plugin==kit 1:1 today), and installClientKits
// registers a PluginRecord per kit + a synthetic "core" plugin for the built-in note
// types. That read model is what the Kit & Plugin manager panel enumerates. It NEVER
// changes install/behavior — the host registries above stay the source of truth. The
// only ENFORCEMENT the read model drives is the disabled set: surface (and thus command)
// contributions whose namespaced id is disabled are filtered out of kitSurfaceItems, so
// their CREATE affordance disappears. getNoteType() is left untouched (disabling a
// note-type contribution hides its create affordance only, never its render — the
// adaptive-note contract holds).

import { registerNoteContentSpec } from "../core/notes/contentTypes";
import { listNoteTypes, registerNoteType } from "../client/notes/noteTypeRegistry";
import { registerCommand } from "../client/commands/registry";
import { registerKitLanguage } from "./language";
import {
  namespaceId,
  registerContribution,
  registerPlugin,
  type Contribution
} from "./plugin";
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

// The DISABLED contribution set (namespaced ids) — the register-only enforcement seam.
// WorkspaceContext loads it from plugin-prefs.json and pushes it here via
// setDisabledContributions; kitSurfaceItems filters against it. A module-scope Set (not
// React state) so the pure kitSurfaceItems selector — called in a useMemo — can read it
// without threading it through every caller. Default empty = nothing disabled.
let disabledContributionIds = new Set<string>();

/** WorkspaceContext calls this after fetching pluginPrefs so surface/command filtering
    reflects the user's disabled set. Pass the full next set (replaces the previous). */
export function setDisabledContributions(ids: readonly string[]): void {
  disabledContributionIds = new Set(ids);
}

/** The stable namespaced id of a surface contribution (a command surfaced in a slot),
    used both to record the Contribution and to test the disabled set. */
export function surfaceContributionId(kitId: string, commandId: string): string {
  return namespaceId(kitId, "surface", commandId);
}

/**
 * Surface items contributed to a slot, highest priority first. When `kitIds` is
 * provided, only items whose owning kit is in that set are returned (the per-source
 * activation gate); omit it to get every installed kit's items (back-compat).
 * DISABLED contributions (their namespaced surface id is in the disabled set) are
 * filtered out — this is where disabling a contribution removes its CREATE affordance.
 */
export function kitSurfaceItems(slot: string, kitIds?: readonly string[]): KitSurfaceItem[] {
  return kitSurfaceContributions
    .filter((entry) => entry.slot === slot && (!kitIds || kitIds.includes(entry.kitId)))
    .flatMap((entry) =>
      entry.items.filter((item) => !disabledContributionIds.has(surfaceContributionId(entry.kitId, item.commandId)))
    )
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

/** The kit that owns a note contentType, or undefined for built-in/core types. */
export function noteTypeOwnerKit(contentType: string): string | undefined {
  return kitNoteTypeOwners.get(contentType);
}

export function createKitInstallContext(kitId: string): KitInstallContext {
  // Every sink records a Contribution on the owning plugin (plugin==kit) IN ADDITION to
  // its real host-registry effect, so the manager panel can enumerate what was installed.
  const contribute = (contribution: Contribution) => registerContribution(kitId, contribution);
  return {
    noteTypes: {
      register(spec, plugin) {
        registerNoteContentSpec(spec);
        registerNoteType({
          contentType: spec.contentType,
          render: plugin.render,
          edit: plugin.edit,
          label: plugin.label,
          priority: plugin.priority,
          pluginId: kitId
        });
        kitNoteTypeOwners.set(spec.contentType, kitId);
        contribute({
          id: namespaceId(kitId, "noteType", spec.contentType),
          kind: "noteType",
          label: plugin.label ?? spec.contentType,
          key: spec.contentType
        });
      }
    },
    language: {
      register: (language) => {
        registerKitLanguage(language, kitId);
        contribute({ id: namespaceId(kitId, "language", kitId), kind: "language", label: "Language", key: kitId });
      }
    },
    commands: {
      register: (command) => {
        kitCommands.push({ kitId, command });
        registerCommand(command);
        contribute({
          id: namespaceId(kitId, "command", command.id),
          kind: "command",
          label: command.title ?? command.id,
          key: command.id
        });
      }
    },
    // `views` is a phase-3 collector (kitViews); it registers no contribution yet — the
    // plan's contribution sinks are noteTypes/commands/surfaces/language/layouts.
    views: { register: (id, view) => kitViews.push({ id, view }) },
    layouts: {
      register: (layout) => {
        kitLayouts.push(layout);
        contribute({ id: namespaceId(kitId, "layout", kitId), kind: "layout", label: "Layout", key: kitId });
      }
    },
    surfaces: {
      contribute: (slot, items) => {
        kitSurfaceContributions.push({ slot, kitId, items });
        for (const item of items) {
          contribute({
            id: surfaceContributionId(kitId, item.commandId),
            kind: "surface",
            label: item.title,
            key: item.commandId
          });
        }
      }
    }
  };
}

export function installClientKits(kits: ProductKit[]): void {
  for (const kit of kits) {
    if (!installedKits.some((entry) => entry.id === kit.id)) {
      installedKits.push({ id: kit.id, name: kit.name });
    }
    // Register the plugin record (plugin==kit 1:1) BEFORE install so the sinks attach
    // their contributions onto it. install() runs its sinks, each appending a Contribution.
    registerPlugin({ id: kit.id, name: kit.name, kitId: kit.id, contributions: [] });
    kit.install(createKitInstallContext(kit.id));
  }
  seedCorePlugin();
}

// Seed a synthetic "core" plugin from the BUILT-IN note types (those with no owning
// kit) so the manager panel shows the built-ins too. Called after installs so the
// built-ins are already registered; idempotent (registerPlugin replaces by id, and
// registerContribution de-dupes by contribution id).
function seedCorePlugin(): void {
  registerPlugin({ id: "core", name: "Core", contributions: [] });
  for (const plugin of listNoteTypes()) {
    if (kitNoteTypeOwners.has(plugin.contentType)) continue; // owned by a kit, not core
    registerContribution("core", {
      id: namespaceId("core", "noteType", plugin.contentType),
      kind: "noteType",
      label: plugin.label ?? plugin.contentType,
      key: plugin.contentType
    });
  }
}
