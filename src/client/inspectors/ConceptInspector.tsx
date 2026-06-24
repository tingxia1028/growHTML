// ConceptInspector — the detail surface for a focused concept (FocusTarget.type ===
// "concept"). It is registered in the InspectorRegistry and rendered by the concept
// pane when a concept is focused. It shows the concept's fields, the notes that link
// it (back-refs), and the relations touching it; and it offers the MANUAL actions:
//   • link an existing note to this concept   → concept.link-note
//   • create a relation to another concept     → relation.create
//   • delete a relation                        → entityClient.deleteRelation
//
// All reads go through the entity client (the shared seam) and all writes go through
// commands / the client; the inspector never touches a sibling view. It re-fetches
// whenever the workspace's `conceptsVersion` token changes (a command mutated data).

import { useCallback, useEffect, useState } from "react";
import { Link2, Trash2 } from "lucide-react";
import {
  entityClient,
  type ConceptRecord,
  type NoteRecord,
  type RelationRecord
} from "../data/entityClient";
import { noteText } from "../workspace/WorkspaceContext";
import type { InspectorContext } from "./registry";

// The relation kinds the manual UI offers (the core relationKind enum).
const RELATION_KINDS = [
  "related",
  "explains",
  "extends",
  "contradicts",
  "depends_on",
  "same_topic",
  "derived_from",
  "references",
  "modifies",
  "summarizes"
] as const;

type Detail = { concept: ConceptRecord; notes: NoteRecord[]; relations: RelationRecord[] };

function shortNote(note: NoteRecord): string {
  const text = noteText(note.content).replace(/\s+/g, " ").trim();
  return text.length > 70 ? `${text.slice(0, 70)}…` : text || "(empty note)";
}

export function ConceptInspector({ conceptId, ctx }: { conceptId: string; ctx: InspectorContext }) {
  const { focus, dispatch, conceptsVersion, refreshConcepts } = ctx;
  const [detail, setDetail] = useState<Detail | null>(null);
  const [allConcepts, setAllConcepts] = useState<ConceptRecord[]>([]);
  const [allNotes, setAllNotes] = useState<NoteRecord[]>([]);
  const [error, setError] = useState("");

  // Inputs for the two manual actions.
  const [linkNoteId, setLinkNoteId] = useState("");
  const [relationTargetId, setRelationTargetId] = useState("");
  const [relationKind, setRelationKind] = useState<(typeof RELATION_KINDS)[number]>("related");

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

  const createRelation = useCallback(async () => {
    if (!relationTargetId) return;
    await dispatch("relation.create", {
      fromConceptId: conceptId,
      toConceptId: relationTargetId,
      relationKind
    });
    setRelationTargetId("");
  }, [relationTargetId, dispatch, conceptId, relationKind]);

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
              onClick={() => focus.setFocus({ type: "note", noteId: note.id })}
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

        {/* Create a relation: this concept —kind→ another concept (manual). */}
        <div className="concept-create-relation">
          <select
            className="relation-kind-select"
            aria-label="Relation kind"
            value={relationKind}
            onChange={(event) => setRelationKind(event.target.value as (typeof RELATION_KINDS)[number])}
          >
            {RELATION_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
          <select
            className="relation-target-select"
            aria-label="Relation target concept"
            value={relationTargetId}
            onChange={(event) => setRelationTargetId(event.target.value)}
          >
            <option value="">To concept…</option>
            {relationTargets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="icon-button concept-create-relation-btn"
            disabled={!relationTargetId}
            onClick={() => void createRelation()}
          >
            <Link2 size={15} />
            Add relation
          </button>
        </div>
      </section>
    </div>
  );
}
