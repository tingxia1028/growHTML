// resolvePrompt — the single unification point for the two kinds of AI operation:
// built-in CODE prompts (KitPrompt.build, 固化) and custom DATA operations (a
// {{var}} template stored as an Operation entity). Both collapse to ONE shape — a
// KitPrompt — so everything downstream of the resolve step (spec lookup, sample,
// generate/validate/retry, the preview/save loop) is reused unchanged.
//
// A built-in KitPrompt already structurally satisfies the resolved shape, so we
// return it verbatim (its bespoke deterministic mockContent is preserved). A data
// Operation is wrapped into a KitPrompt whose build() renders the template; it has
// NO mockContent, so generateStructuredContent falls back to spec.createDefault().

import type { OperationRecord } from "../core/schema";
import type { SnapshotStore } from "../core/store/snapshotStore";
import { renderTemplate } from "../ai/template";
import { getKitPrompt } from "./prompts";
import type { KitPrompt } from "./types";

// The common shape: a built-in KitPrompt IS already a ResolvedPrompt.
export type ResolvedPrompt = KitPrompt;

// Assemble the values a custom Operation's template renders against. Runtime input
// (gathered from focus/chatContext by the run command) flows through keyed by the
// variable name; `literal` variables always use their declared default; any other
// variable falls back to its default only when the runtime input omitted it.
export function bindOperationValues(
  op: OperationRecord,
  input: Record<string, unknown>
): Record<string, unknown> {
  const values: Record<string, unknown> = { ...input };
  for (const variable of op.declaredVariables) {
    if (variable.source === "literal") {
      values[variable.name] = variable.default ?? "";
    } else if (values[variable.name] === undefined && variable.default !== undefined) {
      values[variable.name] = variable.default;
    }
  }
  return values;
}

// Resolve a promptId to a runnable prompt. Built-ins win (checked first), so a
// stored op can never shadow a built-in; id spaces are disjoint by construction
// (dotted kit ids like `textbook.explain-concept` vs `op_<ULID>`). Returns
// undefined when neither a built-in nor a stored operation matches.
export async function resolvePrompt(
  id: string,
  store?: SnapshotStore<OperationRecord>
): Promise<ResolvedPrompt | undefined> {
  const builtin = getKitPrompt(id);
  if (builtin) return builtin;

  const op = await store?.get(id);
  if (!op) return undefined;

  return {
    id: op.id,
    outputType: op.outputContentType,
    build: (input) =>
      renderTemplate(op.promptTemplate, bindOperationValues(op, (input ?? {}) as Record<string, unknown>))
  };
}
