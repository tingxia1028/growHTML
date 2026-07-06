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
import { useFocus, draftQuoteText, type FocusContextValue } from "../focus/FocusContext";
import { getPlatformOptional, platformDialogs } from "../platform";
// A4b: the agent-loop transcript — a render-only turn state accumulated from the agent
// SSE (entityClient.agentStream). Distinct from the persisted chat log; only done.message
// becomes a real assistant turn (via the existing persistAssistant seam).
import { initialAgentTurn, reduceAgentEvent, type AgentTurnState } from "./agentTurnReducer";
import { BOOKMARK_CONTENT_TYPE } from "../../core/notes/contentTypes";
// PLAT-LAYER Part-2 Slice 7b — createDefaultContent / isTextContentType moved into
// useComposerDomain with the note-type composer callbacks (changeNoteContentType /
// submitNoteContent) that were their only provider callers.
import { type SourceViewer } from "../viewers";
import { getCommand, runCommand, type CommandContext, type GeneratedDraft } from "../commands/registry";
import type { PaintAnchor } from "../surfaces/types";
// D5 floating editor: a parked draft remembers WHERE its passage was (the live
// selection rect in host coords) so the editor floats next to it, not at a pane
// bottom. Best-effort — null falls back to a reader-panel-anchored position.
import { type SelectionRect } from "../selection/selectionRect";
import { type HtmlAnnotationMode } from "../annotations";
import { type PluginRecord } from "../../kits/plugin";
// PLAT-LAYER Part-2 Slice 1 — the layout + theme state/logic now live in these two
// TIER-A leaf domain hooks; the provider only composes their memoized surfaces.
import { useLayoutDomain } from "./useLayoutDomain";
import { useThemeDomain } from "./useThemeDomain";
// PLAT-LAYER Part-2 Slice 2 — the Kit & Plugin state/logic now lives in this TIER-A leaf
// domain hook; the provider only composes its memoized surface.
import { usePluginDomain } from "./usePluginDomain";
// PLAT-LAYER Part-2 Slice 3 — the concept state/logic (conceptsVersion token, the 标为概念
// toast + its undo/dismiss) now lives in this domain hook. Nearly a leaf: it takes ONE
// injected back-edge (`refreshAnnotations`, for the undo repaint) + the error sink.
import { useConceptDomain } from "./useConceptDomain";
// PLAT-LAYER Part-2 Slice 4b — the XL DOCUMENTS domain (TIER-B core, one unit): the
// panes ↔ sourceBundles ↔ activeSourceId ↔ top-level reader-state cluster + all its
// fetch/mutation IO + 5 effects. The provider composes its memoized surface.
import { useDocumentsDomain } from "./useDocumentsDomain";
// PLAT-LAYER Part-2 Slice 5 — the KIT domain (a TIER-C composer over the pipeline): owns
// the per-source activeKitIds resolver, the installedKits list, and setActiveKit (whose
// inline entityClient.updateSourceMetadata write moves in). Reads documents outputs
// (activeSource / activeSourceId / loadSources / setError) via the landed `docs` surface.
import { useKitDomain } from "./useKitDomain";
// PLAT-LAYER Part-2 Slice 6 — the OPERATION domain (a TIER-C composer over the pipeline):
// owns the loaded operations + operationPrefs + the refresh token, the operation-manager UI
// atoms, saveActionPrefs (whose inline entityClient.saveOperationPrefs write moves in), the
// merged/ordered selection/anchor/source toolbar lists + runAction, and the mount-load effect
// (its entityClient.operations/operationPrefs reads move in). Reads kit + focus + coordinator
// dispatch (injected — dispatch reads no operation output, so it is declared AFTER dispatch).
import { useOperationDomain } from "./useOperationDomain";
// PLAT-LAYER Part-2 Slice 7a — the GENERATION domain (the generation-preview loop + the D6
// auto-materialize + the chat-reply classify/save paths). Establishes the trampoline-ref
// machinery (dispatchRef/parkRef + render-time assigns + beginGeneration/endGeneration) that
// 7b/7c reuse. Its 3 entityClient sites (generateStructured/classifyForm/createNote) move in.
import { useGenerationDomain, type Dispatch } from "./useGenerationDomain";
// PLAT-LAYER Part-2 Slice 7b — the COMPOSER domain (the right-panel composer state + the lone
// shell showTerminal toggle + the composer submit/attach actions). REUSES 7a's trampoline
// machinery: it captures the STABLE `dispatch` trampoline, re-homes `resetReaderDraftInputs`
// (the documents hook now consumes it via the provider's resetRef trampoline), and reads
// `composerDisabled` through the injected disabledRef seam. Its 2 entityClient sites
// (importImageBase64 ×2) move in.
import { useComposerDomain } from "./useComposerDomain";
// F1 (P-A1): the open-panes model type — the pure panes engine + its callers moved into
// useDocumentsDomain (Slice 4b); the provider keeps only the OpenPane type for its interface.
import { type OpenPane } from "./panes";
import { renderAnnotationNotePreview } from "./annotationNotePreview";
import { useLocale } from "../i18n";
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

// PLAT-LAYER Part-2 Slice 6 — the EMPTY_OPERATION_PREFS seed, the workspaceActionMessages
// bundle, the CONVERT_TO_REGION_ACTION_ID / BOOKMARK_ACTION / CONCEPT_MARK_COMMAND_ID consts,
// and the arrangeActions / orderActionsForSurface ordering helpers all moved into
// useOperationDomain alongside the action-list assembly that consumes them.

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
  "textbook.generate-review-pack",
  // V-2 拍错题: the photo→mistake extract is an AI structured generation (spinner + preview).
  "mistake-photo.capture"
]);

/** True for a command that triggers AI structured generation (drives `generating`). */
export function isGenerationCommand(commandId: string): boolean {
  return GENERATION_COMMAND_IDS.has(commandId);
}

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

// PLAT-LAYER Part-2 Slice 6 — the action-ordering helpers (arrangeActions /
// orderActionsForSurface, plus the dead back-compat orderActions) moved into
// useOperationDomain with the selection/source action assembly that is their only caller.

// PLAT-LAYER Part-2 Slice 4b — the recent-source-ids + folder-roots persistence helpers
// (readStoredRecentSourceIds / persistRecentSourceIds / readStoredFolderRoots /
// persistFolderRoots / normalizeFolderRoot + their storage keys) moved into
// useDocumentsDomain alongside the state they back.

// PLAT-LAYER Part-2 Slice 7b — the V-1 `fileToBase64` helper (picked File → base64 for the
// /api/assets import) moved into useComposerDomain alongside its only two callers
// (attachImage + captureMistakePhoto).

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
  /** V-1: images picked for the NEXT ask-ai turn (already imported → assetId REFs). */
  pendingImages: Array<{ assetId: string; mimeType: string }>;
  /** V-1: import a picked image File into the vault + stage it as a pending attachment. */
  attachImage(file: File): Promise<void>;
  /** V-1: drop a staged pending image before sending. */
  removePendingImage(assetId: string): void;
  /**
   * V-2 (拍错题, vision-input.md §3): import a picked PHOTO and run the VLM extract → the
   * extracted `mistake` draft parks in the generation preview (preview-then-Save). `hint`
   * is optional user text folded into the prompt. Degrade-not-disappear on a non-vision
   * provider (the clean 400 surfaces via `error`).
   */
  captureMistakePhoto(file: File, hint?: string): Promise<void>;
  /** V-2: whether the ACTIVE provider advertises IMAGE input — a UI HINT only (the 拍错题
      affordance stays visible regardless; a non-vision send surfaces the clean 400). */
  visionAvailable: boolean;
  /** Alpha polish: the ACTIVE AI provider is the offline `mock` (a fresh install with no
      real provider configured), so its chat replies are canned placeholder echoes. Drives
      a dismissible honesty hint in the chat surface pointing at AI 提供方 settings. */
  offlineMock: boolean;
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

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const focus = useFocus();
  const locale = useLocale();
  // —— PLAT-LAYER Part-2 Slice 7a — the trampoline seams (the plan's CRUX). The coordinator
  //    `dispatch` reads generation outputs (beginGeneration/endGeneration) AND the generation
  //    hook reads `dispatch` (savePendingDraft/addReplyAsNote/undoDraftNote dispatch commands)
  //    — an apparent cycle. Resolved exactly as `materializeAnchorRef` already is: declare
  //    STABLE ([]-deps) trampoline useCallbacks backed by refs BEFORE the hooks; the hooks
  //    capture the STABLE trampoline (never `.current`), so their callback identities don't
  //    churn; the real callbacks are assigned into the refs at RENDER TIME (safe — a trampoline
  //    is only invoked in handlers/effects, never during render). ——————————————————————————
  // dispatch trampoline: the generation hook captures THIS; `dispatchRef.current = dispatch`
  // is assigned after the real dispatch is declared (below).
  const dispatchRef = useRef<Dispatch | null>(null);
  const dispatch = useCallback<Dispatch>((commandId, payload) => dispatchRef.current!(commandId, payload), []);
  // parkDraft trampoline (§5 knot): the documents hook consumes park-a-draft, but parkDraft is
  // a generation-owned callback. It has []-deps + reads only generation atoms (documents-
  // independent → not circular), so inject it through this stable trampoline; `parkRef.current
  // = generation.parkDraft` is assigned after the generation hook is declared (below).
  // Init to null (not a no-op stub) so the trampoline fails LOUD — same idiom as `dispatchRef`
  // above: an early invoke before the render-time assign throws rather than silently dropping the
  // draft. Unreachable today (docs only calls parkDraft in async effects/handlers, post-commit),
  // but the uniform fail-loud keeps the pattern honest as 7b/7c add resetRef on the same idiom.
  const parkRef = useRef<((draft: GeneratedDraft) => void) | null>(null);
  const parkDraft = useCallback((draft: GeneratedDraft) => parkRef.current!(draft), []);
  // resetReaderDraftInputs trampoline (§5, slice 7b): the documents hook consumes the source-
  // switch reset of the reader draft inputs (patchHtml + chatInput), but those atoms are
  // COMPOSER-owned (slice 7b moved them into useComposerDomain). Same fail-LOUD idiom as
  // parkRef above: init null (not a no-op stub) so an early invoke before the render-time
  // assign throws rather than silently skipping the reset; `resetRef.current =
  // composer.resetReaderDraftInputs` is assigned after the composer hook is declared (below).
  // Documents already receives THIS `resetReaderDraftInputs` callback — now that callback IS
  // the trampoline (its guts, setPatchHtml/setChatInput, live in composer). Unreachable early
  // today (docs only calls it in async load handlers, post-commit), but the uniform fail-loud
  // keeps the pattern honest (mirrors dispatchRef / parkRef).
  const resetRef = useRef<(() => void) | null>(null);
  const resetReaderDraftInputs = useCallback(() => resetRef.current!(), []);
  // R5 (composerDisabled forward-ref seam, slice 7b): `composerDisabled` is a PROVIDER-BODY
  // derive (it reads the command context + composer.chatInput/pendingImages, all provider-
  // visible), computed AFTER commandContext (below). The composer hook's submitComposer reads
  // it through THIS ref at CALL TIME (submit is only ever invoked in the submit handler, post-
  // commit) so the hook never captures a stale disabled value; `disabledRef.current =
  // composerDisabled` is assigned render-time after composerDisabled is computed (below).
  const disabledRef = useRef(false);
  // A4b: the in-flight/last agent turn's render-only transcript (tool cards + streamed
  // text), null when no agent turn has run this session. `agentAvailable` is a mount
  // read of the ACTIVE provider's `tools` capability — the gated 🛠 button shows only
  // when true (a provider that lacks runAgent would 501).
  const [agentTurn, setAgentTurn] = useState<AgentTurnState | null>(null);
  const [agentAvailable, setAgentAvailable] = useState(false);
  // V-2 (拍错题): a mount read of the ACTIVE provider's `vision` capability. The 拍错题
  // capture affordance stays visible regardless (degrade-not-disappear); this flag only
  // lets the UI HINT when a non-vision provider would surface the clean 400 on send.
  const [visionAvailable, setVisionAvailable] = useState(false);
  // Offline-Mock honesty (alpha polish): the ACTIVE provider is the deterministic offline
  // `mock` (fresh install, no real provider configured) — its replies are canned echoes.
  // Read once from the SAME aiProviders() mount effect (active.kind === "mock"); the chat
  // surface shows a dismissible hint pointing at AI 提供方 settings. Best-effort: any read
  // failure leaves it false (no banner — the pre-existing silent behavior).
  const [offlineMock, setOfflineMock] = useState(false);
  // PLAT-LAYER Part-2 Slice 7a — the generation cluster (draftNote/draftNoteSeqRef/
  // materializeAnchorRef, pendingDraft/pendingDraftRect/lastGenerationRectRef, regenerating,
  // generating + parkDraft) now lives in useGenerationDomain (instantiated after
  // docs/kit/plugin/concept/chat, below). parkDraft rides the parkRef trampoline (declared
  // above) so the documents hook keeps consuming it without a temporal-dead-zone reference.
  // PLAT-LAYER Part-2 Slice 7b — the COMPOSER cluster (noteContentType/noteContent/
  // composerMode/chatInput/pendingImages/patchHtml/showTerminal + attachImageError, the
  // composer submit/attach callbacks, the patch-seed effect, and resetReaderDraftInputs) now
  // lives in useComposerDomain (instantiated after generation, below). resetReaderDraftInputs
  // rides the resetRef trampoline (declared above) so the documents hook keeps consuming it
  // without a temporal-dead-zone reference; submitComposer reads composerDisabled via disabledRef.
  // PLAT-LAYER Part-2 Slice 6 — the operations + operationPrefs + operationsVersion state and
  // the operation-manager UI atoms (showOperationManager / customizeSurface) now live in
  // useOperationDomain (instantiated after `dispatch`, which runAction injects). The provider
  // only spreads its memoized `operation` surface into the value memo below.

  // PLAT-LAYER Part-2 Slice 1 — layout + theme are TIER-A leaf domains (zero pipeline
  // reads); each hook returns a memoized surface the value memo spreads verbatim.
  const layout = useLayoutDomain();
  const theme = useThemeDomain();

  // PLAT-LAYER Part-2 Slice 4b — the DOCUMENTS domain (the XL TIER-B core, one unit): the
  // panes ↔ sourceBundles ↔ activeSourceId ↔ top-level reader-state cluster + all its
  // fetch/mutation IO + its 5 effects. Injected deps are the shared `focus`, the stable
  // generation-cluster `parkDraft`, and the coordinator `resetReaderDraftInputs` seam.
  // Instantiated BEFORE plugin/concept/chat because those now consume its surface
  // (docs.setError / docs.refreshAnnotations / docs.activeSourceId).
  const docs = useDocumentsDomain({ focus, parkDraft, resetReaderDraftInputs });

  // PLAT-LAYER Part-2 Slice 5 — the KIT domain (TIER-C): the per-source activeKitIds
  // resolver + installedKits + setActiveKit (whose inline entityClient.updateSourceMetadata
  // → loadSources write now lives in the hook). It CONSUMES documents outputs, so it is
  // instantiated AFTER `docs`: activeSource feeds the foreground resolver, and
  // activeSourceId/loadSources/setError back the pin write + its error path.
  const kit = useKitDomain({
    activeSource: docs.activeSource,
    activeSourceId: docs.activeSourceId,
    loadSources: docs.loadSources,
    onError: docs.setError
  });

  // PLAT-LAYER Part-2 Slice 2 — the Kit & Plugin domain (a TIER-A leaf): owns
  // installedPlugins + pluginPrefs, the mount-load effect, and the setContributionEnabled/
  // pinViewer write seams. Its error sink is now the documents surface's setError (which
  // owns status/error after slice 4b).
  const plugin = usePluginDomain({ onError: docs.setError });

  // PLAT-LAYER Part-2 Slice 3 — the concept domain (nearly a leaf). Its one back-edge
  // (`refreshAnnotations`, for undoConceptMark's repaint) + its error sink now come from
  // the documents surface — hence documents is instantiated first. The coordinator's
  // onConceptMarked/onConceptChanged/onRelationChanged drive concept state through the
  // surface's bumpConceptsVersion/notifyConceptMarked setters (below, in commandContext).
  const concept = useConceptDomain({ refreshAnnotations: docs.refreshAnnotations, onError: docs.setError });

  // W1 (ai-workspace §2.1/§2.2): the chat transcript + session state live in the
  // chat-session domain module. It rides the focused source (docs.activeSourceId) as the
  // §2.1 attachment context ref, so it is instantiated AFTER the documents domain.
  const chatDomain = useChatSessionDomain({ activeSourceId: docs.activeSourceId });
  const chatMessages = chatDomain.messages;

  // PLAT-LAYER Part-2 Slice 7a — the GENERATION domain: the generation-preview loop, the D6
  // auto-materialize, and the chat-reply classify/save paths. Its 3 entityClient sites
  // (generateStructured/classifyForm/createNote) moved in. It captures the STABLE `dispatch`
  // trampoline (declared above; `dispatchRef.current = dispatch` render-time, below) so its
  // callbacks don't churn, and reads documents outputs (activeSourceId / refreshAnnotations /
  // setError / setStatus) via the landed `docs` surface. Instantiated AFTER docs/kit/plugin/
  // concept/chat, BEFORE commandContext (which reads generation.parkDraft/materializeAnchorRef).
  const generation = useGenerationDomain({
    focus,
    dispatch,
    activeSourceId: docs.activeSourceId,
    refreshAnnotations: docs.refreshAnnotations,
    onError: docs.setError,
    onStatus: docs.setStatus
  });
  // §5 knot: resolve the parkDraft trampoline the documents hook consumes (parkDraft is
  // generation-owned + documents-independent, so this render-time assign is safe + behavior-
  // identical — the trampoline is only invoked in handlers/effects, never during render).
  parkRef.current = generation.parkDraft;

  // PLAT-LAYER Part-2 Slice 7b — the COMPOSER domain: the right-panel composer state + the lone
  // shell showTerminal toggle + the composer submit/attach actions (submitComposer /
  // submitNoteContent / attachImage / removePendingImage / captureMistakePhoto / changeNoteContentType)
  // + the patch-seed effect + resetReaderDraftInputs. Its 2 entityClient sites (importImageBase64 ×2)
  // moved in. It captures the STABLE `dispatch` trampoline (declared above), reads composerDisabled
  // via the injected disabledRef (computed below), and surfaces image-import errors through docs.setError.
  // Instantiated AFTER generation (so the coordinator riders are all resolved), BEFORE commandContext
  // (which reads composer.chatInput/pendingImages).
  const composer = useComposerDomain({
    focus,
    dispatch,
    onError: docs.setError,
    disabledRef
  });
  // §5 knot: resolve the resetReaderDraftInputs trampoline the documents hook consumes (it
  // resets composer-owned atoms + is documents-independent, so this render-time assign is safe
  // + behavior-identical — the trampoline is only invoked in async load handlers, never during
  // render).
  resetRef.current = composer.resetReaderDraftInputs;

  // Native file/folder dialogs come from the Electron preload; absent in a browser.
  const canOpenLocal =
    getPlatformOptional()?.capabilities.nativeFileDialogs ??
    (typeof window !== "undefined" && !!window.studyVault?.openFile);
  // The active source's file directory (for the terminal cwd hint). Reads the documents
  // surface's activeSource; not in the documents move list, so it stays a coordinator
  // derive (mirrors canOpenLocal — both go straight into the value memo, not the spread).
  const activeFileDir = parentDir((docs.activeSource?.metadata?.originalPath as string | undefined) ?? "");

  // PLAT-LAYER Part-2 Slice 4b — importFromUrl / openLiveUrl / openLocalFile /
  // importXmindFromPath / openFileDialog / openFolderDialog / deleteSourceItem (and their
  // entityClient ingest/delete sites) now live in useDocumentsDomain, composed via `docs`
  // and spread into the value memo below. The 5 documents-owned effects (loadSources on
  // mount, rememberSourceId on id change, the focused-source load, the per-pane background
  // load, persist-panes) moved with them.

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
        // V-2: the same readout feeds the 拍错题 vision hint (degrade-not-disappear).
        setVisionAvailable(active?.capabilities?.vision === true);
        // Offline-Mock honesty: the server reports the active provider's capability kind
        // (aiProviders.ts → active.kind = capabilities.kind), which is "mock" for BOTH the
        // mock and mock-agent providers — a keyless/offline default. The chat surface hints.
        setOfflineMock(info.active.kind === "mock");
      })
      .catch(() => {
        if (!cancelled) {
          setAgentAvailable(false);
          setVisionAvailable(false);
          setOfflineMock(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // PLAT-LAYER Part-2 Slice 7b — the patch-seed effect (pre-fill the "Edit source (patch)"
  // textarea from an HTML-surface selection → setPatchHtml) moved into useComposerDomain
  // alongside the patchHtml atom it seeds.

  // Where the active source lives + the focused passage, so the assistant knows
  // exactly which source + passage a question is about.
  const buildChatContext = useCallback((): ChatContext => {
    const activeSource = docs.activeSource;
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
  }, [docs.activeSource, focus.draft, focus.anchor]);

  // W2 (ai-workspace §W2): resolve the chat's source-context set — the FOCUSED source
  // (passage-level, keyed by activeSourceId) UNION the session's explicit attachments
  // (source-level), de-duped by sourceId (focused-first). Fetch each source's bundle
  // (bounded excerpt + sealed-filtered notes) then hand the PURE assembler the union +
  // the cross-source cap. CHAT-ONLY: awaited by anchor.ask-ai via the feature-detected
  // resolveAttachmentBundles seam; nothing else calls it. Bundle-fetch failures degrade
  // to skipping that source (a broken read must not sink the whole ask).
  const attachments = chatDomain.sessions.attachments;
  const resolveAttachmentBundles = useCallback(async (): Promise<ChatContext["sources"]> => {
    const focusedId = docs.activeSourceId || "";
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
  }, [docs.activeSourceId, attachments]);

  // Assemble the shared CommandContext. Commands collaborate through focus, the
  // entity client, and these action callbacks — never by touching node internals.
  const commandContext = useCallback(
    (payload: CommandContext["payload"]): CommandContext => ({
      focus,
      client: entityClient,
      sourceId: docs.activeSourceId || undefined,
      payload,
      chatMessages,
      chatContext: buildChatContext(),
      // W2: the CHAT-ONLY attachment resolver (anchor.ask-ai feature-detects + awaits it).
      resolveAttachmentBundles,
      actions: {
        onNoteCreated: () => void docs.refreshAnnotations(),
        // W3 (ai-workspace §W3): a chat transcript was synthesized into a NEW markdown
        // source — reload the library then open the new doc in a fresh pane (the
        // create-then-open idiom forkActiveSource uses).
        onSourceSynthesized: (source) => void docs.loadSources().then(() => docs.openSourceInNewPane(source.id)),
        // A note was deleted: re-fetch notes + repaint (painting is derived from
        // notes, so a removed note stops painting automatically).
        onNoteDeleted: () => void docs.refreshAnnotations(),
        // Destructive-action gate (note.delete). Routes through the platform dialogs
        // funnel (PLAT-LAYER STEP-2) so a future mobile host supplies native confirm;
        // web/desktop wrap window.confirm. The command awaits this (registry.ts:719),
        // so returning a Promise<boolean> is clean. SSR/tests fall through to proceed.
        confirm: (message) => platformDialogs().confirm(message),
        // A kit AI action generated content. D6 (note-presentation-unified.md §6): a
        // DIRECT note-type button that ran WITH a focused-anchor context (a real
        // `anchorId`, and NOT a classified/manual draft — those are the 试一下 /
        // note.generate-block / floating-editor flows) AUTO-MATERIALIZES as a draft note
        // on that anchor + an undo toast — the chip appears at the passage without a Save
        // click. Everything else (no anchor context, or classified/manual) keeps parking
        // in the D5 floating editor (the preview loop is UNCHANGED). onGenerated's
        // contract doesn't change — the host just gained an auto-save consumer beside it.
        onGenerated: (draft) => {
          if (shouldAutoMaterialize(draft) && generation.materializeAnchorRef.current) {
            void generation.materializeAnchorRef.current(draft.anchorId, draft.contentType, draft.content);
            return;
          }
          generation.parkDraft(draft);
        },
        onPatchCreated: () => void docs.refreshAnnotations(),
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
        // note's conceptIds show up in the study panel too. (Slice 3: the token bump
        // now drives concept state through the useConceptDomain surface.)
        onConceptChanged: () => {
          concept.bumpConceptsVersion();
          void docs.refreshAnnotations();
        },
        // 标为概念 (CONCEPT-UX-1): park the feedback so ConceptMarkToast shows the
        // concept name + the 撤销 affordance (undo = delete the marker note). The seq
        // stamp lives inside notifyConceptMarked now (Slice 3 — the ref stays in the hook).
        onConceptMarked: ({ concept: markedConcept, note, linkedExisting }) => {
          concept.notifyConceptMarked({
            conceptId: markedConcept.id,
            conceptName: markedConcept.name,
            noteId: note.id,
            linkedExisting
          });
        },
        onRelationChanged: () => concept.bumpConceptsVersion(),
        // A layer was toggled/imported: bump the token (switcher re-fetches) AND
        // refresh annotations (the painted highlights follow enabled layers). Both are
        // exactly docs.refreshLayers (setLayersVersion + refreshAnnotations moved into docs).
        onLayersChanged: () => docs.refreshLayers()
      }
    }),
    [
      focus,
      docs,
      chatMessages,
      chatDomain,
      buildChatContext,
      resolveAttachmentBundles,
      generation,
      concept
    ]
  );

  // The REAL dispatch implementation. Everything else (the generation/operation hooks + the
  // provider's own callbacks) consumes the STABLE `dispatch` trampoline declared at the top;
  // `dispatchRef.current = dispatchImpl` (below) resolves the trampoline to this impl. The
  // isGen branch flips the shared `generating` flag through the generation hook's
  // beginGeneration/endGeneration seams (those atoms now live in useGenerationDomain).
  const dispatchImpl = useCallback(
    async (commandId: string, payload: CommandContext["payload"]) => {
      // A generation command flips the shared `generating` flag (spinner + disabled
      // trigger) on top of the generic saving state; cleared in finally on done/error.
      const isGen = isGenerationCommand(commandId);
      docs.setStatus("saving");
      docs.setError("");
      // Snapshot the passage rect NOW (the selection is still live under the toolbar click)
      // + flip `generating` on — parkDraft falls back to that rect when the async generation
      // finishes after the selection has collapsed (D5 editor placement). beginGeneration
      // does both; endGeneration clears the flag in finally.
      if (isGen) generation.beginGeneration();
      try {
        await runCommand(commandId, commandContext(payload));
        docs.setStatus("idle");
      } catch (err) {
        // Surface generation errors instead of failing silently (the indicator clears
        // and the error-box shows the message).
        docs.setError(err instanceof Error ? err.message : "Command failed");
        docs.setStatus("error");
      } finally {
        if (isGen) generation.endGeneration();
      }
    },
    [commandContext, docs.setStatus, docs.setError, generation.beginGeneration, generation.endGeneration]
  );
  // Resolve the dispatch trampoline (render-time assign — safe, the trampoline is only ever
  // invoked in handlers/effects, never during render).
  dispatchRef.current = dispatchImpl;

  // PLAT-LAYER Part-2 Slice 7a — the generation-preview actions (savePendingDraft /
  // regeneratePendingDraft / discardPendingDraft / openManualEditor), the chat-reply
  // classify/save paths (selectedTextOr / aiClassify / previewClassifiedReply /
  // addReplyAsNote), and the D6 auto-materialize (materializeAnchor + its materializeAnchorRef
  // render-time assign / undoDraftNote / dismissDraftNote) now live in useGenerationDomain,
  // composed via `generation` above and spread into the value memo below. Their 3 entityClient
  // sites (generateStructured / classifyForm / createNote) moved with them.

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
      docs.setStatus("saving");
      docs.setError("");
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
        docs.setStatus("idle");
      } catch (err) {
        const messageText = err instanceof Error ? err.message : "工具调用失败";
        // Keep the accumulated tool cards but flip the turn to error so the user sees why.
        setAgentTurn((turn) => reduceAgentEvent(turn ?? initialAgentTurn(), { type: "error", error: messageText }));
        docs.setError(messageText);
        docs.setStatus("error");
      }
    },
    [chatMessages, chatDomain, buildChatContext, resolveAttachmentBundles, docs.setStatus, docs.setError]
  );

  // .xmind import (adaptive-note-forms Phase 4 item 3). Open a native file dialog and
  // delegate to importXmindFromPath (defined next to openFileDialog above, which also
  // routes picked .xmind paths there — LIB-2's ONE 文件… picker). The parsed markmap
  // parks in the SAME preview/save loop every other generated note uses; contentType
  // comes from the SERVER response, never a host literal — no new renderer, no bypass.
  const importXmindFile = useCallback(async () => {
    const filePath = await (getPlatformOptional()?.files.pickFile() ??
      (window.studyVault?.openFile?.() ?? Promise.resolve(null)));
    if (!filePath) return;
    await docs.importXmindFromPath(filePath);
  }, [docs.importXmindFromPath]);

  // PLAT-LAYER Part-2 Slice 4b — changePatchStatus / forkActiveSource / canForkActiveSource
  // now live in useDocumentsDomain (they orchestrate the panes/bundles/sources cluster),
  // composed via `docs` and spread into the value memo below.

  // PLAT-LAYER Part-2 Slice 3 — refreshConcepts / undoConceptMark / dismissConceptMark
  // (and undo's inline entityClient.deleteNote) now live in useConceptDomain, composed
  // via `concept` above and spread into the value memo below.

  // PLAT-LAYER Part-2 Slice 4b — setAnnotationMode / refreshLayers / setLayersEnabled now
  // live in useDocumentsDomain (spread via `docs`). `toggleLayerFilter` stays HERE because
  // it dispatches the `layer.toggle` COMMAND through the coordinator's `dispatch`, which
  // transitively depends on the documents surface (commandContext → docs.refreshAnnotations)
  // — injecting `dispatch` into the hook would be circular. It reads no documents state.
  const toggleLayerFilter = useCallback(
    (layer: StudyLayerRecord) => {
      void dispatch("layer.toggle", { layerId: layer.id, enabled: !layer.enabled });
    },
    [dispatch]
  );

  // R5 (composerDisabled forward-ref seam, slice 7b): the composer's primary action
  // availability STAYS a provider-body derive — it reads the command context + the composer
  // surface's chatInput/pendingImages (all provider-visible). The composer hook's
  // submitComposer reads it through the disabledRef seam at call time (assigned below). The
  // right-panel composer is pure AI Chat now: no Note mode or note-type routing.
  const composerCommandId = "anchor.ask-ai";
  // V-1: pass the pending images so an image-ONLY turn (empty text) is still available.
  const composerCtx = commandContext({
    text: composer.chatInput,
    images: composer.pendingImages.map((image) => ({ type: "image" as const, assetId: image.assetId, mimeType: image.mimeType }))
  });
  const composerDisabled = !getCommand(composerCommandId)?.isAvailable(composerCtx);
  // Resolve the disabledRef seam (render-time assign — safe, submitComposer reads
  // `disabledRef.current` only inside its submit handler, never during render).
  disabledRef.current = composerDisabled;

  // PLAT-LAYER Part-2 Slice 7b — the composer submit/attach actions (submitComposer /
  // submitNoteContent / attachImage / removePendingImage / captureMistakePhoto /
  // changeNoteContentType), their 2 entityClient.importImageBase64 sites, and the fileToBase64
  // helper now live in useComposerDomain, composed via `composer` above and spread into the
  // value memo below. submitComposer reads composerDisabled through the disabledRef seam.

  // The chip / patch text uses the focused passage's quote — empty for region
  // drafts (a region has no text, but the chip still shows a "Region selected" hint
  // below so the user knows there IS a focus).
  const draftQuote = draftQuoteText(focus.draft) || focus.anchor?.quote || "";
  const hasRegionDraft = focus.draft?.mode === "region";

  // PLAT-LAYER Part-2 Slice 6 — the OPERATION domain (a TIER-C composer). Owns the
  // operations/operationPrefs/operationsVersion state + the operation-manager UI atoms, the
  // saveActionPrefs / refreshOperations / register+openOperationManager seams, the
  // convertSelectionToRegion 转为区域 helper, the merged/ordered selection/anchor/source
  // toolbar lists + runAction, and the operations mount-load effect (its entityClient reads
  // move in). Instantiated AFTER `dispatch` (runAction injects it) and after `kit`:
  // dispatch/commandContext read NO operation output, so injecting dispatch is not circular.
  const operation = useOperationDomain({
    activeKitIds: kit.activeKitIds,
    focus,
    locale,
    dispatch
  });

  // —— layout + theme switching moved to useLayoutDomain / useThemeDomain (Slice 1);
  // their memoized surfaces (`layout`, `theme`) are spread into the value memo below. ——

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      focus,
      canOpenLocal,
      chatMessages,
      chatSessions: chatDomain.sessions,
      visionAvailable,
      offlineMock,
      activeFileDir,
      draftQuote,
      hasRegionDraft,
      composerDisabled,
      dispatch,
      regenerateChatReply,
      agentTurn,
      agentAvailable,
      runAgentTurn,
      importXmindFile,
      toggleLayerFilter,
      // Slice 7b — the COMPOSER surface spread verbatim: keeps the SAME 18 public field
      // names/shape (composerMode/setComposerMode, noteContentType/setNoteContentType
      // [=changeNoteContentType], noteContent/setNoteContent, submitNoteContent, chatInput/
      // setChatInput, pendingImages, attachImage, removePendingImage, captureMistakePhoto,
      // patchHtml/setPatchHtml, showTerminal/setShowTerminal, submitComposer) so consumers are
      // unchanged. The coordinator-only rider (resetReaderDraftInputs) also rides along but
      // isn't in the interface — a harmless extra no consumer reads.
      ...composer,
      // Slice 7a — the GENERATION surface spread verbatim: keeps the SAME 15 public field
      // names/shape (pendingDraft, pendingDraftRect, openManualEditor, regenerating,
      // generating, savePendingDraft, regeneratePendingDraft, discardPendingDraft,
      // selectedTextOr, previewClassifiedReply, addReplyAsNote, materializeAnchor, draftNote,
      // undoDraftNote, dismissDraftNote) so consumers are unchanged. The coordinator-only
      // riders (parkDraft/beginGeneration/endGeneration/materializeAnchorRef) also ride along
      // but aren't in the interface — harmless extras no consumer reads.
      ...generation,
      // Slice 5 — the kit surface spread verbatim: keeps the SAME 3 field names/shape
      // (activeKitIds, installedKits, setActiveKit) so consumers are unchanged.
      ...kit,
      // Slice 6 — the OPERATION surface spread verbatim: keeps the SAME 12 field names/shape
      // (operations, operationPrefs, operationsVersion, refreshOperations, selectionActions,
      // anchorBarActions [aliased to selectionActions], sourceActions, runAction,
      // saveActionPrefs, openOperationManager, registerOpenOperationManager, customizeSurface)
      // so consumers are unchanged.
      ...operation,
      // Slice 4b — the DOCUMENTS surface spread verbatim: keeps the SAME 52 public field
      // names/shape (status/error, sources/recentSources/activeSourceId/activeSource/
      // activeViewer/setActiveSourceId/openSourceInNewPane/openPanes/focusedPaneId/focusPane/
      // closePane/sourceForPane/paintAnchorsForPane/renderedHtmlForPane/loadSources/
      // deleteSourceItem/removeRecentSourceId/reloadActiveSource, renderedHtml/anchors/notes/
      // patches/paintAnchors/revealAnchors/activePatches/annotationMode/setAnnotationMode,
      // folderRoots/closeFolderRoot/activeFilePath/importUrl/setImportUrl/openLocalFile/
      // openFileDialog/openFolderDialog/importFromUrl/openLiveUrl, changePatchStatus/
      // canForkActiveSource/forkActiveSource, layersVersion/refreshLayers/sourceLayers/
      // enabledLayerIds/visibleNotes/setLayersEnabled) so consumers are unchanged. The
      // coordinator-only seams (setStatus/setError/refreshAnnotations/importXmindFromPath)
      // also ride along but aren't in the interface — harmless extras no consumer reads.
      ...docs,
      // Slice 1 — layout + theme surfaces spread verbatim: keeps the SAME 6 field
      // names/shape (activeLayoutId, availableLayouts, setActiveLayout, activeThemeId,
      // availableThemes, setActiveTheme) so consumers are unchanged.
      ...layout,
      ...theme,
      // Slice 2 — the plugin surface spread verbatim: keeps the SAME 4 field names/shape
      // (installedPlugins, pluginPrefs, setContributionEnabled, pinViewer) so consumers are
      // unchanged.
      ...plugin,
      // Slice 3 — the concept surface spread verbatim: keeps the SAME 5 CONTEXT field
      // names/shape (conceptsVersion, refreshConcepts, conceptMark, undoConceptMark,
      // dismissConceptMark) so consumers are unchanged. The two coordinator-only setters
      // (bumpConceptsVersion/notifyConceptMarked) also ride along but aren't in the
      // interface — harmless extras no consumer reads.
      ...concept
    }),
    [
      focus,
      // Slice 4b — the 52 documents fields collapse to their single memoized surface; its
      // identity changes on the SAME cadence as its fields → identical re-render behavior.
      docs,
      canOpenLocal,
      chatMessages,
      chatDomain.sessions,
      visionAvailable,
      offlineMock,
      activeFileDir,
      draftQuote,
      hasRegionDraft,
      composerDisabled,
      dispatch,
      regenerateChatReply,
      agentTurn,
      agentAvailable,
      runAgentTurn,
      importXmindFile,
      toggleLayerFilter,
      // Slice 7b — the 18 composer fields collapse to their single memoized surface; its
      // identity changes on the SAME cadence as its fields → identical re-render behavior.
      composer,
      // Slice 7a — the 15 generation fields collapse to their single memoized surface; its
      // identity changes on the SAME cadence as its fields → identical re-render behavior.
      generation,
      // Slice 5 — the 3 kit fields collapse to their single memoized surface; its identity
      // changes only when activeKitIds/setActiveKit change (installedKits is a stable module
      // const) → identical re-render behavior.
      kit,
      // Slice 6 — the 12 operation fields collapse to their single memoized surface; its
      // identity changes on the SAME cadence as selectionActions/sourceActions (activeKitIds/
      // focus.draft/locale/operations/operationPrefs) + the operation-manager atoms →
      // identical re-render behavior.
      operation,
      // Slice 1 — the 6 layout/theme fields collapse to their 2 memoized surfaces; each
      // surface's identity changes on the SAME cadence as its fields → identical re-render.
      layout,
      theme,
      // Slice 2 — the 4 plugin fields collapse to their single memoized surface; its
      // identity changes on the SAME cadence as its fields → identical re-render behavior.
      plugin,
      // Slice 3 — the 5 concept fields collapse to their single memoized surface; its
      // identity changes on the SAME cadence as its fields → identical re-render behavior.
      concept
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
