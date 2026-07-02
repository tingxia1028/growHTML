// MEM-2 digest engine — the deterministic events→digests fold, the consolidation
// pass with retention regions (frozen / freezing / fresh), and the read-side
// summaries REV-2 + the 画像页 consume. Everything here is pure: clocks are pinned
// numbers, determinism is asserted by byte-comparing shuffled-input outputs.

import { describe, expect, it } from "vitest";
import {
  consolidateMemoryEvents,
  digestMemoryEvents,
  emptyMemoryDigestState,
  MEMORY_DIGEST_RETENTION_DAYS,
  MEMORY_RAW_EVENT_RETENTION_DAYS,
  memoryDigestStateSchema,
  summarizeMemoryDigests,
  utcDayOf,
  utcDayStart,
  type MemoryDigestEventLike
} from "./digest";

const DAY_MS = 24 * 60 * 60 * 1000;
// Pinned "now": July 1 2026 12:00Z. The 14d raw boundary is then June 17 00:00Z.
const NOW = Date.UTC(2026, 6, 1, 12);
const BOUNDARY = "2026-06-17T00:00:00.000Z";

const ev = (
  verb: string,
  createdAt: string,
  extra: Partial<Pick<MemoryDigestEventLike, "subject" | "payload">> = {}
): MemoryDigestEventLike => ({ verb, createdAt, ...extra });

const review = (createdAt: string, result: string, subject?: MemoryDigestEventLike["subject"]) =>
  ev("note.review", createdAt, { subject, payload: { result } });

describe("digestMemoryEvents — the pure fold", () => {
  it("aggregates per (day × dimension × bucket): overall once, plus contentType/sourceId/subject cells", () => {
    const rows = digestMemoryEvents([
      ev("open", "2026-06-20T08:00:00.000Z", { subject: { sourceId: "src_a" } }),
      ev("note.create", "2026-06-20T09:00:00.000Z", { subject: { sourceId: "src_a", contentType: "quiz" } }),
      ev("note.create", "2026-06-20T10:00:00.000Z", {
        subject: { sourceId: "src_a", contentType: "quiz", kitId: "textbook" }
      }),
      // Payload 学科 bucket (the MEM-3 taxonomy slot) wins over kitId.
      ev("ai.ask", "2026-06-21T10:00:00.000Z", { subject: { kitId: "textbook" }, payload: { subject: "物理" } })
    ]);

    // Day 1: overall + contentType(quiz) + sourceId(src_a) + subject(textbook via kitId).
    const day1 = rows.filter((row) => row.date === "2026-06-20");
    expect(day1.map((row) => `${row.dimension}:${row.bucket}`)).toEqual([
      "overall:all",
      "subject:textbook",
      "contentType:quiz",
      "sourceId:src_a"
    ]);
    const overall1 = day1[0];
    expect(overall1.events).toBe(3);
    expect(overall1.counts).toEqual({ open: 1, "note.create": 2 });
    expect(overall1.firstAt).toBe("2026-06-20T08:00:00.000Z");
    expect(overall1.lastAt).toBe("2026-06-20T10:00:00.000Z");
    expect(day1.find((row) => row.dimension === "contentType")).toMatchObject({
      bucket: "quiz",
      events: 2,
      counts: { "note.create": 2 }
    });
    expect(day1.find((row) => row.dimension === "subject")).toMatchObject({ bucket: "textbook", events: 1 });

    // Day 2: payload.subject beats kitId for the 学科 bucket.
    const day2 = rows.filter((row) => row.date === "2026-06-21");
    expect(day2.map((row) => `${row.dimension}:${row.bucket}`)).toEqual(["overall:all", "subject:物理"]);
  });

  it("tallies note.review pass/fail/skip into review (and still counts the verb); unknown results are not tallied", () => {
    const subject = { contentType: "textbook.mistake" };
    const rows = digestMemoryEvents([
      review("2026-06-20T08:00:00.000Z", "pass", subject),
      review("2026-06-20T09:00:00.000Z", "fail", subject),
      review("2026-06-20T10:00:00.000Z", "fail", subject),
      review("2026-06-20T11:00:00.000Z", "skip", subject),
      review("2026-06-20T12:00:00.000Z", "not-a-result", subject),
      ev("note.review", "2026-06-20T13:00:00.000Z", { subject }) // no payload at all
    ]);
    const cell = rows.find((row) => row.dimension === "contentType" && row.bucket === "textbook.mistake");
    expect(cell?.review).toEqual({ pass: 1, fail: 2, skip: 1 });
    expect(cell?.counts["note.review"]).toBe(6);
    expect(rows.find((row) => row.dimension === "overall")?.review).toEqual({ pass: 1, fail: 2, skip: 1 });
  });

  it("normalizes offset timestamps to the UTC day", () => {
    // 23:30 at +02:00 = 21:30Z (same UTC day); 01:30 at +05:00 = 20:30Z the PREVIOUS day.
    const rows = digestMemoryEvents([
      ev("read", "2026-06-20T23:30:00.000+02:00"),
      ev("read", "2026-06-21T01:30:00.000+05:00")
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe("2026-06-20");
    expect(rows[0].events).toBe(2);
  });

  it("is deterministic: shuffled input produces byte-identical output (stable rows AND count keys)", () => {
    const events = [
      ev("search", "2026-06-20T08:00:00.000Z", { subject: { sourceId: "src_b" } }),
      review("2026-06-20T09:00:00.000Z", "fail", { sourceId: "src_a", contentType: "quiz" }),
      ev("open", "2026-06-19T23:59:59.000Z", { subject: { sourceId: "src_a" } }),
      ev("ai.generate", "2026-06-20T09:30:00.000Z", { subject: { contentType: "flashcard" } }),
      ev("note.edit", "2026-06-21T01:00:00.000Z", { subject: { sourceId: "src_b", contentType: "quiz" } })
    ];
    const forward = digestMemoryEvents(events);
    const reversed = digestMemoryEvents([...events].reverse());
    const rotated = digestMemoryEvents([...events.slice(2), ...events.slice(0, 2)]);
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
    expect(JSON.stringify(rotated)).toBe(JSON.stringify(forward));
    // Count keys follow the closed verb-enum order, not insertion order.
    const overall = forward.find((row) => row.dimension === "overall" && row.date === "2026-06-20");
    expect(Object.keys(overall!.counts)).toEqual(["note.review", "ai.generate", "search"]);
  });

  it("returns [] for no events and validates against the row schema", () => {
    expect(digestMemoryEvents([])).toEqual([]);
    const rows = digestMemoryEvents([ev("open", "2026-06-20T08:00:00.000Z")]);
    expect(() => memoryDigestStateSchema.parse({ ...emptyMemoryDigestState, rows })).not.toThrow();
  });
});

describe("consolidateMemoryEvents — retention regions", () => {
  it("first pass: splits at day-start(now − 14d), digests everything once, prunes below the boundary", () => {
    const old = ev("open", "2026-06-10T08:00:00.000Z"); // < boundary → freezes
    const fresh = ev("read", "2026-06-30T08:00:00.000Z"); // ≥ boundary → fresh region
    const { state, pruneBefore } = consolidateMemoryEvents([old, fresh], { now: NOW });

    expect(pruneBefore).toBe(BOUNDARY);
    expect(state.frozenThrough).toBe(BOUNDARY);
    expect(state.consolidatedAt).toBe(new Date(NOW).toISOString());
    expect(state.rows.map((row) => `${row.date}:${row.dimension}`)).toEqual([
      "2026-06-10:overall",
      "2026-06-30:overall"
    ]);
    expect(MEMORY_RAW_EVENT_RETENTION_DAYS).toBe(14); // the doc's §7 default, pinned
    expect(utcDayStart(NOW - 14 * DAY_MS)).toBe(BOUNDARY);
  });

  it("keeps frozen rows verbatim after their raw events were pruned", () => {
    const first = consolidateMemoryEvents(
      [ev("open", "2026-06-10T08:00:00.000Z"), ev("read", "2026-06-30T08:00:00.000Z")],
      { now: NOW }
    );
    // The caller pruned events < pruneBefore; only the fresh event remains raw.
    const second = consolidateMemoryEvents([ev("read", "2026-06-30T08:00:00.000Z")], {
      previous: first.state,
      now: NOW
    });
    expect(JSON.stringify(second.state.rows)).toBe(JSON.stringify(first.state.rows));
  });

  it("is idempotent: a duplicate pass over the SAME raw store never double-counts", () => {
    const events = [ev("open", "2026-06-10T08:00:00.000Z"), ev("read", "2026-06-30T08:00:00.000Z")];
    const first = consolidateMemoryEvents(events, { now: NOW });
    // Prune CRASHED: the old event is still raw on the next pass — but it is below
    // frozenThrough now, so it is ignored instead of digested twice.
    const second = consolidateMemoryEvents(events, { previous: first.state, now: NOW });
    expect(JSON.stringify(second.state)).toBe(JSON.stringify(first.state));
    expect(second.pruneBefore).toBe(first.pruneBefore);
  });

  it("advances the boundary as the clock moves: yesterday's fresh events freeze exactly once", () => {
    const eventA = ev("open", "2026-06-20T08:00:00.000Z", { subject: { contentType: "quiz" } });
    const first = consolidateMemoryEvents([eventA], { now: NOW });
    expect(first.state.rows.find((row) => row.dimension === "contentType")?.events).toBe(1);

    // 10 days later the event crosses the boundary (June 27): it freezes this pass.
    const later = NOW + 10 * DAY_MS;
    const second = consolidateMemoryEvents([eventA], { previous: first.state, now: later });
    expect(second.pruneBefore).toBe("2026-06-27T00:00:00.000Z");
    expect(second.state.rows.find((row) => row.dimension === "contentType")?.events).toBe(1);

    // After the prune, a third pass sees no raw events — rows unchanged (frozen).
    const third = consolidateMemoryEvents([], { previous: second.state, now: later });
    expect(JSON.stringify(third.state.rows)).toBe(JSON.stringify(second.state.rows));
  });

  it("drops digest rows past the 12-month long tail (day-boundary inclusive/exclusive)", () => {
    expect(MEMORY_DIGEST_RETENTION_DAYS).toBe(365); // the doc's §7 "digests 12mo"
    const floorDay = utcDayOf(utcDayStart(NOW - 365 * DAY_MS)); // "2025-07-01"
    const keep = { ...frozenRow("2025-07-01"), date: floorDay };
    const drop = { ...frozenRow("2025-06-30") };
    const previous = {
      ...emptyMemoryDigestState,
      frozenThrough: BOUNDARY,
      rows: [drop, keep]
    };
    const { state } = consolidateMemoryEvents([], { previous, now: NOW });
    expect(state.rows.map((row) => row.date)).toEqual([floorDay]);
  });

  it("never moves the boundary backwards when the clock regresses", () => {
    const first = consolidateMemoryEvents([], { now: NOW });
    const { state, pruneBefore } = consolidateMemoryEvents([], {
      previous: first.state,
      now: NOW - 30 * DAY_MS
    });
    expect(pruneBefore).toBe(BOUNDARY);
    expect(state.frozenThrough).toBe(BOUNDARY);
  });

  it("honours custom retention windows", () => {
    const kept = consolidateMemoryEvents([ev("open", "2026-06-29T08:00:00.000Z")], {
      now: NOW,
      rawRetentionDays: 1,
      digestRetentionDays: 3 // floor day 2026-06-28 → the 06-29 row survives
    });
    expect(kept.pruneBefore).toBe("2026-06-30T00:00:00.000Z");
    expect(kept.state.rows.map((row) => row.date)).toEqual(["2026-06-29"]);

    const dropped = consolidateMemoryEvents([ev("open", "2026-06-29T08:00:00.000Z")], {
      now: NOW,
      rawRetentionDays: 1,
      digestRetentionDays: 1 // floor day 2026-06-30 → the just-frozen 06-29 row is past the tail
    });
    expect(dropped.state.rows).toEqual([]);
  });

  it("is deterministic across event order under the same pinned clock", () => {
    const events = [
      ev("open", "2026-06-10T08:00:00.000Z"),
      review("2026-06-20T09:00:00.000Z", "fail", { contentType: "quiz" }),
      ev("read", "2026-06-30T08:00:00.000Z", { subject: { sourceId: "src_a" } })
    ];
    const forward = consolidateMemoryEvents(events, { now: NOW });
    const backward = consolidateMemoryEvents([...events].reverse(), { now: NOW });
    expect(JSON.stringify(backward)).toBe(JSON.stringify(forward));
  });
});

function frozenRow(date: string) {
  return {
    period: "day" as const,
    date,
    dimension: "overall" as const,
    bucket: "all",
    events: 1,
    counts: { open: 1 },
    review: { pass: 0, fail: 0, skip: 0 },
    firstAt: `${date}T08:00:00.000Z`,
    lastAt: `${date}T08:00:00.000Z`
  };
}

describe("summarizeMemoryDigests — the REV-2 / 画像 read model", () => {
  const rows = digestMemoryEvents([
    review("2026-06-20T08:00:00.000Z", "fail", { contentType: "quiz", sourceId: "src_a" }),
    review("2026-06-20T09:00:00.000Z", "fail", { contentType: "quiz", sourceId: "src_a" }),
    review("2026-06-21T09:00:00.000Z", "pass", { contentType: "quiz", sourceId: "src_a" }),
    review("2026-06-21T10:00:00.000Z", "skip", { contentType: "quiz", sourceId: "src_a" }),
    ev("note.create", "2026-06-21T11:00:00.000Z", { subject: { contentType: "flashcard" } }),
    ev("open", "2026-06-24T08:00:00.000Z", { subject: { sourceId: "src_a" } }),
    ev("read", "2026-06-25T08:00:00.000Z", { subject: { sourceId: "src_a" } })
  ]);
  const summary = summarizeMemoryDigests(rows);

  it("derives per-bucket all-time tallies with attempts + failRatio (skips are not attempts)", () => {
    const quiz = summary.dimensions.find((cell) => cell.dimension === "contentType" && cell.bucket === "quiz");
    expect(quiz?.review).toEqual({ pass: 1, fail: 2, skip: 1, attempts: 3, failRatio: 2 / 3 });
    expect(quiz?.events).toBe(4);
    expect(quiz?.firstAt).toBe("2026-06-20T08:00:00.000Z");
    expect(quiz?.lastAt).toBe("2026-06-21T10:00:00.000Z");
    // Zero graded attempts → failRatio 0, not NaN.
    const flashcard = summary.dimensions.find((cell) => cell.bucket === "flashcard");
    expect(flashcard?.review.failRatio).toBe(0);
  });

  it("computes the overall activity rhythm: active days, first/last, streak ending at last-active", () => {
    expect(summary.overall.events).toBe(7);
    expect(summary.overall.activeDays).toEqual(["2026-06-20", "2026-06-21", "2026-06-24", "2026-06-25"]);
    expect(summary.overall.firstActiveAt).toBe("2026-06-20T08:00:00.000Z");
    expect(summary.overall.lastActiveAt).toBe("2026-06-25T08:00:00.000Z");
    // 24→25 is consecutive; the gap to 21 ends the run.
    expect(summary.overall.streakDays).toBe(2);
    expect(summary.overall.counts).toEqual({ open: 1, read: 1, "note.create": 1, "note.review": 4 });
  });

  it("handles empty digests", () => {
    const empty = summarizeMemoryDigests([]);
    expect(empty.overall.events).toBe(0);
    expect(empty.overall.streakDays).toBe(0);
    expect(empty.overall.lastActiveAt).toBeNull();
    expect(empty.dimensions).toEqual([]);
  });
});
