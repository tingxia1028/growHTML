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

import {
  File,
  FilePlus2,
  FolderOpen,
  ListRestart,
  NotebookPen,
  RefreshCcw,
  RotateCcw,
  Send,
  Sparkles,
  TerminalSquare,
  Trash2,
  X
} from "lucide-react";
import { renderNoteContent } from "../../adapters/notes/render";
import { isDiagramType } from "../../adapters/notes/diagrams";
import { DiagramNote } from "../DiagramNote";
import { TerminalPanel } from "../TerminalPanel";
import { FileTree, baseName } from "../FileTree";
import { registerView, type WorkspaceContext } from "./viewRegistry";
import { noteText } from "./WorkspaceContext";
import { readerForSource } from "./readerForSource";

// Composer note types are limited to string-content types for now. Structured
// types (mindmap/flashcard/quiz) get dedicated editors in the NoteType plugins
// phase; until then their content can't be authored as free text.
const NOTE_CONTENT_TYPES = ["markdown", "mermaid", "markmap"] as const;

// —— library → the `.library-panel` aside (sources list, Open file/folder, URL import).
function LibraryView({ ctx }: { ctx: WorkspaceContext }) {
  const {
    loadSources,
    canOpenLocal,
    openFileDialog,
    openFolderDialog,
    folderRoot,
    setFolderRoot,
    openLocalFile,
    activeFilePath,
    sources,
    activeSourceId,
    setActiveSourceId,
    deleteSourceItem,
    importUrl,
    setImportUrl,
    importFromUrl,
    openLiveUrl
  } = ctx;

  return (
    <aside className="library-panel">
      <div className="brand-block">
        <p>AI Study Vault</p>
        <h1>Sources</h1>
      </div>

      <button className="icon-button primary" type="button" onClick={() => void loadSources()} title="Reload sources">
        <RefreshCcw size={17} />
        Refresh
      </button>

      <section className="open-box">
        <div className="panel-title">
          <FolderOpen size={16} />
          Open
        </div>
        <div className="open-actions">
          <button
            className="icon-button"
            type="button"
            onClick={() => void openFileDialog()}
            disabled={!canOpenLocal}
            title={canOpenLocal ? "Open a local file" : "Desktop app only"}
          >
            <File size={16} />
            File
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={() => void openFolderDialog()}
            disabled={!canOpenLocal}
            title={canOpenLocal ? "Open a folder as a file tree" : "Desktop app only"}
          >
            <FolderOpen size={16} />
            Folder
          </button>
        </div>
        {!canOpenLocal ? <small className="tree-hint">Available in the desktop app.</small> : null}
        {folderRoot ? (
          <div className="folder-root">
            <div className="folder-root-head">
              <span className="folder-root-name" title={folderRoot}>{baseName(folderRoot)}</span>
              <button className="link-button" type="button" onClick={() => setFolderRoot(null)} title="Close folder">
                <X size={14} />
              </button>
            </div>
            <FileTree root={folderRoot} onOpenFile={(filePath) => void openLocalFile(filePath)} activePath={activeFilePath} />
          </div>
        ) : null}
      </section>

      <div className="source-list">
        {sources.map((source) => (
          <div
            key={source.id}
            className={`source-item${source.id === activeSourceId ? " active" : ""}`}
          >
            <button className="source-item-open" type="button" onClick={() => setActiveSourceId(source.id)}>
              <span>{source.title}</span>
              <small>{source.sourceType} · {source.id}</small>
            </button>
            <button
              className="source-item-delete"
              type="button"
              title="Remove this document"
              aria-label="Remove this document"
              onClick={() => void deleteSourceItem(source.id, source.title)}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        {sources.length === 0 ? <div className="empty-state">No sources yet.</div> : null}
      </div>

      <section className="url-import-box">
        <div className="panel-title">
          <FilePlus2 size={16} />
          Import from URL
        </div>
        <input
          value={importUrl}
          placeholder="https://…"
          onChange={(event) => setImportUrl(event.target.value)}
        />
        <button className="icon-button" type="button" onClick={() => void importFromUrl()}>
          <FilePlus2 size={16} />
          Fetch URL
        </button>
        <button className="icon-button" type="button" onClick={() => void openLiveUrl()}>
          <FilePlus2 size={16} />
          Open Live
        </button>
      </section>
    </aside>
  );
}

// —— source.viewer → the `.reader-panel` main: header + the active source's reader.
// The per-surface reader if/else lives in `readerForSource`, not here.
function SourceViewerView({ ctx }: { ctx: WorkspaceContext }) {
  const { activeSource, status, error, paintAnchors, focus, renderedHtml } = ctx;

  return (
    <main className="reader-panel">
      <header className="reader-header">
        <div>
          <p>{activeSource?.sourceType ?? "source"}</p>
          <h2>{activeSource?.title ?? "Open or import a source"}</h2>
        </div>
        <span className={`status-pill status-${status}`}>{status}</span>
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
        onSelect: focus.setDraft,
        renderedHtml
      })}
    </main>
  );
}

// —— study → the `.study-panel` aside (chat-box + terminal-box). Kept as ONE view:
// the e2e depend on the exact `.study-panel > .chat-box`/`.terminal-box` structure,
// and the chat-box's chip/log/composer/note-list/patch-fold all read shared draft +
// composer state, so splitting it into finer views risks the DOM. (Noted in the
// design doc as kept-as-one for P3.)
function StudyView({ ctx }: { ctx: WorkspaceContext }) {
  const {
    focus,
    draftQuote,
    hasRegionDraft,
    chatMessages,
    dispatch,
    selectedTextOr,
    chatInput,
    setChatInput,
    composerMode,
    setComposerMode,
    submitComposer,
    noteContentType,
    setNoteContentType,
    composerDisabled,
    notes,
    patchHtml,
    setPatchHtml,
    activePatches,
    changePatchStatus,
    showTerminal,
    setShowTerminal,
    activeFileDir
  } = ctx;

  return (
    <aside className="study-panel">
      <section className="chat-box">
        <div className="panel-title">
          <Sparkles size={16} />
          AI Chat &amp; Notes
        </div>
        {/* The passage everything below acts on — auto-filled from the reader
            selection (its anchor is created lazily when you ask or save). */}
        {draftQuote || hasRegionDraft ? (
          <div className="chat-source">
            <span className="chat-source-label">Source</span>
            <span className="chat-source-quote">
              {hasRegionDraft && !draftQuote ? (
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
          {chatMessages.map((message, index) => (
            <div key={index} className={`chat-msg chat-${message.role}`}>
              <div
                className="note-rendered"
                dangerouslySetInnerHTML={{ __html: renderNoteContent("markdown", message.content).html }}
              />
              {message.role === "assistant" ? (
                <div className="row-actions">
                  <button
                    className="link-button"
                    type="button"
                    title="Save the highlighted part of this reply (or the whole reply if nothing is selected)"
                    onClick={() => void dispatch("anchor.add-note", { text: selectedTextOr(message.content), contentType: "markdown" })}
                  >
                    Save selection as note
                  </button>
                  <button
                    className="link-button"
                    type="button"
                    onClick={() => void dispatch("anchor.add-note", { text: message.content, contentType: "markdown" })}
                  >
                    Save full reply
                  </button>
                </div>
              ) : null}
            </div>
          ))}
          {chatMessages.length === 0 ? (
            <div className="empty-state">Ask the assistant, or write a note, about the selected passage.</div>
          ) : null}
        </div>

        {/* One composer: toggle whether the text is sent to the AI or saved as a
            note. Enter submits the current mode; Shift+Enter inserts a newline. */}
        <textarea
          className="composer-input"
          value={chatInput}
          placeholder={composerMode === "ask" ? "Ask the AI about this passage…" : "Write a note about this passage…"}
          onChange={(event) => setChatInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submitComposer();
            }
          }}
        />
        <div className="composer-actions">
          <div className="composer-mode" role="tablist" aria-label="Composer mode">
            <button
              type="button"
              className={`mode-tab${composerMode === "ask" ? " active" : ""}`}
              onClick={() => setComposerMode("ask")}
            >
              <Sparkles size={14} />
              Ask AI
            </button>
            <button
              type="button"
              className={`mode-tab${composerMode === "note" ? " active" : ""}`}
              onClick={() => setComposerMode("note")}
            >
              <NotebookPen size={14} />
              Note
            </button>
          </div>
          {composerMode === "note" ? (
            <select
              className="note-type-select"
              value={noteContentType}
              onChange={(event) => setNoteContentType(event.target.value)}
            >
              {NOTE_CONTENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          ) : null}
          <button
            className="icon-button primary composer-submit"
            type="button"
            onClick={submitComposer}
            disabled={composerDisabled}
            title={composerMode === "ask" ? "Send to AI (Enter)" : "Save note (Enter)"}
          >
            {composerMode === "ask" ? <Send size={16} /> : <NotebookPen size={16} />}
            {composerMode === "ask" ? "Send" : "Save Note"}
          </button>
        </div>

        {notes.length ? (
          <div className="record-list note-list">
            {notes.map((note) => {
              const contentType = note.contentType ?? "markdown";
              const text = noteText(note.content);
              return (
                <article key={note.id} className="record-card">
                  <strong>{contentType}</strong>
                  {isDiagramType(contentType) ? (
                    <DiagramNote contentType={contentType} content={text} />
                  ) : (
                    <div
                      className="note-rendered"
                      dangerouslySetInnerHTML={{ __html: renderNoteContent(contentType, text).html }}
                    />
                  )}
                </article>
              );
            })}
          </div>
        ) : null}

        {/* Source-editing (reviewable patches) folded away — same selection. */}
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
      </section>

      <section className="terminal-box">
        <div className="panel-title">
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
