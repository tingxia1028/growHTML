import { useEffect, useMemo, useState } from "react";
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
import { renderNoteContent } from "../adapters/notes/render";
import { isDiagramType } from "../adapters/notes/diagrams";
import { DiagramNote } from "./DiagramNote";
import { getSourceViewer } from "./viewers";
import { WebviewReader } from "./WebviewReader";
import { PdfReader } from "./PdfReader";
import { ImageReader } from "./ImageReader";
import { TerminalPanel } from "./TerminalPanel";
import { FileTree, baseName } from "./FileTree";
import { LocalHtmlReader } from "./LocalHtmlReader";
import { DomReader } from "./surfaces/DomReader";
import type { PaintAnchor } from "./surfaces/types";
import {
  entityClient,
  type AnyAnchor,
  type ChatContext,
  type ChatMessage,
  type NoteRecord,
  type PatchRecord,
  type SourceRecord
} from "./data/entityClient";
import { FocusProvider, useFocus, draftQuoteText } from "./focus/FocusContext";
import { getCommand, runCommand, type CommandContext } from "./commands/registry";

// Composer note types are limited to string-content types for now. Structured
// types (mindmap/flashcard/quiz) get dedicated editors in the NoteType plugins
// phase; until then their content can't be authored as free text.
const NOTE_CONTENT_TYPES = ["markdown", "mermaid", "markmap"] as const;

type Status = "idle" | "loading" | "saving" | "error";

// Note `content` is `unknown` (structured per contentType). For display we want a
// string: string content passes through; structured content is shown as JSON.
function noteText(content: unknown): string {
  return typeof content === "string" ? content : JSON.stringify(content, null, 2);
}

// Build the /api/local URL for a local file, mirroring its absolute path so the
// page's relative assets resolve against its own directory.
function localFileUrl(absPath: string): string {
  const encoded = absPath
    .replace(/\\/g, "/")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  return `/api/local/${encoded}`;
}

// Empty input → empty string (the terminal then uses the app's default cwd).
function parentDir(filePath: string): string {
  const normalized = filePath.replace(/[\\/]+$/, "");
  const cut = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return cut > 0 ? normalized.slice(0, cut) : "";
}

export default function App() {
  return (
    <FocusProvider>
      <Workspace />
    </FocusProvider>
  );
}

function Workspace() {
  const focus = useFocus();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [activeSourceId, setActiveSourceId] = useState("");
  const [renderedHtml, setRenderedHtml] = useState("");
  const [anchors, setAnchors] = useState<AnyAnchor[]>([]);
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [patches, setPatches] = useState<PatchRecord[]>([]);
  const [noteContentType, setNoteContentType] = useState<string>("markdown");
  const [composerMode, setComposerMode] = useState<"ask" | "note">("ask");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [showTerminal, setShowTerminal] = useState(false);
  const [patchHtml, setPatchHtml] = useState("");
  const [importUrl, setImportUrl] = useState("");
  const [folderRoot, setFolderRoot] = useState<string | null>(null);

  // Native file/folder dialogs come from the Electron preload; absent in a browser.
  const canOpenLocal = typeof window !== "undefined" && !!window.studyVault?.openFile;
  const activeFilePath = (sources.find((source) => source.id === activeSourceId)?.metadata?.originalPath as string | undefined) ?? undefined;

  const activeSource = sources.find((source) => source.id === activeSourceId) ?? null;
  const activeViewer = getSourceViewer(activeSource?.sourceType);
  const selectedAnchorId = focus.anchor?.id ?? "";
  const activeFileDir = parentDir((activeSource?.metadata?.originalPath as string | undefined) ?? "");

  // Note text per anchor id — a note can hang off several anchors, and several
  // notes can share an anchor (their text is merged for the one hover card).
  const noteTextByAnchorId = useMemo(() => {
    const map = new Map<string, string>();
    for (const note of notes) {
      const text = noteText(note.content);
      for (const anchorId of note.anchorIds) {
        const existing = map.get(anchorId);
        map.set(anchorId, (existing ? `${existing}\n\n` : "") + text);
      }
    }
    return map;
  }, [notes]);

  // ONE normalized paint list for the active source: every anchor it has, mapped to
  // the uniform PaintAnchor shape with its merged note text. The host hands this
  // SAME list to whichever reader matches the source; each reader filters it to the
  // anchorKinds it understands and paints those. (Replaces the old per-viewer
  // webAnchors / pdfAnchors / imageAnchors memos — there is no surface-specific
  // shaping here anymore.)
  const paintAnchors = useMemo<PaintAnchor[]>(
    () =>
      anchors.map((anchor) => ({
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
    [anchors, noteTextByAnchorId]
  );
  const activePatches = useMemo(
    () => patches.filter((patch) => !selectedAnchorId || patch.anchorId === selectedAnchorId),
    [patches, selectedAnchorId]
  );

  useEffect(() => {
    void loadSources();
  }, []);

  useEffect(() => {
    if (activeSourceId) {
      void loadSourceWorkspace(activeSourceId);
    }
  }, [activeSourceId]);

  async function loadSources() {
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
  }

  async function loadSourceWorkspace(sourceId: string) {
    setStatus("loading");
    setError("");
    try {
      const sourceRecord = sources.find((item) => item.id === sourceId);
      const viewer = getSourceViewer(sourceRecord?.sourceType);
      const isLocalHtml = viewer.htmlPipeline && !!sourceRecord?.metadata?.originalPath;
      const [rendered, anchorsResponse, notesResponse, patchesResponse] = await Promise.all([
        viewer.htmlPipeline && !isLocalHtml ? entityClient.rendered(sourceId) : Promise.resolve(null),
        entityClient.anchors(sourceId),
        entityClient.notes(sourceId),
        entityClient.patches(sourceId)
      ]);
      setRenderedHtml(rendered?.content ?? "");
      setAnchors(anchorsResponse.anchors);
      setNotes(notesResponse.notes);
      setPatches(patchesResponse.patches);
      focus.clear();
      setPatchHtml("");
      setChatMessages([]);
      setChatInput("");
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load source");
      setStatus("error");
    }
  }

  // Re-fetch anchors/notes/patches after a mutation that may have created a new
  // anchor (note/patch save), so the painted highlights and lists stay in sync —
  // without resetting the chat the way a full workspace reload would.
  async function refreshAnnotations() {
    if (!activeSourceId) return;
    try {
      const [anchorsResponse, notesResponse, patchesResponse] = await Promise.all([
        entityClient.anchors(activeSourceId),
        entityClient.notes(activeSourceId),
        entityClient.patches(activeSourceId)
      ]);
      setAnchors(anchorsResponse.anchors);
      setNotes(notesResponse.notes);
      setPatches(patchesResponse.patches);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh");
    }
  }

  async function importFromUrl() {
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
  }

  async function openLiveUrl() {
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
  }

  async function openLocalFile(filePath: string) {
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
  }

  async function openFileDialog() {
    const filePath = await window.studyVault?.openFile?.();
    if (filePath) await openLocalFile(filePath);
  }

  async function openFolderDialog() {
    const dir = await window.studyVault?.pickDirectory?.();
    if (dir) setFolderRoot(dir);
  }

  async function deleteSourceItem(sourceId: string, title: string) {
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
      if (activeSourceId === sourceId) {
        setActiveSourceId("");
        setRenderedHtml("");
        setNotes([]);
        setAnchors([]);
        setPatches([]);
      }
      await loadSources();
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete source");
      setStatus("error");
    }
  }

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
  function buildChatContext(): ChatContext {
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
  }

  // Assemble the shared CommandContext. Commands collaborate through focus, the
  // entity client, and these action callbacks — never by touching node internals.
  function commandContext(payload: CommandContext["payload"]): CommandContext {
    return {
      focus,
      client: entityClient,
      sourceId: activeSourceId || undefined,
      payload,
      chatMessages,
      chatContext: buildChatContext(),
      actions: {
        onNoteCreated: () => void refreshAnnotations(),
        onPatchCreated: () => void refreshAnnotations(),
        onChatHistory: (history) => setChatMessages(history),
        onAssistantMessage: (message) => setChatMessages((items) => [...items, message])
      }
    };
  }

  async function dispatch(commandId: string, payload: CommandContext["payload"]) {
    setStatus("saving");
    setError("");
    try {
      await runCommand(commandId, commandContext(payload));
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Command failed");
      setStatus("error");
    }
  }

  // The user's current text selection within a reply, or the full reply if they
  // haven't highlighted anything — lets them keep just the useful part.
  function selectedTextOr(fullContent: string): string {
    const selected = typeof window !== "undefined" ? window.getSelection()?.toString().trim() : "";
    return selected || fullContent;
  }

  async function changePatchStatus(patch: PatchRecord, nextStatus: "applied" | "reverted" | "rejected") {
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
  }

  // Whether the composer's primary action is available, via the command itself.
  const composerCommandId = composerMode === "ask" ? "anchor.ask-ai" : "anchor.add-note";
  const composerCtx = commandContext({ text: chatInput, contentType: noteContentType });
  const composerDisabled = !getCommand(composerCommandId)?.isAvailable(composerCtx);

  function submitComposer() {
    if (composerDisabled) return;
    const text = chatInput;
    setChatInput("");
    void dispatch(composerCommandId, { text, contentType: noteContentType });
  }

  // The chip / patch text uses the focused passage's quote — empty for region
  // drafts (a region has no text, but the chip still shows a "Region selected" hint
  // below so the user knows there IS a focus).
  const draftQuote = draftQuoteText(focus.draft) || focus.anchor?.quote || "";
  const hasRegionDraft = focus.draft?.mode === "region";

  return (
    <div className="app-shell">
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
            Adding a viewer = mapping its surface here; no capture/paint logic lives
            in this host. */}
        {activeSource && activeViewer.kind === "webview" ? (
          <WebviewReader
            url={(activeSource.metadata?.sourceUrl as string) ?? ""}
            sourceId={activeSource.id}
            anchors={paintAnchors}
            onSelect={focus.setDraft}
          />
        ) : activeSource && activeViewer.kind === "pdfjs" ? (
          <PdfReader
            fileUrl={`/api/sources/${activeSource.id}/file`}
            sourceId={activeSource.id}
            anchors={paintAnchors}
            onSelect={focus.setDraft}
          />
        ) : activeSource && activeViewer.kind === "image" ? (
          <ImageReader
            src={`/api/sources/${activeSource.id}/file`}
            sourceId={activeSource.id}
            anchors={paintAnchors}
            onSelect={focus.setDraft}
          />
        ) : activeSource && activeViewer.kind === "file" ? (
          <iframe className="pdf-reader" title="PDF reader" src={`/api/sources/${activeSource.id}/file`} />
        ) : activeSource && activeViewer.kind === "html" && activeSource.metadata?.originalPath ? (
          <LocalHtmlReader
            src={localFileUrl(activeSource.metadata.originalPath as string)}
            sourceId={activeSource.id}
            anchors={paintAnchors}
            onSelect={focus.setDraft}
          />
        ) : activeSource && activeViewer.htmlPipeline && renderedHtml ? (
          <DomReader
            srcDoc={renderedHtml}
            sourceId={activeSource.id}
            anchors={paintAnchors}
            onSelect={focus.setDraft}
          />
        ) : (
          <div className="empty-reader">Select a source to start.</div>
        )}
      </main>

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
    </div>
  );
}
