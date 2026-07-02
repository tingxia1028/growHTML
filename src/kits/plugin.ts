// Plugin model (React-free core) — the FOUNDATION contract for the "Kit & Plugin"
// system (docs/design/plugin-viewer-model.md §1). A PLUGIN is the minimal extension
// unit; it registers zero or more CONTRIBUTIONS (a note-type renderer, a viewer, a
// command, a surface item, language, a layout, a prompt pack, a layer policy). A KIT
// is a curated bundle of plugins + config; today plugin == kit 1:1 (clientContext
// registers one PluginRecord per installed kit), but the model already separates the
// two so the manager panel can group Kit → Plugin → Contribution.
//
// This module is a pure READ MODEL + registry: it is React-free (so the server side
// can import it too) and it does NOT change any install semantics — the existing host
// registries (NoteTypeRegistry / CommandRegistry / kit surfaces / language) stay the
// source of truth for BEHAVIOR. These records exist only so the UI can enumerate what
// is installed and toggle a contribution's availability. Namespacing (`pluginId:kind:key`)
// gives every contribution a stable, collision-free id for the disabled set / prefs.

// The kinds of thing a plugin can contribute (design §2). `key` semantics per kind:
//   noteType    → the exclusive contentType it renders
//   viewer      → the viewer id (P3)
//   command     → the command id
//   surface     → the surface command id (a command surfaced in a UI slot)
//   language    → the kit id (a language pack is per-kit)
//   layout      → the layout id
//   prompt      → the prompt id
//   layerPolicy → the kit id
export type ContributionKind =
  | "noteType"
  | "viewer"
  | "command"
  | "surface"
  | "language"
  | "layout"
  | "prompt"
  | "layerPolicy";

// One contribution a plugin makes. `id` is the NAMESPACED, collision-free identity
// (`pluginId:kind:key`) used by the disabled set + prefs; `key` is the EXCLUSIVE key
// within its kind (contentType / commandId / …). `label` is the human name the panel
// shows.
export type Contribution = {
  id: string;
  kind: ContributionKind;
  label: string;
  /** The exclusive key within the kind (e.g. contentType, commandId). Optional for
      kinds that have no natural key. */
  key?: string;
};

// An installed plugin (== an installed kit for now, `kitId === id`). `contributions`
// accumulates every contribution registered under this plugin.
export type PluginRecord = {
  id: string;
  name: string;
  /** The owning kit id (plugin==kit 1:1 today). */
  kitId?: string;
  contributions: Contribution[];
};

// Module-scope install registry. Populated as kits install (clientContext) + a
// synthetic "core" record for the built-in note types. The manager panel reads it via
// listInstalledPlugins().
const installedPlugins: PluginRecord[] = [];

/** Build the namespaced contribution id `pluginId:kind:key`. `key` falls back to the
    kind when absent, so the id stays stable and unique per (plugin, kind). */
export function namespaceId(pluginId: string, kind: ContributionKind, key?: string): string {
  return `${pluginId}:${kind}:${key ?? kind}`;
}

/** Register (or replace) a whole plugin record. Last write for an id wins (re-install
    replaces, so tests + hot paths stay idempotent). */
export function registerPlugin(rec: PluginRecord): void {
  const index = installedPlugins.findIndex((p) => p.id === rec.id);
  if (index === -1) installedPlugins.push(rec);
  else installedPlugins[index] = rec;
}

/** Create the plugin record if absent, else UPDATE its metadata (name / kitId) while
    PRESERVING already-registered contributions. The seeding path uses this so a record
    whose contributions were attached earlier (e.g. the table viewer's import-time
    registerContribution) is never clobbered by a later registerPlugin-style call. */
export function ensurePluginRecord(rec: Omit<PluginRecord, "contributions">): PluginRecord {
  let plugin = installedPlugins.find((p) => p.id === rec.id);
  if (!plugin) {
    plugin = { ...rec, contributions: [] };
    installedPlugins.push(plugin);
    return plugin;
  }
  plugin.name = rec.name;
  if (rec.kitId !== undefined) plugin.kitId = rec.kitId;
  return plugin;
}

/** Attach a contribution to a plugin, creating the plugin record if it does not exist
    yet (so a sink can register a contribution before/without an explicit registerPlugin).
    De-dupes by contribution id (a re-register updates the existing entry in place). */
export function registerContribution(pluginId: string, contribution: Contribution): void {
  let plugin = installedPlugins.find((p) => p.id === pluginId);
  if (!plugin) {
    plugin = { id: pluginId, name: pluginId, contributions: [] };
    installedPlugins.push(plugin);
  }
  const existing = plugin.contributions.findIndex((c) => c.id === contribution.id);
  if (existing === -1) plugin.contributions.push(contribution);
  else plugin.contributions[existing] = contribution;
}

/** The installed plugins (read model for the manager panel). */
export function listInstalledPlugins(): readonly PluginRecord[] {
  return installedPlugins;
}

/** Test hook — clear the install registry so a spec starts from empty. */
export function resetPlugins(): void {
  installedPlugins.length = 0;
}
