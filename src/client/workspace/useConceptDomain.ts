// PLAT-LAYER Part-2 Slice 3 — the CONCEPT domain hook. Almost a TIER-A leaf, with
// exactly ONE injected back-edge: `refreshAnnotations`. Extracted VERBATIM from
// WorkspaceContext.tsx: the `conceptsVersion` token (concept views watch it to
// re-fetch), the 标为概念 (CONCEPT-UX-1) `conceptMark` toast payload + its monotonic
// `conceptMarkSeqRef`, and the three actions `refreshConcepts` / `undoConceptMark` /
// `dismissConceptMark`. `undoConceptMark`'s inline `entityClient.deleteNote` call moves
// in here too — progress toward the provider "only-composes" acceptance.
//
// The one back-edge: `undoConceptMark` deletes the marker note (removing the
// anchor↔concept link + its derived paint) and then must REPAINT — it does that by
// awaiting the provider's `refreshAnnotations`, which is injected as a read-only dep. Its
// `useCallback` deps therefore include `refreshAnnotations` (the injected back-edge) so
// the repaint always fires against the current pipeline state. Until Slice 4 extracts the
// documents domain, `refreshAnnotations` is a provider callback that is NOT memo-stable
// (it re-derives on activeSourceId/sourceBundles/renderedHtml changes); that is fine here
// — the concept surface's identity only tracks its OWN fields, and `undoConceptMark`
// being re-created when `refreshAnnotations` changes does not re-render consumers unless
// `undoConceptMark` is itself a value-memo dep (it is, via the spread — but it changes on
// the SAME cadence the inline callback did, so behavior is identical to before extraction).
//
// The coordinator's onConceptMarked/onConceptChanged/onRelationChanged handlers stay in
// the provider (Slice 7) but drive concept state THROUGH this surface's setters:
//   - `bumpConceptsVersion()` — the token nudge onConceptChanged/onRelationChanged did
//     inline (`setConceptsVersion(v => v + 1)`).
//   - `notifyConceptMarked(mark)` — parks the toast payload the way onConceptMarked did,
//     INCLUDING the seq increment, so `conceptMarkSeqRef` stays fully owned by this hook
//     (the coordinator never touches the ref).
//
// The surface is a `useMemo`-wrapped object so its identity is STABLE across unrelated
// provider re-renders — the memoized-surface contract the whole Part-2 split depends on: a
// fresh object literal each render would bust the provider's value memo and re-render all
// 25 consumers. Follows the proven `useChatSessions` / `useLayoutDomain` reference.

import { useCallback, useMemo, useRef, useState } from "react";
import { entityClient } from "../data/entityClient";
import type { ConceptMarkFeedback } from "./WorkspaceContext";

/** The concept toast payload the coordinator hands `notifyConceptMarked` — everything
    but the `seq`, which this hook stamps from its own monotonic ref. */
export type ConceptMarkInput = Omit<ConceptMarkFeedback, "seq">;

export interface ConceptDomain {
  // —— concept-view refresh token ——
  conceptsVersion: number;
  refreshConcepts(): void;
  // —— 标为概念 (CONCEPT-UX-1) toast ——
  conceptMark: ConceptMarkFeedback | null;
  undoConceptMark(): Promise<void>;
  dismissConceptMark(): void;
  // —— coordinator seams (the still-in-provider commandContext drives concept state
  //    through these; onConceptMarked/onConceptChanged/onRelationChanged stay in Slice 7) ——
  /** Bump `conceptsVersion` so concept views re-fetch (onConceptChanged/onRelationChanged). */
  bumpConceptsVersion(): void;
  /** Park the 标为概念 toast payload (onConceptMarked); stamps the monotonic seq internally. */
  notifyConceptMarked(mark: ConceptMarkInput): void;
}

export function useConceptDomain({
  refreshAnnotations,
  onError
}: {
  /** The one back-edge: repaint after undo deletes the marker note. Provider callback
      until Slice 4; matches the provider's `(sourceId?: string) => Promise<void>|void`. */
  refreshAnnotations: (sourceId?: string) => Promise<void> | void;
  /** Decoupled error sink (the provider's `setError`) — undo surfaces a delete failure. */
  onError: (message: string) => void;
}): ConceptDomain {
  // —— concepts / relations ——
  // A monotonically-increasing token bumped whenever a concept/relation/link command
  // mutates entity data. Concept views watch it to re-fetch (they own their own list
  // + detail state via the entity client, so the context stays the single seam
  // without ballooning with concept-specific data).
  const [conceptsVersion, setConceptsVersion] = useState(0);
  // 标为概念 feedback (CONCEPT-UX-1): the pending toast payload + a monotonic counter
  // so a rapid second mark re-arms the toast timer (seq changes even on equal names).
  const [conceptMark, setConceptMark] = useState<ConceptMarkFeedback | null>(null);
  const conceptMarkSeqRef = useRef(0);

  const refreshConcepts = useCallback(() => setConceptsVersion((value) => value + 1), []);

  // Cheap undo for 标为概念: delete the just-created marker note — that removes the
  // anchor↔concept link (and the paint, since painting is note-derived). The concept
  // RECORD itself stays: the entity client has no concept-delete API, and a reusable
  // empty concept is harmless (documented CONCEPT-UX-1 decision).
  const undoConceptMark = useCallback(async () => {
    const mark = conceptMark;
    if (!mark) return;
    setConceptMark(null);
    try {
      await entityClient.deleteNote(mark.noteId);
      setConceptsVersion((value) => value + 1);
      await refreshAnnotations();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to undo concept mark");
    }
  }, [conceptMark, refreshAnnotations, onError]);

  const dismissConceptMark = useCallback(() => setConceptMark(null), []);

  // —— coordinator seams ——
  // The token nudge onConceptChanged/onRelationChanged did inline. Split from
  // `refreshConcepts` only by name/intent; both bump the same version token.
  const bumpConceptsVersion = useCallback(() => setConceptsVersion((value) => value + 1), []);

  // Park the 标为概念 toast payload the way the coordinator's onConceptMarked did,
  // stamping the monotonic seq from this hook's own ref so a rapid second mark re-arms
  // the toast's auto-dismiss timer. Keeps `conceptMarkSeqRef` fully owned here.
  const notifyConceptMarked = useCallback((mark: ConceptMarkInput) => {
    conceptMarkSeqRef.current += 1;
    setConceptMark({ ...mark, seq: conceptMarkSeqRef.current });
  }, []);

  return useMemo<ConceptDomain>(
    () => ({
      conceptsVersion,
      refreshConcepts,
      conceptMark,
      undoConceptMark,
      dismissConceptMark,
      bumpConceptsVersion,
      notifyConceptMarked
    }),
    [
      conceptsVersion,
      refreshConcepts,
      conceptMark,
      undoConceptMark,
      dismissConceptMark,
      bumpConceptsVersion,
      notifyConceptMarked
    ]
  );
}
