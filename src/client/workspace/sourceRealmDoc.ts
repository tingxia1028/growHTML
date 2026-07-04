// Per-source realm-document registry (F-1 follow-up — host-control → realm-doc bridge).
//
// The annotation-visibility singletons (annotationLayer's hide-all, markerOverlay's
// anchor-glyph switch) are now PER-REALM: keyed by the reader's realm Document. The
// live setters therefore need the realm Document, but the HOST controls that flip them
// (HideAllNotesToggle, the AnchorGlyphSwitch) render in the host React column, one level
// removed from whichever reader owns the realm.
//
// This tiny registry closes that gap WITHOUT paneId/WorkspaceContext plumbing (the
// per-paneId alternative the spec rejected): each reader that owns a realm document
// registers it here keyed by its sourceId — the DomReader iframe's contentDocument, the
// PDF/image readers' host `document` (their realm IS the host document). A host control
// resolves its pane's sourceId → the realm Document and threads it into the per-realm
// setter. Readers whose realm the host can't reach (the Electron <webview> guest) never
// register; their store is driven separately over the sv:anchors payload, so a lookup
// miss simply means "no local realm to flip" and the control falls back to persist-only.
//
// Keyed by sourceId (not paneId) so it survives a pane re-focus and needs no pane state:
// two split panes never show the SAME source (openSourceInNewPane focuses the existing
// pane), so one sourceId maps to at most one live realm.

const realmDocBySource = new Map<string, Document>();

// A reader mounts (or its realm document is (re)created) — register the realm Document
// for its source. A srcDoc reload swaps contentDocument, so the reader re-registers the
// fresh doc; the last registration for a source wins.
export function registerSourceRealmDoc(sourceId: string, doc: Document): void {
  if (!sourceId || !doc) return;
  realmDocBySource.set(sourceId, doc);
}

// The reader for `sourceId` unmounted / tore its realm down. Only clears if the stored
// doc is still the one being unregistered (a newer reader may already own the slot).
export function unregisterSourceRealmDoc(sourceId: string, doc?: Document): void {
  if (!sourceId) return;
  if (doc && realmDocBySource.get(sourceId) !== doc) return;
  realmDocBySource.delete(sourceId);
}

// The host control's lookup: the live realm Document for a source, or null if no
// host-reachable reader has registered one (e.g. a webview guest, or before mount).
export function getSourceRealmDoc(sourceId: string): Document | null {
  if (!sourceId) return null;
  const doc = realmDocBySource.get(sourceId) ?? null;
  // A stale iframe doc whose reader has been torn down is no longer connected — drop it
  // so a control never flips a dead realm.
  if (doc && !doc.defaultView) {
    realmDocBySource.delete(sourceId);
    return null;
  }
  return doc;
}
