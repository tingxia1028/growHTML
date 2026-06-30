// groupActions — the ONE pure helper that buckets a merged ToolbarAction list into the
// fixed, ordered group sections the "More" menu renders. Every action surface (inline /
// anchor / bottom) feeds its full action list through this so the grouped overflow looks
// identical everywhere. It is intentionally pure (no React, no ctx) so it can be unit
// tested in isolation and reused by any surface — the menu only RENDERS the result.
//
// Buckets are emitted in this FIXED order (matching the canonical `group` values the
// WorkspaceContext assigns): Create Note → AI Actions → Study Actions → Custom Actions,
// then a trailing `Other` bucket that collects any action whose group is unknown/missing.
// Empty buckets are dropped, so a surface only shows the sections it actually has.

import type { ToolbarAction } from "./WorkspaceContext";

/** The canonical, ordered group buckets (the trailing `Other` catches the rest). */
export const ACTION_GROUP_ORDER = ["Create Note", "AI Actions", "Study Actions", "Custom Actions"] as const;

/** The fallback bucket label for an action with an unknown / missing `group`. */
export const OTHER_GROUP = "Other";

export type ActionGroup = { group: string; items: ToolbarAction[] };

/**
 * Bucket `items` by `action.group` into the fixed ordered buckets, with a trailing
 * `Other` bucket for any unknown/missing group. Empty buckets are omitted. Item order
 * inside each bucket preserves the incoming (prefs-ordered) order.
 */
export function groupActions(items: ToolbarAction[]): ActionGroup[] {
  const known = new Set<string>(ACTION_GROUP_ORDER);
  const buckets = new Map<string, ToolbarAction[]>();
  // Seed in fixed order so the output order is stable regardless of item order.
  for (const group of ACTION_GROUP_ORDER) buckets.set(group, []);
  buckets.set(OTHER_GROUP, []);

  for (const item of items) {
    const group = item.group && known.has(item.group) ? item.group : OTHER_GROUP;
    buckets.get(group)!.push(item);
  }

  const out: ActionGroup[] = [];
  for (const [group, bucketItems] of buckets) {
    if (bucketItems.length) out.push({ group, items: bucketItems });
  }
  return out;
}
