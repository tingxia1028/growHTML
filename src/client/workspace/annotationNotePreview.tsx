import { renderToStaticMarkup } from "react-dom/server";
import type { AnyAnchor, NoteRecord, StudyLayerRecord } from "../data/entityClient";
import { ArtifactCard } from "./ArtifactCard";

function anchorPage(anchor: AnyAnchor): number | undefined {
  return "page" in anchor ? anchor.page : undefined;
}

function noteLayerTitle(note: NoteRecord, layers: StudyLayerRecord[]): string {
  const layerId = note.layerIds[0];
  return layerId ? layers.find((layer) => layer.id === layerId)?.title ?? "My Notes" : "My Notes";
}

export function renderAnnotationNotePreview(note: NoteRecord, anchor: AnyAnchor, layers: StudyLayerRecord[]): string {
  const contentType = note.contentType ?? "markdown";
  return renderToStaticMarkup(
    <div className="sv-annotation-preview" data-note-id={note.id}>
      <ArtifactCard
        block={{
          contentType,
          content: note.content,
          note,
          page: anchorPage(anchor),
          layer: noteLayerTitle(note, layers)
        }}
      />
    </div>
  );
}
