import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEVICE_KEY_FILE, DEVICE_KEY_LENGTH, loadOrCreateDeviceKey } from "./deviceKey";

let tempDir = "";

beforeEach(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), "growte-identity-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("loadOrCreateDeviceKey", () => {
  it("creates 32 random bytes in <dir>/device.key on first run", () => {
    const key = loadOrCreateDeviceKey(tempDir);
    const filePath = path.join(tempDir, DEVICE_KEY_FILE);

    expect(key).toHaveLength(DEVICE_KEY_LENGTH);
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath).equals(key)).toBe(true);
  });

  it("returns the same key on every subsequent load", () => {
    const first = loadOrCreateDeviceKey(tempDir);
    const second = loadOrCreateDeviceKey(tempDir);

    expect(second.equals(first)).toBe(true);
  });

  it("creates missing parent directories (injectable path, never a vault)", () => {
    const nested = path.join(tempDir, "profile", "identity");
    const key = loadOrCreateDeviceKey(nested);

    expect(readFileSync(path.join(nested, DEVICE_KEY_FILE)).equals(key)).toBe(true);
  });

  it("refuses a corrupt key file instead of silently regenerating", () => {
    writeFileSync(path.join(tempDir, DEVICE_KEY_FILE), Buffer.from("short"));

    expect(() => loadOrCreateDeviceKey(tempDir)).toThrow(/corrupt device key/);
  });

  it("generates distinct keys for distinct dirs", () => {
    const other = mkdtempSync(path.join(os.tmpdir(), "growte-identity-b-"));
    try {
      expect(loadOrCreateDeviceKey(tempDir).equals(loadOrCreateDeviceKey(other))).toBe(false);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});
