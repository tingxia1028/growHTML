import { z } from "zod";
import { isoDateTimeSchema, schemaVersion } from "./common";

export const vaultManifestSchema = z.object({
  schemaVersion: z.literal(schemaVersion),
  name: z.string().min(1),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema
});

export type VaultManifest = z.infer<typeof vaultManifestSchema>;

