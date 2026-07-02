// server-only — learner-memory MEM-1 (docs/design/learner-memory.md §2–§4, §6, §7):
// the capture endpoints + the vault-level capture switch. Events are TELEMETRY, not a
// ledger: the client fires-and-forgets batches at POST /api/memory/events; when the
// switch is off the server answers 204 and stores NOTHING, so a stale client can never
// force capture back on. Consolidation (digests/profile) is MEM-2; kit taxonomies are
// MEM-3 — this module only ingests, reads back (debug/manager), and prunes the 短期
// stream. Module pattern mirrors registerSvpackRoutes (the F2 extraction shape).
//
// X0b: the append/list/settings logic is extracted into transport-agnostic service
// functions (same (deps, input) → data shape as src/server/services/**) so the direct
// adapter (services/directTransport.ts) reuses the SAME zod schemas + behavior with
// no express. The routes below are thin wrappers over them.

import path from "node:path";
import type { Express } from "express";
import { z } from "zod";
import { createEntityId } from "../core/ids";
import {
  isoDateTimeSchema,
  memoryEventSchema,
  memorySubjectSchema,
  memoryVerbSchema,
  schemaVersion,
  type MemoryEventRecord
} from "../core/schema";
import type { StudyVault } from "../core/vault";

/** The capture switch file — same vault.storage JSON idiom as operation-prefs.json. */
export const MEMORY_SETTINGS_FILE_NAME = "memory-settings.json";
/** POST batch cap: the client queue flushes in ≤100-event slices to match. */
export const MEMORY_EVENTS_BATCH_LIMIT = 100;

// memory-settings.json — the "disable capture entirely" switch (§6.4). Absent file →
// capture ON (the doc's default; the switch exists so the user can turn it off).
export const memorySettingsSchema = z.object({
  captureEnabled: z.boolean().default(true)
});
export type MemorySettings = z.infer<typeof memorySettingsSchema>;
const defaultMemorySettings: MemorySettings = { captureEnabled: true };

// PUT body: an EXPLICIT boolean (no default) — `PUT {}` must not silently mean "on".
export const putMemorySettingsSchema = z.object({ captureEnabled: z.boolean() });

// Wire shape of ONE captured event: the client owns verb/subject/payload/sessionId
// plus its capture time `ts` (the queue batches, so arrival time lags capture time);
// the SERVER owns the envelope (id / type / schemaVersion / createdBy).
const memoryEventInputSchema = z.object({
  verb: memoryVerbSchema,
  subject: memorySubjectSchema.default({}),
  payload: z.record(z.string(), z.unknown()).optional(),
  sessionId: z.string().min(1).optional(),
  ts: isoDateTimeSchema.optional()
});

export const postMemoryEventsSchema = z.object({
  events: z.array(memoryEventInputSchema).min(1).max(MEMORY_EVENTS_BATCH_LIMIT)
});

export const listMemoryEventsQuerySchema = z.object({
  since: isoDateTimeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500)
});
export type ListMemoryEventsQuery = z.infer<typeof listMemoryEventsQuerySchema>;

const pruneEventsQuerySchema = z.object({ before: isoDateTimeSchema });

export type MemoryDeps = {
  vault: StudyVault;
  /** Injectable wall clock for envelope timestamps (tests pin arrival times). */
  now?: () => number;
};

function settingsPathFor(vault: StudyVault): string {
  return path.join(vault.paths.studyDir, MEMORY_SETTINGS_FILE_NAME);
}

/** Read the vault-level capture switch (absent file → capture ON, the doc default). */
export async function readMemorySettings({ vault }: MemoryDeps): Promise<MemorySettings> {
  const text = await vault.storage.readText(settingsPathFor(vault));
  return text ? memorySettingsSchema.parse(JSON.parse(text)) : defaultMemorySettings;
}

/** Persist the capture switch; takes effect for the very next append. */
export async function writeMemorySettings({ vault }: MemoryDeps, settings: MemorySettings): Promise<MemorySettings> {
  await vault.storage.writeTextAtomic(settingsPathFor(vault), `${JSON.stringify(settings, null, 2)}\n`);
  return settings;
}

/**
 * Append a batch of captured events. Takes the RAW body on purpose: the capture
 * switch is checked FIRST — off ⇒ `null` (the transport answers 204 + drop) with
 * NOTHING validated or stored, so a malformed batch from a stale client still just
 * drops. On ⇒ the body is validated against postMemoryEventsSchema (ZodError → 400
 * at the transport edge) and each event gets the server envelope.
 */
export async function appendMemoryEvents(deps: MemoryDeps, body: unknown): Promise<{ appended: number } | null> {
  const { vault } = deps;
  const clock = deps.now ?? (() => Date.now());
  if (!(await readMemorySettings(deps)).captureEnabled) return null;
  const { events } = postMemoryEventsSchema.parse(body);
  let appended = 0;
  for (const input of events) {
    const at = input.ts ?? new Date(clock()).toISOString();
    const record: MemoryEventRecord = memoryEventSchema.parse({
      id: createEntityId("memory"),
      type: "memoryEvent",
      schemaVersion,
      createdAt: at, // createdAt IS the event time; updatedAt mirrors it (immutable)
      updatedAt: at,
      createdBy: "user",
      verb: input.verb,
      subject: input.subject,
      payload: input.payload,
      sessionId: input.sessionId
    });
    await vault.stores.memoryEvents.upsert(record);
    appended += 1;
  }
  return { appended };
}

/**
 * Debug/manager read: events captured AT-OR-AFTER `since` (createdAt), oldest first,
 * capped by `limit` (default 500). `total` is the whole-store count ("N of M").
 */
export async function listMemoryEvents({ vault }: MemoryDeps, query: ListMemoryEventsQuery) {
  const all = await vault.stores.memoryEvents.list(); // store-sorted oldest first
  const matching = query.since
    ? all.filter((event) => Date.parse(event.createdAt) >= Date.parse(query.since as string))
    : all;
  return { events: matching.slice(0, query.limit), total: all.length };
}

export function registerMemoryRoutes(app: Express, deps: MemoryDeps): void {
  const { vault } = deps;

  // Append a batch of captured events. The capture switch is checked FIRST: off ⇒
  // 204 + drop, nothing validated or stored (the fire-and-forget client treats any
  // 2xx as success and never retries).
  app.post("/api/memory/events", async (req, res, next) => {
    try {
      const result = await appendMemoryEvents(deps, req.body);
      if (result === null) {
        res.status(204).end();
        return;
      }
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/memory/events", async (req, res, next) => {
    try {
      const query = listMemoryEventsQuerySchema.parse({
        since: typeof req.query.since === "string" ? req.query.since : undefined,
        limit: typeof req.query.limit === "string" ? req.query.limit : undefined
      });
      res.json(await listMemoryEvents(deps, query));
    } catch (error) {
      next(error);
    }
  });

  // Prune the short-term stream: delete events captured BEFORE the cutoff. This is
  // the retention lever (§2 — the jsonl never grows unbounded); the MEM-2
  // consolidator will call it after events are rolled into digests.
  app.delete("/api/memory/events", async (req, res, next) => {
    try {
      const { before } = pruneEventsQuerySchema.parse({
        before: typeof req.query.before === "string" ? req.query.before : undefined
      });
      const cutoff = Date.parse(before);
      const doomed = (await vault.stores.memoryEvents.list()).filter(
        (event) => Date.parse(event.createdAt) < cutoff
      );
      for (const event of doomed) await vault.stores.memoryEvents.delete(event.id);
      res.json({ deleted: doomed.length });
    } catch (error) {
      next(error);
    }
  });

  // The capture on/off switch (§6.4 "disable capture entirely"). GET/PUT mirror the
  // operation-prefs.json idiom; a PUT takes effect for the very next POST.
  app.get("/api/memory/settings", async (_req, res, next) => {
    try {
      res.json({ settings: await readMemorySettings(deps) });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/memory/settings", async (req, res, next) => {
    try {
      const settings = putMemorySettingsSchema.parse(req.body);
      res.json({ settings: await writeMemorySettings(deps, settings) });
    } catch (error) {
      next(error);
    }
  });
}
