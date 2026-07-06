// PLAT-LAYER Part-2 Slice 6 — the OPERATION domain hook (a TIER-C composer over the
// pipeline). Extracted VERBATIM from WorkspaceContext.tsx (no functional change):
//   • STATE: the loaded custom `operations` + their `operationPrefs` + the `operationsVersion`
//     refresh token, plus the operation-manager UI atoms `showOperationManager` (the shell's
//     registered "open the manager" handler) and `customizeSurface` (the tab a deep-link
//     pre-selects on next open).
//   • CALLBACKS: refreshOperations (bump the token), saveActionPrefs (the single prefs WRITE
//     seam — persists via entityClient.saveOperationPrefs then refreshes), the
//     registerOpenOperationManager / openOperationManager shell seam, and
//     convertSelectionToRegion (the 转为区域 helper, reads only the injected `focus`).
//   • DERIVED ACTION LISTS: selectionActions (built-in kit selection items + anchor-scope
//     custom ops, ordered for the shared "passage" surface), anchorBarActions (ALIASED to
//     selectionActions — one shared surface, one config, no second ordering pass), sourceActions
//     (source-scope built-ins + ops, ordered for "source"), and runAction (fires a built-in
//     command via the injected `dispatch`, an operation via operation.run, or the 转为区域
//     special-case via convertSelectionToRegion).
//   • The MOUNT-LOAD effect (loads operations + operationPrefs on mount and whenever the
//     builder/manager bumps operationsVersion), with its EXACT dep-array preserved.
//   • The entityClient sites (.operations / .operationPrefs / .saveOperationPrefs) move in here.
//
// INJECTED (read-only) DEPS — `useOperationDomain({ activeKitIds, focus, locale, dispatch })`:
//   • `activeKitIds` — the active source's effective kit ids (from the landed kit surface);
//     gates which built-in kit surface items the selection/source toolbars offer.
//   • `focus` — the shared kernel focus (the provider's useFocus()). selectionActions reads
//     focus.draft (the 转为区域 offer gate), convertSelectionToRegion reads/writes focus.
//   • `locale` — the active locale; a dep of the two toolbar memos so the t()/resolveText()
//     titles re-resolve on a language switch (its pre-existing cadence).
//   • `dispatch` — the coordinator's command dispatch (Slice 7, still in the provider).
//     runAction captures it. INVESTIGATED: dispatch/commandContext read NO operation output
//     (they handle note/concept/layer/generation commands off focus/docs/chat/concept), so
//     there is NO cycle — `useOperationDomain` is declared AFTER dispatch and injects it.
//   (saveActionPrefs preserves its pre-extraction behavior: a persistence failure PROPAGATES to
//    the caller's await — it is NOT routed to a setError sink, matching the original. So unlike the
//    sibling hooks, this domain takes no onError.)
//
// THE SURFACE is a `useMemo`-wrapped object keyed on EVERY field it exposes — the
// memoized-surface contract the whole Part-2 split depends on. selectionActions/sourceActions
// re-run on every activeKitIds/focus.draft/locale/operations/operationPrefs change (their
// PRE-EXISTING cadence), so the surface's identity changes on exactly that cadence — not more.
// Follows the proven useChatSessions / useDocumentsDomain / useKitDomain reference.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  entityClient,
  type OperationPrefs,
  type OperationRecord
} from "../data/entityClient";
import type { FocusContextValue, AnchorDraft } from "../focus/FocusContext";
import { selectionRectToPageRect } from "../surfaces/pdfSelectionRect";
import { kitSurfaceItems } from "../../kits/clientContext";
import { defineMessages, resolveText, t } from "../i18n";
import { conceptMessages } from "./conceptMessages";
import type { CommandContext } from "../commands/registry";
import type { ToolbarAction, ActionSurface, CustomizeSurface } from "./WorkspaceContext";

const EMPTY_OPERATION_PREFS: OperationPrefs = { order: [], disabled: [], params: {}, surfaces: {}, icons: {} };

const workspaceActionMessages = defineMessages({
  bookmark: { zh: "书签", en: "Bookmark" },
  createNoteGroup: { zh: "创建笔记", en: "Create Note" },
  bookmarkHint: { zh: "为当前聚焦段落添加书签", en: "Bookmark the focused passage" },
  customActions: { zh: "我的操作", en: "Custom Actions" },
  // 转为区域 (D4a): convert the current PDF text selection into a region rect.
  convertToRegion: { zh: "转为区域", en: "Convert to Region" },
  convertToRegionHint: {
    zh: "把选中的文字转成框选区域（图/公式/扫描件）",
    en: "Turn the text selection into a region box (figure / formula / scan)"
  }
});

// The command id for the 转为区域 action. It is NOT a registry command (it needs the
// live selection GEOMETRY, which lives in the DOM, not the CommandContext) — runAction
// special-cases it to the convertSelectionToRegion callback.
const CONVERT_TO_REGION_ACTION_ID = "region.convert-selection";

// The core "Add bookmark" selection action — always available on the focused passage
// (NOT kit-gated, unlike the kit selection items). Dispatched by its command id like
// any built-in; it materializes the anchor and creates a bookmark note. Listed first
// so it leads the selection toolbar, before any kit/custom actions.
const BOOKMARK_ACTION: ToolbarAction = {
  id: "bookmark.add",
  title: "Bookmark",
  icon: "bookmark",
  group: "Create Note",
  description: "Bookmark the focused passage",
  kind: "builtin",
  scope: "anchor"
};

// 标为概念 (CONCEPT-UX-1): the core "mark selection as concept" action — a sibling of
// Bookmark (core, not kit-gated). Its command creates/links a concept from the selected
// text in one click; feedback flows back through onConceptMarked → the toast.
const CONCEPT_MARK_COMMAND_ID = "concept.mark-selection";

// Filter + sort an action list by an (order, excluded) pair: excluded ids are dropped,
// then the rest are sorted by their index in `order` (unlisted ids keep their incoming
// order after the listed ones). JS sort is stable, so built-in priority + custom
// insertion order are preserved on ties.
function arrangeActions(actions: ToolbarAction[], order: string[], excluded: string[]): ToolbarAction[] {
  const indexOf = (id: string) => {
    const i = order.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return actions
    .filter((action) => !excluded.includes(action.id))
    .sort((a, b) => indexOf(a.id) - indexOf(b.id));
}

// Order a merged action list FOR A SURFACE (R6.3). If the prefs carry a per-surface entry
// for `surface`, that surface's own `order` + `hidden` drive the arrangement so each
// surface configures independently; otherwise it falls back to the GLOBAL `order`/`disabled`
// (pre-R6.3 behavior, shared by every surface). This is the single ordering seam every
// toolbar list flows through.
function orderActionsForSurface(
  actions: ToolbarAction[],
  prefs: OperationPrefs,
  surface: ActionSurface
): ToolbarAction[] {
  const perSurface = prefs.surfaces?.[surface];
  if (perSurface) return arrangeActions(actions, perSurface.order, perSurface.hidden);
  return arrangeActions(actions, prefs.order, prefs.disabled);
}

export interface OperationSurface {
  // —— operations (custom AI actions as data) + their workspace prefs ——
  operations: OperationRecord[];
  operationPrefs: OperationPrefs;
  operationsVersion: number;
  refreshOperations(): void;
  /** Anchor-scope actions ordered for the shared "passage" toolbar surface (the inline
      selection toolbar). */
  selectionActions: ToolbarAction[];
  /** The Anchor bar's list — the SAME "passage"-ordered list as `selectionActions` (one
      shared surface, identical order + show/hide). Aliases `selectionActions`. */
  anchorBarActions: ToolbarAction[];
  /** Source-scope actions (built-in source items + source ops), ordered for "source". */
  sourceActions: ToolbarAction[];
  /** Run a merged action: a built-in command, or operation.run for a custom op. */
  runAction(action: ToolbarAction): void;
  /** Persist a full next-prefs object (the Customize panel's single write seam). */
  saveActionPrefs(next: OperationPrefs): Promise<void>;
  /** Open the operation manager / Customize panel (fires the shell's registered handler). */
  openOperationManager(surface?: CustomizeSurface): void;
  /** Shell-only: register the "show operation manager" handler the seam fires. */
  registerOpenOperationManager(handler: () => void): void;
  /** The surface tab the Customize panel should PRE-SELECT on its next open. */
  customizeSurface: CustomizeSurface;
}

export function useOperationDomain({
  activeKitIds,
  focus,
  locale,
  dispatch
}: {
  /** The active source's effective kit ids (from the kit surface) — gates which built-in
      kit surface items the selection/source toolbars offer. */
  activeKitIds: string[];
  /** The shared kernel focus (the provider's useFocus()). Read-only here: selectionActions
      reads focus.draft; convertSelectionToRegion reads/writes the live focus draft. */
  focus: FocusContextValue;
  /** The active locale — a dep of the toolbar memos so titles re-resolve on a language flip. */
  locale: string;
  /** The coordinator's command dispatch (stays in the provider). runAction captures it;
      dispatch reads NO operation output → injecting it is not circular. */
  dispatch: (commandId: string, payload: CommandContext["payload"]) => Promise<void>;
}): OperationSurface {
  // Custom operations + their workspace prefs (action order / disabled / built-in
  // params). Loaded once and re-fetched whenever the builder/manager bumps the token.
  const [operations, setOperations] = useState<OperationRecord[]>([]);
  const [operationPrefs, setOperationPrefs] = useState<OperationPrefs>(EMPTY_OPERATION_PREFS);
  const [operationsVersion, setOperationsVersion] = useState(0);
  // The shell owns which view-kind fills the switchable left slot (it's local shell
  // state, not in the dock tree), so it REGISTERS a "show the operation manager" handler
  // here. The Customize-Toolbar footer in any ActionMoreMenu calls openOperationManager()
  // (the seam), which fires that handler — the panel never reaches into the shell.
  const [showOperationManager, setShowOperationManager] = useState<(() => void) | null>(null);
  // The surface tab the Customize panel should pre-select on its next open (deep-link from
  // an ActionMoreMenu's "Customize Toolbar" footer). operationViews consumes it once.
  const [customizeSurface, setCustomizeSurface] = useState<CustomizeSurface>(undefined);

  // 转为区域 (D4a): convert the CURRENT PDF text selection into a region draft. The
  // selection geometry lives in the DOM (not the CommandContext), so this reads the live
  // host selection, finds its pdf.js `.page`, measures both boxes, and normalizes the
  // selection into a page-relative rect (selectionRectToPageRect). It then pushes a region
  // draft through the SAME focus.setDraft the rubber-band gesture uses — flowing through
  // buildAnchorInput's region arm → regionTargetToRequest → pdf_selection{page,rect} with
  // ZERO schema change. No-op unless there is a pdf_selection quote draft with a page and a
  // live, measurable selection over that page (image regions are already modeless; HTML/web
  // rect is D4b, deferred).
  const convertSelectionToRegion = useCallback(() => {
    if (typeof window === "undefined") return;
    const draft = focus.draft;
    if (!draft || draft.mode !== "quote" || draft.kind !== "pdf" || !draft.page) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    const pageEl = element?.closest(".page") as HTMLElement | null;
    if (!pageEl) return;
    const pageRect = pageEl.getBoundingClientRect();
    const selRect = range.getBoundingClientRect();
    if (pageRect.width === 0 || pageRect.height === 0 || selRect.width === 0) return;
    const regionDraft: AnchorDraft = {
      mode: "region",
      sourceId: draft.sourceId,
      kind: "pdf",
      page: draft.page,
      rect: selectionRectToPageRect(pageRect, selRect)
    };
    // Clear the live text selection so the floating toolbar/quote path doesn't re-fire.
    selection.removeAllRanges();
    focus.setDraft(regionDraft);
  }, [focus]);

  // —— operations (custom AI actions as data) ——
  const refreshOperations = useCallback(() => setOperationsVersion((value) => value + 1), []);

  // The single WRITE seam for action prefs (IRON LAW): the Customize panel hands a full
  // next-prefs object here; we persist it through the entity client and bump the
  // operations token so the loader re-fetches (mirrors the operation manager's own
  // savePrefs → refreshOperations). The panel never calls entityClient directly.
  const saveActionPrefs = useCallback(
    async (next: OperationPrefs) => {
      await entityClient.saveOperationPrefs(next);
      refreshOperations();
    },
    [refreshOperations]
  );

  // The shell registers its "show operation manager" handler (sets the left-slot kind).
  // Wrapped in a function-setter so React stores the callback itself, not invokes it.
  const registerOpenOperationManager = useCallback((handler: () => void) => {
    setShowOperationManager(() => handler);
  }, []);

  // The Customize-Toolbar seam: record the requested surface (so operationViews can
  // pre-select that tab on open), then fire the shell's registered handler (no-op if the
  // shell hasn't mounted yet). Used by ActionMoreMenu's footer, which passes its surface.
  const openOperationManager = useCallback(
    (surface?: CustomizeSurface) => {
      setCustomizeSurface(surface);
      showOperationManager?.();
    },
    [showOperationManager]
  );

  // Load custom operations + prefs on mount and whenever the builder/manager mutates
  // them. Additive + best-effort: a failure leaves the toolbars showing only built-in
  // kit actions (operations never gate the base app).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [opsResponse, prefsResponse] = await Promise.all([
          entityClient.operations(),
          entityClient.operationPrefs()
        ]);
        if (cancelled) return;
        setOperations(opsResponse.operations);
        setOperationPrefs(prefsResponse.prefs);
      } catch {
        // operations are additive — keep the built-in toolbars working
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [operationsVersion]);

  // Merge a slot's built-in kit actions with the custom ops of the matching scope, then
  // order/filter by prefs. Anchor scope ↔ the selection toolbar; source scope ↔ the
  // source-actions toolbar. Built-in kit items are gated by the active source's kits;
  // custom ops are workspace-wide.
  const selectionActions = useMemo<ToolbarAction[]>(() => {
    const builtin: ToolbarAction[] = kitSurfaceItems("selection-toolbar", activeKitIds).map((item) => ({
      id: item.commandId,
      title: resolveText(item.title),
      icon: operationPrefs.icons?.[item.commandId] ?? item.icon,
      group: item.group,
      description: item.description ? resolveText(item.description) : undefined,
      kind: "builtin",
      scope: "anchor"
    }));
    const custom: ToolbarAction[] = operations
      .filter((op) => op.scope === "anchor")
      .map((op) => ({
        id: op.id,
        title: op.name,
        icon: operationPrefs.icons?.[op.id],
        group: t(workspaceActionMessages.customActions),
        description: op.description,
        kind: "operation",
        scope: "anchor",
        outputType: op.outputContentType,
        variables: op.declaredVariables
      }));
    const bookmark: ToolbarAction = {
      ...BOOKMARK_ACTION,
      title: t(workspaceActionMessages.bookmark),
      group: t(workspaceActionMessages.createNoteGroup),
      description: t(workspaceActionMessages.bookmarkHint),
      icon: operationPrefs.icons?.[BOOKMARK_ACTION.id] ?? BOOKMARK_ACTION.icon
    };
    // 标为概念 (CONCEPT-UX-1): the second core passage action — built inside the memo
    // (not a module const) so its title/description resolve through t() at render
    // assembly time. Icon overridable like every action.
    const conceptAction: ToolbarAction = {
      id: CONCEPT_MARK_COMMAND_ID,
      title: t(conceptMessages.markAction),
      icon: operationPrefs.icons?.[CONCEPT_MARK_COMMAND_ID] ?? "hash",
      group: t(workspaceActionMessages.createNoteGroup),
      description: t(conceptMessages.markActionHint),
      kind: "builtin",
      scope: "anchor"
    };
    // 转为区域 (D4a, append-only per delta 6): convert the current PDF TEXT selection into
    // a region rect. Only offered when the focus is a pdf_selection QUOTE draft with a page
    // (a live text selection on a pdf.js page) — image regions are already modeless, and
    // HTML/web rect is D4b (deferred). runAction routes its id to convertSelectionToRegion.
    const convertAction: ToolbarAction | null =
      focus.draft?.mode === "quote" && focus.draft.kind === "pdf" && !!focus.draft.page
        ? {
            id: CONVERT_TO_REGION_ACTION_ID,
            title: t(workspaceActionMessages.convertToRegion),
            icon: operationPrefs.icons?.[CONVERT_TO_REGION_ACTION_ID] ?? "scan-line",
            group: t(workspaceActionMessages.createNoteGroup),
            description: t(workspaceActionMessages.convertToRegionHint),
            kind: "builtin",
            scope: "anchor"
          }
        : null;
    // The core Bookmark + 标为概念 actions lead, then kit selection items, then custom
    // ops. Ordered for the shared "passage" surface — the SINGLE config the inline
    // selection toolbar AND the Anchor bar both render, so the two surfaces always show
    // the identical ordered list + show/hide (its own per-surface prefs, else global).
    return orderActionsForSurface(
      [bookmark, conceptAction, ...(convertAction ? [convertAction] : []), ...builtin, ...custom],
      operationPrefs,
      "passage"
    );
  }, [activeKitIds, locale, operations, operationPrefs, focus.draft]);

  // The Anchor Action Bar renders the SAME ordered "passage" list as the inline selection
  // toolbar — one shared surface, one config. Aliased to `selectionActions` so there is a
  // single source of truth (no second ordering pass that could drift). Kept as its own name
  // only so the two mount points read intent-revealing context keys.
  const anchorBarActions = selectionActions;

  const sourceActions = useMemo<ToolbarAction[]>(() => {
    const builtin: ToolbarAction[] = kitSurfaceItems("source-actions", activeKitIds).map((item) => ({
      id: item.commandId,
      title: resolveText(item.title),
      icon: operationPrefs.icons?.[item.commandId] ?? item.icon,
      group: item.group,
      description: item.description ? resolveText(item.description) : undefined,
      kind: "builtin",
      scope: "source"
    }));
    const custom: ToolbarAction[] = operations
      .filter((op) => op.scope === "source")
      .map((op) => ({
        id: op.id,
        title: op.name,
        icon: operationPrefs.icons?.[op.id],
        group: t(workspaceActionMessages.customActions),
        description: op.description,
        kind: "operation",
        scope: "source",
        outputType: op.outputContentType,
        variables: op.declaredVariables
      }));
    return orderActionsForSurface([...builtin, ...custom], operationPrefs, "source");
  }, [activeKitIds, locale, operations, operationPrefs]);

  // Fire a merged action: a built-in dispatches its command id directly; a custom op
  // goes through the generic operation.run command (which materializes the passage,
  // generates, and emits a GeneratedDraft into the preview loop).
  const runAction = useCallback(
    (action: ToolbarAction) => {
      if (action.kind === "operation") {
        void dispatch("operation.run", {
          operationId: action.id,
          outputType: action.outputType,
          scope: action.scope,
          variables: action.variables
        });
      } else if (action.id === CONVERT_TO_REGION_ACTION_ID) {
        // 转为区域 (D4a): not a registry command — it needs the live selection geometry.
        convertSelectionToRegion();
      } else {
        void dispatch(action.id, {});
      }
    },
    [dispatch, convertSelectionToRegion]
  );

  return useMemo<OperationSurface>(
    () => ({
      operations,
      operationPrefs,
      operationsVersion,
      refreshOperations,
      selectionActions,
      anchorBarActions,
      sourceActions,
      runAction,
      saveActionPrefs,
      openOperationManager,
      registerOpenOperationManager,
      customizeSurface
    }),
    [
      operations,
      operationPrefs,
      operationsVersion,
      refreshOperations,
      selectionActions,
      anchorBarActions,
      sourceActions,
      runAction,
      saveActionPrefs,
      openOperationManager,
      registerOpenOperationManager,
      customizeSurface
    ]
  );
}
