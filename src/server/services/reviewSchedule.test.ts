// REV-3 schedule persistence — the service over a real temp vault: legacy law
// (absent file ⇒ {} ⇒ everything due), first-grade materialization, sequence
// advancement through the SAME pure engine, skip-never-writes, the `at` clock
// override, corrupt-file degradation, and schema rejection.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { openVault, type StudyVault } from "../../core/vault";
import {
  readReviewSchedule,
  recordReviewGrade,
  REVIEW_SCHEDULE_FILE_NAME
} from "./reviewSchedule";

const T0 = "2026-07-01T08:00:00.000Z";
const DAY_MS = 86_400_000;
const daysAfter = (iso: string, days: number) => new Date(Date.parse(iso) + days * DAY_MS).toISOString();

let tempDir = "";
let vault: StudyVault;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "study-vault-review-srs-"));
  vault = await openVault({ rootDir: tempDir });
});

afterEach(async () => {
  // STORE-SQL Stage-3: release sqlite handles before rm (no-op on jsonl).
  await vault?.close();
  await rm(tempDir, { recursive: true, force: true });
});

const filePath = () => path.join(vault.paths.studyDir, REVIEW_SCHEDULE_FILE_NAME);

describe("readReviewSchedule — the zero-migration law", () => {
  it("absent file ⇒ {} (legacy vault: every note due now)", async () => {
    expect(await readReviewSchedule({ vault })).toEqual({});
  });

  it("corrupt or invalid file degrades to {} instead of throwing", async () => {
    await writeFile(filePath(), "{ not json", "utf8");
    expect(await readReviewSchedule({ vault })).toEqual({});
    await writeFile(filePath(), JSON.stringify({ n1: { due: "nope" } }), "utf8");
    expect(await readReviewSchedule({ vault })).toEqual({});
  });
});

describe("recordReviewGrade — materialize + advance", () => {
  it("the FIRST grade materializes a row (pass ⇒ due tomorrow) and persists it", async () => {
    const { noteId, schedule } = await recordReviewGrade({ vault }, { noteId: "n1", result: "pass", at: T0 });
    expect(noteId).toBe("n1");
    expect(schedule).toMatchObject({ intervalDays: 1, streak: 1, due: daysAfter(T0, 1), lastResult: "pass" });
    // Really on disk, under the note's key.
    const onDisk = JSON.parse(await readFile(filePath(), "utf8"));
    expect(onDisk.n1.due).toBe(daysAfter(T0, 1));
    expect(await readReviewSchedule({ vault })).toEqual({ n1: schedule });
  });

  it("a grade SEQUENCE advances through the pure ladder (1d → 6d), fail resets to due-now", async () => {
    await recordReviewGrade({ vault }, { noteId: "n1", result: "pass", at: T0 });
    const second = await recordReviewGrade({ vault }, { noteId: "n1", result: "pass", at: daysAfter(T0, 1) });
    expect(second.schedule).toMatchObject({ intervalDays: 6, streak: 2, due: daysAfter(daysAfter(T0, 1), 6) });

    const failed = await recordReviewGrade({ vault }, { noteId: "n1", result: "fail", at: daysAfter(T0, 7) });
    expect(failed.schedule).toMatchObject({
      intervalDays: 0,
      streak: 0,
      lapses: 1,
      due: daysAfter(T0, 7), // due immediately
      ease: 2.3
    });
  });

  it("notes schedule independently (one row per noteId)", async () => {
    await recordReviewGrade({ vault }, { noteId: "n1", result: "pass", at: T0 });
    await recordReviewGrade({ vault }, { noteId: "n2", result: "fail", at: T0 });
    const state = await readReviewSchedule({ vault });
    expect(Object.keys(state).sort()).toEqual(["n1", "n2"]);
    expect(state.n1.lastResult).toBe("pass");
    expect(state.n2.lastResult).toBe("fail");
  });

  it("skip is NOT a grade: nothing materializes, nothing is written, current row echoes back", async () => {
    const first = await recordReviewGrade({ vault }, { noteId: "n1", result: "skip", at: T0 });
    expect(first.schedule).toBeNull();
    expect(await vault.storage.readText(filePath())).toBeNull(); // no file created

    await recordReviewGrade({ vault }, { noteId: "n1", result: "pass", at: T0 });
    const echoed = await recordReviewGrade({ vault }, { noteId: "n1", result: "skip", at: daysAfter(T0, 1) });
    expect(echoed.schedule).toMatchObject({ intervalDays: 1, lastReviewedAt: T0 }); // untouched
  });

  it("without `at`, the injected deps.now clock stamps the grade", async () => {
    const pinned = Date.parse(T0);
    const { schedule } = await recordReviewGrade({ vault, now: () => pinned }, { noteId: "n1", result: "pass" });
    expect(schedule).toMatchObject({ lastReviewedAt: T0, due: daysAfter(T0, 1) });
  });

  it("rejects malformed bodies through the exported zod schema", async () => {
    await expect(recordReviewGrade({ vault }, { noteId: "", result: "pass" })).rejects.toThrow(z.ZodError);
    await expect(recordReviewGrade({ vault }, { noteId: "n1", result: "good" })).rejects.toThrow(z.ZodError);
    await expect(recordReviewGrade({ vault }, { noteId: "n1", result: "pass", at: "not-a-date" })).rejects.toThrow(
      z.ZodError
    );
  });
});
