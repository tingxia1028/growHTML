// Learner-memory capture queue (MEM-1 — docs/design/learner-memory.md §4). A tiny
// client-side buffer: `recordMemoryEvent` pushes, a trailing ~2s timer batches ONE
// POST through entityClient.postMemoryEvents. This is TELEMETRY, NOT A LEDGER — sends
// are fire-and-forget, failures drop silently, and nothing here ever throws into (or
// blocks) a UX code path. The local `enabled` gate mirrors the vault-level capture
// switch; the server enforces that switch regardless (capture-off POSTs → 204 + drop),
// so a host that never mirrors it still cannot leak capture.

import { entityClient, type MemoryEventInput, type MemorySubject, type MemoryVerb } from "../data/entityClient";

const FLUSH_DELAY_MS = 2000;
/** The server refuses batches over 100 (MEMORY_EVENTS_BATCH_LIMIT) — flush in slices. */
const MAX_BATCH = 100;
/** Safety valve: an unreachable server must not grow the queue unbounded. */
const MAX_QUEUE = 1000;

type MemoryTransport = (events: MemoryEventInput[]) => Promise<unknown>;
const defaultTransport: MemoryTransport = (events) => entityClient.postMemoryEvents(events);

// One id per page load groups a sitting's events (the schema's `sessionId`).
const sessionId = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

let queue: MemoryEventInput[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let enabled = true;
let transport = defaultTransport;

function clearTimer(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

/**
 * Local mirror of the vault capture switch (GET /api/memory/settings). Turning it
 * off ALSO drops anything still queued — once the user says stop, nothing pending
 * leaves the page either.
 */
export function setMemoryCaptureEnabled(value: boolean): void {
  enabled = value;
  if (!value) {
    queue = [];
    clearTimer();
  }
}

/** Queue one behavior event (verb + what it touched). Never throws, never blocks. */
export function recordMemoryEvent(
  verb: MemoryVerb,
  subject?: MemorySubject,
  payload?: Record<string, unknown>
): void {
  if (!enabled) return;
  if (queue.length >= MAX_QUEUE) queue.shift(); // oldest telemetry is the most expendable
  queue.push({ verb, subject, payload, sessionId, ts: new Date().toISOString() });
  // Trailing coalesce: the FIRST event arms the timer; followers just join the batch
  // (no per-event reset, so a busy session still flushes about every 2s).
  if (timer === null) {
    timer = setTimeout(() => {
      timer = null;
      void flushNow();
    }, FLUSH_DELAY_MS);
  }
}

/** Drain the queue now (the timer's target; exported for tests + host teardown). */
export async function flushNow(): Promise<void> {
  clearTimer();
  while (queue.length > 0) {
    const batch = queue.splice(0, MAX_BATCH);
    try {
      await transport(batch);
    } catch {
      // Fire-and-forget: the failed batch is DROPPED (telemetry, not ledger). Any
      // remaining slices stay queued for a later flush rather than hammering a
      // server that just failed.
      return;
    }
  }
}

/** Test seam: swap the POST transport (null restores the real entityClient). */
export function setMemoryTransportForTests(next: MemoryTransport | null): void {
  transport = next ?? defaultTransport;
}

/** Test seam: back to a pristine module (enabled, empty queue, no timer). */
export function resetMemoryCaptureForTests(): void {
  queue = [];
  clearTimer();
  enabled = true;
}
