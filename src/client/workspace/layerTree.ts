// Layer Lens hierarchy helpers (R7, spec §8) — PURE, framework-free, unit-testable.
//
// A layer carries an optional `parentId` (study-layer.ts). These helpers turn the flat
// per-source layer list into a tree, and answer the three questions the Lens UI asks of
// every parent row: which layers does it cover (cascade target), is it on / off / mixed
// (checkbox + indeterminate), and how many notes roll up under it (count). A parent can
// also carry notes itself (Mine is both the owned layer and a parent), so roll-ups include
// the parent id plus descendants.

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

// The layer ids covered by a tree node: itself plus every descendant. A parent row can be
// both a container and a real note membership target, so Mine must include its own id.
export function coveredLayerIds(node: LayerNode): string[] {
  return [node.layer.id, ...node.children.flatMap(coveredLayerIds)];
}

// Backward-compatible alias for older callers/tests. It now returns the same covered set,
// not leaf-only ids, because parent layers are allowed to hold notes.
export function descendantLeafIds(node: LayerNode): string[] {
  return coveredLayerIds(node);
}

// A parent's tri-state from its covered layers' enabled set: all on / none on / mixed.
export function parentToggleState(node: LayerNode, enabledIds: Set<string>): ParentToggleState {
  const layerIds = coveredLayerIds(node);
  const on = layerIds.filter((id) => enabledIds.has(id)).length;
  if (on === 0) return "off";
  if (on === layerIds.length) return "on";
  return "mixed";
}

// Count of DISTINCT non-bookmark notes whose membership intersects `layerIds` — the Lens
// row count. For a parent it's the roll-up over itself + descendants (distinct, so a note
// shared across two child layers isn't double-counted).
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
