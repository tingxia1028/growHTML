// Market detail-page preview fixtures (M2a — docs/design/plugin-viewer-model.md §8.4.3).
// React-free peer of catalog.ts. A preview fixture is a { contentType, sampleContent }
// pair the market renders THROUGH the plugin's own registered renderer (§8.4.3 — the
// market owns no bespoke preview renderer). The sampleContent MUST validate against the
// core NoteContentSpec for its contentType (the §8.4.3 invariant — an invalid fixture
// would silently render as InertNote); catalogPreview.test.ts / catalog.test.ts lock it.
//
// The shapes are NOT re-authored here: they REUSE the deterministic, schema-valid
// `KitPrompt.mockContent` the kits already ship (src/kits/**/prompts) — the same sample
// data the offline/e2e generation preview uses. This keeps ONE source of truth for each
// type's exemplar content (no drift between the market preview and the generation mock).
//
// Wiring: on import this module attaches `previewFixtures` onto every bundled kit entry
// (via catalog.setPreviewFixtures), so the CatalogEntry read model carries them; the
// market listing then threads them through CatalogSource (M2b). `previewsFor(entryId)` is
// the pure selector the source uses — the union of the entry's members' provided types,
// each paired with its fixture, deduped and in member order.

import { catalogKitMembers, getCatalogEntry, listCatalogEntries, setPreviewFixtures, type CatalogEntry } from "./catalog";
import { explainConceptPrompt, generatePracticePrompt, generateReviewPackPrompt } from "./textbook-learning/prompts";
import {
  generateArgumentPrompt,
  generateCauseEffectPrompt,
  generateDerivationPrompt,
  generateExcerptPrompt,
  generateExperimentPrompt,
  generateFigurePrompt,
  generateFormulaPrompt,
  generateGrammarPrompt,
  generateTheoremPrompt,
  generateTimelinePrompt,
  generateVocabPrompt
} from "./subject/prompts";

export type PreviewFixture = { contentType: string; sampleContent: unknown; label?: string };

// contentType → a deterministic, schema-valid sample (the prompt pack's mockContent, run
// with an empty input so the fixture is stable). Every entry's key is a contentType a
// cataloged member PROVIDES and a client renderer REGISTERS; every value validates against
// that type's core NoteContentSpec (the fixtures inherit the prompts' schema-valid mocks).
const SAMPLE_BY_TYPE: Record<string, unknown> = {
  // textbook members
  "textbook.explanation": explainConceptPrompt.mockContent!({ anchorText: "光合作用把光能转化为化学能" }),
  "textbook.exercise": generatePracticePrompt.mockContent!({ anchorText: "牛顿第二定律 F = ma" }),
  "textbook.review-pack": generateReviewPackPrompt.mockContent!({
    sourceId: "sample-source",
    sourceTitle: "第一章 力学",
    explanations: [{ title: "动能定理" }],
    mistakes: [{ question: "混淆了功和能" }]
  }),
  // subject members (M-B + M-C)
  "subject.vocab": generateVocabPrompt.mockContent!({ anchorText: "example" }),
  "subject.formula": generateFormulaPrompt.mockContent!({}),
  "subject.timeline": generateTimelinePrompt.mockContent!({ anchorText: "战国至秦" }),
  "subject.derivation": generateDerivationPrompt.mockContent!({ anchorText: "动能定理推导" }),
  "subject.theorem": generateTheoremPrompt.mockContent!({ anchorText: "勾股定理" }),
  "subject.grammar": generateGrammarPrompt.mockContent!({ anchorText: "would rather" }),
  "subject.excerpt": generateExcerptPrompt.mockContent!({ anchorText: "落霞与孤鹜齐飞" }),
  "subject.argument": generateArgumentPrompt.mockContent!({ anchorText: "科技与教育公平" }),
  "subject.figure": generateFigurePrompt.mockContent!({ anchorText: "商鞅" }),
  "subject.cause-effect": generateCauseEffectPrompt.mockContent!({ anchorText: "商鞅变法" }),
  "subject.experiment": generateExperimentPrompt.mockContent!({ anchorText: "测量密度" })
};

/** A preview fixture for a single contentType, or undefined when there is no fixture
    (core types / types with no shipped mock — the market simply shows no preview row). */
export function fixtureForContentType(contentType: string): PreviewFixture | undefined {
  if (!(contentType in SAMPLE_BY_TYPE)) return undefined;
  return { contentType, sampleContent: SAMPLE_BY_TYPE[contentType] };
}

/**
 * The preview fixtures for a catalog entry (§8.4.3) — pure over the catalog read model:
 *   • a KIT → the union of its members' PROVIDED contentTypes (member order, deduped),
 *     each paired with its fixture (types with no fixture are skipped);
 *   • a PLUGIN → its own provided types' fixtures (the internal read model; the local
 *     source lists kits only, but this stays total so a remote plugin listing previews
 *     the same way).
 * Empty array when the entry is unknown or provides nothing previewable.
 */
export function previewsFor(entryId: string): PreviewFixture[] {
  const entry = getCatalogEntry(entryId);
  if (!entry) return [];
  const providedTypes =
    entry.kind === "kit"
      ? Array.from(
          new Set(catalogKitMembers(entryId).flatMap((memberId) => getCatalogEntry(memberId)?.provides ?? []))
        )
      : entry.provides ?? [];
  return providedTypes
    .map((contentType) => fixtureForContentType(contentType))
    .filter((fixture): fixture is PreviewFixture => fixture !== undefined);
}

/** Attach `previewFixtures` onto every bundled KIT entry (the read model carries them,
    §8.2). Idempotent + re-runnable after resetCatalog (tests): reads live catalog state. */
export function attachPreviewFixtures(): void {
  for (const entry of listCatalogEntries().filter((e: CatalogEntry) => e.kind === "kit")) {
    const fixtures = previewsFor(entry.id);
    if (fixtures.length > 0) setPreviewFixtures(entry.id, fixtures);
  }
}

attachPreviewFixtures();
