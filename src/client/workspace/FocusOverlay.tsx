// CenterView (exported as FocusOverlay for back-compat) — the ONE shared centered full
// view (§10.1 "Center View", design plan §3.5 / decision §6.6). A PreviewCard
// double-click/click and the note viewer's "Open interactively" both open THIS overlay;
// there is no second rendering path — the body comes through the one sanctioned entry
// getNoteType(contentType).render({ ..., mode: "full" }) — the exact renderer a saved
// note / the generation preview uses, so card = overlay = saved note stay consistent.
//
// §10 header chrome (this wrapper owns it; the plugin owns only the body):
//   [type icon] Title  [Anchor P## (Section x.x)]  [Layer]  …  ⤴ open-external  ⋯  ✕
// The anchor / layer / open-external parts are OPTIONAL block metadata the host threads
// in (resolved from the note's anchor + layer); absent parts are omitted, never faked.
// The "jump back to source anchor" affordance calls block.onJumpToAnchor when supplied.
//
// Behavior: a centered modal/lightbox over a dimmed backdrop (720–920px, §10.5). Esc or
// a backdrop click closes it. Accessible: role="dialog" aria-modal, a labelled title, a
// Tab focus trap, focus moves in on open and restores to the opener on close. The live
// (heavy) full render mounts ONLY while the overlay is open.

import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Bookmark, ExternalLink, MoreHorizontal, X } from "lucide-react";
import type { NoteRecord } from "../data/entityClient";
import { getNoteType } from "../notes/noteTypeRegistry";
import { noteTypeIcon } from "../notes/noteTypeIcon";
import { InertNote } from "../notes/builtinNoteTypes";
import { noteCardMeta } from "./noteCardMeta";

export type FocusOverlayBlock = {
  /** The registered contentType deciding which plugin renders (the discriminator). */
  contentType: string;
  /** Content shaped for that type's schema (passed verbatim to the plugin render). */
  content: unknown;
  /** Optional whole note (ids/attachments) when focusing a saved note. */
  note?: NoteRecord;
  /** Optional human title shown in the card/overlay header (defaults to the contentType). */
  title?: string;
  // —— optional §10 chrome metadata (host-supplied; the component never derives these
  //    from contentType, honoring the display-side hard contract). ——
  /** Source page number for the footer "P<page>" / the header anchor chip. */
  page?: number;
  /** A content-derived hint for the card footer (e.g. "3 questions", "Python", "5 min"). */
  extra?: string;
  /** Layer name for the footer / the header layer chip. */
  layer?: string;
  /** Section label for the header anchor chip, e.g. "Section 4.2". */
  section?: string;
  /** Jump back to the source anchor (wired by the host); shows the ⤴ affordance when set. */
  onJumpToAnchor?: () => void;
};

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function FocusOverlay({ block, onClose }: { block: FocusOverlayBlock; onClose(): void }) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // The element focused before the overlay opened — focus returns here on close.
  const openerRef = useRef<Element | null>(typeof document !== "undefined" ? document.activeElement : null);
  const titleId = useId();

  // Esc to close + a Tab focus trap that keeps focus within the dialog.
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose]
  );

  // Move focus into the dialog on open; restore it to the opener on close.
  useEffect(() => {
    const root = dialogRef.current;
    const opener = openerRef.current;
    if (root) {
      const target = root.querySelector<HTMLElement>(FOCUSABLE) ?? root;
      target.focus();
    }
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  if (typeof document === "undefined") return null;

  const plugin = getNoteType(block.contentType);
  // The FULL interactive view — the SAME render a saved note uses. Mounted only now
  // (while the overlay is open). Unknown type → inert fallback (never crashes).
  const body: ReactNode = plugin
    ? plugin.render({ content: block.content, note: block.note, mode: "full" })
    : <InertNote content={block.content} />;
  const Icon = noteTypeIcon(block.contentType);
  const meta = noteCardMeta(block.contentType, block.content);
  const title = block.title ?? meta.title;
  const layer = block.layer ?? (block.note ? "My Notes" : undefined);

  // The anchor chip "Anchor P## (Section x.x)" — only when we know a page/section.
  const anchorChip =
    block.page != null
      ? `Anchor P${block.page}${block.section ? ` (${block.section})` : ""}`
      : block.section
        ? block.section
        : null;

  return createPortal(
    <div
      className="sv-focus-overlay sv-center-overlay"
      onMouseDown={(event) => {
        // Backdrop click (not a click that began inside the dialog) closes.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="sv-focus-dialog sv-center-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={dialogRef}
        onKeyDown={onKeyDown}
      >
        <div className="sv-focus-head sv-center-head">
          <span className="sv-center-icon" aria-hidden="true">
            <Icon size={16} />
          </span>
          <span id={titleId} className="sv-focus-title sv-center-title">
            {title}
          </span>
          {anchorChip ? <span className="sv-center-chip sv-center-anchor-chip">{anchorChip}</span> : null}
          {layer ? <span className="sv-center-chip sv-center-layer-chip">{layer}</span> : null}
          {/* Keep the legacy .sv-focus-type hook (names the form) for back-compat. */}
          <span className="sv-focus-type">{meta.typeLabel}</span>
          <span className="sv-center-actions">
            <button
              type="button"
              className="sv-center-action sv-center-bookmark"
              aria-label="Bookmark note"
              title="Bookmark"
            >
              <Bookmark size={16} />
            </button>
            {block.onJumpToAnchor ? (
              <button
                type="button"
                className="sv-center-action sv-center-jump"
                aria-label="Jump to source anchor"
                title="Jump to source anchor"
                onClick={block.onJumpToAnchor}
              >
                <ExternalLink size={16} />
              </button>
            ) : null}
            <button
              type="button"
              className="sv-center-action sv-center-more"
              aria-label="More actions"
              title="More actions"
            >
              <MoreHorizontal size={16} />
            </button>
            <button
              type="button"
              className="sv-focus-close sv-center-close"
              aria-label="Close"
              title="Close (Esc)"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </span>
        </div>
        <div className="sv-focus-body sv-center-body">{body}</div>
      </div>
    </div>,
    document.body
  );
}
