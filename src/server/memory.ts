// server-only — learner-memory MEM-1 (docs/design/learner-memory.md §2–§4, §6, §7):
// the capture endpoints + the vault-level capture switch. Events are TELEMETRY, not a
// ledger: the client fires-and-forgets batches at POST /api/memory/events; when the
// switch is off the server answers 204 and stores NOTHING, so a stale client can never
// force capture back on. Consolidation (digests/profile) is MEM-2; kit taxonomies are
// MEM-3 — this module only ingests, reads back (debug/manager), and prunes the 短期
// stream. Module pattern mirrors registerSvpackRoutes (the F2 extraction shape).

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
const putSettingsSchema = z.object({ captureEnabled: z.boolean() });

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

const postEventsSchema = z.object({
  events: z.array(memoryEventInputSchema).min(1).max(MEMORY_EVENTS_BATCH_LIMIT)
});

const listEventsQuerySchema = z.object({
  since: isoDateTimeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500)
});

const pruneEventsQuerySchema = z.object({ before: isoDateTimeSchema });

export type MemoryDeps = {
  vault: StudyVault;
  /** Injectable wall clock for envelope timestamps (tests pin arrival times). */
  now?: () => number;
};

export function registerMemoryRoutes(app: Express, deps: MemoryDeps): void {
  const { vault } = deps;
  const clock = deps.now ?? (() => Date.now());
  const settingsPath = path.join(vault.paths.studyDir, MEMORY_SETTINGS_FILE_NAME);

  async function readSettings(): Promise<MemorySettings> {
    const text = await vault.storage.readText(settingsPath);
    return text ? memorySettingsSchema.parse(JSON.parse(text)) : defaultMemorySettings;
  }

  // Append a batch of captured events. The capture switch is checked FIRST: off ⇒
  // 204 + drop, nothing validated or stored (the fire-and-forget client treats any
  // 2xx as success and never retries).
  app.post("/api/memory/events", async (req, res, next) => {
    try {
      if (!(await readSettings()).captureEnabled) {
        res.status(204).end();
        return;
      }
      const { events } = postEventsSchema.parse(req.body);
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
      res.status(201).json({ appended });
    } catch (error) {
      next(error);
    }
  });

  // Debug/manager read: events captured AT-OR-AFTER `since` (createdAt), oldest
  // first, capped by `limit` (default 500). `total` is the whole-store count so a
  // manager view can show "N of M".
  app.get("/api/memory/events", async (req, res, next) => {
    try {
      const query = listEventsQuerySchema.parse({
        since: typeof req.query.since === "string" ? req.query.since : undefined,
        limit: typeof req.query.limit === "string" ? req.query.limit : undefined
      });
      const all = await vault.stores.memoryEvents.list(); // store-sorted oldest first
      const matching = query.since
        ? all.filter((event) => Date.parse(event.createdAt) >= Date.parse(query.since as string))
        : all;
      res.json({ events: matching.slice(0, query.limit), total: all.length });
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
      res.json({ settings: await readSettings() });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/memory/settings", async (req, res, next) => {
    try {
      const settings = putSettingsSchema.parse(req.body);
      await vault.storage.writeTextAtomic(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
      res.json({ settings });
    } catch (error) {
      next(error);
    }
  });
}
