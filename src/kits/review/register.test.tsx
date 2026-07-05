// @vitest-environment jsdom
// review kit registration: importing the ReviewPanel drill VIEW self-registerViews kind
// "review.panel" into the shared global registry (the register-only relocation gate). The
// SRS ENGINE + the review SUPPORT modules STAY CORE (src/core/review/* + src/client/review/
// queue/scope/io/push) — so the queue still assembles from the core assembler, the
// review-push trigger still deep-links "review.panel" (kind-keyed nav survives the move),
// and the mistake-book 复习错题 launch (reviewScope) is untouched. Mirrors the mistake-photo /
// bookmarks register pins.
import { describe, expect, it } from "vitest";

// Stub DiagramNote so the built-in registrations don't pull mermaid/markmap into jsdom
// (the ReviewPanel.test precedent — importing the panel pulls the note-type registrations).
import { vi } from "vitest";
vi.mock("../../client/DiagramNote", () => ({ DiagramNote: () => null }));

// The CORE note types register via this side-effect (the review.grade type + mistake are
// core built-ins). Then the review.panel drill lens self-registerViews (shell-imported at
// runtime; here we pin that moving the file into the kit dir changed nothing about it).
import "../../client/notes/builtinNoteTypes";
import "./ReviewPanel";

import { getView } from "../../client/workspace/viewRegistry";
// The queue assembler STAYS core — the kit only relocated the VIEW that composes it.
import { buildReviewQueue } from "../../client/review/queue";
// The PRO-1 review-push trigger STAYS core — its nav target is the kind-keyed "review.panel".
import { reviewPushTrigger } from "../../client/triggers/reviewPush";

describe("review kit registration", () => {
  it("the review.panel drill lens self-registers into the shared registry (kind unchanged)", () => {
    expect(getView("review.panel")).toBeTruthy();
  });

  it("the core queue assembler still queues a fresh mistake as due (engine stays core)", () => {
    // A saved mistake with no schedule row is due immediately (queue rule 1 — mistake-new).
    const queue = buildReviewQueue({
      notes: [{ id: "m1", contentType: "mistake", content: { question: "Q", mastery: "weak" } }],
      reviewEvents: []
    });
    expect(queue.length).toBe(1);
    expect(queue[0].note.id).toBe("m1");
    expect(queue[0].reason).toBe("mistake-new");
  });

  it("the review-push trigger still deep-links review.panel (kind-keyed nav survives the move)", () => {
    expect(reviewPushTrigger.actionRef).toEqual({ kind: "navigate", target: "review.panel" });
  });
});
