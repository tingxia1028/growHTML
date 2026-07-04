// ConceptInspector — the detail surface for a focused concept (FocusTarget.type ===
// "concept"). It is registered in the InspectorRegistry and rendered by the concept
// pane when a concept is focused. It shows the concept's fields, the notes that link
// it (back-refs), and the relations touching it; and it offers the MANUAL actions:
//   • link an existing note to this concept   → concept.link-note
//   • 关联到… (one autocomplete pick)          → relation.create with kind "related"
//   • delete a relation                        → entityClient.deleteRelation
//
// CONCEPT-UX-1 §3: the 10-kind relation form is GONE from this surface — relating two
// concepts is one autocomplete pick that immediately creates a `related` relation. The
// full relationKind enum still exists in the schema and is DISPLAYED read-only in
// RelationInspector (the advanced path); no kind-editing UI is added there by design.
// §2: clicking a linked note reveals its passage in the reader (when its anchor is on
// the active source) and focuses the note — the same setAnchor/setFocus contract the
// anchor pane and note list use.
//
// All reads go through the entity client (the shared seam) and all writes go through
// commands / the client; the inspector never touches a sibling view. It re-fetches
// whenever the workspace's `conceptsVersion` token changes (a command mutated data).

import { useCallback, useEffect, useState } from "react";
import { GitMerge, Link2, Trash2 } from "lucide-react";
import {
  entityClient,
  type ConceptRecord,
  type NoteRecord,
  type RelationRecord
} from "../data/entityClient";
import { noteText } from "../workspace/WorkspaceContext";
import { ConceptAutocomplete } from "../workspace/ConceptChips";
import { conceptMessages } from "../workspace/conceptMessages";
import { t } from "../i18n";
import type { InspectorContext } from "./registry";

type Detail = { concept: ConceptRecord; notes: NoteRecord[]; relations: RelationRecord[] };

function shortNote(note: NoteRecord): string {
  const text = noteText(note.content).replace(/\s+/g, " ").trim();
  return text.length > 70 ? `${text.slice(0, 70)}…` : text || "(empty note)";
}

export function ConceptInspector({ conceptId, ctx }: { conceptId: string; ctx: InspectorContext }) {
  const { focus, dispatch, conceptsVersion, refreshConcepts, anchors } = ctx;
  const [detail, setDetail] = useState<Detail | null>(null);
  const [allConcepts, setAllConcepts] = useState<ConceptRecord[]>([]);
  const [allNotes, setAllNotes] = useState<NoteRecord[]>([]);
  const [error, setError] = useState("");

  // Input for the manual note-link action.
  const [linkNoteId, setLinkNoteId] = useState("");
  const [mergeTargetId, setMergeTargetId] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      // Detail (concept + back-ref notes + relations), plus the candidate lists the
      // pickers need: all concepts (relation target) and all notes (note to link).
      const [detailResponse, conceptsResponse, notesResponse] = await Promise.all([
        entityClient.conceptDetail(conceptId),
        entityClient.concepts(),
        entityClient.allNotes()
      ]);
      setDetail(detailResponse);
      setAllConcepts(conceptsResponse.concepts);
      setAllNotes(notesResponse.notes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load concept");
    }
  }, [conceptId]);

  // Re-fetch when the focused concept changes or a command mutated entity data.
  useEffect(() => {
    void load();
  }, [load, conceptsVersion]);

  useEffect(() => {
    setMergeTargetId("");
  }, [conceptId]);

  const linkedNoteIds = new Set(detail?.notes.map((note) => note.id) ?? []);
  // Notes that aren't already linked to THIS concept are the link candidates.
  const linkCandidates = allNotes.filter((note) => !linkedNoteIds.has(note.id));
  // Relation targets are every OTHER concept.
  const relationTargets = allConcepts.filter((concept) => concept.id !== conceptId);

  const conceptName = useCallback(
    (id: string) => allConcepts.find((concept) => concept.id === id)?.name ?? id,
    [allConcepts]
  );

  const linkNote = useCallback(async () => {
    if (!linkNoteId) return;
    const note = allNotes.find((item) => item.id === linkNoteId);
    await dispatch("concept.link-note", {
      noteId: linkNoteId,
      conceptId,
      noteConceptIds: note?.conceptIds ?? []
    });
    setLinkNoteId("");
  }, [linkNoteId, allNotes, dispatch, conceptId]);

  // 关联到… (CONCEPT-UX-1 §3): picking a concept in the autocomplete creates the
  // relation IMMEDIATELY with the default kind "related" — no kind picker, no form.
  const relateTo = useCallback(
    async (target: ConceptRecord) => {
      await dispatch("relation.create", {
        fromConceptId: conceptId,
        toConceptId: target.id,
        relationKind: "related"
      });
    },
    [dispatch, conceptId]
  );

  // Jump for a linked-note row (§2): reveal the note's passage in the reader when its
  // anchor belongs to the ACTIVE source (setAnchor bumps revealSeq → the reader
  // scrolls), then focus the note itself — mirrors the anchor pane's linked-note jump.
  const jumpToNote = useCallback(
    (note: NoteRecord) => {
      const anchorRecord = note.anchorIds
        .map((anchorId) => anchors.find((anchor) => anchor.id === anchorId))
        .find(Boolean);
      if (anchorRecord) focus.setAnchor(anchorRecord);
      focus.setFocus({ type: "note", noteId: note.id });
    },
    [anchors, focus]
  );

  const deleteRelation = useCallback(
    async (relationId: string) => {
      try {
        await entityClient.deleteRelation(relationId);
        refreshConcepts();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete relation");
      }
    },
    [refreshConcepts]
  );

  const deleteCurrentConcept = useCallback(async () => {
    if (!detail) return;
    if (!window.confirm(`Delete concept "${detail.concept.name}"? Linked notes will keep their content.`)) return;
    try {
      await entityClient.deleteConcept(detail.concept.id);
      refreshConcepts();
      focus.setFocus(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete concept");
    }
  }, [detail, focus, refreshConcepts]);

  const mergeCurrentConcept = useCallback(async () => {
    if (!detail || !mergeTargetId) return;
    const target = allConcepts.find((concept) => concept.id === mergeTargetId);
    if (!target) return;
    if (!window.confirm(`Merge "${detail.concept.name}" into "${target.name}"?`)) return;
    try {
      const result = await entityClient.mergeConcept(detail.concept.id, target.id);
      refreshConcepts();
      focus.setFocus({ type: "concept", conceptId: result.concept.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to merge concept");
    }
  }, [allConcepts, detail, focus, mergeTargetId, refreshConcepts]);

  if (!detail) {
    return (
      <div className="concept-inspector">
        {error ? <div className="error-box">{error}</div> : <div className="empty-state">Loading concept…</div>}
      </div>
    );
  }

  const { concept, notes, relations } = detail;

  return (
    <div className="concept-inspector" data-concept-id={concept.id}>
      <header className="concept-inspector-head">
        <p>concept</p>
        <h3 className="concept-inspector-name">{concept.name}</h3>
        {concept.aliases.length ? (
          <div className="concept-aliases">{concept.aliases.join(", ")}</div>
        ) : null}
        {concept.description ? <p className="concept-description">{concept.description}</p> : null}
        <div className="concept-inspector-actions">
          <select
            className="concept-merge-select"
            aria-label="Merge target concept"
            value={mergeTargetId}
            onChange={(event) => setMergeTargetId(event.target.value)}
          >
            <option value="">Merge into...</option>
            {relationTargets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="link-button concept-merge-btn"
            disabled={!mergeTargetId}
            onClick={() => void mergeCurrentConcept()}
          >
            <GitMerge size={14} />
            Merge
          </button>
          <button type="button" className="link-button concept-delete-btn" onClick={() => void deleteCurrentConcept()}>
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      </header>

      {error ? <div className="error-box">{error}</div> : null}

      {/* Linked notes (back-refs). Clicking focuses the note. */}
      <section className="concept-section concept-notes">
        <div className="panel-title">Linked notes ({notes.length})</div>
        <div className="record-list">
          {notes.map((note) => (
            <button
              key={note.id}
              type="button"
              className={`concept-note-item${focus.focus?.type === "note" && focus.focus.noteId === note.id ? " active" : ""}`}
              onClick={() => jumpToNote(note)}
            >
              <strong>{note.contentType ?? "markdown"}</strong>
              <span>{shortNote(note)}</span>
            </button>
          ))}
          {notes.length === 0 ? <div className="empty-state">No notes linked yet.</div> : null}
        </div>

        {/* Link an EXISTING note to this concept (manual). */}
        <div className="concept-link-note">
          <select
            className="concept-note-select"
            aria-label="Note to link"
            value={linkNoteId}
            onChange={(event) => setLinkNoteId(event.target.value)}
          >
            <option value="">Link an existing note…</option>
            {linkCandidates.map((note) => (
              <option key={note.id} value={note.id}>
                {shortNote(note)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="icon-button concept-link-note-btn"
            disabled={!linkNoteId}
            onClick={() => void linkNote()}
          >
            <Link2 size={15} />
            Link note
          </button>
        </div>
      </section>

      {/* Relations touching this concept (either direction), with delete. */}
      <section className="concept-section concept-relations">
        <div className="panel-title">Relations ({relations.length})</div>
        <div className="record-list">
          {relations.map((relation) => {
            const outgoing = relation.from.id === concept.id;
            const other = outgoing ? relation.to.id : relation.from.id;
            return (
              <article key={relation.id} className="record-card concept-relation-item">
                <span className="concept-relation-text">
                  {outgoing ? concept.name : conceptName(other)}
                  <code className="concept-relation-kind">{relation.relationKind}</code>
                  {outgoing ? conceptName(other) : concept.name}
                </span>
                <button
                  type="button"
                  className="link-button concept-relation-delete"
                  aria-label="Delete relation"
                  onClick={() => void deleteRelation(relation.id)}
                >
                  <Trash2 size={14} />
                </button>
              </article>
            );
          })}
          {relations.length === 0 ? <div className="empty-state">No relations yet.</div> : null}
        </div>

        {/* 关联到… (CONCEPT-UX-1 §3): ONE autocomplete — picking a concept creates a
            `related` relation immediately. The full 10-kind enum stays schema-side and
            renders read-only in RelationInspector (the advanced path). */}
        <div className="concept-create-relation">
          <ConceptAutocomplete
            className="concept-relate-input"
            concepts={relationTargets}
            placeholder={t(conceptMessages.relateToPlaceholder)}
            onPick={(target) => void relateTo(target)}
          />
        </div>
      </section>
    </div>
  );
}
