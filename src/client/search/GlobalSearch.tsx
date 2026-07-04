// GlobalSearch (SEARCH-1; docs/design/global-search.md §1/§3) — the ONE Cmd/Ctrl+K
// surface: a centered overlay palette over three result families (笔记 / 文档 / 命令),
// reusing the SC-0 SlashPalette idioms (controlled flat list, arrows wrap, Enter picks,
// mousedown-not-click rows, parent-owned active index) widened with group headers.
//
// Host-mount idiom (the GlobalSpeakSelection precedent): mounted ONCE in the
// WorkspaceShell chrome; the global hotkey lives HERE (one window keydown, no per-view
// wiring). The Library pane's header input stays a LOCAL section filter (design §1 —
// this palette is the global entry; see the seam comment in views.tsx).
//
// Split like SC-0: `GlobalSearchPalette` is the testable component over an injected
// deps seam (fetchHits / commands / focus callbacks — jsdom tests mock all three
// families' dispatch); `GlobalSearch` is the thin host that wires useWorkspace.
//
// Selection contract per family (design §1):
//   note    → the EXISTING focus contract: anchor on the active source → setAnchor
//             (revealSeq scrolls the reader); other source → open it, then complete
//             the focus when its anchors arrive (pending-reveal effect below);
//             no anchor → note focus ({type:"note"}, the LINKED-NOTE-001 target).
//   source  → open it (setActiveSourceId — the readers follow).
//   command → run it (navigateShell targets only — safely runnable with no args).

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileText } from "lucide-react";
import { noteTypeIcon } from "../notes/noteTypeIcon";
import { t } from "../i18n";
import { useWorkspace } from "../workspace/WorkspaceContext";
import { searchCommandEntries, type SearchCommandEntry } from "./commandEntries";
import { fetchSearchHits } from "./searchClient";
import {
  buildPaletteGroups,
  rankCommandEntries,
  searchPaletteKeyDown,
  SEARCH_DEBOUNCE_MS,
  type PaletteRow,
  type SearchHitDto
} from "./searchEngine";
import { searchMessages } from "./searchMessages";
import "./globalSearch.css";

/** True for the palette hotkey: Cmd/Ctrl+K (either modifier — Windows AND mac). */
export function isSearchHotkey(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "k";
}

// The palette needs nothing of an anchor beyond identity — the records flow through
// untouched (ctx.anchors → focus.setAnchor), so the seam stays generic and this
// module never imports the contended entityClient.
export type GlobalSearchDeps<A extends { id: string } = { id: string }> = {
  activeSourceId: string;
  /** The ACTIVE source's anchor records (the reveal candidates). */
  anchors: readonly A[];
  /** Focus an anchor record — the reader scrolls to it (revealSeq). */
  focusAnchor(anchor: A): void;
  /** Fallback focus for anchorless notes ({type:"note"} — LINKED-NOTE-001). */
  focusNote(noteId: string): void;
  /** Open a source in the reader. */
  openSource(sourceId: string): void;
  commands: readonly SearchCommandEntry[];
  fetchHits(q: string): Promise<SearchHitDto[]>;
};

function groupTitle(family: PaletteRow["family"]): string {
  if (family === "note") return t(searchMessages.groupNotes);
  if (family === "source") return t(searchMessages.groupSources);
  return t(searchMessages.groupCommands);
}

function RowIcon({ row }: { row: PaletteRow }) {
  if (row.family === "note") {
    const Icon = noteTypeIcon(row.hit.contentType);
    return <Icon className="global-search-row-icon" size={14} aria-hidden="true" />;
  }
  if (row.family === "source") {
    return <FileText className="global-search-row-icon" size={14} aria-hidden="true" />;
  }
  return (
    <span className="global-search-row-icon" aria-hidden="true">
      ✦
    </span>
  );
}

export function GlobalSearchPalette<A extends { id: string }>({ deps }: { deps: GlobalSearchDeps<A> }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHitDto[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const activeRef = useRef<HTMLLIElement | null>(null);
  // Monotonic token so a stale (slower) fetch can never overwrite a newer one.
  const seqRef = useRef(0);
  // A cross-source note pick: the reveal completes once the opened source's anchors
  // arrive (the anchors prop updates after loadSourceWorkspace).
  const pendingRevealRef = useRef<{ sourceId: string; anchorId: string } | null>(null);

  // The ONE global hotkey (registered once — this component mounts once in the shell).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isSearchHotkey(event)) {
        event.preventDefault();
        setOpen((prev) => !prev);
      } else if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Fresh palette every open.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHits([]);
    setSearching(false);
    setActiveIndex(0);
  }, [open]);

  // Debounced server query (design §2). Empty query → no fetch (commands still show).
  const { fetchHits } = deps;
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    const seq = ++seqRef.current;
    if (!q) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      void fetchHits(q).then((results) => {
        if (seqRef.current !== seq) return;
        setHits(results);
        setSearching(false);
        setActiveIndex(0);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, query, fetchHits]);

  const commands = useMemo(() => rankCommandEntries(query, deps.commands), [query, deps.commands]);
  const { groups, rows } = useMemo(() => buildPaletteGroups(hits, commands), [hits, commands]);

  // Keep the active row valid as the row set changes, and visible as arrows move it
  // (guarded: jsdom has no scrollIntoView).
  useEffect(() => {
    if (activeIndex >= rows.length) setActiveIndex(0);
  }, [rows.length, activeIndex]);
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  // Complete a cross-source reveal once the opened source's anchors are in. If the
  // active source moved somewhere ELSE meanwhile (user navigation), drop the intent.
  const { activeSourceId, anchors, focusAnchor } = deps;
  useEffect(() => {
    const pending = pendingRevealRef.current;
    if (!pending) return;
    if (activeSourceId !== pending.sourceId) {
      pendingRevealRef.current = null;
      return;
    }
    const anchor = anchors.find((candidate) => candidate.id === pending.anchorId);
    if (anchor) {
      pendingRevealRef.current = null;
      focusAnchor(anchor);
    }
  }, [activeSourceId, anchors, focusAnchor]);

  const onPick = (row: PaletteRow) => {
    if (row.family === "note") {
      const hit = row.hit;
      if (hit.sourceId && hit.sourceId !== deps.activeSourceId) {
        // Open its source; the anchor reveal completes in the pending effect above.
        pendingRevealRef.current = hit.anchorId ? { sourceId: hit.sourceId, anchorId: hit.anchorId } : null;
        deps.openSource(hit.sourceId);
        if (!hit.anchorId) deps.focusNote(hit.id);
      } else {
        const anchor = hit.anchorId ? deps.anchors.find((candidate) => candidate.id === hit.anchorId) : undefined;
        if (anchor) deps.focusAnchor(anchor);
        else deps.focusNote(hit.id);
      }
    } else if (row.family === "source") {
      deps.openSource(row.hit.id);
    } else {
      row.command.run();
    }
    setOpen(false);
  };

  if (!open || typeof document === "undefined") return null;

  const emptyText = !query.trim()
    ? t(searchMessages.hint)
    : searching
      ? t(searchMessages.searching)
      : t(searchMessages.empty);

  return createPortal(
    <div
      className="global-search-overlay"
      role="presentation"
      // mousedown on the backdrop (not click) so a drag that ends outside doesn't close.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div className="global-search-panel" role="dialog" aria-modal="true" aria-label={t(searchMessages.dialogLabel)}>
        <input
          className="global-search-input"
          type="search"
          autoFocus
          value={query}
          placeholder={t(searchMessages.placeholder)}
          aria-label={t(searchMessages.dialogLabel)}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            // Escape is the window listener's job (works with focus anywhere).
            if (searchPaletteKeyDown(event.key, { rows, activeIndex, onNavigate: setActiveIndex, onPick })) {
              event.preventDefault();
            }
          }}
        />
        <div className="global-search-body">
          {rows.length === 0 ? (
            <div className="global-search-empty" role="status">
              {emptyText}
            </div>
          ) : (
            groups.map((group) => (
              <section className="global-search-group" key={group.family} data-family={group.family}>
                <h2 className="global-search-group-title">{groupTitle(group.family)}</h2>
                <ul className="global-search-list" role="listbox" aria-label={groupTitle(group.family)}>
                  {group.rows.map((row, indexInGroup) => {
                    const flatIndex = group.startIndex + indexInGroup;
                    const active = flatIndex === activeIndex;
                    const key =
                      row.family === "command" ? `command:${row.command.id}` : `${row.family}:${row.hit.id}`;
                    return (
                      <li
                        key={key}
                        ref={active ? activeRef : undefined}
                        className={`global-search-row${active ? " active" : ""}`}
                        role="option"
                        aria-selected={active}
                        data-row-id={row.family === "command" ? row.command.id : row.hit.id}
                        // mousedown (not click) so the input never loses focus first (SC-0).
                        onMouseDown={(event) => {
                          event.preventDefault();
                          onPick(row);
                        }}
                        onMouseEnter={() => setActiveIndex(flatIndex)}
                      >
                        <RowIcon row={row} />
                        <span className="global-search-row-main">
                          <span className="global-search-row-title">
                            {row.family === "note"
                              ? row.hit.title || t(searchMessages.untitledNote)
                              : row.family === "source"
                                ? row.hit.title
                                : t(row.command.title)}
                          </span>
                          {row.family === "note" && row.hit.snippet ? (
                            <span className="global-search-row-snippet">{row.hit.snippet}</span>
                          ) : null}
                        </span>
                        {row.family === "note" && row.hit.sourceTitle ? (
                          <span className="global-search-row-meta">{row.hit.sourceTitle}</span>
                        ) : null}
                        {row.family === "source" ? (
                          <span className="global-search-row-meta">{row.hit.sourceType}</span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
        <div className="global-search-hint">{t(searchMessages.hint)}</div>
      </div>
    </div>,
    document.body
  );
}

/** The shell-mounted host: wires the palette to the workspace (IRON LAW: reads only
 *  useWorkspace + the module seams; no view internals). */
export function GlobalSearch() {
  const ctx = useWorkspace();
  const commands = useMemo(() => searchCommandEntries(), []);
  return (
    <GlobalSearchPalette
      deps={{
        activeSourceId: ctx.activeSourceId,
        anchors: ctx.anchors,
        // Context-typed arrow (not the method reference) so A infers from `anchors`
        // alone — setAnchor's `| null` parameter must not widen the generic.
        focusAnchor: (anchor) => ctx.focus.setAnchor(anchor),
        focusNote: (noteId: string) => ctx.focus.setFocus({ type: "note", noteId }),
        openSource: ctx.setActiveSourceId,
        commands,
        fetchHits: fetchSearchHits
      }}
    />
  );
}
