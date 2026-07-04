// D10 export — a reader-toolbar control that exports the current source's notes +
// anchors (+ their persisted positions) to a portable markdown + JSON bundle
// (note-presentation-unified.md §10). Client-side download (mirrors the svpack
// downloadSvpackFile idiom); the pure model lives in notesExport.ts.

import { Download } from "lucide-react";
import type { WorkspaceContext } from "./viewRegistry";
import {
  buildNotesExport,
  downloadTextFile,
  notesExportToMarkdown,
  safeExportFileName
} from "./notesExport";
import { defineMessages, t, useLocale } from "../i18n";

const messages = defineMessages({
  exportNotes: { zh: "导出笔记", en: "Export notes" }
});

export function ExportNotesButton({ ctx }: { ctx: WorkspaceContext }) {
  useLocale();
  const { activeSource, anchors, visibleNotes } = ctx;
  if (!activeSource) return null;

  const sourceNotes = visibleNotes.filter((note) => note.sourceId === activeSource.id);
  const disabled = sourceNotes.length === 0;

  const onExport = () => {
    if (disabled) return;
    const anchorIds = new Set(sourceNotes.flatMap((note) => note.anchorIds));
    const sourceAnchors = anchors.filter((anchor) => anchorIds.has(anchor.id));
    const model = buildNotesExport(activeSource, sourceAnchors, sourceNotes);
    const base = safeExportFileName(activeSource.title);
    // Both forms: JSON is the round-trippable truth (carries note.display); markdown
    // is the human-readable companion.
    downloadTextFile(JSON.stringify(model, null, 2), `${base}.notes.json`, "application/json");
    downloadTextFile(notesExportToMarkdown(model), `${base}.notes.md`, "text/markdown");
  };

  const label = t(messages.exportNotes);
  return (
    <button
      type="button"
      className="hide-all-notes-toggle"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onExport}
    >
      <Download size={15} aria-hidden="true" />
    </button>
  );
}
