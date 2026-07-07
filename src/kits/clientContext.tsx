// Client kit install — builds a KitInstallContext whose sinks wire into the EXISTING
// host registries (NoteTypeRegistry + kit language). It does NOT create a parallel
// registration system: `noteTypes.register` registers both halves of a note type
// (core spec + client plugin) into the same registries the built-ins use.
//
// F5 (plugin ≠ kit, docs/design/plugin-viewer-model.md §8.10): a kit installs through
// its MEMBER plugins — installClientKits registers one PluginRecord per member and runs
// each member's install under its OWN plugin id (contributions, namespaced ids, and
// `NoteTypePlugin.pluginId` all carry the member id, so the catalog, the read model,
// and the renderer registry agree on ownership). Kit-scoped registries (language
// lookup, foreground ordering) still see the owning KIT id via the install options.
//
// F4 (effective-installed replaces the single-active-kit gate): availability of the
// CREATE affordances is decided by the marketplace effective-installed set
// (src/kits/installState.ts) — a surface item shows iff its owning plugin is
// effective-installed AND its contribution is not disabled. A caller that passes
// per-source active kit ids gets that document's filtered tool surface; callers that need
// the full configurable pool omit foreground ids. Rendering is never gated:
// getNoteType() stays global (the adaptive-note contract).

import { registerNoteContentSpec } from "../core/notes/contentTypes";
import { registerKitDetection } from "../core/subject/detectSubject";
import { listNoteTypes, registerNoteType } from "../client/notes/noteTypeRegistry";
import { registerCommand } from "../client/commands/registry";
import { resolveText } from "../client/i18n";
import { registerKitLanguage } from "./language";
import { getCatalogEntry, catalogKitMembers } from "./catalog";
import { isPluginEffectiveInstalled } from "./installState";
import {
  ensurePluginRecord,
  namespaceId,
  registerContribution,
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
// collected for phase-3 consumers; surface contributions feed the toolbars. Each entry
// carries the OWNING PLUGIN id (F5) plus the enclosing kit id (for legacy disabled ids
// + foreground ordering).
export const kitCommands: { pluginId: string; kitId: string; command: KitCommand }[] = [];
export const kitViews: { id: string; view: KitView }[] = [];
export const kitLayouts: KitLayout[] = [];
export const kitSurfaceContributions: {
  slot: string;
  /** The member plugin that owns these items (F5). */
  pluginId: string;
  /** The enclosing kit (== pluginId for standalone/plugin-unit installs). */
  kitId: string;
  items: KitSurfaceItem[];
}[] = [];
// contentType → owning PLUGIN id (F5 — member granularity). Built-in/core types are
// absent here (= always available).
export const kitNoteTypeOwners = new Map<string, string>();
// Installed KITS (id + display name) — the source for the activation (foreground)
// dropdown. Standalone `unit:"plugin"` registrations (e.g. the review loop) are NOT
// listed here: they are market plugins, not activation choices.
export const installedKits: { id: string; name: string; icon?: string }[] = [];
const runtimeKitMembers = new Map<string, string[]>();

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
    used both to record the Contribution and to test the disabled set. `ownerId` is the
    owning PLUGIN id (F5); pre-split prefs stored KIT-scoped ids, which kitSurfaceItems
    still honors as a legacy fallback. */
export function surfaceContributionId(ownerId: string, commandId: string): string {
  return namespaceId(ownerId, "surface", commandId);
}

// Whether a surface item is switched off — by its owning plugin's namespaced id, or by
// the LEGACY kit-scoped id a pre-F5 prefs file may still carry (migration-safe: an old
// `textbook-learning:surface:…` disable keeps working after the member split).
function isSurfaceDisabled(entry: { pluginId: string; kitId: string }, commandId: string): boolean {
  return (
    disabledContributionIds.has(surfaceContributionId(entry.pluginId, commandId)) ||
    (entry.kitId !== entry.pluginId && disabledContributionIds.has(surfaceContributionId(entry.kitId, commandId)))
  );
}

// The plugin ids an ACTIVE kit set matches: the kits themselves + their catalog/runtime
// members, so member-owned items are retained when their kit is the document context.
function foregroundPluginIds(kitIds: readonly string[]): Set<string> {
  const ids = new Set<string>(kitIds);
  for (const kitId of kitIds) {
    for (const member of catalogKitMembers(kitId)) ids.add(member);
    for (const member of runtimeKitMembers.get(kitId) ?? []) ids.add(member);
  }
  return ids;
}

/**
 * Surface items contributed to a slot. AVAILABILITY = marketplace effective-installed
 * plus user-disabled contribution filters. When `foregroundKitIds` is defined, it is
 * the current document context and filters to that kit and its members. Omit it for
 * manager/listing surfaces that need the full configurable pool.
 */
export function kitSurfaceItems(slot: string, foregroundKitIds?: readonly string[]): KitSurfaceItem[] {
  const foreground = foregroundKitIds ? foregroundPluginIds(foregroundKitIds) : undefined;
  const entries = kitSurfaceContributions
    .filter((entry) => entry.slot === slot && isPluginEffectiveInstalled(entry.pluginId))
    .filter((entry) => !foreground || foreground.has(entry.pluginId) || foreground.has(entry.kitId))
    .flatMap((entry) =>
      entry.items
        .filter((item) => !isSurfaceDisabled(entry, item.commandId))
        .map((item) => ({ item }))
    );
  return entries
    .sort((a, b) => (b.item.priority ?? 0) - (a.item.priority ?? 0))
    .map((entry) => entry.item);
}

/** The PLUGIN that owns a note contentType (member granularity after F5), or undefined
    for built-in/core types. */
export function noteTypeOwnerKit(contentType: string): string | undefined {
  return kitNoteTypeOwners.get(contentType);
}

/**
 * Build the sink context for one OWNER (a member plugin, a standalone plugin, or a
 * kit registering kit-level config). `ownerId` tags every contribution + registration;
 * `kitId` (default = ownerId) is the enclosing kit for kit-scoped registries.
 */
export function createKitInstallContext(ownerId: string, opts?: { kitId?: string }): KitInstallContext {
  const kitId = opts?.kitId ?? ownerId;
  // Every sink records a Contribution on the OWNING PLUGIN in addition to its real
  // host-registry effect, so the manager can enumerate what was installed.
  const contribute = (contribution: Contribution) => registerContribution(ownerId, contribution);
  return {
    noteTypes: {
      register(spec, plugin) {
        registerNoteContentSpec(spec);
        registerNoteType({
          contentType: spec.contentType,
          render: plugin.render,
          edit: plugin.edit,
          label: plugin.label,
          title: plugin.title,
          aliases: plugin.aliases,
          icon: plugin.icon,
          hidden: plugin.hidden,
          focusable: plugin.focusable,
          priority: plugin.priority,
          pluginId: ownerId
        });
        kitNoteTypeOwners.set(spec.contentType, ownerId);
        contribute({
          id: namespaceId(ownerId, "noteType", spec.contentType),
          kind: "noteType",
          label: plugin.label ? resolveText(plugin.label) : spec.contentType,
          key: spec.contentType
        });
      }
    },
    language: {
      register: (language) => {
        // Language stays registered under the KIT id — per-source activation scopes
        // language lookups by ACTIVE KIT ids (kitTerm/kitContentTypeLabel), and
        // foregrounding is a kit-level concern. The contribution lands on the member.
        registerKitLanguage(language, kitId);
        contribute({ id: namespaceId(ownerId, "language", kitId), kind: "language", label: "Language", key: kitId });
      }
    },
    commands: {
      register: (command) => {
        kitCommands.push({ pluginId: ownerId, kitId, command });
        registerCommand(command);
        contribute({
          id: namespaceId(ownerId, "command", command.id),
          kind: "command",
          label: command.title ? resolveText(command.title) : command.id,
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
        contribute({ id: namespaceId(ownerId, "layout", kitId), kind: "layout", label: "Layout", key: kitId });
      }
    },
    surfaces: {
      contribute: (slot, items) => {
        kitSurfaceContributions.push({ slot, pluginId: ownerId, kitId, items });
        for (const item of items) {
          contribute({
            id: surfaceContributionId(ownerId, item.commandId),
            kind: "surface",
            label: resolveText(item.title),
            key: item.commandId
          });
        }
      }
    }
  };
}

export function installClientKits(kits: ProductKit[]): void {
  for (const kit of kits) {
    const isKitUnit = (kit.unit ?? "kit") === "kit";
    if (isKitUnit && !installedKits.some((entry) => entry.id === kit.id)) {
      installedKits.push({ id: kit.id, name: kit.name, icon: kit.icon ?? getCatalogEntry(kit.id)?.icon });
    }
    runtimeKitMembers.set(kit.id, (kit.members ?? []).map((member) => member.id));
    // F5: register + install each MEMBER plugin under its own id (contributions attach
    // to the member's PluginRecord; kitId groups it under the kit in the manager).
    for (const member of kit.members ?? []) {
      ensurePluginRecord({ id: member.id, name: member.name, kitId: kit.id });
      member.install(createKitInstallContext(member.id, { kitId: kit.id }));
    }
    // The kit's own record: kit-level config for kit units (layout / policy); the whole
    // plugin for standalone `unit:"plugin"` registrations (no kitId — it IS a plugin).
    ensurePluginRecord({
      id: kit.id,
      name: kit.name,
      kitId: isKitUnit ? kit.id : undefined
    });
    kit.install(createKitInstallContext(kit.id));
    // Kit-level, React-free subject-detection table (subject-kits M-A) — registered the
    // way installServerKits registers it (the KitLayerPolicy precedent), so the client
    // auto-foreground resolves identically to the server's stage-axis seeding.
    if (kit.detection) registerKitDetection(kit.detection);
  }
  seedBuiltinKits();
}

// Seed PluginRecords for the BUILT-IN note types (those registered outside a kit
// install). Renamed seedBuiltinPlugins → seedBuiltinKits with FLAT §2 (plugins are
// INTERNAL capability records now — the seeded PluginRecords feed contribution wiring
// and the viewer-conflict surface, never a user-facing plugin list). F5 fix retained:
// registrations that carry a REAL `pluginId` (flashcard / quiz / bookmark / diagrams —
// see builtinNoteTypes.tsx) get their OWN PluginRecord named from the catalog; only
// true core primitives (no pluginId) land on the synthetic "core" record. Idempotent
// (registerContribution de-dupes by id; existing kit-owned records are skipped via the
// owners map).
function seedBuiltinKits(): void {
  ensurePluginRecord({ id: "core", name: "Core" });
  for (const plugin of listNoteTypes()) {
    if (kitNoteTypeOwners.has(plugin.contentType)) continue; // owned via a kit install
    const ownerId = plugin.pluginId ?? "core";
    if (ownerId !== "core") {
      ensurePluginRecord({ id: ownerId, name: getCatalogEntry(ownerId)?.name ?? ownerId });
    }
    registerContribution(ownerId, {
      id: namespaceId(ownerId, "noteType", plugin.contentType),
      kind: "noteType",
      label: plugin.label ? resolveText(plugin.label) : plugin.contentType,
      key: plugin.contentType
    });
  }
  // The bookmark plugin's command contribution (§8.6 day-one metadata: the noteType +
  // the bookmark.add command; the host surface item migrates gradually).
  registerContribution("bookmark", {
    id: namespaceId("bookmark", "command", "bookmark.add"),
    kind: "command",
    label: "Add bookmark",
    key: "bookmark.add"
  });
}
