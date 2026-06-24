import {
  anchorSchema,
  conceptSchema,
  noteSchema,
  patchSchema,
  relationSchema,
  sourceSchema
} from "../schema";

export const fixtureTimestamp = "2026-06-23T00:00:00.000Z";

export const fixtureHtmlBody = `<article data-study-id="doc-root">
  <section data-study-id="sec-render-thread">
    <h1>Render Thread</h1>
    <p data-study-id="p-render-thread">Render Thread submits rendering commands.</p>
  </section>
</article>`;

export const fixtureSource = sourceSchema.parse({
  id: "src_01ARZ3NDEKTSV4RRFFQ69G5FAV",
  type: "source",
  schemaVersion: 1,
  createdAt: fixtureTimestamp,
  updatedAt: fixtureTimestamp,
  createdBy: "system",
  sourceType: "html",
  title: "Render Thread Study Note",
  path: "sources/render-thread.html",
  mimeType: "text/html",
  contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  metadata: {}
});

export const fixtureAnchor = anchorSchema.parse({
  id: "anchor_01ARZ3NDEKTSV4RRFFQ69G5FAW",
  type: "anchor",
  schemaVersion: 1,
  createdAt: fixtureTimestamp,
  updatedAt: fixtureTimestamp,
  createdBy: "user",
  sourceId: fixtureSource.id,
  anchorKind: "html_selection",
  studyId: "p-render-thread",
  selector: '[data-study-id="p-render-thread"]',
  quote: "Render Thread submits rendering commands.",
  contextBefore: "",
  contextAfter: ""
});

export const fixtureNote = noteSchema.parse({
  id: "note_01ARZ3NDEKTSV4RRFFQ69G5FAX",
  type: "note",
  schemaVersion: 1,
  createdAt: fixtureTimestamp,
  updatedAt: fixtureTimestamp,
  createdBy: "user",
  sourceId: fixtureSource.id,
  anchorId: fixtureAnchor.id,
  noteKind: "explanation",
  title: "Render Thread explanation",
  question: "What does the render thread do?",
  content: "It prepares commands that describe how the current frame should be rendered.",
  linkedConceptIds: [],
  authorId: "local-user",
  visibility: "private"
});

export const fixturePatch = patchSchema.parse({
  id: "patch_01ARZ3NDEKTSV4RRFFQ69G5FAY",
  type: "patch",
  schemaVersion: 1,
  createdAt: fixtureTimestamp,
  updatedAt: fixtureTimestamp,
  createdBy: "user",
  sourceId: fixtureSource.id,
  anchorId: fixtureAnchor.id,
  action: "replace_selection",
  status: "pending",
  oldText: fixtureAnchor.quote,
  newContent: "<p data-study-id=\"p-render-thread\">Render Thread prepares GPU-facing rendering commands.</p>",
  summary: "Clarify the render thread responsibility."
});

export const fixtureConcept = conceptSchema.parse({
  id: "concept_01ARZ3NDEKTSV4RRFFQ69G5FAZ",
  type: "concept",
  schemaVersion: 1,
  createdAt: fixtureTimestamp,
  updatedAt: fixtureTimestamp,
  createdBy: "user",
  name: "Render Thread",
  aliases: ["UE Render Thread"],
  description: "A thread responsible for preparing rendering commands.",
  tags: ["rendering", "threading"],
  confidence: 0.9
});

export const fixtureRelation = relationSchema.parse({
  id: "rel_01ARZ3NDEKTSV4RRFFQ69G5FB0",
  type: "relation",
  schemaVersion: 1,
  createdAt: fixtureTimestamp,
  updatedAt: fixtureTimestamp,
  createdBy: "user",
  from: { type: "note", id: fixtureNote.id },
  to: { type: "concept", id: fixtureConcept.id },
  relationKind: "explains",
  label: "Explains concept",
  confidence: 0.9
});

export const goldenEntities = [
  fixtureSource,
  fixtureAnchor,
  fixtureNote,
  fixturePatch,
  fixtureConcept,
  fixtureRelation
] as const;

