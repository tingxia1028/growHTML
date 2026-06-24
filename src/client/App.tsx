import { useEffect, useMemo, useRef, useState } from "react";
import {
  FilePlus2,
  ListRestart,
  NotebookPen,
  RefreshCcw,
  RotateCcw,
  Send,
  Sparkles,
  TerminalSquare
} from "lucide-react";
import { renderNoteContent } from "../adapters/notes/render";
import { isDiagramType } from "../adapters/notes/diagrams";
import { DiagramNote } from "./DiagramNote";
import { getSourceViewer } from "./viewers";
import { decorateAnnotations, getHtmlAnnotationMode, setHtmlAnnotationMode, type HtmlAnnotationMode } from "./annotations";
import { WebviewReader, type WebSelection } from "./WebviewReader";
import { PdfReader, type PdfSelection } from "./PdfReader";
import { ImageReader } from "./ImageReader";
import type { NormRect } from "./regionSelect";
import { TerminalPanel } from "./TerminalPanel";

const NOTE_CONTENT_TYPES = ["markdown", "mindmap", "flashcard", "mermaid", "markmap"] as const;

type SourceRecord = {
  id: string;
  title: string;
  sourceType: string;
  path: string;
  contentHash: string;
  metadata?: Record<string, unknown>;
};

type HtmlAnchor = {
  id: string;
  sourceId: string;
  anchorKind: "html_selection";
  studyId: string;
  selector: string;
  quote: string;
};

type WebAnchor = {
  id: string;
  sourceId: string;
  anchorKind: "web_text_quote";
  normalizedUrl: string;
  quote: string;
  contextBefore: string;
  contextAfter: string;
};

type PdfAnchor = {
  id: string;
  sourceId: string;
  anchorKind: "pdf_selection";
  page: number;
  quote: string;
  contextBefore: string;
  contextAfter: string;
  rect?: [number, number, number, number];
};

type ImageAnchor = {
  id: string;
  sourceId: string;
  anchorKind: "image_region";
  rect: [number, number, number, number];
  quote: string;
  contextBefore: string;
  contextAfter: string;
};

type AnyAnchor = HtmlAnchor | WebAnchor | PdfAnchor | ImageAnchor;

type NoteRecord = {
  id: string;
  sourceId: string;
  anchorId?: string;
  noteKind: string;
  contentType?: string;
  title?: string;
  content: string;
  visibility: string;
};

type PatchRecord = {
  id: string;
  sourceId: string;
  anchorId: string;
  action: string;
  status: "pending" | "accepted" | "rejected" | "applied" | "reverted" | "conflict";
  oldText: string;
  newContent: string;
  summary?: string;
};

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type SelectionDraft = {
  text: string;
  studyId: string;
  selector: string;
  kind?: "html" | "web" | "pdf" | "image";
  prefix?: string;
  suffix?: string;
  page?: number;
  // For web selections: the URL of the tab/page the selection was made on.
  url?: string;
  // For geometric selections (image regions, PDF figures): normalized rect.
  rect?: [number, number, number, number];
};

type Status = "idle" | "loading" | "saving" | "error";

const boundSelectionDocuments = new WeakSet<Document>();

const demoHtml = `<article data-study-id="manual-demo-root">
  <section data-study-id="manual-demo-section">
    <h1 data-study-id="manual-demo-title">Manual Import Demo</h1>
    <p data-study-id="manual-demo-p">Select this paragraph to create a study anchor, note, and patch.</p>
  </section>
</article>`;


const api = {
  async sources() {
    return getJson<{ sources: SourceRecord[] }>("/api/sources");
  },
  async ingestHtml(input: { title: string; content: string }) {
    return postJson<{ source: SourceRecord }>("/api/sources/html", input);
  },
  async ingestUrl(url: string) {
    return postJson<{ source: SourceRecord }>("/api/sources/url", { url });
  },
  async ingestPdf(input: { title: string; dataBase64: string; originalPath?: string }) {
    return postJson<{ source: SourceRecord }>("/api/sources/pdf", input);
  },
  async ingestImage(input: { title: string; dataBase64: string; mimeType: string; originalPath?: string }) {
    return postJson<{ source: SourceRecord }>("/api/sources/image", input);
  },
  async rendered(sourceId: string) {
    return getJson<{ source: SourceRecord; content: string }>(`/api/sources/${sourceId}/rendered`);
  },
  async anchors(sourceId: string) {
    return getJson<{ anchors: AnyAnchor[] }>(`/api/sources/${sourceId}/anchors`);
  },
  async ingestWebLive(url: string) {
    return postJson<{ source: SourceRecord }>("/api/sources/web-live", { url });
  },
  async notes(sourceId: string) {
    return getJson<{ notes: NoteRecord[] }>(`/api/sources/${sourceId}/notes`);
  },
  async patches(sourceId: string) {
    return getJson<{ patches: PatchRecord[] }>(`/api/sources/${sourceId}/patches`);
  },
  async createAnchor(input: {
    sourceId: string;
    anchorKind?: "html_selection" | "web_text_quote" | "pdf_selection" | "image_region";
    studyId?: string;
    selector?: string;
    normalizedUrl?: string;
    page?: number;
    rect?: [number, number, number, number];
    quote: string;
    contextBefore?: string;
    contextAfter?: string;
  }) {
    return postJson<{ anchor: AnyAnchor }>("/api/anchors", input);
  },
  async createNote(input: { sourceId: string; anchorId?: string; content: string; contentType: string }) {
    return postJson<{ note: NoteRecord }>("/api/notes", {
      ...input,
      noteKind: "annotation"
    });
  },
  async chat(input: {
    messages: ChatMessage[];
    context?: {
      sourceTitle?: string;
      sourceType?: string;
      location?: string;
      quote?: string;
      contextBefore?: string;
      contextAfter?: string;
    };
  }) {
    return postJson<{ message: ChatMessage; provider: string }>("/api/chat", input);
  },
  async createPatch(input: {
    sourceId: string;
    anchorId: string;
    oldText: string;
    newContent: string;
  }) {
    return postJson<{ patch: PatchRecord }>("/api/patches", {
      ...input,
      action: "replace_selection"
    });
  },
  async updatePatch(patchId: string, status: "applied" | "reverted" | "rejected") {
    return patchJson<{ patch: PatchRecord }>(`/api/patches/${patchId}`, { status });
  }
};

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `Request failed: ${url}`);
  return body as T;
}

async function postJson<T>(url: string, input: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `Request failed: ${url}`);
  return body as T;
}

async function patchJson<T>(url: string, input: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `Request failed: ${url}`);
  return body as T;
}

// Return the parent directory of an absolute file path (Windows or POSIX).
// Empty input → empty string (the terminal then uses the app's default cwd).
function parentDir(filePath: string): string {
  const normalized = filePath.replace(/[\\/]+$/, "");
  const cut = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return cut > 0 ? normalized.slice(0, cut) : "";
}

export default function App() {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [activeSourceId, setActiveSourceId] = useState("");
  const [renderedHtml, setRenderedHtml] = useState("");
  const [selection, setSelection] = useState<SelectionDraft | null>(null);
  const [anchor, setAnchor] = useState<AnyAnchor | null>(null);
  const [anchors, setAnchors] = useState<AnyAnchor[]>([]);
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [patches, setPatches] = useState<PatchRecord[]>([]);
  const [noteContentType, setNoteContentType] = useState<string>("markdown");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [showTerminal, setShowTerminal] = useState(false);
  const [annotMode, setAnnotMode] = useState<HtmlAnnotationMode>(getHtmlAnnotationMode());
  const [patchHtml, setPatchHtml] = useState("");
  const [importTitle, setImportTitle] = useState("Manual Import Demo");
  const [importHtml, setImportHtml] = useState(demoHtml);
  const [importUrl, setImportUrl] = useState("");

  const activeSource = sources.find((source) => source.id === activeSourceId) ?? null;
  const activeViewer = getSourceViewer(activeSource?.sourceType);
  const selectedAnchorId = anchor?.id ?? "";
  // When the active source is a local file we know the disk path of, default the
  // AI terminal to that file's folder; otherwise let it use the app's cwd.
  const activeFileDir = parentDir((activeSource?.metadata?.originalPath as string | undefined) ?? "");
  // Note text per anchor, so the webview guest and PDF reader can show the same
  // floating note card the HTML reader does.
  const noteTextByAnchorId = useMemo(() => {
    const map = new Map<string, string>();
    for (const note of notes) {
      if (!note.anchorId) continue;
      const existing = map.get(note.anchorId);
      // Joined as markdown (blank line between notes); the card renders it.
      map.set(note.anchorId, (existing ? `${existing}\n\n` : "") + note.content);
    }
    return map;
  }, [notes]);
  const webAnchors = useMemo(
    () =>
      anchors
        .filter((item): item is WebAnchor => item.anchorKind === "web_text_quote")
        .map((item) => ({
          id: item.id,
          quote: item.quote,
          contextBefore: item.contextBefore,
          contextAfter: item.contextAfter,
          note: noteTextByAnchorId.get(item.id) ?? ""
        })),
    [anchors, noteTextByAnchorId]
  );
  const pdfAnchors = useMemo(
    () =>
      anchors
        .filter((item): item is PdfAnchor => item.anchorKind === "pdf_selection")
        .map((item) => ({
          id: item.id,
          page: item.page,
          quote: item.quote,
          rect: item.rect,
          note: noteTextByAnchorId.get(item.id) ?? ""
        })),
    [anchors, noteTextByAnchorId]
  );
  const imageAnchors = useMemo(
    () =>
      anchors
        .filter((item): item is ImageAnchor => item.anchorKind === "image_region")
        .map((item) => ({ id: item.id, rect: item.rect, note: noteTextByAnchorId.get(item.id) ?? "" })),
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

  // Re-paint note annotations onto the reader whenever notes/anchors change
  // (the iframe is already loaded; on a fresh load bindReaderFrame paints too).
  useEffect(() => {
    const doc = frameRef.current?.contentDocument;
    if (doc) decorateNotes(doc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, anchors, renderedHtml, annotMode]);

  // Switch the HTML reader's note presentation (floating card ↔ side gutter).
  function toggleAnnotMode() {
    const next: HtmlAnnotationMode = annotMode === "margin" ? "floating" : "margin";
    setHtmlAnnotationMode(next);
    setAnnotMode(next);
  }

  async function loadSources() {
    setStatus("loading");
    setError("");
    try {
      const response = await api.sources();
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
      const viewer = getSourceViewer(sources.find((item) => item.id === sourceId)?.sourceType);
      const [rendered, anchorsResponse, notesResponse, patchesResponse] = await Promise.all([
        viewer.htmlPipeline ? api.rendered(sourceId) : Promise.resolve(null),
        api.anchors(sourceId),
        api.notes(sourceId),
        api.patches(sourceId)
      ]);
      setRenderedHtml(rendered?.content ?? "");
      setAnchors(anchorsResponse.anchors);
      setNotes(notesResponse.notes);
      setPatches(patchesResponse.patches);
      setSelection(null);
      setAnchor(null);
      setPatchHtml("");
      setChatMessages([]);
      setChatInput("");
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load source");
      setStatus("error");
    }
  }

  async function importSource() {
    setStatus("saving");
    setError("");
    try {
      const response = await api.ingestHtml({ title: importTitle, content: importHtml });
      await loadSources();
      setActiveSourceId(response.source.id);
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import source");
      setStatus("error");
    }
  }

  async function importPdf(file: File) {
    setStatus("saving");
    setError("");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
      // Desktop only: capture the file's disk path so the terminal can default to
      // its folder. Browsers don't expose it, so this is simply omitted there.
      const originalPath = window.studyVault?.getPathForFile?.(file) || undefined;
      const response = await api.ingestPdf({
        title: file.name.replace(/\.pdf$/i, "") || file.name,
        dataBase64: btoa(binary),
        originalPath
      });
      await loadSources();
      setActiveSourceId(response.source.id);
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import PDF");
      setStatus("error");
    }
  }

  async function importImage(file: File) {
    setStatus("saving");
    setError("");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
      const originalPath = window.studyVault?.getPathForFile?.(file) || undefined;
      const response = await api.ingestImage({
        title: file.name.replace(/\.[^.]+$/, "") || file.name,
        dataBase64: btoa(binary),
        mimeType: file.type || "image/png",
        originalPath
      });
      await loadSources();
      setActiveSourceId(response.source.id);
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import image");
      setStatus("error");
    }
  }

  async function importFromUrl() {
    if (!importUrl.trim()) return;
    setStatus("saving");
    setError("");
    try {
      const response = await api.ingestUrl(importUrl.trim());
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
      const response = await api.ingestWebLive(importUrl.trim());
      await loadSources();
      setActiveSourceId(response.source.id);
      setImportUrl("");
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open live URL");
      setStatus("error");
    }
  }

  // Paint stored notes onto the reader document via the AnnotationRenderer
  // registry (src/client/annotations.ts) — the pluggable seam where different
  // sources / anchor kinds (or third-party extensions) register how annotations
  // are drawn. Idempotent (each renderer clears + repaints).
  function decorateNotes(doc: Document) {
    decorateAnnotations(doc, { anchors, notes });
  }

  function bindReaderFrame() {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    decorateNotes(doc);
    if (boundSelectionDocuments.has(doc)) return;

    const readSelection = (event?: Event) => {
      const selected = doc.getSelection();
      const text = selected?.toString().trim() ?? "";
      const frameNode = doc.defaultView?.Node ?? Node;
      const frameElement = doc.defaultView?.Element ?? Element;
      const selectedElement =
        selected && text && selected.rangeCount > 0
          ? (() => {
              const node = selected.getRangeAt(0).commonAncestorContainer;
              return node.nodeType === frameNode.ELEMENT_NODE ? (node as Element) : node.parentElement;
            })()
          : null;
      const eventElement = event?.target instanceof frameElement ? event.target : null;
      const element = selectedElement ?? eventElement;
      const target = element?.closest("[data-study-id]");
      const studyId = target?.getAttribute("data-study-id");
      if (!target || !studyId) return;

      const quote = text || target.textContent?.trim() || "";
      if (!quote) return;

      // Capture surrounding context so the anchor can be re-found by text (W3C
      // TextQuoteSelector) if the study-id is later lost to an edit/re-import.
      const docText = (doc.body?.textContent ?? "").replace(/\s+/g, " ");
      const normalizedQuote = quote.replace(/\s+/g, " ");
      const at = docText.indexOf(normalizedQuote);
      const prefix = at >= 0 ? docText.slice(Math.max(0, at - 32), at) : "";
      const suffix = at >= 0 ? docText.slice(at + normalizedQuote.length, at + normalizedQuote.length + 32) : "";

      const nextSelection = {
        text: quote,
        studyId,
        selector: `[data-study-id="${studyId.replace(/"/g, '\\"')}"]`,
        kind: "html" as const,
        prefix,
        suffix
      };
      setSelection(nextSelection);
      setAnchor(null);
      setPatchHtml(`<p data-study-id="${studyId}">${quote}</p>`);
    };

    boundSelectionDocuments.add(doc);
    doc.addEventListener("selectionchange", readSelection);
    doc.addEventListener("mouseup", readSelection);
    doc.addEventListener("click", readSelection);
    doc.addEventListener("keyup", readSelection);
  }

  // Anchors are created lazily from the current selection the first time one is
  // needed (saving a note/patch, or saving an AI reply) — there's no manual
  // "Create Anchor" step. Returns the existing or newly-created anchor, or null.
  async function ensureAnchor(): Promise<AnyAnchor | null> {
    if (anchor) return anchor;
    if (!activeSource || !selection) return null;
    setStatus("saving");
    setError("");
    try {
      let input;
      if (selection.kind === "web") {
        input = {
          sourceId: activeSource.id,
          anchorKind: "web_text_quote" as const,
          // The tab's current URL (multi-tab) falls back to the source's URL.
          normalizedUrl:
            selection.url ?? (activeSource.metadata?.normalizedUrl as string | undefined),
          quote: selection.text,
          contextBefore: selection.prefix ?? "",
          contextAfter: selection.suffix ?? ""
        };
      } else if (selection.kind === "pdf") {
        input = {
          sourceId: activeSource.id,
          anchorKind: "pdf_selection" as const,
          page: selection.page ?? 1,
          quote: selection.text,
          // Hybrid: keep the geometric rect alongside the text quote.
          rect: selection.rect,
          contextBefore: selection.prefix ?? "",
          contextAfter: selection.suffix ?? ""
        };
      } else if (selection.kind === "image") {
        if (!selection.rect) {
          setStatus("idle");
          return null;
        }
        input = {
          sourceId: activeSource.id,
          anchorKind: "image_region" as const,
          rect: selection.rect,
          // Geometric anchor: no text. The selection's label is UI-only.
          quote: "",
          contextBefore: "",
          contextAfter: ""
        };
      } else {
        input = {
          sourceId: activeSource.id,
          anchorKind: "html_selection" as const,
          studyId: selection.studyId,
          selector: selection.selector,
          quote: selection.text,
          // Stored so the note survives if the study-id is later lost to an edit.
          contextBefore: selection.prefix ?? "",
          contextAfter: selection.suffix ?? ""
        };
      }
      const response = await api.createAnchor(input);
      setAnchor(response.anchor);
      setAnchors((items) => [response.anchor, ...items.filter((item) => item.id !== response.anchor.id)]);
      setStatus("idle");
      return response.anchor;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create anchor");
      setStatus("error");
      return null;
    }
  }

  function captureWebSelection(webSelection: WebSelection, pageUrl: string) {
    if (!webSelection.exact?.trim()) return;
    setSelection({
      text: webSelection.exact,
      studyId: "",
      selector: "",
      kind: "web",
      prefix: webSelection.prefix,
      suffix: webSelection.suffix,
      url: pageUrl
    });
    setAnchor(null);
  }

  function capturePdfSelection(pdfSelection: PdfSelection) {
    if (!pdfSelection.exact?.trim()) return;
    setSelection({
      text: pdfSelection.exact,
      studyId: "",
      selector: "",
      kind: "pdf",
      prefix: pdfSelection.prefix,
      suffix: pdfSelection.suffix,
      page: pdfSelection.page,
      rect: pdfSelection.rect
    });
    setAnchor(null);
  }

  function captureImageRegion(rect: NormRect) {
    const pct = (n: number) => Math.round(n * 100);
    setSelection({
      text: `Image region @ ${pct(rect[0])}%,${pct(rect[1])}% (${pct(rect[2])}%×${pct(rect[3])}%)`,
      studyId: "",
      selector: "",
      kind: "image",
      rect
    });
    setAnchor(null);
  }

  async function saveNote() {
    if (!activeSource || !chatInput.trim()) return;
    const anchorRecord = await ensureAnchor();
    if (!anchorRecord) return;
    setStatus("saving");
    setError("");
    try {
      const response = await api.createNote({
        sourceId: activeSource.id,
        anchorId: anchorRecord.id,
        content: chatInput.trim(),
        contentType: noteContentType
      });
      setNotes((items) => [response.note, ...items]);
      setChatInput("");
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save note");
      setStatus("error");
    }
  }

  async function savePatch() {
    if (!activeSource || !selection || !patchHtml.trim()) return;
    const anchorRecord = await ensureAnchor();
    if (!anchorRecord) return;
    setStatus("saving");
    setError("");
    try {
      const response = await api.createPatch({
        sourceId: activeSource.id,
        anchorId: anchorRecord.id,
        oldText: selection.text,
        newContent: patchHtml.trim()
      });
      setPatches((items) => [response.patch, ...items]);
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save patch");
      setStatus("error");
    }
  }

  // Where the active source lives (URL / file path / page) so the assistant knows
  // exactly which source + passage a question is about.
  function buildChatContext() {
    const meta = (activeSource?.metadata ?? {}) as Record<string, unknown>;
    const url = (meta.sourceUrl ?? meta.normalizedUrl) as string | undefined;
    const filePath = meta.originalPath as string | undefined;
    const anchorLike = anchor as { contextBefore?: string; contextAfter?: string; page?: number } | null;
    const page = selection?.page ?? anchorLike?.page;
    const locationParts: string[] = [];
    if (url) locationParts.push(url);
    else if (filePath) locationParts.push(filePath);
    else if (activeSource?.path) locationParts.push(activeSource.path);
    if (page) locationParts.push(`page ${page}`);
    return {
      sourceTitle: activeSource?.title,
      sourceType: activeSource?.sourceType,
      location: locationParts.join(" · ") || undefined,
      quote: selection?.text ?? anchor?.quote,
      contextBefore: selection?.prefix ?? anchorLike?.contextBefore,
      contextAfter: selection?.suffix ?? anchorLike?.contextAfter
    };
  }

  async function sendChat() {
    if (!chatInput.trim()) return;
    const history: ChatMessage[] = [...chatMessages, { role: "user", content: chatInput.trim() }];
    setChatMessages(history);
    setChatInput("");
    setStatus("saving");
    setError("");
    try {
      const response = await api.chat({
        messages: history,
        context: buildChatContext()
      });
      setChatMessages((items) => [...items, response.message]);
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chat failed");
      setStatus("error");
    }
  }

  // The user's current text selection within a reply, or the full reply if they
  // haven't highlighted anything — lets them keep just the useful part.
  function selectedTextOr(fullContent: string): string {
    const selected = typeof window !== "undefined" ? window.getSelection()?.toString().trim() : "";
    return selected || fullContent;
  }

  async function saveAiNote(content: string) {
    if (!activeSource) return;
    // Anchor to the current selection if there is one (else save unanchored).
    const anchorRecord = anchor ?? (selection ? await ensureAnchor() : null);
    setStatus("saving");
    setError("");
    try {
      const response = await api.createNote({
        sourceId: activeSource.id,
        anchorId: anchorRecord?.id,
        content,
        contentType: "markdown"
      });
      setNotes((items) => [response.note, ...items]);
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save AI note");
      setStatus("error");
    }
  }

  async function changePatchStatus(patch: PatchRecord, nextStatus: "applied" | "reverted" | "rejected") {
    if (!activeSource) return;
    setStatus("saving");
    setError("");
    try {
      await api.updatePatch(patch.id, nextStatus);
      await loadSourceWorkspace(activeSource.id);
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update patch");
      setStatus("error");
    }
  }

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

        <div className="source-list">
          {sources.map((source) => (
            <button
              key={source.id}
              className={`source-item${source.id === activeSourceId ? " active" : ""}`}
              type="button"
              onClick={() => setActiveSourceId(source.id)}
            >
              <span>{source.title}</span>
              <small>{source.sourceType} · {source.id}</small>
            </button>
          ))}
          {sources.length === 0 ? <div className="empty-state">No sources yet.</div> : null}
        </div>

        <section className="import-box">
          <div className="panel-title">
            <FilePlus2 size={16} />
            Import HTML
          </div>
          <input value={importTitle} onChange={(event) => setImportTitle(event.target.value)} />
          <textarea value={importHtml} onChange={(event) => setImportHtml(event.target.value)} />
          <button className="icon-button" type="button" onClick={() => void importSource()}>
            <FilePlus2 size={16} />
            Import
          </button>
        </section>

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

        <section className="pdf-import-box">
          <div className="panel-title">
            <FilePlus2 size={16} />
            Import PDF
          </div>
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importPdf(file);
              event.target.value = "";
            }}
          />
        </section>

        <section className="image-import-box">
          <div className="panel-title">
            <FilePlus2 size={16} />
            Import Image
          </div>
          <input
            type="file"
            accept="image/*"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importImage(file);
              event.target.value = "";
            }}
          />
        </section>
      </aside>

      <main className="reader-panel">
        <header className="reader-header">
          <div>
            <p>{activeSource?.sourceType ?? "source"}</p>
            <h2>{activeSource?.title ?? "Open or import a source"}</h2>
          </div>
          <div className="reader-header-actions">
            <button
              type="button"
              className="annot-mode-toggle"
              onClick={toggleAnnotMode}
              title="Toggle how notes are shown: a card on hover, or persistent cards in the side margin"
            >
              {annotMode === "margin" ? "Notes: Margin" : "Notes: Floating"}
            </button>
            <span className={`status-pill status-${status}`}>{status}</span>
          </div>
        </header>

        {error ? <div className="error-box">{error}</div> : null}

        {activeSource && activeViewer.kind === "webview" ? (
          <WebviewReader
            url={(activeSource.metadata?.sourceUrl as string) ?? ""}
            anchors={webAnchors}
            onSelection={captureWebSelection}
          />
        ) : activeSource && activeViewer.kind === "pdfjs" ? (
          <PdfReader
            fileUrl={`/api/sources/${activeSource.id}/file`}
            anchors={pdfAnchors}
            onSelection={capturePdfSelection}
          />
        ) : activeSource && activeViewer.kind === "image" ? (
          <ImageReader
            fileUrl={`/api/sources/${activeSource.id}/file`}
            anchors={imageAnchors}
            onRegion={captureImageRegion}
          />
        ) : activeSource && activeViewer.kind === "file" ? (
          <iframe className="pdf-reader" title="PDF reader" src={`/api/sources/${activeSource.id}/file`} />
        ) : activeViewer.htmlPipeline && renderedHtml ? (
          <iframe ref={frameRef} title="Source reader" srcDoc={renderedHtml} onLoad={bindReaderFrame} />
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
          {selection ? (
            <div className="chat-source">
              <span className="chat-source-label">Source</span>
              <span className="chat-source-quote">
                {selection.text.replace(/\s+/g, " ").slice(0, 90)}
                {selection.text.length > 90 ? "…" : ""}
              </span>
              <button
                type="button"
                className="chat-source-clear"
                aria-label="Clear source"
                onClick={() => {
                  setSelection(null);
                  setAnchor(null);
                }}
              >
                ×
              </button>
            </div>
          ) : (
            <div className="chat-source chat-source-empty">Select text in the reader to ask about a passage.</div>
          )}

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
                      onClick={() => void saveAiNote(selectedTextOr(message.content))}
                    >
                      Save selection as note
                    </button>
                    <button className="link-button" type="button" onClick={() => void saveAiNote(message.content)}>
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

          {/* One composer: Send it to the AI, or Save it as a note of the chosen type. */}
          <textarea
            className="composer-input"
            value={chatInput}
            placeholder="Ask the AI about this passage, or write a note…"
            onChange={(event) => setChatInput(event.target.value)}
          />
          <div className="composer-actions">
            <button className="icon-button" type="button" onClick={() => void sendChat()} disabled={!activeSource}>
              <Send size={16} />
              Send
            </button>
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
            <button
              className="icon-button"
              type="button"
              onClick={() => void saveNote()}
              disabled={!selection && !anchor}
            >
              <NotebookPen size={16} />
              Save Note
            </button>
          </div>

          {notes.length ? (
            <div className="record-list note-list">
              {notes.map((note) => {
                const contentType = note.contentType ?? "markdown";
                return (
                  <article key={note.id} className="record-card">
                    <strong>
                      {note.noteKind} · {contentType}
                    </strong>
                    {isDiagramType(contentType) ? (
                      <DiagramNote contentType={contentType} content={note.content} />
                    ) : (
                      <div
                        className="note-rendered"
                        dangerouslySetInnerHTML={{ __html: renderNoteContent(contentType, note.content).html }}
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
              onClick={() => void savePatch()}
              disabled={!selection && !anchor}
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
