import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { entityFileNames } from "./store/entities";
import { assetsDirName, appendLogFileNames, exportsDirName, manifestFileName, sourcesDirName, studyDirName, type StudyVault } from "./vault";
import { openTestVault } from "./testing/openTestVault";
import { vaultManifestSchema } from "./schema";
import { fixtureAsset } from "./fixtures/golden";

let tempDir = "";
// STORE-SQL Stage-3: openVault now defaults to sqlite → each vault holds `.db`/`-wal` handles.
// Track them so afterEach can close() them BEFORE rm — Windows can't unlink an open `.db`.
const openVaults: StudyVault[] = [];
async function openTrackedVault(input?: { name?: string }): Promise<StudyVault> {
  const vault = await openTestVault({ rootDir: tempDir, name: input?.name });
  openVaults.push(vault);
  return vault;
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "study-vault-"));
});

afterEach(async () => {
  for (const vault of openVaults.splice(0)) vault.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("openVault", () => {
  it("creates the expected vault layout", async () => {
    const vault = await openTrackedVault({ name: "Test Vault" });

    await expect(access(path.join(tempDir, studyDirName))).resolves.toBeUndefined();
    await expect(access(path.join(tempDir, sourcesDirName))).resolves.toBeUndefined();
    await expect(access(path.join(tempDir, assetsDirName))).resolves.toBeUndefined();
    await expect(access(path.join(tempDir, exportsDirName))).resolves.toBeUndefined();
    await expect(access(path.join(tempDir, studyDirName, manifestFileName))).resolves.toBeUndefined();

    for (const fileName of Object.values(entityFileNames)) {
      await expect(access(path.join(tempDir, studyDirName, fileName))).resolves.toBeUndefined();
    }

    for (const fileName of appendLogFileNames) {
      await expect(access(path.join(tempDir, studyDirName, fileName))).resolves.toBeUndefined();
    }

    expect(vault.manifest.name).toBe("Test Vault");
    expect(await vault.stores.sources.list()).toEqual([]);
    expect(await vault.stores.assets.list()).toEqual([]);

    await vault.stores.assets.upsert(fixtureAsset);
    expect(await vault.stores.assets.get(fixtureAsset.id)).toEqual(fixtureAsset);
  });

  it("preserves an existing manifest", async () => {
    const first = await openTrackedVault({ name: "First" });
    const second = await openTrackedVault({ name: "Second" });
    const manifestText = await readFile(path.join(tempDir, studyDirName, manifestFileName), "utf8");

    expect(second.manifest).toEqual(first.manifest);
    expect(vaultManifestSchema.parse(JSON.parse(manifestText))).toEqual(first.manifest);
  });
});

// STORE-SQL Stage-3 (docs/implementation/sqlite-migration-build-spec.md §Stage-3): the DEFAULT
// engine is now SQLite, with a `STORE_ENGINE=jsonl` reversibility switch. Prove BOTH the flip and
// the fallback from the outside — after a write, the default vault materializes a `.db`, while the
// pinned-jsonl vault materializes a `.jsonl` (and no `.db`). resolveDefaultEngine reads the env at
// createEntityStores time, so setting/clearing it around openVault selects the engine.
describe("openVault — default storage engine (STORE-SQL Stage-3 flip + reversibility)", () => {
  const priorEnv = process.env.STORE_ENGINE;
  afterEach(() => {
    if (priorEnv === undefined) delete process.env.STORE_ENGINE;
    else process.env.STORE_ENGINE = priorEnv;
  });

  it("defaults to SQLite: a write materializes a `.db` in the study dir (no jsonl content)", async () => {
    delete process.env.STORE_ENGINE; // unset ⇒ the new default (sqlite)
    const vault = await openTrackedVault();
    await vault.stores.assets.upsert(fixtureAsset);

    const studyDir = path.join(tempDir, studyDirName);
    // The flip proof: a real `.db` exists for the store we wrote to …
    expect(existsSync(path.join(studyDir, "assets.db"))).toBe(true);
    // … and the pre-created `assets.jsonl` (openVault touches an empty file for every entity) stays
    // EMPTY — sqlite never wrote to it, so the row lives only in the `.db`.
    expect((await stat(path.join(studyDir, entityFileNames.assets))).size).toBe(0);
  });

  it("STORE_ENGINE=jsonl reverts to the file engine: the write lands in `.jsonl`, no `.db`", async () => {
    process.env.STORE_ENGINE = "jsonl"; // the reversibility switch
    const vault = await openTrackedVault();
    await vault.stores.assets.upsert(fixtureAsset);

    const studyDir = path.join(tempDir, studyDirName);
    // The fallback proof: the row is in the jsonl file …
    expect((await stat(path.join(studyDir, entityFileNames.assets))).size).toBeGreaterThan(0);
    // … and NO sqlite `.db` was created.
    expect(existsSync(path.join(studyDir, "assets.db"))).toBe(false);
  });
});

