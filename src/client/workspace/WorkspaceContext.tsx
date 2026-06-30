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
  useState,
  type ReactNode
} from "react";
import {
  entityClient,
  type AnyAnchor,
  type ChatContext,
  type ChatMessage,
  type NoteRecord,
  type OperationPrefs,
  type OperationRecord,
  type OperationVariable,
  type PatchRecord,
  type SourceRecord,
  type StudyLayerRecord
} from "../data/entityClient";
import { useFocus, draftQuoteText, type FocusContextValue } from "../focus/FocusContext";
import { BOOKMARK_CONTENT_TYPE } from "../../core/notes/contentTypes";
import { resolveFormAsync, type AiClassify } from "../../core/notes/resolveForm";
import { classifyContent } from "../../core/notes/classifyContent";
import { createDefaultContent, isTextContentType } from "../notes/noteTypeRegistry";
import { getSourceViewer, type SourceViewer } from "../viewers";
import { getCommand, runCommand, type CommandContext, type GeneratedDraft } from "../commands/registry";
import type { PaintAnchor } from "../surfaces/types";
import {
  persistAnnotationMode,
  readStoredAnnotationMode,
  type HtmlAnnotationMode
} from "../annotations";
import { activeKitIdsForSource, CORE_KIT_ID } from "../../kits/activation";
import { installedKits, kitSurfaceItems } from "../../kits/clientContext";
import { LAYOUT_PRESETS, DEFAULT_LAYOUT_ID } from "./presets";
// Theme V1 — a workspace-wide visual choice, a strict SIBLING of the layout switcher
// (it never reads activeLayoutId). The side-effect import populates the theme registry
// before listThemes() runs at provider mount, mirroring views.tsx's kit import.
import "../theme/builtins";
import { DEFAULT_THEME_ID } from "../theme/builtins";
import { listThemes } from "../theme/registry";
import { setActiveTheme as applyActiveTheme, THEME_STORAGE_KEY } from "../theme/applyTheme";

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

/** The surface keys an action list can be configured for (R6.3). */
export type ActionSurface = "inline" | "anchor" | "source" | "bottom";

/** The surface a Customize deep-link can pre-select: a configurable toolbar surface, or
    "my" (the builder/manager). undefined behaves like "my" (default open). */
export type CustomizeSurface = "inline" | "anchor" | "bottom" | "my" | undefined;

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

function normalizeFolderRoot(root: string): string {
  return root.trim().replace(/[\\/]+$/, "");
}

// Note `content` is `unknown` (structured per contentType). For display we want a
// string: string content passes through; structured content is shown as JSON.
export function noteText(content: unknown): string {
  return typeof content === "string" ? content : JSON.stringify(content, null, 2);
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
  loadSources(): Promise<void>;
  deleteSourceItem(sourceId: string, title: string): Promise<void>;

  // —— reader data ——
  renderedHtml: string;
  anchors: AnyAnchor[];
  notes: NoteRecord[];
  patches: PatchRecord[];
  /** ONE normalized paint list for the active source (every reader filters it). */
  paintAnchors: PaintAnchor[];
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
  /** Persist the (possibly edited) draft content as a note, then clear the preview. */
  savePendingDraft(content: unknown): void;
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
  /**
   * Import a local .xmind file → a `markmap` note (Phase 4 item 3). Opens the native
   * file dialog, has the server unzip+parse the .xmind into a markmap outline, and
   * parks it in the generation preview (preview-then-save). Desktop-only (needs the
   * file dialog); renders via the existing markmap plugin — no new renderer.
   */
  importXmindFile(): Promise<void>;
  changePatchStatus(patch: PatchRecord, nextStatus: "applied" | "reverted" | "rejected"): Promise<void>;

  // —— concepts / relations ——
  // A monotonically-increasing token bumped whenever a concept/relation/link command
  // mutates entity data. Concept views watch it to re-fetch (they own their own list
  // + detail state via the entity client, so the context stays the single seam
  // without ballooning with concept-specific data).
  conceptsVersion: number;
  /** Bump `conceptsVersion` after a direct entity mutation (e.g. delete relation). */
  refreshConcepts(): void;

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
  /** Anchor-scope actions ordered for the INLINE selection toolbar surface. */
  selectionActions: ToolbarAction[];
  /** The SAME anchor-scope pool ordered for the ANCHOR BAR surface (configured
      independently of the inline toolbar via its own per-surface prefs). */
  anchorBarActions: ToolbarAction[];
  /** Source-scope actions (built-in source items + source ops), ordered for "source". */
  sourceActions: ToolbarAction[];
  /** Run a merged action: a built-in command, or operation.run for a custom op. */
  runAction(action: ToolbarAction): void;
  /** Persist a full next-prefs object (the Customize panel's single write seam). */
  saveActionPrefs(next: OperationPrefs): Promise<void>;
  /** Open the operation manager / Customize panel (fires the shell's registered handler).
      An optional `surface` deep-links to that surface's Customize tab (inline/anchor/bottom);
      "my" or omitted opens the My Actions builder/manager. */
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
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const focus = useFocus();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [activeSourceId, setActiveSourceId] = useState("");
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
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [showTerminal, setShowTerminal] = useState(false);
  const [patchHtml, setPatchHtml] = useState("");
  const [importUrl, setImportUrl] = useState("");
  const [folderRoots, setFolderRoots] = useState<string[]>([]);
  const [recentSourceIds, setRecentSourceIds] = useState<string[]>(readStoredRecentSourceIds);
  const [conceptsVersion, setConceptsVersion] = useState(0);
  const [activeLayoutId, setActiveLayoutId] = useState<string>(loadActiveLayout);
  const [activeThemeId, setActiveThemeId] = useState<string>(loadActiveTheme);
  // Note-presentation mode for the DOM HTML reader. Seeded from localStorage so the
  // choice survives reloads; the setter mirrors it back to storage.
  const [annotationMode, setAnnotationModeState] = useState<HtmlAnnotationMode>(readStoredAnnotationMode);
  const [layersVersion, setLayersVersion] = useState(0);
  // The AI draft awaiting preview/edit/save (null = nothing pending), plus a flag for
  // an in-flight regenerate so the preview can show/disable while it re-runs.
  const [pendingDraft, setPendingDraft] = useState<GeneratedDraft | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  // Whether an AI structured-generation request is in flight (see `generating` in the
  // context type). Set true around a generation command/flow, cleared on done/error.
  const [generating, setGenerating] = useState(false);
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

  // Native file/folder dialogs come from the Electron preload; absent in a browser.
  const canOpenLocal = typeof window !== "undefined" && !!window.studyVault?.openFile;
  const activeFilePath =
    (sources.find((source) => source.id === activeSourceId)?.metadata?.originalPath as string | undefined) ?? undefined;

  const activeSource = sources.find((source) => source.id === activeSourceId) ?? null;
  const recentSources = useMemo(() => {
    const byId = new Map(sources.map((source) => [source.id, source]));
    const ordered = recentSourceIds.map((id) => byId.get(id)).filter((source): source is SourceRecord => !!source);
    const seen = new Set(ordered.map((source) => source.id));
    return [...ordered, ...sources.filter((source) => !seen.has(source.id))];
  }, [sources, recentSourceIds]);
  const activeViewer = getSourceViewer(activeSource?.sourceType);
  const selectedAnchorId = focus.anchor?.id ?? "";
  const activeFileDir = parentDir((activeSource?.metadata?.originalPath as string | undefined) ?? "");

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

  // Note text per anchor id — a note can hang off several anchors, and several
  // notes can share an anchor (their text is merged for the one hover card). Built from
  // the FILTERED notes so a hidden layer's note text doesn't paint. Bookmarks are
  // EXCLUDED: their content is a structured { label } that would otherwise paint as raw
  // JSON on the passage; they surface as chips in the Bookmarks pane instead (the anchor
  // itself still paints its inline marker — every anchor is in `anchors`/paintAnchors).
  const noteTextByAnchorId = useMemo(() => {
    const map = new Map<string, string>();
    for (const note of visibleNotes) {
      if ((note.contentType ?? "markdown") === BOOKMARK_CONTENT_TYPE) continue;
      const text = noteText(note.content);
      for (const anchorId of note.anchorIds) {
        const existing = map.get(anchorId);
        map.set(anchorId, (existing ? `${existing}\n\n` : "") + text);
      }
    }
    return map;
  }, [visibleNotes]);

  // Anchors that exist ONLY to carry a bookmark (≥1 bookmark note and NO other note)
  // must NOT paint — a bookmark is a marker/label surfaced in the Bookmarks pane, not a
  // highlight on the passage. An anchor shared by a bookmark AND a real note still paints
  // (for the real note). Classified off the full `notes` list so visibility filtering
  // doesn't accidentally reclassify a bookmark anchor.
  const bookmarkOnlyAnchorIds = useMemo(() => {
    const bookmarked = new Set<string>();
    const hasRealNote = new Set<string>();
    for (const note of notes) {
      const isBookmark = (note.contentType ?? "markdown") === BOOKMARK_CONTENT_TYPE;
      for (const anchorId of note.anchorIds) {
        (isBookmark ? bookmarked : hasRealNote).add(anchorId);
      }
    }
    const out = new Set<string>();
    for (const id of bookmarked) if (!hasRealNote.has(id)) out.add(id);
    return out;
  }, [notes]);

  // ONE normalized paint list for the active source: every anchor it has (except
  // bookmark-only ones), mapped to the uniform PaintAnchor shape with its merged note
  // text. The host hands this SAME list to whichever reader matches the source; each
  // reader filters it to the anchorKinds it understands and paints those.
  const paintAnchors = useMemo<PaintAnchor[]>(
    () =>
      anchors
        .filter((anchor) => !bookmarkOnlyAnchorIds.has(anchor.id))
        .map((anchor) => ({
        id: anchor.id,
        anchorKind: anchor.anchorKind,
        quote: "quote" in anchor ? anchor.quote : undefined,
        contextBefore: "contextBefore" in anchor ? anchor.contextBefore : undefined,
        contextAfter: "contextAfter" in anchor ? anchor.contextAfter : undefined,
        studyId: "studyId" in anchor ? anchor.studyId : undefined,
        page: "page" in anchor ? anchor.page : undefined,
        rect: "rect" in anchor ? anchor.rect : undefined,
        note: noteTextByAnchorId.get(anchor.id) ?? ""
      })),
    [anchors, noteTextByAnchorId, bookmarkOnlyAnchorIds]
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
    setFolderRoots((current) =>
      current.some((item) => normalizeFolderRoot(item).toLocaleLowerCase() === normalizedKey)
        ? current
        : [...current, normalized]
    );
  }, []);

  const closeFolderRoot = useCallback((root: string) => {
    const normalizedKey = normalizeFolderRoot(root).toLocaleLowerCase();
    setFolderRoots((current) =>
      current.filter((item) => normalizeFolderRoot(item).toLocaleLowerCase() !== normalizedKey)
    );
  }, []);

  const loadSources = useCallback(async () => {
    setStatus("loading");
    setError("");
    try {
      const response = await entityClient.sources();
      setSources(response.sources);
      setActiveSourceId((current) => current || response.sources[0]?.id || "");
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sources");
      setStatus("error");
    }
  }, []);

  const loadSourceWorkspace = useCallback(
    async (sourceId: string) => {
      setStatus("loading");
      setError("");
      try {
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
        setRenderedHtml(rendered?.content ?? "");
        setAnchors(anchorsResponse.anchors);
        setNotes(notesResponse.notes);
        setPatches(patchesResponse.patches);
        setSourceLayers(layersResponse.layers);
        focus.clear();
        setPatchHtml("");
        setChatMessages([]);
        setChatInput("");
        setStatus("idle");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load source");
        setStatus("error");
      }
    },
    [sources, focus]
  );

  // Re-fetch anchors/notes/patches after a mutation that may have created a new
  // anchor (note/patch save), so the painted highlights and lists stay in sync —
  // without resetting the chat the way a full workspace reload would.
  const refreshAnnotations = useCallback(async () => {
    if (!activeSourceId) return;
    try {
      const [anchorsResponse, notesResponse, patchesResponse, layersResponse] = await Promise.all([
        entityClient.anchors(activeSourceId),
        entityClient.notes(activeSourceId),
        entityClient.patches(activeSourceId),
        entityClient.layers(activeSourceId)
      ]);
      setAnchors(anchorsResponse.anchors);
      setNotes(notesResponse.notes);
      setPatches(patchesResponse.patches);
      setSourceLayers(layersResponse.layers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh");
    }
  }, [activeSourceId]);

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

  const openFileDialog = useCallback(async () => {
    const filePath = await window.studyVault?.openFile?.();
    if (filePath) await openLocalFile(filePath);
  }, [openLocalFile]);

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
        if (activeSourceId === sourceId) {
          setActiveSourceId("");
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

  useEffect(() => {
    rememberSourceId(activeSourceId);
  }, [activeSourceId, rememberSourceId]);

  useEffect(() => {
    if (activeSourceId) {
      void loadSourceWorkspace(activeSourceId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mirror App: load on id change only
  }, [activeSourceId]);

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
      actions: {
        onNoteCreated: () => void refreshAnnotations(),
        // A note was deleted: re-fetch notes + repaint (painting is derived from
        // notes, so a removed note stops painting automatically).
        onNoteDeleted: () => void refreshAnnotations(),
        // Destructive-action gate (note.delete). Desktop/web both have window.confirm;
        // SSR/tests fall through to proceed (tests inject their own confirm).
        confirm: (message) => (typeof window !== "undefined" ? window.confirm(message) : true),
        // A kit AI action generated content: divert it to the preview stage instead
        // of auto-saving. The host renders it and only persists on Save.
        onGenerated: (draft) => setPendingDraft(draft),
        onPatchCreated: () => void refreshAnnotations(),
        onChatHistory: (history) => setChatMessages(history),
        onAssistantMessage: (message) => setChatMessages((items) => [...items, message]),
        // Progressive streaming: append the delta to the trailing assistant message,
        // or start a new one if the last message is the user's prompt. The accumulated
        // text equals the final reply, so no separate finalize step is needed.
        onAssistantChunk: (delta) =>
          setChatMessages((items) => {
            const last = items[items.length - 1];
            if (last && last.role === "assistant") {
              return [...items.slice(0, -1), { ...last, content: last.content + delta }];
            }
            return [...items, { role: "assistant", content: delta }];
          }),
        // A new concept / changed link / new-or-deleted relation: bump the token so
        // concept views re-fetch, and refresh the source's notes so a freshly linked
        // note's conceptIds show up in the study panel too.
        onConceptChanged: () => {
          setConceptsVersion((value) => value + 1);
          void refreshAnnotations();
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
    [focus, activeSourceId, chatMessages, buildChatContext, refreshAnnotations]
  );

  const dispatch = useCallback(
    async (commandId: string, payload: CommandContext["payload"]) => {
      // A generation command flips the shared `generating` flag (spinner + disabled
      // trigger) on top of the generic saving state; cleared in finally on done/error.
      const isGen = isGenerationCommand(commandId);
      setStatus("saving");
      setError("");
      if (isGen) setGenerating(true);
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
    (content: unknown) => {
      const draft = pendingDraft;
      if (!draft) return;
      // Clear the draft BEFORE the async dispatch so a rapid double-click on Save
      // sees a null draft and early-returns — otherwise two `anchor.add-note`
      // dispatches fire while the draft is still set, creating a duplicate note.
      setPendingDraft(null);
      void dispatch("anchor.add-note", {
        content,
        contentType: draft.contentType,
        anchorIds: draft.anchorId ? [draft.anchorId] : []
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
      const { content } = await entityClient.generateStructured({
        promptId: draft.promptId,
        contentType: draft.contentType,
        input: draft.input
      });
      setPendingDraft({ ...draft, content });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to regenerate");
    } finally {
      setRegenerating(false);
    }
  }, [pendingDraft]);

  // Drop the pending draft without persisting anything.
  const discardPendingDraft = useCallback(() => setPendingDraft(null), []);

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
        setPendingDraft({
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
    [focus, activeSourceId, aiClassify]
  );

  // §10 chat card "Add as note": classify the reply into its registered form (the SAME
  // pure heuristic the preview path uses) and create the note in ONE step via the normal
  // add-note command — no preview gate. Respects the user's TEXT SELECTION within the
  // reply (selectedTextOr → keep just the useful part, e.g. a fenced/bare diagram), like
  // the old "Save selection as note" flow. anchorIds omitted, so the command materializes
  // the focused passage if there is one (attaching the note to it), else saves it
  // unanchored on the active source. onNoteCreated repaints + the note-list refreshes.
  const addReplyAsNote = useCallback(
    async (rawContent: string) => {
      const text = selectedTextOr(rawContent ?? "").trim();
      if (!text) return;
      const form = classifyContent(text);
      await dispatch("anchor.add-note", { content: form.content, contentType: form.contentType });
    },
    [dispatch, selectedTextOr]
  );

  // §10 chat card "Regenerate": re-ask the most recent user question, appending a fresh
  // assistant reply to the thread (the streaming ask path handles the rest). A no-op if
  // there is no prior user prompt.
  const regenerateChatReply = useCallback(() => {
    const lastUser = [...chatMessages].reverse().find((message) => message.role === "user");
    if (!lastUser) return;
    void dispatch("anchor.ask-ai", { text: lastUser.content });
  }, [chatMessages, dispatch]);

  // .xmind import (adaptive-note-forms Phase 4 item 3). Open a native file dialog,
  // ask the server to unzip+parse the .xmind into a markmap OUTLINE, and park the
  // result in the SAME preview/save loop every other generated note uses — so the
  // user previews the interactive mind-map (rendered via the existing `markmap`
  // plugin) before saving. The contentType comes from the SERVER response (the
  // already-registered `markmap`), never a host literal — no new renderer, no bypass.
  const importXmindFile = useCallback(async () => {
    const filePath = await window.studyVault?.openFile?.();
    if (!filePath) return;
    setStatus("saving");
    setError("");
    try {
      const anchor = await focus.materializeAnchor();
      const result = await entityClient.importXmind(filePath);
      setPendingDraft({
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
  }, [focus, activeSourceId]);

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

  const refreshConcepts = useCallback(() => setConceptsVersion((value) => value + 1), []);

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

  // Merge a slot's built-in kit actions with the custom ops of the matching scope, then
  // order/filter by prefs. Anchor scope ↔ the selection toolbar; source scope ↔ the
  // source-actions toolbar. Built-in kit items are gated by the active source's kits;
  // custom ops are workspace-wide.
  const selectionActions = useMemo<ToolbarAction[]>(() => {
    const builtin: ToolbarAction[] = kitSurfaceItems("selection-toolbar", activeKitIds).map((item) => ({
      id: item.commandId,
      title: item.title,
      icon: operationPrefs.icons?.[item.commandId] ?? item.icon,
      group: item.group,
      description: item.description,
      kind: "builtin",
      scope: "anchor"
    }));
    const custom: ToolbarAction[] = operations
      .filter((op) => op.scope === "anchor")
      .map((op) => ({
        id: op.id,
        title: op.name,
        icon: operationPrefs.icons?.[op.id],
        group: "Custom Actions",
        description: op.description,
        kind: "operation",
        scope: "anchor",
        outputType: op.outputContentType,
        variables: op.declaredVariables
      }));
    const bookmark: ToolbarAction = { ...BOOKMARK_ACTION, icon: operationPrefs.icons?.[BOOKMARK_ACTION.id] ?? BOOKMARK_ACTION.icon };
    // The core Bookmark action leads, then kit selection items, then custom ops. Ordered
    // for the INLINE selection toolbar surface (its own per-surface prefs, else global).
    return orderActionsForSurface([bookmark, ...builtin, ...custom], operationPrefs, "inline");
  }, [activeKitIds, operations, operationPrefs]);

  // The SAME anchor-scope action pool as `selectionActions`, but ordered for the ANCHOR
  // BAR surface — so the Anchor Action Bar configures show/hide + order INDEPENDENTLY of
  // the inline selection toolbar. Built from the same builtin+custom merge so the two
  // surfaces always offer the same actions; only the per-surface arrangement differs.
  const anchorBarActions = useMemo<ToolbarAction[]>(() => {
    const builtin: ToolbarAction[] = kitSurfaceItems("selection-toolbar", activeKitIds).map((item) => ({
      id: item.commandId,
      title: item.title,
      icon: operationPrefs.icons?.[item.commandId] ?? item.icon,
      group: item.group,
      description: item.description,
      kind: "builtin",
      scope: "anchor"
    }));
    const custom: ToolbarAction[] = operations
      .filter((op) => op.scope === "anchor")
      .map((op) => ({
        id: op.id,
        title: op.name,
        icon: operationPrefs.icons?.[op.id],
        group: "Custom Actions",
        description: op.description,
        kind: "operation",
        scope: "anchor",
        outputType: op.outputContentType,
        variables: op.declaredVariables
      }));
    const bookmark: ToolbarAction = { ...BOOKMARK_ACTION, icon: operationPrefs.icons?.[BOOKMARK_ACTION.id] ?? BOOKMARK_ACTION.icon };
    return orderActionsForSurface([bookmark, ...builtin, ...custom], operationPrefs, "anchor");
  }, [activeKitIds, operations, operationPrefs]);

  const sourceActions = useMemo<ToolbarAction[]>(() => {
    const builtin: ToolbarAction[] = kitSurfaceItems("source-actions", activeKitIds).map((item) => ({
      id: item.commandId,
      title: item.title,
      icon: operationPrefs.icons?.[item.commandId] ?? item.icon,
      group: item.group,
      description: item.description,
      kind: "builtin",
      scope: "source"
    }));
    const custom: ToolbarAction[] = operations
      .filter((op) => op.scope === "source")
      .map((op) => ({
        id: op.id,
        title: op.name,
        icon: operationPrefs.icons?.[op.id],
        group: "Custom Actions",
        description: op.description,
        kind: "operation",
        scope: "source",
        outputType: op.outputContentType,
        variables: op.declaredVariables
      }));
    return orderActionsForSurface([...builtin, ...custom], operationPrefs, "source");
  }, [activeKitIds, operations, operationPrefs]);

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
      } else {
        void dispatch(action.id, {});
      }
    },
    [dispatch]
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
      loadSources,
      deleteSourceItem,
      renderedHtml,
      anchors,
      notes,
      patches,
      paintAnchors,
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
      regenerating,
      generating,
      savePendingDraft,
      regeneratePendingDraft,
      discardPendingDraft,
      selectedTextOr,
      previewClassifiedReply,
      addReplyAsNote,
      regenerateChatReply,
      importXmindFile,
      changePatchStatus,
      conceptsVersion,
      refreshConcepts,
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
      setActiveTheme
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
      loadSources,
      deleteSourceItem,
      renderedHtml,
      anchors,
      notes,
      patches,
      paintAnchors,
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
      regenerating,
      generating,
      savePendingDraft,
      regeneratePendingDraft,
      discardPendingDraft,
      selectedTextOr,
      previewClassifiedReply,
      addReplyAsNote,
      regenerateChatReply,
      importXmindFile,
      changePatchStatus,
      conceptsVersion,
      refreshConcepts,
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
      setActiveTheme
    ]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used within a WorkspaceProvider");
  return value;
}
