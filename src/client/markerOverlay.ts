// View-layer anchor-marker overlay — framework-free, works in the app document, the
// reader iframe, and the injected guest realm.
//
// WHY a separate overlay instead of injecting the marker chip into the annotated
// element: for PDF the anchor is a PDF.js `.textLayer` span scaled by a nested
// `transform: scale()`, so a child chip renders tiny (~6px) and inherits
// `color:transparent`. The correct approach (how PDF.js's own annotationLayer and
// Hypothesis work) is a SEPARATE overlay layer — a sibling of the transformed
// content, positioned in overlay/page coordinate space from each anchor's live rect,
// re-laid-out on zoom/scroll. Fixed CSS size, uniform for HTML / PDF / image.
//
// D2 two-slot markers (user-amended 2026-07-04): each anchor renders as TWO chips —
// the LEFT slot (one anchor glyph, buildAnchorSlotHtml) at the passage's FIRST line
// and the RIGHT slot (note-type icons, buildNoteSlotHtml) at its LAST line. The
// anchor's live rects come from the reader's D1 ReaderAnnotationAdapter
// (`adapter.rectsFor` — first/last/all; see surfaces/readerAnnotationAdapter.ts),
// falling back to the shared `[data-sv-key="…"]` collector (single-rect degenerate:
// first === last, both slots hang off the same line). If the anchor is virtualized
// out (e.g. a PDF page not rendered), both chips hide themselves.
//
// Clicking the LEFT slot TOGGLES that anchor's notes (note chip + hover/pinned/
// margin cards — state lives in annotationLayer's per-document store, session-
// scoped); clicking the RIGHT slot keeps today's behavior (synthesizes the anchor
// click that opens the shared grouped note card). Both still report through
// onAction (the host focus bridge / the guest's sv:marker-action channel).
//
// D2 completion (this pass):
//   • CARD-OPEN SUPPRESSION — while the shared #sv-note-card shows an anchor
//     (hover or pinned), wireNoteCard stamps `data-sv-card-open="<anchorId>"` on
//     the realm body; layout() hides BOTH of that anchor's chips so chip and card
//     never collide, and a MutationObserver on that attribute re-runs layout when
//     the card opens/closes. No new state store — the card already knows its key.
//   • SAME-LINE CLUSTERING — two+ anchors whose slot chips land within one
//     line-height collapse into ONE cluster chip carrying a count; clicking it
//     expands a mini-list (anchor glyph + quote snippet per row) and a row click
//     opens that anchor's card (the note-slot click path). The bucketing math is
//     pure (clusterSlotPlacements) and unit-tested next to this file.

import {
  ANCHOR_GLYPH,
  CARD_OPEN_ATTR,
  isAnchorNotesHidden,
  rectToOverlayLocal,
  setAnchorNotesHidden,
  type MarkerRole
} from "./annotationLayer";
import { readStoredAnchorGlyphVisibility } from "./annotations";
import {
  collectAnchorRects,
  observeDomLayout,
  type AnchorRects,
  type AnnotationRectSource
} from "./surfaces/readerAnnotationAdapter";

// One anchor's two D2 slots. An empty noteSlotHtml means "no notes" — no right
// chip is created at all.
export interface MarkerItem {
  anchorId: string;
  /** LEFT slot content — buildAnchorSlotHtml() (the "有锚点" indicator). */
  anchorSlotHtml: string;
  /** RIGHT slot content — buildNoteSlotHtml(payload); "" ⇒ no note chip. */
  noteSlotHtml: string;
  /** The anchor's passage text — the cluster mini-list row snippet (D2 clustering).
   *  Optional: a quote-less anchor (image region) rows as its anchor id. */
  quote?: string;
}

export type MarkerAction = {
  anchorId: string;
  role: MarkerRole;
};

export type MarkerOverlayOptions = {
  onAction?: (action: MarkerAction) => void;
  // The reader's D1 ReaderAnnotationAdapter (or just its measurement slice):
  // slot placement routes through adapter.rectsFor (anchor chip at `.first`,
  // note chip at `.last`), and the overlay also repositions on the adapter's
  // reader-specific layout signals (PDF zoom / textlayerrendered).
  // Omitted (legacy/tests): measurement falls back to collectAnchorRects over
  // the host element — same first/last semantics.
  adapter?: AnnotationRectSource;
};

// --- Global anchor-glyph visibility (the Anchor panel's 显示锚点标记 switch) -----
// Module-level store, REALM-LOCAL: every overlay constructed in this JS realm
// (the host document's PDF/image overlays AND the DomReader iframe overlays —
// they're built by host code) shares it and re-lays-out when it flips. The
// Electron webview guest is a separate bundle/realm: its copy lazily seeds from
// the guest page's storage (practically always the "visible" default) and is then
// driven by the host over the sv:anchors payload (electron/webview-preload.ts).
// Persistence lives in annotations.ts (readStored/persistAnchorGlyphVisibility —
// the annotation-mode localStorage idiom); this store is only the live value.
let anchorGlyphsVisible: boolean | null = null;
const anchorGlyphListeners = new Set<() => void>();

export function getAnchorGlyphVisibility(): boolean {
  if (anchorGlyphsVisible === null) anchorGlyphsVisible = readStoredAnchorGlyphVisibility();
  return anchorGlyphsVisible;
}

export function setAnchorGlyphVisibility(visible: boolean): void {
  if (getAnchorGlyphVisibility() === visible) return;
  anchorGlyphsVisible = visible;
  for (const listener of [...anchorGlyphListeners]) listener();
}

export function subscribeAnchorGlyphVisibility(listener: () => void): () => void {
  anchorGlyphListeners.add(listener);
  return () => {
    anchorGlyphListeners.delete(listener);
  };
}

// —— Same-line clustering (D2) — pure y-bucketing of slot placements ——————————
// One slot chip's target position in overlay-local coords, plus the line height
// its rect reported (the bucketing tolerance basis). Plain literals → jsdom-testable
// without live layout.
export type SlotPlacement = {
  anchorId: string;
  x: number;
  y: number;
  /** The measured line (rect) height — 0/absent falls back to a 16px line. */
  h: number;
};

export type SlotCluster = {
  /** Member anchor ids in INPUT (document) order. length 1 = no clustering. */
  anchorIds: string[];
  x: number;
  y: number;
};

const FALLBACK_LINE_HEIGHT = 16;

/**
 * Bucket slot placements by line: a placement joins the current bucket iff its y
 * is within ONE line-height of the bucket's topmost member (tolerance = that first
 * member's own height, min 16px fallback) — two chips on the same text line have
 * ~equal y, while adjacent lines differ by at least the line advance (≥ glyph
 * height), so a strict `< lineHeight` split separates them. Cluster position:
 * y = the topmost member's y; x = the LEFTMOST member x for the left/anchor side
 * (the chip pulls into the margin) and the RIGHTMOST for the right/note side (the
 * chip hangs off the passage end). Member ids keep input (document) order.
 */
export function clusterSlotPlacements(placements: SlotPlacement[], side: "anchor" | "note"): SlotCluster[] {
  if (!placements.length) return [];
  const byY = placements
    .map((placement, index) => ({ placement, index }))
    .sort((a, b) => a.placement.y - b.placement.y || a.index - b.index);
  const clusters: SlotCluster[] = [];
  let bucket: { top: number; tolerance: number; members: { placement: SlotPlacement; index: number }[] } | null = null;
  const flush = () => {
    if (!bucket) return;
    const members = [...bucket.members].sort((a, b) => a.index - b.index);
    const xs = members.map((m) => m.placement.x);
    clusters.push({
      anchorIds: members.map((m) => m.placement.anchorId),
      x: side === "anchor" ? Math.min(...xs) : Math.max(...xs),
      y: bucket.top
    });
    bucket = null;
  };
  for (const entry of byY) {
    if (bucket && entry.placement.y - bucket.top < bucket.tolerance) {
      bucket.members.push(entry);
      continue;
    }
    flush();
    bucket = {
      top: entry.placement.y,
      tolerance: entry.placement.h > 0 ? entry.placement.h : FALLBACK_LINE_HEIGHT,
      members: [entry]
    };
  }
  flush();
  return clusters;
}

// Escape a double-quote in an anchor id the same way annotationLayer/DomReader do,
// so an exotic id can't break the attribute selector.
function escapeId(id: string): string {
  return id.replace(/"/g, '\\"');
}

function closestMarkerRole(node: EventTarget | null): HTMLElement | null {
  const el = node as (HTMLElement & { closest?: HTMLElement["closest"] }) | null;
  return el?.closest?.("[data-sv-marker-role]") as HTMLElement | null;
}

type AnchorChips = { anchor: HTMLElement; note: HTMLElement | null };

export class MarkerOverlay {
  private readonly hostEl: HTMLElement;
  private readonly onAction?: (action: MarkerAction) => void;
  private readonly adapter: AnnotationRectSource | null;
  private overlay: HTMLElement | null = null;
  private readonly chips = new Map<string, AnchorChips>();
  /** Per-anchor quote snippets (from setMarkers) — the cluster mini-list rows. */
  private readonly quotes = new Map<string, string>();
  /** Live cluster chips keyed by `${side}:${ids.join("|")}` (rebuilt by layout). */
  private readonly clusterChips = new Map<string, HTMLElement>();
  /** The cluster whose mini-list is currently expanded (null = closed). */
  private openClusterKey: string | null = null;
  private clusterList: HTMLElement | null = null;
  private rafId: number | null = null;
  private readonly unsubscribes: (() => void)[] = [];

  constructor(hostEl: HTMLElement, options: MarkerOverlayOptions = {}) {
    this.hostEl = hostEl;
    this.onAction = options.onAction;
    this.adapter = options.adapter ?? null;
    // Own the ambient reflow signals (shared DOM idiom: ResizeObserver on the host +
    // capture-phase scroll — see observeDomLayout). The adapter additionally feeds
    // reader-specific signals (PDF zoom / page render) through onLayoutChange. All
    // go through the rAF-throttled reposition().
    this.unsubscribes.push(observeDomLayout(hostEl, () => this.reposition()));
    if (this.adapter?.onLayoutChange) {
      this.unsubscribes.push(this.adapter.onLayoutChange(() => this.reposition()));
    }
    // The global anchor-glyph switch re-runs layout (anchor chips hide/show).
    this.unsubscribes.push(subscribeAnchorGlyphVisibility(() => this.reposition()));
    // Card-open suppression (D2): wireNoteCard flips data-sv-card-open on the realm
    // body as the shared card shows/hides an anchor — watch that ONE attribute and
    // re-layout so the open anchor's chips hide (and restore on close). The observer
    // lives on the realm body (the card's home), cross-realm-safe via defaultView.
    const doc = hostEl.ownerDocument;
    const body = doc?.body;
    const MO = (doc?.defaultView as (Window & { MutationObserver?: typeof MutationObserver }) | null)?.MutationObserver;
    if (body && typeof MO === "function") {
      const observer = new MO(() => this.reposition());
      observer.observe(body, { attributes: true, attributeFilter: [CARD_OPEN_ATTR] });
      this.unsubscribes.push(() => observer.disconnect());
    }
    // Dismiss an expanded cluster mini-list on any outside click (realm-local).
    const onDocClick = (event: Event) => {
      if (!this.openClusterKey) return;
      const target = event.target as (Element & { closest?: Element["closest"] }) | null;
      if (target?.closest?.(".sv-cluster-list, .sv-cluster-chip")) return;
      this.closeClusterList();
    };
    doc?.addEventListener("click", onDocClick, true);
    this.unsubscribes.push(() => doc?.removeEventListener("click", onDocClick, true));
  }

  // Lazily create the overlay div (appended to the host, which must be a positioning
  // context — PDF `.pdf-reader-canvas` is position:absolute, image
  // `.image-reader-stage` is position:relative — both OK). NOT inside `.textLayer`,
  // so it inherits no transform.
  private ensureOverlay(): HTMLElement {
    if (this.overlay && this.overlay.isConnected) return this.overlay;
    const doc = this.hostEl.ownerDocument;
    const overlay = doc.createElement("div");
    overlay.className = "sv-marker-overlay";
    overlay.setAttribute("data-sv", "1");
    this.hostEl.appendChild(overlay);
    this.overlay = overlay;
    return overlay;
  }

  // Replace all chips with (up to) two per anchor — the D2 slots — then reposition.
  setMarkers(items: MarkerItem[]): void {
    const overlay = this.ensureOverlay();
    this.clear();
    for (const item of items) {
      const anchor = this.createChip(overlay, item.anchorId, "anchor", item.anchorSlotHtml);
      const note = item.noteSlotHtml ? this.createChip(overlay, item.anchorId, "note", item.noteSlotHtml) : null;
      this.chips.set(item.anchorId, { anchor, note });
      if (item.quote) this.quotes.set(item.anchorId, item.quote);
    }
    this.reposition();
  }

  private createChip(overlay: HTMLElement, anchorId: string, slot: "anchor" | "note", html: string): HTMLElement {
    const doc = this.hostEl.ownerDocument;
    const chip = doc.createElement("div");
    chip.className = `sv-anchor-markers sv-slot-${slot}`;
    chip.setAttribute("data-sv", "1");
    chip.setAttribute("data-sv-marker-for", anchorId);
    chip.setAttribute("data-sv-slot", slot);
    chip.innerHTML = html;
    chip.addEventListener("click", (event) => this.handleChipClick(anchorId, event));
    overlay.appendChild(chip);
    return chip;
  }

  private anchorFor(anchorId: string): HTMLElement | null {
    return this.hostEl.querySelector(`[data-sv-key="${escapeId(anchorId)}"]`) as HTMLElement | null;
  }

  // Measurement goes through the D1 adapter contract: first/last/all rects of every
  // element carrying the anchor's data-sv-key (a multi-span PDF anchor reports ALL
  // its spans, not just the first the old querySelector saw). Without an adapter,
  // fall back to the same shared collector over the host element.
  private rectsFor(anchorId: string): AnchorRects | null {
    if (this.adapter) return this.adapter.rectsFor(anchorId);
    return collectAnchorRects(this.hostEl, anchorId);
  }

  private handleChipClick(anchorId: string, event: MouseEvent): void {
    const roleEl = closestMarkerRole(event.target);
    const role = roleEl?.getAttribute("data-sv-marker-role") as MarkerRole | null;
    if (role !== "anchor" && role !== "note") return;
    event.preventDefault();
    event.stopPropagation();
    if (role === "anchor") {
      // LEFT slot (user-amended D2): toggle this anchor's notes.
      this.toggleAnchorNotes(anchorId);
      this.onAction?.({ anchorId, role });
    } else {
      // RIGHT slot: today's behavior — open the anchor's card (+ report the action).
      this.openAnchorCard(anchorId);
    }
  }

  // Synthesize the anchor click that opens the shared grouped note card in this
  // realm, and report a "note" action to the host bridge. Shared by the note-slot
  // chip AND the cluster mini-list rows.
  private openAnchorCard(anchorId: string): void {
    const anchor = this.anchorFor(anchorId);
    if (anchor) {
      const view = this.hostEl.ownerDocument.defaultView;
      const EventCtor = view?.MouseEvent ?? MouseEvent;
      anchor.dispatchEvent(new EventCtor("click", { bubbles: true, cancelable: true }));
    }
    this.onAction?.({ anchorId, role: "note" });
  }

  // Flip the per-anchor "notes hidden" state. The store lives in annotationLayer
  // (keyed by this realm's document) so the shared card + margin machinery consult
  // the same state; the overlay only re-lays-out its chips. Returns the NEW state.
  toggleAnchorNotes(anchorId: string): boolean {
    const doc = this.hostEl.ownerDocument;
    const hidden = !isAnchorNotesHidden(doc, anchorId);
    setAnchorNotesHidden(doc, anchorId, hidden);
    this.reposition();
    return hidden;
  }

  // rAF-throttled: read the host rect once, then place each anchor's two chips at
  // its live first/last rects in overlay-local coords. Chips whose anchor element
  // is gone (page virtualized out) hide themselves. Runs synchronously if there's
  // no rAF (jsdom).
  reposition(): void {
    const view = this.hostEl.ownerDocument?.defaultView;
    const run = () => {
      this.rafId = null;
      this.layout();
    };
    if (view && typeof view.requestAnimationFrame === "function") {
      if (this.rafId != null) return;
      this.rafId = view.requestAnimationFrame(run);
    } else {
      run();
    }
  }

  private layout(): void {
    if (!this.overlay || !this.chips.size) return;
    // Reference the OVERLAY div's own rect, not hostEl's. Each chip is absolutely
    // positioned relative to the overlay (its offset parent); the overlay is
    // `position:absolute; inset:0` inside the reader's `overflow:auto` container, so it
    // SCROLLS WITH the content (its top = hostEl.top − scrollTop). Using hostEl's rect
    // as the reference would leave a constant scroll-offset error (chip drifts off by
    // scrollTop). Referencing the overlay makes chip placement self-consistent — and,
    // since overlay + anchors scroll together, chips track scroll even between repaints.
    const overlayRect = this.overlay.getBoundingClientRect();
    const origin = { left: overlayRect.left, top: overlayRect.top };
    const doc = this.hostEl.ownerDocument;
    const glyphsVisible = getAnchorGlyphVisibility();
    // Card-open suppression (D2): the anchor whose card the shared #sv-note-card is
    // currently showing (hover or pinned) hides BOTH its chips — wireNoteCard stamps
    // the id on the realm body; the constructor's MutationObserver re-ran us here.
    const cardOpenId = doc?.body?.getAttribute(CARD_OPEN_ATTR) ?? "";

    // Pass 1 — resolve each anchor's slots to overlay-local placements, applying the
    // per-anchor visibility rules (missing rects / card-open / notes-toggle / the
    // global glyph switch). Suppressed slots hide immediately and never cluster.
    const anchorSlots: SlotPlacement[] = [];
    const noteSlots: SlotPlacement[] = [];
    for (const [anchorId, chips] of this.chips) {
      const rects = this.rectsFor(anchorId);
      if (!rects || anchorId === cardOpenId) {
        chips.anchor.style.display = "none";
        if (chips.note) chips.note.style.display = "none";
        continue;
      }
      const notesHidden = isAnchorNotesHidden(doc, anchorId);
      // LEFT slot: the anchor glyph at the FIRST line's left edge (the stylesheet
      // pulls it fully into the margin via translateX(-100%)). Hidden by the
      // global 显示锚点标记 switch; dimmed (data attr) while its notes are toggled off.
      if (notesHidden) chips.anchor.setAttribute("data-sv-notes-hidden", "1");
      else chips.anchor.removeAttribute("data-sv-notes-hidden");
      if (glyphsVisible) {
        anchorSlots.push({
          anchorId,
          x: rects.first.left - origin.left,
          y: rects.first.top - origin.top,
          h: rects.first.height
        });
      } else {
        chips.anchor.style.display = "none";
      }
      // RIGHT slot: the note-type icons at the LAST line's right edge (top-right
      // hang, same as the old single chip). Hidden while the anchor's notes are
      // toggled off. NOT affected by the global switch (note slots stay).
      if (chips.note) {
        if (notesHidden) {
          chips.note.style.display = "none";
        } else {
          const local = rectToOverlayLocal(rects.last, origin);
          noteSlots.push({ anchorId, x: local.x, y: local.y, h: rects.last.height });
        }
      }
    }

    // Pass 2 — same-line clustering per slot side: singleton clusters place the
    // anchor's own chip; multi clusters hide the member chips behind ONE cluster chip.
    const nextClusters = new Map<string, SlotCluster & { side: "anchor" | "note" }>();
    this.placeSide("anchor", anchorSlots, nextClusters);
    this.placeSide("note", noteSlots, nextClusters);
    this.syncClusterChips(nextClusters);
  }

  // Place one side's slots after clustering. Singletons position the member's own
  // chip (same math as before clustering existed); multi-member clusters hide the
  // member chips and register a cluster chip for syncClusterChips.
  private placeSide(
    side: "anchor" | "note",
    slots: SlotPlacement[],
    nextClusters: Map<string, SlotCluster & { side: "anchor" | "note" }>
  ): void {
    const chipFor = (anchorId: string): HTMLElement | null => {
      const chips = this.chips.get(anchorId);
      return side === "anchor" ? (chips?.anchor ?? null) : (chips?.note ?? null);
    };
    for (const cluster of clusterSlotPlacements(slots, side)) {
      if (cluster.anchorIds.length === 1) {
        const chip = chipFor(cluster.anchorIds[0]);
        if (!chip) continue;
        chip.style.left = `${cluster.x}px`;
        chip.style.top = `${cluster.y}px`;
        chip.style.display = "";
        continue;
      }
      for (const anchorId of cluster.anchorIds) {
        const chip = chipFor(anchorId);
        if (chip) chip.style.display = "none";
      }
      nextClusters.set(`${side}:${cluster.anchorIds.join("|")}`, { ...cluster, side });
    }
  }

  // Reconcile the cluster-chip pool against this layout's clusters: create missing
  // chips, position all, drop stale ones. An expanded mini-list follows its chip and
  // closes when its cluster dissolves (members scrolled apart / suppressed).
  private syncClusterChips(nextClusters: Map<string, SlotCluster & { side: "anchor" | "note" }>): void {
    const overlay = this.ensureOverlay();
    const doc = this.hostEl.ownerDocument;
    for (const [key, chip] of this.clusterChips) {
      if (!nextClusters.has(key)) {
        chip.remove();
        this.clusterChips.delete(key);
      }
    }
    for (const [key, cluster] of nextClusters) {
      let chip = this.clusterChips.get(key);
      if (!chip) {
        chip = doc.createElement("div");
        chip.className = `sv-anchor-markers sv-slot-${cluster.side} sv-cluster-chip`;
        chip.setAttribute("data-sv", "1");
        chip.setAttribute("data-sv-cluster", cluster.side);
        chip.setAttribute("data-sv-cluster-ids", cluster.anchorIds.join(","));
        const label = `${cluster.anchorIds.length} anchors on this line`;
        chip.innerHTML =
          `<button type="button" class="sv-anchor-marker" title="${label}" aria-label="${label}">` +
          `${ANCHOR_GLYPH}<sup class="sv-anchor-marker-count">${cluster.anchorIds.length}</sup></button>`;
        chip.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.toggleClusterList(key);
        });
        overlay.appendChild(chip);
        this.clusterChips.set(key, chip);
      }
      chip.style.left = `${cluster.x}px`;
      chip.style.top = `${cluster.y}px`;
      chip.style.display = "";
      if (this.openClusterKey === key && this.clusterList) {
        this.clusterList.style.left = `${cluster.x}px`;
        this.clusterList.style.top = `${cluster.y + 20}px`;
      }
    }
    if (this.openClusterKey && !nextClusters.has(this.openClusterKey)) this.closeClusterList();
  }

  // Expand/collapse a cluster chip's mini-list: one row per member anchor (anchor
  // glyph + quote snippet, text-only via textContent so an exotic quote can't
  // inject); a row click opens that anchor's card (the note-slot click path).
  private toggleClusterList(key: string): void {
    if (this.openClusterKey === key) {
      this.closeClusterList();
      return;
    }
    this.closeClusterList();
    const chip = this.clusterChips.get(key);
    if (!chip) return;
    const doc = this.hostEl.ownerDocument;
    const list = doc.createElement("div");
    list.className = "sv-cluster-list";
    list.setAttribute("data-sv", "1");
    const anchorIds = (chip.getAttribute("data-sv-cluster-ids") ?? "").split(",").filter(Boolean);
    for (const anchorId of anchorIds) {
      const row = doc.createElement("button");
      row.type = "button";
      row.className = "sv-cluster-row";
      row.setAttribute("data-anchor-id", anchorId);
      row.innerHTML = ANCHOR_GLYPH;
      const snippet = doc.createElement("span");
      snippet.className = "sv-cluster-row-quote";
      const quote = (this.quotes.get(anchorId) ?? "").replace(/\s+/g, " ").trim();
      snippet.textContent = quote ? quote.slice(0, 60) : anchorId;
      row.appendChild(snippet);
      row.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.closeClusterList();
        this.openAnchorCard(anchorId);
      });
      list.appendChild(row);
    }
    list.style.left = chip.style.left;
    list.style.top = `${Number.parseFloat(chip.style.top || "0") + 20}px`;
    this.ensureOverlay().appendChild(list);
    this.clusterList = list;
    this.openClusterKey = key;
  }

  private closeClusterList(): void {
    this.clusterList?.remove();
    this.clusterList = null;
    this.openClusterKey = null;
  }

  // Remove all chips — slot chips, cluster chips, an expanded mini-list — and the
  // quote memo (keeps the overlay div for reuse).
  clear(): void {
    for (const chips of this.chips.values()) {
      chips.anchor.remove();
      chips.note?.remove();
    }
    this.chips.clear();
    for (const chip of this.clusterChips.values()) chip.remove();
    this.clusterChips.clear();
    this.closeClusterList();
    this.quotes.clear();
  }

  // Tear down: remove the overlay div and disconnect the observers/listeners
  // (including the adapter's onLayoutChange + glyph-visibility subscriptions).
  destroy(): void {
    if (this.rafId != null) {
      const view = this.hostEl.ownerDocument?.defaultView;
      view?.cancelAnimationFrame?.(this.rafId);
      this.rafId = null;
    }
    for (const unsubscribe of this.unsubscribes.splice(0)) unsubscribe();
    this.clear();
    this.overlay?.remove();
    this.overlay = null;
  }
}

// Mount a MarkerOverlay on a realm DOCUMENT's body — the shared mounting idiom for
// document-realm readers (the DomReader iframe and the Electron webview GUEST page;
// snapshot web inherits the DomReader path). The inset:0 overlay needs the body to
// be a positioning context so chips scroll with the content, so a static body is
// promoted to position:relative first (cross-realm-safe: getComputedStyle guarded).
export function mountRealmMarkerOverlay(doc: Document, options: MarkerOverlayOptions = {}): MarkerOverlay {
  const body = doc.body as HTMLElement | null;
  if (body) {
    const view = doc.defaultView;
    let pos = "";
    if (view && typeof view.getComputedStyle === "function") {
      try {
        pos = view.getComputedStyle(body).position;
      } catch {
        pos = "";
      }
    }
    if (pos === "static" || pos === "") body.style.position = "relative";
  }
  return new MarkerOverlay(body ?? doc.documentElement, options);
}
