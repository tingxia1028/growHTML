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
 * Cap on an inline (base64) asset import (V-1, vision-input.md §2). An image attached
 * to a chat rides the wire as base64 and is imported into the vault via
 * `importAssetBytes`; the route enforces this cap BEFORE decoding/writing so a huge
 * paste can't bloat the vault (8 MiB — comfortably above a phone photo, below abuse).
 */
export const MAX_INLINE_IMAGE_BYTES = 8 * 1024 * 1024;

export type ImportAssetBytesInput = {
  /** Raw base64 (no data-URL prefix) of the asset bytes. */
  dataBase64: string;
  mimeType: string;
  /** Optional display name; defaults to `<id><ext-from-mime>`. */
  fileName?: string;
  createdAt?: string;
};

const EXT_BY_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif"
};

/**
 * Import in-memory (base64) bytes into the vault as an Asset — the net-new sibling of
 * importLocalAsset for the chat-image lane (there is no disk path). Replicates the
 * hash-dedup + writeBytes + assetSchema.parse block: same-bytes reuse, a `<id><ext>`
 * file under `assets/`, and a parsed AssetRecord. Iron rule: pure core store code — the
 * route decodes+caps; this persists.
 */
export async function importAssetBytes(vault: StudyVault, input: ImportAssetBytesInput): Promise<AssetRecord> {
  const buffer = Buffer.from(input.dataBase64, "base64");
  const contentHash = `sha256:${sha256Hex(buffer)}`;

  // Same bytes already imported → reuse it (dedup, matching importLocalAsset).
  const existing = (await vault.stores.assets.list()).find((asset) => asset.contentHash === contentHash);
  if (existing) return existing;

  const id = createEntityId("asset");
  const ext = EXT_BY_MIME[input.mimeType] ?? "";
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
    fileName: input.fileName ?? fileName,
    mimeType: input.mimeType,
    byteSize: buffer.length,
    path: relativePath,
    contentHash
  });

  await vault.stores.assets.upsert(record);
  return record;
}

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

/**
 * The absolute on-disk path of an asset's bytes (validated to stay inside the vault).
 * Exposed so the server can STAT + STREAM the file directly (HTTP Range, long-video
 * seeking) instead of buffering the whole thing into memory — the import-time
 * SHA-256 dedup above is unchanged (it still reads the bytes once, at import).
 */
export function assetBytesPath(vault: StudyVault, asset: AssetRecord): string {
  return resolveAssetPath(vault, asset);
}
