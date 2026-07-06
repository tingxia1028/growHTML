import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listSources, readSourceContent } from "../src/core/store/sources";
import type { StudyVault } from "../src/core/vault";
import { demoHtml, seedVault, type SeedVaultResult } from "./seed";

let tempDir = "";
// STORE-SQL Stage-3: seedVault opens a vault (now sqlite by default) holding `.db`/`-wal` handles.
// Track each result's vault so afterEach can close() (release the handles) BEFORE rm — Windows can't
// unlink an open `.db`. close() is a safe no-op under STORE_ENGINE=jsonl.
const seededVaults: StudyVault[] = [];
async function seed(input: Parameters<typeof seedVault>[0]): Promise<SeedVaultResult> {
  const result = await seedVault(input);
  seededVaults.push(result.vault);
  return result;
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "study-vault-seed-"));
});

afterEach(async () => {
  for (const vault of seededVaults.splice(0)) vault.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("seedVault", () => {
  it("creates a demo source when no legacy content exists", async () => {
    const result = await seed({
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

    const result = await seed({
      rootDir: path.join(tempDir, "vault"),
      legacyContentPath: legacyPath
    });

    expect(result.mode).toBe("legacy");
    expect(await readSourceContent(result.vault, result.source)).toContain("Legacy GrowHTML content.");
  });

  it("does not duplicate sources on repeated seed runs", async () => {
    const rootDir = path.join(tempDir, "vault");
    const first = await seed({ rootDir, legacyContentPath: path.join(tempDir, "missing.html") });
    const second = await seed({ rootDir, legacyContentPath: path.join(tempDir, "missing.html") });

    expect(first.mode).toBe("demo");
    expect(second.mode).toBe("existing");
    expect(await listSources(second.vault)).toHaveLength(1);
  });
});

