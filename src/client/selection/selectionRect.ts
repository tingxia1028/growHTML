// selectionRect — a tiny surface-agnostic pub/sub for the CURRENT text selection's
// bounding rect in HOST viewport coordinates. The floating selection toolbar
// subscribes to it; the reader surfaces (or the toolbar itself, for host-realm
// selections) publish into it.
//
// Why a shared store instead of threading a prop: a live text selection can live in
// DIFFERENT realms depending on the surface — the HOST document (pdf.js text layer,
// rendered in the host React tree) or a same-doc IFRAME (DomReader's srcDoc, whose
// range rects are in the iframe's coordinate space and must be offset by the iframe
// element's position to map into the host viewport). Cross-realm <webview> guests
// can't report a rect cheaply (separate WebContents), so they simply never publish —
// the toolbar just doesn't float for them (deferred, by omission, no special-casing).
//
// The store keeps ONE rect keyed by a `realm` token so each publisher only clears its
// own: the host-realm listener (in the toolbar) owns "host"; DomReader owns "iframe".
// Whichever published most recently wins; publishing null for a realm clears it iff
// that realm currently owns the rect.

export type SelectionRect = {
  /** Host-viewport coords (px), the SAME space `getBoundingClientRect` returns. */
  top: number;
  left: number;
  width: number;
  height: number;
  bottom: number;
};

/** Which surface realm published the current rect (so each clears only its own). */
export type SelectionRealm = "host" | "iframe";

type Entry = { realm: SelectionRealm; rect: SelectionRect } | null;

let current: Entry = null;
const listeners = new Set<(rect: SelectionRect | null) => void>();

function emit() {
  const rect = current?.rect ?? null;
  for (const listener of listeners) listener(rect);
}

// Publish (or clear) the selection rect for a realm. A non-null rect always wins and
// takes ownership. A null clears ONLY if the calling realm currently owns the rect —
// so a host-realm collapse doesn't wipe a live iframe selection's rect and vice versa.
export function publishSelectionRect(realm: SelectionRealm, rect: SelectionRect | null): void {
  if (rect) {
    current = { realm, rect };
    emit();
    return;
  }
  if (current?.realm === realm) {
    current = null;
    emit();
  }
}

/** The current rect (null when there is no live selection). */
export function getSelectionRect(): SelectionRect | null {
  return current?.rect ?? null;
}

/** Subscribe to rect changes; returns an unsubscribe disposer. */
export function subscribeSelectionRect(listener: (rect: SelectionRect | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Normalize a DOMRect-like into our plain SelectionRect, applying an optional offset
// (the host-viewport position of an iframe element, for same-doc iframe ranges). A
// zero-area rect (collapsed / detached range) returns null so callers can clear.
export function rectFromDomRect(
  domRect: { top: number; left: number; width: number; height: number; bottom: number } | null | undefined,
  offset?: { left: number; top: number }
): SelectionRect | null {
  if (!domRect || (domRect.width === 0 && domRect.height === 0)) return null;
  const dx = offset?.left ?? 0;
  const dy = offset?.top ?? 0;
  return {
    top: domRect.top + dy,
    left: domRect.left + dx,
    width: domRect.width,
    height: domRect.height,
    bottom: domRect.bottom + dy
  };
}
