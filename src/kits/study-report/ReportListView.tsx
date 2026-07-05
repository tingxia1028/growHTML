// Study Report list view (REPORT-1 delta 1 — the REACHABILITY fix). A source-less report
// note persists but NO existing surface lists it (every note list is source-scoped). This
// registered VIEW (registerView, the ReviewPanel/mistakeBookView precedent — shell-imported
// for its side effect) is the report's HOME: it lists every study-report.report note across
// the vault via entityClient.allNotes() (the 错题本 cross-source idiom, filtered to the
// report type), newest-first, each rendered through getNoteType("study-report.report")
// .render — the ONE adaptive-note contract. A 生成学习报告 button dispatches the generate
// command (→ the shipped preview→edit→Save loop); Save lands here, so the loop closes.
//
// IRON LAW: it talks only through the shared WorkspaceContext (dispatch) + the registries.
// Registered as kind "report.list".

import { useEffect, useState } from "react";
import { FileText, Sparkles } from "lucide-react";
import { getNoteType } from "../../client/notes/noteTypeRegistry";
import { entityClient, type NoteRecord } from "../../client/data/entityClient";
import { registerView, type WorkspaceContext } from "../../client/workspace/viewRegistry";
import { STUDY_REPORT_CONTENT_TYPE } from "./contentTypes";
import "./studyReport.css";

/** createdAt is on the wire (server envelope) even though the client NoteRecord type omits
    it — read it defensively for the recency sort; absent orders last (as ""). */
function createdAtOf(note: NoteRecord): string {
  const c = (note as { createdAt?: unknown }).createdAt;
  return typeof c === "string" ? c : "";
}

export function ReportListView({ ctx }: { ctx: WorkspaceContext }) {
  const { dispatch } = ctx;
  const [notes, setNotes] = useState<NoteRecord[] | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Cross-source read (the review panel's 全库 edge, the 错题本 idiom). Degrade to [] on
  // failure — an empty list is honest; it never breaks the shell. Re-runs on reloadKey so
  // a just-saved report appears without a manual refresh.
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

  const generate = () => {
    // Fire the generate command → the shell's onGenerated drives the preview→Save loop.
    // Bump reloadKey so the list re-reads once the user saves (an eventual refresh; the
    // e2e also re-navigates, which remounts fresh).
    void dispatch("study-report.generate", {}).then(() => setReloadKey((k) => k + 1));
  };

  return (
    <aside className="study-report-list">
      <div className="panel-title">
        <FileText size={16} />
        学习报告
      </div>

      <div className="study-report-toolbar">
        <button type="button" className="study-report-generate-btn" onClick={generate}>
          <Sparkles size={13} />
          生成学习报告
        </button>
      </div>

      <div className="study-report-list-body record-list">
        {reports.map((note) => (
          <div key={note.id} className="study-report-item" data-note-id={note.id}>
            {plugin ? plugin.render({ content: note.content, note }) : null}
          </div>
        ))}
        {notes !== null && reports.length === 0 ? (
          <div className="study-report-empty">还没有学习报告。点“生成学习报告”,把这段时间的学习总结成一份报告。</div>
        ) : null}
      </div>
    </aside>
  );
}

registerView({ kind: "report.list", render: (_node, ctx) => <ReportListView ctx={ctx} /> });
