// Concept workspace view (P5) — a NEW pane added to the workspace, registered like
// the other views. It surfaces the concept/relation layer the UI previously never
// showed, MANUALLY (no AI extraction, no graph):
//
//   • a concept LIST + a "New concept" form (name + optional description)  → concept.create
//   • clicking a concept FOCUSES it (focus.setFocus({type:"concept"}))
//   • when a concept/relation is focused, its INSPECTOR renders below (via the
//     InspectorRegistry) — linked notes (back-refs), relations, and the manual
//     link-note / create-relation / delete-relation controls.
//
// CONCEPT-UX-1 §4 (列表可用性): the list is sorted by linked-note count DESC (then
// updatedAt DESC), each row shows a count badge, a client-side name filter narrows
// it, and the empty state is one guidance line pointing at 标为概念 — all through the
// conceptMessages i18n dictionary.
//
// It is additive: it does NOT touch the existing library/reader/study panels' DOM
// (the node-ify guardrail), so the 16 existing e2e keep their original selectors.
// Like every view it reads/writes only through the WorkspaceContext + entity client.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Network, Plus } from "lucide-react";
import { entityClient, type ConceptRecord } from "../data/entityClient";
import { registerView, type WorkspaceContext } from "./viewRegistry";
// Side-effect import: registers the concept / relation inspectors.
import "../inspectors/views";
import { renderInspector } from "../inspectors/registry";
import { normalizeConceptName } from "./conceptName";
import { conceptMessages } from "./conceptMessages";
import { t } from "../i18n";
import "./conceptUx.css";

// The client ConceptRecord type omits the envelope timestamps, but the server sends
// them — read updatedAt loosely for the secondary sort (missing → "" sorts last).
function conceptUpdatedAt(concept: ConceptRecord): string {
  const value = (concept as { updatedAt?: unknown }).updatedAt;
  return typeof value === "string" ? value : "";
}

/** Linked-note count per concept id, joined over the notes' conceptIds (the ONE
    storage path for concept↔note links). */
export function conceptNoteCounts(notes: readonly { conceptIds?: string[] }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const note of notes) {
    for (const id of note.conceptIds ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** CONCEPT-UX-1 §4 ordering: linked-note count DESC, then updatedAt DESC. */
export function sortConceptsForList(
  concepts: readonly ConceptRecord[],
  counts: ReadonlyMap<string, number>
): ConceptRecord[] {
  return [...concepts].sort((a, b) => {
    const byCount = (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0);
    if (byCount !== 0) return byCount;
    return conceptUpdatedAt(b).localeCompare(conceptUpdatedAt(a));
  });
}

/** Client-side name filter (normalized substring; aliases count as names too). */
export function filterConceptsByName(
  concepts: readonly ConceptRecord[],
  query: string
): ConceptRecord[] {
  const normalized = normalizeConceptName(query);
  if (!normalized) return [...concepts];
  return concepts.filter(
    (concept) =>
      normalizeConceptName(concept.name).includes(normalized) ||
      concept.aliases.some((alias) => normalizeConceptName(alias).includes(normalized))
  );
}

function ConceptListView({ ctx }: { ctx: WorkspaceContext }) {
  const { focus, dispatch, conceptsVersion } = ctx;
  const [concepts, setConcepts] = useState<ConceptRecord[]>([]);
  const [noteCounts, setNoteCounts] = useState<Map<string, number>>(new Map());
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      // Concepts + ALL notes in one round: the counts join over notes' conceptIds.
      const [conceptsResponse, notesResponse] = await Promise.all([
        entityClient.concepts(),
        entityClient.allNotes()
      ]);
      setConcepts(conceptsResponse.concepts);
      setNoteCounts(conceptNoteCounts(notesResponse.notes));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load concepts");
    }
  }, []);

  // Load on mount and whenever a command mutated concept/relation data.
  useEffect(() => {
    void load();
  }, [load, conceptsVersion]);

  const createConcept = useCallback(async () => {
    if (!name.trim()) return;
    await dispatch("concept.create", { conceptName: name, conceptDescription: description });
    setName("");
    setDescription("");
  }, [name, description, dispatch]);

  const focusedConceptId = focus.focus?.type === "concept" ? focus.focus.conceptId : null;

  // Filter → sort (count desc, then updatedAt desc) for the rendered list.
  const visibleConcepts = useMemo(
    () => sortConceptsForList(filterConceptsByName(concepts, filter), noteCounts),
    [concepts, filter, noteCounts]
  );

  return (
    <aside className="concept-panel">
      <div className="panel-title">
        <Network size={16} />
        {t(conceptMessages.title)}
      </div>

      {error ? <div className="error-box">{error}</div> : null}

      {/* New concept form. */}
      <section className="concept-create">
        <input
          className="concept-name-input"
          placeholder={t(conceptMessages.namePlaceholder)}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void createConcept();
            }
          }}
        />
        <input
          className="concept-description-input"
          placeholder={t(conceptMessages.descriptionPlaceholder)}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <button
          type="button"
          className="icon-button concept-create-btn"
          disabled={!name.trim()}
          onClick={() => void createConcept()}
        >
          <Plus size={16} />
          {t(conceptMessages.createAction)}
        </button>
      </section>

      {/* Client-side name filter (CONCEPT-UX-1 §4). */}
      <input
        className="concept-filter-input"
        placeholder={t(conceptMessages.filterPlaceholder)}
        aria-label={t(conceptMessages.filterPlaceholder)}
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />

      {/* Concept list — clicking focuses the concept (its inspector opens below). */}
      <div className="concept-list record-list">
        {visibleConcepts.map((concept) => (
          <button
            key={concept.id}
            type="button"
            className={`concept-item${concept.id === focusedConceptId ? " active" : ""}`}
            onClick={() => focus.setFocus({ type: "concept", conceptId: concept.id })}
          >
            <span className="concept-item-row">
              <span className="concept-item-name">{concept.name}</span>
              <span className="concept-count-badge" aria-label={t(conceptMessages.linkedNoteCount)}>
                {noteCounts.get(concept.id) ?? 0}
              </span>
            </span>
            {concept.description ? <small className="concept-item-desc">{concept.description}</small> : null}
          </button>
        ))}
        {concepts.length === 0 ? (
          // Empty vault: ONE guidance line pointing at the cheap capture path.
          <div className="empty-state concept-empty-guidance">{t(conceptMessages.emptyGuidance)}</div>
        ) : visibleConcepts.length === 0 ? (
          <div className="empty-state">{t(conceptMessages.noMatches)}</div>
        ) : null}
      </div>

      {/* The inspector for whatever is focused (concept / relation), via the registry. */}
      <section className="concept-inspector-host">
        {focus.focus?.type === "concept" || focus.focus?.type === "relation" ? (
          renderInspector(focus.focus, ctx)
        ) : (
          <div className="empty-state">{t(conceptMessages.selectEmpty)}</div>
        )}
      </section>
    </aside>
  );
}

registerView({ kind: "concept.list", render: (_node, ctx) => <ConceptListView ctx={ctx} /> });
