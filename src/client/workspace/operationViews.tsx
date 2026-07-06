// Operation workspace view — AUTHOR AI actions as DATA and MANAGE the action
// toolbars, without ever touching the core or writing a prompt as code.
//
// ACTION-2b (action-v2-auto-context.md §3): creating an action is TWO fields —
// 名字 + 一句话指令 — nothing else required:
//
//   • BUILDER (default = simple mode): name + one-sentence instruction. The engine
//     compiles the prompt at run time (auto-context preamble + instruction + output-
//     form directive), so the user never wires context and never picks an output
//     type — the adaptive-note form router decides. A 高级 accordion (collapsed by
//     default) lets you pin an explicit outputType / change the scope / convert to
//     a full template (one-way, with confirm).
//   • TEMPLATE mode (the V1 shape, for existing records and converted drafts): the
//     whole V1 chrome — output-type picker, variables-as-content-blocks, live
//     preview, declared variables — lives INSIDE the 高级 accordion, so the default
//     creation path never shows it. "试一下" persists the draft and runs it through
//     the SHIPPED generation-preview loop (operation.run → onGenerated).
//   • MANAGER: every action (built-in kit actions + custom ops) in one list, with
//     drag-to-reorder + an on/off toggle persisted to operation-prefs.json; built-in
//     rows expose their placeholder PARAMS (grade / difficulty / language) and a
//     "自定义此动作" fork into an editable Operation.
//
// Bilingual from day one (operationMessages + useLocale), modal-friendly (it renders
// inside the SHELL-4 centered modal). It talks only through the WorkspaceContext +
// entity client; the toolbars read the SAME prefs, so the order / enable-disable
// configured here is exactly what the study panel renders.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Wand2, Plus, Play, RotateCcw, Trash2, Copy, GripVertical } from "lucide-react";
import {
  operationIo,
  type OperationInput,
  type OperationRecord,
  type OperationVariable
} from "./operationIo";
import { registerView, type WorkspaceContext } from "./viewRegistry";
import type { ActionSurface, CustomizeSurface } from "./WorkspaceContext";
import type { OperationPrefs } from "./operationIo";
import { ICON_CHOICES, actionIcon } from "./actionIcons";
import { extractVariables, renderTemplate } from "../../ai/template";
import { listNoteContentSpecs } from "../../core/notes/contentTypes";
import { kitSurfaceItems } from "../../kits/clientContext";
import { productKits } from "../../kits/clientKits";
import type { KitPrompt } from "../../kits/types";
import { resolveText, t, useLocale, type Message } from "../i18n";
import { operationMessages as m } from "./operationMessages";
import { platformDialogs } from "../platform";
import "./operationViews.css";

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
// manager lists every action a vault can run. Called inside a locale-dependent memo so
// resolveText picks the active locale.
function listBuiltinActions(): BuiltinAction[] {
  const selection = kitSurfaceItems("selection-toolbar").map((item) => ({ item, scope: "anchor" as const }));
  const source = kitSurfaceItems("source-actions").map((item) => ({ item, scope: "source" as const }));
  return [...selection, ...source].map(({ item, scope }) => {
    const prompt = builtinPromptsById.get(item.commandId);
    return { id: item.commandId, title: resolveText(item.title), scope, outputType: prompt?.outputType, params: prompt?.params ?? [] };
  });
}

// —— surface tabs (Customize Toolbar) ————————————————————————————————————————————————
// One row of small tabs above the manager list. The single SURFACE tab — "Toolbar" —
// configures the shared "passage" surface (the inline selection toolbar AND the Anchor bar
// render the SAME list); the "My Actions" tab keeps the builder/manager.
type SurfaceTab = "passage" | "manage";
const SURFACE_TABS: { id: SurfaceTab; label: Message }[] = [
  { id: "passage", label: m.tabToolbar },
  { id: "manage", label: m.tabManage }
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
const WELL_KNOWN: { name: string; label: Message }[] = [
  { name: "anchorText", label: m.varAnchorText },
  { name: "sourceTitle", label: m.varSourceTitle },
  { name: "existingNotes", label: m.varExistingNotes }
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

// The inline-validation targets of the two-field creator (+ the template body when in
// template mode). Errors show under the field, bilingual, and clear as the user types.
type FieldErrorKey = "name" | "instruction" | "template";

function OperationManagerView({ ctx }: { ctx: WorkspaceContext }) {
  const { operations, operationPrefs, refreshOperations, dispatch, saveActionPrefs, customizeSurface } = ctx;
  // Subscribe to the locale so every t()/resolveText below re-renders on flip.
  const locale = useLocale();
  const [error, setError] = useState("");
  // Which Customize tab is active: the surface tab (per-surface show/hide + order) or the
  // builder/manager ("manage"). Defaults to "manage" so the panel opens to the creator.
  const [surfaceTab, setSurfaceTab] = useState<SurfaceTab>("manage");
  // The drag source id within a SURFACE tab's list (separate from the manager's dragId).
  const [surfaceDragId, setSurfaceDragId] = useState<string | null>(null);
  // The action id whose icon-picker popover is open (one at a time), or null when closed.
  const [iconPickerFor, setIconPickerFor] = useState<string | null>(null);

  // Deep-link (R6 polish): when the panel is opened via a surface's More menu, the ctx
  // carries the requested surface. Pre-select that tab ONCE per request — keyed on
  // customizeSurface so a later manual tab change isn't overridden on the next render.
  useEffect(() => {
    if (customizeSurface === undefined) return;
    setSurfaceTab(mapCustomizeSurfaceToTab(customizeSurface));
  }, [customizeSurface]);

  // —— builder draft state ——
  // `mode` mirrors the Operation entity's authoring mode (ACTION-2a): a NEW action is
  // "simple" (name + instruction, output AUTO); "template" is the V1 shape, reached by
  // editing a V1 record or converting via 高级 (one-way).
  const [editId, setEditId] = useState<string | null>(null);
  const [mode, setMode] = useState<"simple" | "template">("simple");
  const [name, setName] = useState("");
  const [instruction, setInstruction] = useState("");
  const [description, setDescription] = useState("");
  // "" = AUTO output (simple mode's default — the adaptive-note form router decides).
  // Template mode always carries a concrete type (defaulted to markdown).
  const [outputContentType, setOutputContentType] = useState("");
  const [promptTemplate, setPromptTemplate] = useState("");
  const [declaredVariables, setDeclaredVariables] = useState<OperationVariable[]>([]);
  const [scope, setScope] = useState<"anchor" | "source">("anchor");
  const [source, setSource] = useState<"custom" | "fork">("custom");
  const [forkedFrom, setForkedFrom] = useState<string | undefined>(undefined);
  // The built-in this draft was seeded from (enables one-click "restore default").
  const [prefilledFrom, setPrefilledFrom] = useState("");
  const [newVarName, setNewVarName] = useState("");
  // Inline validation state: which required fields were empty on the last save attempt.
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldErrorKey, boolean>>>({});
  // Whether the 高级 accordion is open (collapsed on every fresh draft; opened when
  // editing a template op — its whole chrome lives inside).
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Per-built-in placeholder param drafts (persisted to prefs on blur).
  const [paramDrafts, setParamDrafts] = useState<Record<string, Record<string, string>>>({});
  const [dragId, setDragId] = useState<string | null>(null);

  const templateRef = useRef<HTMLTextAreaElement | null>(null);

  const contentTypes = useMemo(() => listNoteContentSpecs().map((spec) => spec.contentType).sort(), []);
  // Locale-dependent: built-in titles resolve through resolveText at assembly time.
  const builtinActions = useMemo(() => listBuiltinActions(), [locale]);

  const clearFieldError = useCallback((key: FieldErrorKey) => {
    setFieldErrors((prev) => (prev[key] ? { ...prev, [key]: false } : prev));
  }, []);

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
    setMode("simple");
    setName("");
    setInstruction("");
    setDescription("");
    setOutputContentType("");
    setPromptTemplate("");
    setDeclaredVariables([]);
    setScope("anchor");
    setSource("custom");
    setForkedFrom(undefined);
    setPrefilledFrom("");
    setFieldErrors({});
    setAdvancedOpen(false);
    setError("");
  }, []);

  const loadOperation = useCallback((operation: OperationRecord) => {
    setEditId(operation.id);
    setMode(operation.mode);
    setName(operation.name);
    setInstruction(operation.instruction ?? "");
    setDescription(operation.description ?? "");
    // Simple mode keeps "" = AUTO when no pin; template mode needs a concrete type.
    setOutputContentType(operation.outputContentType ?? (operation.mode === "template" ? "markdown" : ""));
    setPromptTemplate(operation.promptTemplate ?? "");
    setDeclaredVariables(operation.declaredVariables);
    setScope(operation.scope);
    setSource(operation.source);
    setForkedFrom(operation.forkedFrom);
    setPrefilledFrom(operation.forkedFrom ?? "");
    setFieldErrors({});
    // Editing a simple action = the same two fields (高级 stays folded); a template
    // op's entire chrome lives inside 高级, so open it.
    setAdvancedOpen(operation.mode === "template");
    setError("");
  }, []);

  // Seed (or restore) the editor from a built-in default. `asFork` marks the draft a
  // fork of that built-in; otherwise it just prefills a fresh custom op.
  const seedFromBuiltin = useCallback((promptId: string, asFork: boolean) => {
    const prompt = builtinPromptsById.get(promptId);
    if (!prompt) return;
    const template = buildForkTemplate(prompt);
    const variables = syncVariables(template, []);
    setMode("template");
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

  // 高级 → "编辑为完整模板": one-way convert (with confirm) of a simple draft into the
  // V1 template shape. The instruction seeds the template (with the selection block
  // appended, since simple actions read the selection through the auto envelope).
  const convertToTemplate = useCallback(async () => {
    if (!(await platformDialogs().confirm(t(m.convertConfirm)))) return;
    const seed = promptTemplate.trim() || [instruction.trim(), "{{anchorText}}"].filter(Boolean).join("\n\n");
    setMode("template");
    if (!outputContentType) setOutputContentType("markdown");
    applyTemplate(seed);
    setFieldErrors({});
    setAdvancedOpen(true);
  }, [promptTemplate, instruction, outputContentType, applyTemplate]);

  // Attempt-time validation: empty name / instruction (simple) / template (template)
  // is rejected INLINE (bilingual message under the field), nothing is sent.
  const validateDraft = useCallback((): boolean => {
    const errors: Partial<Record<FieldErrorKey, boolean>> = {};
    if (!name.trim()) errors.name = true;
    if (mode === "simple" && !instruction.trim()) errors.instruction = true;
    if (mode === "template" && !promptTemplate.trim()) errors.template = true;
    setFieldErrors(errors);
    return !errors.name && !errors.instruction && !errors.template;
  }, [name, mode, instruction, promptTemplate]);

  // Persist the draft (create or update); returns the op id for "试一下".
  const saveOperation = useCallback(async (): Promise<string | null> => {
    if (!validateDraft()) return null;
    const body: OperationInput =
      mode === "simple"
        ? {
            name: name.trim(),
            description: description.trim() || undefined,
            mode: "simple",
            instruction: instruction.trim(),
            // "" = AUTO. On CREATE, omit (absent = no pin). On UPDATE, send explicit
            // null to UN-PIN a previously stored type — undefined would be dropped by
            // JSON.stringify and leave the old pin in place.
            outputContentType: outputContentType ? outputContentType : editId ? null : undefined,
            source,
            forkedFrom,
            scope
          }
        : {
            name: name.trim(),
            description: description.trim() || undefined,
            mode: "template",
            outputContentType: outputContentType || "markdown",
            promptTemplate,
            declaredVariables,
            source,
            forkedFrom,
            scope
          };
    setError("");
    try {
      if (editId) {
        await operationIo.updateOperation(editId, body);
        refreshOperations();
        return editId;
      }
      const { operation } = await operationIo.createOperation(body);
      setEditId(operation.id);
      refreshOperations();
      return operation.id;
    } catch (err) {
      setError(err instanceof Error ? err.message : t(m.saveFailed));
      return null;
    }
  }, [validateDraft, mode, name, instruction, description, outputContentType, promptTemplate, declaredVariables, source, forkedFrom, scope, editId, refreshOperations]);

  // 试一下 — save, then run through the shipped generation-preview loop. operation.run
  // resolves the SAVED record server-side, so we persist first. An un-pinned simple
  // action sends NO outputType: the auto-context envelope + form router take over.
  const tryOperation = useCallback(async () => {
    const id = await saveOperation();
    if (!id) return;
    await dispatch("operation.run", {
      operationId: id,
      outputType: outputContentType || undefined,
      scope,
      variables: mode === "simple" ? [] : declaredVariables
    });
  }, [saveOperation, dispatch, outputContentType, scope, declaredVariables, mode]);

  const deleteOperation = useCallback(
    async (operation: OperationRecord) => {
      if (!(await platformDialogs().confirm(t(m.deleteConfirm).replace("{name}", operation.name)))) return;
      setError("");
      try {
        await operationIo.deleteOperation(operation.id);
        if (editId === operation.id) resetBuilder();
        refreshOperations();
      } catch (err) {
        setError(err instanceof Error ? err.message : t(m.deleteFailed));
      }
    },
    [editId, resetBuilder, refreshOperations]
  );

  // Fork a built-in into an editable Operation ("自定义此动作"), then open it in the
  // builder (template mode — the fork is a faithful editable copy of the built-in).
  const forkBuiltin = useCallback(
    async (action: BuiltinAction) => {
      const prompt = builtinPromptsById.get(action.id);
      if (!prompt) return;
      const template = buildForkTemplate(prompt);
      const variables = syncVariables(template, []);
      setError("");
      try {
        const { operation } = await operationIo.createOperation({
          name: `${action.title}${t(m.forkSuffix)}`,
          mode: "template",
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
        setError(err instanceof Error ? err.message : t(m.forkFailed));
      }
    },
    [refreshOperations, loadOperation]
  );

  // —— manager prefs writes ——
  const savePrefs = useCallback(
    async (next: Parameters<typeof operationIo.saveOperationPrefs>[0]) => {
      setError("");
      try {
        await operationIo.saveOperationPrefs(next);
        refreshOperations();
      } catch (err) {
        setError(err instanceof Error ? err.message : t(m.prefsFailed));
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
        setError(err instanceof Error ? err.message : t(m.toolbarPrefsFailed))
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
        setError(err instanceof Error ? err.message : t(m.iconFailed))
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
        setError(err instanceof Error ? err.message : t(m.resetToolbarFailed))
      );
    },
    [operationPrefs, saveActionPrefs]
  );

  // Live preview values (template mode): each variable replaced by the current passage's
  // real text (or a readable placeholder when nothing is selected); literals show their
  // default.
  const preview = useMemo(() => {
    const values: Record<string, unknown> = {};
    for (const variable of declaredVariables) {
      switch (variable.source) {
        case "anchorText":
          values[variable.name] = ctx.draftQuote || t(m.previewSelectionPlaceholder);
          break;
        case "sourceTitle":
          values[variable.name] = ctx.activeSource?.title || t(m.previewSourceTitlePlaceholder);
          break;
        case "existingNotes":
          values[variable.name] = t(m.previewNotesPlaceholder);
          break;
        default:
          values[variable.name] = variable.default ?? `〔${variable.label || variable.name}〕`;
      }
    }
    return renderTemplate(promptTemplate, values);
  }, [declaredVariables, promptTemplate, ctx.draftQuote, ctx.activeSource, locale]);

  return (
    <aside className="operation-panel">
      <div className="panel-title">
        <Wand2 size={16} />
        {t(m.panelTitle)}
      </div>

      {error ? <div className="error-box">{error}</div> : null}

      {/* —— Surface tabs (R6.3 Customize Toolbar) —— pick a surface to configure its
          per-surface show/hide + order, or "My Actions" for the builder/manager. */}
      <div className="operation-surface-tabs" role="tablist" aria-label={t(m.tablistLabel)}>
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
            {t(tab.label)}
          </button>
        ))}
      </div>

      {/* —— SURFACE CUSTOMIZE (R6.3) —— per-surface show/hide + reorder of the actions a
          surface renders, persisted to prefs.surfaces[surface]. Shown for the surface
          tab; "My Actions" falls through to the builder/manager below. */}
      {surfaceTab !== "manage" ? (
        <section className="operation-surface-customize" data-surface={surfaceTab}>
          <div className="operation-surface-head">
            <span className="operation-surface-title">{t(m.passageSurfaceTitle)}</span>
            <button
              type="button"
              className="link-button operation-surface-reset"
              title={t(m.resetSurfaceHint)}
              onClick={() => resetSurface(surfaceTab)}
            >
              <RotateCcw size={13} />
              {t(m.resetSurface)}
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
                      aria-label={t(m.changeIcon)}
                      aria-haspopup="menu"
                      aria-expanded={pickerOpen}
                      title={t(m.changeIcon)}
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
                          {t(m.resetIcon)}
                        </button>
                      </div>
                    ) : null}
                  </span>
                  <label className="operation-toggle-label operation-switch-label">
                    <span className="operation-action-name">{action.title}</span>
                    <span className="sv-switch">
                      <input
                        type="checkbox"
                        className="operation-surface-toggle sv-switch-input"
                        checked={!hidden}
                        onChange={() => toggleHiddenOnSurface(surfaceTab, action.id)}
                      />
                      <span className="sv-switch-track" aria-hidden="true" />
                    </span>
                  </label>
                  <span className="operation-action-tag" data-scope={action.scope}>
                    {action.scope === "source" ? t(m.tagSource) : t(m.tagPassage)}
                  </span>
                  <span className="operation-action-tag" data-kind={action.kind}>
                    {action.kind === "builtin" ? t(m.tagBuiltin) : t(m.tagCustom)}
                  </span>
                  <span className="operation-surface-move">
                    <button
                      type="button"
                      className="link-button operation-surface-up"
                      aria-label={t(m.moveUp)}
                      disabled={index === 0}
                      onClick={() => moveOnSurface(surfaceTab, action.id, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="link-button operation-surface-down"
                      aria-label={t(m.moveDown)}
                      disabled={index === surfaceList.length - 1}
                      onClick={() => moveOnSurface(surfaceTab, action.id, 1)}
                    >
                      ↓
                    </button>
                  </span>
                </div>
              );
            })}
            {surfaceList.length === 0 ? <div className="empty-state">{t(m.emptySurface)}</div> : null}
          </div>
        </section>
      ) : null}

      {/* —— BUILDER (ACTION-2b: the two-field 一句话新增 creator) ——————————————— */}
      {surfaceTab === "manage" ? (
      <>
      <section className="operation-builder" data-mode={mode}>
        <div className="operation-builder-head">
          <span className="operation-builder-title">{editId ? t(m.editAction) : t(m.newAction)}</span>
          <button type="button" className="link-button operation-new-btn" onClick={resetBuilder}>
            <Plus size={14} />
            {t(m.newButton)}
          </button>
        </div>

        {/* Field 1: 名字 — always visible, in both modes. */}
        <label className="operation-field operation-simple-field">
          <span>{t(m.nameLabel)}</span>
          <input
            className="operation-name-input"
            placeholder={t(m.namePlaceholder)}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              clearFieldError("name");
            }}
          />
        </label>
        {fieldErrors.name ? (
          <div className="operation-field-error" data-field="name">
            {t(m.nameRequired)}
          </div>
        ) : null}

        {/* Field 2: 一句话指令 — the whole story for a simple action. */}
        {mode === "simple" ? (
          <>
            <label className="operation-field operation-simple-field">
              <span>{t(m.instructionLabel)}</span>
              <textarea
                className="operation-instruction-input"
                placeholder={t(m.instructionPlaceholder)}
                value={instruction}
                onChange={(event) => {
                  setInstruction(event.target.value);
                  clearFieldError("instruction");
                }}
              />
            </label>
            {fieldErrors.instruction ? (
              <div className="operation-field-error" data-field="instruction">
                {t(m.instructionRequired)}
              </div>
            ) : null}
            <p className="operation-simple-hint">{t(m.simpleHint)}</p>
          </>
        ) : null}

        {/* 高级 — collapsed by default. Simple mode: pin an output type / change scope /
            convert to a full template. Template mode: the entire V1 builder chrome. */}
        <details className="operation-advanced" open={advancedOpen}>
          <summary
            onClick={(event) => {
              event.preventDefault();
              setAdvancedOpen((open) => !open);
            }}
          >
            {t(m.advanced)}
          </summary>
          <div className="operation-advanced-body">
            {mode === "simple" ? (
              <>
                <div className="operation-row">
                  <label className="operation-field">
                    <span>{t(m.outputTypeLabel)}</span>
                    <select
                      className="operation-output-select"
                      value={outputContentType}
                      onChange={(event) => setOutputContentType(event.target.value)}
                    >
                      <option value="">{t(m.outputAuto)}</option>
                      {contentTypes.map((contentType) => (
                        <option key={contentType} value={contentType}>
                          {contentType}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="operation-field">
                    <span>{t(m.scopeLabel)}</span>
                    <select
                      className="operation-scope-select"
                      value={scope}
                      onChange={(event) => setScope(event.target.value as "anchor" | "source")}
                    >
                      <option value="anchor">{t(m.scopeAnchor)}</option>
                      <option value="source">{t(m.scopeSource)}</option>
                    </select>
                  </label>
                </div>
                <button type="button" className="link-button operation-convert-btn" onClick={convertToTemplate}>
                  {t(m.convertToTemplate)}
                </button>
              </>
            ) : (
              <>
                <input
                  className="operation-description-input"
                  placeholder={t(m.descriptionPlaceholder)}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />

                <div className="operation-row">
                  <label className="operation-field">
                    <span>{t(m.outputTypeLabel)}</span>
                    <select
                      className="operation-output-select"
                      value={outputContentType || "markdown"}
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
                    <span>{t(m.scopeLabel)}</span>
                    <select
                      className="operation-scope-select"
                      value={scope}
                      onChange={(event) => setScope(event.target.value as "anchor" | "source")}
                    >
                      <option value="anchor">{t(m.scopeAnchor)}</option>
                      <option value="source">{t(m.scopeSource)}</option>
                    </select>
                  </label>
                </div>

                {/* Prefill the editor from a built-in default (one-click restore below). */}
                <label className="operation-field operation-prefill">
                  <span>{t(m.prefillLabel)}</span>
                  <select
                    className="operation-prefill-select"
                    value={prefilledFrom}
                    onChange={(event) => {
                      if (event.target.value) seedFromBuiltin(event.target.value, false);
                    }}
                  >
                    <option value="">{t(m.prefillBlank)}</option>
                    {builtinActions.map((action) => (
                      <option key={action.id} value={action.id}>
                        {action.title}
                      </option>
                    ))}
                  </select>
                </label>

                {/* Variable BLOCKS — clicking inserts {{name}} at the caret (no typing braces). */}
                <div className="operation-var-row">
                  <span className="operation-var-label">{t(m.insertVariable)}</span>
                  {WELL_KNOWN.map((variable) => (
                    <button
                      key={variable.name}
                      type="button"
                      className="operation-var-btn"
                      data-var={variable.name}
                      onClick={() => insertVariable(variable.name)}
                    >
                      {t(variable.label)}
                    </button>
                  ))}
                </div>

                <textarea
                  ref={templateRef}
                  className="operation-template-input"
                  placeholder={t(m.templatePlaceholder)}
                  value={promptTemplate}
                  onChange={(event) => {
                    applyTemplate(event.target.value);
                    clearFieldError("template");
                  }}
                />
                {fieldErrors.template ? (
                  <div className="operation-field-error" data-field="template">
                    {t(m.templateRequired)}
                  </div>
                ) : null}

                {/* Live preview: blocks replaced with the current passage's real text. */}
                <div className="operation-preview-head">{t(m.livePreview)}</div>
                <pre className="operation-preview">{preview || t(m.previewEmpty)}</pre>

                {/* The declared variables auto-seeded from the template. */}
                <details className="operation-vars-advanced">
                  <summary>
                    {t(m.variablesSummary)} ({declaredVariables.length})
                  </summary>
                  <div className="operation-add-var">
                    <input
                      className="operation-add-var-input"
                      placeholder={t(m.newVarPlaceholder)}
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
                      {t(m.addVariable)}
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
                          placeholder={t(m.defaultValuePlaceholder)}
                          value={variable.default ?? ""}
                          onChange={(event) => updateVariable(variable.name, { default: event.target.value })}
                        />
                      ) : null}
                      <label className="operation-var-required sv-check">
                        <input
                          type="checkbox"
                          className="sv-check-input"
                          checked={variable.required}
                          onChange={(event) => updateVariable(variable.name, { required: event.target.checked })}
                        />
                        <span className="sv-check-box" aria-hidden="true" />
                        <span>{t(m.requiredLabel)}</span>
                      </label>
                    </div>
                  ))}
                  {declaredVariables.length === 0 ? <div className="empty-state">{t(m.noVariables)}</div> : null}
                </details>
              </>
            )}
          </div>
        </details>

        <div className="operation-builder-actions">
          <button
            type="button"
            className="icon-button primary operation-save-btn"
            onClick={() => void saveOperation()}
          >
            {t(m.save)}
          </button>
          <button
            type="button"
            className="icon-button operation-try-btn"
            title={t(m.tryHint)}
            onClick={() => void tryOperation()}
          >
            <Play size={15} />
            {t(m.tryIt)}
          </button>
          {mode === "template" && prefilledFrom ? (
            <button
              type="button"
              className="link-button operation-restore-btn"
              title={t(m.restoreDefaultHint)}
              onClick={() => seedFromBuiltin(prefilledFrom, source === "fork")}
            >
              <RotateCcw size={13} />
              {t(m.restoreDefault)}
            </button>
          ) : null}
        </div>
      </section>

      {/* —— MANAGER ———————————————————————————————————————————————————————————— */}
      <section className="operation-manager">
        <div className="operation-manager-title">{t(m.managerTitle)}</div>
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
                  <label className="operation-toggle-label operation-switch-label">
                    <span className="operation-action-name">{item.title}</span>
                    <span className="sv-switch">
                      <input
                        type="checkbox"
                        className="operation-toggle sv-switch-input"
                        checked={enabled}
                        onChange={() => toggleEnabled(item.id)}
                      />
                      <span className="sv-switch-track" aria-hidden="true" />
                    </span>
                  </label>
                  <span className="operation-action-tag" data-scope={item.scope}>
                    {item.scope === "source" ? t(m.tagSource) : t(m.tagPassage)}
                  </span>
                  <span className="operation-action-tag" data-kind={item.kind}>
                    {item.kind === "builtin" ? t(m.tagBuiltin) : t(m.tagCustom)}
                  </span>
                  {item.kind === "operation" ? (
                    <>
                      <button
                        type="button"
                        className="link-button operation-edit-btn"
                        onClick={() => loadOperation(item.op)}
                      >
                        {t(m.editButton)}
                      </button>
                      <button
                        type="button"
                        className="link-button operation-delete-btn"
                        aria-label={t(m.deleteAria)}
                        onClick={() => void deleteOperation(item.op)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="link-button operation-fork-btn"
                      title={t(m.customizeBuiltin)}
                      onClick={() => void forkBuiltin(item.action)}
                    >
                      <Copy size={13} />
                      {t(m.customizeBuiltin)}
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
          {managerItems.length === 0 ? <div className="empty-state">{t(m.emptyManager)}</div> : null}
        </div>
      </section>
      </>
      ) : null}
    </aside>
  );
}

registerView({ kind: "operation.manager", render: (_node, ctx) => <OperationManagerView ctx={ctx} /> });
