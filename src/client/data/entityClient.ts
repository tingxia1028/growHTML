// EntityClient — the single typed seam between the client UI and the backend API.
// All data access (sources, anchors, notes, patches, concepts, relations,
// assets, workspace) goes through here, so workspace nodes never call `fetch`
// directly and the API shape lives in one place. Every JSON call flows through a
// pluggable VaultTransport (X0b, docs/design/multi-platform.md §1-X0): HTTP by
// default, swappable for the in-process direct adapter on mobile via
// `configureVaultTransport`. Only chatStream (SSE) and assetUrl (binary bytes)
// stay HTTP-only — see ./transport for the rationale.

import { createHttpTransport, type VaultTransport } from "./transport";
import { syncInstallState } from "../../kits/installState";

export { ApiError } from "./transport";
export type { VaultTransport } from "./transport";

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
  /** Per-action chosen icon NAME (R6 polish): action id → lucide icon name (from the
      shared ICON_CHOICES set). GLOBAL, not per-surface, so an action's glyph is
      consistent everywhere. Optional so pre-existing prefs files stay valid. */
  icons?: Record<string, string>;
};

// PluginPrefs — the per-vault "Kit & Plugin" prefs (mirrors the server's
// pluginPrefsSchema). `disabledContributions` is the set of namespaced contribution ids
// the manager has switched off; `viewerAssociations` holds the viewer pins; `userKits`
// + `catalogState` are the M1 MARKET install state (plugin-viewer-model §8.3 — null
// lists = the default-installed set, so an untouched vault behaves as today). Both
// market fields are optional here so pre-M1 prefs objects (and the workspace context's
// empty default) stay type-valid; the server always returns them.
export type PluginPrefs = {
  disabledContributions: string[];
  viewerAssociations: { byContentType: Record<string, string>; byNoteId: Record<string, string> };
  userKits: unknown[];
  catalogState?: { installedPlugins: string[] | null; installedKits: string[] | null };
};

// —— Learner memory (MEM-1, docs/design/learner-memory.md) — behavior capture is
// TELEMETRY, not a ledger: batched, fire-and-forget, never blocks UX. Shapes mirror
// src/core/schema/memory.ts + src/server/memory.ts. ——

/** The CLOSED core verb envelope (§3) — kits enrich via taxonomy, never new verbs. */
export type MemoryVerb =
  | "open"
  | "read"
  | "anchor.create"
  | "note.create"
  | "note.edit"
  | "note.review"
  | "ai.ask"
  | "ai.generate"
  | "import"
  | "export"
  | "search"
  | "navigate";

/** What the behavior touched — all optional, ids of the referenced entities. */
export type MemorySubject = {
  sourceId?: string;
  anchorId?: string;
  noteId?: string;
  conceptId?: string;
  layerId?: string;
  kitId?: string;
  contentType?: string;
};

/** Wire shape of one captured event; the server owns the record envelope. */
export type MemoryEventInput = {
  verb: MemoryVerb;
  subject?: MemorySubject;
  payload?: Record<string, unknown>;
  sessionId?: string;
  /** Client capture time (ISO) — batching delays arrival, so the queue stamps it. */
  ts?: string;
};

/** The vault-level capture switch (learner-memory §6.4). */
export type MemorySettings = { captureEnabled: boolean };

/** A stored event as GET /api/memory/events returns it (server envelope included). */
export type MemoryEventRow = {
  id: string;
  verb: MemoryVerb;
  subject?: MemorySubject;
  payload?: Record<string, unknown>;
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
};

// —— Learner memory MEM-2 (tiers) — shapes mirror src/core/memory/digest.ts +
// profile.ts and src/server/memory.ts. ——

/** One day×dimension×bucket digest row (the 中长期 tier read model). */
export type MemoryDigestRow = {
  period: "day";
  date: string;
  dimension: "overall" | "subject" | "contentType" | "sourceId";
  bucket: string;
  events: number;
  counts: Record<string, number>;
  review: { pass: number; fail: number; skip: number };
  firstAt: string;
  lastAt: string;
};

export type MemoryDigestListMeta = {
  frozenThrough: string | null;
  consolidatedAt: string | null;
  rows: number;
};

/** One derived profile fact merged with its user override (the 长期 tier). */
export type ProfileFactView = {
  key: string;
  kind: "weak" | "activity" | "top";
  title: string;
  value: string;
  evidence: string[];
  confidence?: number;
  pinned: boolean;
  hidden: boolean;
  note?: string;
};

export type ProfileFactOverride = { key: string; pinned?: boolean; hidden?: boolean; note?: string };
export type ProfileOverrides = { facts: ProfileFactOverride[] };

export type MemoryDigestMeta = MemoryDigestListMeta & {
  events: number;
  captureEnabled: boolean;
  retention: { rawEventDays: number; digestDays: number };
};

export type MemoryProfileResponse = {
  facts: ProfileFactView[];
  overrides: ProfileOverrides;
  digestMeta: MemoryDigestMeta;
};

export type ConsolidateMemorySummary = {
  frozenThrough: string | null;
  consolidatedAt: string | null;
  rows: number;
  prunedEvents: number;
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
  // Protected `.svpack` import (sealed store, read-only): the server merges sealed
  // layers into the read model flagged `sealed: true`. Absent on normal layers.
  sealed?: boolean;
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

// —— Protected sharing (.svpack) — docs/design/studypack-sharing.md §5–§7. Encrypted +
// signed layer packs: per-recipient one-time codes, TOFU publisher pinning, sealed
// (read-only) import store. Shapes mirror src/server/svpack.ts verbatim. ——

export type SvpackValidity = { notBefore: string | null; validUntil: string | null };

/** One roster line from export: `code` arrives ALREADY display-formatted (8×5 groups). */
export type SvpackRosterEntry = { label: string; code: string; codeId: string };

export type SvpackExportResult = {
  packId: string;
  revision: number;
  /** The `.svpack` file bytes, base64 — codes and file are returned exactly ONCE here. */
  fileB64: string;
  fileName: string;
  roster: SvpackRosterEntry[];
  /** Notes refused at the export choke point (origin.exportable === false). */
  refusedCount: number;
};

/** TOFU pin verdict for the pack's publisher id (§5.1). */
export type SvpackPinStatus = "unknown" | "pinned-match" | "pinned-mismatch";

/** Cleartext header echo (safe pre-code): what inspect/open show about a pack. */
export type SvpackHeaderEcho = {
  packId: string;
  revision: number;
  title: string;
  publisher: { id: string; displayName: string; signingPubKey: string };
  createdAt: string;
  validity: SvpackValidity;
  sourceHash: string;
  sourceType: string;
  contentTypes: string[];
};

export type SvpackInspectResult = {
  header: SvpackHeaderEcho;
  pinStatus: SvpackPinStatus;
  /** Local source matched by content hash, or null (import stays possible, unbound). */
  sourceMatch: { sourceId: string; title: string } | null;
};

export type SvpackOpenResult = {
  header: SvpackHeaderEcho;
  codeId: string;
  preview: ImportPreview;
};

export type SvpackCommitResult = {
  packId: string;
  layerId: string;
  counts: { anchors: number; notes: number; stats: { matched: number; fuzzy: number; unmatched: number } };
  sealed: true;
};

export type SealedPackStatus = "active" | "expired" | "not-yet-valid" | "clock-rollback" | "unreadable";

/** Manager-list row for an installed sealed pack (GET /api/svpack). */
export type SealedPackRow = {
  packId: string;
  status: SealedPackStatus;
  echo?: {
    packId: string;
    revision: number;
    publisher: { id: string; displayName: string; publicKeyB64u: string };
    validity: SvpackValidity;
    title: string;
    sourceHash: string;
    sourceType: string;
    codeId: string;
    contentTypes: string[];
  };
  importedAt?: string;
  counts?: { anchors: number; notes: number };
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
  /** SHELL-2 onboarding block (server-owned field group; absent on old files). */
  onboarding?: OnboardingState;
};

// —— App shell (SHELL-1/SHELL-2) — shapes mirror src/server/services/workspace.ts +
// the tiny readout endpoints in app.ts / svpack.ts. ——

/** The onboarding checklist block persisted in workspace.json (own write seam). */
export type OnboardingState = {
  dismissed: boolean;
  completedAt: string | null;
  /** Latched step completions — once a step is detected done it stays done. */
  doneSteps: string[];
  /** The 载入示例文档 seed, remembered so re-seeding stays idempotent. */
  sampleSourceId: string | null;
};

/** GET /api/about — app id + package.json version (关于 surfaces). */
export type AboutInfo = { app: string; version: string };

/** One registered AI provider descriptor (the A1 registry's listing shape). */
export type AiProviderDescriptor = { id: string; kind: string; label: string };

/** GET /api/ai/providers — active provider + registry readout (env detection). */
export type AiProvidersInfo = {
  active: { id: string; kind: string };
  providers: AiProviderDescriptor[];
  envProviderId: string | null;
};

/** GET /api/svpack/identity — the local Tier-A publisher identity, if one exists. */
export type SvpackIdentityInfo = { identity: { id: string; displayName: string } | null };

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

// —— Backend transport (X0b) — module default is HTTP; a direct-call host swaps it ——
const httpTransport = createHttpTransport();
let activeTransport: VaultTransport = httpTransport;

/**
 * Swap the backend the entityClient talks through (multi-platform §1-X0): the mobile
 * shell installs the in-process direct adapter here at startup; nothing else about
 * the client changes. chatStream/assetUrl are HTTP-only and unaffected.
 */
export function configureVaultTransport(transport: VaultTransport): void {
  activeTransport = transport;
}

/** Test seam: restore the default HTTP transport (undo configureVaultTransport). */
export function resetVaultTransport(): void {
  activeTransport = httpTransport;
}

function getJson<T>(url: string): Promise<T> {
  return activeTransport.request<T>("GET", url);
}

function sendJson<T>(method: string, url: string, input: unknown): Promise<T> {
  return activeTransport.request<T>(method, url, input);
}

// Push the market install state from a plugin-prefs response into the module-scope
// store the availability selectors read (see the Plugin prefs section below). Identity
// on the response so it chains in a .then().
function syncInstallStateFrom<T extends { prefs: PluginPrefs }>(res: T): T {
  syncInstallState({ catalogState: res.prefs.catalogState, userKits: res.prefs.userKits });
  return res;
}

/** Kept as a named alias: these call sites rely on ApiError's machine `code`. */
function fetchCoded<T>(method: string, url: string, input?: unknown): Promise<T> {
  return activeTransport.request<T>(method, url, input);
}

export const entityClient = {
  // —— Sources ——
  sources() {
    return getJson<{ sources: SourceRecord[] }>("/api/sources");
  },
  /** Ingest pasted/authored HTML as a source (stable study-ids injected server-side). */
  ingestHtml(title: string, content: string) {
    return sendJson<{ source: SourceRecord; injected: { added: number; ids: string[] } }>(
      "POST",
      "/api/sources/html",
      { title, content }
    );
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

  // —— Plugin prefs (Kit & Plugin: disabled contributions + viewer pins + the M1 market
  // install state). Every round-trip SYNCS the module-scope install-state store
  // (src/kits/installState.ts) from the server response, so the pure availability
  // selectors (kitSurfaceItems / slash adapter / viewer resolver) see the vault's
  // effective-installed set without threading React state — the same push pattern as
  // WorkspaceContext → setDisabledContributions. ——
  /** The per-vault Kit & Plugin prefs (disabled ids + pins + market install state). */
  pluginPrefs() {
    return getJson<{ prefs: PluginPrefs }>("/api/plugin-prefs").then(syncInstallStateFrom);
  },
  /** The workspace-panel write seam (disabled set + pins). The server preserves the
      stored market fields regardless of what this body carries (single-writer rule). */
  putPluginPrefs(prefs: PluginPrefs) {
    return sendJson<{ prefs: PluginPrefs }>("PUT", "/api/plugin-prefs", prefs).then(syncInstallStateFrom);
  },
  /** The MARKET write seam (install/uninstall — catalogState + userKits only; the
      server preserves the stored panel fields). */
  putPluginCatalog(body: { catalogState: NonNullable<PluginPrefs["catalogState"]>; userKits?: unknown[] }) {
    return sendJson<{ prefs: PluginPrefs }>("PUT", "/api/plugin-prefs/catalog", body).then(syncInstallStateFrom);
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

  // —— Protected sharing (.svpack) — all throw ApiError so views can branch on `code` ——
  /** Publisher: export a layer as an encrypted+signed pack. Roster codes show ONCE. */
  exportSvpack(layerId: string, input: { recipients: Array<{ label: string }>; validUntil: string; notBefore?: string }) {
    return fetchCoded<SvpackExportResult>("POST", `/api/layers/${layerId}/export-svpack`, input);
  },
  /** Recipient step 1: code-free header inspection (publisher pin status, source match). */
  inspectSvpack(fileB64: string) {
    return fetchCoded<SvpackInspectResult>("POST", "/api/svpack/inspect", { fileB64 });
  },
  /** Recipient step 2: open with a code → re-anchor preview. Nothing persisted. */
  openSvpack(fileB64: string, code: string) {
    return fetchCoded<SvpackOpenResult>("POST", "/api/svpack/open", { fileB64, code });
  },
  /** Recipient step 3: commit into the sealed (read-only) store. 201 on success. */
  commitSvpack(fileB64: string, code: string, rememberCode = false) {
    return fetchCoded<SvpackCommitResult>("POST", "/api/svpack/commit", { fileB64, code, rememberCode });
  },
  /** Installed sealed packs (manager rows; validity statuses current-as-of-now). */
  sealedImports() {
    return fetchCoded<{ packs: SealedPackRow[] }>("GET", "/api/svpack");
  },
  /** Delete an imported pack = delete its sealed blob (content leaves the read model). */
  deleteSealedImport(packId: string) {
    return fetchCoded<{ ok: true }>("DELETE", `/api/svpack/${packId}`);
  },

  // —— Learner memory (MEM-1) ——
  /**
   * Append a batch (≤100) of captured behavior events. Fire-and-forget semantics:
   * capture-off answers 204 WITH NO BODY — the transport resolves that to
   * `undefined` — and callers (the capture queue) treat any 2xx as success and
   * swallow rejections.
   */
  async postMemoryEvents(events: MemoryEventInput[]): Promise<void> {
    await sendJson<{ appended: number } | undefined>("POST", "/api/memory/events", { events });
  },
  /** The vault-level capture switch (the user owns capture — learner-memory §6). */
  memorySettings() {
    return getJson<{ settings: MemorySettings }>("/api/memory/settings");
  },
  putMemorySettings(settings: MemorySettings) {
    return sendJson<{ settings: MemorySettings }>("PUT", "/api/memory/settings", settings);
  },
  /** Read back stored events (manager/review consumers; server caps limit at 1000). */
  listMemoryEvents(query?: { since?: string; limit?: number }) {
    const params = new URLSearchParams();
    if (query?.since) params.set("since", query.since);
    if (query?.limit !== undefined) params.set("limit", String(query.limit));
    const qs = params.toString();
    return getJson<{ events: MemoryEventRow[]; total: number }>(`/api/memory/events${qs ? `?${qs}` : ""}`);
  },

  // —— Learner memory (MEM-2 tiers) ——
  /** Live day-digest rows (the 中长期 tier), optionally filtered to one dimension. */
  memoryDigests(dimension?: MemoryDigestRow["dimension"]) {
    return getJson<{ digests: MemoryDigestRow[]; meta: MemoryDigestListMeta }>(
      `/api/memory/digests${dimension ? `?dimension=${encodeURIComponent(dimension)}` : ""}`
    );
  },
  /** The 画像: deterministic facts merged with overrides + tier meta (§4/§6.4). */
  memoryProfile() {
    return getJson<MemoryProfileResponse>("/api/memory/profile");
  },
  /** Replace the profile override document (pin/hide/correct — survives recomputes). */
  putMemoryProfile(overrides: ProfileOverrides) {
    return sendJson<{ overrides: ProfileOverrides }>("PUT", "/api/memory/profile", overrides);
  },
  /** Run one consolidation pass now (events→digests + raw compaction). Idempotent. */
  consolidateMemory() {
    return sendJson<{ consolidated: ConsolidateMemorySummary }>("POST", "/api/memory/consolidate", {});
  },
  /** 清除记忆 — wipe every tier (events + digests + overrides). The switch stays. */
  clearMemory() {
    return sendJson<{ cleared: { events: number; digests: boolean; overrides: boolean } }>(
      "DELETE",
      "/api/memory",
      undefined
    );
  },

  // —— Assets ——
  importAsset(filePath: string) {
    return sendJson<{ asset: AssetRecord }>("POST", "/api/assets/local-file", { path: filePath });
  },
  assetMeta(assetId: string) {
    return getJson<{ asset: AssetRecord }>(`/api/assets/${assetId}/meta`);
  },
  /**
   * URL for the raw asset bytes (use directly as an <img>/<audio>/<video> src).
   * HTTP-only by design: binary bytes ride the platform URL loader, never the
   * JSON VaultTransport (see ./transport).
   */
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
  // is unavailable (no body / non-OK response). HTTP-only by design: SSE needs an
  // incremental byte stream, so this keeps its own fetch instead of riding the
  // JSON VaultTransport (the chat() fallback IS transport-routed).
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
  /** The LAYOUT write seam — the server preserves the stored onboarding block
      regardless of what this body carries (single-writer rule, as plugin-prefs). */
  saveWorkspace(state: WorkspaceState) {
    return sendJson<{ workspace: WorkspaceState }>("PUT", "/api/workspace", state);
  },
  /** The ONBOARDING write seam (SHELL-2 checklist progress/dismiss). */
  onboardingState() {
    return getJson<{ onboarding: OnboardingState }>("/api/workspace/onboarding");
  },
  putOnboardingState(onboarding: OnboardingState) {
    return sendJson<{ onboarding: OnboardingState }>("PUT", "/api/workspace/onboarding", onboarding);
  },

  // —— App shell readouts (SHELL-1 user menu + Settings Hub) ——
  /** App id + version (关于). */
  about() {
    return getJson<AboutInfo>("/api/about");
  },
  /** Vault manifest + root path (Settings Hub 数据 section readout). */
  vaultInfo() {
    return getJson<{ manifest: { name?: string }; paths: { rootDir: string } }>("/api/vault");
  },
  /** Active AI provider + the registered descriptor list (env detection readout). */
  aiProviders() {
    return getJson<AiProvidersInfo>("/api/ai/providers");
  },
  /** The local Tier-A publisher identity (null when this device never published). */
  svpackIdentity() {
    return getJson<SvpackIdentityInfo>("/api/svpack/identity");
  }
};

export type EntityClient = typeof entityClient;
