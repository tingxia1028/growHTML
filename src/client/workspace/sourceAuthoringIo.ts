// Client IO for source authoring (SRC-1 create / SRC-2 edit pipeline) — plain fetch
// with a test seam, the dataTrust/speech idiom. Deliberately NOT in entityClient
// (contended file this pass); the endpoints are the sourceAuthoring service routes:
//   POST  /api/sources/authored            — blank-create (新建 Markdown / 新建 HTML 页)
//   GET   /api/sources/:id/content         — the RAW stored text the editor edits
//   PATCH /api/sources/:id/content         — save → re-hash → re-project anchors
//   GET   /api/sources/:id/share-status    — the shared-source edit warning input

export type AuthoredSourceType = "markdown" | "html";

/** The additive SRC-1 fields (source-authoring.md §3). The shared client SourceRecord
    type doesn't carry them (entityClient is contended this pass), so authored-aware
    surfaces read them through this shape. */
export type SourceAuthoringFields = {
  origin?: "authored" | "imported";
  revision?: number;
};

/** Whether this source routes to the authored editor view (阅读 ⇄ 编辑). Imported
    sources never do — their body is read-only and the reader stays their surface. */
export function isAuthoredTextSource(source: {
  sourceType: string;
  origin?: unknown;
}): boolean {
  const origin = (source as SourceAuthoringFields).origin;
  return origin === "authored" && (source.sourceType === "markdown" || source.sourceType === "html");
}

export type ReprojectedAnchorInfo = {
  anchorId: string;
  status: "matched" | "fuzzy" | "unmatched";
  quote: string;
};

export type SaveContentOutcome = {
  source: { id: string; title: string; revision?: number; contentHash: string };
  reprojection: {
    total: number;
    matched: number;
    fuzzy: number;
    unmatched: number;
    anchors: ReprojectedAnchorInfo[];
  };
};

export type ShareStatus = {
  shared: boolean;
  publishedPackCount: number;
  importedLayerCount: number;
};

export type SourceAuthoringIo = {
  createAuthored(input: {
    title: string;
    sourceType: AuthoredSourceType;
    content?: string;
  }): Promise<{ source: { id: string; title: string } }>;
  fetchContent(sourceId: string): Promise<string>;
  saveContent(sourceId: string, input: { content: string; title?: string }): Promise<SaveContentOutcome>;
  fetchShareStatus(sourceId: string): Promise<ShareStatus>;
};

async function requestJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    path,
    body === undefined
      ? { method }
      : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
  );
  const parsed = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (parsed as { error?: string }).error;
    throw new Error(message ?? `Request failed: ${method} ${path} (HTTP ${response.status})`);
  }
  return parsed as T;
}

const defaultIo: SourceAuthoringIo = {
  createAuthored: (input) => requestJson("POST", "/api/sources/authored", input),
  fetchContent: async (sourceId) => {
    // The content route serves the stored TEXT verbatim (not JSON).
    const response = await fetch(`/api/sources/${sourceId}/content`);
    if (!response.ok) throw new Error(`Failed to load source content (HTTP ${response.status})`);
    return response.text();
  },
  saveContent: (sourceId, input) => requestJson("PATCH", `/api/sources/${sourceId}/content`, input),
  fetchShareStatus: (sourceId) => requestJson("GET", `/api/sources/${sourceId}/share-status`)
};

let io: SourceAuthoringIo = defaultIo;

export function getSourceAuthoringIo(): SourceAuthoringIo {
  return io;
}

/** Test seam: override any subset; pass null to restore the fetch-backed default. */
export function setSourceAuthoringIoForTests(next: Partial<SourceAuthoringIo> | null): void {
  io = next ? { ...defaultIo, ...next } : defaultIo;
}
