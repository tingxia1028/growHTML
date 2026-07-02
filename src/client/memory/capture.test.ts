// @vitest-environment jsdom
// The MEM-1 capture queue: debounced batching, flushNow, the local capture gate, and
// the fire-and-forget failure contract (drops are silent — telemetry, not ledger).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryEventInput } from "../data/entityClient";
import {
  flushNow,
  recordMemoryEvent,
  resetMemoryCaptureForTests,
  setMemoryCaptureEnabled,
  setMemoryTransportForTests
} from "./capture";

let posted: MemoryEventInput[][];

beforeEach(() => {
  vi.useFakeTimers();
  resetMemoryCaptureForTests();
  posted = [];
  setMemoryTransportForTests(async (events) => {
    posted.push(events);
  });
});

afterEach(() => {
  setMemoryTransportForTests(null);
  resetMemoryCaptureForTests();
  vi.useRealTimers();
});

describe("memory capture queue", () => {
  it("coalesces rapid events into ONE debounced batch (~2s), stamped with ts + sessionId", async () => {
    recordMemoryEvent("note.create", { sourceId: "src_1" });
    recordMemoryEvent("ai.ask");
    recordMemoryEvent("note.edit", undefined, { action: "delete" });
    expect(posted).toEqual([]); // nothing leaves synchronously

    await vi.advanceTimersByTimeAsync(1999);
    expect(posted).toEqual([]); // still coalescing

    await vi.advanceTimersByTimeAsync(1);
    expect(posted).toHaveLength(1);
    const batch = posted[0];
    expect(batch.map((e) => e.verb)).toEqual(["note.create", "ai.ask", "note.edit"]);
    expect(batch[0].subject).toEqual({ sourceId: "src_1" });
    expect(batch[2].payload).toEqual({ action: "delete" });
    for (const event of batch) {
      expect(typeof event.ts).toBe("string");
      expect(event.sessionId).toBe(batch[0].sessionId); // one sitting, one session id
    }
  });

  it("flushNow drains immediately, empties the queue, and disarms the pending timer", async () => {
    recordMemoryEvent("search");
    await flushNow();
    expect(posted).toHaveLength(1);

    await flushNow(); // nothing left → no extra POST
    await vi.advanceTimersByTimeAsync(5000); // the armed timer was cancelled
    expect(posted).toHaveLength(1);
  });

  it("slices a large flush at the server's 100-event batch cap", async () => {
    for (let i = 0; i < 150; i += 1) recordMemoryEvent("read");
    await flushNow();
    expect(posted.map((batch) => batch.length)).toEqual([100, 50]);
  });

  it("the disabled gate records nothing and DROPS anything still pending", async () => {
    recordMemoryEvent("note.create"); // queued, timer armed
    setMemoryCaptureEnabled(false); // user said stop → pending events drop too
    recordMemoryEvent("ai.ask"); // gate closed → no-op

    await vi.advanceTimersByTimeAsync(5000);
    await flushNow();
    expect(posted).toEqual([]);

    setMemoryCaptureEnabled(true);
    recordMemoryEvent("navigate");
    await flushNow();
    expect(posted).toHaveLength(1);
    expect(posted[0].map((e) => e.verb)).toEqual(["navigate"]);
  });

  it("swallows transport failures (fire-and-forget) and drops the failed batch", async () => {
    setMemoryTransportForTests(async () => {
      throw new Error("server down");
    });
    recordMemoryEvent("note.create");
    await expect(flushNow()).resolves.toBeUndefined(); // never throws into UX code

    // The failed batch is gone for good; a later flush sends only NEW events.
    setMemoryTransportForTests(async (events) => {
      posted.push(events);
    });
    recordMemoryEvent("ai.generate");
    await flushNow();
    expect(posted).toHaveLength(1);
    expect(posted[0].map((e) => e.verb)).toEqual(["ai.generate"]);
  });
});
