// D11 — the per-document "hide all notes" toggle (note-presentation-unified.md §10).
//
// One control that masks ALL note cards/overlays for the current source — distinct
// from N1a's 显示锚点标记 switch (which hides anchor GLYPHS): hide-all hides the
// CARDS/notes (hover, pinned, margin) AND the note-slot chips, while the anchor
// glyph chips STAY so passages remain findable. Because each note's own open state
// lives in note.display / the geometry store, "打开的打开、关闭还是关闭" is preserved
// — the toggle only masks, it never loses per-note state.
//
// State: a device-local, per-source view flag (annotations.ts localStorage helpers),
// pushed into the live realm store (annotationLayer setAllNotesHidden) that every
// card/overlay subscribes to; webview guests receive it over the sv:anchors payload.
// NOT exported — the exported truth is each note's display.open.

import { useEffect, useState } from "react";
import { EyeOff } from "lucide-react";
import { isAllNotesHidden, setAllNotesHidden } from "../annotationLayer";
import { persistNotesHidden, readStoredNotesHidden } from "../annotations";
import { defineMessages, t, useLocale } from "../i18n";
import "./HideAllNotesToggle.css";

const messages = defineMessages({
  hideAllNotes: { zh: "隐藏所有笔记", en: "Hide all notes" },
  showAllNotes: { zh: "显示所有笔记", en: "Show all notes" }
});

export function HideAllNotesToggle({ sourceId }: { sourceId: string }) {
  useLocale();
  const [hidden, setHidden] = useState(() => isAllNotesHidden());

  // Seed the live realm store from THIS source's persisted flag whenever the active
  // source changes (a per-source flag; opening a new document re-reads its choice).
  useEffect(() => {
    const stored = readStoredNotesHidden(sourceId);
    setAllNotesHidden(stored);
    setHidden(stored);
  }, [sourceId]);

  const toggle = () => {
    const next = !hidden;
    setHidden(next);
    setAllNotesHidden(next);
    persistNotesHidden(sourceId, next);
  };

  const label = t(hidden ? messages.showAllNotes : messages.hideAllNotes);
  return (
    <button
      type="button"
      className={`hide-all-notes-toggle${hidden ? " active" : ""}`}
      title={label}
      aria-label={label}
      aria-pressed={hidden}
      onClick={toggle}
    >
      <EyeOff size={15} aria-hidden="true" />
    </button>
  );
}
