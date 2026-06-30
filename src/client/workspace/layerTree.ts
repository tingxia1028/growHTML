// Layer Lens hierarchy helpers (R7, spec §8) — PURE, framework-free, unit-testable.
//
// A layer carries an optional `parentId` (study-layer.ts). These helpers turn the flat
// per-source layer list into a tree, and answer the three questions the Lens UI asks of
// every parent row: which leaves does it cover (cascade target), is it on / off / mixed
// (checkbox + indeterminate), and how many notes roll up under it (count). Filter
// semantics stay per-LEAF (enabled-OR over leaf layers); a parent's checkbox is purely a
// cascade master switch + roll-up — never a membership target.

import type { NoteRecord, StudyLayerRecord } from "../data/entityClient";

export type LayerNode = {
  layer: StudyLayerRecord;
  children: LayerNode[];
};

export type ParentToggleState = "on" | "off" | "mixed";

// Build the parentId forest. Roots = layers with no parentId (or a parentId that points
// outside this set — defensive, so an orphaned child never disappears). Children keep
// their incoming order (the caller pre-sorts by order/title). Cycles are broken: a node
// is attached to a parent only if that doesn't make it its own ancestor.
export function buildLayerTree(layers: StudyLayerRecord[]): LayerNode[] {
  const nodes = new Map<string, LayerNode>();
  for (const layer of layers) nodes.set(layer.id, { layer, children: [] });

  const isAncestor = (maybeAncestorId: string, startId: string): boolean => {
    let cur = nodes.get(startId)?.layer.parentId;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      if (cur === maybeAncestorId) return true;
      seen.add(cur);
      cur = nodes.get(cur)?.layer.parentId;
    }
    return false;
  };

  const roots: LayerNode[] = [];
  for (const layer of layers) {
    const node = nodes.get(layer.id)!;
    const parent = layer.parentId ? nodes.get(layer.parentId) : undefined;
    // Attach to a real parent unless that parent is actually a descendant (cycle guard).
    if (parent && parent.layer.id !== layer.id && !isAncestor(layer.id, parent.layer.id)) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

// The leaf layer ids under a node (a leaf = a node with no children). A leaf node returns
// its own id. These are the layers the parent's cascade toggle actually flips, and whose
// membership the enabled-OR filter reads.
export function descendantLeafIds(node: LayerNode): string[] {
  if (node.children.length === 0) return [node.layer.id];
  return node.children.flatMap(descendantLeafIds);
}

// A parent's tri-state from its descendant leaves' enabled set: all on / none on / mixed.
export function parentToggleState(node: LayerNode, enabledIds: Set<string>): ParentToggleState {
  const leaves = descendantLeafIds(node);
  if (leaves.length === 0) return "off";
  const on = leaves.filter((id) => enabledIds.has(id)).length;
  if (on === 0) return "off";
  if (on === leaves.length) return "on";
  return "mixed";
}

// Count of DISTINCT non-bookmark notes whose membership intersects `layerIds` — the Lens
// row count. For a leaf that's its own count; for a parent it's the roll-up over its
// descendant leaves (distinct, so a note shared across two leaves isn't double-counted).
export function countNotesInLayers(
  notes: NoteRecord[],
  layerIds: Iterable<string>,
  bookmarkContentType: string
): number {
  const set = layerIds instanceof Set ? layerIds : new Set(layerIds);
  let count = 0;
  for (const note of notes) {
    if ((note.contentType ?? "markdown") === bookmarkContentType) continue;
    if (note.layerIds.some((id) => set.has(id))) count += 1;
  }
  return count;
}
