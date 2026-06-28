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

