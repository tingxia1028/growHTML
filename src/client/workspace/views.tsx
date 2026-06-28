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
  File,
  FilePlus2,
  FolderOpen,
  Layers,
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
import type { NoteRecord, StudyLayerRecord } from "../data/entityClient";
import { renderNoteContent } from "../../adapters/notes/render";
import { noteCardsFrom } from "./noteCards";
import { TerminalPanel } from "../TerminalPanel";
import { FileTree, baseName } from "../FileTree";
import { registerView, type WorkspaceContext } from "./viewRegistry";
import { readerForSource } from "./readerForSource";
import {
  getNoteType,
  isTextContentType,
  listNoteTypes
} from "../notes/noteTypeRegistry";
// Side-effect import: registers the 12 built-in client NoteType plugins so the note
// list + composer can render/edit every content type through the registry.
import { InertNote } from "../notes/builtinNoteTypes";
import { NoteAnchorControl } from "./noteAnchorControl";
import { SelectionToolbar } from "./SelectionToolbar";
import { GenerationPreview } from "./GenerationPreview";
import { SourceActionsToolbar } from "./SourceActionsToolbar";
import { noteTypeOwnerKit } from "../../kits/clientContext";
// Side-effect import: installs the Product Kits (Textbook Learning Kit, …), which
// register their note types + domain language into the same registries.
import "../../kits/clientKits";

// The composer's note-type picker lists the registered client NoteTypes, sorted so
// markdown leads (it stays the default — the existing composer e2e types a markdown
// note). Kit-owned types are gated by per-source activation: a built-in/core type
// (no owning kit) is always offered; a kit type only when that kit is active here.
// (Rendering is NOT gated — only this creation picker is.)
function noteTypeOptions(activeKitIds: readonly string[]): { contentType: string; label: string }[] {
  const all = listNoteTypes()
    .filter((plugin) => {
      if (plugin.hidden) return false;
      const owner = noteTypeOwnerKit(plugin.contentType);
      return !owner || activeKitIds.includes(owner);
    })
    .map((plugin) => ({
      contentType: plugin.contentType,
      label: plugin.label ?? plugin.contentType
    }));
  return all.sort((a, b) =>
    a.contentType === "markdown" ? -1 : b.contentType === "markdown" ? 1 : a.contentType.localeCompare(b.contentType)
  );
}

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
  const {
    activeSource,
    activeViewer,
    activeFilePath,
    status,
    error,
    paintAnchors,
    focus,
    renderedHtml,
    annotationMode,
    setAnnotationMode,
    activeKitIds,
    installedKits,
    setActiveKit,
    activeLayoutId,
    availableLayouts,
    setActiveLayout,
    activeThemeId,
    availableThemes,
    setActiveTheme
  } = ctx;

  // The Floating ↔ Margin note toggle is scoped to the DOM-iframe HTML reader —
  // the one surface the AnnotationRenderer registry paints into (decorateAnnotations).
  // That's exactly the imported-HTML pipeline that ISN'T a local file (local HTML uses
  // the webview, which keeps its own painting). Mirrors readerForSource's DomReader gate.
  const showAnnotToggle = activeViewer.htmlPipeline && !activeFilePath;

  return (
    <main className="reader-panel">
      <header className="reader-header">
        <div>
          <p>{activeSource?.sourceType ?? "source"}</p>
          <h2>{activeSource?.title ?? "Open or import a source"}</h2>
        </div>
        <div className="reader-header-actions">
          <select
            className="layout-select"
            aria-label="Workspace layout"
            title="Switch the workspace layout (which panes are shown and how they're arranged)"
            value={activeLayoutId}
            onChange={(event) => setActiveLayout(event.target.value)}
          >
            {availableLayouts.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
          <select
            className="theme-select"
            aria-label="Theme"
            title="Switch the app theme (colors/typography only)"
            value={activeThemeId}
            onChange={(event) => setActiveTheme(event.target.value)}
          >
            {availableThemes.map((theme) => (
              <option key={theme.id} value={theme.id}>
                {theme.name}
              </option>
            ))}
          </select>
          {activeSource ? (
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
          ) : null}
          {showAnnotToggle ? (
            <button
              type="button"
              className="annot-mode-toggle"
              onClick={() => setAnnotationMode(annotationMode === "margin" ? "floating" : "margin")}
              title="Toggle how notes are shown: a card on hover, or persistent cards in the side margin"
            >
              {annotationMode === "margin" ? "Notes: Margin" : "Notes: Floating"}
            </button>
          ) : null}
          <span className={`status-pill status-${status}`}>{status}</span>
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
function NoteLayerControl({
  note,
  layers,
  onSetLayers
}: {
  note: NoteRecord;
  layers: StudyLayerRecord[];
  onSetLayers(layerIds: string[]): void;
}) {
  const [open, setOpen] = useState(false);
  if (layers.length === 0) return null;
  const memberIds = new Set(note.layerIds);
  const chips = layers.filter((layer) => memberIds.has(layer.id));

  // Toggle one layer in/out of the note's membership and emit the full next set.
  const toggle = (layerId: string) => {
    const next = memberIds.has(layerId)
      ? note.layerIds.filter((id) => id !== layerId)
      : [...note.layerIds, layerId];
    onSetLayers(next);
  };

  return (
    <div className="note-layers">
      <div className="note-layer-chips">
        {chips.map((layer) => (
          <span
            key={layer.id}
            className="note-layer-chip"
            style={layer.color ? { borderColor: layer.color, color: layer.color } : undefined}
          >
            {layer.title}
          </span>
        ))}
        <button
          type="button"
          className="link-button note-layer-edit"
          aria-label="Move or add this note to layers"
          title="Move / add this note to layers"
          onClick={() => setOpen((value) => !value)}
        >
          <Layers size={13} />
          Layers
        </button>
      </div>
      {open ? (
        <div className="note-layer-picker">
          {layers.map((layer) => (
            <label key={layer.id} className="note-layer-option">
              <input
                type="checkbox"
                checked={memberIds.has(layer.id)}
                onChange={() => toggle(layer.id)}
              />
              <span
                className="note-layer-swatch"
                style={layer.color ? { background: layer.color } : undefined}
              />
              {layer.title}
            </label>
          ))}
        </div>
      ) : null}
    </div>
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
    noteContent,
    setNoteContent,
    submitNoteContent,
    composerDisabled,
    visibleNotes,
    anchors,
    sourceLayers,
    patchHtml,
    setPatchHtml,
    activePatches,
    changePatchStatus,
    showTerminal,
    setShowTerminal,
    activeFileDir,
    activeKitIds
  } = ctx;

  // Bookmarks are notes too, but they surface in the dedicated Bookmarks pane (and as
  // inline anchor markers), NOT as cards here — so they read as markers, not content.
  const noteCards = noteCardsFrom(visibleNotes);

  return (
    <aside className="study-panel">
      <section className="chat-box">
        <div className="panel-title">
          <Sparkles size={16} />
          AI Chat &amp; Notes
        </div>
        {/* Kit-contributed source-level actions (Textbook: Review Pack). Absent when
            no kit is installed or no source is open. */}
        <SourceActionsToolbar
          visible={!!ctx.activeSource}
          items={ctx.sourceActions}
          onRun={(action) => ctx.runAction(action)}
        />
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

        {/* Kit-contributed quick actions on the focused passage (Textbook: Explain /
            Practice / Mistake). Empty — and absent — when no kit is installed. */}
        <SelectionToolbar
          visible={!!focus.draft || !!focus.anchor}
          items={ctx.selectionActions}
          onRun={(action) => ctx.runAction(action)}
        />

        {/* generate → preview → edit → save: a kit AI draft awaiting Save. A SEPARATE
            DOM subtree from .note-list below — a draft previews here before any note
            exists. Renders nothing when no draft is pending. */}
        <GenerationPreview />

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
        </div>

        {/* One composer: toggle whether the text is sent to the AI or saved as a
            note. Enter submits the current mode; Shift+Enter inserts a newline.
            STRING note types (markdown/plain-text/mermaid/markmap) and "ask" author
            through this shared textarea — this is the path the existing e2e drive.
            OBJECT note types (flashcard/quiz/image/…) hide it and render the chosen
            type's structured `edit()` editor below instead. */}
        {composerMode === "ask" || isTextContentType(noteContentType) ? (
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
        ) : (
          <div className="composer-note-editor">
            {getNoteType(noteContentType)?.edit({ content: noteContent, onChange: setNoteContent }) ?? null}
          </div>
        )}
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
              {noteTypeOptions(activeKitIds).map((option) => (
                <option key={option.contentType} value={option.contentType}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : null}
          {/* Save routes by content shape: STRING types submit the textarea via
              submitComposer (the existing path, gated by composerDisabled); OBJECT
              types submit the structured draft via submitNoteContent (always
              enabled — the editor seeds a valid blank value). */}
          {composerMode === "note" && !isTextContentType(noteContentType) ? (
            <button
              className="icon-button primary composer-submit"
              type="button"
              onClick={submitNoteContent}
              title="Save note"
            >
              <NotebookPen size={16} />
              Save Note
            </button>
          ) : (
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
          )}
        </div>

        {noteCards.length ? (
          <div className="record-list note-list">
            {noteCards.map((note) => {
              const contentType = note.contentType ?? "markdown";
              // Each note renders through its registered client NoteType plugin
              // (content decoupled from renderer). An UNKNOWN type (no plugin) falls
              // back to inert, escaped text so a foreign note can't crash the list.
              const plugin = getNoteType(contentType);
              return (
                <article key={note.id} className="record-card">
                  <strong>{contentType}</strong>
                  {plugin
                    ? plugin.render({ content: note.content, note })
                    : <InertNote content={note.content} />}
                  {/* A note's lens(es) + the "move / add to layer" action: chips show its
                      current layers, the picker toggles membership (note.set-layers sends
                      the full set). A note can sit in several layers at once. */}
                  <NoteLayerControl
                    note={note}
                    layers={sourceLayers}
                    onSetLayers={(layerIds) => void dispatch("note.set-layers", { layerNoteId: note.id, layerIds })}
                  />
                  {/* A note's anchor(s): "link to selection" (anchor the note at the
                      focused passage too) + per-anchor jump buttons for a multi-anchor
                      note. Pure UX over note.anchorIds (no schema change). */}
                  <NoteAnchorControl
                    note={note}
                    anchors={anchors}
                    focus={focus}
                    onLink={() => void dispatch("note.link-anchor", { noteId: note.id, noteAnchorIds: note.anchorIds })}
                  />
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
