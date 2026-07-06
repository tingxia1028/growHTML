// D11 — the per-document "hide all notes" toggle (note-presentation-unified.md §10).
//
// One control that masks ALL note cards/overlays for the current source — distinct
// from N1a's 显示锚点标记 switch (which hides anchor GLYPHS): hide-all hides the
// CARDS/notes (hover, pinned, margin), note-slot chips, and anchor glyph chips.
// Because each note's own open state
// lives in note.display / the geometry store, "打开的打开、关闭还是关闭" is preserved
// — the toggle only masks, it never loses per-note state.
//
// State: a device-local, per-source view flag (annotations.ts localStorage helpers),
// pushed into the FOCUSED pane's REALM store (annotationLayer setAllNotesHidden, now
// per-realm — F-1 follow-up). The realm Document is resolved from the sourceRealmDoc
// registry each reader registers into, so two split panes no longer share one flag;
// webview guests receive it over the sv:anchors payload (the persist above pings the
// marker-prefs bus). NOT exported — the exported truth is each note's display.open.

import { useEffect, useState } from "react";
import { EyeOff } from "lucide-react";
import { setAllNotesHidden } from "../annotationLayer";
import { persistNotesHidden, readStoredNotesHidden } from "../annotations";
import { getSourceRealmDoc } from "./sourceRealmDoc";
import { defineMessages, t, useLocale } from "../i18n";
import "./HideAllNotesToggle.css";

const messages = defineMessages({
  hideAllNotes: { zh: "隐藏所有笔记", en: "Hide all notes" },
  showAllNotes: { zh: "显示所有笔记", en: "Show all notes" }
});

export function HideAllNotesToggle({ sourceId }: { sourceId: string }) {
  useLocale();
  // The realm store is per-realm now; the toggle's own state tracks THIS source's
  // persisted flag (the durable truth) and drives the live realm doc when it exists.
  const [hidden, setHidden] = useState(() => readStoredNotesHidden(sourceId));

  // Seed the realm store from THIS source's persisted flag whenever the active source
  // changes (a per-source flag; opening a new document re-reads its choice). The realm
  // Document may not have mounted yet — seed the doc if present; the reader also reads
  // the persisted flag on paint, so an early miss self-heals.
  useEffect(() => {
    const stored = readStoredNotesHidden(sourceId);
    setAllNotesHidden(getSourceRealmDoc(sourceId), stored);
    setHidden(stored);
  }, [sourceId]);

  const toggle = () => {
    const next = !hidden;
    setHidden(next);
    // Flip the FOCUSED pane's realm store (if a host-reachable reader registered one) and
    // persist. persistNotesHidden also pings the marker-prefs bus so an already-painted
    // webview guest re-reads and re-applies the new flag.
    setAllNotesHidden(getSourceRealmDoc(sourceId), next);
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
