// Pending-review-scope seam — a tiny module-scope hand-off so the 错题本's 复习错题 button
// can launch the review runner INTO a scoped session (mistakes-only) without threading a
// param through navigateShell or growing WorkspaceContext (IRON LAW). Mirrors shellNav.ts's
// pending-value idiom: a module-scope slot, a setter the launcher calls, and a read-and-clear
// consumer the ReviewPanel calls once on mount (so a later plain launch isn't stuck scoped).
//
// The scope is DELIBERATELY minimal: only "mistakes" today (the one scoped-launch this
// deepening ships). It is a VIEW filter, not a queue-policy change — the queue already
// assembles mistakes first (queue.ts); the panel just hides non-mistakes for this session.

export type ReviewScopeKind = "mistakes";

let pendingReviewScope: ReviewScopeKind | null = null;

/** The launcher (错题本 → 复习错题) arms the next review mount with this scope. */
export function setPendingReviewScope(scope: ReviewScopeKind): void {
  pendingReviewScope = scope;
}

/**
 * Read AND CLEAR the pending scope (consume-once). The ReviewPanel calls this on mount:
 * a scoped launch surfaces mistakes-only; every subsequent (unscoped) mount reads null and
 * behaves exactly as before — a byte-identical regression guarantee.
 */
export function consumePendingReviewScope(): ReviewScopeKind | null {
  const scope = pendingReviewScope;
  pendingReviewScope = null;
  return scope;
}
