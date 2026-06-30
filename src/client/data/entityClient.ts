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
  // Study Layer membership (multi). A note's lens(es); it is visible iff its
  // layerIds intersect the enabled layers (OR). Empty = "always visible" (the
  // server never orphans a note to invisibility).
  layerIds: string[];
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

// —— Operations (AI actions authored as DATA: a {{var}} template + declared
// variables, unified with the built-in code prompts at generate time) ——
export type OperationVariable = {
  name: string;
  label?: string;
  // WHERE the run command pulls the value from: the focused passage's text, the
  // source title, this source's existing note content, or a verbatim `default`.
  source: "anchorText" | "sourceTitle" | "existingNotes" | "literal";
  default?: string;
  required: boolean;
};

export type OperationRecord = {
  id: string;
  name: string;
  description: string;
  // A note contentType string (validated against the NoteContentSpec registry at
  // generate time, not here).
  outputContentType: string;
  promptTemplate: string;
  declaredVariables: OperationVariable[];
  source: "custom" | "fork";
  forkedFrom?: string;
  scope: "anchor" | "source";
};

// The editable body of an Operation (the envelope id/type/timestamps are server-set).
export type OperationInput = {
  name: string;
  description?: string;
  outputContentType: string;
  promptTemplate: string;
  declaredVariables?: OperationVariable[];
  source?: "custom" | "fork";
  forkedFrom?: string;
  scope?: "anchor" | "source";
};

// Workspace-level small prefs (mirrors workspace.json): the action ORDER + DISABLED
// set (built-in command ids + op_ ids) and per-built-in placeholder PARAMS the
// server merges into generate input before build().
export type OperationPrefs = {
  order: string[];
  disabled: string[];
  params: Record<string, Record<string, string>>;
  /** Per-surface override (R6.3): each surface key (inline/anchor/source/bottom) carries
      its own action `order` + `hidden` set; absent → that surface uses the global
      `order`/`disabled` above. Optional so pre-R6.3 prefs files stay valid. */
  surfaces?: Record<string, { order: string[]; hidden: string[] }>;
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

// —— Study Layers (a per-source lens axis: owned + preset stages + custom + imported) ——
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
  // Additive presentation/organization fields (no visibility impact). role groups the
  // switcher: "preset" = the built-in stages (预习/学习/复习/拓展), "custom" = a
  // user-made layer, "shared" = an imported one. color is a chip hex; order sorts within
  // a group. The owned layer leaves role unset (it is neither preset, custom, nor shared).
  role?: "preset" | "custom" | "shared";
  color?: string;
  order?: number;
  // Layer Lens hierarchy (R7): the parent layer this nests under (undefined = top-level).
  // Import-driven (a `.studypack` hangs under the per-source "Imported" parent).
  parentId?: string;
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
  // Optional layer membership. Omit to let the server default a source-attached note
  // to that source's owned layer (never send [] if you want that default).
  layerIds?: string[];
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
  /**
   * Import a local .xmind file → a markmap outline. The server unzips + parses the
   * .xmind (content.json / content.xml) and returns an ALREADY-REGISTERED
   * { contentType: "markmap", content: <markdown outline> } — the caller creates a
   * real markmap note from it (no new renderer; renders via getNoteType("markmap")).
   */
  importXmind(filePath: string) {
    return sendJson<{ contentType: string; content: unknown }>("POST", "/api/notes/import-xmind", {
      path: filePath
    });
  },
  /**
   * Patch a note's attachments (concept/anchor links), its layer membership, and/or
   * its CONTENT after creation. `layerIds` is a FULL REPLACE — to add a layer send the
   * union, to remove send the remainder, to move send the new single-element array.
   * `content` rewrites the note in place; the server re-validates it against the note's
   * existing contentType (the type is fixed on edit) and rejects an invalid shape 400.
   */
  updateNote(
    noteId: string,
    input: { conceptIds?: string[]; anchorIds?: string[]; layerIds?: string[]; content?: unknown }
  ) {
    return sendJson<{ note: NoteRecord }>("PATCH", `/api/notes/${noteId}`, input);
  },
  /** Delete a note. 200 {ok:true} on success; throws on 404 (the server's error body). */
  deleteNote(noteId: string) {
    return sendJson<{ ok: true }>("DELETE", `/api/notes/${noteId}`, undefined);
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

  // —— Operations (custom AI actions as data) + their workspace prefs ——
  operations() {
    return getJson<{ operations: OperationRecord[] }>("/api/operations");
  },
  createOperation(input: OperationInput) {
    return sendJson<{ operation: OperationRecord }>("POST", "/api/operations", input);
  },
  updateOperation(operationId: string, input: Partial<OperationInput>) {
    return sendJson<{ operation: OperationRecord }>("PATCH", `/api/operations/${operationId}`, input);
  },
  deleteOperation(operationId: string) {
    return sendJson<{ ok: true }>("DELETE", `/api/operations/${operationId}`, undefined);
  },
  /** Action ordering / enable-disable + per-built-in placeholder params. */
  operationPrefs() {
    return getJson<{ prefs: OperationPrefs }>("/api/operation-prefs");
  },
  saveOperationPrefs(prefs: OperationPrefs) {
    return sendJson<{ prefs: OperationPrefs }>("PUT", "/api/operation-prefs", prefs);
  },

  // —— Study Layers ——
  /** Layers over a source (owned + the 4 preset stages + custom + imported), for the
      multi-select switcher. The server lazily creates the owned + preset layers here. */
  layers(sourceId: string) {
    return getJson<{ layers: StudyLayerRecord[] }>(`/api/sources/${sourceId}/layers`);
  },
  /** Toggle a layer on/off (enabled — reused as the filter include/exclude), rename it,
      or set its presentation fields (color/order) for the layer manager. */
  patchLayer(layerId: string, input: { enabled?: boolean; title?: string; color?: string; order?: number }) {
    return sendJson<{ layer: StudyLayerRecord }>("PATCH", `/api/layers/${layerId}`, input);
  },
  /** Create a user-defined ("custom") layer over a source — backs the manager. */
  createLayer(sourceId: string, input: { title: string; color?: string; order?: number }) {
    return sendJson<{ layer: StudyLayerRecord }>("POST", `/api/sources/${sourceId}/layers`, input);
  },
  /** Delete a CUSTOM layer (the server refuses owned/preset/imported with a 409). */
  deleteLayer(layerId: string) {
    return sendJson<{ ok: true }>("DELETE", `/api/layers/${layerId}`, undefined);
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

  // —— Adaptive note forms · Phase 4 ——
  // Form router (item 1): one structured call where the MODEL picks the form AND fills
  // it. Returns the unwrapped, registry-ready { contentType, content }. `sample` forces
  // a deterministic form against the offline mock (used by the e2e).
  generateBlock(input: { text: string; context?: ChatContext; sample?: unknown }) {
    return sendJson<{ contentType: string; content: unknown; provider: string }>(
      "POST",
      "/api/notes/generate-block",
      input
    );
  },

  // AI-assisted classification (item 2): the low-confidence fallback. Returns a
  // ClassifiedForm-shaped result (contentType + content + confidence). Called by the
  // client's resolveFormAsync ONLY when its pure heuristic is low-confidence.
  classifyForm(input: { text: string; context?: ChatContext; sample?: unknown }) {
    return sendJson<{ contentType: string; content: unknown; confidence: "high" | "low"; provider: string }>(
      "POST",
      "/api/notes/classify",
      input
    );
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
