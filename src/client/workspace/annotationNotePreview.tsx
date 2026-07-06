import { renderToStaticMarkup } from "react-dom/server";
import type { AnyAnchor, NoteRecord, StudyLayerRecord } from "../data/entityClient";
import { noteCardMeta } from "../notes/noteCardMeta";
import { getNoteType } from "../notes/noteTypeRegistry";
import { noteTypeIcon } from "../notes/noteTypeIcon";

// Reader overlays are framework-free static HTML, so this renders a small card
// chrome while leaving the note type's sanctioned card body in charge of content.
export function renderAnnotationNotePreview(note: NoteRecord, _anchor: AnyAnchor, _layers: StudyLayerRecord[]): string {
  const contentType = note.contentType ?? "markdown";
  const plugin = getNoteType(contentType);
  const meta = noteCardMeta(contentType, note.content);
  const Icon = noteTypeIcon(contentType);
  const body = plugin ? plugin.render({ content: note.content, note, mode: "card" }) : null;

  return renderToStaticMarkup(
    <div className="sv-annotation-preview sv-annotation-preview-card" data-note-id={note.id} data-content-type={contentType}>
      <div className="sv-annotation-preview-head">
        <span className="sv-annotation-preview-icon" aria-hidden="true">
          <Icon size={13} />
        </span>
        <span className="sv-annotation-preview-type">{meta.typeLabel}</span>
      </div>
      <div className="sv-note-content sv-annotation-preview-body">{body ?? meta.title}</div>
    </div>
  );
}
