// @vitest-environment jsdom
// The runCommand → memory bridge (MEM-1): a whitelisted command that just succeeded
// queues exactly one event with the honest verb + subject; anything off the whitelist
// records NOTHING (the verb enum is closed). Exercised through the REAL runCommand so
// the registry hook itself is covered, with the queue drained via flushNow.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryVerbSchema } from "../../core/schema";
import { runCommand, type CommandContext } from "../commands/registry";
import type { AnyAnchor, MemoryEventInput } from "../data/entityClient";
import type { FocusContextValue } from "../focus/FocusContext";
import { flushNow, resetMemoryCaptureForTests, setMemoryTransportForTests } from "./capture";
import { commandVerbWhitelist, recordCommandMemory } from "./commandCapture";

const anchor: AnyAnchor = {
  id: "anchor_1",
  sourceId: "src_1",
  anchorKind: "html_selection",
  studyId: "p1",
  selector: '[data-study-id="p1"]',
  quote: "passage"
};

function fakeFocus(over: Partial<FocusContextValue> = {}): FocusContextValue {
  return {
    focus: { type: "anchor", anchorId: anchor.id } as never,
    draft: null,
    anchor,
    revealSeq: 0,
    setFocus: vi.fn(),
    setDraft: vi.fn(),
    setAnchor: vi.fn(),
    clear: vi.fn(),
    materializeAnchor: vi.fn(async () => anchor),
    ...over
  };
}

function baseCtx(over: Partial<CommandContext> = {}): CommandContext {
  return {
    focus: fakeFocus(),
    client: {
      createNote: vi.fn(async () => ({ note: { id: "note_1" } as never })),
      createPatch: vi.fn(async () => ({ patch: { id: "patch_1" } as never })),
      chat: vi.fn(async () => ({ message: { role: "assistant" as const, content: "hi" }, provider: "mock" })),
      createConcept: vi.fn(async () => ({ concept: { id: "concept_1" } as never })),
      updateNote: vi.fn(async () => ({ note: { id: "note_1" } as never })),
      createRelation: vi.fn(async () => ({ relation: { id: "rel_1" } as never })),
      patchLayer: vi.fn(async () => ({ layer: { id: "layer_1" } as never })),
      createLayer: vi.fn(async () => ({ layer: { id: "layer_1" } as never })),
      deleteLayer: vi.fn(async () => ({ ok: true as const })),
      generateStructured: vi.fn(async () => ({ content: {}, provider: "mock" })),
      generateBlock: vi.fn(async () => ({ contentType: "markdown", content: "routed", provider: "mock" })),
      notes: vi.fn(async () => ({ notes: [] as never })),
      deleteNote: vi.fn(async () => ({ ok: true as const }))
    },
    sourceId: "src_1",
    payload: {},
    actions: {},
    ...over
  };
}

let posted: MemoryEventInput[][];

async function recorded(): Promise<MemoryEventInput[]> {
  await flushNow();
  return posted.flat();
}

beforeEach(() => {
  resetMemoryCaptureForTests();
  posted = [];
  setMemoryTransportForTests(async (events) => {
    posted.push(events);
  });
});

afterEach(() => {
  setMemoryTransportForTests(null);
  resetMemoryCaptureForTests();
});

describe("runCommand → memory capture", () => {
  it("anchor.add-note records note.create with the focus subject", async () => {
    const ran = await runCommand("anchor.add-note", baseCtx({ payload: { text: "my note" } }));
    expect(ran).toBe(true);

    const events = await recorded();
    expect(events).toHaveLength(1);
    expect(events[0].verb).toBe("note.create");
    expect(events[0].subject).toEqual({ sourceId: "src_1", anchorId: "anchor_1" });
    expect(events[0].payload).toEqual({ commandId: "anchor.add-note" });
  });

  it("anchor.ask-ai records ai.ask", async () => {
    await runCommand("anchor.ask-ai", baseCtx({ payload: { text: "why?" } }));
    const events = await recorded();
    expect(events.map((e) => e.verb)).toEqual(["ai.ask"]);
    expect(events[0].subject?.sourceId).toBe("src_1");
  });

  it("note.delete records note.edit with action:delete and the note subject", async () => {
    await runCommand("note.delete", baseCtx({ payload: { noteId: "note_1" }, actions: { confirm: () => true } }));
    const events = await recorded();
    expect(events).toHaveLength(1);
    expect(events[0].verb).toBe("note.edit");
    expect(events[0].payload).toEqual({ commandId: "note.delete", action: "delete" });
    expect(events[0].subject?.noteId).toBe("note_1");
  });

  it("note.set-layers records note.edit with the layered note as subject", async () => {
    await runCommand("note.set-layers", baseCtx({ payload: { layerNoteId: "note_1", layerIds: ["layer_1"] } }));
    const events = await recorded();
    expect(events[0].verb).toBe("note.edit");
    expect(events[0].payload).toEqual({ commandId: "note.set-layers", action: "set-layers" });
    expect(events[0].subject?.noteId).toBe("note_1");
  });

  it("unmapped commands run fine but record NOTHING (the enum stays closed)", async () => {
    expect(await runCommand("concept.create", baseCtx({ payload: { conceptName: "Cell" } }))).toBe(true);
    expect(await runCommand("layer.toggle", baseCtx({ payload: { layerId: "layer_1", enabled: false } }))).toBe(true);
    expect(
      await runCommand("anchor.create-patch", baseCtx({ payload: { newContent: "<p>new</p>", oldText: "old" } }))
    ).toBe(true);
    expect(await recorded()).toEqual([]);
  });

  it("a command that did NOT run records nothing", async () => {
    expect(await runCommand("anchor.add-note", baseCtx({ payload: {} }))).toBe(false); // unavailable
    expect(await runCommand("no.such.command", baseCtx())).toBe(false);
    expect(await recorded()).toEqual([]);
  });
});

describe("the verb whitelist", () => {
  it("kit generate commands map to ai.generate with their fixed output contentType", async () => {
    // The textbook commands register only when the kit installs, so exercise the
    // bridge directly — the mapping is what MEM-1 owns.
    recordCommandMemory("textbook.explain-concept", baseCtx());
    recordCommandMemory("textbook.mark-as-mistake", baseCtx());
    const events = await recorded();
    expect(events.map((e) => e.verb)).toEqual(["ai.generate", "ai.generate"]);
    expect(events[0].subject?.contentType).toBe("textbook.explanation");
    expect(events[1].subject?.contentType).toBe("textbook.mistake");
  });

  it("operation.run maps to ai.generate carrying the op id and output type", async () => {
    recordCommandMemory(
      "operation.run",
      baseCtx({ payload: { operationId: "op_1", outputType: "markdown", scope: "anchor" } })
    );
    const events = await recorded();
    expect(events[0].verb).toBe("ai.generate");
    expect(events[0].subject?.contentType).toBe("markdown");
    expect(events[0].payload).toEqual({ commandId: "operation.run", promptId: "op_1" });
  });

  it("bookmark.add maps to note.create with the bookmark contentType", async () => {
    recordCommandMemory("bookmark.add", baseCtx());
    const events = await recorded();
    expect(events[0].verb).toBe("note.create");
    expect(events[0].subject?.contentType).toBe("bookmark");
    expect(events[0].payload).toEqual({ commandId: "bookmark.add", action: "bookmark" });
  });

  it("every whitelisted verb is a member of the CLOSED core enum", () => {
    for (const [commandId, rule] of Object.entries(commandVerbWhitelist)) {
      expect(memoryVerbSchema.options, `${commandId} maps outside the closed enum`).toContain(rule.verb);
    }
  });
});
