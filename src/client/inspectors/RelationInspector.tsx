// RelationInspector — the detail surface for a focused relation (FocusTarget.type ===
// "relation"). Relations are primarily created/deleted from the ConceptInspector, but
// registering a relation inspector keeps the InspectorRegistry consistent (every
// focusable kind that has details resolves through the same seam) and lets a relation
// focused from elsewhere be inspected + deleted. There is no GET /api/relations/:id,
// so it finds the relation in the full list (re-fetched on conceptsVersion).

import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { entityClient, type ConceptRecord, type RelationRecord } from "../data/entityClient";
import type { InspectorContext } from "./registry";

export function RelationInspector({ relationId, ctx }: { relationId: string; ctx: InspectorContext }) {
  const { focus, conceptsVersion, refreshConcepts } = ctx;
  const [relation, setRelation] = useState<RelationRecord | null>(null);
  const [concepts, setConcepts] = useState<ConceptRecord[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [relationsResponse, conceptsResponse] = await Promise.all([
        entityClient.relations(),
        entityClient.concepts()
      ]);
      setRelation(relationsResponse.relations.find((item) => item.id === relationId) ?? null);
      setConcepts(conceptsResponse.concepts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load relation");
    }
  }, [relationId]);

  useEffect(() => {
    void load();
  }, [load, conceptsVersion]);

  const conceptName = (id: string) => concepts.find((concept) => concept.id === id)?.name ?? id;

  const deleteRelation = useCallback(async () => {
    if (!relation) return;
    try {
      await entityClient.deleteRelation(relation.id);
      focus.setFocus(null);
      refreshConcepts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete relation");
    }
  }, [relation, focus, refreshConcepts]);

  if (!relation) {
    return (
      <div className="relation-inspector">
        {error ? <div className="error-box">{error}</div> : <div className="empty-state">Relation not found.</div>}
      </div>
    );
  }

  return (
    <div className="relation-inspector" data-relation-id={relation.id}>
      <header className="concept-inspector-head">
        <p>relation</p>
        <h3 className="concept-inspector-name">
          {conceptName(relation.from.id)} <code className="concept-relation-kind">{relation.relationKind}</code>{" "}
          {conceptName(relation.to.id)}
        </h3>
      </header>
      {error ? <div className="error-box">{error}</div> : null}
      <button type="button" className="icon-button relation-delete" onClick={() => void deleteRelation()}>
        <Trash2 size={15} />
        Delete relation
      </button>
    </div>
  );
}
