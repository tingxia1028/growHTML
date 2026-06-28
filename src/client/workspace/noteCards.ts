// The main note-card list excludes bookmarks: a bookmark IS a note, but it surfaces in
// the dedicated Bookmarks pane (and as an inline anchor marker), NOT as a card in the
// note list — so it reads as a marker, not content. Kept in its own tiny module (rather
// than inline in views.tsx) so the exclusion is unit-testable without importing the heavy
// view chain (readerForSource → PdfReader → pdfjs). See docs/design/bookmark-modeling.md.
import type { NoteRecord } from "../data/entityClient";
import { BOOKMARK_CONTENT_TYPE } from "../../core/notes/contentTypes";

export function noteCardsFrom(notes: NoteRecord[]): NoteRecord[] {
  return notes.filter((note) => (note.contentType ?? "markdown") !== BOOKMARK_CONTENT_TYPE);
}
