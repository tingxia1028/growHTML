// Workspace-level small-JSON services (X0 shared-core extraction): workspace.json
// (layout UI state), operation-prefs.json (action order/disabled/params/surfaces/
// icons) and plugin-prefs.json (Kit & Plugin manager prefs). All share the same
// vault.storage pattern: read → parse-or-default, write → atomic pretty JSON.
// The zod schemas double as the FILE format and the PUT body shape, so they live
// here and the routes reuse them at the transport edge (as X0b's adapter will).
import path from "node:path";
import { z } from "zod";
import type { StudyVault } from "../../core/vault";
import { migrateCatalogState, type UserKitDef } from "../../kits/installState";

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
// read model (docs/design/plugin-viewer-model.md §7/§8.3). Same vault.storage/JSON
// pattern as operation-prefs above. `disabledContributions` is the enabled/disabled set
// (namespaced contribution ids) the manager toggles; `viewerAssociations` holds the
// per-contentType / per-note viewer pins; `userKits` (typed since M1, declared as
// unknown[] since P2) + `catalogState` (NEW, M1) are the MARKET install state.
//
// Back-compat default (locked, §8.3): an existing vault — absent file, or a prefs file
// without `catalogState` — parses to { installedPlugins: null, installedKits: null },
// and null means the DEFAULT-INSTALLED set (every bundled entry). Existing vaults see
// no change; the first explicit install/uninstall materializes concrete arrays.
export const userKitSchema = z.object({
  id: z.string().min(1), // "user:" prefix, e.g. "user:exam-prep"
  name: z.string().min(1),
  description: z.string().default(""),
  members: z.array(z.string()).default([]) // cataloged plugin ids
});
export type UserKit = z.infer<typeof userKitSchema>;

export const catalogStateSchema = z
  .object({
    // null = vault has never touched the market → the DEFAULT-INSTALLED set.
    installedPlugins: z.array(z.string()).nullable().default(null),
    installedKits: z.array(z.string()).nullable().default(null),
    // FLAT (kit-flatten-and-core-review.md §2): per-kit capability-group switchboard —
    // kitId → DISABLED group ids. OPTIONAL (no default) so pre-FLAT states round-trip
    // byte-for-byte; an absent key means the kit's group defaults.
    disabledGroups: z.record(z.string(), z.array(z.string())).optional()
  })
  .default({ installedPlugins: null, installedKits: null });

export const pluginPrefsSchema = z.object({
  disabledContributions: z.array(z.string()).default([]),
  viewerAssociations: z
    .object({
      byContentType: z.record(z.string(), z.string()).default({}),
      byNoteId: z.record(z.string(), z.string()).default({})
    })
    .default({ byContentType: {}, byNoteId: {} }),
  userKits: z.array(userKitSchema).default([]),
  catalogState: catalogStateSchema
});
export type PluginPrefs = z.infer<typeof pluginPrefsSchema>;
export const emptyPluginPrefs: PluginPrefs = {
  disabledContributions: [],
  viewerAssociations: { byContentType: {}, byNoteId: {} },
  userKits: [],
  catalogState: { installedPlugins: null, installedKits: null }
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

// onboarding — the SHELL-2 first-run checklist block inside workspace.json
// (docs/design/app-shell-ux.md §2). `dismissed`/`completedAt` are the design's
// first-run flag; `doneSteps` LATCHES step completions (a step once detected done
// stays done even if the underlying data is later deleted); `sampleSourceId`
// remembers the 载入示例文档 seed so re-seeding stays idempotent. Every field
// defaults, so an absent block (all pre-SHELL-2 files) parses to the pristine
// "never seen" state.
export const onboardingStateSchema = z.object({
  dismissed: z.boolean().default(false),
  completedAt: z.string().nullable().default(null),
  doneSteps: z.array(z.string()).default([]),
  sampleSourceId: z.string().nullable().default(null)
});
export type OnboardingState = z.infer<typeof onboardingStateSchema>;
export const emptyOnboardingState: OnboardingState = {
  dismissed: false,
  completedAt: null,
  doneSteps: [],
  sampleSourceId: null
};

// uiPrefs — small app-shell preferences that are not layout state. Kept as a
// separate field group so a stale WorkspaceContext layout PUT cannot clobber the
// user's language choice.
export const uiPrefsSchema = z.object({
  locale: z.enum(["zh", "en"]).default("zh")
});
export type UiPrefs = z.infer<typeof uiPrefsSchema>;
export const emptyUiPrefs: UiPrefs = { locale: "zh" };

export const workspaceStateSchema = z.object({
  activeLayoutId: z.string(),
  layouts: z.array(workspaceLayoutSchema),
  // Optional so pre-SHELL-2 files (and the layout writer's body) stay valid.
  onboarding: onboardingStateSchema.optional(),
  // Optional so pre-I18N files and layout PUT bodies stay valid.
  uiPrefs: uiPrefsSchema.optional()
});
export type WorkspaceState = z.infer<typeof workspaceStateSchema>;
export const emptyWorkspaceState: WorkspaceState = { activeLayoutId: "", layouts: [], uiPrefs: emptyUiPrefs };

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

export async function readPluginPrefs(deps: WorkspaceDeps): Promise<PluginPrefs> {
  const { vault } = deps;
  const text = await vault.storage.readText(pluginPrefsPath(vault));
  const prefs = text ? pluginPrefsSchema.parse(JSON.parse(text)) : emptyPluginPrefs;
  // FLAT §2 migration — collapse a pre-FLAT per-plugin install state into the
  // kit-granular model, WRITE-BACK on first load. Idempotent (a migrated state is a
  // no-op) and zero-loss (effective-installed parity), so old vaults load cleanly and
  // never migrate twice.
  const migrated = migrateCatalogState(prefs.catalogState, prefs.userKits as readonly UserKitDef[]);
  if (!migrated.changed) return prefs;
  return writePluginPrefs(deps, { ...prefs, catalogState: migrated.state });
}

export async function writePluginPrefs({ vault }: WorkspaceDeps, prefs: PluginPrefs): Promise<PluginPrefs> {
  await vault.storage.writeTextAtomic(pluginPrefsPath(vault), `${JSON.stringify(prefs, null, 2)}\n`);
  return prefs;
}

// —— single-writer-per-field-group merges (M1) ————————————————————————————————
// plugin-prefs.json has TWO independent client writers: the workspace panel seams
// (setContributionEnabled / pinViewer PUT the full prefs from React state) and the
// MARKET (installs/uninstalls write catalogState). To keep a stale full-body PUT from
// one writer silently clobbering the other's fields (lost update), each route owns only
// its field group and the service merges against the STORED file:
//   • PUT /api/plugin-prefs        → owns disabledContributions + viewerAssociations
//   • PUT /api/plugin-prefs/catalog → owns catalogState + userKits
// GET always returns the whole merged file.

/** The panel write: body's disabled set + pins over the STORED market fields. */
export async function writePluginPanelPrefs(
  deps: WorkspaceDeps,
  body: Pick<PluginPrefs, "disabledContributions" | "viewerAssociations">
): Promise<PluginPrefs> {
  const stored = await readPluginPrefs(deps);
  return writePluginPrefs(deps, {
    ...stored,
    disabledContributions: body.disabledContributions,
    viewerAssociations: body.viewerAssociations
  });
}

/** The market write: body's catalogState (+ optional userKits) over the STORED panel
    fields. `userKits` omitted → stored user kits are kept. */
export async function writePluginCatalogPrefs(
  deps: WorkspaceDeps,
  body: { catalogState: PluginPrefs["catalogState"]; userKits?: PluginPrefs["userKits"] }
): Promise<PluginPrefs> {
  const stored = await readPluginPrefs(deps);
  return writePluginPrefs(deps, {
    ...stored,
    catalogState: body.catalogState,
    userKits: body.userKits ?? stored.userKits
  });
}

export async function readWorkspace({ vault }: WorkspaceDeps): Promise<WorkspaceState> {
  const text = await vault.storage.readText(workspacePath(vault));
  return text ? workspaceStateSchema.parse(JSON.parse(text)) : emptyWorkspaceState;
}

export async function writeWorkspace({ vault }: WorkspaceDeps, state: WorkspaceState): Promise<WorkspaceState> {
  await vault.storage.writeTextAtomic(workspacePath(vault), `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

// —— single-writer-per-field-group merges (SHELL-2, same M1 rule as plugin-prefs) ——
// workspace.json now has independent client writers: the layout persistence in
// WorkspaceContext (a full-body PUT of {activeLayoutId, layouts} from React state)
// the onboarding checklist (dismiss/progress writes), and uiPrefs (locale). Each route owns only its
// field group and merges against the STORED file, so a stale layout PUT can never
// clobber onboarding progress / locale and vice versa:
//   • PUT /api/workspace            → owns activeLayoutId + layouts
//   • PUT /api/workspace/onboarding → owns the onboarding block
//   • PUT /api/workspace/ui-prefs   → owns uiPrefs
// GET always returns the whole merged file.

/** The layout write: body's layout fields over the STORED onboarding block. A body
    that happens to carry `onboarding` is deliberately ignored (field ownership). */
export async function writeWorkspaceLayout(
  deps: WorkspaceDeps,
  body: Pick<WorkspaceState, "activeLayoutId" | "layouts">
): Promise<WorkspaceState> {
  const stored = await readWorkspace(deps);
  return writeWorkspace(deps, {
    ...stored,
    activeLayoutId: body.activeLayoutId,
    layouts: body.layouts
  });
}

/** Read just the onboarding block (absent block ⇒ the pristine default state). */
export async function readWorkspaceOnboarding(deps: WorkspaceDeps): Promise<OnboardingState> {
  const stored = await readWorkspace(deps);
  return stored.onboarding ?? emptyOnboardingState;
}

/** The onboarding write: the block over the STORED layout fields. */
export async function writeWorkspaceOnboarding(
  deps: WorkspaceDeps,
  onboarding: OnboardingState
): Promise<OnboardingState> {
  const stored = await readWorkspace(deps);
  await writeWorkspace(deps, { ...stored, onboarding });
  return onboarding;
}

/** Read just the app-shell prefs block (absent block ⇒ the default locale). */
export async function readWorkspaceUiPrefs(deps: WorkspaceDeps): Promise<UiPrefs> {
  const stored = await readWorkspace(deps);
  return stored.uiPrefs ?? emptyUiPrefs;
}

/** The uiPrefs write: prefs over the STORED layout/onboarding fields. */
export async function writeWorkspaceUiPrefs(deps: WorkspaceDeps, uiPrefs: UiPrefs): Promise<UiPrefs> {
  const stored = await readWorkspace(deps);
  await writeWorkspace(deps, { ...stored, uiPrefs });
  return uiPrefs;
}
