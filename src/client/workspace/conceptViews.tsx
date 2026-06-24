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
// It is additive: it does NOT touch the existing library/reader/study panels' DOM
// (the node-ify guardrail), so the 16 existing e2e keep their original selectors.
// Like every view it reads/writes only through the WorkspaceContext + entity client.

import { useCallback, useEffect, useState } from "react";
import { FolderTree, Plus } from "lucide-react";
import { entityClient, type ConceptRecord } from "../data/entityClient";
import { registerView, type WorkspaceContext } from "./viewRegistry";
// Side-effect import: registers the concept / relation inspectors.
import "../inspectors/views";
import { renderInspector } from "../inspectors/registry";

function ConceptListView({ ctx }: { ctx: WorkspaceContext }) {
  const { focus, dispatch, conceptsVersion } = ctx;
  const [concepts, setConcepts] = useState<ConceptRecord[]>([]);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await entityClient.concepts();
      setConcepts(response.concepts);
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

  return (
    <aside className="concept-panel">
      <div className="panel-title">
        <FolderTree size={16} />
        Concepts
      </div>

      {error ? <div className="error-box">{error}</div> : null}

      {/* New concept form. */}
      <section className="concept-create">
        <input
          className="concept-name-input"
          placeholder="New concept name…"
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
          placeholder="Description (optional)"
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
          New concept
        </button>
      </section>

      {/* Concept list — clicking focuses the concept (its inspector opens below). */}
      <div className="concept-list record-list">
        {concepts.map((concept) => (
          <button
            key={concept.id}
            type="button"
            className={`concept-item${concept.id === focusedConceptId ? " active" : ""}`}
            onClick={() => focus.setFocus({ type: "concept", conceptId: concept.id })}
          >
            <span className="concept-item-name">{concept.name}</span>
            {concept.description ? <small className="concept-item-desc">{concept.description}</small> : null}
          </button>
        ))}
        {concepts.length === 0 ? <div className="empty-state">No concepts yet.</div> : null}
      </div>

      {/* The inspector for whatever is focused (concept / relation), via the registry. */}
      <section className="concept-inspector-host">
        {focus.focus?.type === "concept" || focus.focus?.type === "relation" ? (
          renderInspector(focus.focus, ctx)
        ) : (
          <div className="empty-state">Select a concept to see its notes and relations.</div>
        )}
      </section>
    </aside>
  );
}

registerView({ kind: "concept.list", render: (_node, ctx) => <ConceptListView ctx={ctx} /> });
