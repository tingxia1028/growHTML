// resolvePrompt — the single unification point for the kinds of AI operation:
// built-in CODE prompts (KitPrompt.build, 固化), custom TEMPLATE operations (a
// {{var}} template stored as an Operation entity), and — since ACTION-2a — custom
// SIMPLE operations (一句话指令 compiled at run time). All collapse to ONE shape — a
// KitPrompt — so everything downstream of the resolve step (spec lookup, sample,
// generate/validate/retry, the preview/save loop) is reused unchanged.
//
// ACTION-2a (action-v2-auto-context.md §1/§2): the resolver also owns HOW the
// auto-context envelope reaches each prompt kind:
//   • built-in code prompt — the formatted envelope is PREPENDED as a context
//     preamble (an EMPTY envelope returns the built-in verbatim, so envelope-free
//     prompts stay byte-identical — the REV-1 byte-compat stance).
//   • template operation — envelope pieces join the render values ({{doc.title}},
//     {{selection}}, {{learner}}…; runtime/declared values win on a name clash).
//     If the template references NONE of them, the preamble is prepended instead —
//     the model sees context either way.
//   • simple operation — compiled prompt = preamble + instruction (+ the
//     output-form directive when no outputContentType is pinned; the resolved
//     outputType is then the FORM-ROUTER sentinel and generateOperationContent
//     rides the adaptive-note form router).
//
// A built-in KitPrompt keeps its bespoke deterministic mockContent. Data
// operations have NO mockContent, so generateStructuredContent falls back to
// spec.createDefault() (and the auto-form path falls back to the mock provider's
// deterministic first router member).

import type { OperationRecord } from "../core/schema";
import type { SnapshotStore } from "../core/store/snapshotStore";
import {
  autoContextTemplateValues,
  formatAutoContext,
  referencesAutoContext,
  withAutoContextPreamble,
  type AutoContext
} from "../ai/autoContext";
import { FORM_ROUTER_CONTENT_TYPE } from "../ai/mockProvider";
import { extractVariables, renderTemplate } from "../ai/template";
import { INLINE_HTML_INSTRUCTION } from "../core/notes/formRouter";
import { getKitPrompt } from "./prompts";
import type { KitPrompt } from "./types";

// The common shape: a built-in KitPrompt IS already a ResolvedPrompt.
export type ResolvedPrompt = KitPrompt;

// The output-form directive a simple operation with NO pinned outputContentType
// carries: the model both CHOOSES the note form and fills it, returning the
// adaptive-note form-router union (core/notes/formRouter) — the same contract
// generate-block rides, so the routed result flows through resolveForm's
// declared-form default with zero new render paths.
export const SIMPLE_FORM_DIRECTIVE =
  "Return your answer as the note-form router JSON: choose the single most appropriate `form` " +
  "for the content and fill ONLY that member's fields. " +
  INLINE_HTML_INSTRUCTION;

/**
 * Compile a simple-mode operation's prompt: auto-context preamble + the 一句话
 * instruction + (auto output only) the form directive. Pure — the runtime input
 * plays no part; the selection/doc/learner context arrives via the envelope.
 */
export function compileSimpleOperation(op: OperationRecord, preamble: string): string {
  const parts: string[] = [];
  if (preamble) parts.push(preamble);
  parts.push((op.instruction ?? "").trim());
  if (!op.outputContentType) parts.push(SIMPLE_FORM_DIRECTIVE);
  return parts.join("\n\n");
}

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
  store?: SnapshotStore<OperationRecord>,
  autoContext?: AutoContext
): Promise<ResolvedPrompt | undefined> {
  const preamble = formatAutoContext(autoContext);

  const builtin = getKitPrompt(id);
  if (builtin) {
    // Empty envelope → the built-in VERBATIM (byte-compat: prompts with no context
    // to add render exactly as before ACTION-2a — the REV pin tests rely on this).
    if (!preamble) return builtin;
    return { ...builtin, build: (input) => withAutoContextPreamble(preamble, builtin.build(input)) };
  }

  const op = await store?.get(id);
  if (!op) return undefined;

  if (op.mode === "simple") {
    return {
      id: op.id,
      // No pinned output → the form-router sentinel; generateOperationContent
      // routes it through the adaptive-note form router (model picks the form).
      outputType: op.outputContentType ?? FORM_ROUTER_CONTENT_TYPE,
      build: () => compileSimpleOperation(op, preamble)
    };
  }

  const template = op.promptTemplate ?? "";
  // Author placed the context explicitly ({{selection}}/{{doc.*}}/{{learner}})?
  // Then render only; otherwise prepend the preamble so the model sees it anyway.
  const usesEnvelope = referencesAutoContext(extractVariables(template));
  return {
    id: op.id,
    outputType: op.outputContentType ?? "",
    build: (input) => {
      const values = {
        // Envelope pieces sit UNDER the bound values: an explicit runtime/declared
        // value always wins a name clash.
        ...autoContextTemplateValues(autoContext),
        ...bindOperationValues(op, (input ?? {}) as Record<string, unknown>)
      };
      const rendered = renderTemplate(template, values);
      return usesEnvelope ? rendered : withAutoContextPreamble(preamble, rendered);
    }
  };
}
