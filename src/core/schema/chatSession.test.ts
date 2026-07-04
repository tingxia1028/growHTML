// chatSession schema (ai-workspace.md §2.1, W1): envelope + roundtrip, the message
// `ts` requirement, the attachments context-set shape, and the PRIVACY invariant —
// chat sessions are NOT part of the generic vaultEntitySchema union (like memory/
// operation), so no generic entity flow can pick a conversation up by accident.
import { describe, expect, it } from "vitest";
import { chatSessionSchema, vaultEntitySchema } from ".";
import { createEntityId, isEntityId } from "../ids";

const ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

const fixtureSession = {
  id: `chat_${ULID}`,
  type: "chatSession" as const,
  schemaVersion: 1 as const,
  createdAt: "2026-07-04T08:00:00.000Z",
  updatedAt: "2026-07-04T08:00:05.000Z",
  createdBy: "user" as const,
  title: "光合作用是什么？",
  messages: [
    { role: "user" as const, content: "光合作用是什么？", ts: "2026-07-04T08:00:00.000Z" },
    { role: "assistant" as const, content: "光合作用把光能转化为化学能。", ts: "2026-07-04T08:00:05.000Z" }
  ],
  attachments: [{ sourceId: `src_${ULID}`, includeNotes: true }]
};

describe("chatSession schema", () => {
  it("roundtrips a full session (messages with ts + attachment context refs)", () => {
    const parsed = chatSessionSchema.parse(fixtureSession);
    expect(parsed).toEqual({ ...fixtureSession, metadata: {} });
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.attachments[0].sourceId).toBe(`src_${ULID}`);
  });

  it("defaults title/messages/attachments and attachment includeNotes", () => {
    const parsed = chatSessionSchema.parse({
      ...fixtureSession,
      title: undefined,
      messages: undefined,
      attachments: undefined
    });
    expect(parsed.title).toBe("");
    expect(parsed.messages).toEqual([]);
    expect(parsed.attachments).toEqual([]);
    const withAttachment = chatSessionSchema.parse({
      ...fixtureSession,
      attachments: [{ sourceId: `src_${ULID}` }]
    });
    expect(withAttachment.attachments[0].includeNotes).toBe(true);
  });

  it("accepts ids minted by createEntityId('chatSession')", () => {
    const id = createEntityId("chatSession");
    expect(isEntityId("chatSession", id)).toBe(true);
    expect(chatSessionSchema.parse({ ...fixtureSession, id }).id).toBe(id);
  });

  it("rejects a wrong id prefix, a bad role, empty content, and a message without ts", () => {
    expect(() => chatSessionSchema.parse({ ...fixtureSession, id: `note_${ULID}` })).toThrow();
    expect(() =>
      chatSessionSchema.parse({
        ...fixtureSession,
        messages: [{ role: "tool", content: "x", ts: fixtureSession.createdAt }]
      })
    ).toThrow();
    expect(() =>
      chatSessionSchema.parse({
        ...fixtureSession,
        messages: [{ role: "user", content: "", ts: fixtureSession.createdAt }]
      })
    ).toThrow();
    expect(() =>
      chatSessionSchema.parse({ ...fixtureSession, messages: [{ role: "user", content: "x" }] })
    ).toThrow();
  });

  it("rejects a non-source attachment ref", () => {
    expect(() =>
      chatSessionSchema.parse({ ...fixtureSession, attachments: [{ sourceId: `note_${ULID}` }] })
    ).toThrow();
  });

  it("stays OUT of the generic vaultEntitySchema union (privacy invariant)", () => {
    expect(() => vaultEntitySchema.parse(fixtureSession)).toThrow();
  });
});
