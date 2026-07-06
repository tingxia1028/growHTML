// PLAT-LAYER Part-4 §4.4 acceptance test — the OBSERVABLE proof that the portable store graph no
// longer imports `node:path`. It opens a full vault entirely on the in-memory MemoryStorageAdapter
// (the mobile/virtual-fs shape) with a POSIX logical root and asserts every composed path is a pure
// `/`-string. jsonlEngine is injected explicitly (Fork-1) so NO sqlite/native edge is exercised —
// this is purely about the StorageAdapter seam + the pure joinPath composer.
//
// The load-bearing assertion is `vault.paths.studyDir === "/study/.study"`: before Part-4b, the old
// `node:path.join` would have produced `\study\.study` on Windows (backslash separators) — the fact
// that it is now a clean POSIX `/`-path is the direct, empirical proof node:path is gone from core.

import { describe, expect, it } from "vitest";
import { jsonlEngine } from "./store/jsonlEngine";
import { MemoryStorageAdapter } from "./storage/memoryStorage";
import { ingestHtmlSource, readSourceContent } from "./store/sources";
import { importAssetBytes, readAssetBytes } from "./store/assets";
import { openVault } from "./vault";

describe("openVault on a MemoryStorageAdapter with a POSIX logical root (Part-4 §4.4)", () => {
  it("composes every vault path as a pure POSIX /-string (node:path is gone)", async () => {
    const storage = new MemoryStorageAdapter();
    const vault = await openVault({ rootDir: "/study", name: "Mobile", storage, engine: jsonlEngine });

    // THE proof: the logical study dir is a clean POSIX join, not `\study\.study`.
    expect(vault.paths.studyDir).toBe("/study/.study");
    // The rest of the composed path set is likewise pure `/`-strings.
    expect(vault.paths.rootDir).toBe("/study");
    expect(vault.paths.sourcesDir).toBe("/study/sources");
    expect(vault.paths.assetsDir).toBe("/study/assets");
    expect(vault.paths.exportsDir).toBe("/study/exports");
    expect(vault.paths.manifestPath).toBe("/study/.study/manifest.json");
    expect(vault.paths.pluginSettingsPath).toBe("/study/.study/plugin-settings.json");
  });

  it("builds the dirs, manifest, and stores on the Map adapter", async () => {
    const storage = new MemoryStorageAdapter();
    const vault = await openVault({ rootDir: "/study", name: "Mobile", storage, engine: jsonlEngine });

    expect(vault.storage).toBe(storage);
    expect(vault.manifest.name).toBe("Mobile");
    // The manifest is persisted under the pure logical path.
    expect(await storage.readText("/study/.study/manifest.json")).toContain("\"name\": \"Mobile\"");
    // Every entity store exists and lists empty on a fresh vault.
    expect(await vault.stores.sources.list()).toEqual([]);
    expect(await vault.stores.assets.list()).toEqual([]);
  });

  it("round-trips a source (exercises sources.ts joinPath composition)", async () => {
    const storage = new MemoryStorageAdapter();
    const vault = await openVault({ rootDir: "/study", name: "Mobile", storage, engine: jsonlEngine });

    const body = "<p>portable core</p>";
    const source = await ingestHtmlSource(vault, { title: "Render Thread", content: body });

    // The stored relative path is a POSIX `sources/…` key, and the content reads back byte-identically.
    expect(source.path.startsWith("sources/")).toBe(true);
    expect(await readSourceContent(vault, source)).toBe(body);
    expect((await vault.stores.sources.get(source.id))?.title).toBe("Render Thread");
  });

  it("round-trips importAssetBytes (exercises assets.ts joinPath — NOT importLocalAsset)", async () => {
    const storage = new MemoryStorageAdapter();
    const vault = await openVault({ rootDir: "/study", name: "Mobile", storage, engine: jsonlEngine });

    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const asset = await importAssetBytes(vault, {
      dataBase64: pngBytes.toString("base64"),
      mimeType: "image/png"
    });

    // The asset is stored under a POSIX `assets/…` key and reads back byte-identically.
    expect(asset.path).toBe(`assets/${asset.id}.png`);
    expect((await readAssetBytes(vault, asset)).equals(pngBytes)).toBe(true);
    // The bytes landed at the pure logical asset path on the Map adapter.
    expect(await storage.readBytes(`/study/assets/${asset.id}.png`)).not.toBeNull();
  });
});
