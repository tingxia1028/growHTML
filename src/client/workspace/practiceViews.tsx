// Practice workspace view — the bottom panel of the Textbook Learning layout (the dock
// `column` split's lower child). It surfaces the active source's practice + mistake
// Study Blocks so a student sees "what to drill" beneath the reader. It is a MINIMAL
// view: it just filters the shared notes by the Textbook kit's contentTypes and renders
// each through its registered NoteType plugin (no new data path). A fuller tutor /
// dedicated practice UX is deferred.
//
// Like every view it reads ONLY through the WorkspaceContext + the NoteType registry.

import { ListChecks } from "lucide-react";
import { registerView, type WorkspaceContext } from "./viewRegistry";
import { getNoteType } from "../notes/noteTypeRegistry";
import { InertNote } from "../notes/builtinNoteTypes";

// The drill + mistake types this panel collects. REV-CORE: 错题 is the CORE
// `"mistake"` type now — BOTH ids count (legacy `textbook.mistake` records exist).
const PRACTICE_TYPES = new Set(["textbook.exercise", "textbook.mistake", "mistake"]);

function PracticeView({ ctx }: { ctx: WorkspaceContext }) {
  const items = ctx.notes.filter((note) => PRACTICE_TYPES.has(note.contentType ?? ""));

  return (
    <aside className="practice-panel">
      <div className="panel-title">
        <ListChecks size={16} />
        Practice
      </div>
      {items.length ? (
        <div className="record-list practice-list">
          {items.map((note) => {
            const contentType = note.contentType ?? "markdown";
            const plugin = getNoteType(contentType);
            return (
              <article key={note.id} className="record-card">
                <strong>{contentType}</strong>
                {plugin ? plugin.render({ content: note.content, note }) : <InertNote content={note.content} contentType={contentType} />}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          No practice or mistakes yet. Use the Textbook kit's Practice / Mistake actions on a passage.
        </div>
      )}
    </aside>
  );
}

registerView({ kind: "practice", render: (_node, ctx) => <PracticeView ctx={ctx} /> });
