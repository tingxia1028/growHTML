// Study Layer workspace view (V2) — the "layer switcher" pane. It surfaces the
// share/import layer model the V1 server already backs:
//
//   • LIST every layer over the active source (owned + imported), each with an
//     enabled TOGGLE (→ layer.toggle command). Toggling repaints the reader, because
//     the anchors endpoint hides disabled layers' anchors.
//   • EXPORT a layer → download a portable `.studypack`.
//   • IMPORT a `.studypack` file → a non-destructive PREVIEW (matched / fuzzy /
//     unmatched counts) → confirm → commit (creates an imported layer + re-located
//     anchors + notes), then the new layer appears and its matched anchors paint.
//
// Like the concept pane it is ADDITIVE (its own pane node) and talks only through the
// WorkspaceContext + entity client. Export and the two-step file import are done here
// (file IO + interactive preview) rather than as fire-and-forget commands — the same
// way URL-import / file dialogs are view/context actions; only the simple toggle is a
// command.

import { useCallback, useEffect, useRef, useState } from "react";
import { Layers, Upload, Download } from "lucide-react";
import { entityClient, type ImportPreview, type StudyLayerRecord, type StudyPack } from "../data/entityClient";
import { registerView, type WorkspaceContext } from "./viewRegistry";

// Trigger a browser/Electron-renderer download of a `.studypack`.
function downloadPack(pack: StudyPack, fileName: string) {
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

function LayerSwitcherView({ ctx }: { ctx: WorkspaceContext }) {
  const { activeSourceId, dispatch, refreshLayers, layersVersion } = ctx;
  const [layers, setLayers] = useState<StudyLayerRecord[]>([]);
  const [error, setError] = useState("");
  // The in-flight import: the parsed pack + its dry-run preview, shown for confirm.
  const [pending, setPending] = useState<{ pack: StudyPack; preview: ImportPreview } | null>(null);
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

  const toggle = useCallback(
    (layer: StudyLayerRecord) => {
      void dispatch("layer.toggle", { layerId: layer.id, enabled: !layer.enabled });
    },
    [dispatch]
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

  return (
    <aside className="layer-panel">
      <div className="panel-title">
        <Layers size={16} />
        Layers
      </div>

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

      {/* Layer list — toggle paints/hides each layer's anchors. */}
      <div className="layer-list record-list">
        {layers.map((layer) => (
          <div key={layer.id} className={`layer-item${layer.enabled ? " enabled" : ""}`} data-import-mode={layer.importMode}>
            <label className="layer-toggle-label">
              <input
                type="checkbox"
                className="layer-toggle"
                checked={layer.enabled}
                onChange={() => toggle(layer)}
              />
              <span className="layer-item-title">{layer.title}</span>
            </label>
            <div className="layer-item-meta">
              <span className="layer-badge">{layer.importMode}</span>
              {layer.author?.name ? <span className="layer-author">{layer.author.name}</span> : null}
              <button
                type="button"
                className="link-button layer-export-btn"
                title="Export as .studypack"
                onClick={() => void exportLayer(layer)}
              >
                <Download size={13} />
              </button>
            </div>
          </div>
        ))}
        {activeSourceId && layers.length === 0 ? <div className="empty-state">No layers yet.</div> : null}
        {!activeSourceId ? <div className="empty-state">Open a source to see its layers.</div> : null}
      </div>
    </aside>
  );
}

registerView({ kind: "layer.switcher", render: (_node, ctx) => <LayerSwitcherView ctx={ctx} /> });
