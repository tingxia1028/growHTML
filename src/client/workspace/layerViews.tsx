// Study Layer workspace view (V2 → layer-as-lens) — the "layer switcher" pane. It is
// both the multi-select FILTER and the layer MANAGER over the active source:
//
//   • FILTER: every layer over the source is a checkbox in a parentId tree. Checking it
//     INCLUDES that lens in the view; the filter is OR across checked layers. A parent
//     toggle cascades over itself + descendants, because Mine can carry notes and own
//     preset/custom child layers.
//   • MANAGER: create a CUSTOM layer; rename / recolor / reorder any owned/custom layer;
//     delete a CUSTOM layer (preset / owned / imported are structural — no delete).
//   • EXPORT a layer → a portable `.studypack`; IMPORT a `.studypack` (preview → commit).
//   • PROTECTED sharing (.svpack): a 分享… action on shareable rows + a 导入 .svpack
//     button — both just open the dialogs in svpackViews (the flows live there).
//
// Like the concept pane it is ADDITIVE (its own pane node) and talks only through the
// WorkspaceContext + entity client. Export and the two-step file import are done here
// (file IO + interactive preview); the simple enabled toggle is the layer.toggle command,
// reused as the filter include/exclude (routed through ctx.toggleLayerFilter).

import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, Download, Plus, Share2, Lock, Trash2 } from "lucide-react";
import { entityClient, type ImportPreview, type StudyLayerRecord, type StudyPack } from "../data/entityClient";
import { registerView, type WorkspaceContext } from "./viewRegistry";
import { SvpackExportDialog, SvpackImportDialog } from "./svpackViews";
import { buildLayerTree, coveredLayerIds, parentToggleState, type LayerNode } from "./layerTree";

// Trigger a browser/Electron-renderer download of a `.studypack`.
export function downloadPack(pack: StudyPack, fileName: string) {
  const blob = new Blob([JSON.stringify(pack, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function sortLayersForTree(layers: StudyLayerRecord[]): StudyLayerRecord[] {
  return [...layers].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title));
}

export function isMineLayer(layer: StudyLayerRecord): boolean {
  return layer.importMode === "owned" && !layer.role && !layer.parentId;
}

export function layerDisplayTitle(layer: StudyLayerRecord): string {
  return isMineLayer(layer) ? "Mine" : layer.title;
}

export function isLayerEditable(layer: StudyLayerRecord): boolean {
  return !layer.sealed && layer.importMode === "owned" && layer.role !== "preset" && layer.role !== "shared";
}

export function isLayerShareable(layer: StudyLayerRecord): boolean {
  return !layer.sealed && layer.importMode !== "imported" && layer.importMode !== "subscribed" && layer.role !== "shared";
}

function LayerSwitcherView({ ctx }: { ctx: WorkspaceContext }) {
  const { activeSourceId, refreshLayers, layersVersion, toggleLayerFilter, setLayersEnabled } = ctx;
  const [layers, setLayers] = useState<StudyLayerRecord[]>([]);
  const [error, setError] = useState("");
  // The in-flight import: the parsed pack + its dry-run preview, shown for confirm.
  const [pending, setPending] = useState<{ pack: StudyPack; preview: ImportPreview } | null>(null);
  // The new-custom-layer draft title (the create row), kept local to the pane.
  const [newTitle, setNewTitle] = useState("");
  // Protected sharing dialogs (svpackViews): the layer being 分享'd / the import flow.
  const [shareLayer, setShareLayer] = useState<StudyLayerRecord | null>(null);
  const [svpackImportOpen, setSvpackImportOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    if (!activeSourceId) {
      setLayers([]);
      return;
    }
    setError("");
    try {
      const response = await entityClient.layers(activeSourceId);
      setLayers(response.layers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load layers");
    }
  }, [activeSourceId]);

  // Reload on mount, source change, and whenever a layer command mutated data.
  useEffect(() => {
    void load();
  }, [load, layersVersion]);

  // The filter toggle — routes through the shared context action (layer.toggle command)
  // so the reader repaints + the note list re-filters off the same enabled set.
  const toggle = useCallback(
    (layer: StudyLayerRecord) => {
      toggleLayerFilter(layer);
    },
    [toggleLayerFilter]
  );

  const enabledLayerIds = ctx.enabledLayerIds ?? new Set(layers.filter((layer) => layer.enabled).map((layer) => layer.id));

  const toggleNode = useCallback(
    (node: LayerNode) => {
      if (node.children.length > 0 && typeof setLayersEnabled === "function") {
        const nextEnabled = parentToggleState(node, enabledLayerIds) !== "on";
        void setLayersEnabled(coveredLayerIds(node), nextEnabled);
        return;
      }
      toggle(node.layer);
    },
    [enabledLayerIds, setLayersEnabled, toggle]
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

  // —— manager actions ——
  // Create a custom layer (ordered after the existing layers), then reload.
  const createLayer = useCallback(async () => {
    const title = newTitle.trim();
    if (!activeSourceId || !title) return;
    setError("");
    try {
      await entityClient.createLayer(activeSourceId, { title, order: layers.length });
      setNewTitle("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create layer");
    }
  }, [activeSourceId, newTitle, layers.length, load]);

  // Rename — a single-field prompt keeps the pane compact (mirrors the source-delete
  // confirm pattern). No-op on cancel / unchanged.
  const renameLayer = useCallback(
    async (layer: StudyLayerRecord) => {
      const next = typeof window !== "undefined" ? window.prompt("Rename layer", layer.title) : null;
      if (!next || !next.trim() || next.trim() === layer.title) return;
      setError("");
      try {
        await entityClient.patchLayer(layer.id, { title: next.trim() });
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to rename layer");
      }
    },
    [load]
  );

  // Recolor — the color input emits a hex string; persist it as the layer's chip color.
  const recolorLayer = useCallback(
    async (layer: StudyLayerRecord, color: string) => {
      setError("");
      try {
        await entityClient.patchLayer(layer.id, { color });
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to recolor layer");
      }
    },
    [load]
  );

  // D3a (note-presentation-unified §D3): set the layer's PAINT style (highlight color +
  // decoration) — the distinct axis from the chip `color` above. Merges onto the existing
  // style so setting the color keeps the decoration and vice-versa. Unlike recolorLayer,
  // the paint style FEEDS the paint pipeline, so we must ALSO refreshLayers() — that re-runs
  // buildPaintPipeline (via the [sourceLayers] dep) so the reader re-tints immediately.
  const restyleLayer = useCallback(
    async (layer: StudyLayerRecord, patch: { color?: string; decoration?: "highlight" | "underline" | "both" }) => {
      setError("");
      try {
        await entityClient.patchLayer(layer.id, { style: { ...layer.style, ...patch } });
        await load();
        refreshLayers();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to restyle layer");
      }
    },
    [load, refreshLayers]
  );

  // Reorder — nudge a layer up/down by swapping `order` with its neighbour in the same
  // group (presentation only; the server sorts by `order`).
  const reorderLayer = useCallback(
    async (layer: StudyLayerRecord, delta: number) => {
      const nextOrder = (layer.order ?? 0) + delta;
      setError("");
      try {
        await entityClient.patchLayer(layer.id, { order: nextOrder });
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to reorder layer");
      }
    },
    [load]
  );

  // Delete — only CUSTOM layers (the server 409s otherwise; the control is hidden for
  // non-custom). Notes keep their other memberships.
  const deleteLayer = useCallback(
    async (layer: StudyLayerRecord) => {
      if (typeof window !== "undefined" && !window.confirm(`Delete the "${layer.title}" layer?`)) return;
      setError("");
      try {
        await entityClient.deleteLayer(layer.id);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete layer");
      }
    },
    [load]
  );

  // Step 1: a file was chosen → parse + dry-run preview (nothing persisted).
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

  // Step 2: user confirmed → commit, then reload list + repaint reader.
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

  const tree = buildLayerTree(sortLayersForTree(layers));

  const renderLayerNode = (node: LayerNode, depth = 0) => {
    const layer = node.layer;
    const state = node.children.length > 0 ? parentToggleState(node, enabledLayerIds) : layer.enabled ? "on" : "off";
    const editable = isLayerEditable(layer);
    return (
      <div key={layer.id} className="layer-tree-node" data-depth={depth}>
        <div
          className={`layer-item${state !== "off" ? " enabled" : ""}`}
          data-import-mode={layer.importMode}
          data-role={layer.role ?? "owned"}
          data-layer-state={state}
          data-has-children={node.children.length > 0 ? "true" : "false"}
          style={{ paddingLeft: 10 + depth * 14 }}
        >
          <label className="layer-toggle-label sv-check" data-state={state}>
            <input
              type="checkbox"
              className="layer-toggle sv-check-input"
              checked={state === "on"}
              aria-checked={state === "mixed" ? "mixed" : state === "on"}
              onChange={() => toggleNode(node)}
            />
            <span className="sv-check-box" aria-hidden="true" />
            {layer.color ? <span className="layer-color-dot" style={{ background: layer.color }} /> : null}
            <span className="layer-item-title" title={layer.title}>
              <span className="layer-item-name">{layerDisplayTitle(layer)}</span>
              {isMineLayer(layer) ? <span className="layer-item-subtitle">{layer.title}</span> : null}
            </span>
          </label>
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
            {isLayerShareable(layer) ? (
              <button
                type="button"
                className="link-button layer-share-btn"
                title="以受保护 .svpack 分享（每位接收者一个口令）"
                onClick={() => setShareLayer(layer)}
              >
                <Share2 size={13} /> 分享…
              </button>
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
    <aside className="layer-panel">
      {error ? <div className="error-box">{error}</div> : null}

      <section className="layer-import">
        <button
          type="button"
          className="icon-button layer-import-btn"
          disabled={!!pending}
          onClick={() => fileRef.current?.click()}
        >
          <Upload size={16} />
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
            event.target.value = ""; // allow re-picking the same file
          }}
        />
        {/* Protected import — opens the svpack dialog (inspect → code → preview → commit). */}
        <button
          type="button"
          className="icon-button svpack-import-open-btn"
          onClick={() => setSvpackImportOpen(true)}
        >
          <Lock size={16} />
          导入 .svpack
        </button>
      </section>

      {/* Import preview: the 3-state match summary + per-anchor list, awaiting confirm. */}
      {pending ? (
        <section className="layer-import-preview">
          <div className="layer-preview-head">
            Importing <strong>{pending.pack.layer.title}</strong>
            {pending.preview.matchedSourceId ? null : <em> (no local source matched)</em>}
          </div>
          <div className="layer-preview-stats">
            <span className="layer-stat" data-status="matched">
              Matched {pending.preview.stats.matched}
            </span>
            <span className="layer-stat" data-status="fuzzy">
              Fuzzy {pending.preview.stats.fuzzy}
            </span>
            <span className="layer-stat" data-status="unmatched">
              Unmatched {pending.preview.stats.unmatched}
            </span>
          </div>
          <ul className="layer-preview-anchors">
            {pending.preview.anchors.map((anchor) => (
              <li key={anchor.refId} className="layer-preview-anchor" data-status={anchor.status}>
                <span className="layer-preview-kind">{anchor.anchorKind}</span>
                <span className="layer-preview-status">{anchor.status}</span>
              </li>
            ))}
          </ul>
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

      {/* Create a custom layer (the manager's add row). */}
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
            <Plus size={16} />
            Add Layer
          </button>
        </section>
      ) : null}

      {/* Tree layer list — parentId is the only organization primitive. */}
      <div className="layer-list record-list">
        {tree.map((node) => renderLayerNode(node))}
        {activeSourceId && layers.length === 0 ? <div className="empty-state">No layers yet.</div> : null}
        {!activeSourceId ? <div className="empty-state">Open a source to see its layers.</div> : null}
      </div>

      {/* Protected-sharing dialogs (portal-rendered; a successful import refreshes the
          layer list + repaints the reader through the shared refreshLayers idiom). */}
      {shareLayer ? <SvpackExportDialog layer={shareLayer} onClose={() => setShareLayer(null)} /> : null}
      {svpackImportOpen ? (
        <SvpackImportDialog onClose={() => setSvpackImportOpen(false)} onCommitted={refreshLayers} />
      ) : null}
    </aside>
  );
}

registerView({ kind: "layer.switcher", render: (_node, ctx) => <LayerSwitcherView ctx={ctx} /> });
