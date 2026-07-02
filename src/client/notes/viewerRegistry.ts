// ViewerRegistry — the EXCLUSIVE cross-type display layer (design plugin-viewer-model
// §2 "Viewer" / §4 "独占型的解法"). A Viewer is a display surface chosen by a resolver
// following one priority chain, in contrast to the NoteType renderer (one-per-contentType)
// and to Decorations/markers (additive, all matches run — those NEVER route through here).
//
// The resolver chain (design §4), applied EXACTLY in this order:
//
//   user explicit association  >  match() specificity/score  >  priority  >
//   registration order (last-wins + console.warn)  >  fallback (the NoteType renderer)
//
// A `Viewer` declares `match(input) → number` (0 = declines the input; higher = more
// specific), a `render(input)`, and an optional `priority`. The host calls
// `resolveViewer(input, prefs)` to pick the winner; the caller renders the winning
// viewer, OR — when the resolver returns the `"notetype"` sentinel — falls back to
// `getNoteType(contentType).render(...)` (the adaptive-note contract). A user can PIN a
// viewer per-note or per-contentType (persisted in plugin-prefs `viewerAssociations`),
// which overrides everything as long as the pinned viewer still matches (or is the
// sentinel). This is a React-agnostic registry: it stores `ReactNode`-returning render
// fns but imports no React runtime, so tests can register plain viewers.

import type { ReactNode } from "react";
import type { NoteRecord, SourceRecord, PluginPrefs } from "../data/entityClient";
import { isPluginEffectiveInstalled } from "../../kits/installState";

// What a viewer is asked to match/render against. All fields optional so a viewer can key
// off whichever locator it understands (a saved note, a raw source/file, or just a
// contentType). Mirrors the design's "match(note|file)".
export type ViewerInput = {
  note?: NoteRecord;
  source?: SourceRecord;
  contentType?: string;
  /** The raw content shaped for `contentType`, when there is no saved `note` to key off
      (the chat/preview card path hands content directly). A viewer that keys off a note's
      body should read `content ?? note?.content`. */
  content?: unknown;
  /** The render altitude the caller wants — "card" = a light preview, "full" = the heavy
      interactive view. Only present on render(); the resolver ignores it. */
  mode?: "card" | "full";
};

// A registered viewer. `match` returns 0 to DECLINE the input and a positive score to
// accept (higher = more specific — the host takes the highest). `priority` breaks ties
// between equal scores (design §4); default 0.
export type Viewer = {
  id: string;
  /** The owning plugin/kit id (for the equal-tie warning + the manager panel). */
  pluginId?: string;
  label: string;
  /** 0 = decline; higher = more specific. */
  match(input: ViewerInput): number;
  render(input: ViewerInput): ReactNode;
  /** Tie-break for equal match scores; default 0. */
  priority?: number;
};

// The `"notetype"` sentinel = "no viewer won; fall back to getNoteType(contentType).render".
// A user association may pin exactly this sentinel to force the NoteType renderer even
// when a viewer would otherwise match.
export const NOTETYPE_SENTINEL = "notetype" as const;

// The winner + provenance the caller needs. `viewerId` is a real viewer id OR the sentinel;
// `source` names WHICH tier of the chain decided it; `candidates` is every viewer that
// matched (score>0), most-specific first, for the "Open with…" / conflict UI.
export type ResolveResult = {
  viewerId: string | typeof NOTETYPE_SENTINEL;
  source: "user" | "match" | "priority" | "order" | "fallback";
  candidates: { id: string; label: string; score: number }[];
};

// Registration order matters (last-registered wins an equal score+priority tie), so this
// is an insertion-ordered array, not a Map. De-duped by id (a re-register replaces in place
// but keeps original order — matching the note-type registry's idempotency).
const registry: Viewer[] = [];

export function registerViewer(viewer: Viewer): void {
  const index = registry.findIndex((v) => v.id === viewer.id);
  if (index === -1) registry.push(viewer);
  else registry[index] = viewer;
}

export function listViewers(): readonly Viewer[] {
  return registry;
}

export function getViewer(id: string): Viewer | undefined {
  return registry.find((v) => v.id === id);
}

/** Test hook — clear the viewer registry so a spec starts from empty. */
export function resetViewers(): void {
  registry.length = 0;
}

// The candidates a given input matches (score>0), in REGISTRATION order (so a later
// caller can apply the last-wins tie-break by reading right-to-left). Each carries its
// score; sorting/tie-breaking is the resolver's job.
//
// Marketplace eligibility (plugin-viewer-model §8.5.1): a viewer owned by a cataloged
// plugin that is NOT effective-installed DECLINES here — it is filtered from the
// candidate set, so display falls down the chain to the NoteType renderer (the exact
// pre-viewer behavior). Viewers with no/uncataloged pluginId are always eligible.
function matchingViewers(input: ViewerInput): { viewer: Viewer; score: number }[] {
  const out: { viewer: Viewer; score: number }[] = [];
  for (const viewer of registry) {
    if (!isPluginEffectiveInstalled(viewer.pluginId)) continue; // uninstalled → declines
    let score = 0;
    try {
      score = viewer.match(input);
    } catch {
      // A viewer whose match() throws simply declines — it must never break resolution.
      score = 0;
    }
    if (score > 0) out.push({ viewer, score });
  }
  return out;
}

/**
 * Resolve the exclusive viewer for `input`, following the design §4 chain EXACTLY:
 *
 *   1. USER association — `prefs.viewerAssociations.byNoteId[note.id]` then
 *      `byContentType[contentType]`. Honored iff the pinned viewer still `match()>0`
 *      OR is the `"notetype"` sentinel. (byNoteId beats byContentType; a stale pin whose
 *      viewer no longer matches is ignored and resolution continues.)
 *   2. MATCH — the highest `match()` score across registered viewers (score>0).
 *   3. PRIORITY — tie-break equal top scores on `priority ?? 0` (higher wins).
 *   4. ORDER — tie-break equal score+priority on registration order (LAST registered
 *      wins) and `console.warn` naming both viewers.
 *   5. FALLBACK — no viewer matched → the `"notetype"` sentinel (caller uses
 *      getNoteType(contentType).render).
 *
 * `candidates` always reflects tier-2's matching set (most-specific first), regardless of
 * which tier ultimately decided, so the "Open with…" / conflict UI can list the options.
 */
export function resolveViewer(input: ViewerInput, prefs?: PluginPrefs): ResolveResult {
  const matches = matchingViewers(input);
  // Candidates: matched viewers, highest score first, ties in registration order.
  const candidates = matches
    .slice()
    .sort((a, b) => b.score - a.score)
    .map((m) => ({ id: m.viewer.id, label: m.viewer.label, score: m.score }));

  // ── Tier 1: user explicit association (byNoteId beats byContentType). ────────────
  const associations = prefs?.viewerAssociations;
  const noteId = input.note?.id;
  const contentType = input.contentType ?? input.note?.contentType;
  const pinnedId =
    (noteId ? associations?.byNoteId?.[noteId] : undefined) ??
    (contentType ? associations?.byContentType?.[contentType] : undefined);
  if (pinnedId) {
    // The sentinel is always honorable (force the NoteType renderer).
    if (pinnedId === NOTETYPE_SENTINEL) {
      return { viewerId: NOTETYPE_SENTINEL, source: "user", candidates };
    }
    // A pinned real viewer is honored only while it still matches this input.
    const stillMatches = matches.some((m) => m.viewer.id === pinnedId);
    if (stillMatches) {
      return { viewerId: pinnedId, source: "user", candidates };
    }
    // Stale pin → ignore and continue down the chain.
  }

  // ── Tier 5 (early exit): nothing matched → fall back to the NoteType renderer. ───
  if (matches.length === 0) {
    return { viewerId: NOTETYPE_SENTINEL, source: "fallback", candidates };
  }

  // ── Tier 2: highest match() score. ───────────────────────────────────────────────
  const topScore = Math.max(...matches.map((m) => m.score));
  const topScored = matches.filter((m) => m.score === topScore);
  if (topScored.length === 1) {
    return { viewerId: topScored[0].viewer.id, source: "match", candidates };
  }

  // ── Tier 3: tie-break on priority (higher wins). ─────────────────────────────────
  const topPriority = Math.max(...topScored.map((m) => m.viewer.priority ?? 0));
  const topPriored = topScored.filter((m) => (m.viewer.priority ?? 0) === topPriority);
  if (topPriored.length === 1) {
    return { viewerId: topPriored[0].viewer.id, source: "priority", candidates };
  }

  // ── Tier 4: registration order — LAST registered wins + warn. ────────────────────
  // `matchingViewers` preserves registration order, so the last element of `topPriored`
  // is the most-recently-registered viewer at this score+priority.
  const winner = topPriored[topPriored.length - 1];
  const names = topPriored.map((m) => `"${m.viewer.id}"`).join(", ");
  console.warn(
    `[viewerRegistry] ambiguous viewer resolution at equal score (${topScore}) and priority ` +
      `(${topPriority}) among ${names}; last-registered "${winner.viewer.id}" wins.`
  );
  return { viewerId: winner.viewer.id, source: "order", candidates };
}
