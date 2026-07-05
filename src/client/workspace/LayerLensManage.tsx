// LayerLensManage (R7.3) — the in-place layer MANAGEMENT surface folded into the Layer
// Lens popover (spec §8.1 "管理(就地)"). It mirrors the manager half of the
// `layer.switcher` pane (create / rename / recolor / reorder / delete custom + import /
// export `.studypack`) but is driven by the shared `useWorkspace()` layer tree state
// (ctx.sourceLayers) and refreshes through ctx.refreshLayers, so the Lens tree updates
// reactively after a mutation. The standalone `layer.switcher` pane stays as-is (its
// filter checkboxes back the layer-as-lens e2e); this is the Lens-embedded twin.

import { useCallback, useRef, useState } from "react";
import { Download, Plus, Trash2, Upload } from "lucide-react";
import { entityClient, type ImportPreview, type StudyLayerRecord, type StudyPack } from "../data/entityClient";
import type { WorkspaceContext } from "./viewRegistry";
import { buildLayerTree, type LayerNode } from "./layerTree";
import { downloadPack, isLayerEditable, isMineLayer, layerDisplayTitle, sortLayersForTree } from "./layerViews";
import { platformDialogs } from "../platform";

export function LayerLensManage({ ctx }: { ctx: WorkspaceContext }) {
  const { activeSourceId, sourceLayers, refreshLayers } = ctx;
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{ pack: StudyPack; preview: ImportPreview } | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const createLayer = useCallback(async () => {
    const title = newTitle.trim();
    if (!activeSourceId || !title) return;
    setError("");
    try {
      await entityClient.createLayer(activeSourceId, { title, order: sourceLayers.length });
      setNewTitle("");
      refreshLayers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create layer");
    }
  }, [activeSourceId, newTitle, sourceLayers.length, refreshLayers]);

  const renameLayer = useCallback(
    async (layer: StudyLayerRecord) => {
      const next = await platformDialogs().prompt("Rename layer", layer.title);
      if (!next || !next.trim() || next.trim() === layer.title) return;
      setError("");
      try {
        await entityClient.patchLayer(layer.id, { title: next.trim() });
        refreshLayers();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to rename layer");
      }
    },
    [refreshLayers]
  );

  const recolorLayer = useCallback(
    async (layer: StudyLayerRecord, color: string) => {
      setError("");
      try {
        await entityClient.patchLayer(layer.id, { color });
        refreshLayers();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to recolor layer");
      }
    },
    [refreshLayers]
  );

  // D3a (note-presentation-unified §D3): set the layer's PAINT style (highlight color +
  // decoration). Mirrors recolorLayer but writes `style` — the distinct axis from the UI
  // chip `color` above. refreshLayers repaints via the [sourceLayers] dep. Merges onto the
  // existing style so setting the color keeps the decoration and vice-versa.
  const restyleLayer = useCallback(
    async (layer: StudyLayerRecord, patch: { color?: string; decoration?: "highlight" | "underline" | "both" }) => {
      setError("");
      try {
        await entityClient.patchLayer(layer.id, { style: { ...layer.style, ...patch } });
        refreshLayers();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to restyle layer");
      }
    },
    [refreshLayers]
  );

  const reorderLayer = useCallback(
    async (layer: StudyLayerRecord, delta: number) => {
      setError("");
      try {
        await entityClient.patchLayer(layer.id, { order: (layer.order ?? 0) + delta });
        refreshLayers();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to reorder layer");
      }
    },
    [refreshLayers]
  );

  const deleteLayer = useCallback(
    async (layer: StudyLayerRecord) => {
      if (!(await platformDialogs().confirm(`Delete the "${layer.title}" layer?`))) return;
      setError("");
      try {
        await entityClient.deleteLayer(layer.id);
        refreshLayers();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete layer");
      }
    },
    [refreshLayers]
  );

  const exportLayer = useCallback(async (layer: StudyLayerRecord) => {
    setError("");
    try {
      const { pack } = await entityClient.exportLayer(layer.id);
      downloadPack(pack, `${layer.title.replace(/[^\w.-]+/g, "_") || "layer"}.studypack`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export layer");
    }
  }, []);

  const onFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setError("");
    try {
      const pack = JSON.parse(await file.text()) as StudyPack;
      const { preview } = await entityClient.importPreview(pack);
      setPending({ pack, preview });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read .studypack");
    }
  }, []);

  const confirmImport = useCallback(async () => {
    if (!pending) return;
    setError("");
    try {
      await entityClient.importCommit(pending.pack);
      setPending(null);
      refreshLayers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import layer");
    }
  }, [pending, refreshLayers]);

  const tree = buildLayerTree(sortLayersForTree(sourceLayers));

  const renderLayerNode = (node: LayerNode, depth = 0) => {
    const layer = node.layer;
    const editable = isLayerEditable(layer);
    return (
      <div key={layer.id} className="layer-tree-node" data-depth={depth}>
        <div
          className={`layer-item${layer.enabled ? " enabled" : ""}`}
          data-role={layer.role ?? "owned"}
          data-import-mode={layer.importMode}
          data-has-children={node.children.length > 0 ? "true" : "false"}
          style={{ paddingLeft: 10 + depth * 14 }}
        >
          <span className="layer-item-title" title={layer.title}>
            {layer.color ? <span className="layer-color-dot" style={{ background: layer.color }} /> : null}
            <span className="layer-item-name">{layerDisplayTitle(layer)}</span>
            {isMineLayer(layer) ? <span className="layer-item-subtitle">{layer.title}</span> : null}
          </span>
          <div className="layer-item-meta">
            {editable ? (
              <>
                <button
                  type="button"
                  className="link-button layer-up-btn"
                  title="Move up"
                  onClick={() => void reorderLayer(layer, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="link-button layer-down-btn"
                  title="Move down"
                  onClick={() => void reorderLayer(layer, 1)}
                >
                  ↓
                </button>
                <input
                  type="color"
                  className="layer-color-input"
                  aria-label="Layer color"
                  title="Recolor layer"
                  value={layer.color ?? "#2f6f64"}
                  onChange={(event) => void recolorLayer(layer, event.target.value)}
                />
                {/* D3a: the layer's PAINT color (what its anchors highlight with) + the
                    decoration shape. Distinct from the chip color above. */}
                <input
                  type="color"
                  className="layer-paint-input"
                  aria-label="Highlight color"
                  title="Highlight color for this layer's anchors"
                  value={layer.style?.color ?? layer.color ?? "#3474e6"}
                  onChange={(event) => void restyleLayer(layer, { color: event.target.value })}
                />
                <select
                  className="layer-deco-select"
                  aria-label="Highlight style"
                  title="Highlight decoration for this layer's anchors"
                  value={layer.style?.decoration ?? "both"}
                  onChange={(event) =>
                    void restyleLayer(layer, {
                      decoration: event.target.value as "highlight" | "underline" | "both"
                    })
                  }
                >
                  <option value="highlight">Highlight</option>
                  <option value="underline">Underline</option>
                  <option value="both">Both</option>
                </select>
                <button
                  type="button"
                  className="link-button layer-rename-btn"
                  title="Rename layer"
                  onClick={() => void renameLayer(layer)}
                >
                  Rename
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="link-button layer-export-btn"
              title="Export as .studypack"
              onClick={() => void exportLayer(layer)}
            >
              <Download size={13} />
            </button>
            {layer.role === "custom" ? (
              <button
                type="button"
                className="link-button layer-delete-btn"
                title="Delete custom layer"
                aria-label="Delete custom layer"
                onClick={() => void deleteLayer(layer)}
              >
                <Trash2 size={13} />
              </button>
            ) : null}
          </div>
        </div>
        {node.children.length > 0 ? (
          <div className="layer-tree-children">{node.children.map((child) => renderLayerNode(child, depth + 1))}</div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="layer-lens-manage">
      {error ? <div className="error-box">{error}</div> : null}

      <section className="layer-import">
        <button
          type="button"
          className="icon-button layer-import-btn"
          disabled={!!pending}
          onClick={() => fileRef.current?.click()}
        >
          <Upload size={15} />
          Import Layer
        </button>
        <input
          ref={fileRef}
          className="layer-import-input"
          type="file"
          accept=".studypack,.json,application/json"
          style={{ display: "none" }}
          onChange={(event) => {
            void onFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </section>

      {pending ? (
        <section className="layer-import-preview">
          <div className="layer-preview-head">
            Importing <strong>{pending.pack.layer.title}</strong>
            {pending.preview.matchedSourceId ? null : <em> (no local source matched)</em>}
          </div>
          <div className="layer-preview-stats">
            <span className="layer-stat" data-status="matched">Matched {pending.preview.stats.matched}</span>
            <span className="layer-stat" data-status="fuzzy">Fuzzy {pending.preview.stats.fuzzy}</span>
            <span className="layer-stat" data-status="unmatched">Unmatched {pending.preview.stats.unmatched}</span>
          </div>
          <div className="layer-preview-actions">
            <button type="button" className="icon-button layer-preview-confirm" onClick={() => void confirmImport()}>
              Import
            </button>
            <button type="button" className="link-button layer-preview-cancel" onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      {activeSourceId ? (
        <section className="layer-create">
          <input
            className="layer-create-input"
            value={newTitle}
            placeholder="New layer name…"
            onChange={(event) => setNewTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void createLayer();
              }
            }}
          />
          <button
            type="button"
            className="icon-button layer-create-btn"
            disabled={!newTitle.trim()}
            onClick={() => void createLayer()}
            title="Create a custom layer"
          >
            <Plus size={15} />
            Add
          </button>
        </section>
      ) : null}

      <div className="layer-list layer-lens-manage-list">
        {tree.map((node) => renderLayerNode(node))}
      </div>
    </div>
  );
}
