// @vitest-environment jsdom
// TeachbackPanel (PRO-2 教回 runner) — drives the full flow through the swappable
// teachbackIo seam with the STRUCTURED generate echoing each prompt's mockContent (the
// deterministic seam, exactly like the real mock provider): pick a topic → pose →
// explain → probe → explain → wrap up → save. Asserts the panel dispatches ONE
// anchor.add-note (contentType teachback.summary) + emits ONE note.review memory event
// with mode:"teach"; plus the delta-5 empty-topic state on a fresh vault.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

// Side effects: built-in note types + Product Kits (registers teachback.summary render)
// + the panel view.
import "../../client/notes/builtinNoteTypes";
import "../clientKits";
import "./TeachbackPanel";

import { getView, type WorkspaceContext } from "../../client/workspace/viewRegistry";
import { setLocale } from "../../client/i18n";
import type { MemoryEventInput } from "../../client/data/entityClient";
import { flushNow, resetMemoryCaptureForTests, setMemoryTransportForTests } from "../../client/memory/capture";
import { setTeachbackIoForTests, type TeachbackGenerateRequest } from "./teachbackIo";
import { posePrompt, probePrompt, wrapupPrompt } from "./prompts";
import type { MemoryDimensionSummary } from "../../core/memory/digest";

// A weak-bucket digest cell (the minimum weakReviewBuckets reads) → a topic candidate.
function weakCell(bucket: string, failRatio: number, attempts: number): MemoryDimensionSummary {
  return {
    dimension: "subject",
    bucket,
    events: attempts,
    counts: {},
    review: { attempts, pass: 0, fail: Math.round(attempts * failRatio), skip: 0, failRatio },
    firstAt: "2026-07-01T00:00:00.000Z",
    lastAt: "2026-07-05T00:00:00.000Z"
  } as unknown as MemoryDimensionSummary;
}

// The deterministic generate: echo each prompt's OWN mockContent (the real mock seam).
function generateStub() {
  return vi.fn(async (request: TeachbackGenerateRequest) => {
    const input = request.input ?? {};
    if (request.promptId === posePrompt.id) return { content: posePrompt.mockContent!(input) };
    if (request.promptId === probePrompt.id) return { content: probePrompt.mockContent!(input) };
    if (request.promptId === wrapupPrompt.id) return { content: wrapupPrompt.mockContent!(input) };
    throw new Error(`unexpected promptId ${request.promptId}`);
  });
}

let posted: MemoryEventInput[][];

beforeEach(() => {
  setLocale("zh");
  posted = [];
  resetMemoryCaptureForTests();
  setMemoryTransportForTests(async (events) => {
    posted.push(events);
  });
});

afterEach(() => {
  setTeachbackIoForTests(null);
  setMemoryTransportForTests(null);
  resetMemoryCaptureForTests();
  vi.restoreAllMocks();
});

async function postedEvents(): Promise<MemoryEventInput[]> {
  await flushNow();
  return posted.flat();
}

function ctxWith(over: Partial<Record<keyof WorkspaceContext, unknown>> = {}): WorkspaceContext {
  return {
    activeSourceId: "src_1",
    notes: [],
    dispatch: vi.fn(async () => {}),
    ...over
  } as unknown as WorkspaceContext;
}

async function renderPanel(ctx: WorkspaceContext) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      getView("teachback.panel")!.render({ id: "teachback", kind: "teachback.panel" } as never, ctx) as React.ReactElement
    );
  });
  const cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  const click = async (selector: string) => {
    const target = container.querySelector(selector) as HTMLElement | null;
    expect(target, `missing clickable ${selector}`).toBeTruthy();
    await act(async () => {
      target!.click();
    });
  };
  const typeInto = async (selector: string, value: string) => {
    const el = container.querySelector(selector) as HTMLTextAreaElement;
    expect(el, `missing textarea ${selector}`).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  return { container, cleanup, click, typeInto };
}

describe("TeachbackPanel — the drive flow (structured mock deterministic across turns)", () => {
  it("pick → pose → explain → probe → explain → wrap up → save (one add-note + one memory event)", async () => {
    setTeachbackIoForTests({
      fetchDigestSummaries: async () => [weakCell("浮力", 0.7, 10), weakCell("压强", 0.6, 8)],
      fetchProfileFacts: async () => [],
      generate: generateStub()
    });
    const ctx = ctxWith();
    const { container, cleanup, click, typeInto } = await renderPanel(ctx);

    // Topic pick offered from the weak buckets.
    const topicBtns = container.querySelectorAll(".teachback-topic-btn");
    expect(topicBtns.length).toBe(2);
    expect(topicBtns[0].textContent).toBe("浮力");

    // Pick 浮力 → the pose lands (deterministic mock names the topic).
    await click(".teachback-topic-btn");
    const turns1 = container.querySelectorAll(".teachback-turn");
    expect(turns1.length).toBe(1);
    expect(turns1[0].textContent).toContain("浮力");
    expect(container.querySelector(".teachback-explain-input")).toBeTruthy();

    // Explain round 1 → a probe follows (probe names the WEAKEST topic — 浮力).
    await typeInto(".teachback-explain-input", "浮力等于排开的水重");
    await click(".teachback-submit-btn");
    const turns2 = container.querySelectorAll(".teachback-turn");
    expect(turns2.length).toBe(3); // pose + student explain + AI probe
    expect(turns2[2].textContent).toContain("浮力");

    // Explain round 2 → another probe.
    await typeInto(".teachback-explain-input", "阿基米德原理");
    await click(".teachback-submit-btn");
    expect(container.querySelectorAll(".teachback-turn").length).toBe(5);

    // Explain round 3 → the cap hits → wrap up (no textarea; the summary shows).
    await typeInto(".teachback-explain-input", "压强差推导");
    await click(".teachback-submit-btn");
    expect(container.querySelector(".teachback-summary")).toBeTruthy();
    expect(container.querySelector(".teachback-explain-input")).toBeFalsy();
    // The summary renders through getNoteType("teachback.summary").render (adaptive-note).
    expect(container.querySelector(".tb2-summary")).toBeTruthy();

    // Save → ONE anchor.add-note with contentType teachback.summary.
    await click(".teachback-save-btn");
    const dispatch = ctx.dispatch as unknown as ReturnType<typeof vi.fn>;
    const addNoteCalls = dispatch.mock.calls.filter((c) => c[0] === "anchor.add-note");
    expect(addNoteCalls).toHaveLength(1);
    expect(addNoteCalls[0][1].contentType).toBe("teachback.summary");
    expect(addNoteCalls[0][1].content.topic).toBe("浮力");

    // ONE note.review memory event with mode:"teach".
    const events = await postedEvents();
    const reviewEvents = events.filter((e) => e.verb === "note.review");
    expect(reviewEvents).toHaveLength(1);
    expect(reviewEvents[0].payload?.mode).toBe("teach");
    expect(reviewEvents[0].subject?.contentType).toBe("teachback.summary");

    // Saving again is a no-op (fire-once).
    await click(".teachback-save-btn");
    expect(dispatch.mock.calls.filter((c) => c[0] === "anchor.add-note")).toHaveLength(1);
    cleanup();
  });

  it("delta 5: a fresh vault (no weak buckets) renders the empty state, not a broken runner", async () => {
    setTeachbackIoForTests({
      fetchDigestSummaries: async () => [],
      fetchProfileFacts: async () => [],
      generate: generateStub()
    });
    const { container, cleanup } = await renderPanel(ctxWith());
    expect(container.querySelector(".teachback-empty")).toBeTruthy();
    expect(container.querySelector(".teachback-topic-btn")).toBeFalsy();
    expect(container.textContent).toContain("还没有可教回的主题");
    cleanup();
  });

  it("end early wraps up from a mid-session state", async () => {
    setTeachbackIoForTests({
      fetchDigestSummaries: async () => [weakCell("浮力", 0.7, 10)],
      fetchProfileFacts: async () => [],
      generate: generateStub()
    });
    const { container, cleanup, click, typeInto } = await renderPanel(ctxWith());
    await click(".teachback-topic-btn");
    await typeInto(".teachback-explain-input", "浮力等于排开的水重");
    // End early instead of a full 3 rounds.
    await click(".teachback-end-btn");
    expect(container.querySelector(".teachback-summary")).toBeTruthy();
    cleanup();
  });
});
