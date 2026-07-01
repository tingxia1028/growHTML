// Operation workspace view (operation-as-data V1) — a NEW pane that lets anyone AUTHOR
// AI actions as DATA and MANAGE the action toolbars, without ever touching the core or
// writing a prompt as code:
//
//   • BUILDER: name + description, an output-type picker (from the NoteContentSpec
//     registry), and a prompt template whose variables are inserted as clickable CONTENT
//     BLOCKS (the user never types {{}} syntax). A LIVE PREVIEW renders the template with
//     the current passage's real text substituted in. "试一下" persists the draft and runs
//     it through the SHIPPED generation-preview loop (operation.run → onGenerated). The
//     editor can be PREFILLED from a built-in default (with one-click restore), and an
//     advanced section exposes the declared variables (source / default / required).
//   • MANAGER: every action (built-in kit actions + custom ops) in one list, with
//     drag-to-reorder + an on/off toggle persisted to operation-prefs.json; built-in
//     rows expose their placeholder PARAMS (grade / difficulty / language) which the
//     server merges into generate input before build(). "复制为我的插件" forks a built-in
//     into an editable Operation seeded with an approximating template.
//
// Like the concept / layer panes it is ADDITIVE (its own pane node) and talks only
// through the WorkspaceContext + entity client. The toolbars read the SAME prefs, so the
// order / enable-disable configured here is exactly what the study panel renders.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Wand2, Plus, Play, RotateCcw, Trash2, Copy, GripVertical } from "lucide-react";
import {
  entityClient,
  type OperationInput,
  type OperationRecord,
  type OperationVariable
} from "../data/entityClient";
import { registerView, type WorkspaceContext } from "./viewRegistry";
import type { ActionSurface, CustomizeSurface } from "./WorkspaceContext";
import type { OperationPrefs } from "../data/entityClient";
import { ICON_CHOICES, actionIcon } from "./actionIcons";
import { extractVariables, renderTemplate } from "../../ai/template";
import { listNoteContentSpecs } from "../../core/notes/contentTypes";
import { kitSurfaceItems } from "../../kits/clientContext";
import { productKits } from "../../kits/clientKits";
import type { KitPrompt } from "../../kits/types";

// —— built-in prompt lookup (React-free data, read for params + fork seeding) ——————————
// The 4 textbook prompts are固化 code; their command id IS their prompt id, so a surface
// item's commandId looks the prompt up directly.
const builtinPromptsById = new Map<string, KitPrompt>();
for (const kit of productKits) {
  for (const prompt of kit.prompts ?? []) builtinPromptsById.set(prompt.id, prompt);
}

type BuiltinAction = {
  id: string;
  title: string;
  scope: "anchor" | "source";
  outputType?: string;
  params: NonNullable<KitPrompt["params"]>;
};

// All installed built-in actions (both toolbar slots), unfiltered by active kit — the
// manager lists every action a vault can run.
function listBuiltinActions(): BuiltinAction[] {
  const selection = kitSurfaceItems("selection-toolbar").map((item) => ({ item, scope: "anchor" as const }));
  const source = kitSurfaceItems("source-actions").map((item) => ({ item, scope: "source" as const }));
  return [...selection, ...source].map(({ item, scope }) => {
    const prompt = builtinPromptsById.get(item.commandId);
    return { id: item.commandId, title: item.title, scope, outputType: prompt?.outputType, params: prompt?.params ?? [] };
  });
}

// —— surface tabs (Customize Toolbar) ————————————————————————————————————————————————
// One row of small tabs above the manager list. The single SURFACE tab — "Toolbar" —
// configures the shared "passage" surface (the inline selection toolbar AND the Anchor bar
// render the SAME list); the "My Actions" tab keeps the existing builder/manager.
type SurfaceTab = "passage" | "manage";
const SURFACE_TABS: { id: SurfaceTab; label: string }[] = [
  { id: "passage", label: "Toolbar" },
  { id: "manage", label: "My Actions" }
];

// Map a Customize deep-link surface (from openOperationManager) to the tab to pre-select.
// Any passage-toolbar request — the new "passage" key OR the legacy "inline"/"anchor"/
// "bottom" values older deep-link callers may still pass — opens the single Toolbar tab;
// "my"/undefined → the builder/manager. ("bottom" maps here too so BottomBar's More menu
// never crashes the panel — BottomBar isn't docked, so it's not otherwise user-facing.)
function mapCustomizeSurfaceToTab(surface: CustomizeSurface): SurfaceTab {
  return surface === "my" || surface === undefined ? "manage" : "passage";
}

// A flattened action a surface tab can show/hide/reorder (id + label + scope/kind tags).
type SurfaceAction = { id: string; title: string; scope: "anchor" | "source"; kind: "builtin" | "operation" };

// The core "Add bookmark" action — not a kit surface item (it is hardcoded in
// WorkspaceContext), so the manager adds it explicitly to every anchor-bearing surface so
// its row is configurable here too. Mirrors BOOKMARK_ACTION's id/title in the context.
const BOOKMARK_SURFACE_ACTION: SurfaceAction = {
  id: "bookmark.add",
  title: "Bookmark",
  scope: "anchor",
  kind: "builtin"
};

// Build the action POOL the shared "passage" toolbar offers, mirroring how WorkspaceContext
// assembles `selectionActions` (so the manager configures exactly what the inline + Anchor
// toolbars render): the anchor-scope pool (Bookmark + anchor built-ins + anchor ops).
function surfacePool(builtins: SurfaceAction[], ops: SurfaceAction[]): SurfaceAction[] {
  return [BOOKMARK_SURFACE_ACTION, ...builtins.filter((a) => a.scope === "anchor"), ...ops.filter((a) => a.scope === "anchor")];
}

// The well-known variable SOURCES the run command can supply automatically (the user
// inserts these as one-click blocks; anything else they name becomes a literal).
const WELL_KNOWN: { name: string; label: string }[] = [
  { name: "anchorText", label: "选中段落" },
  { name: "sourceTitle", label: "来源标题" },
  { name: "existingNotes", label: "已有笔记" }
];

const VARIABLE_SOURCES: OperationVariable["source"][] = ["anchorText", "sourceTitle", "existingNotes", "literal"];

// Map a template variable name to where its value comes from at run time. The well-known
// names resolve to focus/source data; everything else is a literal the author fills.
function inferVariableSource(name: string): OperationVariable["source"] {
  if (name === "anchorText") return "anchorText";
  if (name === "sourceTitle") return "sourceTitle";
  if (["existingNotes", "explanations", "mistakes", "notes"].includes(name)) return "existingNotes";
  return "literal";
}

// Keep the declared variables in lockstep with the template: one entry per distinct
// {{name}}, preserving the author's existing config (source / label / default / required)
// and dropping variables no longer referenced.
function syncVariables(template: string, current: OperationVariable[]): OperationVariable[] {
  return extractVariables(template).map(
    (name) => current.find((variable) => variable.name === name) ?? { name, source: inferVariableSource(name), required: false }
  );
}

// Approximate a built-in's固化 prompt body as an editable template: run its build() with
// each known input replaced by its {{token}}, so the fork starts as a faithful, editable
// copy. build() is total over string inputs (arrays are JSON-stringified), so this is safe.
export function buildForkTemplate(prompt: KitPrompt): string {
  const tokens: Record<string, unknown> = {
    anchorText: "{{anchorText}}",
    sourceTitle: "{{sourceTitle}}",
    existingNotes: "{{existingNotes}}"
  };
  for (const param of prompt.params ?? []) tokens[param.name] = `{{${param.name}}}`;
  try {
    return prompt.build(tokens);
  } catch {
    return "";
  }
}

// scope follows the variables: anything that reads the focused passage is anchor-scope,
// otherwise it synthesizes over the whole source.
function scopeForVariables(variables: OperationVariable[]): "anchor" | "source" {
  return variables.some((variable) => variable.source === "anchorText") ? "anchor" : "source";
}

function OperationManagerView({ ctx }: { ctx: WorkspaceContext }) {
  const { operations, operationPrefs, refreshOperations, dispatch, saveActionPrefs, customizeSurface } = ctx;
  const [error, setError] = useState("");
  // Which Customize tab is active: a surface tab (per-surface show/hide + order) or the
  // existing builder/manager ("manage"). Defaults to "manage" so the panel opens to the
  // full builder the IconRail already led to.
  const [surfaceTab, setSurfaceTab] = useState<SurfaceTab>("manage");
  // The drag source id within a SURFACE tab's list (separate from the manager's dragId).
  const [surfaceDragId, setSurfaceDragId] = useState<string | null>(null);
  // The action id whose icon-picker popover is open (one at a time), or null when closed.
  const [iconPickerFor, setIconPickerFor] = useState<string | null>(null);

  // Deep-link (R6 polish): when the panel is opened via a surface's More menu, the ctx
  // carries the requested surface. Pre-select that tab ONCE per request — keyed on
  // customizeSurface so a later manual tab change isn't overridden on the next render.
  // "anchor"/"inline"/"bottom" map to the matching tab; "my"/undefined → the manager.
  useEffect(() => {
    if (customizeSurface === undefined) return;
    setSurfaceTab(mapCustomizeSurfaceToTab(customizeSurface));
  }, [customizeSurface]);

  // —— builder draft state ——
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [outputContentType, setOutputContentType] = useState("markdown");
  const [promptTemplate, setPromptTemplate] = useState("");
  const [declaredVariables, setDeclaredVariables] = useState<OperationVariable[]>([]);
  const [scope, setScope] = useState<"anchor" | "source">("anchor");
  const [source, setSource] = useState<"custom" | "fork">("custom");
  const [forkedFrom, setForkedFrom] = useState<string | undefined>(undefined);
  // The built-in this draft was seeded from (enables one-click "restore default").
  const [prefilledFrom, setPrefilledFrom] = useState("");
  const [newVarName, setNewVarName] = useState("");
  // Per-built-in placeholder param drafts (persisted to prefs on blur).
  const [paramDrafts, setParamDrafts] = useState<Record<string, Record<string, string>>>({});
  const [dragId, setDragId] = useState<string | null>(null);

  const templateRef = useRef<HTMLTextAreaElement | null>(null);

  const contentTypes = useMemo(() => listNoteContentSpecs().map((spec) => spec.contentType).sort(), []);
  const builtinActions = useMemo(() => listBuiltinActions(), []);

  // Edit the template AND re-derive the declared variables from it in one step, so the
  // advanced section always matches the {{blocks}} in the body.
  const applyTemplate = useCallback((next: string) => {
    setPromptTemplate(next);
    setDeclaredVariables((current) => syncVariables(next, current));
  }, []);

  // Insert a variable as a content BLOCK at the caret — the author never types braces.
  const insertVariable = useCallback(
    (variableName: string) => {
      const token = `{{${variableName}}}`;
      const textarea = templateRef.current;
      const start = textarea?.selectionStart ?? promptTemplate.length;
      const end = textarea?.selectionEnd ?? promptTemplate.length;
      const next = promptTemplate.slice(0, start) + token + promptTemplate.slice(end);
      applyTemplate(next);
      requestAnimationFrame(() => {
        if (!textarea) return;
        const caret = start + token.length;
        textarea.focus();
        textarea.setSelectionRange(caret, caret);
      });
    },
    [promptTemplate, applyTemplate]
  );

  const addNamedVariable = useCallback(() => {
    const variableName = newVarName.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variableName)) return;
    insertVariable(variableName);
    setNewVarName("");
  }, [newVarName, insertVariable]);

  const updateVariable = useCallback((variableName: string, patch: Partial<OperationVariable>) => {
    setDeclaredVariables((current) =>
      current.map((variable) => (variable.name === variableName ? { ...variable, ...patch } : variable))
    );
  }, []);

  // —— builder lifecycle ——
  const resetBuilder = useCallback(() => {
    setEditId(null);
    setName("");
    setDescription("");
    setOutputContentType("markdown");
    setPromptTemplate("");
    setDeclaredVariables([]);
    setScope("anchor");
    setSource("custom");
    setForkedFrom(undefined);
    setPrefilledFrom("");
    setError("");
  }, []);

  const loadOperation = useCallback((operation: OperationRecord) => {
    setEditId(operation.id);
    setName(operation.name);
    setDescription(operation.description ?? "");
    setOutputContentType(operation.outputContentType);
    setPromptTemplate(operation.promptTemplate);
    setDeclaredVariables(operation.declaredVariables);
    setScope(operation.scope);
    setSource(operation.source);
    setForkedFrom(operation.forkedFrom);
    setPrefilledFrom(operation.forkedFrom ?? "");
    setError("");
  }, []);

  // Seed (or restore) the editor from a built-in default. `asFork` marks the draft a
  // fork of that built-in; otherwise it just prefills a fresh custom op.
  const seedFromBuiltin = useCallback((promptId: string, asFork: boolean) => {
    const prompt = builtinPromptsById.get(promptId);
    if (!prompt) return;
    const template = buildForkTemplate(prompt);
    const variables = syncVariables(template, []);
    setPromptTemplate(template);
    setDeclaredVariables(variables);
    setOutputContentType(prompt.outputType);
    setScope(scopeForVariables(variables));
    setPrefilledFrom(promptId);
    if (asFork) {
      setSource("fork");
      setForkedFrom(promptId);
    }
  }, []);

  const canSave = !!name.trim() && !!promptTemplate.trim() && !!outputContentType.trim();

  // Persist the draft (create or update); returns the op id for "试一下".
  const saveOperation = useCallback(async (): Promise<string | null> => {
    if (!canSave) return null;
    const body: OperationInput = {
      name: name.trim(),
      description: description.trim() || undefined,
      outputContentType,
      promptTemplate,
      declaredVariables,
      source,
      forkedFrom,
      scope
    };
    setError("");
    try {
      if (editId) {
        await entityClient.updateOperation(editId, body);
        refreshOperations();
        return editId;
      }
      const { operation } = await entityClient.createOperation(body);
      setEditId(operation.id);
      refreshOperations();
      return operation.id;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save operation");
      return null;
    }
  }, [canSave, name, description, outputContentType, promptTemplate, declaredVariables, source, forkedFrom, scope, editId, refreshOperations]);

  // 试一下 — save, then run through the shipped generation-preview loop. operation.run
  // resolves the SAVED template server-side, so we persist first.
  const tryOperation = useCallback(async () => {
    const id = await saveOperation();
    if (!id) return;
    await dispatch("operation.run", { operationId: id, outputType: outputContentType, scope, variables: declaredVariables });
  }, [saveOperation, dispatch, outputContentType, scope, declaredVariables]);

  const deleteOperation = useCallback(
    async (operation: OperationRecord) => {
      if (typeof window !== "undefined" && !window.confirm(`Delete the "${operation.name}" action?`)) return;
      setError("");
      try {
        await entityClient.deleteOperation(operation.id);
        if (editId === operation.id) resetBuilder();
        refreshOperations();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete operation");
      }
    },
    [editId, resetBuilder, refreshOperations]
  );

  // Fork a built-in into an editable Operation, then open it in the builder.
  const forkBuiltin = useCallback(
    async (action: BuiltinAction) => {
      const prompt = builtinPromptsById.get(action.id);
      if (!prompt) return;
      const template = buildForkTemplate(prompt);
      const variables = syncVariables(template, []);
      setError("");
      try {
        const { operation } = await entityClient.createOperation({
          name: `${action.title}（我的副本）`,
          outputContentType: prompt.outputType,
          promptTemplate: template,
          declaredVariables: variables,
          source: "fork",
          forkedFrom: action.id,
          scope: scopeForVariables(variables)
        });
        refreshOperations();
        loadOperation(operation);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fork action");
      }
    },
    [refreshOperations, loadOperation]
  );

  // —— manager prefs writes ——
  const savePrefs = useCallback(
    async (next: Parameters<typeof entityClient.saveOperationPrefs>[0]) => {
      setError("");
      try {
        await entityClient.saveOperationPrefs(next);
        refreshOperations();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save action prefs");
      }
    },
    [refreshOperations]
  );

  const toggleEnabled = useCallback(
    (id: string) => {
      const disabled = operationPrefs.disabled.includes(id)
        ? operationPrefs.disabled.filter((x) => x !== id)
        : [...operationPrefs.disabled, id];
      void savePrefs({ ...operationPrefs, disabled });
    },
    [operationPrefs, savePrefs]
  );

  const persistParam = useCallback(
    (promptId: string, key: string) => {
      const value = paramDrafts[promptId]?.[key];
      if (value === undefined) return;
      const params = {
        ...operationPrefs.params,
        [promptId]: { ...(operationPrefs.params[promptId] ?? {}), [key]: value }
      };
      void savePrefs({ ...operationPrefs, params });
    },
    [paramDrafts, operationPrefs, savePrefs]
  );

  // One merged, prefs-ordered list (built-in + custom) for the manager.
  type ManagerItem =
    | { id: string; title: string; kind: "builtin"; scope: "anchor" | "source"; action: BuiltinAction }
    | { id: string; title: string; kind: "operation"; scope: "anchor" | "source"; op: OperationRecord };

  const managerItems = useMemo<ManagerItem[]>(() => {
    const items: ManagerItem[] = [
      ...builtinActions.map(
        (action): ManagerItem => ({ id: action.id, title: action.title, kind: "builtin", scope: action.scope, action })
      ),
      ...operations.map(
        (op): ManagerItem => ({ id: op.id, title: op.name, kind: "operation", scope: op.scope, op })
      )
    ];
    const indexOf = (id: string) => {
      const i = operationPrefs.order.indexOf(id);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    return [...items].sort((a, b) => indexOf(a.id) - indexOf(b.id));
  }, [builtinActions, operations, operationPrefs]);

  // Drag-to-reorder: drop `dragId` in front of the target id and persist the new order.
  const onDropOn = useCallback(
    (targetId: string) => {
      if (!dragId || dragId === targetId) {
        setDragId(null);
        return;
      }
      const ids = managerItems.map((item) => item.id);
      const from = ids.indexOf(dragId);
      const to = ids.indexOf(targetId);
      if (from === -1 || to === -1) {
        setDragId(null);
        return;
      }
      ids.splice(from, 1);
      ids.splice(to, 0, dragId);
      setDragId(null);
      void savePrefs({ ...operationPrefs, order: ids });
    },
    [dragId, managerItems, operationPrefs, savePrefs]
  );

  // —— per-surface customize (R6.3) ——————————————————————————————————————————————————
  // The flattened built-in + custom action pools, in SurfaceAction shape, reused by every
  // surface tab. (builtinActions/operations are already loaded for the manager above.)
  const builtinSurfaceActions = useMemo<SurfaceAction[]>(
    () => builtinActions.map((a) => ({ id: a.id, title: a.title, scope: a.scope, kind: "builtin" })),
    [builtinActions]
  );
  const opSurfaceActions = useMemo<SurfaceAction[]>(
    () => operations.map((op) => ({ id: op.id, title: op.name, scope: op.scope, kind: "operation" })),
    [operations]
  );

  // The active surface tab's arranged list: the surface's pool, sorted by its per-surface
  // `order` (unlisted ids keep pool order). Empty when the "manage" tab is active.
  const surfaceList = useMemo<SurfaceAction[]>(() => {
    if (surfaceTab === "manage") return [];
    const pool = surfacePool(builtinSurfaceActions, opSurfaceActions);
    const order = operationPrefs.surfaces?.[surfaceTab]?.order ?? [];
    const indexOf = (id: string) => {
      const i = order.indexOf(id);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    return [...pool].sort((a, b) => indexOf(a.id) - indexOf(b.id));
  }, [surfaceTab, builtinSurfaceActions, opSurfaceActions, operationPrefs]);

  // Whether an id is HIDDEN on the active surface (per-surface `hidden` set).
  const isHiddenOnSurface = useCallback(
    (surface: ActionSurface, id: string) => (operationPrefs.surfaces?.[surface]?.hidden ?? []).includes(id),
    [operationPrefs]
  );

  // Patch one surface's prefs entry and persist through the ctx seam (never entityClient
  // directly). Reads the current entry (or empty), applies the patch, writes the whole
  // prefs object back.
  const writeSurface = useCallback(
    (surface: ActionSurface, patch: Partial<{ order: string[]; hidden: string[] }>) => {
      const surfaces = operationPrefs.surfaces ?? {};
      const current = surfaces[surface] ?? { order: [], hidden: [] };
      const next: OperationPrefs = {
        ...operationPrefs,
        surfaces: { ...surfaces, [surface]: { ...current, ...patch } }
      };
      setError("");
      void saveActionPrefs(next).catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to save toolbar prefs")
      );
    },
    [operationPrefs, saveActionPrefs]
  );

  // —— per-action icon picker (R6 polish) ——————————————————————————————————————————————
  // Write the chosen icon NAME for an action id into the GLOBAL `prefs.icons` map (so the
  // glyph is consistent across every surface), through the ctx seam. `name === null`
  // RESETS (deletes the entry → actionIcon falls back to the action's default glyph).
  const setActionIcon = useCallback(
    (actionId: string, name: string | null) => {
      const icons = { ...(operationPrefs.icons ?? {}) };
      if (name === null) delete icons[actionId];
      else icons[actionId] = name;
      const next: OperationPrefs = { ...operationPrefs, icons };
      setError("");
      setIconPickerFor(null);
      void saveActionPrefs(next).catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to save icon")
      );
    },
    [operationPrefs, saveActionPrefs]
  );

  // Toggle show/hide for an id on a surface (writes the surface's `hidden` set).
  const toggleHiddenOnSurface = useCallback(
    (surface: ActionSurface, id: string) => {
      const hidden = isHiddenOnSurface(surface, id)
        ? (operationPrefs.surfaces?.[surface]?.hidden ?? []).filter((x) => x !== id)
        : [...(operationPrefs.surfaces?.[surface]?.hidden ?? []), id];
      writeSurface(surface, { hidden });
    },
    [operationPrefs, isHiddenOnSurface, writeSurface]
  );

  // Drag-reorder within a surface tab: drop `surfaceDragId` in front of `targetId`. The
  // new order is the full visible pool order (so it's complete + stable), persisted to the
  // surface's `order`.
  const dropOnSurface = useCallback(
    (surface: ActionSurface, targetId: string) => {
      if (!surfaceDragId || surfaceDragId === targetId) {
        setSurfaceDragId(null);
        return;
      }
      const ids = surfaceList.map((a) => a.id);
      const from = ids.indexOf(surfaceDragId);
      const to = ids.indexOf(targetId);
      if (from === -1 || to === -1) {
        setSurfaceDragId(null);
        return;
      }
      ids.splice(from, 1);
      ids.splice(to, 0, surfaceDragId);
      setSurfaceDragId(null);
      writeSurface(surface, { order: ids });
    },
    [surfaceDragId, surfaceList, writeSurface]
  );

  // Arrow reorder (keyboard/click fallback): move an id one slot up/down in the surface
  // order (persists the full order, like drag).
  const moveOnSurface = useCallback(
    (surface: ActionSurface, id: string, delta: -1 | 1) => {
      const ids = surfaceList.map((a) => a.id);
      const from = ids.indexOf(id);
      const to = from + delta;
      if (from === -1 || to < 0 || to >= ids.length) return;
      ids.splice(from, 1);
      ids.splice(to, 0, id);
      writeSurface(surface, { order: ids });
    },
    [surfaceList, writeSurface]
  );

  // Reset a surface to default: drop its per-surface entry so it falls back to the global
  // order/disabled (the pre-R6.3 behavior).
  const resetSurface = useCallback(
    (surface: ActionSurface) => {
      const surfaces = { ...(operationPrefs.surfaces ?? {}) };
      delete surfaces[surface];
      const next: OperationPrefs = { ...operationPrefs, surfaces };
      setError("");
      void saveActionPrefs(next).catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to reset toolbar")
      );
    },
    [operationPrefs, saveActionPrefs]
  );

  // Live preview values: each variable replaced by the current passage's real text (or a
  // readable placeholder when nothing is selected); literals show their default.
  const preview = useMemo(() => {
    const values: Record<string, unknown> = {};
    for (const variable of declaredVariables) {
      switch (variable.source) {
        case "anchorText":
          values[variable.name] = ctx.draftQuote || "〔选中的段落文本〕";
          break;
        case "sourceTitle":
          values[variable.name] = ctx.activeSource?.title || "〔来源标题〕";
          break;
        case "existingNotes":
          values[variable.name] = "〔已有笔记内容〕";
          break;
        default:
          values[variable.name] = variable.default ?? `〔${variable.label || variable.name}〕`;
      }
    }
    return renderTemplate(promptTemplate, values);
  }, [declaredVariables, promptTemplate, ctx.draftQuote, ctx.activeSource]);

  return (
    <aside className="operation-panel">
      <div className="panel-title">
        <Wand2 size={16} />
        Actions
      </div>

      {error ? <div className="error-box">{error}</div> : null}

      {/* —— Surface tabs (R6.3 Customize Toolbar) —— pick a surface to configure its
          per-surface show/hide + order, or "My Actions" for the builder/manager. */}
      <div className="operation-surface-tabs" role="tablist" aria-label="Customize toolbar surface">
        {SURFACE_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={surfaceTab === tab.id}
            className={`operation-surface-tab${surfaceTab === tab.id ? " active" : ""}`}
            data-surface-tab={tab.id}
            onClick={() => setSurfaceTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* —— SURFACE CUSTOMIZE (R6.3) —— per-surface show/hide + reorder of the actions a
          surface renders, persisted to prefs.surfaces[surface]. Shown for the three
          surface tabs; "My Actions" falls through to the builder/manager below. */}
      {surfaceTab !== "manage" ? (
        <section className="operation-surface-customize" data-surface={surfaceTab}>
          <div className="operation-surface-head">
            <span className="operation-surface-title">
              {SURFACE_TABS.find((t) => t.id === surfaceTab)?.label} toolbar
            </span>
            <button
              type="button"
              className="link-button operation-surface-reset"
              title="Reset this surface to the default order/visibility"
              onClick={() => resetSurface(surfaceTab)}
            >
              <RotateCcw size={13} />
              Reset to default
            </button>
          </div>
          <div className="operation-surface-list">
            {surfaceList.map((action, index) => {
              const hidden = isHiddenOnSurface(surfaceTab, action.id);
              const override = operationPrefs.icons?.[action.id];
              // Resolve the row's current glyph via the SHARED actionIcon (so the picker
              // button shows exactly what the toolbars render): the override wins, else the
              // action's default. (SurfaceAction has no outputType, so an un-overridden op
              // shows the wand here — the override is what the picker sets.)
              const CurrentIcon = actionIcon({
                id: action.id,
                title: action.title,
                icon: override,
                kind: action.kind,
                scope: action.scope
              });
              const pickerOpen = iconPickerFor === action.id;
              return (
                <div
                  key={action.id}
                  className={`operation-surface-row${hidden ? " hidden" : ""}`}
                  data-surface-action-id={action.id}
                  data-action-kind={action.kind}
                  draggable
                  onDragStart={() => setSurfaceDragId(action.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => dropOnSurface(surfaceTab, action.id)}
                >
                  <GripVertical size={14} className="operation-drag-handle" />
                  {/* Per-action icon picker (R6 polish): the button shows the current glyph;
                      clicking opens an inline grid of ICON_CHOICES. Selecting writes the
                      GLOBAL prefs.icons[id] (consistent across surfaces); "Reset" clears it. */}
                  <span className="operation-icon-picker">
                    <button
                      type="button"
                      className={`operation-icon-btn${pickerOpen ? " active" : ""}`}
                      aria-label="Change icon"
                      aria-haspopup="menu"
                      aria-expanded={pickerOpen}
                      title="Change icon"
                      onClick={() => setIconPickerFor(pickerOpen ? null : action.id)}
                    >
                      <CurrentIcon size={15} />
                    </button>
                    {pickerOpen ? (
                      <div className="operation-icon-pop" role="menu">
                        <div className="operation-icon-grid">
                          {ICON_CHOICES.map((choice) => {
                            const ChoiceIcon = choice.Icon;
                            return (
                              <button
                                key={choice.name}
                                type="button"
                                className={`operation-icon-choice${override === choice.name ? " active" : ""}`}
                                data-icon-name={choice.name}
                                title={choice.name}
                                aria-label={choice.name}
                                onClick={() => setActionIcon(action.id, choice.name)}
                              >
                                <ChoiceIcon size={16} />
                              </button>
                            );
                          })}
                        </div>
                        <button
                          type="button"
                          className="link-button operation-icon-reset"
                          disabled={!override}
                          onClick={() => setActionIcon(action.id, null)}
                        >
                          <RotateCcw size={12} />
                          Reset icon
                        </button>
                      </div>
                    ) : null}
                  </span>
                  <label className="operation-toggle-label">
                    <input
                      type="checkbox"
                      className="operation-surface-toggle"
                      checked={!hidden}
                      onChange={() => toggleHiddenOnSurface(surfaceTab, action.id)}
                    />
                    <span className="operation-action-name">{action.title}</span>
                  </label>
                  <span className="operation-action-tag" data-scope={action.scope}>
                    {action.scope === "source" ? "source" : "passage"}
                  </span>
                  <span className="operation-action-tag" data-kind={action.kind}>
                    {action.kind === "builtin" ? "built-in" : "custom"}
                  </span>
                  <span className="operation-surface-move">
                    <button
                      type="button"
                      className="link-button operation-surface-up"
                      aria-label="Move up"
                      disabled={index === 0}
                      onClick={() => moveOnSurface(surfaceTab, action.id, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="link-button operation-surface-down"
                      aria-label="Move down"
                      disabled={index === surfaceList.length - 1}
                      onClick={() => moveOnSurface(surfaceTab, action.id, 1)}
                    >
                      ↓
                    </button>
                  </span>
                </div>
              );
            })}
            {surfaceList.length === 0 ? <div className="empty-state">No actions for this surface.</div> : null}
          </div>
        </section>
      ) : null}

      {/* —— BUILDER —————————————————————————————————————————————————————————— */}
      {surfaceTab === "manage" ? (
      <>
      <section className="operation-builder">
        <div className="operation-builder-head">
          <span className="operation-builder-title">{editId ? "Edit action" : "New action"}</span>
          <button type="button" className="link-button operation-new-btn" onClick={resetBuilder}>
            <Plus size={14} />
            New
          </button>
        </div>

        <input
          className="operation-name-input"
          placeholder="Action name…"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <input
          className="operation-description-input"
          placeholder="Description (optional)"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />

        <div className="operation-row">
          <label className="operation-field">
            <span>Output type</span>
            <select
              className="operation-output-select"
              value={outputContentType}
              onChange={(event) => setOutputContentType(event.target.value)}
            >
              {contentTypes.map((contentType) => (
                <option key={contentType} value={contentType}>
                  {contentType}
                </option>
              ))}
            </select>
          </label>
          <label className="operation-field">
            <span>Runs on</span>
            <select
              className="operation-scope-select"
              value={scope}
              onChange={(event) => setScope(event.target.value as "anchor" | "source")}
            >
              <option value="anchor">Selected passage</option>
              <option value="source">Whole source</option>
            </select>
          </label>
        </div>

        {/* Prefill the editor from a built-in default (one-click restore below). */}
        <label className="operation-field operation-prefill">
          <span>Start from a built-in</span>
          <select
            className="operation-prefill-select"
            value={prefilledFrom}
            onChange={(event) => {
              if (event.target.value) seedFromBuiltin(event.target.value, false);
            }}
          >
            <option value="">— blank —</option>
            {builtinActions.map((action) => (
              <option key={action.id} value={action.id}>
                {action.title}
              </option>
            ))}
          </select>
        </label>

        {/* Variable BLOCKS — clicking inserts {{name}} at the caret (no typing braces). */}
        <div className="operation-var-row">
          <span className="operation-var-label">Insert variable:</span>
          {WELL_KNOWN.map((variable) => (
            <button
              key={variable.name}
              type="button"
              className="operation-var-btn"
              data-var={variable.name}
              onClick={() => insertVariable(variable.name)}
            >
              {variable.label}
            </button>
          ))}
        </div>

        <textarea
          ref={templateRef}
          className="operation-template-input"
          placeholder="Write the instruction. Use the buttons above to drop in variables…"
          value={promptTemplate}
          onChange={(event) => applyTemplate(event.target.value)}
        />

        {/* Live preview: blocks replaced with the current passage's real text. */}
        <div className="operation-preview-head">Live preview</div>
        <pre className="operation-preview">{preview || "〔nothing yet〕"}</pre>

        {/* Advanced: the declared variables auto-seeded from the template. */}
        <details className="operation-vars-advanced">
          <summary>Variables ({declaredVariables.length})</summary>
          <div className="operation-add-var">
            <input
              className="operation-add-var-input"
              placeholder="new variable name"
              value={newVarName}
              onChange={(event) => setNewVarName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addNamedVariable();
                }
              }}
            />
            <button type="button" className="link-button operation-add-var-btn" onClick={addNamedVariable}>
              <Plus size={13} />
              Add
            </button>
          </div>
          {declaredVariables.map((variable) => (
            <div key={variable.name} className="operation-var-edit" data-var={variable.name}>
              <code className="operation-var-name">{variable.name}</code>
              <select
                className="operation-var-source"
                value={variable.source}
                onChange={(event) =>
                  updateVariable(variable.name, { source: event.target.value as OperationVariable["source"] })
                }
              >
                {VARIABLE_SOURCES.map((sourceKind) => (
                  <option key={sourceKind} value={sourceKind}>
                    {sourceKind}
                  </option>
                ))}
              </select>
              {variable.source === "literal" ? (
                <input
                  className="operation-var-default"
                  placeholder="default value"
                  value={variable.default ?? ""}
                  onChange={(event) => updateVariable(variable.name, { default: event.target.value })}
                />
              ) : null}
              <label className="operation-var-required">
                <input
                  type="checkbox"
                  checked={variable.required}
                  onChange={(event) => updateVariable(variable.name, { required: event.target.checked })}
                />
                required
              </label>
            </div>
          ))}
          {declaredVariables.length === 0 ? <div className="empty-state">No variables yet.</div> : null}
        </details>

        <div className="operation-builder-actions">
          <button
            type="button"
            className="icon-button primary operation-save-btn"
            disabled={!canSave}
            onClick={() => void saveOperation()}
          >
            Save
          </button>
          <button
            type="button"
            className="icon-button operation-try-btn"
            disabled={!canSave}
            title="Save and run through the generation preview"
            onClick={() => void tryOperation()}
          >
            <Play size={15} />
            试一下
          </button>
          {prefilledFrom ? (
            <button
              type="button"
              className="link-button operation-restore-btn"
              title="Restore the built-in default template"
              onClick={() => seedFromBuiltin(prefilledFrom, source === "fork")}
            >
              <RotateCcw size={13} />
              Restore default
            </button>
          ) : null}
        </div>
      </section>

      {/* —— MANAGER ———————————————————————————————————————————————————————————— */}
      <section className="operation-manager">
        <div className="operation-manager-title">Action toolbar order</div>
        <div className="operation-action-list">
          {managerItems.map((item) => {
            const enabled = !operationPrefs.disabled.includes(item.id);
            return (
              <div
                key={item.id}
                className={`operation-action-row${enabled ? "" : " disabled"}`}
                data-action-id={item.id}
                data-action-kind={item.kind}
                draggable
                onDragStart={() => setDragId(item.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => onDropOn(item.id)}
              >
                <div className="operation-action-main">
                  <GripVertical size={14} className="operation-drag-handle" />
                  <label className="operation-toggle-label">
                    <input
                      type="checkbox"
                      className="operation-toggle"
                      checked={enabled}
                      onChange={() => toggleEnabled(item.id)}
                    />
                    <span className="operation-action-name">{item.title}</span>
                  </label>
                  <span className="operation-action-tag" data-scope={item.scope}>
                    {item.scope === "source" ? "source" : "passage"}
                  </span>
                  <span className="operation-action-tag" data-kind={item.kind}>
                    {item.kind === "builtin" ? "built-in" : "custom"}
                  </span>
                  {item.kind === "operation" ? (
                    <>
                      <button
                        type="button"
                        className="link-button operation-edit-btn"
                        onClick={() => loadOperation(item.op)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="link-button operation-delete-btn"
                        aria-label="Delete action"
                        onClick={() => void deleteOperation(item.op)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="link-button operation-fork-btn"
                      title="复制为我的插件"
                      onClick={() => void forkBuiltin(item.action)}
                    >
                      <Copy size={13} />
                      复制为我的插件
                    </button>
                  )}
                </div>

                {/* Built-in placeholder params (grade / difficulty / language). */}
                {item.kind === "builtin" && item.action.params.length > 0 ? (
                  <div className="operation-params">
                    {item.action.params.map((param) => {
                      const stored = operationPrefs.params[item.id]?.[param.name];
                      const draft = paramDrafts[item.id]?.[param.name];
                      const value = draft ?? stored ?? "";
                      return (
                        <label key={param.name} className="operation-param" data-param={param.name}>
                          <span>{param.label ?? param.name}</span>
                          <input
                            className="operation-param-input"
                            placeholder={param.default ?? param.kind ?? param.name}
                            value={value}
                            onChange={(event) =>
                              setParamDrafts((prev) => ({
                                ...prev,
                                [item.id]: { ...(prev[item.id] ?? {}), [param.name]: event.target.value }
                              }))
                            }
                            onBlur={() => persistParam(item.id, param.name)}
                          />
                        </label>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
          {managerItems.length === 0 ? <div className="empty-state">No actions yet.</div> : null}
        </div>
      </section>
      </>
      ) : null}
    </aside>
  );
}

registerView({ kind: "operation.manager", render: (_node, ctx) => <OperationManagerView ctx={ctx} /> });
