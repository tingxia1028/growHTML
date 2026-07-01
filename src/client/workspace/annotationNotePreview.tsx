import { renderToStaticMarkup } from "react-dom/server";
import type { AnyAnchor, NoteRecord, StudyLayerRecord } from "../data/entityClient";
import { getNoteType } from "../notes/noteTypeRegistry";

// Render a note preview for the in-reader card as CONTENT-ONLY: the sanctioned note
// body renders directly through getNoteType(contentType).render — no ArtifactCard
// chrome (title bar / icon / footer). The `?? "markdown"` below is a default for the
// registry LOOKUP, not a contentType=== render branch. `anchor` / `layers` are kept
// in the signature (callers pass them) but unused now that there is no card footer.
export function renderAnnotationNotePreview(note: NoteRecord, _anchor: AnyAnchor, _layers: StudyLayerRecord[]): string {
  const plugin = getNoteType(note.contentType ?? "markdown");
  const body = plugin ? plugin.render({ content: note.content, note, mode: "card" }) : null;
  return renderToStaticMarkup(
    <div className="sv-annotation-preview" data-note-id={note.id}>
      <div className="sv-note-content">{body}</div>
    </div>
  );
}
