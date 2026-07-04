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

// A custom AI action authored as DATA, unified at generate time with the built-in
// code prompts via resolvePrompt(). Two authoring modes (ACTION-2a, action-v2-auto-
// context.md §2):
//   • "template" (the V1 shape, and the default so every existing record parses
//     unchanged): a {{var}} promptTemplate + declaredVariables + a pinned
//     outputContentType.
//   • "simple" (一句话新增): just an `instruction`; the engine compiles the prompt
//     at run time (auto-context preamble + instruction + output-form directive).
//     outputContentType is OPTIONAL — absent means the adaptive-note form router
//     picks the note form (resolveForm's declared-form default rides the routed
//     contentType); the 高级 disclosure may pin one explicitly.
export const operationSchema = recordEnvelopeSchema("operation", operationIdSchema)
  .extend({
    name: z.string().min(1),
    description: z.string().default(""),
    mode: z.enum(["simple", "template"]).default("template"),
    /** simple mode: the 一句话指令 the run-time compiler wraps with auto-context. */
    instruction: z.string().optional(),
    // A note contentType string (validated against the NoteContentSpec registry
    // at generate time, not here, so kit activation stays the source of truth).
    // Required for template mode (refined below); optional = AUTO for simple mode.
    outputContentType: z.string().min(1).optional(),
    promptTemplate: z.string().min(1).optional(),
    declaredVariables: z.array(operationVariableSchema).default([]),
    source: z.enum(["custom", "fork"]).default("custom"),
    forkedFrom: z.string().optional(),
    scope: z.enum(["anchor", "source"]).default("anchor")
  })
  .superRefine((op, ctx) => {
    // Mode-conditional requirements: the fields stay optional in the object shape
    // (so both modes share ONE record type) and the refinement enforces what each
    // mode actually needs. V1 records carry promptTemplate + outputContentType and
    // default to mode "template" — they parse byte-identically to before.
    if (op.mode === "simple" && !(op.instruction ?? "").trim()) {
      ctx.addIssue({ code: "custom", path: ["instruction"], message: "instruction is required for a simple-mode operation" });
    }
    if (op.mode === "template") {
      if (!op.promptTemplate) {
        ctx.addIssue({ code: "custom", path: ["promptTemplate"], message: "promptTemplate is required for a template-mode operation" });
      }
      if (!op.outputContentType) {
        ctx.addIssue({
          code: "custom",
          path: ["outputContentType"],
          message: "outputContentType is required for a template-mode operation"
        });
      }
    }
  });

export type OperationVariable = z.infer<typeof operationVariableSchema>;
export type OperationRecord = z.infer<typeof operationSchema>;
