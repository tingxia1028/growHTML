// A note's anchor(s): the "link to selection" action + (for a multi-anchor note) an
// "anchored at N places" indicator with per-anchor jump buttons. A note can hang off
// several passages (NoteRecord.anchorIds is a list); this surfaces that on the card.
//  - "Link to selection" is ALWAYS shown, disabled until a passage is focused (a saved
//    anchor or a fresh draft); it dispatches note.link-anchor, which materializes the
//    selection and appends its id to the note (deduped).
//  - When the note has >1 anchors, the indicator + jump buttons appear; each jump
//    resolves its anchor RECORD from ctx.anchors and calls focus.setAnchor (mirrors the
//    bookmark jump), and is disabled when layer painting filtered that anchor out.
// A single-anchor note shows only the link button, so existing cards are unchanged
// except for the new affordance. Kept in its own module (not views.tsx) so it stays
// testable without pulling in the heavy reader surfaces (pdfjs) views.tsx imports.

import { MapPin } from "lucide-react";
import type { AnyAnchor, NoteRecord } from "../data/entityClient";
import type { WorkspaceContext } from "./viewRegistry";

export function NoteAnchorControl({
  note,
  anchors,
  focus,
  onLink
}: {
  note: NoteRecord;
  anchors: AnyAnchor[];
  focus: WorkspaceContext["focus"];
  onLink(): void;
}) {
  const canLink = !!focus.draft || !!focus.anchor;
  const multi = note.anchorIds.length > 1;

  // Resolve a note anchor id to its record (for setAnchor) — absent when a hidden
  // layer filtered it out of the painted `anchors`, in which case the jump is disabled.
  const jump = (anchorId: string) => {
    const anchor = anchors.find((a) => a.id === anchorId);
    if (anchor) focus.setAnchor(anchor);
  };

  return (
    <div className="note-anchors">
      <div className="note-anchor-actions">
        {multi ? (
          <span className="note-anchor-count" title="This note is anchored at several passages">
            <MapPin size={12} />
            Anchored at {note.anchorIds.length} places
          </span>
        ) : null}
        <button
          type="button"
          className="link-button note-anchor-link"
          disabled={!canLink}
          title={canLink ? "Also anchor this note at the selected passage" : "Select a passage first"}
          onClick={onLink}
        >
          <MapPin size={13} />
          Link to selection
        </button>
      </div>
      {multi ? (
        <div className="note-anchor-jumps">
          {note.anchorIds.map((anchorId, index) => {
            const anchor = anchors.find((a) => a.id === anchorId);
            const quote = anchor && "quote" in anchor ? anchor.quote : undefined;
            const label = (quote ?? "").replace(/\s+/g, " ").slice(0, 24).trim() || `Anchor ${index + 1}`;
            return (
              <button
                key={anchorId}
                type="button"
                className="link-button note-anchor-jump"
                disabled={!anchor}
                title={anchor ? "Jump to this passage" : "This passage isn't visible"}
                onClick={() => jump(anchorId)}
              >
                {label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
