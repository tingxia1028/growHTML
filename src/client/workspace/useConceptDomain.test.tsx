// @vitest-environment jsdom
// PLAT-LAYER Part-2 Slice 3 — the CONCEPT domain hook's one BACK-EDGE, pinned.
//
// `undoConceptMark` is the single place the concept domain reaches back into the pipeline:
// it deletes the marker note (entityClient.deleteNote — the anchor↔concept link, and its
// derived paint) and then REPAINTS by awaiting the injected `refreshAnnotations`. Before
// this slice that undo→delete→repaint chain had NO direct test (flagged weak coverage in
// the split plan). This file is that pin: it drives the real hook with `deleteNote` mocked
// and a SPY for the injected `refreshAnnotations`, then asserts BOTH halves of the edge —
// the delete targets the marked note, and the repaint fires AFTER the delete resolves.
//
// It also exercises the coordinator seam this slice introduced: `notifyConceptMarked`
// arms the toast payload (stamping the monotonic seq inside the hook) — that's how the
// still-in-provider onConceptMarked handler will drive concept state — so the undo has a
// mark to undo without threading the whole concept.mark-selection command through here.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// Mock the entity client to just the one method the hook calls (deleteNote); it resolves
// ok so the undo reaches its refreshAnnotations repaint.
vi.mock("../data/entityClient", () => ({
  entityClient: {
    deleteNote: vi.fn(() => Promise.resolve({ ok: true }))
  }
}));

import { entityClient } from "../data/entityClient";
import { useConceptDomain, type ConceptDomain } from "./useConceptDomain";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let surface: ConceptDomain;

// The injected back-edge + error sink, re-created per test so call-order/spy state is clean.
let refreshAnnotations: ReturnType<typeof vi.fn<(sourceId?: string) => Promise<void>>>;
let onError: ReturnType<typeof vi.fn<(message: string) => void>>;

// A probe that runs the hook and publishes its live surface, so a test can call the
// surface actions (notifyConceptMarked / undoConceptMark) through act().
function Probe() {
  surface = useConceptDomain({ refreshAnnotations, onError });
  return null;
}

async function mount() {
  await act(async () => {
    root.render(<Probe />);
  });
}

beforeEach(() => {
  refreshAnnotations = vi.fn<(sourceId?: string) => Promise<void>>(() => Promise.resolve());
  onError = vi.fn<(message: string) => void>();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe("useConceptDomain — undo back-edge (delete → repaint)", () => {
  it("undoConceptMark deletes the marked note THEN repaints via the injected refreshAnnotations", async () => {
    await mount();

    // Arm the toast through the coordinator seam (the seq is stamped inside the hook).
    await act(async () => {
      surface.notifyConceptMarked({
        conceptId: "concept_1",
        conceptName: "Osmosis",
        noteId: "marker_note_1",
        linkedExisting: false
      });
    });
    expect(surface.conceptMark).toEqual(
      expect.objectContaining({ conceptId: "concept_1", noteId: "marker_note_1", seq: 1 })
    );

    await act(async () => {
      await surface.undoConceptMark();
    });

    // (a) the marker note is deleted (removing the link + its derived paint).
    expect(entityClient.deleteNote).toHaveBeenCalledWith("marker_note_1");
    // (b) the repaint back-edge fired — AFTER the delete resolved (order pins the edge).
    expect(refreshAnnotations).toHaveBeenCalledTimes(1);
    const deleteOrder = (entityClient.deleteNote as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const repaintOrder = refreshAnnotations.mock.invocationCallOrder[0];
    expect(repaintOrder).toBeGreaterThan(deleteOrder);
    // The toast cleared (optimistic clear on undo) and no error was surfaced.
    expect(surface.conceptMark).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it("undoConceptMark with no armed mark is a no-op (no delete, no repaint)", async () => {
    await mount();
    expect(surface.conceptMark).toBeNull();

    await act(async () => {
      await surface.undoConceptMark();
    });

    expect(entityClient.deleteNote).not.toHaveBeenCalled();
    expect(refreshAnnotations).not.toHaveBeenCalled();
  });

  it("a delete failure surfaces through onError and does NOT repaint", async () => {
    (entityClient.deleteNote as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom"));
    await mount();

    await act(async () => {
      surface.notifyConceptMarked({
        conceptId: "concept_2",
        conceptName: "Diffusion",
        noteId: "marker_note_2",
        linkedExisting: true
      });
    });
    await act(async () => {
      await surface.undoConceptMark();
    });

    expect(entityClient.deleteNote).toHaveBeenCalledWith("marker_note_2");
    // The repaint is AFTER deleteNote in the try — a delete throw skips it.
    expect(refreshAnnotations).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("boom");
  });
});
