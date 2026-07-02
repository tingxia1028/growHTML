// Workspace-level small-JSON services (X0 shared-core extraction): workspace.json
// (layout UI state), operation-prefs.json (action order/disabled/params/surfaces/
// icons) and plugin-prefs.json (Kit & Plugin manager prefs). All share the same
// vault.storage pattern: read → parse-or-default, write → atomic pretty JSON.
// The zod schemas double as the FILE format and the PUT body shape, so they live
// here and the routes reuse them at the transport edge (as X0b's adapter will).
import path from "node:path";
import { z } from "zod";
import type { StudyVault } from "../../core/vault";

export type WorkspaceDeps = { vault: StudyVault };

// operation-prefs.json — a workspace-level small JSON file (same vault.storage
// pattern as workspace.json) holding the action ORDER + DISABLED set (built-in
// command ids + op_ ids) and per-built-in placeholder PARAMS the server merges
// into generate input before build().
// `surfaces` (R6.3) is the optional PER-SURFACE override: for each surface key
// (inline / anchor / source / bottom) its own action `order` + `hidden` set. When a
// surface entry is absent the surface falls back to the GLOBAL `order`/`disabled`
// above, so old prefs files (no `surfaces`) keep working unchanged — no migration.
export const operationPrefsSchema = z.object({
  order: z.array(z.string()).default([]),
  disabled: z.array(z.string()).default([]),
  params: z.record(z.string(), z.record(z.string(), z.string())).default({}),
  surfaces: z
    .record(
      z.string(),
      z.object({ order: z.array(z.string()).default([]), hidden: z.array(z.string()).default([]) })
    )
    .default({}),
  // `icons` (R6 polish) — a TOP-LEVEL action id → chosen lucide icon NAME map (global,
  // not per-surface, so an action's glyph is consistent across surfaces). Absent in old
  // prefs files → defaults to {} (additive, no migration).
  icons: z.record(z.string(), z.string()).default({})
});
export type OperationPrefs = z.infer<typeof operationPrefsSchema>;
export const emptyOperationPrefs: OperationPrefs = {
  order: [],
  disabled: [],
  params: {},
  surfaces: {},
  icons: {}
};

// plugin-prefs.json — the per-vault "Kit & Plugin" prefs, the write side of the plugin
// read model (docs/design/plugin-viewer-model.md §7). Same vault.storage/JSON pattern as
// operation-prefs above. `disabledContributions` is the enabled/disabled set (namespaced
// contribution ids) the manager panel toggles; `viewerAssociations` (per-contentType /
// per-note viewer pins) and `userKits` are DECLARED now but UNUSED until P3/P4 — carried
// so the schema is stable and no migration is needed later. Absent file → empty default.
export const pluginPrefsSchema = z.object({
  disabledContributions: z.array(z.string()).default([]),
  viewerAssociations: z
    .object({
      byContentType: z.record(z.string(), z.string()).default({}),
      byNoteId: z.record(z.string(), z.string()).default({})
    })
    .default({ byContentType: {}, byNoteId: {} }),
  userKits: z.array(z.unknown()).default([])
});
export type PluginPrefs = z.infer<typeof pluginPrefsSchema>;
export const emptyPluginPrefs: PluginPrefs = {
  disabledContributions: [],
  viewerAssociations: { byContentType: {}, byNoteId: {} },
  userKits: []
};

// Workspace layout is UI state, not a core entity: stored as a single JSON file
// in the vault and validated only structurally.
const workspaceNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional()
});
const workspaceLayoutSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mode: z.enum(["dock", "canvas"]),
  nodes: z.array(workspaceNodeSchema),
  layout: z.unknown()
});
export const workspaceStateSchema = z.object({
  activeLayoutId: z.string(),
  layouts: z.array(workspaceLayoutSchema)
});
export type WorkspaceState = z.infer<typeof workspaceStateSchema>;
export const emptyWorkspaceState = { activeLayoutId: "", layouts: [] };

const operationPrefsPath = (vault: StudyVault) => path.join(vault.paths.studyDir, "operation-prefs.json");
const pluginPrefsPath = (vault: StudyVault) => path.join(vault.paths.studyDir, "plugin-prefs.json");
const workspacePath = (vault: StudyVault) => path.join(vault.paths.studyDir, "workspace.json");

export async function readOperationPrefs({ vault }: WorkspaceDeps): Promise<OperationPrefs> {
  const text = await vault.storage.readText(operationPrefsPath(vault));
  return text ? operationPrefsSchema.parse(JSON.parse(text)) : emptyOperationPrefs;
}

export async function writeOperationPrefs({ vault }: WorkspaceDeps, prefs: OperationPrefs): Promise<OperationPrefs> {
  await vault.storage.writeTextAtomic(operationPrefsPath(vault), `${JSON.stringify(prefs, null, 2)}\n`);
  return prefs;
}

export async function readPluginPrefs({ vault }: WorkspaceDeps): Promise<PluginPrefs> {
  const text = await vault.storage.readText(pluginPrefsPath(vault));
  return text ? pluginPrefsSchema.parse(JSON.parse(text)) : emptyPluginPrefs;
}

export async function writePluginPrefs({ vault }: WorkspaceDeps, prefs: PluginPrefs): Promise<PluginPrefs> {
  await vault.storage.writeTextAtomic(pluginPrefsPath(vault), `${JSON.stringify(prefs, null, 2)}\n`);
  return prefs;
}

export async function readWorkspace({ vault }: WorkspaceDeps): Promise<WorkspaceState> {
  const text = await vault.storage.readText(workspacePath(vault));
  return text ? workspaceStateSchema.parse(JSON.parse(text)) : emptyWorkspaceState;
}

export async function writeWorkspace({ vault }: WorkspaceDeps, state: WorkspaceState): Promise<WorkspaceState> {
  await vault.storage.writeTextAtomic(workspacePath(vault), `${JSON.stringify(state, null, 2)}\n`);
  return state;
}
