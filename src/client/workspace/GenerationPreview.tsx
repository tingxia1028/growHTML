// GenerationPreview — the "generate → preview → edit → save" stage that sits
// between a kit AI action and note persistence. When a kit command emits a draft via
// `onGenerated`, the WorkspaceContext parks it in `pendingDraft`; this view renders
// that draft (through the same client NoteType plugin the saved note would use) and
// offers Save / Regenerate / Discard. Nothing is persisted until Save.
//
// It is intentionally a SEPARATE DOM subtree from the `.note-list`: a draft can be
// previewing here while NO note yet exists in the list (Save is what moves it across).
// It collaborates only through `useWorkspace()` — like every other workspace view.

import { useEffect, useState } from "react";
import { useWorkspace } from "./WorkspaceContext";
import { getNoteType } from "../notes/noteTypeRegistry";

export function GenerationPreview() {
  const { pendingDraft, regenerating, savePendingDraft, regeneratePendingDraft, discardPendingDraft } = useWorkspace();

  // Whether the Edit editor is showing, and the working copy of the content it edits.
  // The working copy is seeded from the draft and RE-SEEDED whenever the draft
  // identity changes (a fresh generation or a regenerate swapping content in place),
  // so a stale edit can't leak across drafts.
  const [editing, setEditing] = useState(false);
  const [editedContent, setEditedContent] = useState<unknown>(pendingDraft?.content);

  useEffect(() => {
    setEditedContent(pendingDraft?.content);
    setEditing(false);
  }, [pendingDraft]);

  // Nothing pending → render nothing (the seam is invisible until a draft arrives).
  if (!pendingDraft) return null;

  const plugin = getNoteType(pendingDraft.contentType);

  // The body: the type's editor when editing, else its render. If no plugin is
  // registered for this contentType, fall back to an inert JSON dump so the preview
  // can never crash on a foreign/unknown shape.
  const body = !plugin ? (
    <pre className="generation-preview-fallback">{JSON.stringify(editedContent, null, 2)}</pre>
  ) : editing ? (
    plugin.edit({ content: editedContent, onChange: setEditedContent })
  ) : (
    plugin.render({ content: editedContent })
  );

  return (
    <div className="generation-preview">
      <div className="generation-preview-head">
        <span className="generation-preview-label">Preview</span>
        <span className="generation-preview-type">{pendingDraft.contentType}</span>
      </div>

      <div className="generation-preview-body">{body}</div>

      <div className="generation-preview-actions">
        <button
          type="button"
          className="gen-preview-save"
          onClick={() => savePendingDraft(editedContent)}
          disabled={regenerating}
          title="Save this draft as a note"
        >
          Save
        </button>
        <button
          type="button"
          className="gen-preview-edit"
          onClick={() => setEditing((value) => !value)}
          disabled={!plugin}
          title="Edit the draft before saving"
        >
          {editing ? "Done editing" : "Edit"}
        </button>
        <button
          type="button"
          className="gen-preview-regenerate"
          onClick={() => void regeneratePendingDraft()}
          disabled={regenerating}
          title="Re-run the generation"
        >
          {regenerating ? "Regenerating…" : "Regenerate"}
        </button>
        <button
          type="button"
          className="gen-preview-discard"
          onClick={() => discardPendingDraft()}
          disabled={regenerating}
          title="Discard this draft without saving"
        >
          Discard
        </button>
      </div>
    </div>
  );
}
