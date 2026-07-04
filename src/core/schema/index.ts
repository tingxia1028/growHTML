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
export * from "./chatSession";
export * from "./common";
export * from "./concept";
export * from "./memory";
export * from "./note";
export * from "./operation";
export * from "./patch";
export * from "./relation";
export * from "./source";
export * from "./study-layer";
export * from "./trigger";
export * from "./vault";

// NOTE: memoryEventSchema is deliberately NOT in this union (like operationSchema).
// Memory is the most sensitive data in the vault (learner-memory §6) — keeping it
// out of the generic vault-entity shape means no generic entity flow (import/export/
// sharing) can ever pick memory records up by accident.
// chatSessionSchema stays out for the same reason: conversations are private
// (ai-workspace §2.1); the full-vault backup still carries them via entityFileNames.
// triggerSchema stays out too (like operationSchema): a trigger is a behavior-as-data
// definition, not vault content to import/export/share (PRO-1, proactive-learning §1).
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
