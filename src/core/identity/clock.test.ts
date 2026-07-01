import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "../crypto/primitives";
import { CLOCK_HWM_FILE, DEFAULT_CLOCK_SLACK_MS, checkValidity, observeNow } from "./clock";

const T = Date.parse("2026-07-01T12:00:00Z");
const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const OPEN = { notBefore: null, validUntil: null };

let tempDir = "";
let deviceKey: Buffer = Buffer.alloc(0);

beforeEach(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), "growte-clock-"));
  deviceKey = randomBytes(32);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("checkValidity — window gates", () => {
  it("passes an open validity window and seeds the high-water mark file", () => {
    expect(checkValidity(tempDir, deviceKey, OPEN, { now: T })).toEqual({ ok: true });
    expect(existsSync(path.join(tempDir, CLOCK_HWM_FILE))).toBe(true);
  });

  it("passes inside the window, inclusive at both edges", () => {
    const validity = { notBefore: "2026-07-01T11:00:00Z", validUntil: "2026-07-01T13:00:00Z" };

    // Ascending order: every check advances the high-water mark, so a descending
    // sequence would (correctly) trip the rollback detector.
    expect(checkValidity(tempDir, deviceKey, validity, { now: T - HOUR })).toEqual({ ok: true });
    expect(checkValidity(tempDir, deviceKey, validity, { now: T })).toEqual({ ok: true });
    expect(checkValidity(tempDir, deviceKey, validity, { now: T + HOUR })).toEqual({ ok: true });
  });

  it("reports expired after validUntil", () => {
    const validity = { notBefore: null, validUntil: "2026-07-01T11:00:00Z" };

    expect(checkValidity(tempDir, deviceKey, validity, { now: T })).toEqual({ ok: false, reason: "expired" });
  });

  it("reports not-yet-valid before notBefore", () => {
    const validity = { notBefore: "2026-07-01T13:00:00Z", validUntil: null };

    expect(checkValidity(tempDir, deviceKey, validity, { now: T })).toEqual({ ok: false, reason: "not-yet-valid" });
  });

  it("throws on unparseable validity timestamps instead of guessing", () => {
    expect(() =>
      checkValidity(tempDir, deviceKey, { notBefore: "not-a-date", validUntil: null }, { now: T })
    ).toThrow(/invalid validity/);
  });
});

describe("checkValidity — rollback high-water mark", () => {
  it("detects a clock rolled back beyond the slack", () => {
    observeNow(tempDir, deviceKey, T);

    expect(checkValidity(tempDir, deviceKey, OPEN, { now: T - 6 * MINUTE })).toEqual({
      ok: false,
      reason: "clock-rollback"
    });
  });

  it("tolerates small corrections within the slack (default 5 min)", () => {
    observeNow(tempDir, deviceKey, T);

    expect(checkValidity(tempDir, deviceKey, OPEN, { now: T - 4 * MINUTE })).toEqual({ ok: true });
    expect(DEFAULT_CLOCK_SLACK_MS).toBe(5 * MINUTE);
  });

  it("honors a custom slackMs", () => {
    observeNow(tempDir, deviceKey, T);

    expect(checkValidity(tempDir, deviceKey, OPEN, { now: T - 1, slackMs: 0 })).toEqual({
      ok: false,
      reason: "clock-rollback"
    });
  });

  it("reports rollback ahead of expiry — a rolled-back clock makes other answers meaningless", () => {
    observeNow(tempDir, deviceKey, T);
    const expired = { notBefore: null, validUntil: "2026-07-01T10:00:00Z" };

    expect(checkValidity(tempDir, deviceKey, expired, { now: T - 6 * MINUTE })).toEqual({
      ok: false,
      reason: "clock-rollback"
    });
  });

  it("never lowers the mark: a rolled-back observation does not erase the high water", () => {
    observeNow(tempDir, deviceKey, T);
    observeNow(tempDir, deviceKey, T - 10 * MINUTE); // attacker lets the app run on a rolled-back clock

    expect(checkValidity(tempDir, deviceKey, OPEN, { now: T - 6 * MINUTE })).toEqual({
      ok: false,
      reason: "clock-rollback"
    });
  });

  it("advances the mark as a side effect of checking", () => {
    checkValidity(tempDir, deviceKey, OPEN, { now: T });

    expect(checkValidity(tempDir, deviceKey, OPEN, { now: T - 6 * MINUTE })).toEqual({
      ok: false,
      reason: "clock-rollback"
    });
  });
});

describe("checkValidity — self-healing storage", () => {
  it("treats a corrupt hwm file as fresh (writes now) instead of bricking", () => {
    writeFileSync(path.join(tempDir, CLOCK_HWM_FILE), Buffer.from("garbage bytes"));

    expect(checkValidity(tempDir, deviceKey, OPEN, { now: T })).toEqual({ ok: true });
    // The re-seeded mark is live: an earlier `now` is again detected as rollback.
    expect(checkValidity(tempDir, deviceKey, OPEN, { now: T - 6 * MINUTE })).toEqual({
      ok: false,
      reason: "clock-rollback"
    });
  });

  it("treats a mark encrypted under a different device key as corrupt (fresh start)", () => {
    observeNow(tempDir, randomBytes(32), T + HOUR);

    expect(checkValidity(tempDir, deviceKey, OPEN, { now: T })).toEqual({ ok: true });
  });

  it("creates missing directories on first observation", () => {
    const nested = path.join(tempDir, "deep", "identity");
    observeNow(nested, deviceKey, T);

    expect(existsSync(path.join(nested, CLOCK_HWM_FILE))).toBe(true);
    expect(checkValidity(nested, deviceKey, OPEN, { now: T - 6 * MINUTE })).toEqual({
      ok: false,
      reason: "clock-rollback"
    });
  });
});
