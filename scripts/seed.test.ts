import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listSources, readSourceContent } from "../src/core/store/sources";
import { demoHtml, seedVault } from "./seed";

let tempDir = "";

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "study-vault-seed-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("seedVault", () => {
  it("creates a demo source when no legacy content exists", async () => {
    const result = await seedVault({
      rootDir: path.join(tempDir, "vault"),
      legacyContentPath: path.join(tempDir, "missing.html")
    });

    expect(result.mode).toBe("demo");
    expect(await readSourceContent(result.vault, result.source)).toBe(demoHtml);
  });

  it("imports legacy GrowHTML content when present", async () => {
    const legacyDir = path.join(tempDir, "data", "documents", "main");
    const legacyPath = path.join(legacyDir, "content.html");
    await mkdir(legacyDir, { recursive: true });
    await writeFile(legacyPath, "<main><p>Legacy GrowHTML content.</p></main>", "utf8");

    const result = await seedVault({
      rootDir: path.join(tempDir, "vault"),
      legacyContentPath: legacyPath
    });

    expect(result.mode).toBe("legacy");
    expect(await readSourceContent(result.vault, result.source)).toContain("Legacy GrowHTML content.");
  });

  it("does not duplicate sources on repeated seed runs", async () => {
    const rootDir = path.join(tempDir, "vault");
    const first = await seedVault({ rootDir, legacyContentPath: path.join(tempDir, "missing.html") });
    const second = await seedVault({ rootDir, legacyContentPath: path.join(tempDir, "missing.html") });

    expect(first.mode).toBe("demo");
    expect(second.mode).toBe("existing");
    expect(await listSources(second.vault)).toHaveLength(1);
  });
});

