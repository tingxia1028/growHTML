// GlobalSpeakSelection (SPEECH-1b — 朗读通用化). The user's law (2026-07-04): "读本质上
// 不是一个 anchor 的能力，而是所有文本的可读能力" — read-aloud belongs to ANY text in the
// app, not to per-surface bolt-ons. This is the HOST-level layer: mounted ONCE in the
// WorkspaceShell chrome (a sibling of SelectionFloatingToolbar, same host-mount idiom),
// it listens to the host document's selectionchange/mouseup and floats a small 朗读 chip
// near the end of any non-empty text selection — chat replies, note lists, panels,
// headers: everything that lives in the host document.
//
// Exclusion rule (no double-serving): a selection whose anchorNode sits inside the
// source-viewer pane (`.reader-panel` — the SAME container SelectionFloatingToolbar
// scopes itself to) is the reader toolbar's job (it already carries 朗读, SPEECH-1), so
// the chip stays hidden there. Reader iframes/webview guests never reach the host
// selection anyway (separate realm/WebContents), so they're excluded by construction.
//
// Kept deliberately dumb (entity/registry law): TEXT-TO-SPEECH ONLY — no anchor
// materialization, no persistence, no focus writes. The chip reads selection.toString()
// and hands it to the shared useSpeakText; while speaking it flips to 停止 and survives
// a cleared selection so the stop affordance stays reachable. Escape stops + dismisses;
// scrolling hides an idle chip; the shared speech status gates rendering entirely.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Square, Volume2 } from "lucide-react";
import { useSpeakText } from "./useSpeakText";
import "./globalSpeakSelection.css";

/** The source-viewer pane container — selections in there belong to the reader's own
 *  floating toolbar (SelectionFloatingToolbar scopes to the same selector). */
export const VIEWER_PANE_SELECTOR = ".reader-panel";

/** Min gap from the viewport edges so the chip never sits flush against them. */
const VIEWPORT_MARGIN = 8;
/** Gap between the selection rect and the chip. */
const SELECTION_GAP = 6;
/** Fallbacks for the flip/clamp decision before the chip has been measured. */
const ESTIMATED_WIDTH = 72;
const ESTIMATED_HEIGHT = 30;

type SelectionSnapshot = {
  /** What the chip will speak — selection.toString(), trimmed. */
  text: string;
  /** The selection range's bounding rect (host-viewport coords). */
  rect: { top: number; left: number; right: number; bottom: number };
};

// Read the current host-document selection as a chip snapshot, or null when there is
// nothing the GLOBAL chip should serve: collapsed/empty selections, selections while
// typing in a text field, and selections inside the reader pane (excluded — see above).
function readGlobalSelection(): SelectionSnapshot | null {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  // Selecting inside an input/textarea/contenteditable is editing, not reading.
  const active = document.activeElement;
  if (
    active instanceof HTMLElement &&
    (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)
  ) {
    return null;
  }
  const selection = document.getSelection?.();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const text = selection.toString().trim();
  if (!text) return null;
  const node = selection.anchorNode;
  const element =
    node && node.nodeType === Node.ELEMENT_NODE ? (node as Element) : (node?.parentElement ?? null);
  if (element?.closest(VIEWER_PANE_SELECTOR)) return null; // the reader toolbar's turf
  // Guarded: jsdom's Range has no layout (no getBoundingClientRect) — degrade to a
  // zero rect (the chip clamps to the viewport margin) instead of crashing.
  const range = selection.getRangeAt(0);
  const rect =
    typeof range.getBoundingClientRect === "function"
      ? range.getBoundingClientRect()
      : { top: 0, left: 0, right: 0, bottom: 0 };
  return { text, rect: { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom } };
}

export function GlobalSpeakSelection() {
  const { speak, stop, speaking, available } = useSpeakText();
  const [snap, setSnap] = useState<SelectionSnapshot | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const chipRef = useRef<HTMLButtonElement | null>(null);
  // Live `speaking` for the document-level listeners without re-subscribing per change.
  const speakingRef = useRef(speaking);
  speakingRef.current = speaking;

  // Track the host selection. A cleared selection hides the chip UNLESS it is currently
  // the 停止 affordance for a live utterance (dropping it would strand the playback).
  useEffect(() => {
    const update = () => {
      const next = readGlobalSelection();
      if (next) setSnap(next);
      else if (!speakingRef.current) setSnap(null);
    };
    document.addEventListener("selectionchange", update);
    document.addEventListener("mouseup", update);
    return () => {
      document.removeEventListener("selectionchange", update);
      document.removeEventListener("mouseup", update);
    };
  }, []);

  // When playback ends and the selection is already gone, the kept-alive chip goes too.
  useEffect(() => {
    if (!speaking && !readGlobalSelection()) setSnap(null);
  }, [speaking]);

  // Escape stops + dismisses. Any scroll hides an IDLE chip (its rect is stale); a
  // speaking chip stays put so 停止 remains reachable.
  useEffect(() => {
    if (!snap) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      stop();
      setSnap(null);
    };
    const onScroll = () => {
      if (!speakingRef.current) setSnap(null);
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [snap, stop]);

  // Place the chip near the SELECTION END (just below the rect's right edge), clamped
  // to the viewport and flipped above when it would overflow the bottom — the same
  // measure→rAF-re-place idiom SelectionFloatingToolbar uses.
  useLayoutEffect(() => {
    if (!snap) return;
    const place = () => {
      const el = chipRef.current;
      const width = el?.offsetWidth || ESTIMATED_WIDTH;
      const height = el?.offsetHeight || ESTIMATED_HEIGHT;
      let left = snap.rect.right;
      left = Math.max(VIEWPORT_MARGIN, Math.min(left, window.innerWidth - width - VIEWPORT_MARGIN));
      let top = snap.rect.bottom + SELECTION_GAP;
      if (top + height > window.innerHeight - VIEWPORT_MARGIN) {
        const flipped = snap.rect.top - height - SELECTION_GAP;
        top = flipped < VIEWPORT_MARGIN ? VIEWPORT_MARGIN : flipped;
      }
      setPos({ top, left });
    };
    place();
    const raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [snap]);

  // Lane unavailable (server probe said no) or nothing selected → render nothing.
  if (!available || !snap) return null;

  return createPortal(
    <button
      ref={chipRef}
      type="button"
      className="global-speak-chip"
      data-speaking={speaking || undefined}
      style={{ position: "fixed", top: pos.top, left: pos.left }}
      aria-label={speaking ? "停止" : "朗读"}
      title={speaking ? "停止朗读" : "朗读选中的文字"}
      // Don't steal the selection: preventDefault on mousedown keeps the range live so
      // onClick still sees the text (the SelectionFloatingToolbar idiom).
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => (speaking ? stop() : void speak(snap.text))}
    >
      {speaking ? <Square size={12} /> : <Volume2 size={14} />}
      <span className="global-speak-chip-label">{speaking ? "停止" : "朗读"}</span>
    </button>,
    document.body
  );
}
