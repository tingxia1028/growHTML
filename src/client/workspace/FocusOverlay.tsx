// FocusOverlay — the shared "centered interactive overlay" capability (design plan
// §3.5 requirement 1/2, decision §6.6). It is ONE component used uniformly by BOTH
// the chat thread and the note viewer: an ArtifactCard click opens this overlay, and
// the note viewer focuses a rich note into the SAME overlay. There is no second
// rendering path — the overlay renders the block's FULL interactive view through the
// one sanctioned entry, getNoteType(contentType).render({ ..., mode: "full" }) — the
// exact renderer a saved note / the generation preview uses, so card = overlay =
// saved note are visually consistent.
//
// Behavior: a centered modal/lightbox over a dimmed backdrop. Esc or a backdrop
// click closes it. Accessible: role="dialog" aria-modal, a labelled title, a focus
// trap (Tab cycles within the dialog), focus moves in on open and is restored to the
// opener on close. The live (heavy) render mounts ONLY while the overlay is open — so
// many interactive forms never run inline in the thread at once.

import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { NoteRecord } from "../data/entityClient";
import { getNoteType } from "../notes/noteTypeRegistry";
import { InertNote } from "../notes/builtinNoteTypes";

export type FocusOverlayBlock = {
  /** The registered contentType deciding which plugin renders (the discriminator). */
  contentType: string;
  /** Content shaped for that type's schema (passed verbatim to the plugin render). */
  content: unknown;
  /** Optional whole note (ids/attachments) when focusing a saved note. */
  note?: NoteRecord;
  /** Optional human title shown in the overlay header (defaults to the contentType). */
  title?: string;
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

  return createPortal(
    <div
      className="sv-focus-overlay"
      onMouseDown={(event) => {
        // Backdrop click (not a click that began inside the dialog) closes.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="sv-focus-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={dialogRef}
        onKeyDown={onKeyDown}
      >
        <div className="sv-focus-head">
          <span id={titleId} className="sv-focus-title">
            {block.title ?? block.contentType}
          </span>
          <span className="sv-focus-type">{block.contentType}</span>
          <button
            type="button"
            className="sv-focus-close"
            aria-label="Close"
            title="Close (Esc)"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
        <div className="sv-focus-body">{body}</div>
      </div>
    </div>,
    document.body
  );
}
