// EntityClient — the single typed seam between the client UI and the HTTP API.
// All data access (sources, anchors, notes, patches, concepts, relations,
// assets, workspace) goes through here, so workspace nodes never call `fetch`
// directly and the API shape lives in one place.

export type SourceRecord = {
  id: string;
  title: string;
  sourceType: string;
  path: string;
  contentHash: string;
  metadata?: Record<string, unknown>;
};

export type HtmlAnchor = {
  id: string;
  sourceId: string;
  anchorKind: "html_selection";
  studyId: string;
  selector: string;
  quote: string;
  contextBefore?: string;
  contextAfter?: string;
};

export type WebAnchor = {
  id: string;
  sourceId: string;
  anchorKind: "web_text_quote";
  normalizedUrl: string;
  quote: string;
  contextBefore: string;
  contextAfter: string;
};

export type PdfAnchor = {
  id: string;
  sourceId: string;
  anchorKind: "pdf_selection";
  page: number;
  quote: string;
  contextBefore: string;
  contextAfter: string;
  // Normalized [x, y, w, h] (0..1) region hint; present for region selections.
  rect?: [number, number, number, number];
};

export type ImageAnchor = {
  id: string;
  sourceId: string;
  anchorKind: "image_region";
  rect: [number, number, number, number];
  quote: string;
};

export type AnyAnchor = HtmlAnchor | WebAnchor | PdfAnchor | ImageAnchor;

export type NoteRecord = {
  id: string;
  sourceId?: string;
  anchorIds: string[];
  conceptIds: string[];
  contentType: string;
  content: unknown;
  visibility: string;
};

export type PatchRecord = {
  id: string;
  sourceId: string;
  anchorId: string;
  action: string;
  status: "pending" | "accepted" | "rejected" | "applied" | "reverted" | "conflict";
  oldText: string;
  newContent: string;
  summary?: string;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ConceptRecord = {
  id: string;
  name: string;
  aliases: string[];
  description: string;
  tags: string[];
  confidence?: number;
};

export type NodeRef =
  | { type: "source"; id: string }
  | { type: "anchor"; id: string }
  | { type: "note"; id: string }
  | { type: "patch"; id: string }
  | { type: "concept"; id: string };

export type RelationRecord = {
  id: string;
  from: NodeRef;
  to: NodeRef;
  relationKind: string;
  label?: string;
  confidence?: number;
};

// —— Study Layers (share / import anchor+note) ——
export type StudyLayerRecord = {
  id: string;
  title: string;
  description?: string;
  author?: { id?: string; name?: string };
  visibility: string;
  importMode: "owned" | "imported" | "subscribed";
  enabled: boolean;
  localSourceId?: string;
  origin?: { packId?: string; importedAt?: string; sourceLayerId?: string };
};

// A `.studypack` — only portable fields travel; the importer rebuilds local
// realizations. Kept loose on the client (the server owns the strict zod schema).
export type StudyPack = {
  packId: string;
  createdAt: string;
  app?: string;
  sourceFingerprint: Record<string, unknown>;
  layer: { title: string; description?: string; author?: { id?: string; name?: string }; visibility?: string };
  anchors: unknown[];
  notes: unknown[];
};

export type MatchStatus = "matched" | "fuzzy" | "unmatched";

export type ImportPreview = {
  matchedSourceId: string | null;
  matchedBy: string | null;
  anchors: Array<{ refId: string; anchorKind: string; status: MatchStatus }>;
  stats: { matched: number; fuzzy: number; unmatched: number };
};

export type ImportCommitResult = {
  layerId: string;
  sourceId: string | null;
  createdAnchors: number;
  importedNotes: number;
  stats: { matched: number; fuzzy: number; unmatched: number };
};

export type AssetRecord = {
  id: string;
  assetType: "image" | "audio" | "video" | "file";
  fileName: string;
  mimeType: string;
  byteSize: number;
  path: string;
  contentHash: string;
  originalPath?: string;
  durationSec?: number;
};

export type WorkspaceNode = {
  id: string;
  kind: string;
  params?: Record<string, unknown>;
};

export type WorkspaceLayout = {
  id: string;
  name: string;
  mode: "dock" | "canvas";
  nodes: WorkspaceNode[];
  layout: unknown;
};

export type WorkspaceState = {
  activeLayoutId: string;
  layouts: WorkspaceLayout[];
};

export type ChatContext = {
  sourceTitle?: string;
  sourceType?: string;
  location?: string;
  quote?: string;
  contextBefore?: string;
  contextAfter?: string;
};

export type CreateAnchorInput = {
  sourceId: string;
  anchorKind?: "html_selection" | "web_text_quote" | "pdf_selection" | "image_region";
  studyId?: string;
  selector?: string;
  normalizedUrl?: string;
  page?: number;
  // Region selections (pdf figure / image area) carry a normalized rect and may
  // have an empty quote.
  rect?: [number, number, number, number];
  quote?: string;
  contextBefore?: string;
  contextAfter?: string;
};

export type CreateNoteInput = {
  sourceId?: string;
  anchorIds?: string[];
  conceptIds?: string[];
  content: unknown;
  contentType?: string;
};

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `Request failed: ${url}`);
  return body as T;
}

async function sendJson<T>(method: string, url: string, input: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `Request failed: ${url}`);
  return body as T;
}

export const entityClient = {
  // —— Sources ——
  sources() {
    return getJson<{ sources: SourceRecord[] }>("/api/sources");
  },
  ingestUrl(url: string) {
    return sendJson<{ source: SourceRecord }>("POST", "/api/sources/url", { url });
  },
  ingestWebLive(url: string) {
    return sendJson<{ source: SourceRecord }>("POST", "/api/sources/web-live", { url });
  },
  ingestLocalFile(filePath: string) {
    return sendJson<{ source: SourceRecord }>("POST", "/api/sources/local-file", { path: filePath });
  },
  deleteSource(sourceId: string) {
    return sendJson<{ ok: true }>("DELETE", `/api/sources/${sourceId}`, undefined);
  },
  /** Merge-patch a source's metadata (e.g. activeKitIds for per-source kit activation). */
  updateSourceMetadata(sourceId: string, metadata: Record<string, unknown>) {
    return sendJson<{ source: SourceRecord }>("PATCH", `/api/sources/${sourceId}`, { metadata });
  },
  rendered(sourceId: string) {
    return getJson<{ source: SourceRecord; content: string }>(`/api/sources/${sourceId}/rendered`);
  },

  // —— Anchors ——
  anchors(sourceId: string) {
    return getJson<{ anchors: AnyAnchor[] }>(`/api/sources/${sourceId}/anchors`);
  },
  createAnchor(input: CreateAnchorInput) {
    return sendJson<{ anchor: AnyAnchor }>("POST", "/api/anchors", input);
  },

  // —— Notes ——
  notes(sourceId: string) {
    return getJson<{ notes: NoteRecord[] }>(`/api/sources/${sourceId}/notes`);
  },
  /** All notes (no filter) — the entity-oriented endpoint with no query. */
  allNotes() {
    return getJson<{ notes: NoteRecord[] }>("/api/notes");
  },
  notesByConcept(conceptId: string) {
    return getJson<{ notes: NoteRecord[] }>(`/api/notes?conceptId=${encodeURIComponent(conceptId)}`);
  },
  notesByAnchor(anchorId: string) {
    return getJson<{ notes: NoteRecord[] }>(`/api/notes?anchorId=${encodeURIComponent(anchorId)}`);
  },
  createNote(input: CreateNoteInput) {
    return sendJson<{ note: NoteRecord }>("POST", "/api/notes", input);
  },
  /** Patch a note's attachments (concept/anchor links) after creation. */
  updateNote(noteId: string, input: { conceptIds?: string[]; anchorIds?: string[] }) {
    return sendJson<{ note: NoteRecord }>("PATCH", `/api/notes/${noteId}`, input);
  },

  // —— Patches ——
  patches(sourceId: string) {
    return getJson<{ patches: PatchRecord[] }>(`/api/sources/${sourceId}/patches`);
  },
  createPatch(input: { sourceId: string; anchorId: string; oldText: string; newContent: string }) {
    return sendJson<{ patch: PatchRecord }>("POST", "/api/patches", {
      ...input,
      action: "replace_selection"
    });
  },
  updatePatch(patchId: string, status: "applied" | "reverted" | "rejected") {
    return sendJson<{ patch: PatchRecord }>("PATCH", `/api/patches/${patchId}`, { status });
  },

  // —— Concepts ——
  concepts() {
    return getJson<{ concepts: ConceptRecord[] }>("/api/concepts");
  },
  createConcept(input: { name: string; aliases?: string[]; description?: string; tags?: string[] }) {
    return sendJson<{ concept: ConceptRecord }>("POST", "/api/concepts", input);
  },
  conceptDetail(conceptId: string) {
    return getJson<{ concept: ConceptRecord; notes: NoteRecord[]; relations: RelationRecord[] }>(
      `/api/concepts/${conceptId}`
    );
  },

  // —— Relations ——
  relations() {
    return getJson<{ relations: RelationRecord[] }>("/api/relations");
  },
  createRelation(input: { from: NodeRef; to: NodeRef; relationKind: string; label?: string }) {
    return sendJson<{ relation: RelationRecord }>("POST", "/api/relations", input);
  },
  deleteRelation(relationId: string) {
    return sendJson<{ ok: true }>("DELETE", `/api/relations/${relationId}`, undefined);
  },

  // —— Study Layers ——
  /** Layers over a source (owned + imported), for the layer switcher. */
  layers(sourceId: string) {
    return getJson<{ layers: StudyLayerRecord[] }>(`/api/sources/${sourceId}/layers`);
  },
  /** Toggle a layer on/off (enabled) or rename it. */
  patchLayer(layerId: string, input: { enabled?: boolean; title?: string }) {
    return sendJson<{ layer: StudyLayerRecord }>("PATCH", `/api/layers/${layerId}`, input);
  },
  /** Build a portable `.studypack` for a layer (local realizations stripped). */
  exportLayer(layerId: string) {
    return sendJson<{ pack: StudyPack }>("POST", `/api/layers/${layerId}/export`, {});
  },
  /** Dry-run an import: match the pack to a local source + rematch every anchor. */
  importPreview(pack: StudyPack) {
    return sendJson<{ preview: ImportPreview }>("POST", "/api/layers/import/preview", { pack });
  },
  /** Commit an import: create an imported layer + re-located anchors + notes. */
  importCommit(pack: StudyPack, targetSourceId?: string) {
    return sendJson<{ result: ImportCommitResult }>("POST", "/api/layers/import/commit", { pack, targetSourceId });
  },

  // —— Assets ——
  importAsset(filePath: string) {
    return sendJson<{ asset: AssetRecord }>("POST", "/api/assets/local-file", { path: filePath });
  },
  assetMeta(assetId: string) {
    return getJson<{ asset: AssetRecord }>(`/api/assets/${assetId}/meta`);
  },
  /** URL for the raw asset bytes (use directly as an <img>/<audio>/<video> src). */
  assetUrl(assetId: string) {
    return `/api/assets/${assetId}`;
  },

  // —— Chat ——
  chat(input: { messages: ChatMessage[]; context?: ChatContext }) {
    return sendJson<{ message: ChatMessage; provider: string }>("POST", "/api/chat", input);
  },
  // Streaming chat over SSE. Invokes `onDelta` for each incremental chunk and
  // resolves with the full assistant message + provider once the `done` event
  // arrives. Falls back to the non-streaming `chat()` when the stream endpoint
  // is unavailable (no body / non-OK response).
  async chatStream(
    input: { messages: ChatMessage[]; context?: ChatContext },
    onDelta: (delta: string) => void
  ): Promise<{ message: ChatMessage; provider: string }> {
    const response = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    });
    if (!response.ok || !response.body) {
      // 400 (validation) surfaces an error; otherwise degrade to non-streaming.
      if (response.status === 400) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "Request failed: /api/chat/stream");
      }
      return this.chat(input);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result: { message: ChatMessage; provider: string } | null = null;
    let streamError: string | null = null;

    const handleEvent = (block: string) => {
      let event = "message";
      const dataLines: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length === 0) return;
      const payload = JSON.parse(dataLines.join("\n"));
      if (event === "chunk") onDelta(payload.delta as string);
      else if (event === "done") result = payload as { message: ChatMessage; provider: string };
      else if (event === "error") streamError = (payload.error as string) ?? "stream failed";
    };

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep = buffer.indexOf("\n\n");
      while (sep >= 0) {
        handleEvent(buffer.slice(0, sep));
        buffer = buffer.slice(sep + 2);
        sep = buffer.indexOf("\n\n");
      }
    }
    if (buffer.trim()) handleEvent(buffer);

    if (streamError) throw new Error(streamError);
    if (!result) throw new Error("Stream ended without a result");
    return result;
  },

  // —— Kit AI (structured generation) ——
  // Generate validated structured note content for a Product Kit command (e.g. a
  // textbook explanation/exercise). Server picks the prompt + validates against the
  // contentType's schema; returns the parsed content object.
  generateStructured(input: { promptId: string; contentType: string; input?: Record<string, unknown> }) {
    return sendJson<{ content: unknown; provider: string }>("POST", "/api/kits/generate", input);
  },

  // —— Workspace ——
  workspace() {
    return getJson<{ workspace: WorkspaceState }>("/api/workspace");
  },
  saveWorkspace(state: WorkspaceState) {
    return sendJson<{ workspace: WorkspaceState }>("PUT", "/api/workspace", state);
  }
};

export type EntityClient = typeof entityClient;
