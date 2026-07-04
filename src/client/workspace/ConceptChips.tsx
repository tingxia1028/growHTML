// Concept chips + the ONE shared concept autocomplete (CONCEPT-UX-1 §2/§3).
//
//   • ConceptAutocomplete — the single typed-picker every lightweight concept surface
//     shares (abstract-recurring-capabilities law): existing concepts matched by
//     normalized PREFIX; Enter picks the exact match, or CREATES when `allowCreate`
//     and nothing matches. The chips' ＋ input and the inspector's 关联到… both render
//     THIS component, so picking behavior can never drift between surfaces.
//   • ConceptChips — the dumb clickable chips row (navigate on click, ＋ to link).
//   • NoteConceptChips — the host wiring for a SAVED note (the FocusOverlay 大窗口):
//     loads concept names, links through the EXISTING concept.link-note command when a
//     workspace context is present (bumps conceptsVersion + repaints), else falls back
//     to the entity client directly (standalone/tests), and navigates via the existing
//     focus contract (focus.setFocus({type:"concept"})).

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { entityClient, type ConceptRecord, type NoteRecord } from "../data/entityClient";
import { useWorkspaceOptional } from "./WorkspaceContext";
import { conceptNameFromSelection, matchConceptByName, normalizeConceptName, collapseConceptText } from "./conceptName";
import { conceptMessages } from "./conceptMessages";
import { t } from "../i18n";
import "./conceptUx.css";

const MAX_SUGGESTIONS = 8;

export type ConceptAutocompleteProps = {
  /** The candidate pool (already excluding whatever the host filtered out). */
  concepts: ConceptRecord[];
  /** Ids never suggested (e.g. concepts already linked / the concept itself). */
  excludeIds?: string[];
  placeholder: string;
  /** Enter with NO matching concept creates one (选中即建's typed twin). */
  allowCreate?: boolean;
  disabled?: boolean;
  onPick(concept: ConceptRecord): void;
  onCreate?(name: string): void;
  /** Extra class hook so each host surface can target its instance. */
  className?: string;
};

export function ConceptAutocomplete({
  concepts,
  excludeIds,
  placeholder,
  allowCreate,
  disabled,
  onPick,
  onCreate,
  className
}: ConceptAutocompleteProps) {
  const [query, setQuery] = useState("");
  const excluded = useMemo(() => new Set(excludeIds ?? []), [excludeIds]);
  const candidates = useMemo(() => concepts.filter((concept) => !excluded.has(concept.id)), [concepts, excluded]);

  const trimmed = collapseConceptText(query);
  const normalized = normalizeConceptName(trimmed);
  const matches = normalized
    ? candidates.filter((concept) => normalizeConceptName(concept.name).startsWith(normalized))
    : [];
  const exact = matchConceptByName(candidates, trimmed);

  const pick = useCallback(
    (concept: ConceptRecord) => {
      setQuery("");
      onPick(concept);
    },
    [onPick]
  );

  // Enter: the exact-named concept wins; else create (when allowed), else the top
  // prefix suggestion — so "no-match creates" while a visible match stays one key away.
  const submit = useCallback(() => {
    if (!trimmed) return;
    if (exact) {
      pick(exact);
      return;
    }
    if (allowCreate && onCreate) {
      setQuery("");
      onCreate(trimmed);
      return;
    }
    if (matches.length > 0) pick(matches[0]);
  }, [trimmed, exact, allowCreate, onCreate, matches, pick]);

  return (
    <div className={`concept-autocomplete${className ? ` ${className}` : ""}`}>
      <input
        className="concept-autocomplete-input"
        value={query}
        placeholder={placeholder}
        aria-label={placeholder}
        disabled={disabled}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          }
        }}
      />
      {matches.length > 0 ? (
        <div className="concept-autocomplete-list" role="listbox">
          {matches.slice(0, MAX_SUGGESTIONS).map((concept) => (
            <button
              key={concept.id}
              type="button"
              role="option"
              aria-selected={false}
              className="concept-autocomplete-item"
              disabled={disabled}
              onClick={() => pick(concept)}
            >
              {concept.name}
            </button>
          ))}
        </div>
      ) : null}
      {allowCreate && trimmed && !exact ? (
        <div className="concept-autocomplete-hint">{`${t(conceptMessages.createOnEnter)} "${trimmed}"`}</div>
      ) : null}
    </div>
  );
}

export type ConceptChipsProps = {
  /** The linked concept ids, in link order. */
  conceptIds: string[];
  /** All known concepts (chip names + the ＋ autocomplete pool). */
  concepts: ConceptRecord[];
  busy?: boolean;
  /** A chip was clicked — navigate to the concept (host decides how). */
  onNavigate(conceptId: string): void;
  /** Link an EXISTING concept picked in the ＋ autocomplete. */
  onLink(concept: ConceptRecord): void;
  /** Enter on a name with no match — create + link. */
  onCreateAndLink(name: string): void;
};

export function ConceptChips({ conceptIds, concepts, busy, onNavigate, onLink, onCreateAndLink }: ConceptChipsProps) {
  const [adding, setAdding] = useState(false);
  const byId = useMemo(() => new Map(concepts.map((concept) => [concept.id, concept])), [concepts]);

  return (
    <div className="concept-chips" aria-label={t(conceptMessages.chipsLabel)}>
      {conceptIds.map((id) => (
        <button
          key={id}
          type="button"
          className="concept-chip"
          title={t(conceptMessages.openConcept)}
          disabled={busy}
          onClick={() => onNavigate(id)}
        >
          {byId.get(id)?.name ?? id}
        </button>
      ))}
      {adding ? (
        <ConceptAutocomplete
          className="concept-chip-add-input"
          concepts={concepts}
          excludeIds={conceptIds}
          placeholder={t(conceptMessages.autocompletePlaceholder)}
          allowCreate
          disabled={busy}
          onPick={(concept) => {
            setAdding(false);
            onLink(concept);
          }}
          onCreate={(name) => {
            setAdding(false);
            onCreateAndLink(name);
          }}
        />
      ) : (
        <button
          type="button"
          className="concept-chip concept-chip-add"
          aria-label={t(conceptMessages.addConcept)}
          title={t(conceptMessages.addConcept)}
          disabled={busy}
          onClick={() => setAdding(true)}
        >
          <Plus size={12} />
        </button>
      )}
    </div>
  );
}

// —— NoteConceptChips: the saved-note host (FocusOverlay 大窗口) ————————————
// Reads the note's conceptIds (the ONE storage path for concept↔note links), loads
// concept names once, and wires link/create/navigate:
//   link     → concept.link-note command when a workspace ctx exists (appends to
//              note.conceptIds + bumps conceptsVersion + repaints), else a direct
//              entityClient.updateNote (standalone/tests).
//   create   → entityClient.createConcept (deduped by normalized name first), then link.
//   navigate → focus.setFocus({type:"concept"}) — the existing focus contract; the
//              host's onNavigated (FocusOverlay passes onClose) fires after.
export function NoteConceptChips({ note, onNavigated }: { note: NoteRecord; onNavigated?(): void }) {
  const ws = useWorkspaceOptional();
  const [conceptIds, setConceptIds] = useState<string[]>(note.conceptIds ?? []);
  const [concepts, setConcepts] = useState<ConceptRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setConceptIds(note.conceptIds ?? []);
    let cancelled = false;
    void entityClient
      .concepts()
      .then(({ concepts: loaded }) => {
        if (!cancelled) setConcepts(loaded);
      })
      .catch(() => {
        // additive — chips still render by id; the ＋ pool is just empty
      });
    return () => {
      cancelled = true;
    };
  }, [note.id, note.conceptIds]);

  const linkConcept = useCallback(
    async (concept: ConceptRecord, current: string[]) => {
      if (current.includes(concept.id)) return;
      if (ws) {
        // The EXISTING command path — appends without dropping other links.
        await ws.dispatch("concept.link-note", {
          noteId: note.id,
          conceptId: concept.id,
          noteConceptIds: current
        });
      } else {
        await entityClient.updateNote(note.id, { conceptIds: [...current, concept.id] });
      }
      setConceptIds((prev) => (prev.includes(concept.id) ? prev : [...prev, concept.id]));
    },
    [ws, note.id]
  );

  const onLink = useCallback(
    async (concept: ConceptRecord) => {
      setBusy(true);
      setError("");
      try {
        await linkConcept(concept, conceptIds);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to link concept");
      } finally {
        setBusy(false);
      }
    },
    [linkConcept, conceptIds]
  );

  const onCreateAndLink = useCallback(
    async (name: string) => {
      setBusy(true);
      setError("");
      try {
        // Dedupe exactly like 选中即建: an existing same-named concept links instead.
        let concept = matchConceptByName(concepts, name);
        if (!concept) {
          concept = (await entityClient.createConcept({ name: conceptNameFromSelection(name) })).concept;
          setConcepts((prev) => [...prev, concept as ConceptRecord]);
          ws?.refreshConcepts();
        }
        await linkConcept(concept, conceptIds);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create concept");
      } finally {
        setBusy(false);
      }
    },
    [concepts, ws, linkConcept, conceptIds]
  );

  const onNavigate = useCallback(
    (conceptId: string) => {
      ws?.focus.setFocus({ type: "concept", conceptId });
      onNavigated?.();
    },
    [ws, onNavigated]
  );

  return (
    <>
      <ConceptChips
        conceptIds={conceptIds}
        concepts={concepts}
        busy={busy}
        onNavigate={onNavigate}
        onLink={(concept) => void onLink(concept)}
        onCreateAndLink={(name) => void onCreateAndLink(name)}
      />
      {error ? <div className="concept-chips-error">{error}</div> : null}
    </>
  );
}
