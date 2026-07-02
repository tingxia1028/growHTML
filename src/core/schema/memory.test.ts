import { describe, expect, it } from "vitest";
import { memoryEventSchema, memorySubjectSchema, memoryVerbSchema } from "./memory";

const ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

const base = {
  id: `mem_${ULID}`,
  type: "memoryEvent" as const,
  schemaVersion: 1 as const,
  createdAt: "2026-07-01T08:00:00.000Z",
  updatedAt: "2026-07-01T08:00:00.000Z",
  createdBy: "user" as const,
  verb: "note.create" as const
};

describe("memoryEventSchema", () => {
  it("pins the CLOSED core verb enum (learner-memory §3 — exactly these twelve)", () => {
    expect(memoryVerbSchema.options).toEqual([
      "open",
      "read",
      "anchor.create",
      "note.create",
      "note.edit",
      "note.review",
      "ai.ask",
      "ai.generate",
      "import",
      "export",
      "search",
      "navigate"
    ]);
  });

  it("accepts a minimal event and defaults subject + envelope metadata", () => {
    const parsed = memoryEventSchema.parse(base);
    expect(parsed.subject).toEqual({});
    expect(parsed.metadata).toEqual({});
    expect(parsed.payload).toBeUndefined();
    expect(parsed.sessionId).toBeUndefined();
  });

  it("accepts a full event (subject + payload + sessionId)", () => {
    const parsed = memoryEventSchema.parse({
      ...base,
      verb: "ai.generate",
      subject: {
        sourceId: `src_${ULID}`,
        anchorId: `anchor_${ULID}`,
        noteId: `note_${ULID}`,
        conceptId: `concept_${ULID}`,
        layerId: `layer_${ULID}`,
        kitId: "textbook-learning",
        contentType: "textbook.explanation"
      },
      payload: { commandId: "textbook.explain-concept", durationMs: 1200 },
      sessionId: "s123abc"
    });
    expect(parsed.verb).toBe("ai.generate");
    expect(parsed.subject.sourceId).toBe(`src_${ULID}`);
    expect(parsed.payload).toEqual({ commandId: "textbook.explain-concept", durationMs: 1200 });
    expect(parsed.sessionId).toBe("s123abc");
  });

  it("rejects verbs outside the closed enum", () => {
    expect(() => memoryEventSchema.parse({ ...base, verb: "note.remove" })).toThrow();
    expect(() => memoryEventSchema.parse({ ...base, verb: "" })).toThrow();
  });

  it("rejects a wrong id prefix and a wrong type literal", () => {
    expect(() => memoryEventSchema.parse({ ...base, id: `note_${ULID}` })).toThrow();
    expect(() => memoryEventSchema.parse({ ...base, id: "mem_not-a-ulid" })).toThrow();
    expect(() => memoryEventSchema.parse({ ...base, type: "note" })).toThrow();
  });

  it("validates subject ids against the referenced entities' grammars", () => {
    expect(() => memorySubjectSchema.parse({ sourceId: "nope" })).toThrow();
    expect(() => memorySubjectSchema.parse({ noteId: `anchor_${ULID}` })).toThrow();
    expect(memorySubjectSchema.parse({})).toEqual({});
    expect(memorySubjectSchema.parse({ contentType: "markdown" })).toEqual({ contentType: "markdown" });
  });
});
