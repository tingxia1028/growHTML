// Built-in workspace views — the three panels extracted from App's old `Workspace`
// component, each registered as a ViewRegistry plugin. Every view renders the SAME
// DOM it did when it was inline JSX (same classes/structure), so the e2e selectors
// are untouched; the only change is WHERE the JSX lives (a registered plugin that
// reads `useWorkspace()`) and that the source reader's per-surface branching now goes
// through `readerForSource` instead of an inline if/else.
//
// Views collaborate only through the WorkspaceContext (Focus / Command / Entity-
// Client-backed) — never with each other. Importing the plugins module runs the
// `registerView` calls below.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Camera,
  ChevronDown,
  ChevronRight,
  Copy,
  CornerDownLeft,
  FileText,
  ImagePlus,
  ListRestart,
  Loader2,
  Plus,
  RefreshCcw,
  RotateCcw,
  Search,
  TerminalSquare,
  X
} from "lucide-react";
import { TerminalPanel } from "../TerminalPanel";
import { registerView, type WorkspaceContext } from "./viewRegistry";
import { PanelMenu } from "./PanelMenu";
import { resolveText, t } from "../i18n";
import { libraryMessages } from "./libraryMessages";
import {
  listLibraryAddActions,
  listLibrarySections,
  type LibraryAddGroup,
  type LibrarySectionContext
} from "./librarySections";
// Side-effect import: seeds the core Library sections (最近/文档/文件夹) + the built-in
// `+` actions into the Library registries (the same idiom as builtinNoteTypes below).
import "./libraryBuiltins";
import "./library.css";
import { readerForSource } from "./readerForSource";
import { BookmarkIndex } from "./BookmarkIndex";
// N6/§D12: the Anchor Focus board — a read-only surface over the active source's
// anchors+notes (document-order rows / stage-layer columns), registered as a view and
// mounted in the shell overlay via AnchorBoardMount. Board logic lives in the new file.
import { AnchorFocusBoard } from "./AnchorFocusBoard";
import { setAnchorBoardOpen } from "./anchorFocusBoardStore";
// N5/§10: per-source hide-all (D11) + notes/anchors export (D10) reader-toolbar
// controls, each a small self-contained component (keeps this hot file's diff tight).
import { HideAllNotesToggle } from "./HideAllNotesToggle";
import { ExportNotesButton } from "./ExportNotesButton";
// Side-effect import: registers the 12 built-in client NoteType plugins so the note
// list + composer can render/edit every content type through the registry.
import "../notes/builtinNoteTypes";
// Side-effect import: registers the built-in Table viewer (an exclusive cross-type viewer)
// into the viewer registry + the plugin read model. (The shared ArtifactCard also imports
// it so the viewer is registered wherever a card renders; both are idempotent.)
import "../notes/tableViewer";
import { ChatMessageBody } from "./ChatMessageBody";
// A4b: the agent-loop transcript surface + the capability-gated 用工具 button icon.
import { AgentTranscript } from "./AgentTranscript";
import { Wrench } from "lucide-react";
// SC-1 slash composer (`/类型`): parse the chat input, drop the SC-0 palette above
// it, and route a pick — bare `/type` opens the D5 floating editor in manual mode;
// `/type + instruction` dispatches the form-router generation whose draft lands in
// the same floating editor. The engine/palette are the shipped SC-0 modules.
import { parseSlashInput, resolveSlashEntries } from "../slash/engine";
import { slashEntries as buildSlashEntries } from "../slash/adapters";
import { dispatchSlashEntry } from "../slash/dispatchSlashEntry";
import { SlashPalette, slashPaletteKeyDown } from "../slash/SlashPalette";
import type { SlashEntry } from "../slash/engine";
// W1 (ai-workspace §2.1): the compact session switcher in the chat panel title row —
// 新对话 + history (select to resume, delete with confirm). State lives in the chat
// session domain (src/client/chat); StudyView only passes the bundled api through.
import { ChatSessionSwitcher } from "../chat/ChatSessionSwitcher";
import { ChatAttachments } from "../chat/ChatAttachments";
// 语音输入 (SPEECH-2): the mic on the chat composer — which is ALSO the slash
// composer's main text field ("Type / for commands"), so one mount covers both.
// The confirmed transcript appends to the SAME chatInput state the keyboard edits.
import { VoiceInputButton } from "../speech/VoiceInputButton";
// Side-effect import: installs the Product Kits (Textbook Learning Kit, …), which
// register their note types + domain language into the same registries.
import "../../kits/clientKits";

// —— library → the `.library-panel` aside, rebuilt per docs/design/library-redesign.md
// (LIB-2, user-blessed layout): header = 资料库 title · a search input that filters
// section items (the SEARCH-1 seam) · ONE unified `+` menu (registry-backed 导入/新建
// groups); body = the registered LibrarySections (core seeds 最近/文档/文件夹; kits may
// add views over the same sources). Every section is collapsible (persisted), shows a
// count badge, and renders one guidance line when empty. Refresh lives as a subtle icon
// next to search. All strings go through the I18N seed — no hardcoded literals.

const LIBRARY_COLLAPSED_KEY = "sv-library-collapsed";

function readCollapsedSections(): Record<string, boolean> {
  try {
    const raw = globalThis.localStorage?.getItem(LIBRARY_COLLAPSED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

// The ONE `+`: renders the LibraryAddAction registry as its two groups. A group header
// renders only when the group has actions (新建 disappears if nothing registered one).
// Custom-bodied actions (网页's inline URL input) render their own node; plain actions
// are one-shot `.panel-menu-item` buttons (PanelMenu closes after them). Desktop-only
// items grey out on web with the registered hint, plus the existing pane-level hint line.
function LibraryAddMenu({ ctx }: { ctx: WorkspaceContext }) {
  const actions = listLibraryAddActions();
  const groups: Array<{ id: LibraryAddGroup; title: string }> = [
    { id: "import", title: t(libraryMessages.groupImport) },
    { id: "create", title: t(libraryMessages.groupCreate) }
  ];
  const visibleGroups = groups
    .map((group) => ({ ...group, items: actions.filter((action) => action.group === group.id) }))
    .filter((group) => group.items.length > 0);

  return (
    <PanelMenu label={t(libraryMessages.add)} icon={<Plus size={16} />}>
      {visibleGroups.map((group, index) => (
        <div key={group.id} className="library-add-group" data-add-group={group.id}>
          {index > 0 ? <div className="panel-menu-sep" /> : null}
          <div className="panel-menu-label">{group.title}</div>
          {group.items.map((action) => {
            if (action.render) {
              return (
                <div key={action.id} className="library-add-custom" data-add-action={action.id}>
                  {action.render(ctx)}
                </div>
              );
            }
            const disabled = action.disabled?.(ctx) ?? false;
            return (
              <button
                key={action.id}
                className="panel-menu-item"
                type="button"
                data-add-action={action.id}
                disabled={disabled}
                title={disabled && action.disabledHint ? resolveText(action.disabledHint) : resolveText(action.title)}
                onClick={() => void action.run(ctx)}
              >
                {action.icon}
                {resolveText(action.title)}
              </button>
            );
          })}
        </div>
      ))}
      {!ctx.canOpenLocal ? <div className="panel-menu-hint">{t(libraryMessages.desktopOnlyHint)}</div> : null}
    </PanelMenu>
  );
}

function LibraryView({ ctx }: { ctx: WorkspaceContext }) {
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [dismissedSourceIds, setDismissedSourceIds] = useState<string[]>([]);
  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>(readCollapsedSections);

  const toggleSection = (id: string) => {
    setCollapsedMap((previous) => {
      const next = { ...previous, [id]: !previous[id] };
      try {
        globalThis.localStorage?.setItem(LIBRARY_COLLAPSED_KEY, JSON.stringify(next));
      } catch {
        // Persistence is best-effort; the in-memory toggle still applies.
      }
      return next;
    });
  };

  const sectionCtx: LibrarySectionContext = {
    workspace: ctx,
    query: query.trim().toLowerCase(),
    dismissedSourceIds,
    dismissSourceId: (sourceId) => {
      setDismissedSourceIds((current) => (current.includes(sourceId) ? current : [...current, sourceId]));
    }
  };

  return (
    <aside className="library-panel">
      <div className="library-head">
        <h1 className="library-title">{t(libraryMessages.title)}</h1>
        {/* SEARCH-1 shipped: Cmd/Ctrl+K (GlobalSearch, WorkspaceShell chrome) is the
            GLOBAL search entry — this input stays the Library's LOCAL section filter. */}
        <div className="library-actions">
          <button
            className={`library-search-toggle${searchOpen ? " active" : ""}`}
            type="button"
            title={t(libraryMessages.searchPlaceholder)}
            aria-label={t(libraryMessages.searchPlaceholder)}
            aria-pressed={searchOpen}
            onClick={() => {
              if (searchOpen) setQuery("");
              setSearchOpen((open) => !open);
            }}
          >
            <Search size={14} />
          </button>
          <button
            className="library-icon-btn"
            type="button"
            title={t(libraryMessages.refresh)}
            aria-label={t(libraryMessages.refresh)}
            onClick={() => void ctx.loadSources()}
          >
            <RefreshCcw size={14} />
          </button>
          <LibraryAddMenu ctx={ctx} />
        </div>
      </div>

      {searchOpen ? (
        <div className="library-search-row">
          <Search size={14} aria-hidden="true" />
          <input
            className="library-search"
            type="search"
            value={query}
            placeholder={t(libraryMessages.searchPlaceholder)}
            aria-label={t(libraryMessages.searchPlaceholder)}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      ) : null}

      <div className="library-body library-sections">
        {listLibrarySections().map((section) => {
          const count = section.count(sectionCtx);
          const isCollapsed = !!collapsedMap[section.id];
          return (
            <section
              key={section.id}
              className={`library-section${isCollapsed ? " collapsed" : ""}`}
              data-section-id={section.id}
              aria-label={resolveText(section.title)}
            >
              <div className="library-section-head">
                <button
                  className="library-section-toggle"
                  type="button"
                  aria-expanded={!isCollapsed}
                  title={t(isCollapsed ? libraryMessages.expandSection : libraryMessages.collapseSection)}
                  onClick={() => toggleSection(section.id)}
                >
                  {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  <span>{resolveText(section.title)}</span>
                  <span className="library-section-count">{count}</span>
                </button>
              </div>
              {!isCollapsed
                ? count === 0
                  ? (
                      <div className="empty-state library-empty">
                        {sectionCtx.query
                          ? t(libraryMessages.noMatches)
                          : section.emptyText
                            ? resolveText(section.emptyText)
                            : t(libraryMessages.noMatches)}
                      </div>
                    )
                  : section.render(sectionCtx)
                : null}
            </section>
          );
        })}
      </div>
    </aside>
  );
}

// —— source.viewer → the `.reader-panel` main: header + the active source's reader.
// The per-surface reader if/else lives in `readerForSource`, not here.
//
// F1 (P-A1): `tabStrip` (default: the built-in single tab) lets the multi-pane host
// (SourceTabs) supply its OWN per-pane strip, rendered in the SAME `.reader-header >
// .reader-tabs` slot so the DOM structure is unchanged. When a preset docks `source.viewer`
// directly (threePane / student), it renders the built-in single `.reader-tab` chrome
// (byte-identical to before F1).
function SourceViewerView({
  ctx,
  tabStrip,
  pane
}: {
  ctx: WorkspaceContext;
  /** Multi-pane host override for the `.reader-tabs` strip; omit for the single tab. */
  tabStrip?: ReactNode;
  /** F1 (P-A2): bind this body to a SPECIFIC pane's source (its node.params.sourceId) —
      it computes THAT source's paint/reveal/renderedHtml + focuses the pane on select.
      Omit to bind to the focused pane (the shim globals — byte-identical to pre-F1). */
  pane?: { paneId: string; sourceId: string };
}) {
  const {
    activeSource,
    anchors,
    status,
    error,
    paintAnchors,
    revealAnchors,
    focus,
    renderedHtml,
    annotationMode,
    activeKitIds,
    installedKits,
    setActiveKit,
    setActiveSourceId,
    canForkActiveSource,
    forkActiveSource,
    sourceForPane,
    paintAnchorsForPane,
    renderedHtmlForPane,
    focusPane
  } = ctx;

  // P-A2 per-pane binding: when `pane` is given, resolve THAT source's data; otherwise the
  // focused-pane globals (unchanged single-pane path). A shared cross-source note paints in
  // each pane because paintAnchorsForPane runs the same builder over each source's notes.
  const paneSource = pane ? sourceForPane(pane.paneId) : activeSource;
  const panePaint = pane ? paintAnchorsForPane(pane.sourceId) : { paintAnchors, revealAnchors };
  const paneRenderedHtml = pane ? renderedHtmlForPane(pane.sourceId) : renderedHtml;
  // Selection / marker clicks in a pane claim focus FIRST (focus-follows-pane), then the
  // single global focus pipeline runs. For the focused-pane path (no `pane`) this is a
  // no-op. Cross-pane reveal into a non-focused pane's DOM stays deferred (delta 5).
  const bodyPaintAnchors = panePaint.paintAnchors;
  const bodyRevealAnchors = panePaint.revealAnchors;
  const onBodySelect = (draft: Parameters<typeof focus.setDraft>[0]) => {
    if (pane) focusPane(pane.paneId);
    focus.setDraft(draft);
  };
  const onBodyMarkerAction = (anchorId: string) => {
    if (pane) focusPane(pane.paneId);
    // Resolve against the pane's own reveal list so a background pane's marker click finds
    // its anchor (the focused pane still resolves against ctx.anchors as before).
    const source = pane ? bodyRevealAnchors : anchors;
    const hit = source.find((item) => item.id === anchorId);
    if (hit) {
      // ctx.anchors carries full AnchorRecords (focus.setAnchor needs one); the pane's
      // reveal list carries PaintAnchors, so re-resolve against ctx.anchors when possible.
      const full = anchors.find((item) => item.id === anchorId);
      if (full) focus.setAnchor(full);
    }
  };

  // The built-in single-document tab (file icon + title + close) — the pre-F1 chrome.
  const singleTabStrip = (
    <div className="reader-tabs" role="tablist">
      {activeSource ? (
        <div className="reader-tab active" role="tab" aria-selected="true">
          <FileText size={14} className="reader-tab-icon" />
          <span className="reader-tab-title" title={activeSource.title}>{activeSource.title}</span>
          <button
            className="reader-tab-close"
            type="button"
            aria-label="Close document"
            title="Close document"
            onClick={() => setActiveSourceId("")}
          >
            <X size={13} />
          </button>
        </div>
      ) : (
        <div className="reader-tab reader-tab-empty">
          <span className="reader-tab-title">Open or import a source</span>
        </div>
      )}
    </div>
  );

  return (
    <main className="reader-panel">
      <header className="reader-header">
        {/* Tab strip — the built-in single tab, or the multi-pane host's per-pane strip. */}
        {tabStrip ?? singleTabStrip}

        {/* Toolbar — ghost icon affordances + the ⋯ overflow holding the kit selector
            and status. Page/zoom controls live in the per-reader body toolbar (PdfReader),
            left as-is this pass. */}
        <div className="reader-toolbar">
          {paneSource ? <BookmarkIndex /> : null}
          {/* D11 hide-all + D10 export (§10) — per-source reader controls (this pane's source). */}
          {paneSource ? <HideAllNotesToggle sourceId={paneSource.id} /> : null}
          {paneSource ? <ExportNotesButton ctx={ctx} /> : null}
          <PanelMenu label="Reader actions">
            {paneSource ? (
              <div className="panel-menu-field">
                <span className="panel-menu-label">Product Kit</span>
                <select
                  className="kit-select"
                  aria-label="Product Kit"
                  title="Apply a Product Kit to this document (gates create actions; Core = none)"
                  value={activeKitIds[0] ?? "core"}
                  onChange={(event) => void setActiveKit(event.target.value)}
                >
                  <option value="core">Core</option>
                  {installedKits.map((kit) => (
                    <option key={kit.id} value={kit.id}>
                      {kit.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {/* SRC-3: imported html/markdown are read-only in place; fork to an
                editable authored copy (notes/anchors stay on the original). */}
            {canForkActiveSource ? (
              <button
                type="button"
                className="panel-menu-item"
                title="复制为可编辑副本(原文档的批注保留在原件上)"
                onClick={() => void forkActiveSource()}
              >
                <Copy size={14} />
                复制为可编辑副本
              </button>
            ) : null}
            <div className="panel-menu-sep" />
            <div className="panel-menu-row">
              <span className="panel-menu-label">Status</span>
              <span className={`status-pill status-${status}`}>{status}</span>
            </div>
          </PanelMenu>
        </div>
      </header>

      {error ? <div className="error-box">{error}</div> : null}

      {/* Every reader takes the SAME annotation contract: anchors={paintAnchors}
          (it filters to the kinds it paints) + onSelect={focus.setDraft} (it emits
          a normalized AnchorDraft). The only per-reader prop is its source locator.
          Adding a viewer = mapping its surface in readerForSource; no capture/paint
          logic lives in this host. */}
      {readerForSource({
        source: paneSource,
        anchors: bodyPaintAnchors,
        revealAnchors: bodyRevealAnchors,
        onSelect: onBodySelect,
        onMarkerAction: onBodyMarkerAction,
        activeAnchorId: focus.anchor?.id,
        revealSeq: focus.revealSeq,
        renderedHtml: paneRenderedHtml,
        annotationMode
      })}
    </main>
  );
}

// NOTE: the former in-list `NoteContentView` was DEAD CODE (defined, never rendered). Its
// two responsibilities now live on the REAL render path: the shared PreviewCard
// (ArtifactCard) resolves the exclusive viewer for the card body (resolveViewer →
// getNoteType().render fallback), and the "Open with…" escape hatch lives in the shared
// CenterView (FocusOverlay). It was removed here to retire the dead path without changing
// any surface.

// —— study → the `.study-panel` aside (chat-box + terminal-box). Kept as ONE view:
// the e2e depend on the exact `.study-panel > .chat-box`/`.terminal-box` structure,
// and the chat-box's chip/log/composer/note-list/patch-fold all read shared draft +
// composer state, so splitting it into finer views risks the DOM. (Noted in the
// design doc as kept-as-one for P3.)
function StudyView({ ctx }: { ctx: WorkspaceContext }) {
  const {
    focus,
    status,
    draftQuote,
    sources,
    chatMessages,
    chatSessions,
    dispatch,
    chatInput,
    setChatInput,
    // V-1: default to an empty strip / no-op so a partial test fixture (which mocks the
    // workspace context) doesn't crash the render; real usage always wires these.
    pendingImages = [],
    attachImage,
    removePendingImage,
    // V-2 (拍错题): default to a no-op so a partial test fixture doesn't crash the render.
    captureMistakePhoto = async () => {},
    visionAvailable = false,
    submitComposer,
    composerDisabled,
    addReplyAsNote,
    regenerateChatReply,
    agentTurn,
    agentAvailable,
    runAgentTurn,
    patchHtml,
    setPatchHtml,
    activePatches,
    changePatchStatus,
    showTerminal,
    setShowTerminal,
    activeFileDir,
    openManualEditor,
    operations,
    operationPrefs,
    activeKitIds
  } = ctx;

  // —— SC-1 slash composer state ——————————————————————————————————————————
  // The palette derives entirely from the input: "/…" parses into {query,
  // instruction}; entries re-rank as the query grows. Escape dismisses the palette
  // for the CURRENT input only (any edit re-opens it); the row index resets with
  // the input so the top match is always the Enter target.
  const slashParsed = parseSlashInput(chatInput);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashDismissedFor, setSlashDismissedFor] = useState<string | null>(null);
  // SC-3: the palette now spans note types AND operations (built-in kit actions +
  // custom ops), floated active-kit-first and pinyin-matchable. Rebuilt only when the
  // operation set / prefs / active kit change; the per-keystroke work stays the resolve.
  const allSlashEntries = useMemo(
    () =>
      buildSlashEntries({
        operations,
        disabled: operationPrefs.disabled,
        foregroundKitIds: activeKitIds
      }),
    [operations, operationPrefs, activeKitIds]
  );
  const slashEntries = useMemo(
    () => (slashParsed ? resolveSlashEntries(slashParsed.query, allSlashEntries) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- entries follow the raw input
    [chatInput, allSlashEntries]
  );
  useEffect(() => setSlashIndex(0), [chatInput]);
  const slashOpen = !!slashParsed && slashDismissedFor !== chatInput;

  // A palette pick (Enter on the active row, or a click): the branch decision is the
  // SHARED dispatchSlashEntry (SC-2) — bare `/type` = MANUAL (openManualEditor), with an
  // instruction = AI (note.generate-block), an operation = operation.run — so the chat
  // and the SC-2 toolbar mounts route a pick through IDENTICAL logic. This mount owns
  // only the chat-specific bookkeeping (clear the input, reset the dismiss flag).
  const pickSlashEntry = (entry: SlashEntry) => {
    const instruction = slashParsed?.instruction ?? "";
    setChatInput("");
    setSlashDismissedFor(null);
    dispatchSlashEntry(entry, instruction, { dispatch, openManualEditor });
  };

  // Bookmarks are notes too, but they surface in the dedicated Bookmarks pane (and as
  // inline anchor markers), NOT as cards here — so they read as markers, not content.
  return (
    <aside className="study-panel">
      <section className="chat-box">
        <div className="chat-panel-toolbar" aria-label="AI Chat controls">
          <div className="chat-panel-actions">
            <span
              className={`workspace-status-dot status-${status}`}
              title={`AI Chat status: ${status}`}
              aria-label={`AI Chat status: ${status}`}
            />
            {/* W1: session list + 新对话 — the conversation is durable & resumable. */}
            <ChatSessionSwitcher api={chatSessions} />
            {/* W3 (ai-workspace §W3): synthesize the conversation (+ its attachments) into
                a NEW markdown source (headings = TOC), opened in a fresh pane. */}
            <button
              type="button"
              className="icon-button chat-synthesize-button"
              title="生成文档"
              aria-label="生成文档"
              onClick={() => void dispatch("chat.synthesize", {})}
              disabled={status === "saving" || chatMessages.length === 0}
            >
              <FileText size={16} />
              生成文档
            </button>
            {/* A4b: capability-gated agent-loop trigger — runs ONE tool-calling turn and
                renders tool cards + the streamed answer. Shown ONLY when the active
                provider advertises app-defined tool calling (agentAvailable); a provider
                without runAgent would 501, so the button never appears there. */}
            {agentAvailable ? (
              <button
                type="button"
                className="icon-button chat-agent-button"
                title="用工具"
                aria-label="用工具"
                onClick={() => void runAgentTurn(chatInput || draftQuote)}
                disabled={status === "saving" || (!chatInput.trim() && !draftQuote.trim())}
              >
                <Wrench size={16} />
                🛠 用工具
              </button>
            ) : null}
            <PanelMenu label="AI Chat actions" align="right">
              {/* Keep non-note utilities out of the main conversation surface. */}
              <details className="patch-fold">
                <summary>
                  <ListRestart size={14} /> Edit source (patch)
                </summary>
                <textarea
                  className="patch-input"
                  value={patchHtml}
                  onChange={(event) => setPatchHtml(event.target.value)}
                />
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => void dispatch("anchor.create-patch", { newContent: patchHtml, oldText: draftQuote })}
                  disabled={!focus.draft && !focus.anchor}
                >
                  <ListRestart size={16} />
                  Create Patch
                </button>
                <div className="record-list patch-list">
                  {activePatches.map((patch) => (
                    <article key={patch.id} className="record-card">
                      <strong>{patch.status}</strong>
                      <code>{patch.id}</code>
                      <p>{patch.newContent}</p>
                      <div className="row-actions">
                        <button type="button" onClick={() => void changePatchStatus(patch, "applied")}>
                          Apply
                        </button>
                        <button type="button" onClick={() => void changePatchStatus(patch, "reverted")}>
                          <RotateCcw size={14} />
                          Revert
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </details>
              <div className="panel-menu-sep" />
              <div className="panel-title terminal-box-title">
                <TerminalSquare size={16} />
                AI Terminal
                <button
                  className="link-button"
                  type="button"
                  onClick={() => setShowTerminal((value) => !value)}
                >
                  {showTerminal ? "Hide" : "Show"}
                </button>
              </div>
              {showTerminal ? <TerminalPanel defaultCwd={activeFileDir} /> : null}
            </PanelMenu>
          </div>
        </div>
        {/* The passage everything below acts on — auto-filled from the reader
            selection (its anchor is created lazily when you ask or save). */}
        {false ? (
          <div className="chat-source">
            <span className="chat-source-label">Source</span>
            <span className="chat-source-quote">
              {false && !draftQuote ? (
                "Region selected"
              ) : (
                <>
                  {draftQuote.replace(/\s+/g, " ").slice(0, 90)}
                  {draftQuote.length > 90 ? "…" : ""}
                </>
              )}
            </span>
            <button
              type="button"
              className="chat-source-clear"
              aria-label="Clear source"
              onClick={() => focus.clear()}
            >
              ×
            </button>
          </div>
        ) : null}

        <div className="chat-log">
          {chatMessages.map((message, index) => {
            // §10 actions: every assistant reply can be kept as a note; only the LAST
            // assistant reply offers Regenerate (re-runs the most recent question).
            const isAssistant = message.role === "assistant";
            const isLastAssistant = isAssistant && index === chatMessages.length - 1;
            return (
              <div key={index} className={`chat-msg chat-${message.role}`}>
                {/* Display-side HARD contract (§0.5-B / §6.6): a chat reply is shown
                    through the SAME single render path as a note — getNoteType().render.
                    Rich (high-confidence) replies surface as a clickable ArtifactCard
                    that opens centered; plain replies render inline as markdown. */}
                <ChatMessageBody
                  role={message.role}
                  content={message.content}
                  onAddNote={isAssistant ? (content) => void addReplyAsNote(content) : undefined}
                  onRegenerate={isLastAssistant ? () => regenerateChatReply() : undefined}
                  busy={status === "saving"}
                />
              </div>
            );
          })}
          {/* A4b: the agent-loop transcript (tool cards + streamed answer). Render-only,
              below the persisted messages; cleared once the final answer persists as a
              normal assistant reply. Null when no agent turn is running. */}
          <AgentTranscript turn={agentTurn} />
          {/* Streaming ask-ai: until the FIRST token arrives, the last message is still
              the user's prompt while a request is in flight (status "saving"). Show a
              working row so the chat doesn't look frozen before progressive text begins.
              Once a delta lands, onAssistantChunk appends an assistant message and this
              clears. The agent turn drives its OWN spinner tail, so suppress this row
              while an agent turn is in flight. */}
          {status === "saving" &&
          !agentTurn &&
          chatMessages.length > 0 &&
          chatMessages[chatMessages.length - 1].role === "user" ? (
            <div className="chat-msg chat-assistant chat-pending" role="status" aria-live="polite">
              <Loader2 size={14} className="spin" />
              <span>AI 思考中…</span>
            </div>
          ) : null}
        </div>

        {/* D5: command-driven generation drafts NO LONGER park here — they open in
            the FloatingNoteEditor next to the passage (mounted once in the shell
            chrome). The chat pane keeps only chat + the slash entry below. */}

        {/* W2 (ai-workspace §W2): the attachment strip — chips for the session's attached
            sources + a "+" picker. Attaching a source feeds the widened ChatContext the
            next Ask AI resolves. Additive: renders above the untouched composer bar. */}
        <ChatAttachments api={chatSessions} sources={sources} />

        {/* V-1 (vision-input.md §2): the pending-image strip — thumbnails of images the
            user picked for the NEXT turn (each already imported → an assetId REF). Each
            is removable before send; on submit they fold into the user message. */}
        {pendingImages.length > 0 ? (
          <div className="chat-image-pending" aria-label="Pending images">
            {pendingImages.map((image) => (
              <span key={image.assetId} className="chat-image-pending-chip" data-asset-id={image.assetId}>
                <img src={`/api/assets/${image.assetId}`} alt="pending attachment" />
                <button
                  type="button"
                  className="chat-image-pending-remove"
                  aria-label="Remove image"
                  title="Remove image"
                  onClick={() => removePendingImage(image.assetId)}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <form
          className="chat-composer-bar"
          onSubmit={(event) => {
            event.preventDefault();
            if (slashOpen) return; // Enter belongs to the palette while it is open
            submitComposer();
          }}
        >
          {/* SC-1: the palette drops above the input while the draft parses as a
              slash command ("/", "/quiz", "/判断题 出三道"…). */}
          {slashOpen ? (
            <div className="chat-slash-palette">
              <SlashPalette
                query={slashParsed?.query ?? ""}
                entries={slashEntries}
                activeIndex={slashIndex}
                onPick={pickSlashEntry}
                onNavigate={setSlashIndex}
              />
            </div>
          ) : null}
          <textarea
            className="composer-input chat-composer-input"
            rows={1}
            value={chatInput}
            placeholder="Type / for commands"
            onChange={(event) => setChatInput(event.target.value)}
            onKeyDown={(event) => {
              // Palette first: arrows/Enter drive the row selection while the input
              // keeps focus (the exported SC-0 key mapping); Escape dismisses it for
              // this draft only.
              if (slashOpen) {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setSlashDismissedFor(chatInput);
                  return;
                }
                if (
                  slashPaletteKeyDown(event.key, {
                    entries: slashEntries,
                    activeIndex: slashIndex,
                    onPick: pickSlashEntry,
                    onNavigate: setSlashIndex
                  })
                ) {
                  event.preventDefault();
                  return;
                }
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submitComposer();
              }
            }}
          />
          {/* V-1: attach an image to the next turn. DEGRADE-NOT-DISAPPEAR — this stays
              visible on EVERY provider; a non-vision send surfaces the server's clean
              400 once (the attach affordance never hides). Desktop file-pick only
              (camera = V-3). */}
          <label className="chat-attach-image" title="附加图片" aria-label="Attach image">
            <ImagePlus size={16} />
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void attachImage(file);
                event.target.value = ""; // allow re-picking the same file
              }}
            />
          </label>
          {/* V-2 (拍错题): pick a photo of a wrong problem → VLM extract → mistake preview.
              DEGRADE-NOT-DISAPPEAR — visible on EVERY provider; the title HINTS when the
              active provider can't see images (a non-vision send surfaces the clean 400
              once). The current composer text rides as an optional hint. Desktop file-pick
              only (camera = V-3). */}
          <label
            className="chat-capture-mistake"
            title={visionAvailable ? "拍错题(照片抽取错题)" : "拍错题(当前 AI 不支持图片,发送会提示)"}
            aria-label="Capture mistake photo"
            data-vision={visionAvailable ? "on" : "off"}
          >
            <Camera size={16} />
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void captureMistakePhoto(file, chatInput);
                event.target.value = ""; // allow re-picking the same file
              }}
            />
          </label>
          {/* 语音输入 → transcript confirm popover → appends to chatInput (SPEECH-2). */}
          <VoiceInputButton
            className="chat-voice-input"
            onInsert={(text) => setChatInput(chatInput ? `${chatInput}${text}` : text)}
          />
          <button className="chat-submit" type="submit" disabled={composerDisabled} aria-label="Send message" title="Send">
            <CornerDownLeft size={16} />
          </button>
        </form>

      </section>
    </aside>
  );
}

// Register the three built-in views. The node is available to each render, but these
// panels don't read params yet (the threePane preset has no per-node params); a
// param-driven view (e.g. a source.viewer pinned to a specific sourceId) reads
// `node.params` here.
registerView({ kind: "library", render: (_node, ctx) => <LibraryView ctx={ctx} /> });
registerView({ kind: "source.viewer", render: (_node, ctx) => <SourceViewerView ctx={ctx} /> });
// F1 (P-A1): the multi-pane host owns its own tab strip; export the body so SourceTabs
// renders it without a second strip.
export { SourceViewerView };
registerView({ kind: "study", render: (_node, ctx) => <StudyView ctx={ctx} /> });
// N6/§D12: the Anchor Focus board as a registered view (a preset MAY dock it directly);
// the primary entry is the TopBar's Anchor Focus tab → AnchorBoardMount shell overlay.
registerView({ kind: "anchor.focus.board", render: (_node, _ctx) => <AnchorFocusBoard onClose={() => setAnchorBoardOpen(false)} /> });
