// Study Report list view (REPORT-1 delta 1 — the REACHABILITY fix). A source-less report
// note persists but NO existing surface lists it (every note list is source-scoped). This
// registered VIEW (registerView, the ReviewPanel/mistakeBookView precedent — shell-imported
// for its side effect) is the report's HOME: it lists every study-report.report note across
// the vault via entityClient.allNotes() (the 错题本 cross-source idiom, filtered to the
// report type), newest-first, each rendered through getNoteType("study-report.report")
// .render — the ONE adaptive-note contract.
//
// DEVIATION (delta 1, noted): the shell's shipped preview→Save loop (FloatingNoteEditor →
// savePendingDraft → anchor.add-note) GATES on ctx.sourceId || focus (registry.ts:418), so a
// truly SOURCE-LESS vault-level report can't save through it when no source is open. To
// preserve source-less + reachability + the adaptive-note render + user-edit-before-save,
// this view owns its OWN preview loop: generateStudyReport() → an inline preview (the SAME
// .generation-preview / .gen-preview-* contract + getNoteType render/edit) → Save via
// entityClient.createNote({ anchorIds: [] }) (source-less, ungated). Register-only kit code;
// no core edit. The study-report.generate COMMAND (delta-3 re-merge) stays registered for
// callers that DO have a source in context + global reachability.
//
// IRON LAW: it talks only through entityClient + the registries (the mistakeBookView idiom).
// Registered as kind "report.list".

import { useCallback, useEffect, useState } from "react";
import { FileText, Sparkles, X } from "lucide-react";
import { getNoteType } from "../../client/notes/noteTypeRegistry";
import { entityClient, type NoteRecord } from "../../client/data/entityClient";
import { registerView, type WorkspaceContext } from "../../client/workspace/viewRegistry";
import { STUDY_REPORT_CONTENT_TYPE } from "./contentTypes";
import { generateStudyReport } from "./commands";
import "./studyReport.css";

/** createdAt is on the wire (server envelope) even though the client NoteRecord type omits
    it — read it defensively for the recency sort; absent orders last (as ""). */
function createdAtOf(note: NoteRecord): string {
  const c = (note as { createdAt?: unknown }).createdAt;
  return typeof c === "string" ? c : "";
}

export function ReportListView(_props: { ctx: WorkspaceContext }) {
  const [notes, setNotes] = useState<NoteRecord[] | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // The view-owned preview draft (source-less). Null = list mode.
  const [draft, setDraft] = useState<unknown>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Cross-source read (the review panel's 全库 edge, the 错题本 idiom). Degrade to [] on
  // failure. Re-runs on reloadKey so a just-saved report appears without a manual refresh.
  useEffect(() => {
    let live = true;
    void entityClient
      .allNotes()
      .then(({ notes: all }) => {
        if (live) setNotes(all);
      })
      .catch(() => {
        if (live) setNotes([]);
      });
    return () => {
      live = false;
    };
  }, [reloadKey]);

  const reports = (notes ?? [])
    .filter((note) => note.contentType === STUDY_REPORT_CONTENT_TYPE)
    .slice()
    .sort((a, b) => createdAtOf(b).localeCompare(createdAtOf(a))); // newest first

  const plugin = getNoteType(STUDY_REPORT_CONTENT_TYPE);

  // Generate → hold the deterministic (delta-3 re-merged) content in the inline preview.
  const generate = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const { content } = await generateStudyReport(entityClient.generateStructured);
      setDraft(content);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败");
    } finally {
      setBusy(false);
    }
  }, []);

  // Save the (possibly edited) draft as a SOURCE-LESS note (anchorIds:[], no sourceId), then
  // reload the list so it appears. This is the ungated source-less path (see the deviation).
  const save = useCallback(async () => {
    if (draft === null) return;
    setBusy(true);
    setError("");
    try {
      await entityClient.createNote({ anchorIds: [], contentType: STUDY_REPORT_CONTENT_TYPE, content: draft });
      setDraft(null);
      setEditing(false);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }, [draft]);

  const discard = useCallback(() => {
    setDraft(null);
    setEditing(false);
  }, []);

  return (
    <aside className="study-report-list">
      <div className="panel-title">
        <FileText size={16} />
        学习报告
      </div>

      <div className="study-report-toolbar">
        <button type="button" className="study-report-generate-btn" onClick={() => void generate()} disabled={busy || draft !== null}>
          <Sparkles size={13} />
          {busy && draft === null ? "生成中…" : "生成学习报告"}
        </button>
      </div>

      {error ? <div className="study-report-error">{error}</div> : null}

      {/* Inline preview (the FloatingNoteEditor contract, view-owned so source-less Save is
          ungated). Edit toggles the type's registry editor; Save persists source-less. */}
      {draft !== null ? (
        <div className="study-report-preview generation-preview" role="dialog" aria-label="study-report draft" data-content-type={STUDY_REPORT_CONTENT_TYPE}>
          <div className="generation-preview-head">
            <span className="generation-preview-label">Preview</span>
            <span className="generation-preview-type">{STUDY_REPORT_CONTENT_TYPE}</span>
            <button type="button" className="floating-note-editor-close" aria-label="Discard draft" onClick={discard}>
              <X size={14} />
            </button>
          </div>
          <div className="generation-preview-body">
            {plugin
              ? editing
                ? plugin.edit!({ content: draft, onChange: setDraft })
                : plugin.render({ content: draft })
              : null}
          </div>
          <div className="generation-preview-actions">
            <button type="button" className="gen-preview-save" onClick={() => void save()} disabled={busy}>
              Save
            </button>
            <button type="button" className="gen-preview-edit" onClick={() => setEditing((v) => !v)} disabled={!plugin}>
              {editing ? "Done editing" : "Edit"}
            </button>
            <button type="button" className="gen-preview-discard" onClick={discard} disabled={busy}>
              Discard
            </button>
          </div>
        </div>
      ) : null}

      <div className="study-report-list-body record-list">
        {reports.map((note) => (
          <div key={note.id} className="study-report-item" data-note-id={note.id}>
            {plugin ? plugin.render({ content: note.content, note }) : null}
          </div>
        ))}
        {notes !== null && reports.length === 0 && draft === null ? (
          <div className="study-report-empty">还没有学习报告。点“生成学习报告”,把这段时间的学习总结成一份报告。</div>
        ) : null}
      </div>
    </aside>
  );
}

registerView({ kind: "report.list", render: (_node, ctx) => <ReportListView ctx={ctx} /> });
