import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PINNED_PUBLISHERS_FILE, listPinnedPublishers, pinPublisher, pinStatus } from "./pins";

let tempDir = "";

beforeEach(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), "growte-pins-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

const teacher = { id: "pubf_a7k2a7k2a7k2a7k2", publicKeyB64u: "AAAAkey1", displayName: "王老师 · 高一物理" };

describe("pin store (TOFU)", () => {
  it("walks the three states: unknown → pinned-match → pinned-mismatch", () => {
    expect(pinStatus(tempDir, teacher.id, teacher.publicKeyB64u)).toBe("unknown");

    pinPublisher(tempDir, teacher);
    expect(pinStatus(tempDir, teacher.id, teacher.publicKeyB64u)).toBe("pinned-match");

    // Same claimed id, different signing key — the "NOT the same 王老师" hard-fail case.
    expect(pinStatus(tempDir, teacher.id, "BBBBkey2")).toBe("pinned-mismatch");
  });

  it("persists entries with a pinnedAt timestamp and lists them", () => {
    pinPublisher(tempDir, teacher);
    const entries = listPinnedPublishers(tempDir);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject(teacher);
    expect(Number.isNaN(Date.parse(entries[0].pinnedAt))).toBe(false);
    expect(JSON.parse(readFileSync(path.join(tempDir, PINNED_PUBLISHERS_FILE), "utf8")).v).toBe(1);
  });

  it("upserts on re-pin: accepting a new key replaces the old pin for that id", () => {
    pinPublisher(tempDir, teacher);
    pinPublisher(tempDir, { ...teacher, publicKeyB64u: "BBBBkey2" });

    expect(pinStatus(tempDir, teacher.id, "BBBBkey2")).toBe("pinned-match");
    expect(pinStatus(tempDir, teacher.id, teacher.publicKeyB64u)).toBe("pinned-mismatch");
    expect(listPinnedPublishers(tempDir)).toHaveLength(1);
  });

  it("tracks multiple publishers independently", () => {
    const other = { id: "pubf_zzzzzzzzzzzzzzzz", publicKeyB64u: "CCCCkey3", displayName: "李老师" };
    pinPublisher(tempDir, teacher);
    pinPublisher(tempDir, other);

    expect(pinStatus(tempDir, teacher.id, teacher.publicKeyB64u)).toBe("pinned-match");
    expect(pinStatus(tempDir, other.id, other.publicKeyB64u)).toBe("pinned-match");
    expect(listPinnedPublishers(tempDir)).toHaveLength(2);
  });

  it("treats a corrupt store as empty (fresh TOFU) and repairs it on the next pin", () => {
    writeFileSync(path.join(tempDir, PINNED_PUBLISHERS_FILE), "{ not json", "utf8");

    expect(pinStatus(tempDir, teacher.id, teacher.publicKeyB64u)).toBe("unknown");

    pinPublisher(tempDir, teacher);
    expect(pinStatus(tempDir, teacher.id, teacher.publicKeyB64u)).toBe("pinned-match");
  });

  it("returns unknown for ids that were never pinned even when others exist", () => {
    pinPublisher(tempDir, teacher);

    expect(pinStatus(tempDir, "pubf_neverseenbefore", "DDDDkey4")).toBe("unknown");
  });
});
