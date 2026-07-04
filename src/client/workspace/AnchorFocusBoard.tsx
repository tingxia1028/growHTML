// Anchor Focus board (N6 / D12) — a full-surface, read-only board centered on the active
// source's anchors + notes, replacing the weak one-anchor "Anchor Focus" reveal. Two
// layouts, a header toggle, and the §10 filters (只看当前Layer + search + fullscreen):
//
//   A — by document order (default): rows = anchors in reading order; each row shows the
//       anchor's passage/quote + the §10 PreviewCards of that anchor's notes. (顺着读 / 整理补充)
//   B — by stage layer: columns = the source's ENABLED stage layers (F7a stagePresetForKits
//       seed + the user's renamed/added/removed ones); notes bucketed by layerId. Columns
//       are DATA-DRIVEN off the live axis — never a hardcoded 预习/学习/练习/错题/复习. (查漏 / 考前复习)
//
// It REUSES the shipped substrate — no new card renderer, no new render path:
//   • cards       → the one shared §10 PreviewCard (ArtifactCard) → getNoteType().render
//   • stage axis  → the source's StudyLayerRecord[] (sourceLayers) + enabledLayerIds
//   • filters     → the same 只看当前Layer / search idioms the Library + note list use
// All data comes through the EXISTING WorkspaceContext read seam (read-only; no writes).

import { useMemo, useState } from "react";
import { Columns3, List, Maximize2, Minimize2, Search, X } from "lucide-react";
import { defineMessages, t, useLocale } from "../i18n";
import { useWorkspace } from "./WorkspaceContext";
import { ArtifactCard } from "./ArtifactCard";
import type { NoteRecord } from "../data/entityClient";
import {
  boardNotesFrom,
  boardStageColumns,
  buildAnchorRows,
  buildLayerColumns,
  noteToCardBlock,
  UNLAYERED_COLUMN_ID,
  type AnchorRow,
  type LayerColumn
} from "./anchorBoardModel";
import "./anchorFocusBoard.css";

const messages = defineMessages({
  title: { zh: "锚点聚焦", en: "Anchor Focus" },
  byDocument: { zh: "按文档顺序", en: "By document order" },
  byLayer: { zh: "按阶段图层", en: "By stage layer" },
  byDocumentShort: { zh: "文档顺序", en: "Document" },
  byLayerShort: { zh: "阶段图层", en: "Stage layer" },
  onlyCurrentLayer: { zh: "只看当前 Layer", en: "Only current layer" },
  searchPlaceholder: { zh: "搜索笔记 / 摘录…", en: "Search notes / quotes…" },
  fullscreen: { zh: "全屏", en: "Fullscreen" },
  exitFullscreen: { zh: "退出全屏", en: "Exit fullscreen" },
  close: { zh: "关闭", en: "Close" },
  unlayered: { zh: "未分层", en: "Unlayered" },
  noSource: { zh: "打开一个文档以查看它的锚点看板。", en: "Open a source to see its Anchor Focus board." },
  noAnchors: { zh: "这个文档还没有锚点。", en: "This source has no anchors yet." },
  noColumns: { zh: "这个文档还没有启用的阶段图层。", en: "This source has no enabled stage layers." },
  noNotes: { zh: "还没有笔记。", en: "No notes yet." },
  anchorCount: { zh: "个锚点", en: "anchors" },
  region: { zh: "(区域)", en: "(region)" }
});

// A note → the shared PreviewCard. The card owns its chrome + double-click → CenterView;
// we only hand it the block (contentType/content/note), exactly like the chat thread and
// the reader note clusters do.
function NoteCard({ note }: { note: NoteRecord }) {
  return <ArtifactCard block={noteToCardBlock(note)} />;
}

function EmptyNotes({ label }: { label: string }) {
  return <div className="anchor-board-empty-notes">{label}</div>;
}

// Layout A — anchors in document order; each row = the passage + its note cards.
function DocumentLayout({ rows }: { rows: AnchorRow[] }) {
  if (rows.length === 0) {
    return <div className="anchor-board-empty empty-state">{t(messages.noAnchors)}</div>;
  }
  return (
    <div className="anchor-board-rows" data-layout="document">
      {rows.map((row, index) => (
        <section key={row.anchor.id} className="anchor-board-row" data-anchor-id={row.anchor.id}>
          <div className="anchor-board-passage">
            <span className="anchor-board-passage-index">{index + 1}</span>
            <p className="anchor-board-quote" title={row.quote}>
              {row.quote.trim() || <em>{t(messages.region)}</em>}
            </p>
          </div>
          <div className="anchor-board-cards">
            {row.notes.length === 0 ? (
              <EmptyNotes label={t(messages.noNotes)} />
            ) : (
              row.notes.map((entry) => <NoteCard key={entry.note.id} note={entry.note} />)
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

// Layout B — stage-layer columns; notes bucketed by layerId.
function LayerLayout({ columns }: { columns: LayerColumn[] }) {
  if (columns.length === 0) {
    return <div className="anchor-board-empty empty-state">{t(messages.noColumns)}</div>;
  }
  return (
    <div className="anchor-board-columns" data-layout="layer">
      {columns.map((column) => (
        <section
          key={column.id}
          className="anchor-board-column"
          data-layer-id={column.id}
          data-unlayered={column.id === UNLAYERED_COLUMN_ID ? "true" : undefined}
        >
          <header className="anchor-board-column-head">
            {column.color ? (
              <span className="anchor-board-column-dot" style={{ background: column.color }} aria-hidden="true" />
            ) : null}
            <span className="anchor-board-column-title" title={column.title}>
              {column.title}
            </span>
            <span className="anchor-board-column-count">{column.notes.length}</span>
          </header>
          <div className="anchor-board-column-cards">
            {column.notes.length === 0 ? (
              <EmptyNotes label={t(messages.noNotes)} />
            ) : (
              column.notes.map((entry) => <NoteCard key={`${column.id}:${entry.note.id}`} note={entry.note} />)
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

import { useAnchorBoardOpen, setAnchorBoardOpen } from "./anchorFocusBoardStore";

export type AnchorFocusBoardProps = {
  /** Close the board (returns the TopBar to the overlay/document tab). */
  onClose(): void;
};

// Shell mount: rendered once in WorkspaceShell chrome (like FloatingNoteEditor /
// GlobalSearch). Renders nothing until the TopBar's "Anchor Focus" tab opens the board;
// Escape or the ✕/backdrop closes it. Keeps the shell edit to one import + one JSX line.
export function AnchorBoardMount() {
  const open = useAnchorBoardOpen();
  if (!open) return null;
  const close = () => setAnchorBoardOpen(false);
  return (
    <div
      className="anchor-board-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") close();
      }}
    >
      <AnchorFocusBoard onClose={close} />
    </div>
  );
}

// The board surface. Rendered inside an overlay by the shell mount; a standalone caller
// (tests) can mount it directly. All state (layout, filter, search, fullscreen) is local —
// the board is a transient view, not persisted workspace state.
export function AnchorFocusBoard({ onClose }: AnchorFocusBoardProps) {
  useLocale();
  const { activeSource, anchors, notes, sourceLayers, enabledLayerIds } = useWorkspace();

  const [layout, setLayout] = useState<"document" | "layer">("document");
  const [onlyCurrentLayer, setOnlyCurrentLayer] = useState(false);
  const [query, setQuery] = useState("");
  const [fullscreen, setFullscreen] = useState(false);

  // The content notes (bookmarks excluded) — then the 只看当前Layer narrowing (a note shows
  // iff one of its layers is enabled, OR it has no layers → never orphaned; mirrors the
  // WorkspaceContext OR filter). Off = every note.
  const boardNotes = useMemo(() => {
    const content = boardNotesFrom(notes);
    if (!onlyCurrentLayer) return content;
    return content.filter(
      (note) => note.layerIds.length === 0 || note.layerIds.some((id) => enabledLayerIds.has(id))
    );
  }, [notes, onlyCurrentLayer, enabledLayerIds]);

  const notesByAnchorId = useMemo(() => {
    const map = new Map<string, NoteRecord[]>();
    for (const note of boardNotes) {
      for (const anchorId of note.anchorIds) {
        const existing = map.get(anchorId);
        if (existing) existing.push(note);
        else map.set(anchorId, [note]);
      }
    }
    return map;
  }, [boardNotes]);

  const anchorQuoteById = useMemo(() => {
    const map = new Map<string, string>();
    for (const anchor of anchors) {
      if ("quote" in anchor && typeof anchor.quote === "string") map.set(anchor.id, anchor.quote);
    }
    return map;
  }, [anchors]);

  // Layout A rows — anchors in document order (the order the server returns) with their
  // search-filtered notes.
  const rows = useMemo(
    () => buildAnchorRows(anchors, notesByAnchorId, { query }),
    [anchors, notesByAnchorId, query]
  );

  // Layout B columns — the source's ENABLED stage layers (the F7a axis), notes bucketed by
  // layerId, catch-all "未分层" trailing.
  const columns = useMemo(
    () =>
      buildLayerColumns(boardNotes, boardStageColumns(sourceLayers, enabledLayerIds), {
        query,
        unlayeredTitle: t(messages.unlayered),
        anchorQuoteById
      }),
    [boardNotes, sourceLayers, enabledLayerIds, query, anchorQuoteById]
  );

  return (
    <div className={`anchor-board${fullscreen ? " anchor-board-fullscreen" : ""}`} data-layout={layout} role="dialog" aria-label={t(messages.title)}>
      <header className="anchor-board-head">
        <div className="anchor-board-head-left">
          <h2 className="anchor-board-title">{t(messages.title)}</h2>
          {activeSource ? (
            <span className="anchor-board-source" title={activeSource.title}>
              {activeSource.title} · {anchors.length} {t(messages.anchorCount)}
            </span>
          ) : null}
        </div>

        {/* Layout toggle (§D12 header toggle). */}
        <div className="anchor-board-layout-toggle" role="tablist" aria-label={t(messages.title)}>
          <button
            type="button"
            role="tab"
            aria-selected={layout === "document"}
            className={`anchor-board-tab${layout === "document" ? " active" : ""}`}
            data-layout="document"
            title={t(messages.byDocument)}
            onClick={() => setLayout("document")}
          >
            <List size={14} aria-hidden="true" />
            {t(messages.byDocumentShort)}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={layout === "layer"}
            className={`anchor-board-tab${layout === "layer" ? " active" : ""}`}
            data-layout="layer"
            title={t(messages.byLayer)}
            onClick={() => setLayout("layer")}
          >
            <Columns3 size={14} aria-hidden="true" />
            {t(messages.byLayerShort)}
          </button>
        </div>

        {/* §10 filters: 只看当前Layer + search + fullscreen. */}
        <div className="anchor-board-filters">
          <label className="anchor-board-only-layer sv-check" data-state={onlyCurrentLayer ? "on" : "off"}>
            <input
              type="checkbox"
              className="anchor-board-only-layer-input sv-check-input"
              checked={onlyCurrentLayer}
              onChange={(event) => setOnlyCurrentLayer(event.target.checked)}
            />
            <span className="sv-check-box" aria-hidden="true" />
            <span>{t(messages.onlyCurrentLayer)}</span>
          </label>
          <div className="anchor-board-search">
            <Search size={13} aria-hidden="true" />
            <input
              className="anchor-board-search-input"
              type="search"
              value={query}
              placeholder={t(messages.searchPlaceholder)}
              aria-label={t(messages.searchPlaceholder)}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <button
            type="button"
            className="anchor-board-icon-btn anchor-board-fullscreen-btn"
            aria-pressed={fullscreen}
            title={t(fullscreen ? messages.exitFullscreen : messages.fullscreen)}
            aria-label={t(fullscreen ? messages.exitFullscreen : messages.fullscreen)}
            onClick={() => setFullscreen((value) => !value)}
          >
            {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <button
            type="button"
            className="anchor-board-icon-btn anchor-board-close-btn"
            title={t(messages.close)}
            aria-label={t(messages.close)}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
      </header>

      <div className="anchor-board-body">
        {!activeSource ? (
          <div className="anchor-board-empty empty-state">{t(messages.noSource)}</div>
        ) : layout === "document" ? (
          <DocumentLayout rows={rows} />
        ) : (
          <LayerLayout columns={columns} />
        )}
      </div>
    </div>
  );
}
