// @vitest-environment jsdom
// D6 (note-presentation-unified.md §6) — anchor-context AI answer → auto-materialized
// DRAFT note + undo. Three things proven here:
//   1. `shouldAutoMaterialize` (pure) routes only DIRECT anchor-context drafts to
//      auto-save; classified / manual / anchor-less drafts stay in the preview loop.
//   2. `materializeAnchor` creates a note via createNote with status:"draft" (NOT the
//      float-and-edit parkDraft path) and parks the undo feedback.
//   3. `undoDraftNote` dispatches note.delete (removing the materialized note) and the
//      non-anchor generation path is UNCHANGED (note.generate-block still parks a draft
//      in the FloatingNoteEditor — pendingDraft — and never auto-creates a draft note).
// We render the real WorkspaceProvider with the entityClient mocked and capture the live
// context via a tiny consumer (same harness as generatingState.test.tsx).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("../PdfReader", () => ({ PdfReader: () => null }));
vi.mock("../ImageReader", () => ({ ImageReader: () => null }));
vi.mock("../WebviewReader", () => ({ WebviewReader: () => null }));
vi.mock("../LocalHtmlReader", () => ({ LocalHtmlReader: () => null }));

vi.mock("../data/entityClient", () => ({
  entityClient: {
    sources: vi.fn(() => Promise.resolve({ sources: [] })),
    operations: vi.fn(() => Promise.resolve({ operations: [] })),
    operationPrefs: vi.fn(() => Promise.resolve({ prefs: { order: [], disabled: [], params: {} } })),
    // createNote echoes back the status it was sent so the toast/feedback can read it.
    createNote: vi.fn((input: { contentType: string; status?: "draft" }) =>
      Promise.resolve({ note: { id: "draft_note_1", contentType: input.contentType, status: input.status, anchorIds: [] } })
    ),
    deleteNote: vi.fn(() => Promise.resolve({ ok: true })),
    generateBlock: vi.fn(() => Promise.resolve({ contentType: "markdown", content: "routed", provider: "mock" }))
  }
}));

import { entityClient } from "../data/entityClient";
import { FocusProvider, useFocus, type FocusContextValue } from "../focus/FocusContext";
import {
  WorkspaceProvider,
  useWorkspace,
  shouldAutoMaterialize,
  type WorkspaceContextValue
} from "./WorkspaceContext";
import type { GeneratedDraft } from "../commands/registry";
import type { AnyAnchor } from "../data/entityClient";

let container: HTMLDivElement;
let root: Root;
let ctx: WorkspaceContextValue;
let focusCtx: FocusContextValue;

function Capture() {
  ctx = useWorkspace();
  focusCtx = useFocus();
  return null;
}

const FIXTURE_ANCHOR: AnyAnchor = {
  id: "anchor_ctx_1",
  sourceId: "src_1",
  anchorKind: "html_selection",
  studyId: "p1",
  selector: '[data-study-id="p1"]',
  quote: "a focused passage"
};

async function mount() {
  await act(async () => {
    root.render(
      <FocusProvider>
        <WorkspaceProvider>
          <Capture />
        </WorkspaceProvider>
      </FocusProvider>
    );
  });
}

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1400 });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.localStorage.clear();
  vi.clearAllMocks();
});

// A draft that OPTED IN to auto-materialize (an anchor-context direct flow).
const draft = (over: Partial<GeneratedDraft> = {}): GeneratedDraft => ({
  promptId: "textbook.explain-concept",
  contentType: "markdown",
  input: {},
  content: "explanation",
  anchorId: "anchor_1",
  sourceId: "src_1",
  autoMaterialize: true,
  ...over
});

describe("shouldAutoMaterialize (D6 routing predicate)", () => {
  it("auto-materializes an OPTED-IN anchor-context draft", () => {
    expect(shouldAutoMaterialize(draft())).toBe(true);
  });

  it("keeps the preview loop unless the draft opted in (试一下 / operation.run / kit buttons unchanged)", () => {
    // The existing generate flows never set autoMaterialize ⇒ they stay in the preview loop.
    expect(shouldAutoMaterialize(draft({ autoMaterialize: false }))).toBe(false);
    expect(shouldAutoMaterialize({ ...draft(), autoMaterialize: undefined })).toBe(false);
  });

  it("keeps the preview loop for the classify / manual / anchor-less flows even when opted in", () => {
    // note.generate-block / classify-reply mark drafts `classified`.
    expect(shouldAutoMaterialize(draft({ classified: true }))).toBe(false);
    // the D5 floating-editor manual seed.
    expect(shouldAutoMaterialize(draft({ manual: true }))).toBe(false);
    // no focused anchor at generation time ⇒ chat-only / preview.
    expect(shouldAutoMaterialize(draft({ anchorId: undefined }))).toBe(false);
  });
});

describe("materializeAnchor + undo (WorkspaceContext)", () => {
  it("creates a status:draft note via createNote and parks the undo feedback (not the float path)", async () => {
    await mount();
    expect(ctx.draftNote).toBeNull();
    expect(ctx.pendingDraft).toBeNull();

    await act(async () => {
      await ctx.materializeAnchor("anchor_1", "markdown", "auto answer");
    });

    // Created through the normal createNote seam WITH the draft flag — NOT parkDraft.
    expect(entityClient.createNote).toHaveBeenCalledWith(
      expect.objectContaining({ anchorIds: ["anchor_1"], contentType: "markdown", content: "auto answer", status: "draft" })
    );
    // The undo toast is armed; the preview editor is NOT engaged (no float-and-edit).
    expect(ctx.draftNote).toEqual(expect.objectContaining({ noteId: "draft_note_1", contentType: "markdown" }));
    expect(ctx.pendingDraft).toBeNull();
  });

  it("undo dispatches note.delete on the materialized note and clears the feedback", async () => {
    await mount();
    await act(async () => {
      await ctx.materializeAnchor("anchor_1", "markdown", "auto answer");
    });
    expect(ctx.draftNote?.noteId).toBe("draft_note_1");

    await act(async () => {
      await ctx.undoDraftNote();
    });

    // Removal goes through the SAME command as any delete (deleteNote), and the toast clears.
    expect(entityClient.deleteNote).toHaveBeenCalledWith("draft_note_1");
    expect(ctx.draftNote).toBeNull();
  });
});

describe("non-anchor generation path is UNCHANGED (preview loop preserved)", () => {
  it("note.generate-block still parks a draft in the floating editor — no auto-created draft note", async () => {
    await mount();

    await act(async () => {
      await ctx.dispatch("note.generate-block", { text: "make me a note" });
    });

    // The classified draft parks in the D5 floating editor (pendingDraft), the preview loop.
    expect(ctx.pendingDraft).not.toBeNull();
    expect(ctx.pendingDraft?.classified).toBe(true);
    // It did NOT auto-materialize — no draft note was created, no undo toast armed.
    expect(entityClient.createNote).not.toHaveBeenCalled();
    expect(ctx.draftNote).toBeNull();
  });
});

describe("addReplyAsNote — D6 anchor-context vs free-chat", () => {
  it("WITH a focused anchor: auto-materializes a status:draft note + undo toast (no Save click)", async () => {
    await mount();
    // Focus an anchor so the reply has passage context.
    await act(async () => {
      focusCtx.setAnchor(FIXTURE_ANCHOR);
    });

    await act(async () => {
      await ctx.addReplyAsNote("A helpful explanation of osmosis.");
    });

    // Created as a DRAFT on the focused anchor (the materializeAnchor path) — not the
    // one-step anchor.add-note, and definitely not a preview.
    expect(entityClient.createNote).toHaveBeenCalledWith(
      expect.objectContaining({ anchorIds: ["anchor_ctx_1"], status: "draft" })
    );
    expect(ctx.draftNote?.noteId).toBe("draft_note_1");
    expect(ctx.pendingDraft).toBeNull();
  });

  it("WITHOUT anchor context (free chat): stays the one-step add — no draft note, no undo toast", async () => {
    await mount();
    // No focus set → free chat.

    await act(async () => {
      await ctx.addReplyAsNote("A standalone answer.");
    });

    // Chat-only path unchanged: it did NOT auto-materialize a draft (no status:draft create,
    // no undo toast). The one-step anchor.add-note handles the unanchored save.
    expect(entityClient.createNote).not.toHaveBeenCalledWith(expect.objectContaining({ status: "draft" }));
    expect(ctx.draftNote).toBeNull();
  });
});
