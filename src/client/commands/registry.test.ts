import { describe, expect, it, vi } from "vitest";
import { getCommand, runCommand, type CommandContext } from "./registry";
import type { AnyAnchor, ChatMessage } from "../data/entityClient";
import type { FocusContextValue } from "../focus/FocusContext";

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
    focus: { type: "anchor-draft", draft: { mode: "quote", sourceId: "src_1", kind: "html", quote: "passage" } },
    draft: { mode: "quote", sourceId: "src_1", kind: "html", quote: "passage" },
    anchor: null,
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
      synthesize: vi.fn(async () => ({ source: { id: "src_new" } as never })),
      createConcept: vi.fn(async () => ({ concept: { id: "concept_1" } as never })),
      updateNote: vi.fn(async () => ({ note: { id: "note_1" } as never })),
      createRelation: vi.fn(async () => ({ relation: { id: "rel_1" } as never })),
      patchLayer: vi.fn(async () => ({ layer: { id: "layer_1" } as never })),
      createLayer: vi.fn(async () => ({ layer: { id: "layer_1" } as never })),
      deleteLayer: vi.fn(async () => ({ ok: true as const })),
      generateStructured: vi.fn(async () => ({ content: {}, contentType: "markdown", provider: "mock" })),
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

describe("command: anchor.add-note", () => {
  it("materializes the draft and creates an anchored note", async () => {
    const onNoteCreated = vi.fn();
    const ctx = baseCtx({ payload: { text: "my note" }, actions: { onNoteCreated } });

    const ran = await runCommand("anchor.add-note", ctx);

    expect(ran).toBe(true);
    expect(ctx.focus.materializeAnchor).toHaveBeenCalledOnce();
    expect(ctx.client.createNote).toHaveBeenCalledWith({
      sourceId: "src_1",
      anchorIds: ["anchor_1"],
      contentType: "markdown",
      content: "my note"
    });
    expect(onNoteCreated).toHaveBeenCalledOnce();
  });

  it("saves unanchored when there is no draft or anchor", async () => {
    const ctx = baseCtx({
      payload: { text: "loose note" },
      focus: fakeFocus({ focus: null, draft: null, materializeAnchor: vi.fn(async () => null) })
    });
    await runCommand("anchor.add-note", ctx);
    expect(ctx.client.createNote).toHaveBeenCalledWith(
      expect.objectContaining({ anchorIds: [], content: "loose note" })
    );
  });

  it("is unavailable with empty text", () => {
    expect(getCommand("anchor.add-note")!.isAvailable(baseCtx({ payload: { text: "  " } }))).toBe(false);
  });

  it("explicit payload.anchorIds SKIP focus materialization and save to the given anchors", async () => {
    // The generation-preview Save passes anchorIds (the generating command already
    // created the anchor), so add-note must reuse them and NOT materialize a duplicate.
    const ctx = baseCtx({
      payload: { content: { __type: "textbook.explanation" }, contentType: "textbook.explanation", anchorIds: ["anchor_pre"] }
    });
    await runCommand("anchor.add-note", ctx);
    expect(ctx.focus.materializeAnchor).not.toHaveBeenCalled();
    expect(ctx.client.createNote).toHaveBeenCalledWith({
      sourceId: "src_1",
      anchorIds: ["anchor_pre"],
      contentType: "textbook.explanation",
      content: { __type: "textbook.explanation" }
    });
  });

  it("an empty anchorIds array still OVERRIDES focus (saves unanchored, no materialize)", async () => {
    // Source-level drafts (e.g. Review Pack) save with anchorIds: [] — present-but-empty
    // must still skip materialization rather than fall back to the focus path.
    const ctx = baseCtx({
      payload: { content: { kind: "pack" }, contentType: "textbook.review-pack", anchorIds: [] }
    });
    await runCommand("anchor.add-note", ctx);
    expect(ctx.focus.materializeAnchor).not.toHaveBeenCalled();
    expect(ctx.client.createNote).toHaveBeenCalledWith(
      expect.objectContaining({ anchorIds: [], contentType: "textbook.review-pack" })
    );
  });

  it("without anchorIds it still materializes the anchor from focus (legacy path)", async () => {
    const ctx = baseCtx({ payload: { text: "my note" } });
    await runCommand("anchor.add-note", ctx);
    expect(ctx.focus.materializeAnchor).toHaveBeenCalledOnce();
    expect(ctx.client.createNote).toHaveBeenCalledWith(
      expect.objectContaining({ anchorIds: ["anchor_1"] })
    );
  });
});

describe("command: bookmark.add", () => {
  it("materializes the anchor and creates a bookmark note seeded from the quote", async () => {
    const onNoteCreated = vi.fn();
    const ctx = baseCtx({ actions: { onNoteCreated } });

    const ran = await runCommand("bookmark.add", ctx);

    expect(ran).toBe(true);
    expect(ctx.focus.materializeAnchor).toHaveBeenCalledOnce();
    expect(ctx.client.createNote).toHaveBeenCalledWith({
      sourceId: "src_1",
      anchorIds: ["anchor_1"],
      contentType: "bookmark",
      content: { label: "passage" }
    });
    expect(onNoteCreated).toHaveBeenCalledOnce();
  });

  it("payload.text overrides the seeded label (e.g. a chat quote)", async () => {
    const ctx = baseCtx({ payload: { text: "  Key   idea  " } });
    await runCommand("bookmark.add", ctx);
    expect(ctx.client.createNote).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: "bookmark", content: { label: "Key idea" } })
    );
  });

  it("saves an empty label for a region draft (no quote) and stays unanchored without an anchor", async () => {
    const ctx = baseCtx({
      focus: fakeFocus({
        draft: { mode: "region", sourceId: "src_1", kind: "html" } as never,
        materializeAnchor: vi.fn(async () => null)
      })
    });
    await runCommand("bookmark.add", ctx);
    expect(ctx.client.createNote).toHaveBeenCalledWith(
      expect.objectContaining({ anchorIds: [], contentType: "bookmark", content: { label: "" } })
    );
  });

  it("is unavailable without a draft or anchor in focus", () => {
    expect(
      getCommand("bookmark.add")!.isAvailable(baseCtx({ focus: fakeFocus({ focus: null, draft: null }) }))
    ).toBe(false);
  });
});

describe("command: anchor.create-patch", () => {
  it("creates a patch against the materialized anchor", async () => {
    const onPatchCreated = vi.fn();
    const ctx = baseCtx({
      payload: { newContent: "<p>new</p>", oldText: "old" },
      actions: { onPatchCreated }
    });
    await runCommand("anchor.create-patch", ctx);
    expect(ctx.client.createPatch).toHaveBeenCalledWith({
      sourceId: "src_1",
      anchorId: "anchor_1",
      oldText: "old",
      newContent: "<p>new</p>"
    });
    expect(onPatchCreated).toHaveBeenCalledOnce();
  });
});

describe("command: anchor.ask-ai", () => {
  it("appends the user message and reports the assistant reply", async () => {
    const onChatHistory = vi.fn();
    const onAssistantMessage = vi.fn();
    const ctx = baseCtx({
      payload: { text: "what is this?" },
      chatMessages: [{ role: "user", content: "earlier" }],
      actions: { onChatHistory, onAssistantMessage }
    });
    await runCommand("anchor.ask-ai", ctx);
    expect(onChatHistory).toHaveBeenCalledWith([
      { role: "user", content: "earlier" },
      { role: "user", content: "what is this?" }
    ]);
    expect(ctx.client.chat).toHaveBeenCalledOnce();
    expect(onAssistantMessage).toHaveBeenCalledWith({ role: "assistant", content: "hi" });
  });

  it("is unavailable without an active source", () => {
    expect(
      getCommand("anchor.ask-ai")!.isAvailable(baseCtx({ payload: { text: "q" }, sourceId: undefined }))
    ).toBe(false);
  });

  // V-1 (vision-input.md §2): an image attachment turns the user message into an ARRAY
  // (images first, then the text part); the seam resolves the assetId refs server-side.
  it("V-1: an image attachment builds an ARRAY user message (images first, then text)", async () => {
    const onChatHistory = vi.fn();
    const ctx = baseCtx({
      payload: {
        text: "what is this?",
        images: [{ type: "image", assetId: "asset_01ARZ3NDEKTSV4RRFFQ69G5FAV" }]
      },
      actions: { onChatHistory, onAssistantMessage: vi.fn() }
    });
    await runCommand("anchor.ask-ai", ctx);
    expect(onChatHistory).toHaveBeenCalledWith([
      {
        role: "user",
        content: [
          { type: "image", assetId: "asset_01ARZ3NDEKTSV4RRFFQ69G5FAV" },
          { type: "text", text: "what is this?" }
        ]
      }
    ]);
  });

  it("V-1: an image-ONLY turn (no text) is available and sends an array with just the image", async () => {
    const cmd = getCommand("anchor.ask-ai")!;
    const imageOnly = baseCtx({
      payload: { images: [{ type: "image", assetId: "asset_01ARZ3NDEKTSV4RRFFQ69G5FAV" }] }
    });
    expect(cmd.isAvailable(imageOnly)).toBe(true);

    const onChatHistory = vi.fn();
    const ctx = baseCtx({
      payload: { images: [{ type: "image", assetId: "asset_01ARZ3NDEKTSV4RRFFQ69G5FAV" }] },
      actions: { onChatHistory, onAssistantMessage: vi.fn() }
    });
    await runCommand("anchor.ask-ai", ctx);
    expect(onChatHistory).toHaveBeenCalledWith([
      { role: "user", content: [{ type: "image", assetId: "asset_01ARZ3NDEKTSV4RRFFQ69G5FAV" }] }
    ]);
  });

  // W1 (chat sessions): a STREAMED reply must hand hosts the completed turn via
  // onAssistantDone (persist-only — the chunks already built the visible message),
  // and must NOT double-append through onAssistantMessage.
  it("streamed reply: chunks flow to onAssistantChunk, the final turn to onAssistantDone", async () => {
    const onAssistantChunk = vi.fn();
    const onAssistantMessage = vi.fn();
    const onAssistantDone = vi.fn();
    const ctx = baseCtx({
      payload: { text: "explain" },
      actions: { onChatHistory: vi.fn(), onAssistantChunk, onAssistantMessage, onAssistantDone }
    });
    ctx.client.chatStream = vi.fn(async (_input, onDelta: (delta: string) => void) => {
      onDelta("part 1 ");
      onDelta("part 2");
      return { message: { role: "assistant" as const, content: "part 1 part 2" }, provider: "mock" };
    });
    await runCommand("anchor.ask-ai", ctx);
    expect(onAssistantChunk).toHaveBeenCalledTimes(2);
    expect(onAssistantDone).toHaveBeenCalledWith({ role: "assistant", content: "part 1 part 2" });
    expect(onAssistantMessage).not.toHaveBeenCalled();
  });

  it("no-delta stream fallback: onAssistantMessage appends the reply, onAssistantDone stays silent", async () => {
    const onAssistantMessage = vi.fn();
    const onAssistantDone = vi.fn();
    const ctx = baseCtx({
      payload: { text: "explain" },
      actions: { onChatHistory: vi.fn(), onAssistantChunk: vi.fn(), onAssistantMessage, onAssistantDone }
    });
    ctx.client.chatStream = vi.fn(async () => ({
      message: { role: "assistant" as const, content: "single reply" },
      provider: "mock"
    }));
    await runCommand("anchor.ask-ai", ctx);
    expect(onAssistantMessage).toHaveBeenCalledWith({ role: "assistant", content: "single reply" });
    expect(onAssistantDone).not.toHaveBeenCalled();
  });

  // W2: ask-ai awaits the feature-detected resolver and merges the resolved sources[]
  // into the sent context — additive over the flat chatContext.
  it("W2: resolves attachment bundles and sends them in the widened context", async () => {
    const resolveAttachmentBundles = vi.fn(async () => [
      { title: "Attached Doc", type: "html", excerpt: "body", notes: [{ text: "n" }] }
    ]);
    const ctx = baseCtx({
      payload: { text: "compare" },
      chatContext: { sourceTitle: "Focused", quote: "q" },
      resolveAttachmentBundles,
      actions: { onChatHistory: vi.fn(), onAssistantMessage: vi.fn() }
    });
    await runCommand("anchor.ask-ai", ctx);
    expect(resolveAttachmentBundles).toHaveBeenCalledOnce();
    expect(ctx.client.chat).toHaveBeenCalledWith({
      messages: expect.any(Array),
      context: {
        sourceTitle: "Focused",
        quote: "q",
        sources: [{ title: "Attached Doc", type: "html", excerpt: "body", notes: [{ text: "n" }] }]
      }
    });
  });

  it("W2: an EMPTY resolver result leaves the flat context byte-identical (no sources key)", async () => {
    const ctx = baseCtx({
      payload: { text: "q" },
      chatContext: { sourceTitle: "Focused" },
      resolveAttachmentBundles: vi.fn(async () => []),
      actions: { onChatHistory: vi.fn(), onAssistantMessage: vi.fn() }
    });
    await runCommand("anchor.ask-ai", ctx);
    expect(ctx.client.chat).toHaveBeenCalledWith({
      messages: expect.any(Array),
      context: { sourceTitle: "Focused" }
    });
    const sentContext = (ctx.client.chat as ReturnType<typeof vi.fn>).mock.calls[0][0].context;
    expect("sources" in sentContext).toBe(false);
  });

  it("W2: no resolver wired → sends the flat context unchanged (backward-compat)", async () => {
    const ctx = baseCtx({
      payload: { text: "q" },
      chatContext: { sourceTitle: "Focused" },
      actions: { onChatHistory: vi.fn(), onAssistantMessage: vi.fn() }
    });
    await runCommand("anchor.ask-ai", ctx);
    expect(ctx.client.chat).toHaveBeenCalledWith({
      messages: expect.any(Array),
      context: { sourceTitle: "Focused" }
    });
  });
});

describe("command: concept.create", () => {
  it("creates a concept with name + description and reports it", async () => {
    const onConceptChanged = vi.fn();
    const ctx = baseCtx({
      payload: { conceptName: "Render Thread", conceptDescription: "The UE render thread" },
      actions: { onConceptChanged }
    });
    const ran = await runCommand("concept.create", ctx);
    expect(ran).toBe(true);
    expect(ctx.client.createConcept).toHaveBeenCalledWith({
      name: "Render Thread",
      description: "The UE render thread"
    });
    expect(onConceptChanged).toHaveBeenCalledOnce();
  });

  it("is unavailable with a blank name", () => {
    expect(getCommand("concept.create")!.isAvailable(baseCtx({ payload: { conceptName: "  " } }))).toBe(false);
  });
});

describe("command: concept.link-note", () => {
  it("appends the concept to the note's existing links (no duplicates)", async () => {
    const onConceptChanged = vi.fn();
    const ctx = baseCtx({
      payload: { noteId: "note_1", conceptId: "concept_2", noteConceptIds: ["concept_1"] },
      actions: { onConceptChanged }
    });
    await runCommand("concept.link-note", ctx);
    expect(ctx.client.updateNote).toHaveBeenCalledWith("note_1", { conceptIds: ["concept_1", "concept_2"] });
    expect(onConceptChanged).toHaveBeenCalledOnce();
  });

  it("is idempotent when the link already exists", async () => {
    const ctx = baseCtx({ payload: { noteId: "note_1", conceptId: "concept_1", noteConceptIds: ["concept_1"] } });
    await runCommand("concept.link-note", ctx);
    expect(ctx.client.updateNote).toHaveBeenCalledWith("note_1", { conceptIds: ["concept_1"] });
  });

  it("is unavailable without both a note and a concept", () => {
    expect(getCommand("concept.link-note")!.isAvailable(baseCtx({ payload: { noteId: "note_1" } }))).toBe(false);
    expect(getCommand("concept.link-note")!.isAvailable(baseCtx({ payload: { conceptId: "concept_1" } }))).toBe(false);
  });
});

describe("command: note.link-anchor", () => {
  it("materializes the selection and appends its anchor id to the note (full-array replace)", async () => {
    const onNoteCreated = vi.fn();
    const ctx = baseCtx({
      payload: { noteId: "note_1", noteAnchorIds: ["anchor_0"] },
      actions: { onNoteCreated }
    });

    const ran = await runCommand("note.link-anchor", ctx);

    expect(ran).toBe(true);
    expect(ctx.focus.materializeAnchor).toHaveBeenCalledOnce();
    expect(ctx.client.updateNote).toHaveBeenCalledWith("note_1", { anchorIds: ["anchor_0", "anchor_1"] });
    expect(onNoteCreated).toHaveBeenCalledOnce();
  });

  it("appends to an empty link list (first extra anchor on a note)", async () => {
    const ctx = baseCtx({ payload: { noteId: "note_1" } });
    await runCommand("note.link-anchor", ctx);
    expect(ctx.client.updateNote).toHaveBeenCalledWith("note_1", { anchorIds: ["anchor_1"] });
  });

  it("appends onto the note's FRESH server anchorIds, not the stale payload snapshot", async () => {
    // Race guard: the card captured noteAnchorIds=["anchor_0"] at render, but a prior
    // link already landed server-side so the note now has ["anchor_0", "anchor_prev"].
    // The append must build on the fresh list (not clobber "anchor_prev").
    const notes = vi.fn(async () => ({
      notes: [{ id: "note_1", anchorIds: ["anchor_0", "anchor_prev"] }] as never
    }));
    const ctx = baseCtx({
      payload: { noteId: "note_1", noteAnchorIds: ["anchor_0"] },
      client: { ...baseCtx().client, notes }
    });
    await runCommand("note.link-anchor", ctx);
    expect(notes).toHaveBeenCalledWith("src_1");
    expect(ctx.client.updateNote).toHaveBeenCalledWith("note_1", {
      anchorIds: ["anchor_0", "anchor_prev", "anchor_1"]
    });
  });

  it("dedupes against the FRESH list (concurrent link already added this anchor)", async () => {
    // The fresh note already carries the anchor the focus would materialize → no-op,
    // even though the stale payload snapshot didn't list it yet.
    const notes = vi.fn(async () => ({ notes: [{ id: "note_1", anchorIds: ["anchor_1"] }] as never }));
    const ctx = baseCtx({
      payload: { noteId: "note_1", noteAnchorIds: [] },
      client: { ...baseCtx().client, notes }
    });
    await runCommand("note.link-anchor", ctx);
    expect(ctx.client.updateNote).not.toHaveBeenCalled();
  });

  it("dedupes — does NOT call updateNote when the materialized anchor is already linked", async () => {
    const ctx = baseCtx({ payload: { noteId: "note_1", noteAnchorIds: ["anchor_1"] } });
    const ran = await runCommand("note.link-anchor", ctx);
    expect(ran).toBe(true);
    expect(ctx.client.updateNote).not.toHaveBeenCalled();
  });

  it("is unavailable without a noteId, and without a focused anchor/draft", () => {
    // No note to link.
    expect(getCommand("note.link-anchor")!.isAvailable(baseCtx({ payload: {} }))).toBe(false);
    // Note id but no passage in focus.
    expect(
      getCommand("note.link-anchor")!.isAvailable(
        baseCtx({ payload: { noteId: "note_1" }, focus: fakeFocus({ focus: null, draft: null }) })
      )
    ).toBe(false);
  });
});

describe("command: relation.create", () => {
  it("creates a concept→concept relation with the chosen kind", async () => {
    const onRelationChanged = vi.fn();
    const ctx = baseCtx({
      payload: { fromConceptId: "concept_1", toConceptId: "concept_2", relationKind: "depends_on" },
      actions: { onRelationChanged }
    });
    await runCommand("relation.create", ctx);
    expect(ctx.client.createRelation).toHaveBeenCalledWith({
      from: { type: "concept", id: "concept_1" },
      to: { type: "concept", id: "concept_2" },
      relationKind: "depends_on",
      label: undefined
    });
    expect(onRelationChanged).toHaveBeenCalledOnce();
  });

  it("rejects a self-relation (same from/to)", () => {
    expect(
      getCommand("relation.create")!.isAvailable(
        baseCtx({ payload: { fromConceptId: "c1", toConceptId: "c1", relationKind: "related" } })
      )
    ).toBe(false);
  });
});

describe("command: layer.toggle", () => {
  it("patches the layer's enabled flag and reports the change", async () => {
    const onLayersChanged = vi.fn();
    const ctx = baseCtx({ payload: { layerId: "layer_1", enabled: false }, actions: { onLayersChanged } });
    const ran = await runCommand("layer.toggle", ctx);
    expect(ran).toBe(true);
    expect(ctx.client.patchLayer).toHaveBeenCalledWith("layer_1", { enabled: false });
    expect(onLayersChanged).toHaveBeenCalledOnce();
  });

  it("is unavailable without a layerId or a boolean enabled", () => {
    expect(getCommand("layer.toggle")!.isAvailable(baseCtx({ payload: { layerId: "layer_1" } }))).toBe(false);
    expect(getCommand("layer.toggle")!.isAvailable(baseCtx({ payload: { enabled: true } }))).toBe(false);
  });
});

describe("command: note.set-layers", () => {
  it("sets the note's FULL layer membership and reports the change", async () => {
    const onLayersChanged = vi.fn();
    const ctx = baseCtx({
      payload: { layerNoteId: "note_1", layerIds: ["layer_1", "layer_2"] },
      actions: { onLayersChanged }
    });
    const ran = await runCommand("note.set-layers", ctx);
    expect(ran).toBe(true);
    expect(ctx.client.updateNote).toHaveBeenCalledWith("note_1", { layerIds: ["layer_1", "layer_2"] });
    expect(onLayersChanged).toHaveBeenCalledOnce();
  });

  it("allows clearing membership (empty array is still a valid set)", async () => {
    const ctx = baseCtx({ payload: { layerNoteId: "note_1", layerIds: [] } });
    const ran = await runCommand("note.set-layers", ctx);
    expect(ran).toBe(true);
    expect(ctx.client.updateNote).toHaveBeenCalledWith("note_1", { layerIds: [] });
  });

  it("is unavailable without a note id or a layerIds array", () => {
    expect(getCommand("note.set-layers")!.isAvailable(baseCtx({ payload: { layerNoteId: "note_1" } }))).toBe(false);
    expect(getCommand("note.set-layers")!.isAvailable(baseCtx({ payload: { layerIds: ["layer_1"] } }))).toBe(false);
  });
});

describe("command: operation.run", () => {
  it("anchor-scope: materializes the passage, generates, and emits a GeneratedDraft", async () => {
    const onGenerated = vi.fn();
    const ctx = baseCtx({
      payload: {
        operationId: "op_1",
        outputType: "markdown",
        scope: "anchor",
        variables: [{ name: "topic", source: "anchorText", required: true }]
      },
      chatContext: { quote: "passage", sourceTitle: "Chapter 1" },
      actions: { onGenerated }
    });

    const ran = await runCommand("operation.run", ctx);

    expect(ran).toBe(true);
    expect(ctx.focus.materializeAnchor).toHaveBeenCalledOnce();
    // The declared {{topic}} (source anchorText) is mapped onto the materialized quote,
    // and the well-known keys are passed through for built-in placeholder merging.
    expect(ctx.client.generateStructured).toHaveBeenCalledWith({
      promptId: "op_1",
      contentType: "markdown",
      input: expect.objectContaining({ topic: "passage", anchorText: "passage", sourceTitle: "Chapter 1" })
    });
    expect(onGenerated).toHaveBeenCalledWith(
      expect.objectContaining({
        promptId: "op_1",
        contentType: "markdown",
        anchorId: "anchor_1",
        sourceId: "src_1",
        // A pinned outputType is NOT auto-form: Regenerate re-sends the same type.
        autoForm: false
      })
    );
    // No note is persisted in the preview path — Save does that later.
    expect(ctx.client.createNote).not.toHaveBeenCalled();
  });

  it("simple action (ACTION-2b, no outputType): dispatch omits contentType, the input carries the envelope's selection/doc feeds, and the ROUTED form comes back", async () => {
    const onGenerated = vi.fn();
    // The server routed the auto-output run to a markmap (the form router decided).
    const generateStructured = vi.fn(async () => ({
      content: { markdown: "# routed" },
      contentType: "markmap",
      provider: "mock"
    }));
    const ctx = baseCtx({
      payload: { operationId: "op_simple", scope: "anchor", variables: [] },
      chatContext: { quote: "passage", sourceTitle: "Chapter 1" },
      client: { ...baseCtx().client, generateStructured },
      actions: { onGenerated }
    });

    const ran = await runCommand("operation.run", ctx);

    expect(ran).toBe(true);
    // NO contentType is sent — the server compiles the 一句话 instruction + auto-context
    // envelope (composeAutoContext reads anchorText/sourceTitle off this input) and the
    // adaptive-note form router picks the note form.
    expect(generateStructured).toHaveBeenCalledWith({
      promptId: "op_simple",
      contentType: undefined,
      input: expect.objectContaining({ anchorText: "passage", sourceTitle: "Chapter 1" })
    });
    // The draft rides the preview loop under the ROUTED contentType, flagged autoForm
    // so Regenerate omits contentType again.
    expect(onGenerated).toHaveBeenCalledWith(
      expect.objectContaining({ promptId: "op_simple", contentType: "markmap", autoForm: true, anchorId: "anchor_1" })
    );
    expect(ctx.client.createNote).not.toHaveBeenCalled();
  });

  it("simple action auto-save fallback (no preview host) persists the ROUTED contentType", async () => {
    const onNoteCreated = vi.fn();
    const generateStructured = vi.fn(async () => ({ content: "routed", contentType: "markdown", provider: "mock" }));
    const ctx = baseCtx({
      payload: { operationId: "op_simple", scope: "anchor" },
      client: { ...baseCtx().client, generateStructured },
      actions: { onNoteCreated }
    });
    await runCommand("operation.run", ctx);
    expect(ctx.client.createNote).toHaveBeenCalledWith(
      expect.objectContaining({ anchorIds: ["anchor_1"], contentType: "markdown", content: "routed" })
    );
    expect(onNoteCreated).toHaveBeenCalledOnce();
  });

  it("source-scope: skips materialization and gathers existingNotes for the declared variable", async () => {
    const onGenerated = vi.fn();
    const notes = vi.fn(async () => ({ notes: [{ content: "n1" }, { content: "n2" }] as never }));
    const ctx = baseCtx({
      payload: {
        operationId: "op_2",
        outputType: "textbook.review-pack",
        scope: "source",
        variables: [{ name: "existingNotes", source: "existingNotes", required: false }]
      },
      client: { ...baseCtx().client, notes },
      actions: { onGenerated }
    });

    await runCommand("operation.run", ctx);

    expect(ctx.focus.materializeAnchor).not.toHaveBeenCalled();
    expect(notes).toHaveBeenCalledWith("src_1");
    expect(ctx.client.generateStructured).toHaveBeenCalledWith({
      promptId: "op_2",
      contentType: "textbook.review-pack",
      input: expect.objectContaining({ existingNotes: ["n1", "n2"] })
    });
    expect(onGenerated).toHaveBeenCalledWith(expect.objectContaining({ anchorId: undefined, sourceId: "src_1" }));
  });

  it("does not fetch notes when no declared variable needs them", async () => {
    const ctx = baseCtx({
      payload: { operationId: "op_3", outputType: "markdown", scope: "anchor", variables: [] },
      actions: { onGenerated: vi.fn() }
    });
    await runCommand("operation.run", ctx);
    expect(ctx.client.notes).not.toHaveBeenCalled();
  });

  it("falls back to auto-save when no preview host is wired", async () => {
    const onNoteCreated = vi.fn();
    const ctx = baseCtx({
      payload: { operationId: "op_4", outputType: "markdown", scope: "anchor", variables: [] },
      actions: { onNoteCreated }
    });
    await runCommand("operation.run", ctx);
    expect(ctx.client.createNote).toHaveBeenCalledWith(
      expect.objectContaining({ anchorIds: ["anchor_1"], contentType: "markdown" })
    );
    expect(onNoteCreated).toHaveBeenCalledOnce();
  });

  it("is unavailable without an operationId (outputType is optional since ACTION-2a), and gates scope on source vs passage", () => {
    expect(getCommand("operation.run")!.isAvailable(baseCtx({ payload: { outputType: "markdown" } }))).toBe(false);
    // No outputType is fine now (auto-output simple action) — a passage in focus suffices.
    expect(getCommand("operation.run")!.isAvailable(baseCtx({ payload: { operationId: "op_1" } }))).toBe(true);
    // Source-scope without a source is unavailable.
    expect(
      getCommand("operation.run")!.isAvailable(
        baseCtx({ payload: { operationId: "op_1", outputType: "markdown", scope: "source" }, sourceId: undefined })
      )
    ).toBe(false);
    // Anchor-scope with a draft in focus is available.
    expect(
      getCommand("operation.run")!.isAvailable(
        baseCtx({ payload: { operationId: "op_1", outputType: "markdown", scope: "anchor" } })
      )
    ).toBe(true);
  });
});

describe("command: note.delete", () => {
  it("confirms, deletes the note, and fires onNoteDeleted", async () => {
    const onNoteDeleted = vi.fn();
    const confirm = vi.fn(() => true);
    const ctx = baseCtx({ payload: { noteId: "note_1" }, actions: { onNoteDeleted, confirm } });

    const ran = await runCommand("note.delete", ctx);

    expect(ran).toBe(true);
    expect(confirm).toHaveBeenCalledOnce();
    expect(ctx.client.deleteNote).toHaveBeenCalledWith("note_1");
    expect(onNoteDeleted).toHaveBeenCalledWith("note_1");
  });

  it("does NOT delete when confirm is declined", async () => {
    const onNoteDeleted = vi.fn();
    const confirm = vi.fn(() => false);
    const ctx = baseCtx({ payload: { noteId: "note_1" }, actions: { onNoteDeleted, confirm } });

    await runCommand("note.delete", ctx);

    expect(ctx.client.deleteNote).not.toHaveBeenCalled();
    expect(onNoteDeleted).not.toHaveBeenCalled();
  });

  it("proceeds (no confirm wired) and is unavailable without a noteId", async () => {
    const ctx = baseCtx({ payload: { noteId: "note_1" } });
    await runCommand("note.delete", ctx);
    expect(ctx.client.deleteNote).toHaveBeenCalledWith("note_1");

    expect(getCommand("note.delete")!.isAvailable(baseCtx({ payload: {} }))).toBe(false);
  });

  it("skips the confirm gate for the D6 undo (skipConfirm) yet still deletes", async () => {
    const onNoteDeleted = vi.fn();
    // A confirm IS wired, but skipConfirm must bypass it — the undo toast is the safety net.
    const confirm = vi.fn(() => false);
    const ctx = baseCtx({
      payload: { noteId: "draft_note_1", skipConfirm: true },
      actions: { onNoteDeleted, confirm }
    });

    await runCommand("note.delete", ctx);

    expect(confirm).not.toHaveBeenCalled();
    expect(ctx.client.deleteNote).toHaveBeenCalledWith("draft_note_1");
    expect(onNoteDeleted).toHaveBeenCalledWith("draft_note_1");
  });
});

describe("command: note.edit", () => {
  it("patches the note's content and refreshes via onNoteCreated", async () => {
    const onNoteCreated = vi.fn();
    const updateNote = vi.fn(async () => ({ note: { id: "note_1" } as never }));
    const ctx = baseCtx({
      payload: { noteId: "note_1", content: "edited body" },
      actions: { onNoteCreated },
      client: { ...baseCtx().client, updateNote }
    });

    const ran = await runCommand("note.edit", ctx);

    expect(ran).toBe(true);
    expect(updateNote).toHaveBeenCalledWith("note_1", { content: "edited body" });
    expect(onNoteCreated).toHaveBeenCalledOnce();
  });

  it("is unavailable without a noteId or without content", () => {
    expect(getCommand("note.edit")!.isAvailable(baseCtx({ payload: { content: "x" } }))).toBe(false);
    expect(getCommand("note.edit")!.isAvailable(baseCtx({ payload: { noteId: "note_1" } }))).toBe(false);
    expect(
      getCommand("note.edit")!.isAvailable(baseCtx({ payload: { noteId: "note_1", content: "x" } }))
    ).toBe(true);
  });
});

describe("command: note.generate-block (form router)", () => {
  it("materializes the passage, runs the form router, and emits the chosen form as a draft", async () => {
    const onGenerated = vi.fn();
    const generateBlock = vi.fn(async () => ({
      contentType: "markmap",
      content: "# Root\n## A",
      provider: "mock"
    }));
    const ctx = baseCtx({
      payload: { text: "make a mind map of photosynthesis" },
      chatContext: { quote: "passage", sourceTitle: "Bio" },
      client: { ...baseCtx().client, generateBlock },
      actions: { onGenerated }
    });

    const ran = await runCommand("note.generate-block", ctx);

    expect(ran).toBe(true);
    expect(ctx.focus.materializeAnchor).toHaveBeenCalledOnce();
    // The MODEL picks the form — the command passes the text + chat context (and any
    // explicit deterministic sample from the payload).
    expect(generateBlock).toHaveBeenCalledWith({
      text: "make a mind map of photosynthesis",
      context: { quote: "passage", sourceTitle: "Bio" },
      sample: undefined
    });
    // The detected form lands in the EXISTING preview loop, anchored, marked classified.
    expect(onGenerated).toHaveBeenCalledWith(
      expect.objectContaining({
        promptId: "note.generate-block",
        contentType: "markmap",
        content: "# Root\n## A",
        anchorId: "anchor_1",
        sourceId: "src_1",
        classified: true
      })
    );
    expect(ctx.client.createNote).not.toHaveBeenCalled();
  });

  it("falls back to auto-save when no preview host is wired", async () => {
    const onNoteCreated = vi.fn();
    const generateBlock = vi.fn(async () => ({ contentType: "mermaid", content: "graph TD; A-->B", provider: "mock" }));
    const ctx = baseCtx({
      payload: { text: "draw a flowchart" },
      client: { ...baseCtx().client, generateBlock },
      actions: { onNoteCreated }
    });
    await runCommand("note.generate-block", ctx);
    expect(ctx.client.createNote).toHaveBeenCalledWith(
      expect.objectContaining({ anchorIds: ["anchor_1"], contentType: "mermaid", content: "graph TD; A-->B" })
    );
    expect(onNoteCreated).toHaveBeenCalledOnce();
  });

  it("is unavailable with empty text", () => {
    expect(getCommand("note.generate-block")!.isAvailable(baseCtx({ payload: { text: "  " } }))).toBe(false);
    expect(getCommand("note.generate-block")!.isAvailable(baseCtx({ payload: { text: "go" } }))).toBe(true);
  });
});

// W3 (ai-workspace §W3): "生成文档" turns the conversation (+ W2 attachments) into a NEW
// markdown source. It forwards the transcript + the resolved widened context to
// ctx.client.synthesize and fires onSourceSynthesized with the created source. Availability
// tracks a non-empty transcript.
describe("command: chat.synthesize", () => {
  const transcript: ChatMessage[] = [
    { role: "user", content: "Explain X." },
    { role: "assistant", content: "X is Y." },
    { role: "user", content: "Make it a doc." }
  ];

  it("forwards the transcript + resolved context and fires onSourceSynthesized", async () => {
    const onSourceSynthesized = vi.fn();
    const resolveAttachmentBundles = vi.fn(async () => [
      { title: "Attached Doc", type: "html", excerpt: "body" }
    ]);
    const ctx = baseCtx({
      chatMessages: transcript,
      chatContext: { sourceTitle: "Focused" },
      resolveAttachmentBundles,
      payload: { content: { title: "Doc", markdown: "# H" } },
      actions: { onSourceSynthesized }
    });

    const ran = await runCommand("chat.synthesize", ctx);

    expect(ran).toBe(true);
    expect(resolveAttachmentBundles).toHaveBeenCalledOnce();
    expect(ctx.client.synthesize).toHaveBeenCalledWith({
      messages: transcript,
      context: { sourceTitle: "Focused", sources: [{ title: "Attached Doc", type: "html", excerpt: "body" }] },
      sample: { title: "Doc", markdown: "# H" }
    });
    expect(onSourceSynthesized).toHaveBeenCalledWith({ id: "src_new" });
  });

  it("with no attachments sends the flat context unchanged (no sources key)", async () => {
    const ctx = baseCtx({
      chatMessages: transcript,
      chatContext: { sourceTitle: "Focused" },
      resolveAttachmentBundles: vi.fn(async () => []),
      actions: { onSourceSynthesized: vi.fn() }
    });
    await runCommand("chat.synthesize", ctx);
    const sent = (ctx.client.synthesize as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sent.context).toEqual({ sourceTitle: "Focused" });
    expect("sources" in sent.context).toBe(false);
  });

  it("is unavailable with an empty transcript, available with one turn", () => {
    expect(getCommand("chat.synthesize")!.isAvailable(baseCtx({ chatMessages: [] }))).toBe(false);
    expect(getCommand("chat.synthesize")!.isAvailable(baseCtx({ chatMessages: undefined }))).toBe(false);
    expect(getCommand("chat.synthesize")!.isAvailable(baseCtx({ chatMessages: transcript }))).toBe(true);
  });
});
