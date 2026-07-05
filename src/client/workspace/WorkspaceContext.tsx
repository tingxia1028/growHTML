// WorkspaceContext — the shared state + actions the workspace views consume. This
// is the relocation target for everything that used to live inline in the App's
// `Workspace` component: the active source, the sources list, anchors/notes/patches,
// chat messages, status/error, the `paintAnchors` memo, and the handlers
// (loadSources, openLocalFile/import, dispatch(command), changePatchStatus, …).
//
// Views read/write ONLY through this context (which is itself backed by Focus,
// EntityClient, and the CommandRegistry) — never by reaching into each other. So the
// three panels are now registered views that pull from `useWorkspace()` instead of
// being hard-coded JSX inside one component. FocusProvider wraps this unchanged.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import {
  entityClient,
  chatContentText,
  type AnyAnchor,
  type ChatContext,
  type ChatMessage,
  type NoteRecord,
  type OperationPrefs,
  type OperationRecord,
  type OperationVariable,
  type PatchRecord,
  type PluginPrefs,
  type SourceRecord,
  type StudyLayerRecord
} from "../data/entityClient";
import { useFocus, draftQuoteText, type FocusContextValue, type AnchorDraft } from "../focus/FocusContext";
import { selectionRectToPageRect } from "../surfaces/pdfSelectionRect";
// A4b: the agent-loop transcript — a render-only turn state accumulated from the agent
// SSE (entityClient.agentStream). Distinct from the persisted chat log; only done.message
// becomes a real assistant turn (via the existing persistAssistant seam).
import { initialAgentTurn, reduceAgentEvent, type AgentTurnState } from "./agentTurnReducer";
import { BOOKMARK_CONTENT_TYPE } from "../../core/notes/contentTypes";
import { resolveFormAsync, type AiClassify } from "../../core/notes/resolveForm";
import { classifyContent } from "../../core/notes/classifyContent";
import { createDefaultContent, isTextContentType } from "../notes/noteTypeRegistry";
import { getSourceViewer, type SourceViewer } from "../viewers";
import { getCommand, runCommand, type CommandContext, type GeneratedDraft } from "../commands/registry";
import type { PaintAnchor } from "../surfaces/types";
// D5 floating editor: a parked draft remembers WHERE its passage was (the live
// selection rect in host coords) so the editor floats next to it, not at a pane
// bottom. Best-effort — null falls back to a reader-panel-anchored position.
import { getSelectionRect, type SelectionRect } from "../selection/selectionRect";
import {
  persistAnnotationMode,
  readStoredAnnotationMode,
  type HtmlAnnotationMode
} from "../annotations";
import { activeKitIdsForSource, CORE_KIT_ID } from "../../kits/activation";
import { installedKits, kitSurfaceItems, setDisabledContributions } from "../../kits/clientContext";
import { listInstalledPlugins, type PluginRecord } from "../../kits/plugin";
import { LAYOUT_PRESETS, DEFAULT_LAYOUT_ID } from "./presets";
// F1 (P-A1): the pure open-panes model — the source-binding shim behind activeSourceId.
import {
  closePane,
  focusPane,
  focusedPane,
  openOrFocusPane,
  paneIdFor,
  persistPanes,
  prunePanes,
  readStoredPanes,
  switchFocusedPane,
  type OpenPane
} from "./panes";
// F1 (P-A1): the pure per-source reader-data cache (renderedHtml/anchors/notes/patches/
// sourceLayers keyed by sourceId) — the focused pane's bundle mirrors into top-level state.
import {
  getBundle,
  hasBundle,
  pruneBundles,
  putBundle,
  type SourceBundle
} from "./sourceBundles";
// F1 (P-A2): the pure per-pane paint pipeline (extracted verbatim from the focused memos
// → byte-identical for the focused pane; run per-source for background panes).
import { buildPaintPipeline } from "./paneSelectors";
// Theme V1 — a workspace-wide visual choice, a strict SIBLING of the layout switcher
// (it never reads activeLayoutId). The side-effect import populates the theme registry
// before listThemes() runs at provider mount, mirroring views.tsx's kit import.
import "../theme/builtins";
import { DEFAULT_THEME_ID } from "../theme/builtins";
import { listThemes } from "../theme/registry";
import { setActiveTheme as applyActiveTheme, THEME_STORAGE_KEY } from "../theme/applyTheme";
import { renderAnnotationNotePreview } from "./annotationNotePreview";
// SRC-3: fork an imported source into an editable authored copy (the fork IO lives in
// the SRC-2 authoring IO module, not the contended entityClient).
import { getSourceAuthoringIo, isForkableImportedSource } from "./sourceAuthoringIo";
import { defineMessages, resolveText, t, useLocale } from "../i18n";
import { conceptMessages } from "./conceptMessages";
// W1 (ai-workspace §2.1/§2.2): the chat-session domain module — the first F1 slice.
// Transcript + session list/load/save live in src/client/chat; this provider only
// delegates (chatMessages keeps its exact shape; the switcher gets ONE bundled api).
import { useChatSessionDomain, type ChatSessionsApi } from "../chat/useChatSessions";
// W2 (ai-workspace §W2): the PURE assembly of the chat's source-context set (focused
// source ∪ session attachments, deduped + capped). The bundle fetch lives here (the
// resolver below); the merge/cap stays pure and unit-tested next door.
import { assembleContextSources, type ResolvedBundle } from "../chat/chatContextAssembly";

export type Status = "idle" | "loading" | "saving" | "error";

// One row in a selection / source toolbar: a built-in kit action (dispatched by its
// command id) OR a custom Operation (dispatched through the generic operation.run
// command). The host assembles these in the configured order (operation-prefs), with
// disabled ones filtered out, and `runAction` knows how to fire each kind.
export type ToolbarAction = {
  /** Command id for a built-in action (= its promptId), or the op_ id for a custom one. */
  id: string;
  title: string;
  icon?: string;
  group?: string;
  /** A concise one-line hint shown in the action tooltip (after the title). */
  description?: string;
  kind: "builtin" | "operation";
  /** Whether the action runs over the focused passage ("anchor") or the source. */
  scope: "anchor" | "source";
  /** Custom op only — the note contentType it produces + its declared variables. */
  outputType?: string;
  variables?: OperationVariable[];
};

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

/** The surface keys an action list can be configured for. The inline selection toolbar
    and the Anchor bar SHARE one key, `"passage"` (both act on the current passage/anchor),
    so configuring one configures the other identically. `"source"` is BottomBar's pool. */
export type ActionSurface = "passage" | "source";

/** The surface a Customize deep-link can pre-select: the configurable `"passage"` toolbar,
    or "my" (the builder/manager). undefined behaves like "my" (default open). The legacy
    "inline"/"anchor"/"bottom" values are accepted from older deep-link callers and all map
    to the single Toolbar (passage) tab. */
export type CustomizeSurface = "passage" | "inline" | "anchor" | "bottom" | "my" | undefined;

// Command ids whose `run` performs an AI STRUCTURED GENERATION (a single non-streamed
// request that emits a GeneratedDraft). Dispatching one flips the shared `generating`
// flag so the UI shows "AI 生成中…" and disables the trigger until the draft is ready or
// the request errors. Custom operations dispatch `operation.run` (covered here); the
// built-in textbook kit commands generate too, so they're listed explicitly. Built-in
// add/edit/link/layer commands are NOT generation and stay off this list.
const GENERATION_COMMAND_IDS = new Set<string>([
  "note.generate-block",
  "operation.run",
  "textbook.explain-concept",
  "textbook.generate-practice",
  "textbook.mark-as-mistake",
  "textbook.generate-review-pack"
]);

/** True for a command that triggers AI structured generation (drives `generating`). */
export function isGenerationCommand(commandId: string): boolean {
  return GENERATION_COMMAND_IDS.has(commandId);
}

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
// text in one click; feedback flows back through onConceptMarked → the toast below.
const CONCEPT_MARK_COMMAND_ID = "concept.mark-selection";

/** 选中即建概念 feedback: what ConceptMarkToast shows + what its undo needs. */
export type ConceptMarkFeedback = {
  conceptId: string;
  conceptName: string;
  /** The marker note carrying the anchor↔concept link — undo deletes it. */
  noteId: string;
  /** True when an existing same-named concept was linked instead of created. */
  linkedExisting: boolean;
  /** Monotonic token so a NEW mark re-arms the toast's auto-dismiss timer. */
  seq: number;
};

/** D6 auto-materialize feedback: what DraftNoteToast shows + what its undo needs. After
    an anchor-context AI answer materializes a draft note (materializeAnchor → createNote
    with status:"draft"), the workspace parks this so the toast shows "已生成笔记 · 撤销"
    with an undo that dispatches note.delete on the materialized note. */
export type DraftNoteFeedback = {
  /** The just-materialized draft note — undo dispatches note.delete on it. */
  noteId: string;
  /** The note's contentType (drives the toast's small type label). */
  contentType: string;
  /** Monotonic token so a NEW materialization re-arms the auto-dismiss timer. */
  seq: number;
};

/**
 * D6 (note-presentation-unified.md §6): whether a generated draft AUTO-MATERIALIZES as a
 * draft note (the note exists + paints its chip immediately, plus an undo toast) vs. parks
 * in the D5 floating-editor preview loop. Pure so it is unit-tested directly and the
 * `onGenerated` consumer stays a one-line dispatch. It gates on ALL of:
 *   • `autoMaterialize` — OPT-IN: the direct anchor-context flow explicitly asked for the
 *     no-Save-click chip. Absent/false keeps the byte-for-byte preview loop, so 试一下 /
 *     operation.run / kit generate buttons are UNCHANGED (they never set it) — the design's
 *     "default for direct note-type buttons" is a per-surface opt-in wired incrementally.
 *   • a real `anchorId` — anchor context existed at generation time (the whole premise).
 *   • NOT `classified` / NOT `manual` — the note.generate-block / classify-reply / floating-
 *     editor-seed flows always confirm in the preview editor.
 * onGenerated's CONTRACT is unchanged — this only routes an opted-in draft to the auto-save
 * consumer beside the existing preview consumer.
 */
export function shouldAutoMaterialize(draft: GeneratedDraft): draft is GeneratedDraft & { anchorId: string } {
  return !!draft.autoMaterialize && !!draft.anchorId && !draft.classified && !draft.manual;
}

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

// Back-compat: the global ordering (no surface). Kept for any caller that wants the
// pre-R6.3 behavior; implemented via the same primitive.
function orderActions(actions: ToolbarAction[], prefs: OperationPrefs): ToolbarAction[] {
  return arrangeActions(actions, prefs.order, prefs.disabled);
}

// Active dock layout preset id, persisted so the chosen layout sticks across reloads.
const ACTIVE_LAYOUT_KEY = "sv-active-layout";
function loadActiveLayout(): string {
  try {
    return globalThis.localStorage?.getItem(ACTIVE_LAYOUT_KEY) || DEFAULT_LAYOUT_ID;
  } catch {
    return DEFAULT_LAYOUT_ID;
  }
}

// Active theme id, persisted so the chosen skin sticks across reloads (V1: localStorage,
// the same precedent as the layout id above). Orthogonal to layout — separate key.
function loadActiveTheme(): string {
  try {
    return globalThis.localStorage?.getItem(THEME_STORAGE_KEY) || DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

const RECENT_SOURCE_IDS_KEY = "sv-recent-source-ids";

function readStoredRecentSourceIds(): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(RECENT_SOURCE_IDS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function persistRecentSourceIds(ids: string[]): void {
  try {
    globalThis.localStorage?.setItem(RECENT_SOURCE_IDS_KEY, JSON.stringify(ids));
  } catch {
    // storage unavailable - keep the in-memory order
  }
}

// Opened "Open Folder" tree roots — persisted (mirroring recentSourceIds above) so the
// folders the user opened in the Library survive a restart instead of resetting to [].
const FOLDER_ROOTS_KEY = "sv-folder-roots";

function readStoredFolderRoots(): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(FOLDER_ROOTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((root): root is string => typeof root === "string") : [];
  } catch {
    return [];
  }
}

function persistFolderRoots(roots: string[]): void {
  try {
    globalThis.localStorage?.setItem(FOLDER_ROOTS_KEY, JSON.stringify(roots));
  } catch {
    // storage unavailable - keep the in-memory roots
  }
}

function normalizeFolderRoot(root: string): string {
  return root.trim().replace(/[\\/]+$/, "");
}

// Note `content` is `unknown` (structured per contentType). For display we want a
// string: string content passes through; structured content is shown as JSON.
export function noteText(content: unknown): string {
  return typeof content === "string" ? content : JSON.stringify(content, null, 2);
}

export function mergeFocusedAnchor(
  anchors: AnyAnchor[],
  focusedAnchor: AnyAnchor | null | undefined,
  activeSourceId: string
): AnyAnchor[] {
  if (!focusedAnchor || !activeSourceId || focusedAnchor.sourceId !== activeSourceId) return anchors;
  if (anchors.some((anchor) => anchor.id === focusedAnchor.id)) return anchors;
  return [...anchors, focusedAnchor];
}

// Empty input → empty string (the terminal then uses the app's default cwd).
function parentDir(filePath: string): string {
  const normalized = filePath.replace(/[\\/]+$/, "");
  const cut = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return cut > 0 ? normalized.slice(0, cut) : "";
}

// The value every workspace view renders against. It is intentionally broad — it is
// the union of what the three panels need — but it is a single, explicit seam, so a
// view's data dependencies are visible and it can't smuggle state in from a sibling.
export type WorkspaceContextValue = {
  // —— shared kernel ——
  focus: FocusContextValue;

  // —— status ——
  status: Status;
  error: string;

  // —— sources ——
  sources: SourceRecord[];
  recentSources: SourceRecord[];
  activeSourceId: string;
  activeSource: SourceRecord | null;
  activeViewer: SourceViewer;
  setActiveSourceId(id: string): void;
  // —— F1 (P-A1): the open-panes model (multi-document workspace) ——
  /** Open a source in a NEW pane (multi-doc: add a tab, never replacing the focused one).
      The explicit "open another document" entry (Ctrl/Cmd-click a library row). */
  openSourceInNewPane(id: string): void;
  /** Every open reader pane (mirrors the dock's source.viewer leaves). */
  openPanes: OpenPane[];
  /** The pane that selection / anchor / source actions target (focus-follows-pane). */
  focusedPaneId: string;
  /** Focus an already-open pane (any pane click / selection routes here first). */
  focusPane(paneId: string): void;
  /** Close an open pane (the tab-strip × / prune). Collapses to the neighbour's focus. */
  closePane(paneId: string): void;
  /** The SourceRecord a pane shows (its node.params.sourceId → the sources list). */
  sourceForPane(paneId: string): SourceRecord | null;
  /** P-A2: a pane's own paint + reveal lists (focused pane → the shared memos, else the
      pane's cached bundle run through the same builder). A shared cross-source note paints
      in every open pane whose source references it. */
  paintAnchorsForPane(sourceId: string): { paintAnchors: PaintAnchor[]; revealAnchors: PaintAnchor[] };
  /** P-A2: a pane's rendered HTML (focused → top-level renderedHtml, else its bundle). */
  renderedHtmlForPane(sourceId: string): string;
  loadSources(): Promise<void>;
  deleteSourceItem(sourceId: string, title: string): Promise<void>;
  removeRecentSourceId(sourceId: string): void;
  /** SRC-2 (source-authoring.md): re-run the ACTIVE source's workspace load (rendered
      HTML + anchors + notes) — the authored editor calls this after a save so the
      reader reflects the new content and the re-projected anchors. */
  reloadActiveSource(): Promise<void>;

  // —— reader data ——
  renderedHtml: string;
  anchors: AnyAnchor[];
  notes: NoteRecord[];
  patches: PatchRecord[];
  /** ONE normalized paint list for the active source (every reader filters it). */
  paintAnchors: PaintAnchor[];
  /** Full normalized anchor locator list for reveal/jump, including non-painted bookmark-only anchors. */
  revealAnchors: PaintAnchor[];
  /** Patches scoped to the focused anchor (or all when nothing is focused). */
  activePatches: PatchRecord[];
  /** How the DOM-iframe HTML reader presents notes (floating card ↔ side gutter).
      localStorage-persisted; the reader-header toggle flips it, DomReader repaints. */
  annotationMode: HtmlAnnotationMode;
  setAnnotationMode(mode: HtmlAnnotationMode): void;

  // —— opening / importing ——
  canOpenLocal: boolean;
  folderRoots: string[];
  closeFolderRoot(root: string): void;
  activeFilePath: string | undefined;
  importUrl: string;
  setImportUrl(url: string): void;
  openLocalFile(filePath: string): Promise<void>;
  openFileDialog(): Promise<void>;
  openFolderDialog(): Promise<void>;
  importFromUrl(): Promise<void>;
  openLiveUrl(): Promise<void>;

  // —— study panel (chat / notes / patches / terminal) ——
  chatMessages: ChatMessage[];
  /** W1 (ai-workspace §2.1): the chat panel's session surface — list/new/resume/
      delete bundled as ONE field; the session domain itself lives in src/client/chat. */
  chatSessions: ChatSessionsApi;
  composerMode: "ask" | "note";
  setComposerMode(mode: "ask" | "note"): void;
  noteContentType: string;
  setNoteContentType(type: string): void;
  /** Structured note draft for object content types (flashcard/quiz/image/…). */
  noteContent: unknown;
  setNoteContent(content: unknown): void;
  /** Save the structured `noteContent` as a note (object content types). */
  submitNoteContent(): void;
  chatInput: string;
  setChatInput(text: string): void;
  patchHtml: string;
  setPatchHtml(html: string): void;
  showTerminal: boolean;
  setShowTerminal(show: boolean | ((value: boolean) => boolean)): void;
  activeFileDir: string;
  /** The focused passage's quote (empty for region drafts) + whether it's a region. */
  draftQuote: string;
  hasRegionDraft: boolean;
  /** Whether the composer's primary action (ask/note) is currently available. */
  composerDisabled: boolean;
  submitComposer(): void;
  /** Run a registered command with a per-invocation payload. */
  dispatch(commandId: string, payload: CommandContext["payload"]): Promise<void>;

  // —— generation preview (generate → preview → edit → save) ——
  // AI kit actions divert their output here instead of auto-saving. The preview view
  // renders this draft; only `savePendingDraft` persists it as a note (attaching to
  // the anchor the generation already created). Null when nothing is pending.
  pendingDraft: GeneratedDraft | null;
  /** Where the pending draft's passage was (host-viewport selection rect) when the
      draft was parked — the D5 floating editor anchors next to it. Null = unknown
      (the editor falls back to a reader-panel-anchored position). */
  pendingDraftRect: SelectionRect | null;
  /** D5 manual creation (slash bare-`/type` / note-type buttons): open the floating
      editor seeded with the type's createDefault(). Save materializes the focused
      passage (anchor.add-note's normal fallback) or lands unanchored on the source. */
  openManualEditor(contentType: string): void;
  /** Whether a regenerate request is in flight (the preview disables its buttons). */
  regenerating: boolean;
  /**
   * Whether an AI GENERATION request is in flight (structured generation: Explain /
   * Practice / operation.run / note.generate-block / classify-reply). A single shared
   * flag — set on start, cleared on draft-ready OR error — that the surfaces consume to
   * show a "AI 生成中…" spinner and disable their triggers, so the user knows the
   * single non-streamed request is running. Distinct from `status:"saving"` (a generic
   * busy state every command sets) and `regenerating` (the preview's re-run).
   */
  generating: boolean;
  /** Persist the (possibly edited) draft content as a note, then clear the preview.
      `conceptNames` (CG-2): the surviving AI-suggested concept chips — add-note
      creates-or-matches + links them (omit/empty = no tagging). */
  savePendingDraft(content: unknown, conceptNames?: string[]): void;
  /** Re-run the same generation; replaces the pending draft's content in place. */
  regeneratePendingDraft(): Promise<void>;
  /** Drop the pending draft without saving. */
  discardPendingDraft(): void;
  /** The selected text in a reply, or the full reply if nothing is highlighted. */
  selectedTextOr(fullContent: string): string;
  /**
   * Save a chat reply by routing it through the identification contract: classify the
   * text via resolveForm/classifyContent and park the DETECTED form in the generation
   * preview (so the user previews the recognized form before it lands as a note).
   */
  previewClassifiedReply(text: string): Promise<void>;
  /**
   * Add a chat reply DIRECTLY as a note (the §10 card's "Add as note" action): classify
   * the reply text into its registered form (HTML / markmap / code / markdown) and create
   * the note in one step — attached to the focused passage if there is one, else an
   * unanchored note on the active source. It then surfaces in the right-column note list.
   */
  addReplyAsNote(text: string): Promise<void>;
  /**
   * Re-run the most recent chat question (the §10 card's "Regenerate" action): re-dispatch
   * the last user prompt through `anchor.ask-ai`, appending a fresh assistant reply.
   */
  regenerateChatReply(): void;
  // —— A4b agent loop (tool-calling) ——
  /** The in-flight/last agent turn's render-only transcript (tool cards + streamed text),
      null when no agent turn is active. Distinct from the persisted chat log. */
  agentTurn: AgentTurnState | null;
  /** Whether the ACTIVE provider advertises app-defined tool calling — gates the 🛠 button. */
  agentAvailable: boolean;
  /** Run ONE agent turn on `text` (records the user turn once, streams tool cards, then
      persists the final answer as a normal assistant reply). */
  runAgentTurn(text: string): Promise<void>;
  /**
   * Import a local .xmind file → a `markmap` note (Phase 4 item 3). Opens the native
   * file dialog, has the server unzip+parse the .xmind into a markmap outline, and
   * parks it in the generation preview (preview-then-save). Desktop-only (needs the
   * file dialog); renders via the existing markmap plugin — no new renderer.
   */
  importXmindFile(): Promise<void>;
  changePatchStatus(patch: PatchRecord, nextStatus: "applied" | "reverted" | "rejected"): Promise<void>;
  /** SRC-3: whether the active source is a forkable IMPORTED html/markdown source. */
  canForkActiveSource: boolean;
  /** SRC-3: fork the active imported source into an editable authored copy + open it. */
  forkActiveSource(): Promise<void>;

  // —— concepts / relations ——
  // A monotonically-increasing token bumped whenever a concept/relation/link command
  // mutates entity data. Concept views watch it to re-fetch (they own their own list
  // + detail state via the entity client, so the context stays the single seam
  // without ballooning with concept-specific data).
  conceptsVersion: number;
  /** Bump `conceptsVersion` after a direct entity mutation (e.g. delete relation). */
  refreshConcepts(): void;
  /** 标为概念 feedback (CONCEPT-UX-1): the pending toast payload, null when none. */
  conceptMark: ConceptMarkFeedback | null;
  /** Undo the last 标为概念: delete its marker note (the anchor↔concept link). */
  undoConceptMark(): Promise<void>;
  /** Dismiss the 标为概念 toast without undoing. */
  dismissConceptMark(): void;

  // —— D6 auto-materialized draft note (anchor-context AI answer → note chip + undo) ——
  /** Materialize an AI answer as a DRAFT note ON an anchor: createNote with
      status:"draft" (the note exists + paints immediately), park the undo feedback,
      and return the new note (null on failure). This is the auto-save consumer that
      sits BESIDE the preview-loop parkDraft consumer — used only when a generation
      carried a focused-anchor context. Non-anchor generations keep parking in the
      floating editor (preview loop unchanged). */
  materializeAnchor(anchorId: string, contentType: string, content: unknown): Promise<NoteRecord | null>;
  /** D6 feedback: the pending "已生成笔记 · 撤销" toast payload, null when none. */
  draftNote: DraftNoteFeedback | null;
  /** Undo the last auto-materialize: dispatch note.delete on the draft note. */
  undoDraftNote(): Promise<void>;
  /** Dismiss the draft-note toast without undoing (the draft note stays). */
  dismissDraftNote(): void;

  // —— study layers (a per-source lens axis: the multi-select filter) ——
  // Same refresh-token pattern as concepts: the layer switcher watches this to
  // re-fetch its list. `refreshLayers` ALSO repaints the reader, because toggling /
  // importing a layer changes which anchors are returned (server filters by enabled).
  layersVersion: number;
  refreshLayers(): void;
  /** The active source's layers (owned + preset stages + custom + imported), loaded
      alongside anchors/notes so the note filter + per-note chips can read them. */
  sourceLayers: StudyLayerRecord[];
  /** The set of layer ids currently enabled (the multi-select filter's "on" set). */
  enabledLayerIds: Set<string>;
  /** Notes after the OR filter: a note shows iff its layerIds intersect the enabled
      set, OR it has no layers (never orphaned). This is what the views render. */
  visibleNotes: NoteRecord[];
  /** Toggle one layer's membership in the filter (flips its stored `enabled`). The
      server is the source of truth, so this dispatches layer.toggle then re-fetches. */
  toggleLayerFilter(layer: StudyLayerRecord): void;
  /** Cascade-set several leaf layers to the same enabled state (Layer Lens parent
      toggle), then refresh once. No-ops layers already in the target state. */
  setLayersEnabled(layerIds: string[], enabled: boolean): Promise<void>;

  // —— product kits (per-source activation) ——
  // Effective kit ids for the active source (source.metadata.activeKitIds, else the
  // workspace default). Gates CREATION entry-points only — selection/source toolbars,
  // the composer type picker, kit commands, language — never rendering.
  activeKitIds: string[];
  /** Installed kits (id + display name) for the activation dropdown. */
  installedKits: { id: string; name: string }[];
  /** Apply a kit to the active source ("core" = none); persists to its metadata. */
  setActiveKit(kitId: string): Promise<void>;

  // —— operations (custom AI actions as data) + their workspace prefs ——
  // The loaded custom operations + the action prefs (order / disabled / built-in
  // params), plus a refresh token the builder/manager bump after a mutation. The two
  // merged, ordered, scope-split toolbar lists (built-in kit actions + custom ops) are
  // what the selection / source toolbars render; `runAction` fires either kind.
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
  /** Open the operation manager / Customize panel (fires the shell's registered handler).
      An optional `surface` deep-links to a Customize tab: any passage surface request
      (the shared inline/anchor toolbar) opens the single "Toolbar" tab; "my" or omitted
      opens the My Actions builder/manager. */
  openOperationManager(surface?: CustomizeSurface): void;
  /** Shell-only: register the "show operation manager" handler the seam fires. */
  registerOpenOperationManager(handler: () => void): void;
  /** The surface tab the Customize panel should PRE-SELECT on its next open (set by
      openOperationManager). operationViews consumes it ONCE via an effect, so the tab
      stays user-controllable afterward. */
  customizeSurface: CustomizeSurface;

  // —— workspace layout (dock presets) ——
  // The active layout preset id (persisted) + the available presets for the layout
  // switcher in the reader header. The shell picks the preset by this id.
  activeLayoutId: string;
  availableLayouts: { id: string; name: string }[];
  setActiveLayout(id: string): void;

  // —— theme (workspace-wide visual skin; sibling of layout, never reads it) ——
  // The active theme id (persisted) + the registered themes for the header switcher.
  // setActiveTheme flips the <html> data-theme attribute (the whole-app re-skin) and
  // persists the choice; it does NOT touch layout state.
  activeThemeId: string;
  availableThemes: { id: string; name: string }[];
  setActiveTheme(id: string): void;

  // —— Kit & Plugin (the plugin read model + its per-vault prefs; IRON LAW: the Kit &
  // Plugin manager view reads ONLY these fields) ————————————————————————
  // The installed plugins (Kit → Plugin → Contribution), read from the plugin registry
  // that clientContext populated at install; `pluginPrefs` is the per-vault prefs
  // (disabled contribution ids + declared P3/P4 slots). `setContributionEnabled` is the
  // single WRITE seam: it merges one id into/out of `disabledContributions`, PUTs the
  // next prefs, and pushes the disabled set into the clientContext module setter so
  // surface/command filtering reflects it immediately.
  installedPlugins: readonly PluginRecord[];
  pluginPrefs: PluginPrefs;
  setContributionEnabled(contributionId: string, enabled: boolean): void;
  // Pin the EXCLUSIVE viewer for a note (by id) or a whole contentType — the user
  // explicit association tier of the viewer resolver (plugin-viewer-model §4). Merges
  // into viewerAssociations.byNoteId/byContentType and PUTs (mirrors setContributionEnabled).
  // `viewerId` is a real viewer id or the "notetype" sentinel (force the NoteType renderer).
  pinViewer(target: { contentType?: string; noteId?: string }, viewerId: string): void;
};

const EMPTY_PLUGIN_PREFS: PluginPrefs = {
  disabledContributions: [],
  viewerAssociations: { byContentType: {}, byNoteId: {} },
  userKits: []
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const focus = useFocus();
  const locale = useLocale();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [sources, setSources] = useState<SourceRecord[]>([]);
  // F1 (P-A1): the open-panes model. `activeSourceId` is no longer a useState — it is
  // DERIVED from the focused pane (the back-compat shim, below), so every single-pane
  // caller keeps reading the same string while the workspace grows to multiple panes.
  // Seeded from localStorage (mirrors recentSourceIds) so the open docs + focus survive a
  // reload; reconciled against the live sources list on first loadSources (delta 4 prune).
  const [openPanes, setOpenPanes] = useState<OpenPane[]>(() => readStoredPanes().openPanes);
  const [focusedPaneId, setFocusedPaneId] = useState<string>(() => readStoredPanes().focusedPaneId);
  // Always-current focus id so the stable-deps callbacks (loadSources has []) read the
  // live value instead of a captured stale one.
  const focusedPaneIdRef = useRef(focusedPaneId);
  focusedPaneIdRef.current = focusedPaneId;
  // F1 (P-A1 §A.1): the per-source reader-data cache — filled when a pane opens, reused
  // across panes/refocus. The FOCUSED pane's bundle is mirrored into the top-level
  // anchors/notes/patches/sourceLayers/renderedHtml state so the 8 per-source memos keep
  // deriving unchanged. Each pane's own bundle feeds its reader in P-A2.
  const [sourceBundles, setSourceBundles] = useState<Map<string, SourceBundle>>(() => new Map());
  const currentFocusedPane = focusedPane(openPanes, focusedPaneId);
  const activeSourceId = currentFocusedPane?.sourceId ?? "";
  // `setActiveSourceId(id)` → open-or-focus a pane for that source (the shim). id==="" is
  // "no doc" → close the currently focused pane (VERIFIED: the only two "" call sites are
  // the reader tab-close and deleteSourceItem, both meaning "close the active document").
  // The shim: a library-row click / ingest focus. SWITCH semantics — it replaces the
  // focused pane's source (single tab preserved, byte-identical to the pre-F1 "one active
  // source" UX) or focuses an already-open pane. id==="" closes the focused pane (the
  // reader tab-close / deleteSourceItem "no doc" signal). Opening a SECOND concurrent doc
  // is the explicit `openSourceInNewPane` entry (below), so the single-pane path is intact.
  const setActiveSourceId = useCallback((id: string) => {
    setOpenPanes((panes) => {
      const state = { openPanes: panes, focusedPaneId: focusedPaneIdRef.current };
      const focused = focusedPane(panes, focusedPaneIdRef.current);
      const next = id ? switchFocusedPane(state, id) : closePane(state, focused?.paneId ?? "");
      setFocusedPaneId(next.focusedPaneId);
      return next.openPanes;
    });
  }, []);
  // Open a source in a NEW pane (multi-document): add a tab (or focus if already open),
  // never replacing the focused pane. The explicit multi-doc entry (Ctrl/Cmd-click a
  // library row, "open to the side").
  const openSourceInNewPane = useCallback((id: string) => {
    setOpenPanes((panes) => {
      const next = openOrFocusPane({ openPanes: panes, focusedPaneId: focusedPaneIdRef.current }, id);
      setFocusedPaneId(next.focusedPaneId);
      return next.openPanes;
    });
  }, []);
  // Focus a pane (any pane click / selection routes here first — focus-follows-pane).
  const focusPaneById = useCallback((paneId: string) => {
    setOpenPanes((panes) => {
      const next = focusPane({ openPanes: panes, focusedPaneId: focusedPaneIdRef.current }, paneId);
      setFocusedPaneId(next.focusedPaneId);
      return next.openPanes;
    });
  }, []);
  // Close a pane (tab-strip ×). Focus flips to the neighbour that took its slot.
  const closePaneById = useCallback((paneId: string) => {
    setOpenPanes((panes) => {
      const next = closePane({ openPanes: panes, focusedPaneId: focusedPaneIdRef.current }, paneId);
      setFocusedPaneId(next.focusedPaneId);
      return next.openPanes;
    });
  }, []);
  const [renderedHtml, setRenderedHtml] = useState("");
  const [anchors, setAnchors] = useState<AnyAnchor[]>([]);
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [patches, setPatches] = useState<PatchRecord[]>([]);
  // The active source's layers (the lens axis). Loaded with anchors/notes so the note
  // OR-filter and the per-note layer chips can read them without their own fetch.
  const [sourceLayers, setSourceLayers] = useState<StudyLayerRecord[]>([]);
  const [noteContentType, setNoteContentType] = useState<string>("markdown");
  // Structured draft for OBJECT content types (flashcard/quiz/image/…). Seeded from
  // the type's core `createDefault()` whenever the type changes; string types ignore
  // it (they author through the shared text textarea). Initialized lazily so a
  // string default doesn't seed it.
  const [noteContent, setNoteContent] = useState<unknown>(undefined);
  const [composerMode, setComposerMode] = useState<"ask" | "note">("ask");
  // W1 (ai-workspace §2.1/§2.2): the chat transcript + session state moved into the
  // chat-session domain module (the first F1 slice off this provider). The domain
  // persists turns as they land and resumes the last session on mount; the active
  // source rides new sessions as their §2.1 attachment context ref.
  const chatDomain = useChatSessionDomain({ activeSourceId });
  const chatMessages = chatDomain.messages;
  const [chatInput, setChatInput] = useState("");
  // A4b: the in-flight/last agent turn's render-only transcript (tool cards + streamed
  // text), null when no agent turn has run this session. `agentAvailable` is a mount
  // read of the ACTIVE provider's `tools` capability — the gated 🛠 button shows only
  // when true (a provider that lacks runAgent would 501).
  const [agentTurn, setAgentTurn] = useState<AgentTurnState | null>(null);
  const [agentAvailable, setAgentAvailable] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [patchHtml, setPatchHtml] = useState("");
  const [importUrl, setImportUrl] = useState("");
  const [folderRoots, setFolderRoots] = useState<string[]>(readStoredFolderRoots);
  const [recentSourceIds, setRecentSourceIds] = useState<string[]>(readStoredRecentSourceIds);
  const [conceptsVersion, setConceptsVersion] = useState(0);
  // 标为概念 feedback (CONCEPT-UX-1): the pending toast payload + a monotonic counter
  // so a rapid second mark re-arms the toast timer (seq changes even on equal names).
  const [conceptMark, setConceptMark] = useState<ConceptMarkFeedback | null>(null);
  const conceptMarkSeqRef = useRef(0);
  // D6 auto-materialize feedback: the pending "已生成笔记 · 撤销" toast payload + a
  // monotonic counter so a rapid second materialize re-arms the toast timer.
  const [draftNote, setDraftNote] = useState<DraftNoteFeedback | null>(null);
  const draftNoteSeqRef = useRef(0);
  // D6: a stable bridge so the commandContext's onGenerated (memoized earlier than the
  // materializeAnchor callback is declared) can route an eligible anchor-context draft
  // to auto-materialize without a temporal-dead-zone reference. Assigned once below.
  const materializeAnchorRef = useRef<
    ((anchorId: string, contentType: string, content: unknown) => Promise<NoteRecord | null>) | null
  >(null);
  const [activeLayoutId, setActiveLayoutId] = useState<string>(loadActiveLayout);
  const [activeThemeId, setActiveThemeId] = useState<string>(loadActiveTheme);
  // Note-presentation mode for the DOM HTML reader. Seeded from localStorage so the
  // choice survives reloads; the setter mirrors it back to storage.
  const [annotationMode, setAnnotationModeState] = useState<HtmlAnnotationMode>(readStoredAnnotationMode);
  const [layersVersion, setLayersVersion] = useState(0);
  // The AI draft awaiting preview/edit/save (null = nothing pending), plus a flag for
  // an in-flight regenerate so the preview can show/disable while it re-runs.
  const [pendingDraft, setPendingDraft] = useState<GeneratedDraft | null>(null);
  // Where the pending draft's passage was (D5): the selection rect snapshotted when
  // the draft parks. `lastGenerationRectRef` remembers the rect at DISPATCH time —
  // generation is async and the selection may have collapsed by the time the draft
  // arrives, so park-time falls back to that snapshot.
  const [pendingDraftRect, setPendingDraftRect] = useState<SelectionRect | null>(null);
  const lastGenerationRectRef = useRef<SelectionRect | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  // Park a NEW draft (generation / classification / import / manual): remember the
  // passage rect alongside it so the D5 floating editor opens next to the passage.
  // The live selection rect wins; a collapsed selection falls back to the rect
  // snapshotted when the generation dispatched.
  const parkDraft = useCallback((draft: GeneratedDraft) => {
    setPendingDraftRect(getSelectionRect() ?? lastGenerationRectRef.current);
    setPendingDraft(draft);
  }, []);
  // Whether an AI structured-generation request is in flight (see `generating` in the
  // context type). Set true around a generation command/flow, cleared on done/error.
  const [generating, setGenerating] = useState(false);
  // Custom operations + their workspace prefs (action order / disabled / built-in
  // params). Loaded once and re-fetched whenever the builder/manager bumps the token.
  const [operations, setOperations] = useState<OperationRecord[]>([]);
  const [operationPrefs, setOperationPrefs] = useState<OperationPrefs>(EMPTY_OPERATION_PREFS);
  const [operationsVersion, setOperationsVersion] = useState(0);
  // Kit & Plugin: the per-vault prefs (disabled contribution ids + declared P3/P4 slots).
  // Loaded once on mount; the disabled set is pushed into the clientContext module setter
  // so surface/command filtering reflects it. The installed plugins are read from the
  // registry (populated at install), snapshotted so a toggle re-renders consumers.
  const [pluginPrefs, setPluginPrefs] = useState<PluginPrefs>(EMPTY_PLUGIN_PREFS);
  const [installedPlugins] = useState<readonly PluginRecord[]>(() => listInstalledPlugins());
  // The shell owns which view-kind fills the switchable left slot (it's local shell
  // state, not in the dock tree), so it REGISTERS a "show the operation manager" handler
  // here. The Customize-Toolbar footer in any ActionMoreMenu calls openOperationManager()
  // (the seam), which fires that handler — the panel never reaches into the shell.
  const [showOperationManager, setShowOperationManager] = useState<(() => void) | null>(null);
  // The surface tab the Customize panel should pre-select on its next open (deep-link from
  // an ActionMoreMenu's "Customize Toolbar" footer). operationViews consumes it once.
  const [customizeSurface, setCustomizeSurface] = useState<CustomizeSurface>(undefined);

  // Native file/folder dialogs come from the Electron preload; absent in a browser.
  const canOpenLocal = typeof window !== "undefined" && !!window.studyVault?.openFile;
  const activeFilePath =
    (sources.find((source) => source.id === activeSourceId)?.metadata?.originalPath as string | undefined) ?? undefined;

  const activeSource = sources.find((source) => source.id === activeSourceId) ?? null;
  // The SourceRecord a pane shows — resolve the pane's sourceId against the sources list.
  const sourceForPane = useCallback(
    (paneId: string): SourceRecord | null => {
      const pane = openPanes.find((item) => item.paneId === paneId);
      return pane ? (sources.find((source) => source.id === pane.sourceId) ?? null) : null;
    },
    [openPanes, sources]
  );
  const recentSources = useMemo(() => {
    const byId = new Map(sources.map((source) => [source.id, source]));
    const ordered = recentSourceIds.map((id) => byId.get(id)).filter((source): source is SourceRecord => !!source);
    const seen = new Set(ordered.map((source) => source.id));
    return [...ordered, ...sources.filter((source) => !seen.has(source.id))];
  }, [sources, recentSourceIds]);
  const activeViewer = getSourceViewer(activeSource?.sourceType);
  const selectedAnchorId = focus.anchor?.id ?? "";
  const activeFileDir = parentDir((activeSource?.metadata?.originalPath as string | undefined) ?? "");
  // Server anchor lists are intentionally note-backed so historical no-note anchors
  // do not repaint. The current focused anchor is different: it may have just been
  // materialized and not yet returned by the note-backed refresh. Merge it in so the
  // reader can immediately show/reveal the marker for the active passage.
  const visibleAnchors = useMemo(
    () => mergeFocusedAnchor(anchors, focus.anchor, activeSourceId),
    [anchors, focus.anchor, activeSourceId]
  );

  // The enabled-layer set — the multi-select filter's "on" set. Driven off each
  // layer's stored `enabled` flag (the same source of truth the server filters by, so
  // the client and server agree on which notes/anchors show).
  const enabledLayerIds = useMemo(
    () => new Set(sourceLayers.filter((layer) => layer.enabled).map((layer) => layer.id)),
    [sourceLayers]
  );

  // The OR filter (layer-as-lens): a note shows iff its layerIds intersect the enabled
  // set, OR it has no layers (never orphaned — mirrors the server's empty="always
  // visible" rule). Everything the views render — the note list, the painted note text —
  // derives from this filtered list rather than the raw `notes`.
  const visibleNotes = useMemo(
    () =>
      notes.filter(
        (note) => note.layerIds.length === 0 || note.layerIds.some((id) => enabledLayerIds.has(id))
      ),
    [notes, enabledLayerIds]
  );

  // The FOCUSED pane's paint + reveal lists. Extracted into the pure `buildPaintPipeline`
  // (paneSelectors.ts) so this call reproduces the old paintAnchors/revealAnchors
  // BYTE-FOR-BYTE (the regression lock — same visibleAnchors/notes/sourceLayers/enabled
  // inputs → same output) AND each open reader pane can run the same builder on ITS OWN
  // bundle to paint its own source (P-A2). `paintAnchorsForPane` (below) is that per-pane
  // entry. paintAnchors excludes bookmark-only anchors; revealAnchors keeps all.
  const focusedPaint = useMemo(
    () => buildPaintPipeline({ visibleAnchors, notes, sourceLayers, enabledLayerIds }),
    [visibleAnchors, notes, sourceLayers, enabledLayerIds]
  );
  const paintAnchors = focusedPaint.paintAnchors;
  const revealAnchors = focusedPaint.revealAnchors;

  // P-A2: compute a NON-focused pane's own paint + reveal lists from its cached bundle,
  // under the single global focused-pane layer lens (delta 2: no per-pane Layer Lens in
  // V1). The focused pane reads the memos above; a background pane calls this with its
  // sourceId. A shared cross-source note paints in BOTH panes because it appears in each
  // source's own `notes` (via its anchors in that source).
  const paintAnchorsForPane = useCallback(
    (sourceId: string): { paintAnchors: PaintAnchor[]; revealAnchors: PaintAnchor[] } => {
      if (sourceId === activeSourceId) return focusedPaint;
      const bundle = getBundle(sourceBundles, sourceId);
      if (!bundle) return { paintAnchors: [], revealAnchors: [] };
      return buildPaintPipeline({
        visibleAnchors: bundle.anchors,
        notes: bundle.notes,
        sourceLayers: bundle.sourceLayers,
        enabledLayerIds
      });
    },
    [activeSourceId, focusedPaint, sourceBundles, enabledLayerIds]
  );
  // A pane's rendered HTML — the focused pane reads the top-level state (already mirrored),
  // a background pane reads its cached bundle.
  const renderedHtmlForPane = useCallback(
    (sourceId: string): string => {
      if (sourceId === activeSourceId) return renderedHtml;
      return getBundle(sourceBundles, sourceId)?.renderedHtml ?? "";
    },
    [activeSourceId, renderedHtml, sourceBundles]
  );
  const activePatches = useMemo(
    () => patches.filter((patch) => !selectedAnchorId || patch.anchorId === selectedAnchorId),
    [patches, selectedAnchorId]
  );

  const rememberSourceId = useCallback((sourceId: string) => {
    if (!sourceId) return;
    setRecentSourceIds((current) => {
      const next = [sourceId, ...current.filter((id) => id !== sourceId)].slice(0, 40);
      persistRecentSourceIds(next);
      return next;
    });
  }, []);

  const forgetSourceId = useCallback((sourceId: string) => {
    setRecentSourceIds((current) => {
      const next = current.filter((id) => id !== sourceId);
      persistRecentSourceIds(next);
      return next;
    });
  }, []);

  const addFolderRoot = useCallback((root: string) => {
    const normalized = normalizeFolderRoot(root);
    if (!normalized) return;
    const normalizedKey = normalized.toLocaleLowerCase();
    setFolderRoots((current) => {
      const next = current.some((item) => normalizeFolderRoot(item).toLocaleLowerCase() === normalizedKey)
        ? current
        : [...current, normalized];
      persistFolderRoots(next);
      return next;
    });
  }, []);

  const closeFolderRoot = useCallback((root: string) => {
    const normalizedKey = normalizeFolderRoot(root).toLocaleLowerCase();
    setFolderRoots((current) => {
      const next = current.filter((item) => normalizeFolderRoot(item).toLocaleLowerCase() !== normalizedKey);
      persistFolderRoots(next);
      return next;
    });
  }, []);

  const loadSources = useCallback(async () => {
    setStatus("loading");
    setError("");
    try {
      const response = await entityClient.sources();
      setSources(response.sources);
      // DELTA 4: reconcile the (possibly persisted) panes against the live sources —
      // drop every pane whose source no longer exists — THEN, if nothing is open,
      // default-open the first source (DELTA 1: the explicit first-load auto-open that
      // replaced the old `setActiveSourceId((c)=>c||sources[0]?.id)` functional updater).
      const liveIds = new Set(response.sources.map((source) => source.id));
      const firstSourceId = response.sources[0]?.id;
      setOpenPanes((panes) => {
        const pruned = prunePanes({ openPanes: panes, focusedPaneId: focusedPaneIdRef.current }, liveIds);
        const next =
          pruned.openPanes.length === 0 && firstSourceId
            ? openOrFocusPane(pruned, firstSourceId)
            : pruned;
        setFocusedPaneId(next.focusedPaneId);
        return next.openPanes;
      });
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sources");
      setStatus("error");
    }
  }, []);

  // Fetch a source's full reader data into a SourceBundle. Pure fetch (no state writes)
  // so both the focused-source load (mirror to top-level) and the background per-pane
  // load (cache only) share one network path.
  const fetchSourceBundle = useCallback(
    async (sourceId: string): Promise<SourceBundle> => {
      const sourceRecord = sources.find((item) => item.id === sourceId);
      const viewer = getSourceViewer(sourceRecord?.sourceType);
      const isLocalHtml = viewer.htmlPipeline && !!sourceRecord?.metadata?.originalPath;
      const [rendered, anchorsResponse, notesResponse, patchesResponse, layersResponse] = await Promise.all([
        viewer.htmlPipeline && !isLocalHtml ? entityClient.rendered(sourceId) : Promise.resolve(null),
        entityClient.anchors(sourceId),
        entityClient.notes(sourceId),
        entityClient.patches(sourceId),
        entityClient.layers(sourceId)
      ]);
      return {
        renderedHtml: rendered?.content ?? "",
        anchors: anchorsResponse.anchors,
        notes: notesResponse.notes,
        patches: patchesResponse.patches,
        sourceLayers: layersResponse.layers
      };
    },
    [sources]
  );

  // Mirror a bundle into the top-level anchors/notes/patches/sourceLayers/renderedHtml
  // state (the focused pane's data — every per-source memo derives from these).
  const mirrorBundleToTopLevel = useCallback((bundle: SourceBundle) => {
    setRenderedHtml(bundle.renderedHtml);
    setAnchors(bundle.anchors);
    setNotes(bundle.notes);
    setPatches(bundle.patches);
    setSourceLayers(bundle.sourceLayers);
  }, []);

  // Load (or reuse the cached) bundle for the FOCUSED source: fetch → cache → mirror to
  // top-level, plus the source-switch side effects (clear focus, reset the draft input).
  // On a re-focus onto an already-cached source the bundle is mirrored WITHOUT a refetch.
  const loadSourceWorkspace = useCallback(
    async (sourceId: string) => {
      setStatus("loading");
      setError("");
      try {
        const bundle = await fetchSourceBundle(sourceId);
        setSourceBundles((cache) => putBundle(cache, sourceId, bundle));
        mirrorBundleToTopLevel(bundle);
        focus.clear();
        setPatchHtml("");
        // W1: the chat SESSION survives a source switch (ai-workspace §5 — switch/
        // attach, not wipe); only the draft input resets with the reader.
        setChatInput("");
        setStatus("idle");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load source");
        setStatus("error");
      }
    },
    [fetchSourceBundle, mirrorBundleToTopLevel, focus]
  );

  // Load a NON-focused pane's bundle into the cache only (no top-level mirror, no focus
  // reset) — the per-pane load effect calls this so a background pane paints its own
  // source without disturbing the focused pane's state.
  const loadPaneBundle = useCallback(
    async (sourceId: string) => {
      try {
        const bundle = await fetchSourceBundle(sourceId);
        setSourceBundles((cache) => putBundle(cache, sourceId, bundle));
      } catch {
        // A background pane's fetch failure is non-fatal — its reader shows empty until
        // the next refresh; the focused pane's load surfaces errors.
      }
    },
    [fetchSourceBundle]
  );

  // SRC-2: the authored editor's post-save refresh — a full workspace reload of the
  // ACTIVE source (rendered HTML changes on save, so refreshAnnotations isn't enough).
  const reloadActiveSource = useCallback(async () => {
    if (activeSourceId) await loadSourceWorkspace(activeSourceId);
  }, [activeSourceId, loadSourceWorkspace]);

  // Re-fetch anchors/notes/patches after a mutation that may have created a new anchor
  // (note/patch save), so the painted highlights and lists stay in sync — without
  // resetting the chat the way a full workspace reload would. Takes an explicit sourceId
  // (default: the focused/active source) so a mutation on ANY open pane's source refreshes
  // THAT pane's bundle; the top-level state only mirrors when the refreshed source is the
  // focused one (the per-source memos derive from it).
  const refreshAnnotations = useCallback(
    async (sourceId?: string) => {
      const targetId = sourceId ?? activeSourceId;
      if (!targetId) return;
      try {
        const [anchorsResponse, notesResponse, patchesResponse, layersResponse] = await Promise.all([
          entityClient.anchors(targetId),
          entityClient.notes(targetId),
          entityClient.patches(targetId),
          entityClient.layers(targetId)
        ]);
        const bundle: SourceBundle = {
          // Keep the cached renderedHtml — this refresh only re-reads annotations.
          renderedHtml: getBundle(sourceBundles, targetId)?.renderedHtml ?? renderedHtml,
          anchors: anchorsResponse.anchors,
          notes: notesResponse.notes,
          patches: patchesResponse.patches,
          sourceLayers: layersResponse.layers
        };
        setSourceBundles((cache) => putBundle(cache, targetId, bundle));
        if (targetId === activeSourceId) mirrorBundleToTopLevel(bundle);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to refresh");
      }
    },
    [activeSourceId, sourceBundles, renderedHtml, mirrorBundleToTopLevel]
  );

  const importFromUrl = useCallback(async () => {
    if (!importUrl.trim()) return;
    setStatus("saving");
    setError("");
    try {
      const response = await entityClient.ingestUrl(importUrl.trim());
      await loadSources();
      setActiveSourceId(response.source.id);
      setImportUrl("");
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import URL");
      setStatus("error");
    }
  }, [importUrl, loadSources]);

  const openLiveUrl = useCallback(async () => {
    if (!importUrl.trim()) return;
    setStatus("saving");
    setError("");
    try {
      const response = await entityClient.ingestWebLive(importUrl.trim());
      await loadSources();
      setActiveSourceId(response.source.id);
      setImportUrl("");
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open live URL");
      setStatus("error");
    }
  }, [importUrl, loadSources]);

  const openLocalFile = useCallback(
    async (filePath: string) => {
      setStatus("saving");
      setError("");
      try {
        const response = await entityClient.ingestLocalFile(filePath);
        await loadSources();
        setActiveSourceId(response.source.id);
        setStatus("idle");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to open file");
        setStatus("error");
      }
    },
    [loadSources]
  );

  // The path half of the .xmind import (server unzip+parse → markmap outline parked in
  // the generation preview). Split from the dialog so the ONE Library 文件… picker can
  // route an already-picked path here (LIB-2 folds .xmind into the unified file import).
  const importXmindFromPath = useCallback(
    async (filePath: string) => {
      setStatus("saving");
      setError("");
      try {
        const anchor = await focus.materializeAnchor();
        const result = await entityClient.importXmind(filePath);
        parkDraft({
          promptId: "",
          contentType: result.contentType,
          input: {},
          content: result.content,
          anchorId: anchor?.id,
          sourceId: activeSourceId || undefined,
          classified: true
        });
        setStatus("idle");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to import .xmind");
        setStatus("error");
      }
    },
    [focus, activeSourceId, parkDraft]
  );

  // ONE file picker for every importable file (LIB-2): .xmind routes to the mind-map
  // import above, everything else ingests as a source. The native dialog has no
  // extension filter, so the split happens here by extension.
  const openFileDialog = useCallback(async () => {
    const filePath = await window.studyVault?.openFile?.();
    if (!filePath) return;
    if (/\.xmind$/i.test(filePath)) await importXmindFromPath(filePath);
    else await openLocalFile(filePath);
  }, [openLocalFile, importXmindFromPath]);

  const openFolderDialog = useCallback(async () => {
    const dir = await window.studyVault?.pickDirectory?.();
    if (dir) addFolderRoot(dir);
  }, [addFolderRoot]);

  const deleteSourceItem = useCallback(
    async (sourceId: string, title: string) => {
      if (
        typeof window !== "undefined" &&
        !window.confirm(`Remove "${title}"? This also deletes its notes and highlights.`)
      ) {
        return;
      }
      setStatus("saving");
      setError("");
      try {
        await entityClient.deleteSource(sourceId);
        forgetSourceId(sourceId);
        // DELTA 4: drop EVERY open pane showing the deleted source (not just the focused
        // one), collapsing an emptied split/tab-group, and evict its cached bundle. When
        // the focused pane was one of them, the top-level state is cleared so the reader
        // shows empty until loadSources re-homes focus.
        const wasFocusedSource = activeSourceId === sourceId;
        setOpenPanes((panes) => {
          const live = new Set(panes.map((p) => p.sourceId).filter((id) => id !== sourceId));
          const next = prunePanes({ openPanes: panes, focusedPaneId: focusedPaneIdRef.current }, live);
          setFocusedPaneId(next.focusedPaneId);
          return next.openPanes;
        });
        setSourceBundles((cache) => pruneBundles(cache, new Set([...cache.keys()].filter((id) => id !== sourceId))));
        if (wasFocusedSource) {
          setRenderedHtml("");
          setNotes([]);
          setAnchors([]);
          setPatches([]);
          setSourceLayers([]);
        }
        await loadSources();
        setStatus("idle");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete source");
        setStatus("error");
      }
    },
    [activeSourceId, forgetSourceId, loadSources]
  );

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  // A4b: read the ACTIVE provider's tool capability once on mount so the gated 🛠 button
  // knows whether the agent loop is available. The GET returns the descriptor list with
  // capabilities; match the active id and read `tools`. Best-effort — any failure leaves
  // the button hidden (plain chat still works).
  useEffect(() => {
    // Feature-detect the readout (tests stub a partial entityClient without it) so a
    // missing method never throws inside the effect — the button just stays hidden.
    if (typeof entityClient.aiProviders !== "function") return;
    let cancelled = false;
    void Promise.resolve()
      .then(() => entityClient.aiProviders())
      .then((info) => {
        if (cancelled) return;
        const active = info.providers.find((provider) => provider.id === info.active.id);
        setAgentAvailable(active?.capabilities?.tools === true);
      })
      .catch(() => {
        if (!cancelled) setAgentAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    rememberSourceId(activeSourceId);
  }, [activeSourceId, rememberSourceId]);

  // The FOCUSED source's load: on an id change (a focus flip or a switch), reuse the
  // cached bundle without a refetch when present (mirror it to top-level + run the
  // source-switch side effects), else fetch it. This is the "no-refetch on refocus" path.
  useEffect(() => {
    if (!activeSourceId) return;
    if (hasBundle(sourceBundles, activeSourceId)) {
      const cached = getBundle(sourceBundles, activeSourceId);
      if (cached) {
        mirrorBundleToTopLevel(cached);
        focus.clear();
        setPatchHtml("");
        setChatInput("");
      }
      return;
    }
    void loadSourceWorkspace(activeSourceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mirror App: load on id change only
  }, [activeSourceId]);

  // Per-pane bundle load: every OPEN pane's source needs its bundle cached so its reader
  // can paint (P-A2 feeds each pane its own list). The focused effect above only loads the
  // focused source; this loads any pane's source that isn't cached yet (no top-level mirror).
  useEffect(() => {
    for (const pane of openPanes) {
      if (pane.sourceId && pane.sourceId !== activeSourceId && !hasBundle(sourceBundles, pane.sourceId)) {
        void loadPaneBundle(pane.sourceId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load a pane's bundle on open
  }, [openPanes]);

  // Persist the open panes + focus (mirrors recentSourceIds) so the workspace's open docs
  // survive a reload; reconciled against live sources on the next loadSources (prune).
  useEffect(() => {
    persistPanes({ openPanes, focusedPaneId });
  }, [openPanes, focusedPaneId]);

  // Pre-fill the "Edit source (patch)" textarea from an HTML-surface selection (the
  // only surface whose patches replace study-id elements). All selection/paint logic
  // itself lives in the surface adapters now; this is just the host reacting to the
  // shared draft to seed an unrelated input.
  useEffect(() => {
    const draft = focus.draft;
    if (draft?.mode === "quote" && draft.kind === "html" && draft.studyId) {
      setPatchHtml(`<p data-study-id="${draft.studyId}">${draft.quote}</p>`);
    }
  }, [focus.draft]);

  // Where the active source lives + the focused passage, so the assistant knows
  // exactly which source + passage a question is about.
  const buildChatContext = useCallback((): ChatContext => {
    const meta = (activeSource?.metadata ?? {}) as Record<string, unknown>;
    const url = (meta.sourceUrl ?? meta.normalizedUrl) as string | undefined;
    const filePath = meta.originalPath as string | undefined;
    const draft = focus.draft;
    const quoteDraft = draft?.mode === "quote" ? draft : null;
    const anchorLike = focus.anchor as { contextBefore?: string; contextAfter?: string; page?: number } | null;
    const page = (draft && "page" in draft ? draft.page : undefined) ?? anchorLike?.page;
    const locationParts: string[] = [];
    if (url) locationParts.push(url);
    else if (filePath) locationParts.push(filePath);
    else if (activeSource?.path) locationParts.push(activeSource.path);
    if (page) locationParts.push(`page ${page}`);
    return {
      sourceTitle: activeSource?.title,
      sourceType: activeSource?.sourceType,
      location: locationParts.join(" · ") || undefined,
      quote: quoteDraft?.quote ?? focus.anchor?.quote,
      contextBefore: quoteDraft?.prefix ?? anchorLike?.contextBefore,
      contextAfter: quoteDraft?.suffix ?? anchorLike?.contextAfter
    };
  }, [activeSource, focus.draft, focus.anchor]);

  // W2 (ai-workspace §W2): resolve the chat's source-context set — the FOCUSED source
  // (passage-level, keyed by activeSourceId) UNION the session's explicit attachments
  // (source-level), de-duped by sourceId (focused-first). Fetch each source's bundle
  // (bounded excerpt + sealed-filtered notes) then hand the PURE assembler the union +
  // the cross-source cap. CHAT-ONLY: awaited by anchor.ask-ai via the feature-detected
  // resolveAttachmentBundles seam; nothing else calls it. Bundle-fetch failures degrade
  // to skipping that source (a broken read must not sink the whole ask).
  const attachments = chatDomain.sessions.attachments;
  const resolveAttachmentBundles = useCallback(async (): Promise<ChatContext["sources"]> => {
    const focusedId = activeSourceId || "";
    // The de-dup KEY set: focused source first, then each attached source not equal to it.
    const attachedIds = attachments.map((item) => item.sourceId);
    const orderedIds = [focusedId, ...attachedIds].filter(Boolean);
    if (orderedIds.length === 0) return undefined;
    const includeNotesById = new Map(attachments.map((item) => [item.sourceId, item.includeNotes]));
    const seen = new Set<string>();
    const resolved: ResolvedBundle[] = [];
    for (const sourceId of orderedIds) {
      if (seen.has(sourceId)) continue;
      seen.add(sourceId);
      const focused = sourceId === focusedId;
      // Focused source: always include its notes; an attachment honors its includeNotes flag.
      const includeNotes = focused ? true : includeNotesById.get(sourceId) ?? true;
      try {
        const { bundle } = await entityClient.sourceBundle(sourceId, includeNotes);
        resolved.push({ sourceId, focused, bundle });
      } catch {
        // Skip a source whose bundle can't be read — the rest of the context still helps.
      }
    }
    const sources = assembleContextSources(resolved);
    return sources.length > 0 ? sources : undefined;
  }, [activeSourceId, attachments]);

  // Assemble the shared CommandContext. Commands collaborate through focus, the
  // entity client, and these action callbacks — never by touching node internals.
  const commandContext = useCallback(
    (payload: CommandContext["payload"]): CommandContext => ({
      focus,
      client: entityClient,
      sourceId: activeSourceId || undefined,
      payload,
      chatMessages,
      chatContext: buildChatContext(),
      // W2: the CHAT-ONLY attachment resolver (anchor.ask-ai feature-detects + awaits it).
      resolveAttachmentBundles,
      actions: {
        onNoteCreated: () => void refreshAnnotations(),
        // W3 (ai-workspace §W3): a chat transcript was synthesized into a NEW markdown
        // source — reload the library then open the new doc in a fresh pane (the
        // create-then-open idiom forkActiveSource uses).
        onSourceSynthesized: (source) => void loadSources().then(() => openSourceInNewPane(source.id)),
        // A note was deleted: re-fetch notes + repaint (painting is derived from
        // notes, so a removed note stops painting automatically).
        onNoteDeleted: () => void refreshAnnotations(),
        // Destructive-action gate (note.delete). Desktop/web both have window.confirm;
        // SSR/tests fall through to proceed (tests inject their own confirm).
        confirm: (message) => (typeof window !== "undefined" ? window.confirm(message) : true),
        // A kit AI action generated content. D6 (note-presentation-unified.md §6): a
        // DIRECT note-type button that ran WITH a focused-anchor context (a real
        // `anchorId`, and NOT a classified/manual draft — those are the 试一下 /
        // note.generate-block / floating-editor flows) AUTO-MATERIALIZES as a draft note
        // on that anchor + an undo toast — the chip appears at the passage without a Save
        // click. Everything else (no anchor context, or classified/manual) keeps parking
        // in the D5 floating editor (the preview loop is UNCHANGED). onGenerated's
        // contract doesn't change — the host just gained an auto-save consumer beside it.
        onGenerated: (draft) => {
          if (shouldAutoMaterialize(draft) && materializeAnchorRef.current) {
            void materializeAnchorRef.current(draft.anchorId, draft.contentType, draft.content);
            return;
          }
          parkDraft(draft);
        },
        onPatchCreated: () => void refreshAnnotations(),
        // W1 chat-session seams (src/client/chat/useChatSessions): the domain module
        // updates the visible transcript AND persists the turns — user message on
        // send, assistant message on reply (non-streamed) or stream end (Done);
        // chunks stay render-only so no partial reply is ever written.
        onChatHistory: (history) => chatDomain.recordHistory(history),
        onAssistantMessage: (message) => chatDomain.appendAssistant(message),
        onAssistantChunk: (delta) => chatDomain.applyChunk(delta),
        onAssistantDone: (message) => chatDomain.persistAssistant(message),
        // A new concept / changed link / new-or-deleted relation: bump the token so
        // concept views re-fetch, and refresh the source's notes so a freshly linked
        // note's conceptIds show up in the study panel too.
        onConceptChanged: () => {
          setConceptsVersion((value) => value + 1);
          void refreshAnnotations();
        },
        // 标为概念 (CONCEPT-UX-1): park the feedback so ConceptMarkToast shows the
        // concept name + the 撤销 affordance (undo = delete the marker note).
        onConceptMarked: ({ concept, note, linkedExisting }) => {
          conceptMarkSeqRef.current += 1;
          setConceptMark({
            conceptId: concept.id,
            conceptName: concept.name,
            noteId: note.id,
            linkedExisting,
            seq: conceptMarkSeqRef.current
          });
        },
        onRelationChanged: () => setConceptsVersion((value) => value + 1),
        // A layer was toggled/imported: bump the token (switcher re-fetches) AND
        // refresh annotations (the painted highlights follow enabled layers).
        onLayersChanged: () => {
          setLayersVersion((value) => value + 1);
          void refreshAnnotations();
        }
      }
    }),
    [
      focus,
      activeSourceId,
      chatMessages,
      chatDomain,
      buildChatContext,
      resolveAttachmentBundles,
      refreshAnnotations,
      parkDraft,
      loadSources,
      openSourceInNewPane
    ]
  );

  const dispatch = useCallback(
    async (commandId: string, payload: CommandContext["payload"]) => {
      // A generation command flips the shared `generating` flag (spinner + disabled
      // trigger) on top of the generic saving state; cleared in finally on done/error.
      const isGen = isGenerationCommand(commandId);
      setStatus("saving");
      setError("");
      if (isGen) {
        // Snapshot the passage rect NOW (the selection is still live under the
        // toolbar click) — parkDraft falls back to it when the async generation
        // finishes after the selection has collapsed (D5 editor placement).
        lastGenerationRectRef.current = getSelectionRect();
        setGenerating(true);
      }
      try {
        await runCommand(commandId, commandContext(payload));
        setStatus("idle");
      } catch (err) {
        // Surface generation errors instead of failing silently (the indicator clears
        // and the error-box shows the message).
        setError(err instanceof Error ? err.message : "Command failed");
        setStatus("error");
      } finally {
        if (isGen) setGenerating(false);
      }
    },
    [commandContext]
  );

  // —— generation preview actions ——
  // Persist the previewed (possibly edited) content as a note via the normal
  // add-note command, attaching to the anchor the generation already created (passed
  // as explicit anchorIds so the command SKIPs materializing a duplicate). Clear the
  // preview afterward.
  const savePendingDraft = useCallback(
    (content: unknown, conceptNames?: string[]) => {
      const draft = pendingDraft;
      if (!draft) return;
      // Clear the draft BEFORE the async dispatch so a rapid double-click on Save
      // sees a null draft and early-returns — otherwise two `anchor.add-note`
      // dispatches fire while the draft is still set, creating a duplicate note.
      setPendingDraft(null);
      // A MANUAL draft (D5 floating editor) has no pre-materialized anchor — OMIT
      // anchorIds entirely so anchor.add-note materializes the focused passage
      // (its normal fallback). Generated drafts keep the explicit list ([] when the
      // generation ran without a passage) so no duplicate anchor is materialized.
      // CG-2 auto-tag: an EXPLICIT conceptNames (the preview's surviving chips —
      // possibly [] after removals) wins; a caller that doesn't pass one falls back
      // to the draft's own AI suggestions, so suggested concepts link on save even
      // before a host mounts the removable-chips row.
      const names = conceptNames ?? draft.concepts;
      void dispatch("anchor.add-note", {
        content,
        contentType: draft.contentType,
        ...(names && names.length > 0 ? { conceptNames: names } : {}),
        ...(draft.manual ? {} : { anchorIds: draft.anchorId ? [draft.anchorId] : [] })
      });
    },
    [pendingDraft, dispatch]
  );

  // Re-run the same generation (same prompt/contentType/input) and swap in the new
  // content. The mock provider is deterministic, so this may yield identical content —
  // the UX must not depend on the content changing.
  const regeneratePendingDraft = useCallback(async () => {
    const draft = pendingDraft;
    if (!draft) return;
    // A CLASSIFIED draft (chat reply routed through resolveForm/classifyContent) has no
    // prompt to re-run — Regenerate is a no-op for it.
    if (draft.classified) return;
    setRegenerating(true);
    setError("");
    try {
      // An AUTO-output draft (a simple action with no pinned type — ACTION-2a) must
      // re-run WITHOUT a contentType: the server rejects a pinned type for it, and
      // the form router may legitimately route the rerun to a different form. The
      // response's contentType keeps the preview in sync either way.
      const { content, contentType } = await entityClient.generateStructured({
        promptId: draft.promptId,
        contentType: draft.autoForm ? undefined : draft.contentType,
        input: draft.input
      });
      setPendingDraft({ ...draft, content, contentType: contentType ?? draft.contentType });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to regenerate");
    } finally {
      setRegenerating(false);
    }
  }, [pendingDraft]);

  // Drop the pending draft without persisting anything.
  const discardPendingDraft = useCallback(() => setPendingDraft(null), []);

  // D5 manual creation: park a MANUAL draft (createDefault-seeded, no promptId) so
  // the floating editor opens next to the current passage in EDIT mode. Save goes
  // through savePendingDraft → anchor.add-note with NO anchorIds, which materializes
  // the focused passage if there is one (else saves unanchored on the source) —
  // exactly the composer path this replaces. `classified` makes Regenerate a no-op.
  const openManualEditor = useCallback(
    (contentType: string) => {
      parkDraft({
        promptId: "",
        contentType,
        input: {},
        content: createDefaultContent(contentType),
        sourceId: activeSourceId || undefined,
        classified: true,
        manual: true
      });
    },
    [activeSourceId, parkDraft]
  );

  // The user's current text selection within a reply, or the full reply if they
  // haven't highlighted anything — lets them keep just the useful part.
  const selectedTextOr = useCallback((fullContent: string): string => {
    const selected = typeof window !== "undefined" ? window.getSelection()?.toString().trim() : "";
    return selected || fullContent;
  }, []);

  // Save-a-chat-reply, routed through the IDENTIFICATION contract (§0.5-A / §6.6): the
  // reply text goes through `resolveForm` (no declared form → classifyContent), and the
  // DETECTED form is parked in the SAME generation-preview loop a kit draft uses — so
  // the user previews the recognized form (markmap / mermaid / code / markdown) before
  // it is saved, instead of the old hardcoded contentType:"markdown". Materialize the
  // focused passage first (if any) so Save attaches the note to it (matching the
  // generation-preview Save path), then mark the draft `classified` (Regenerate no-ops).
  // The OPTIONAL AI classify pass (Phase 4 item 2), wired as resolveFormAsync's gated
  // callback. It is invoked ONLY when the pure heuristic is low-confidence (the
  // heuristic stays primary). It asks the model — via the server's /api/notes/classify
  // (the form router) — to decide the form for ambiguous prose. Best-effort: a failure
  // returns null so resolveFormAsync keeps the heuristic's markdown fallback. With the
  // default offline mock the router returns markdown, so the deterministic flow is
  // unchanged (today's heuristic + markdown fallback).
  const aiClassify = useCallback<AiClassify>(async (text) => {
    try {
      const result = await entityClient.classifyForm({ text });
      return { contentType: result.contentType, content: result.content, confidence: result.confidence };
    } catch {
      return null;
    }
  }, []);

  const previewClassifiedReply = useCallback(
    async (text: string) => {
      const trimmed = (text ?? "").trim();
      if (!trimmed) return;
      setStatus("saving");
      setError("");
      // Classify can hit the AI form-router (low-confidence fallback), so it's a
      // generation flow too — show the shared indicator while it runs.
      setGenerating(true);
      try {
        const anchor = await focus.materializeAnchor();
        const form = await resolveFormAsync({ text: trimmed }, { classify: aiClassify });
        parkDraft({
          promptId: "",
          contentType: form.contentType,
          input: {},
          content: form.content,
          anchorId: anchor?.id,
          sourceId: activeSourceId || undefined,
          classified: true
        });
        setStatus("idle");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to classify reply");
        setStatus("error");
      } finally {
        setGenerating(false);
      }
    },
    [focus, activeSourceId, aiClassify, parkDraft]
  );

  // §10 chat card "Add as note": classify the reply into its registered form (the SAME
  // pure heuristic the preview path uses) and create the note in ONE step. Respects the
  // user's TEXT SELECTION within the reply (selectedTextOr → keep just the useful part).
  //
  // D6 (note-presentation-unified.md §6): WITH anchor context (a passage is focused when
  // the reply is kept), the note AUTO-MATERIALIZES as a status:"draft" note on that anchor
  // + an undo toast — the chip appears at the passage immediately, no Save click. WITHOUT
  // anchor context (free chat), it stays the one-step add through anchor.add-note (which
  // saves unanchored on the active source) — chat-only path UNCHANGED.
  const addReplyAsNote = useCallback(
    async (rawContent: string) => {
      const text = selectedTextOr(rawContent ?? "").trim();
      if (!text) return;
      const form = classifyContent(text);
      // Anchor context = a focused saved anchor or a fresh selection draft. Materialize it
      // (a saved anchor materializes to itself) so the draft note attaches to the passage.
      const hasAnchorContext = !!focus.anchor || !!focus.draft;
      if (hasAnchorContext && materializeAnchorRef.current) {
        const anchor = await focus.materializeAnchor();
        if (anchor) {
          await materializeAnchorRef.current(anchor.id, form.contentType, form.content);
          return;
        }
      }
      await dispatch("anchor.add-note", { content: form.content, contentType: form.contentType });
    },
    [dispatch, selectedTextOr, focus]
  );

  // §10 chat card "Regenerate": re-ask the most recent user question, appending a fresh
  // assistant reply to the thread (the streaming ask path handles the rest). A no-op if
  // there is no prior user prompt.
  const regenerateChatReply = useCallback(() => {
    const lastUser = [...chatMessages].reverse().find((message) => message.role === "user");
    if (!lastUser) return;
    // V-1: collapse a multimodal turn to text for the re-ask (image → `[image]`).
    void dispatch("anchor.ask-ai", { text: chatContentText(lastUser.content) });
  }, [chatMessages, dispatch]);

  // A4b: run ONE agent turn (the 🛠 用工具 button). Invoked DIRECTLY here — not through
  // the command registry — because the tool cards are render-only state with no
  // persistence contract until `done` (DELTA 4). Mirrors askAi's context assembly:
  //   • record the user turn EXACTLY ONCE via the existing recordHistory seam (DELTA 5);
  //     the SSE `done` must NOT re-append it.
  //   • reuse buildChatContext() + resolveAttachmentBundles() exactly as askAi does.
  //   • fold each SSE event into agentTurn via the pure reducer; on `done` persist the
  //     final message as the ONE real assistant turn (persistAssistant), then clear the
  //     transcript; on reject keep the accumulated items in an error state.
  const runAgentTurn = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (!text) return;
      const history: ChatMessage[] = [...chatMessages, { role: "user", content: text }];
      // Record the user turn ONCE (the visible transcript + persistence seam).
      chatDomain.recordHistory(history);
      setStatus("saving");
      setError("");
      setAgentTurn(initialAgentTurn());
      try {
        const sources = await resolveAttachmentBundles();
        const context: ChatContext | undefined =
          sources && sources.length > 0 ? { ...buildChatContext(), sources } : buildChatContext();
        const { message } = await entityClient.agentStream(
          { messages: history, context },
          {
            onStep: () => setAgentTurn((turn) => reduceAgentEvent(turn ?? initialAgentTurn(), { type: "step", index: 0 })),
            onTextDelta: (delta) =>
              setAgentTurn((turn) => reduceAgentEvent(turn ?? initialAgentTurn(), { type: "text-delta", delta })),
            onToolCall: (call) =>
              setAgentTurn((turn) => reduceAgentEvent(turn ?? initialAgentTurn(), { type: "tool-call", ...call })),
            onToolResult: (result) =>
              setAgentTurn((turn) => reduceAgentEvent(turn ?? initialAgentTurn(), { type: "tool-result", ...result }))
          }
        );
        // The final answer becomes the ONE real assistant turn — appended to the visible
        // chat log AND persisted via appendAssistant (Add-as-note / regenerate keep
        // working). Unlike the streaming ask path there were no applyChunk deltas
        // building a visible bubble (the transcript did), so append (not persist) here.
        // Mark the transcript done, then drop the tool cards.
        setAgentTurn((turn) => reduceAgentEvent(turn ?? initialAgentTurn(), { type: "done", message, provider: "" }));
        chatDomain.appendAssistant(message);
        setAgentTurn(null);
        setStatus("idle");
      } catch (err) {
        const messageText = err instanceof Error ? err.message : "工具调用失败";
        // Keep the accumulated tool cards but flip the turn to error so the user sees why.
        setAgentTurn((turn) => reduceAgentEvent(turn ?? initialAgentTurn(), { type: "error", error: messageText }));
        setError(messageText);
        setStatus("error");
      }
    },
    [chatMessages, chatDomain, buildChatContext, resolveAttachmentBundles]
  );

  // .xmind import (adaptive-note-forms Phase 4 item 3). Open a native file dialog and
  // delegate to importXmindFromPath (defined next to openFileDialog above, which also
  // routes picked .xmind paths there — LIB-2's ONE 文件… picker). The parsed markmap
  // parks in the SAME preview/save loop every other generated note uses; contentType
  // comes from the SERVER response, never a host literal — no new renderer, no bypass.
  const importXmindFile = useCallback(async () => {
    const filePath = await window.studyVault?.openFile?.();
    if (!filePath) return;
    await importXmindFromPath(filePath);
  }, [importXmindFromPath]);

  const changePatchStatus = useCallback(
    async (patch: PatchRecord, nextStatus: "applied" | "reverted" | "rejected") => {
      if (!activeSource) return;
      setStatus("saving");
      setError("");
      try {
        await entityClient.updatePatch(patch.id, nextStatus);
        await loadSourceWorkspace(activeSource.id);
        setStatus("idle");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update patch");
        setStatus("error");
      }
    },
    [activeSource, loadSourceWorkspace]
  );

  // SRC-3: fork the active IMPORTED source into an editable AUTHORED copy — the copy is
  // a fresh document (notes/anchors STAY on the original, per §3), so we just reload the
  // library and open the new source (which then routes to the authored editor view).
  const forkActiveSource = useCallback(async () => {
    if (!activeSource || !isForkableImportedSource(activeSource)) return;
    setStatus("saving");
    setError("");
    try {
      const { source } = await getSourceAuthoringIo().forkSource(activeSource.id);
      await loadSources();
      setActiveSourceId(source.id);
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fork source");
      setStatus("error");
    }
  }, [activeSource, loadSources]);

  const canForkActiveSource = useMemo(
    () => !!activeSource && isForkableImportedSource(activeSource),
    [activeSource]
  );

  const refreshConcepts = useCallback(() => setConceptsVersion((value) => value + 1), []);

  // Cheap undo for 标为概念: delete the just-created marker note — that removes the
  // anchor↔concept link (and the paint, since painting is note-derived). The concept
  // RECORD itself stays: the entity client has no concept-delete API, and a reusable
  // empty concept is harmless (documented CONCEPT-UX-1 decision).
  const undoConceptMark = useCallback(async () => {
    const mark = conceptMark;
    if (!mark) return;
    setConceptMark(null);
    try {
      await entityClient.deleteNote(mark.noteId);
      setConceptsVersion((value) => value + 1);
      await refreshAnnotations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to undo concept mark");
    }
  }, [conceptMark, refreshAnnotations]);

  const dismissConceptMark = useCallback(() => setConceptMark(null), []);

  // —— D6 auto-materialize (note-presentation-unified.md §6) ——————————————————
  // Materialize an anchor-context AI answer AS a note ON `anchorId`: create it with
  // status:"draft" (so it exists + paints immediately, distinguishable as a draft) and
  // park the undo feedback. This is the auto-save consumer that sits BESIDE the
  // preview-loop parkDraft consumer; the generation command already materialized the
  // anchor, so createNote attaches to it directly (no float-and-edit). Repaint on
  // success (the D2 chip appears at the passage — paint is note-derived, so it's free).
  const materializeAnchor = useCallback(
    async (anchorId: string, contentType: string, content: unknown): Promise<NoteRecord | null> => {
      try {
        const { note } = await entityClient.createNote({
          sourceId: activeSourceId || undefined,
          anchorIds: [anchorId],
          contentType,
          content,
          status: "draft"
        });
        draftNoteSeqRef.current += 1;
        setDraftNote({ noteId: note.id, contentType: note.contentType, seq: draftNoteSeqRef.current });
        await refreshAnnotations();
        return note;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to materialize note");
        return null;
      }
    },
    [activeSourceId, refreshAnnotations]
  );
  // Keep the onGenerated bridge pointing at the current callback (render-time assign is
  // fine — the ref is only read inside async onGenerated handlers, never during render).
  materializeAnchorRef.current = materializeAnchor;

  // Undo the last auto-materialize: dispatch note.delete on the draft note (painting is
  // note-derived, so the chip disappears on the delete's onNoteDeleted repaint). Goes
  // through the SAME command as any delete — no bespoke removal path. The confirm gate
  // is skipped here: this IS the undo affordance for a note the user never explicitly
  // saved, so re-confirming would be nonsense (dispatch's confirm covers manual deletes).
  const undoDraftNote = useCallback(async () => {
    const feedback = draftNote;
    if (!feedback) return;
    setDraftNote(null);
    await dispatch("note.delete", { noteId: feedback.noteId, skipConfirm: true });
  }, [draftNote, dispatch]);

  const dismissDraftNote = useCallback(() => setDraftNote(null), []);

  // Flip the note-presentation mode and persist the choice (so it survives reload).
  const setAnnotationMode = useCallback((mode: HtmlAnnotationMode) => {
    setAnnotationModeState(mode);
    persistAnnotationMode(mode);
  }, []);

  // Reload the layer switcher (token) AND repaint the reader (enabled layers drive
  // which anchors the server returns). Used by the switcher after a direct import.
  const refreshLayers = useCallback(() => {
    setLayersVersion((value) => value + 1);
    void refreshAnnotations();
  }, [refreshAnnotations]);

  // Flip one layer's membership in the multi-select filter. The stored `enabled` flag IS
  // the filter source of truth (the server reads it for both the note list and derived
  // anchor painting), so this routes through the layer.toggle command; its shared
  // onLayersChanged action re-fetches layers + annotations, which updates the filter.
  const toggleLayerFilter = useCallback(
    (layer: StudyLayerRecord) => {
      void dispatch("layer.toggle", { layerId: layer.id, enabled: !layer.enabled });
    },
    [dispatch]
  );

  // CASCADE set (Layer Lens parent toggle): flip several leaf layers to the SAME enabled
  // state at once, then refresh layers + annotations ONCE (instead of per-layer, which
  // would re-fetch N times and race). Only patches layers whose state actually changes.
  const setLayersEnabled = useCallback(
    async (layerIds: string[], enabled: boolean) => {
      const targets = sourceLayers.filter((layer) => layerIds.includes(layer.id) && layer.enabled !== enabled);
      if (targets.length === 0) return;
      setStatus("saving");
      setError("");
      try {
        await Promise.all(targets.map((layer) => entityClient.patchLayer(layer.id, { enabled })));
        setLayersVersion((value) => value + 1);
        await refreshAnnotations();
        setStatus("idle");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update layers");
        setStatus("error");
      }
    },
    [sourceLayers, refreshAnnotations]
  );

  // The right-panel composer is pure AI Chat now: no Note mode or note-type routing.
  const composerCommandId = "anchor.ask-ai";
  const composerCtx = commandContext({ text: chatInput });
  const composerDisabled = !getCommand(composerCommandId)?.isAvailable(composerCtx);

  const submitComposer = useCallback(() => {
    if (composerDisabled) return;
    const text = chatInput;
    setChatInput("");
    void dispatch(composerCommandId, { text });
  }, [composerDisabled, chatInput, dispatch, composerCommandId]);

  // Switching the note type re-seeds the structured draft from the NEW type's core
  // default (object types only; string types author through the text textarea and
  // leave the draft undefined). Keeps the editor showing a valid blank value.
  const changeNoteContentType = useCallback((type: string) => {
    setNoteContentType(type);
    setNoteContent(isTextContentType(type) ? undefined : createDefaultContent(type));
  }, []);

  // Save the structured draft as a note (object content types). Sends the `content`
  // object verbatim — the plugin's editor already shaped it; the server re-validates
  // it against the core spec. After save, re-seed a fresh blank draft of the type.
  const submitNoteContent = useCallback(() => {
    void dispatch("anchor.add-note", { content: noteContent, contentType: noteContentType }).then(() =>
      setNoteContent(createDefaultContent(noteContentType))
    );
  }, [dispatch, noteContent, noteContentType]);

  // The chip / patch text uses the focused passage's quote — empty for region
  // drafts (a region has no text, but the chip still shows a "Region selected" hint
  // below so the user knows there IS a focus).
  const draftQuote = draftQuoteText(focus.draft) || focus.anchor?.quote || "";
  const hasRegionDraft = focus.draft?.mode === "region";

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

  // Effective kit ids for the active source (per-source activation). Recomputed from
  // the active source's metadata; rendering is never gated by this.
  const activeKitIds = useMemo(() => activeKitIdsForSource(activeSource), [activeSource]);

  // Apply a Product Kit to the active source ("core" = none). Persists to
  // source.metadata.activeKitIds, then reloads sources so the gate recomputes.
  const setActiveKit = useCallback(
    async (kitId: string) => {
      if (!activeSourceId) return;
      const nextKitIds = kitId === CORE_KIT_ID ? [] : [kitId];
      try {
        await entityClient.updateSourceMetadata(activeSourceId, { activeKitIds: nextKitIds });
        await loadSources();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to set kit");
      }
    },
    [activeSourceId, loadSources]
  );

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

  // Load the Kit & Plugin prefs on mount and push the disabled set into the clientContext
  // module setter, so surface/command filtering reflects the user's toggles from the first
  // render. Additive + best-effort: a failure leaves nothing disabled (the panel + toolbars
  // still work). No version token — the panel mutates prefs through setContributionEnabled,
  // which updates state directly.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { prefs } = await entityClient.pluginPrefs();
        if (cancelled) return;
        setPluginPrefs(prefs);
        setDisabledContributions(prefs.disabledContributions);
      } catch {
        // plugin prefs are additive — keep the panel + toolbars working with nothing disabled
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The single WRITE seam for the Kit & Plugin manager (IRON LAW): merge one contribution
  // id into/out of `disabledContributions`, push the next disabled set into the
  // clientContext module setter (so surface/command filtering updates immediately), update
  // local state (so the panel re-renders its toggle), and PUT the next prefs. Mirrors
  // saveActionPrefs — the panel never calls entityClient directly.
  const setContributionEnabled = useCallback(
    (contributionId: string, enabled: boolean) => {
      setPluginPrefs((prev) => {
        const set = new Set(prev.disabledContributions);
        if (enabled) set.delete(contributionId);
        else set.add(contributionId);
        const nextDisabled = Array.from(set);
        const next: PluginPrefs = { ...prev, disabledContributions: nextDisabled };
        setDisabledContributions(nextDisabled);
        void entityClient.putPluginPrefs(next).catch((err) => {
          setError(err instanceof Error ? err.message : "Failed to save plugin prefs");
        });
        return next;
      });
    },
    []
  );

  // Viewer pin — the user-explicit-association tier of the exclusive viewer resolver
  // (plugin-viewer-model §4). Merge the (target → viewerId) association into
  // viewerAssociations.byNoteId or byContentType, update local state (so the resolver +
  // panel re-render), and PUT the next prefs. Mirrors setContributionEnabled: the note
  // "Open with…" control and the manager panel's conflict picker call this; neither
  // touches entityClient directly. A note pin (noteId) and a type pin (contentType) can
  // both be set in one call; each honored where present.
  const pinViewer = useCallback(
    (target: { contentType?: string; noteId?: string }, viewerId: string) => {
      setPluginPrefs((prev) => {
        const associations = prev.viewerAssociations ?? { byContentType: {}, byNoteId: {} };
        const byContentType = { ...associations.byContentType };
        const byNoteId = { ...associations.byNoteId };
        if (target.noteId) byNoteId[target.noteId] = viewerId;
        if (target.contentType) byContentType[target.contentType] = viewerId;
        const next: PluginPrefs = { ...prev, viewerAssociations: { byContentType, byNoteId } };
        void entityClient.putPluginPrefs(next).catch((err) => {
          setError(err instanceof Error ? err.message : "Failed to save viewer association");
        });
        return next;
      });
    },
    []
  );

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

  // —— workspace layout switching ——
  const availableLayouts = useMemo(() => LAYOUT_PRESETS.map((preset) => ({ id: preset.id, name: preset.name })), []);
  const setActiveLayout = useCallback((id: string) => {
    setActiveLayoutId(id);
    try {
      globalThis.localStorage?.setItem(ACTIVE_LAYOUT_KEY, id);
    } catch {
      // storage unavailable — keep the in-memory choice
    }
  }, []);

  // —— theme switching (sibling of layout) ——
  const availableThemes = useMemo(() => listThemes().map((theme) => ({ id: theme.id, name: theme.name })), []);
  const setActiveTheme = useCallback((id: string) => {
    setActiveThemeId(id);
    applyActiveTheme(id); // flips <html data-theme> + color-scheme — the whole-app re-skin
    try {
      globalThis.localStorage?.setItem(THEME_STORAGE_KEY, id);
    } catch {
      // storage unavailable — keep the in-memory choice
    }
  }, []);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      focus,
      status,
      error,
      sources,
      recentSources,
      activeSourceId,
      activeSource,
      activeViewer,
      setActiveSourceId,
      openSourceInNewPane,
      openPanes,
      focusedPaneId,
      focusPane: focusPaneById,
      closePane: closePaneById,
      sourceForPane,
      paintAnchorsForPane,
      renderedHtmlForPane,
      loadSources,
      deleteSourceItem,
      removeRecentSourceId: forgetSourceId,
      reloadActiveSource,
      renderedHtml,
      anchors: visibleAnchors,
      notes,
      patches,
      paintAnchors,
      revealAnchors,
      activePatches,
      annotationMode,
      setAnnotationMode,
      canOpenLocal,
      folderRoots,
      closeFolderRoot,
      activeFilePath,
      importUrl,
      setImportUrl,
      openLocalFile,
      openFileDialog,
      openFolderDialog,
      importFromUrl,
      openLiveUrl,
      chatMessages,
      chatSessions: chatDomain.sessions,
      composerMode,
      setComposerMode,
      noteContentType,
      setNoteContentType: changeNoteContentType,
      noteContent,
      setNoteContent,
      submitNoteContent,
      chatInput,
      setChatInput,
      patchHtml,
      setPatchHtml,
      showTerminal,
      setShowTerminal,
      activeFileDir,
      draftQuote,
      hasRegionDraft,
      composerDisabled,
      submitComposer,
      dispatch,
      pendingDraft,
      pendingDraftRect,
      openManualEditor,
      regenerating,
      generating,
      savePendingDraft,
      regeneratePendingDraft,
      discardPendingDraft,
      selectedTextOr,
      previewClassifiedReply,
      addReplyAsNote,
      regenerateChatReply,
      agentTurn,
      agentAvailable,
      runAgentTurn,
      importXmindFile,
      changePatchStatus,
      canForkActiveSource,
      forkActiveSource,
      conceptsVersion,
      refreshConcepts,
      conceptMark,
      undoConceptMark,
      dismissConceptMark,
      materializeAnchor,
      draftNote,
      undoDraftNote,
      dismissDraftNote,
      layersVersion,
      refreshLayers,
      sourceLayers,
      enabledLayerIds,
      visibleNotes,
      toggleLayerFilter,
      setLayersEnabled,
      activeKitIds,
      installedKits,
      setActiveKit,
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
      customizeSurface,
      activeLayoutId,
      availableLayouts,
      setActiveLayout,
      activeThemeId,
      availableThemes,
      setActiveTheme,
      installedPlugins,
      pluginPrefs,
      setContributionEnabled,
      pinViewer
    }),
    [
      focus,
      status,
      error,
      sources,
      recentSources,
      activeSourceId,
      activeSource,
      activeViewer,
      openSourceInNewPane,
      openPanes,
      focusedPaneId,
      focusPaneById,
      closePaneById,
      sourceForPane,
      paintAnchorsForPane,
      renderedHtmlForPane,
      loadSources,
      deleteSourceItem,
      forgetSourceId,
      reloadActiveSource,
      renderedHtml,
      visibleAnchors,
      notes,
      patches,
      paintAnchors,
      revealAnchors,
      activePatches,
      annotationMode,
      setAnnotationMode,
      canOpenLocal,
      folderRoots,
      closeFolderRoot,
      activeFilePath,
      importUrl,
      openLocalFile,
      openFileDialog,
      openFolderDialog,
      importFromUrl,
      openLiveUrl,
      chatMessages,
      chatDomain.sessions,
      composerMode,
      noteContentType,
      changeNoteContentType,
      noteContent,
      submitNoteContent,
      chatInput,
      patchHtml,
      showTerminal,
      activeFileDir,
      draftQuote,
      hasRegionDraft,
      composerDisabled,
      submitComposer,
      dispatch,
      pendingDraft,
      pendingDraftRect,
      openManualEditor,
      regenerating,
      generating,
      savePendingDraft,
      regeneratePendingDraft,
      discardPendingDraft,
      selectedTextOr,
      previewClassifiedReply,
      addReplyAsNote,
      regenerateChatReply,
      agentTurn,
      agentAvailable,
      runAgentTurn,
      importXmindFile,
      changePatchStatus,
      canForkActiveSource,
      forkActiveSource,
      conceptsVersion,
      refreshConcepts,
      conceptMark,
      undoConceptMark,
      dismissConceptMark,
      materializeAnchor,
      draftNote,
      undoDraftNote,
      dismissDraftNote,
      layersVersion,
      refreshLayers,
      sourceLayers,
      enabledLayerIds,
      visibleNotes,
      toggleLayerFilter,
      setLayersEnabled,
      activeKitIds,
      setActiveKit,
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
      customizeSurface,
      activeLayoutId,
      availableLayouts,
      setActiveLayout,
      activeThemeId,
      availableThemes,
      setActiveTheme,
      installedPlugins,
      pluginPrefs,
      setContributionEnabled,
      pinViewer
    ]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used within a WorkspaceProvider");
  return value;
}

// Null-safe variant: returns the context value, or `null` when rendered OUTSIDE a
// WorkspaceProvider (standalone components / tests) instead of throwing. Surfaces that can
// run both inside and outside the provider (the shared ArtifactCard / FocusOverlay) read
// through this so they degrade gracefully — a null result simply means "no prefs / no
// provider-backed actions available".
export function useWorkspaceOptional(): WorkspaceContextValue | null {
  return useContext(WorkspaceContext);
}
