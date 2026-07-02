// Assets domain services (X0 shared-core extraction). The byte-serving route keeps
// its HTTP Range parsing + streaming in app.ts (pure transport); this service
// resolves the transport-free part: the asset record, its on-disk path and size.
// import/meta routes stay one-liners over core/the store in app.ts.
import { stat } from "node:fs/promises";
import { assetBytesPath } from "../../core/store/assets";
import type { StudyVault } from "../../core/vault";
import { NotFoundError } from "./errors";

export type AssetsDeps = { vault: StudyVault };

/** Resolve an asset's record + bytes location for serving (404 when unknown). */
export async function getAssetFile({ vault }: AssetsDeps, input: { assetId: string }) {
  const asset = await vault.stores.assets.get(input.assetId);
  if (!asset) throw new NotFoundError("Asset not found");
  const filePath = assetBytesPath(vault, asset);
  const stats = await stat(filePath);
  return { asset, filePath, size: stats.size };
}
