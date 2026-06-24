import path from "node:path";
import { createEntityId } from "../ids";
import { sha256Hex } from "../storage/sha256";
import { assertSafeRelativePath } from "../storage/paths";
import { assetSchema, type AssetRecord, type AssetType } from "../schema";
import type { StudyVault } from "../vault";

function assetTypeFromMime(mimeType: string): AssetType {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  return "file";
}

export type ImportLocalAssetInput = {
  mimeType: string;
  durationSec?: number;
  createdAt?: string;
};

/**
 * Import a local file into the vault as an Asset: read the bytes, copy them under
 * `assets/<id><ext>`, and record an AssetRecord. The file is *copied* (not just
 * referenced) so a media note survives the original being moved or deleted.
 *
 * Deduplicates by content hash — importing the same bytes twice reuses the first
 * asset rather than storing a duplicate copy.
 */
export async function importLocalAsset(
  vault: StudyVault,
  absPath: string,
  input: ImportLocalAssetInput
): Promise<AssetRecord> {
  const resolved = path.resolve(absPath);
  const bytes = await vault.storage.readBytes(resolved);
  if (bytes === null) throw new Error(`Asset file not found: ${resolved}`);

  const buffer = Buffer.from(bytes);
  const contentHash = `sha256:${sha256Hex(buffer)}`;

  // Same bytes already imported → reuse it.
  const existing = (await vault.stores.assets.list()).find((asset) => asset.contentHash === contentHash);
  if (existing) return existing;

  const id = createEntityId("asset");
  const ext = path.extname(resolved);
  const fileName = `${id}${ext}`;
  const relativePath = path.posix.join("assets", fileName);
  await vault.storage.writeBytes(path.join(vault.paths.assetsDir, fileName), buffer);

  const now = input.createdAt ?? new Date().toISOString();
  const record = assetSchema.parse({
    id,
    type: "asset",
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: "user",
    assetType: assetTypeFromMime(input.mimeType),
    fileName: path.basename(resolved),
    mimeType: input.mimeType,
    byteSize: buffer.length,
    path: relativePath,
    contentHash,
    originalPath: resolved,
    durationSec: input.durationSec
  });

  await vault.stores.assets.upsert(record);
  return record;
}

function resolveAssetPath(vault: StudyVault, asset: AssetRecord) {
  assertSafeRelativePath(asset.path);
  return path.join(vault.paths.rootDir, asset.path);
}

export async function readAssetBytes(vault: StudyVault, asset: AssetRecord): Promise<Buffer> {
  const bytes = await vault.storage.readBytes(resolveAssetPath(vault, asset));
  if (bytes === null) throw new Error(`Asset bytes not found: ${asset.path}`);
  return Buffer.from(bytes);
}
