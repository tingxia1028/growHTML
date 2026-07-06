// Trigger fire-state service (PRO-1) — the raw-JSON side file. Fire-on-surface records
// lastFiredAt + a per-localDayKey count (delta #2/#1); snooze writes snoozedUntil; dismiss
// lifts it; an absent file degrades to safe defaults; and the local-day count is isolated
// per day (so the cap resets at the rollover with no server date math). No real clock.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type StudyVault } from "../../core/vault";
import { openTestVault } from "../../core/testing/openTestVault";
import {
  dismissTrigger,
  readTriggerFires,
  recordTriggerFire,
  snoozeTrigger,
  TRIGGER_FIRES_FILE_NAME
} from "./triggerFires";

const TRIGGER_ID = "trigger_01ARZ3NDEKTSV4RRFFQ69G5FAV";
let tempDir = "";
let vault: StudyVault;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "trigger-fires-"));
  vault = await openTestVault({ rootDir: tempDir });
});

afterEach(async () => {
  vault?.close(); // STORE-SQL Stage-3: release sqlite handles before rm (no-op on jsonl)
  await rm(tempDir, { recursive: true, force: true });
});

describe("trigger fire state", () => {
  it("absent file ⇒ {} (nothing surfaced yet)", async () => {
    expect(await readTriggerFires({ vault })).toEqual({});
    // no file is created by a read
    expect(await vault.storage.readText(path.join(vault.paths.studyDir, TRIGGER_FIRES_FILE_NAME))).toBeNull();
  });

  it("a fire records lastFiredAt + bumps the per-day count", async () => {
    const state = await recordTriggerFire(
      { vault },
      { triggerId: TRIGGER_ID, localDayKey: "2026-07-05", firedAt: 1000 }
    );
    expect(state.lastFiredAt).toBe(1000);
    expect(state.firedByDay["2026-07-05"]).toBe(1);

    const again = await recordTriggerFire(
      { vault },
      { triggerId: TRIGGER_ID, localDayKey: "2026-07-05", firedAt: 2000 }
    );
    expect(again.lastFiredAt).toBe(2000);
    expect(again.firedByDay["2026-07-05"]).toBe(2);
  });

  it("isolates the count per localDayKey (the cap resets at the rollover)", async () => {
    await recordTriggerFire({ vault }, { triggerId: TRIGGER_ID, localDayKey: "2026-07-04", firedAt: 1000 });
    await recordTriggerFire({ vault }, { triggerId: TRIGGER_ID, localDayKey: "2026-07-04", firedAt: 2000 });
    const rolled = await recordTriggerFire(
      { vault },
      { triggerId: TRIGGER_ID, localDayKey: "2026-07-05", firedAt: 3000 }
    );
    expect(rolled.firedByDay["2026-07-04"]).toBe(2);
    expect(rolled.firedByDay["2026-07-05"]).toBe(1); // fresh count on the new local day
  });

  it("snooze writes snoozedUntil; dismiss lifts it (idempotent)", async () => {
    const snoozed = await snoozeTrigger({ vault }, { triggerId: TRIGGER_ID, snoozedUntil: 999_000 });
    expect(snoozed.snoozedUntil).toBe(999_000);
    const dismissed = await dismissTrigger({ vault }, { triggerId: TRIGGER_ID });
    expect(dismissed.snoozedUntil).toBeUndefined();
    // dismiss again is a no-op
    expect((await dismissTrigger({ vault }, { triggerId: TRIGGER_ID })).snoozedUntil).toBeUndefined();
  });

  it("preserves other triggers' state when one is updated", async () => {
    await recordTriggerFire({ vault }, { triggerId: TRIGGER_ID, localDayKey: "2026-07-05", firedAt: 1000 });
    const other = "trigger_01BX5ZZKBKACTAV9WEVGEMMVRZ";
    await snoozeTrigger({ vault }, { triggerId: other, snoozedUntil: 5000 });
    const doc = await readTriggerFires({ vault });
    expect(doc[TRIGGER_ID].firedByDay["2026-07-05"]).toBe(1);
    expect(doc[other].snoozedUntil).toBe(5000);
  });

  it("prunes firedByDay to a recent-day window so the file cannot grow unbounded", async () => {
    // Surface once on 20 distinct local days; only the most recent 14 buckets survive.
    for (let d = 1; d <= 20; d += 1) {
      const day = `2026-07-${String(d).padStart(2, "0")}`;
      await recordTriggerFire({ vault }, { triggerId: TRIGGER_ID, localDayKey: day, firedAt: d * 1000 });
    }
    const state = (await readTriggerFires({ vault }))[TRIGGER_ID];
    expect(Object.keys(state.firedByDay)).toHaveLength(14);
    expect(state.firedByDay["2026-07-20"]).toBe(1); // newest kept
    expect(state.firedByDay["2026-07-01"]).toBeUndefined(); // oldest pruned
  });

  it("rejects a malformed trigger id at the edge", async () => {
    await expect(
      recordTriggerFire({ vault }, { triggerId: "not-a-trigger-id", localDayKey: "2026-07-05", firedAt: 1 })
    ).rejects.toThrow();
  });
});
