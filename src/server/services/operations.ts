// Operations domain services (X0 shared-core extraction): custom AI Operations
// authored as DATA. The bare list/get/delete routes stay one-liners over the store
// in app.ts; these carry envelope assembly + template/variable consistency checks.
import { z } from "zod";
import { extractVariables } from "../../ai/template";
import { createEntityId } from "../../core/ids";
import { operationSchema, operationVariableSchema, type OperationRecord } from "../../core/schema";
import type { StudyVault } from "../../core/vault";
import { NotFoundError, ValidationError } from "./errors";

export type OperationsDeps = { vault: StudyVault };

// A custom AI Operation authored as DATA. POST creates from scratch (or from a
// "复制为我的插件" fork); PATCH merge-updates an existing one. The envelope fields
// (id/type/timestamps) are server-set, so the request shapes carry only the
// editable body. ACTION-2a: `mode` + `instruction` ride through here; the
// mode-conditional requirements (simple ⇒ instruction, template ⇒ promptTemplate
// + outputContentType) are enforced ONCE by operationSchema's refinement — zod
// stays the single source, so the request shapes keep the fields optional.
export const createOperationRequestSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  mode: z.enum(["simple", "template"]).default("template"),
  instruction: z.string().optional(),
  outputContentType: z.string().min(1).optional(),
  promptTemplate: z.string().min(1).optional(),
  declaredVariables: z.array(operationVariableSchema).default([]),
  source: z.enum(["custom", "fork"]).default("custom"),
  forkedFrom: z.string().optional(),
  scope: z.enum(["anchor", "source"]).default("anchor")
});
export type CreateOperationInput = z.infer<typeof createOperationRequestSchema>;

export const updateOperationRequestSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    mode: z.enum(["simple", "template"]).optional(),
    instruction: z.string().optional(),
    outputContentType: z.string().min(1).optional(),
    promptTemplate: z.string().min(1).optional(),
    declaredVariables: z.array(operationVariableSchema).optional(),
    source: z.enum(["custom", "fork"]).optional(),
    forkedFrom: z.string().optional(),
    scope: z.enum(["anchor", "source"]).optional()
  })
  .refine((input) => Object.keys(input).length > 0, { message: "operation update requires at least one field" });
export type UpdateOperationInput = z.infer<typeof updateOperationRequestSchema>;

export async function createOperation(
  { vault }: OperationsDeps,
  input: CreateOperationInput
): Promise<OperationRecord> {
  // The template/variable consistency check only applies to template mode — a
  // simple op has no template (its prompt compiles at run time).
  const consistency =
    input.mode === "template" ? operationConsistencyError(input.promptTemplate ?? "", input.declaredVariables) : null;
  if (consistency) throw new ValidationError(consistency);
  const now = new Date().toISOString();
  const operation = operationSchema.parse({
    id: createEntityId("operation"),
    type: "operation",
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: "user",
    ...input
  });
  await vault.stores.operations.upsert(operation);
  return operation;
}

export async function updateOperation(
  { vault }: OperationsDeps,
  input: { operationId: string } & UpdateOperationInput
): Promise<OperationRecord> {
  const { operationId, ...patch } = input;
  const existing = await vault.stores.operations.get(operationId);
  if (!existing) throw new NotFoundError("Operation not found");
  const merged = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  const consistency =
    merged.mode === "template" ? operationConsistencyError(merged.promptTemplate ?? "", merged.declaredVariables) : null;
  if (consistency) throw new ValidationError(consistency);
  const operation = operationSchema.parse(merged);
  await vault.stores.operations.upsert(operation);
  return operation;
}

// Consistency between a custom Operation's template and its declared variables.
// Orphan placeholders (in the template but not declared) are SOFT-allowed — they
// simply render "" at run time, so the engine stays total. The one hard error: a
// `literal` variable marked required with no default can never produce a value
// (literals always use their default), so block it. Returns null when consistent.
function operationConsistencyError(
  promptTemplate: string,
  declaredVariables: z.infer<typeof operationVariableSchema>[]
): string | null {
  // Orphan placeholders (referenced but not declared) are soft-allowed: they render
  // "" at run time. A REQUIRED variable that the template never references, however,
  // can never be injected — flag that as an authoring mistake.
  const referenced = new Set(extractVariables(promptTemplate));
  for (const variable of declaredVariables) {
    if (variable.required && variable.source === "literal" && !(variable.default && variable.default.trim())) {
      return `Required literal variable "${variable.name}" needs a default value`;
    }
    if (variable.required && !referenced.has(variable.name)) {
      return `Required variable "${variable.name}" is not used in the template`;
    }
  }
  return null;
}
