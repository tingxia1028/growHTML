// SelectionFloatingToolbar — the host-level overlay that FLOATS the anchor-scope
// action toolbar just below a LIVE text selection in a reader, and disappears when the
// selection clears. It is a global overlay (mounted once in the shell chrome, like the
// BookmarkIndex), NOT docked into the layout.
//
// It reuses the dumb `SelectionToolbar` renderer (the SAME `.selection-toolbar-btn`
// row + grouped `ActionMoreMenu` the bottom/anchor surfaces use) and the SAME
// `selectionActions` list the Anchor Action Bar reads — so the floating toolbar offers
// exactly the anchor-scope actions, configured by the inline-surface prefs. It only
// TRIGGERS via `runAction` (adaptive-note contract: actions trigger, results render
// through the existing GenerationPreview / note render — never here).
//
// Rect capture (surface-agnostic, see selection/selectionRect.ts):
//   • HOST realm (pdf.js text layer, rendered in the host React tree): this component
//     listens to the host `document`'s selectionchange and computes the rect from
//     window.getSelection() — already host-viewport coords. It also detects collapse
//     here and clears.
//   • IFRAME realm (DomReader's same-doc srcDoc): DomReader publishes its range rect
//     OFFSET by the iframe element's position into the shared store; we subscribe.
//   • CROSS-REALM <webview> guests (live web / local HTML): a separate WebContents
//     can't report a rect cheaply, so they never publish — the toolbar simply does not
//     float for them (deferred by omission; the Anchor pane still lights up via IPC).
//   • Image regions have no text selection, so they never float (by design).

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useWorkspace } from "./WorkspaceContext";
import { SelectionToolbar } from "./SelectionToolbar";
import { ToolbarSlashButton } from "../slash/ToolbarSlashButton";
import { draftQuoteText } from "../focus/FocusContext";
import { usePinyinPopover } from "../speech/usePinyinPopover";
import {
  getSelectionRect,
  publishSelectionRect,
  rectFromDomRect,
  subscribeSelectionRect,
  type SelectionRect
} from "../selection/selectionRect";

/** Min gap from the viewport edges so the toolbar never sits flush against them. */
const VIEWPORT_MARGIN = 8;
/** Gap between the selection and the toolbar (below, or above when flipped). */
const SELECTION_GAP = 6;
/** Fallback height used for the flip decision before the toolbar has been measured. */
const ESTIMATED_HEIGHT = 40;

// Read the host-realm selection (pdf.js text layer etc.) as a host-viewport rect, or
// null when it's collapsed/empty. Host-document ranges are ALREADY in host-viewport
// coords (no iframe offset). Guarded for SSR/jsdom where getSelection may be absent.
//
// SCOPED to selections inside the reader (`.reader-panel`): the pdf.js text layer lives
// there, but so would an unrelated selection in the chat/notes columns — the floating
// passage toolbar must only appear over the READER, not over a chat reply. The iframe
// (DomReader) realm is already reader-only by construction.
function readHostSelectionRect(): SelectionRect | null {
  if (typeof window === "undefined") return null;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  if (!selection.toString().trim()) return null;
  const range = selection.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (!element?.closest(".reader-panel")) return null;
  return rectFromDomRect(range.getBoundingClientRect());
}

export function SelectionFloatingToolbar() {
  const { selectionActions, runAction, generating, openOperationManager, focus } = useWorkspace();
  // 注音 (SPEECH-3): hoisted popover state — clicking anything (the popover included)
  // collapses the selection, which hides this toolbar; the dialog must outlive it.
  const pinyinPopover = usePinyinPopover();
  // The current selection rect in HOST viewport coords (null = no live selection → hide).
  const [rect, setRect] = useState<SelectionRect | null>(() => getSelectionRect());
  // The computed fixed position for the toolbar (top/left), set after measuring.
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  // The portaled toolbar wrapper — measured (width/height) for centering + the flip.
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Subscribe to the shared rect store (DomReader's iframe-offset rect publishes here).
  useEffect(() => subscribeSelectionRect(setRect), []);

  // HOST-realm selection: own the "host" realm of the shared store. On every host
  // selectionchange recompute the rect (pdf.js text layer → host-viewport coords) and
  // publish it; a collapse publishes null, which clears (and hides) iff host owns it.
  useEffect(() => {
    const onSelectionChange = () => publishSelectionRect("host", readHostSelectionRect());
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, []);

  // Escape hides the toolbar (clears whichever realm currently owns the rect).
  useEffect(() => {
    if (!rect) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        publishSelectionRect("host", null);
        publishSelectionRect("iframe", null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [rect]);

  // Position the toolbar from the selection rect: centered horizontally on the
  // selection, just BELOW it; clamped to the viewport; flipped ABOVE when it would
  // overflow the bottom. Mirrors ActionMoreMenu's proven approach (measure via ref,
  // rAF re-place once painted, listeners cleaned up). Scroll/resize recompute — and a
  // scroll in a reader iframe/pdf surface naturally re-fires selectionchange too.
  useLayoutEffect(() => {
    if (!rect) return;
    const place = () => {
      const el = wrapRef.current;
      const width = el?.offsetWidth ?? 0;
      const height = el?.offsetHeight || ESTIMATED_HEIGHT;
      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;

      let left = rect.left + rect.width / 2 - width / 2;
      left = Math.max(VIEWPORT_MARGIN, Math.min(left, viewportW - width - VIEWPORT_MARGIN));

      let top = rect.bottom + SELECTION_GAP;
      if (top + height > viewportH - VIEWPORT_MARGIN) {
        const flipped = rect.top - height - SELECTION_GAP;
        top = flipped < VIEWPORT_MARGIN ? VIEWPORT_MARGIN : flipped;
      }
      setPos({ top, left });
    };
    place();
    // Re-run after first paint so the real measured width/height drive centering + flip.
    const raf = requestAnimationFrame(place);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [rect]);

  // Nothing selected, or no action to offer → no toolbar (it disappears). The 注音
  // popover still renders — it must survive the selection collapsing under a click.
  const toolbar =
    rect && selectionActions.length > 0
      ? createPortal(
          <div
            ref={wrapRef}
            className="selection-floating-toolbar"
            style={{ position: "fixed", top: pos.top, left: pos.left }}
            // Don't steal the selection: clicking a button must not collapse the range before
            // the button's onClick fires. preventDefault on mousedown keeps the selection live
            // (so runAction's passage materialization still sees it).
            onMouseDown={(event) => event.preventDefault()}
          >
            <SelectionToolbar
              visible
              items={selectionActions}
              onRun={runAction}
              busy={generating}
              onCustomize={openOperationManager}
              // 朗读 (SPEECH-1): the selected passage's text — the shared focus draft/anchor
              // is the realm-safe source (an iframe selection isn't readable from the host).
              speakText={focus.anchor?.quote ?? draftQuoteText(focus.draft)}
              // 注音 (SPEECH-3): same text, second affordance — CJK-gated in the button.
              onPinyin={pinyinPopover.open}
            />
            {/* SC-2: the `/类型` palette straight from a live selection. Always-enabled
                here (the floating toolbar only exists WITH a selection, and every dispatch
                path materializes the live focus.draft at run time); the keydown-driven
                popover + preventDefault guards keep that draft alive until the pick fires. */}
            <ToolbarSlashButton surface="selection" />
          </div>,
          document.body
        )
      : null;

  return (
    <>
      {toolbar}
      {pinyinPopover.popover}
    </>
  );
}
