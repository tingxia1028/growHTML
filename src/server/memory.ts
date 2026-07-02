// server-only — learner-memory MEM-1+MEM-2 (docs/design/learner-memory.md §2–§4, §6,
// §7): the capture endpoints + the vault-level capture switch + the TIERS. Events are
// TELEMETRY, not a ledger: the client fires-and-forgets batches at POST
// /api/memory/events; when the switch is off the server answers 204 and stores
// NOTHING, so a stale client can never force capture back on.
//
// MEM-2 adds the 中长期/长期 tiers around the pure core engine
// (src/core/memory/digest.ts + profile.ts): consolidation rolls raw events into
// day-digests (memory-digests.json) and COMPACTS the raw stream (events older than
// the 14d window are pruned — §2), profile facts derive deterministically from the
// digests with a separate user-override document (memory-profile-overrides.json) that
// survives every recompute. Consolidation runs at app start (src/server/start.ts) and
// via a debounced/threshold scheduler after appends; POST /api/memory/consolidate
// runs a pass on demand (tests/manual). Kit taxonomies are MEM-3.
//
// X0b: ALL logic lives in transport-agnostic service functions (same (deps, input) →
// data shape as src/server/services/**) so the direct adapter
// (services/directTransport.ts) reuses the SAME zod schemas + behavior with no
// express. The routes below are thin wrappers over them.

import path from "node:path";
import type { Express } from "express";
import { z } from "zod";
import { createEntityId } from "../core/ids";
import {
  consolidateMemoryEvents,
  emptyMemoryDigestState,
  MEMORY_DIGEST_RETENTION_DAYS,
  MEMORY_RAW_EVENT_RETENTION_DAYS,
  memoryDigestDimensionSchema,
  memoryDigestStateSchema,
  summarizeMemoryDigests,
  type MemoryDigestState
} from "../core/memory/digest";
import {
  applyProfileOverrides,
  deriveProfileFacts,
  emptyProfileOverrides,
  profileOverridesSchema,
  type ProfileFactView,
  type ProfileOverrides
} from "../core/memory/profile";
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
/** The 中长期 tier — persisted digest state (rows + the frozenThrough watermark). */
export const MEMORY_DIGESTS_FILE_NAME = "memory-digests.json";
/** The 长期 override layer — user pins/hides/corrections keyed by fact key. */
export const MEMORY_PROFILE_OVERRIDES_FILE_NAME = "memory-profile-overrides.json";
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

/** GET /api/memory/digests query (§4): optional dimension filter; V1 is day-period only. */
export const listMemoryDigestsQuerySchema = z.object({
  dimension: memoryDigestDimensionSchema.optional()
});
export type ListMemoryDigestsQuery = z.infer<typeof listMemoryDigestsQuerySchema>;

/** PUT /api/memory/profile body — the WHOLE override document (small by design). */
export const putMemoryProfileSchema = profileOverridesSchema;

export type MemoryDeps = {
  vault: StudyVault;
  /** Injectable wall clock for envelope timestamps (tests pin arrival times). */
  now?: () => number;
  /** Optional background consolidation trigger (createMemoryConsolidationScheduler). */
  consolidation?: Pick<MemoryConsolidationScheduler, "notifyAppended">;
};

function settingsPathFor(vault: StudyVault): string {
  return path.join(vault.paths.studyDir, MEMORY_SETTINGS_FILE_NAME);
}

function digestsPathFor(vault: StudyVault): string {
  return path.join(vault.paths.studyDir, MEMORY_DIGESTS_FILE_NAME);
}

function overridesPathFor(vault: StudyVault): string {
  return path.join(vault.paths.studyDir, MEMORY_PROFILE_OVERRIDES_FILE_NAME);
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
  // Nudge the background consolidation (debounce/threshold) — transport-agnostic, so
  // the direct adapter gets the same trigger when its host wires a scheduler.
  if (appended > 0) deps.consolidation?.notifyAppended(appended);
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

/** Delete events captured BEFORE the cutoff — the §2 compaction lever (route + consolidator). */
export async function pruneMemoryEventsBefore({ vault }: MemoryDeps, before: string): Promise<number> {
  const cutoff = Date.parse(before);
  const doomed = (await vault.stores.memoryEvents.list()).filter(
    (event) => Date.parse(event.createdAt) < cutoff
  );
  for (const event of doomed) await vault.stores.memoryEvents.delete(event.id);
  return doomed.length;
}

// —— MEM-2: the 中长期 tier (digests) ————————————————————————————————————————

/** Read the persisted digest state (absent/corrupt file → the empty state). */
export async function readMemoryDigestState({ vault }: MemoryDeps): Promise<MemoryDigestState> {
  const text = await vault.storage.readText(digestsPathFor(vault));
  if (!text) return emptyMemoryDigestState;
  try {
    return memoryDigestStateSchema.parse(JSON.parse(text));
  } catch {
    // Digests are derived data: an unreadable file just means "re-derive from raw".
    return emptyMemoryDigestState;
  }
}

async function writeMemoryDigestState({ vault }: MemoryDeps, state: MemoryDigestState): Promise<void> {
  await vault.storage.writeTextAtomic(digestsPathFor(vault), `${JSON.stringify(state, null, 2)}\n`);
}

/**
 * The LIVE digest view: persisted state + everything still raw, merged through the
 * same pure pass a persisting consolidation would run (nothing written) — so GET
 * digests/profile are always current even between consolidation passes.
 */
async function computeCurrentDigests(deps: MemoryDeps): Promise<MemoryDigestState> {
  const clock = deps.now ?? (() => Date.now());
  const [events, previous] = await Promise.all([
    deps.vault.stores.memoryEvents.list(),
    readMemoryDigestState(deps)
  ]);
  return consolidateMemoryEvents(events, { previous, now: clock() }).state;
}

export type ConsolidateMemorySummary = {
  frozenThrough: string | null;
  consolidatedAt: string | null;
  rows: number;
  /** Raw events compacted away by this pass (already represented in frozen rows). */
  prunedEvents: number;
};

/**
 * One persisting consolidation pass (app start / scheduler / POST …/consolidate):
 * events→digests via the pure engine, atomic state write, THEN raw compaction (§2 —
 * events older than the 14d window are pruned; the engine's frozenThrough watermark
 * makes a crashed prune re-run safely instead of double-counting). Idempotent.
 */
export async function consolidateMemory(deps: MemoryDeps): Promise<ConsolidateMemorySummary> {
  const clock = deps.now ?? (() => Date.now());
  const events = await deps.vault.stores.memoryEvents.list();
  const previous = await readMemoryDigestState(deps);
  const { state, pruneBefore } = consolidateMemoryEvents(events, { previous, now: clock() });
  await writeMemoryDigestState(deps, state);
  const prunedEvents = await pruneMemoryEventsBefore(deps, pruneBefore);
  return {
    frozenThrough: state.frozenThrough,
    consolidatedAt: state.consolidatedAt,
    rows: state.rows.length,
    prunedEvents
  };
}

/** GET /api/memory/digests — live rows (+ optional dimension filter) with tier meta. */
export async function listMemoryDigests(deps: MemoryDeps, query: ListMemoryDigestsQuery) {
  const state = await computeCurrentDigests(deps);
  const digests = query.dimension ? state.rows.filter((row) => row.dimension === query.dimension) : state.rows;
  return {
    digests,
    meta: { frozenThrough: state.frozenThrough, consolidatedAt: state.consolidatedAt, rows: state.rows.length }
  };
}

// —— MEM-2: the 长期 tier (profile facts + user overrides) ————————————————————

export async function readMemoryProfileOverrides({ vault }: MemoryDeps): Promise<ProfileOverrides> {
  const text = await vault.storage.readText(overridesPathFor(vault));
  if (!text) return emptyProfileOverrides;
  try {
    return profileOverridesSchema.parse(JSON.parse(text));
  } catch {
    return emptyProfileOverrides;
  }
}

/** PUT /api/memory/profile — replace the override document (the raw body is validated). */
export async function writeMemoryProfileOverrides(deps: MemoryDeps, body: unknown): Promise<ProfileOverrides> {
  const overrides = putMemoryProfileSchema.parse(body);
  await deps.vault.storage.writeTextAtomic(overridesPathFor(deps.vault), `${JSON.stringify(overrides, null, 2)}\n`);
  return overrides;
}

export type MemoryProfileResponse = {
  facts: ProfileFactView[];
  overrides: ProfileOverrides;
  digestMeta: {
    frozenThrough: string | null;
    consolidatedAt: string | null;
    rows: number;
    /** Raw events currently in the 短期 stream (post-compaction count). */
    events: number;
    /** §6.4 — viewing is user-owned and never gated by the capture switch. */
    captureEnabled: boolean;
    retention: { rawEventDays: number; digestDays: number };
  };
};

/**
 * GET /api/memory/profile — facts derive deterministically from the LIVE digests and
 * come back merged with the override layer ({facts, overrides, digestMeta}). Capture
 * OFF only stops NEW capture (§6.4): the profile stays fully viewable/editable, and
 * `digestMeta.captureEnabled` lets the 画像页 say so.
 */
export async function getMemoryProfile(deps: MemoryDeps): Promise<MemoryProfileResponse> {
  const [state, overrides, settings, events] = await Promise.all([
    computeCurrentDigests(deps),
    readMemoryProfileOverrides(deps),
    readMemorySettings(deps),
    deps.vault.stores.memoryEvents.list()
  ]);
  const facts = applyProfileOverrides(deriveProfileFacts(summarizeMemoryDigests(state.rows)), overrides);
  return {
    facts,
    overrides,
    digestMeta: {
      frozenThrough: state.frozenThrough,
      consolidatedAt: state.consolidatedAt,
      rows: state.rows.length,
      events: events.length,
      captureEnabled: settings.captureEnabled,
      retention: { rawEventDays: MEMORY_RAW_EVENT_RETENTION_DAYS, digestDays: MEMORY_DIGEST_RETENTION_DAYS }
    }
  };
}

/**
 * DELETE /api/memory — the §6.4 "clear any tier" big lever: wipes ALL tiers (raw
 * events + digests + overrides; facts derive from digests, so they vanish with them).
 * The capture SWITCH is a setting, not memory — deliberately untouched.
 */
export async function clearMemory(deps: MemoryDeps): Promise<{ cleared: { events: number; digests: boolean; overrides: boolean } }> {
  const { vault } = deps;
  const events = await vault.stores.memoryEvents.list();
  for (const event of events) await vault.stores.memoryEvents.delete(event.id);
  await vault.storage.deleteFile(digestsPathFor(vault));
  await vault.storage.deleteFile(overridesPathFor(vault));
  return { cleared: { events: events.length, digests: true, overrides: true } };
}

// —— MEM-2: the background consolidation trigger ————————————————————————————

/** Debounce: consolidate once appends go quiet for this long. */
export const MEMORY_CONSOLIDATE_DEBOUNCE_MS = 30_000;
/** Threshold: this many appended events since the last pass consolidates immediately. */
export const MEMORY_CONSOLIDATE_THRESHOLD = 500;

export type MemoryConsolidationScheduler = {
  /** Called after a successful append; arms the debounce / fires the threshold. */
  notifyAppended(count: number): void;
  /** Await any in-flight pass and cancel the timer (tests / teardown). */
  dispose(): Promise<void>;
};

/**
 * The idle/threshold trigger (§4 "start + idle — no cron in a local app"): appends
 * arm a trailing debounce (each append pushes it out — consolidation runs when the
 * session goes idle); a busy session that never goes idle is caught by the count
 * threshold. The timer is unref'd so it never holds the process open, and failures
 * are swallowed (telemetry-grade — the next trigger or app start retries).
 */
export function createMemoryConsolidationScheduler(
  deps: MemoryDeps,
  opts?: { debounceMs?: number; threshold?: number }
): MemoryConsolidationScheduler {
  const debounceMs = opts?.debounceMs ?? MEMORY_CONSOLIDATE_DEBOUNCE_MS;
  const threshold = opts?.threshold ?? MEMORY_CONSOLIDATE_THRESHOLD;
  let pending = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inflight: Promise<void> = Promise.resolve();

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const run = () => {
    clearTimer();
    pending = 0;
    inflight = inflight.then(() => consolidateMemory(deps)).then(
      () => undefined,
      () => undefined // swallowed — consolidation is retried by the next trigger/boot
    );
  };

  return {
    notifyAppended(count: number) {
      pending += count;
      if (pending >= threshold) {
        run();
        return;
      }
      clearTimer();
      timer = setTimeout(run, debounceMs);
      timer.unref?.();
    },
    async dispose() {
      clearTimer();
      await inflight;
    }
  };
}

export function registerMemoryRoutes(app: Express, deps: MemoryDeps): void {
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
  // consolidator calls the same service function after events roll into digests.
  app.delete("/api/memory/events", async (req, res, next) => {
    try {
      const { before } = pruneEventsQuerySchema.parse({
        before: typeof req.query.before === "string" ? req.query.before : undefined
      });
      res.json({ deleted: await pruneMemoryEventsBefore(deps, before) });
    } catch (error) {
      next(error);
    }
  });

  // —— MEM-2: tiers ——

  // Run one consolidation pass NOW (tests/manual — the same pass app start and the
  // debounce/threshold scheduler run). Idempotent: a duplicate call is a no-op.
  app.post("/api/memory/consolidate", async (_req, res, next) => {
    try {
      res.json({ consolidated: await consolidateMemory(deps) });
    } catch (error) {
      next(error);
    }
  });

  // The 中长期 tier read (§4): live day-digest rows, optionally per dimension.
  app.get("/api/memory/digests", async (req, res, next) => {
    try {
      const query = listMemoryDigestsQuerySchema.parse({
        dimension: typeof req.query.dimension === "string" ? req.query.dimension : undefined
      });
      res.json(await listMemoryDigests(deps, query));
    } catch (error) {
      next(error);
    }
  });

  // The 长期 tier read: deterministic facts merged with the user-override layer.
  app.get("/api/memory/profile", async (_req, res, next) => {
    try {
      res.json(await getMemoryProfile(deps));
    } catch (error) {
      next(error);
    }
  });

  // Replace the override document (pin/hide/correct — §6.4 "edit/pin/delete facts").
  app.put("/api/memory/profile", async (req, res, next) => {
    try {
      res.json({ overrides: await writeMemoryProfileOverrides(deps, req.body) });
    } catch (error) {
      next(error);
    }
  });

  // Clear EVERY tier (events + digests + overrides) — §6.4 "clear any tier".
  app.delete("/api/memory", async (_req, res, next) => {
    try {
      res.json(await clearMemory(deps));
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
