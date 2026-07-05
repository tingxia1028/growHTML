// V-1 (vision-input.md §2) — importAssetBytes: the net-new base64→Asset lane for the
// chat-image seam (importLocalAsset's sibling, no disk path). Locks the load-bearing
// bits: bytes persist under assets/, the AssetRecord parses, mime→assetType maps, and
// re-importing the same bytes dedups by content hash (matching importLocalAsset).

import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openVault, type StudyVault } from "../vault";
import { importAssetBytes, MAX_INLINE_IMAGE_BYTES, readAssetBytes } from "./assets";

let tempDir = "";
let vault: StudyVault;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "study-vault-assets-"));
  vault = await openVault({ rootDir: tempDir });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("importAssetBytes (V-1)", () => {
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

  it("persists the bytes under assets/ and records a parsed AssetRecord", async () => {
    const record = await importAssetBytes(vault, { dataBase64: pngBytes.toString("base64"), mimeType: "image/png" });
    expect(record.id).toMatch(/^asset_/);
    expect(record.assetType).toBe("image");
    expect(record.mimeType).toBe("image/png");
    expect(record.byteSize).toBe(pngBytes.length);
    expect(record.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(record.path).toBe(`assets/${record.id}.png`);

    // The bytes are on disk under the vault and readable back byte-identically.
    const onDisk = await readFile(path.join(vault.paths.rootDir, record.path));
    expect(onDisk.equals(pngBytes)).toBe(true);
    expect((await readAssetBytes(vault, record)).equals(pngBytes)).toBe(true);
  });

  it("dedups the SAME bytes to one asset (content-hash reuse)", async () => {
    const a = await importAssetBytes(vault, { dataBase64: pngBytes.toString("base64"), mimeType: "image/png" });
    const b = await importAssetBytes(vault, { dataBase64: pngBytes.toString("base64"), mimeType: "image/png" });
    expect(b.id).toBe(a.id);
    expect((await vault.stores.assets.list()).length).toBe(1);
  });

  it("maps mimeType → assetType and picks a sane extension", async () => {
    const jpg = await importAssetBytes(vault, { dataBase64: Buffer.from([1, 2]).toString("base64"), mimeType: "image/jpeg" });
    expect(jpg.assetType).toBe("image");
    expect(jpg.path.endsWith(".jpg")).toBe(true);
  });

  it("exposes an 8 MiB inline cap constant for the route to enforce", () => {
    expect(MAX_INLINE_IMAGE_BYTES).toBe(8 * 1024 * 1024);
  });
});
