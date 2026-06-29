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
  CornerDownLeft,
  File,
  FileText,
  FilePlus2,
  FolderOpen,
  ListRestart,
  Loader2,
  Pencil,
  RefreshCcw,
  RotateCcw,
  Sparkles,
  TerminalSquare,
  Trash2,
  X
} from "lucide-react";
import type { NoteRecord } from "../data/entityClient";
import { TerminalPanel } from "../TerminalPanel";
import { FileTree } from "../FileTree";
import { registerView, type WorkspaceContext } from "./viewRegistry";
import { PanelMenu } from "./PanelMenu";
import { readerForSource } from "./readerForSource";
import { getNoteType } from "../notes/noteTypeRegistry";
// Side-effect import: registers the 12 built-in client NoteType plugins so the note
// list + composer can render/edit every content type through the registry.
import { InertNote } from "../notes/builtinNoteTypes";
import { FocusOverlay } from "./FocusOverlay";
import { ChatMessageBody } from "./ChatMessageBody";
import { isDiagramType } from "../../adapters/notes/diagrams";
// Side-effect import: installs the Product Kits (Textbook Learning Kit, …), which
// register their note types + domain language into the same registries.
import "../../kits/clientKits";

// —— library → the `.library-panel` aside. Reference IA: a clean header (`Library` +
// a ⋯ actions menu) over the body. The body is the styled FileTree when a folderRoot is
// set, else the restyled source list (web/e2e fallback). All the OLD chrome controls
// (Refresh, Open File, Open Folder, Import .xmind, Import from URL/Open Live) are
// relocated into the ⋯ menu — reachable, never removed.
function LibraryView({ ctx }: { ctx: WorkspaceContext }) {
  const {
    loadSources,
    canOpenLocal,
    openFileDialog,
    openFolderDialog,
    folderRoots,
    closeFolderRoot,
    openLocalFile,
    activeFilePath,
    recentSources,
    activeSourceId,
    setActiveSourceId,
    deleteSourceItem,
    importUrl,
    setImportUrl,
    importFromUrl,
    openLiveUrl,
    importXmindFile,
    activeThemeId
  } = ctx;

  // A neutral identity initial for the optional bottom user chip (reference shows one).
  const userInitial = "A";

  return (
    <aside className="library-panel">
      <div className="library-head">
        <h1 className="library-title">Library</h1>
        <PanelMenu label="Library actions">
          <button className="panel-menu-item" type="button" onClick={() => void loadSources()}>
            <RefreshCcw size={15} />
            Refresh
          </button>
          <button
            className="panel-menu-item"
            type="button"
            onClick={() => void openFileDialog()}
            disabled={!canOpenLocal}
            title={canOpenLocal ? "Open a local file" : "Desktop app only"}
          >
            <File size={15} />
            Open File
          </button>
          <button
            className="panel-menu-item"
            type="button"
            onClick={() => void openFolderDialog()}
            disabled={!canOpenLocal}
            title={canOpenLocal ? "Open a folder as a file tree" : "Desktop app only"}
          >
            <FolderOpen size={15} />
            Open Folder
          </button>
          <button
            className="panel-menu-item"
            type="button"
            onClick={() => void importXmindFile()}
            disabled={!canOpenLocal}
            title={canOpenLocal ? "Import a .xmind mind map (→ markmap note)" : "Desktop app only"}
          >
            <FilePlus2 size={15} />
            Import .xmind
          </button>
          {!canOpenLocal ? <div className="panel-menu-hint">File/folder open is desktop-only.</div> : null}
          <div className="panel-menu-sep" />
          <div className="panel-menu-label">Import from URL</div>
          <input
            className="panel-menu-input"
            value={importUrl}
            placeholder="https://…"
            onChange={(event) => setImportUrl(event.target.value)}
          />
          <button className="panel-menu-item" type="button" onClick={() => void importFromUrl()}>
            <FilePlus2 size={15} />
            Fetch URL
          </button>
          <button className="panel-menu-item" type="button" onClick={() => void openLiveUrl()}>
            <FilePlus2 size={15} />
            Open Live
          </button>
        </PanelMenu>
      </div>

      <div className="library-body library-body-split">
        <section
          className={`library-section library-section-open${folderRoots.length > 0 ? " has-folders" : ""}`}
          aria-label="Folders"
        >
          <div className="library-section-head">
            <span>Folders</span>
            <button
              className="library-section-action"
              type="button"
              onClick={() => void openFolderDialog()}
              disabled={!canOpenLocal}
              title={canOpenLocal ? "Open a folder as a file tree" : "Desktop app only"}
            >
              <FolderOpen size={14} />
              <span>Open</span>
            </button>
          </div>

          <div className="open-folder-list">
            {folderRoots.length > 0 ? (
              folderRoots.map((root) => (
                <div className="folder-tree-host" key={root}>
                  <button
                    className="folder-tree-close"
                    type="button"
                    onClick={() => closeFolderRoot(root)}
                    title="Close folder"
                    aria-label="Close folder"
                  >
                    <X size={14} />
                  </button>
                  <FileTree root={root} onOpenFile={(filePath) => void openLocalFile(filePath)} activePath={activeFilePath} />
                </div>
              ))
            ) : null}
          </div>
        </section>

        <section className="library-section library-section-recent" aria-label="Recent Read">
          <div className="library-section-head">
            <span>Recent Read</span>
          </div>

          <div className="source-list recent-source-list">
            {recentSources.map((source) => (
              <div
                key={source.id}
                className={`source-item${source.id === activeSourceId ? " active" : ""}`}
                title={[
                  source.title,
                  `Type: ${source.sourceType}`,
                  source.metadata?.originalPath ? `Path: ${source.metadata.originalPath}` : `ID: ${source.id}`
                ].join("\n")}
              >
                <button className="source-item-open" type="button" onClick={() => setActiveSourceId(source.id)}>
                  <File size={15} className="source-item-icon" />
                  <span className="source-item-text">
                    <span>{source.title}</span>
                    <small>{source.sourceType} · {source.id}</small>
                  </span>
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
            {recentSources.length === 0 ? <div className="empty-state">No recent reads yet.</div> : null}
          </div>
        </section>
      </div>

      <div className="library-user" title="Account">
        <span className="library-user-avatar" data-theme-id={activeThemeId}>{userInitial}</span>
        <span className="library-user-name">Alex</span>
      </div>
    </aside>
  );
}

// —— source.viewer → the `.reader-panel` main: header + the active source's reader.
// The per-surface reader if/else lives in `readerForSource`, not here.
function SourceViewerView({ ctx }: { ctx: WorkspaceContext }) {
  const {
    activeSource,
    status,
    error,
    paintAnchors,
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
          <span className={`reader-status-dot status-${status}`} title={`Status: ${status}`} aria-label={`Status: ${status}`} />
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
        onSelect: focus.setDraft,
        activeAnchorId: focus.anchor?.id,
        revealSeq: focus.revealSeq,
        renderedHtml,
        annotationMode
      })}
    </main>
  );
}

// A note's layer membership: the current-layer chips + a "move / add to layer" picker.
// The picker is a fold (kept compact in the note card) listing the source's layers as
// checkboxes; toggling one sends the note's FULL next membership via `onSetLayers`
// (note.set-layers). A note can belong to several layers, so this is multi-select, not
// a single move. Chips use each layer's `color` so the lens is visible at a glance.
// A saved note's content, rendered IN ITS FORM (requirement 2 — the note viewer is
// the corresponding rendering, not flattened to text). The in-list render is the
// plugin's full view (today's behavior). For interactive/rich forms it ALSO offers an
// "Open" affordance that focuses the note into the SHARED FocusOverlay — the exact
// same capability the chat ArtifactCard uses (one impl, not re-done per surface), so a
// 思维导图/diagram note can be viewed CENTERED and interactive. Bookmarks (chips) and
// unknown types don't get the overlay — there's nothing richer to focus into.
// `onEdit` persists an in-place content edit (dispatch note.edit with {noteId, content});
// `onDelete` removes the note (dispatch note.delete with {noteId}). Both flow through the
// command layer so the host stays free of contentType branching.
function NoteContentView({
  note,
  onEdit,
  onDelete
}: {
  note: NoteRecord;
  onEdit: (content: unknown) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  // Edit-in-place: when set, the note shows the SAME registry editor the composer uses
  // (getNoteType(contentType).edit), seeded with this working copy of the content. Save
  // persists it; Cancel discards (drops the working copy). null = not editing.
  const [draft, setDraft] = useState<unknown>(undefined);
  const editing = draft !== undefined;
  const contentType = note.contentType ?? "markdown";
  const plugin = getNoteType(contentType);
  // Diagrams (and any future rich, interactive form) gain the centered overlay; plain
  // text / chips render in place only. Derived from the diagram renderer REGISTRY (not
  // a contentType branch) so any registered diagram form is focusable for free.
  // Focusable into the centered overlay = a diagram (via the diagram registry) OR a
  // plugin that opts in with its `focusable` capability flag (e.g. interactive html).
  // Derived from registry capabilities, NOT a contentType branch — so any focusable form
  // gets the overlay for free.
  const focusable = !!plugin && (isDiagramType(contentType) || plugin.focusable === true);
  // Editing reuses the registry editor — the SAME getNoteType().edit the composer uses,
  // not a bespoke per-type editor (contract law §0.5 / contract guard). Seed it with the
  // current content; the editor calls back with the next value on every keystroke.
  if (editing && plugin) {
    return (
      <div className="note-edit-inline">
        {plugin.edit({ content: draft, onChange: setDraft })}
        <div className="row-actions">
          <button
            type="button"
            className="link-button note-edit-save"
            title="Save changes to this note"
            onClick={() => {
              onEdit(draft);
              setDraft(undefined);
            }}
          >
            Save
          </button>
          <button
            type="button"
            className="link-button note-edit-cancel"
            title="Discard changes"
            onClick={() => setDraft(undefined)}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }
  return (
    <>
      {plugin ? plugin.render({ content: note.content, note }) : <InertNote content={note.content} />}
      <div className="row-actions note-actions">
        {focusable ? (
          <button
            type="button"
            className="link-button note-open-overlay"
            aria-haspopup="dialog"
            title="Open this note centered and interactive"
            onClick={() => setOpen(true)}
          >
            Open interactively
          </button>
        ) : null}
        {/* Edit in place via the registry editor — only when the type has an editor
            registered (every built-in does). */}
        {plugin ? (
          <button
            type="button"
            className="link-button note-edit-start"
            title="Edit this note"
            onClick={() => setDraft(note.content)}
          >
            <Pencil size={14} />
            Edit
          </button>
        ) : null}
        <button
          type="button"
          className="link-button note-delete"
          title="Delete this note"
          onClick={onDelete}
        >
          <Trash2 size={14} />
          Delete
        </button>
      </div>
      {open ? (
        <FocusOverlay block={{ contentType, content: note.content, note }} onClose={() => setOpen(false)} />
      ) : null}
    </>
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
    status,
    draftQuote,
    chatMessages,
    dispatch,
    chatInput,
    setChatInput,
    submitComposer,
    composerDisabled,
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
          {chatMessages.map((message, index) => (
            <div key={index} className={`chat-msg chat-${message.role}`}>
              {/* Display-side HARD contract (§0.5-B / §6.6): a chat reply is shown
                  through the SAME single render path as a note — getNoteType().render.
                  Rich (high-confidence) replies surface as a clickable ArtifactCard
                  that opens centered; plain replies render inline as markdown. */}
              <ChatMessageBody role={message.role} content={message.content} />
            </div>
          ))}
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
