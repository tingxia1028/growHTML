// GenerationConceptChips (CG-2 "AI 顺手挂" preview half) — the REMOVABLE chip row
// for AI-suggested concept names on a pending generation draft. Self-contained and
// CONTROLLED so any preview host can mount it in three lines (see the FloatingNote-
// Editor mount snippet in the CG-123 progress entry):
//
//   const [chips, setChips] = useState<string[]>(pendingDraft?.concepts ?? []);
//   …reseed setChips(pendingDraft?.concepts ?? []) when the draft identity changes…
//   <GenerationConceptChips names={chips} onChange={setChips} />
//   …Save: savePendingDraft(editedContent, chips)
//
// Until a host mounts it, saving still links the suggestions: savePendingDraft
// falls back to the draft's own `concepts` when no explicit list is passed.

import { conceptMessages } from "./conceptMessages";
import { t } from "../i18n";
import "./conceptGraph.css";

export function GenerationConceptChips({
  names,
  onChange
}: {
  names: readonly string[];
  onChange(next: string[]): void;
}) {
  if (names.length === 0) return null;
  return (
    <div className="generation-preview-concepts" aria-label={t(conceptMessages.suggestedConcepts)}>
      <span className="generation-preview-concepts-label">{t(conceptMessages.suggestedConcepts)}</span>
      {names.map((name) => (
        <span key={name} className="concept-chip generation-concept-chip" data-concept-name={name}>
          {name}
          <button
            type="button"
            className="concept-chip-remove"
            aria-label={`${t(conceptMessages.removeSuggested)}: ${name}`}
            onClick={() => onChange(names.filter((existing) => existing !== name))}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}
