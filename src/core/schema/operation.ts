import { z } from "zod";
import { operationIdSchema, recordEnvelopeSchema } from "./common";

// A declared variable a custom Operation pulls in at run time. `source` says
// WHERE the value comes from when the run command gathers it from focus /
// chatContext; "literal" uses the `default` verbatim.
export const operationVariableSchema = z.object({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Expected a {{var}}-safe identifier"),
  label: z.string().optional(),
  source: z.enum(["anchorText", "sourceTitle", "existingNotes", "literal"]),
  default: z.string().optional(),
  required: z.boolean().default(false)
});

// A custom AI action authored as DATA (template + declared variables), unified
// at generate time with the built-in code prompts via resolvePrompt().
export const operationSchema = recordEnvelopeSchema("operation", operationIdSchema).extend({
  name: z.string().min(1),
  description: z.string().default(""),
  // A note contentType string (validated against the NoteContentSpec registry
  // at generate time, not here, so kit activation stays the source of truth).
  outputContentType: z.string().min(1),
  promptTemplate: z.string().min(1),
  declaredVariables: z.array(operationVariableSchema).default([]),
  source: z.enum(["custom", "fork"]).default("custom"),
  forkedFrom: z.string().optional(),
  scope: z.enum(["anchor", "source"]).default("anchor")
});

export type OperationVariable = z.infer<typeof operationVariableSchema>;
export type OperationRecord = z.infer<typeof operationSchema>;
