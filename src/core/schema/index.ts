import { z } from "zod";
import { anchorSchema } from "./anchor";
import { assetSchema } from "./asset";
import { conceptSchema } from "./concept";
import { noteSchema } from "./note";
import { patchSchema } from "./patch";
import { relationSchema } from "./relation";
import { sourceSchema } from "./source";
import { studyLayerSchema } from "./study-layer";

export * from "./anchor";
export * from "./asset";
export * from "./common";
export * from "./concept";
export * from "./note";
export * from "./patch";
export * from "./relation";
export * from "./source";
export * from "./study-layer";
export * from "./vault";

export const vaultEntitySchema = z.discriminatedUnion("type", [
  sourceSchema,
  anchorSchema,
  noteSchema,
  patchSchema,
  conceptSchema,
  relationSchema,
  assetSchema,
  studyLayerSchema
]);

export type VaultEntity = z.infer<typeof vaultEntitySchema>;
