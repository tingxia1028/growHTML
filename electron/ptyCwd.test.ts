import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveCwd } from "./ptyCwd";

describe("resolveCwd", () => {
  const fallback = path.resolve(".");

  it("returns the fallback when nothing is requested", () => {
    expect(resolveCwd(undefined, fallback)).toBe(fallback);
    expect(resolveCwd("", fallback)).toBe(fallback);
    expect(resolveCwd("   ", fallback)).toBe(fallback);
  });

  it("returns the requested directory when it exists", () => {
    const dir = tmpdir();
    expect(resolveCwd(dir, fallback)).toBe(dir);
  });

  it("falls back when the requested path does not exist", () => {
    const missing = path.join(tmpdir(), "study-vault-no-such-dir-xyz");
    expect(resolveCwd(missing, fallback)).toBe(fallback);
  });

  it("falls back when the requested path is a file, not a directory", () => {
    // This very test file is a regular file, never a directory.
    const thisFile = path.resolve("electron/ptyCwd.test.ts");
    expect(resolveCwd(thisFile, fallback)).toBe(fallback);
  });
});
