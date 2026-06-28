import { describe, expect, it } from "vitest";
import {
  anchorSchema,
  noteSchema,
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

