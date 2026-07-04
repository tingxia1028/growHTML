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

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CornerDownLeft,
  FileText,
  ListRestart,
  Loader2,
  Plus,
  RefreshCcw,
  RotateCcw,
  Sparkles,
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
// Side-effect import: registers the 12 built-in client NoteType plugins so the note
// list + composer can render/edit every content type through the registry.
import "../notes/builtinNoteTypes";
// Side-effect import: registers the built-in Table viewer (an exclusive cross-type viewer)
// into the viewer registry + the plugin read model. (The shared ArtifactCard also imports
// it so the viewer is registered wherever a card renders; both are idempotent.)
import "../notes/tableViewer";
import { ChatMessageBody } from "./ChatMessageBody";
import { GenerationPreview } from "./GenerationPreview";
// W1 (ai-workspace §2.1): the compact session switcher in the chat panel title row —
// 新对话 + history (select to resume, delete with confirm). State lives in the chat
// session domain (src/client/chat); StudyView only passes the bundled api through.
import { ChatSessionSwitcher } from "../chat/ChatSessionSwitcher";
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

  const sectionCtx: LibrarySectionContext = { workspace: ctx, query: query.trim().toLowerCase() };

  return (
    <aside className="library-panel">
      <div className="library-head">
        <h1 className="library-title">{t(libraryMessages.title)}</h1>
        {/* SEARCH-1 mounts here — the Cmd+K palette will replace/feed this input. */}
        <input
          className="library-search"
          type="search"
          value={query}
          placeholder={t(libraryMessages.searchPlaceholder)}
          aria-label={t(libraryMessages.searchPlaceholder)}
          onChange={(event) => setQuery(event.target.value)}
        />
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
function SourceViewerView({ ctx }: { ctx: WorkspaceContext }) {
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
    setActiveSourceId
  } = ctx;

  return (
    <main className="reader-panel">
      <header className="reader-header">
        {/* Tab strip — a single document tab (file icon + title + close). */}
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

        {/* Toolbar — ghost icon affordances + the ⋯ overflow holding the kit selector
            and status. Page/zoom controls live in the per-reader body toolbar (PdfReader),
            left as-is this pass. */}
        <div className="reader-toolbar">
          {activeSource ? <BookmarkIndex /> : null}
          <PanelMenu label="Reader actions">
            {activeSource ? (
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
        source: activeSource,
        anchors: paintAnchors,
        revealAnchors,
        onSelect: focus.setDraft,
        onMarkerAction: (anchorId) => {
          const anchor = anchors.find((item) => item.id === anchorId);
          if (anchor) focus.setAnchor(anchor);
        },
        activeAnchorId: focus.anchor?.id,
        revealSeq: focus.revealSeq,
        renderedHtml,
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
    chatMessages,
    chatSessions,
    dispatch,
    chatInput,
    setChatInput,
    submitComposer,
    composerDisabled,
    addReplyAsNote,
    regenerateChatReply,
    patchHtml,
    setPatchHtml,
    activePatches,
    changePatchStatus,
    showTerminal,
    setShowTerminal,
    activeFileDir
  } = ctx;

  // Bookmarks are notes too, but they surface in the dedicated Bookmarks pane (and as
  // inline anchor markers), NOT as cards here — so they read as markers, not content.
  return (
    <aside className="study-panel">
      <section className="chat-box">
        <div className="panel-title chat-panel-title">
          <Sparkles size={16} />
          AI Chat
          <span
            className={`workspace-status-dot status-${status}`}
            title={`AI Chat status: ${status}`}
            aria-label={`AI Chat status: ${status}`}
          />
          {/* W1: session list + 新对话 — the conversation is durable & resumable. */}
          <ChatSessionSwitcher api={chatSessions} />
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
          {/* Streaming ask-ai: until the FIRST token arrives, the last message is still
              the user's prompt while a request is in flight (status "saving"). Show a
              working row so the chat doesn't look frozen before progressive text begins.
              Once a delta lands, onAssistantChunk appends an assistant message and this
              clears. */}
          {status === "saving" &&
          chatMessages.length > 0 &&
          chatMessages[chatMessages.length - 1].role === "user" ? (
            <div className="chat-msg chat-assistant chat-pending" role="status" aria-live="polite">
              <Loader2 size={14} className="spin" />
              <span>AI 思考中…</span>
            </div>
          ) : null}
        </div>

        {/* Command-driven generation (kit Explain/Practice, operation.run, classify-
            reply) parks its draft here — preview → edit → Save/Regenerate/Discard.
            Renders nothing until a draft is pending. */}
        <GenerationPreview />

        <form
          className="chat-composer-bar"
          onSubmit={(event) => {
            event.preventDefault();
            submitComposer();
          }}
        >
          <textarea
            className="composer-input chat-composer-input"
            rows={1}
            value={chatInput}
            placeholder="Type / for commands"
            onChange={(event) => setChatInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submitComposer();
              }
            }}
          />
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
registerView({ kind: "study", render: (_node, ctx) => <StudyView ctx={ctx} /> });
