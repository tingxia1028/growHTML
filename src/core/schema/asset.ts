import { z } from "zod";
import { assetIdSchema, recordEnvelopeSchema } from "./common";

export const assetTypeSchema = z.enum(["image", "audio", "video", "file"]);

// An Asset is a binary/media blob imported into the vault (copied under
// `assets/`), referenced by media notes via `Note.assetRefs` / `content.assetId`.
// Importing copies the file into the vault so the note survives if the original
// is moved or deleted — see importLocalAsset.
export const assetSchema = recordEnvelopeSchema("asset", assetIdSchema).extend({
  assetType: assetTypeSchema,
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  byteSize: z.number().int().nonnegative(),
  // Vault-relative path, e.g. "assets/asset_<ulid>.mp4".
  path: z.string().min(1),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  // Where it was imported from (recorded only; not used for re-reading).
  originalPath: z.string().optional(),
  // Audio/video only.
  durationSec: z.number().nonnegative().optional()
});

export type AssetType = z.infer<typeof assetTypeSchema>;
export type AssetRecord = z.infer<typeof assetSchema>;
