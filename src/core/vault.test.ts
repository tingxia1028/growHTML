import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { entityFileNames } from "./store/entities";
import { assetsDirName, appendLogFileNames, exportsDirName, manifestFileName, openVault, sourcesDirName, studyDirName } from "./vault";
import { vaultManifestSchema } from "./schema";
import { fixtureAsset } from "./fixtures/golden";

let tempDir = "";

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "study-vault-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("openVault", () => {
  it("creates the expected vault layout", async () => {
    const vault = await openVault({ rootDir: tempDir, name: "Test Vault" });

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
    const first = await openVault({ rootDir: tempDir, name: "First" });
    const second = await openVault({ rootDir: tempDir, name: "Second" });
    const manifestText = await readFile(path.join(tempDir, studyDirName, manifestFileName), "utf8");

    expect(second.manifest).toEqual(first.manifest);
    expect(vaultManifestSchema.parse(JSON.parse(manifestText))).toEqual(first.manifest);
  });
});

