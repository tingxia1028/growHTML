import { describe, expect, it } from "vitest";
import { createEntityId, getEntityKindFromId, isEntityId } from "./ids";

describe("entity ids", () => {
  it("creates typed ULID ids", () => {
    const sourceId = createEntityId("source");
    const patchId = createEntityId("patch");

    expect(isEntityId("source", sourceId)).toBe(true);
    expect(isEntityId("patch", patchId)).toBe(true);
    expect(isEntityId("source", patchId)).toBe(false);
  });

  it("can infer entity kind from an id", () => {
    const noteId = createEntityId("note");

    expect(getEntityKindFromId(noteId)).toBe("note");
    expect(getEntityKindFromId("unknown_01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBeNull();
  });

  it("generates unique ids", () => {
    const ids = new Set(Array.from({ length: 100 }, () => createEntityId("anchor")));

    expect(ids.size).toBe(100);
  });
});

