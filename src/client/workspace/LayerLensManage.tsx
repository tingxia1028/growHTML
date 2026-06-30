// LayerLensManage (R7.3) — the in-place layer MANAGEMENT surface folded into the Layer
// Lens popover (spec §8.1 "管理(就地)"). It mirrors the manager half of the
// `layer.switcher` pane (create / rename / recolor / reorder / delete custom + import /
// export `.studypack`) but is driven by the shared `useWorkspace()` layer state
// (ctx.sourceLayers) and refreshes through ctx.refreshLayers, so the Lens tree updates
// reactively after a mutation. The standalone `layer.switcher` pane stays as-is (its
// filter checkboxes back the layer-as-lens e2e); this is the Lens-embedded twin.

import { useCallback, useRef, useState } from "react";
import { Download, Plus, Trash2, Upload } from "lucide-react";
import { entityClient, type ImportPreview, type StudyLayerRecord, type StudyPack } from "../data/entityClient";
import type { WorkspaceContext } from "./viewRegistry";
import { downloadPack, GROUP_ORDER, groupOf } from "./layerViews";

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
      const next = typeof window !== "undefined" ? window.prompt("Rename layer", layer.title) : null;
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
      if (typeof window !== "undefined" && !window.confirm(`Delete the "${layer.title}" layer?`)) return;
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

  const sorted = [...sourceLayers].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title)
  );

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
        {GROUP_ORDER.map(({ key, label }) => {
          const group = sorted.filter((layer) => groupOf(layer) === key);
          if (group.length === 0) return null;
          return (
            <div key={key} className="layer-group" data-group={key}>
              <div className="layer-group-title">{label}</div>
              {group.map((layer) => {
                const editable = groupOf(layer) === "owned" || groupOf(layer) === "custom";
                return (
                  <div key={layer.id} className="layer-item" data-role={layer.role ?? "owned"}>
                    <span className="layer-item-title">
                      {layer.color ? <span className="layer-color-dot" style={{ background: layer.color }} /> : null}
                      {layer.title}
                    </span>
                    <div className="layer-item-meta">
                      {editable ? (
                        <>
                          <button type="button" className="link-button layer-up-btn" title="Move up" onClick={() => void reorderLayer(layer, -1)}>↑</button>
                          <button type="button" className="link-button layer-down-btn" title="Move down" onClick={() => void reorderLayer(layer, 1)}>↓</button>
                          <input
                            type="color"
                            className="layer-color-input"
                            aria-label="Layer color"
                            title="Recolor layer"
                            value={layer.color ?? "#2f6f64"}
                            onChange={(event) => void recolorLayer(layer, event.target.value)}
                          />
                          <button type="button" className="link-button layer-rename-btn" title="Rename layer" onClick={() => void renameLayer(layer)}>Rename</button>
                        </>
                      ) : null}
                      <button type="button" className="link-button layer-export-btn" title="Export as .studypack" onClick={() => void exportLayer(layer)}>
                        <Download size={13} />
                      </button>
                      {layer.role === "custom" ? (
                        <button type="button" className="link-button layer-delete-btn" title="Delete custom layer" aria-label="Delete custom layer" onClick={() => void deleteLayer(layer)}>
                          <Trash2 size={13} />
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
