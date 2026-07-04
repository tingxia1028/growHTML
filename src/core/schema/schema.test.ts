import { describe, expect, it } from "vitest";
import {
  anchorSchema,
  noteSchema,
  operationSchema,
  operationVariableSchema,
  relationSchema,
  sourceSchema,
  vaultEntitySchema
} from ".";
import {
  fixtureAnchor,
  fixtureNote,
  fixtureRelation,
  fixtureSource,
  goldenEntities
} from "../fixtures/golden";

describe("vault entity schemas", () => {
  it("accepts all golden fixtures", () => {
    for (const entity of goldenEntities) {
      expect(vaultEntitySchema.parse(entity)).toEqual(entity);
    }
  });

  it("rejects invalid envelope data", () => {
    expect(() =>
      sourceSchema.parse({
        ...fixtureSource,
        id: "source_not-a-valid-id"
      })
    ).toThrow();

    expect(() =>
      sourceSchema.parse({
        ...fixtureSource,
        schemaVersion: 2
      })
    ).toThrow();
  });

  it("keeps notes private by default", () => {
    const parsed = noteSchema.parse({
      ...fixtureNote,
      visibility: undefined
    });

    expect(parsed.visibility).toBe("private");
  });

  it("defaults note contentType to markdown and gives every entity a metadata escape hatch", () => {
    const parsed = noteSchema.parse({
      ...fixtureNote,
      contentType: undefined,
      metadata: undefined
    });

    expect(parsed.contentType).toBe("markdown");
    expect(parsed.metadata).toEqual({});
    // metadata is shared via the envelope, so non-note entities have it too.
    expect(sourceSchema.parse({ ...fixtureSource, metadata: undefined }).metadata).toEqual({});
  });

  it("accepts an open-string note contentType for note plugins", () => {
    expect(noteSchema.parse({ ...fixtureNote, contentType: "mindmap" }).contentType).toBe("mindmap");
  });

  it("accepts an optional D6 draft status and omits it by default (zero-migration round-trip)", () => {
    // ABSENT status = a normal committed note: a pre-existing note parses with status
    // undefined and does NOT gain the field (zero migration).
    const normal = noteSchema.parse(fixtureNote);
    expect(normal.status).toBeUndefined();
    expect("status" in normal).toBe(false);

    // status:"draft" (the auto-materialize flag) round-trips.
    const draft = noteSchema.parse({ ...fixtureNote, status: "draft" });
    expect(draft.status).toBe("draft");

    // The field is CLOSED to the single literal — any other value is rejected.
    expect(() => noteSchema.parse({ ...fixtureNote, status: "published" })).toThrow();
    expect(() => noteSchema.parse({ ...fixtureNote, status: "" })).toThrow();
  });

  it("treats note layerIds as a multi-membership array (defaults empty, validates ids)", () => {
    expect(noteSchema.parse({ ...fixtureNote, layerIds: undefined }).layerIds).toEqual([]);
    const layerId = "layer_01ARZ3NDEKTSV4RRFFQ69G5FAX";
    expect(noteSchema.parse({ ...fixtureNote, layerIds: [layerId] }).layerIds).toEqual([layerId]);
    expect(() => noteSchema.parse({ ...fixtureNote, layerIds: "not-an-array" })).toThrow();
    expect(() => noteSchema.parse({ ...fixtureNote, layerIds: ["note_01ARZ3NDEKTSV4RRFFQ69G5FAX"] })).toThrow();
  });

  it("uses a discriminated anchor union", () => {
    expect(anchorSchema.parse(fixtureAnchor).anchorKind).toBe("html_selection");
    expect(() =>
      anchorSchema.parse({
        ...fixtureAnchor,
        anchorKind: "html_selection",
        selector: undefined
      })
    ).toThrow();
  });

  it("accepts a valid operation record and applies defaults", () => {
    const op = operationSchema.parse({
      id: "op_01ARZ3NDEKTSV4RRFFQ69G5FAX",
      type: "operation",
      schemaVersion: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdBy: "user",
      name: "Summarize",
      outputContentType: "markdown",
      promptTemplate: "Summarize {{anchorText}}"
    });
    expect(op.declaredVariables).toEqual([]);
    expect(op.source).toBe("custom");
    expect(op.scope).toBe("anchor");
    expect(op.description).toBe("");
  });

  it("rejects an operation with an empty name or missing promptTemplate", () => {
    const base = {
      id: "op_01ARZ3NDEKTSV4RRFFQ69G5FAX",
      type: "operation" as const,
      schemaVersion: 1 as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdBy: "user" as const,
      name: "Summarize",
      outputContentType: "markdown",
      promptTemplate: "Summarize {{anchorText}}"
    };
    expect(() => operationSchema.parse({ ...base, name: "" })).toThrow();
    expect(() => operationSchema.parse({ ...base, promptTemplate: undefined })).toThrow();
    expect(() => operationSchema.parse({ ...base, outputContentType: "" })).toThrow();
    expect(() => operationSchema.parse({ ...base, id: "concept_01ARZ3NDEKTSV4RRFFQ69G5FAX" })).toThrow();
  });

  // ACTION-2a: simple mode (一句话新增) on the same entity. V1 records carry no
  // `mode` and must default to "template" (pinned above by the defaults test —
  // this block is ADDITIVE).
  it("accepts a simple-mode operation (instruction only, output type AUTO) and defaults old records to template", () => {
    const base = {
      id: "op_01ARZ3NDEKTSV4RRFFQ69G5FAX",
      type: "operation" as const,
      schemaVersion: 1 as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdBy: "user" as const,
      name: "苏格拉底提问"
    };
    const simple = operationSchema.parse({
      ...base,
      mode: "simple",
      instruction: "用苏格拉底式追问考我选中的内容,一次只问一个问题"
    });
    expect(simple.mode).toBe("simple");
    expect(simple.promptTemplate).toBeUndefined(); // no template needed
    expect(simple.outputContentType).toBeUndefined(); // AUTO — the form router decides
    // A pinned output type is also allowed (the 高级 disclosure).
    expect(operationSchema.parse({ ...base, mode: "simple", instruction: "考我", outputContentType: "quiz" }).outputContentType).toBe("quiz");

    // V1 record shape (no mode) → template, byte-compatible defaults.
    const v1 = operationSchema.parse({ ...base, outputContentType: "markdown", promptTemplate: "Summarize {{anchorText}}" });
    expect(v1.mode).toBe("template");
  });

  it("mode-conditional requirements: simple needs an instruction; template still needs template + output type", () => {
    const base = {
      id: "op_01ARZ3NDEKTSV4RRFFQ69G5FAX",
      type: "operation" as const,
      schemaVersion: 1 as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdBy: "user" as const,
      name: "x"
    };
    expect(() => operationSchema.parse({ ...base, mode: "simple" })).toThrow();
    expect(() => operationSchema.parse({ ...base, mode: "simple", instruction: "   " })).toThrow();
    expect(() => operationSchema.parse({ ...base, mode: "template", promptTemplate: "t {{x}}" })).toThrow(); // no outputContentType
    expect(() => operationSchema.parse({ ...base, mode: "template", outputContentType: "markdown" })).toThrow(); // no promptTemplate
  });

  it("enforces the {{var}}-safe identifier grammar on declared variables", () => {
    expect(operationVariableSchema.parse({ name: "anchorText", source: "anchorText" }).required).toBe(false);
    expect(() => operationVariableSchema.parse({ name: "1bad", source: "literal" })).toThrow();
    expect(() => operationVariableSchema.parse({ name: "a-b", source: "literal" })).toThrow();
  });

  it("validates relation node refs", () => {
    expect(relationSchema.parse(fixtureRelation).from.type).toBe("note");
    expect(() =>
      relationSchema.parse({
        ...fixtureRelation,
        to: { type: "concept", id: "note_01ARZ3NDEKTSV4RRFFQ69G5FAX" }
      })
    ).toThrow();
  });
});

