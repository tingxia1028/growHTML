// Auto-context envelope — the PURE mechanism half of ACTION-2a
// (docs/design/action-v2-auto-context.md §1). Every operation execution gets a
// standard context envelope composed automatically server-side (selection / doc /
// learner). This module owns only the string mechanics: formatting the envelope
// into the capped preamble block, exposing its pieces as template values, and
// recognizing when a template references them. The I/O COMPOSITION (source store,
// memory profile, subject detection) lives in src/server/services/autoContext.ts.
//
// IRON RULE (ai-orchestration.md): this module imports NOTHING from src/kits or
// src/core. It is total — it never throws on any envelope input.
//
// CAP + TRUNCATION PRIORITY: the whole preamble is capped at ~1.5k chars
// (AUTO_CONTEXT_MAX_CHARS). When over budget, sections shrink in this order:
//   1. selection FIRST — quotes are unbounded and the head of a quote carries
//      most of its signal;
//   2. doc SECOND — a single metadata line, rarely long;
//   3. learner LAST — already compact by construction (top 弱项 + streak, a few
//      lines) and the highest personalization value per char.
// A section that cannot keep at least MIN_SECTION_CHARS is dropped entirely
// (sections are omitted-when-empty anyway, so a stub carries no information).

export type AutoContextSelection = {
  /** The passage the user selected/focused (the command's anchorText). */
  quote: string;
  /** Minimal locator info, included only when the request already carried it. */
  anchorId?: string;
  sourceId?: string;
};

export type AutoContextDoc = {
  title?: string;
  sourceType?: string;
  /** Detected subject handle — the detectSubject winner's kit id (M-A: the kit IS the subject). */
  subject?: string;
  /** The resolved foreground kit id (pin > detected > default). */
  kit?: string;
  /** Collection/folder name, when cheaply available (not composed today — future seam). */
  collection?: string;
};

export type AutoContext = {
  selection?: AutoContextSelection;
  doc?: AutoContextDoc;
  learner?: string;
};

/** The ~1.5k-char budget for the whole formatted envelope. */
export const AUTO_CONTEXT_MAX_CHARS = 1500;

/** Below this many chars a truncated section carries nothing — drop it instead. */
const MIN_SECTION_CHARS = 24;

const CONTEXT_HEADER = "[Context]";

/** Total truncation: keep the head and mark the cut with a single "…". */
function truncateTo(text: string, max: number): string {
  if (text.length <= max) return text;
  return max <= 1 ? "" : `${text.slice(0, max - 1)}…`;
}

const trimmed = (value: string | undefined): string => (typeof value === "string" ? value.trim() : "");

function selectionLine(selection: AutoContextSelection): string {
  const locator = [
    trimmed(selection.anchorId) ? `anchor: ${selection.anchorId!.trim()}` : "",
    trimmed(selection.sourceId) ? `source: ${selection.sourceId!.trim()}` : ""
  ]
    .filter(Boolean)
    .join(" · ");
  return `Selection: "${selection.quote.trim()}"${locator ? ` (${locator})` : ""}`;
}

function docParts(doc: AutoContextDoc): string[] {
  const parts: string[] = [];
  if (trimmed(doc.title)) parts.push(doc.title!.trim());
  if (trimmed(doc.sourceType)) parts.push(`type: ${doc.sourceType!.trim()}`);
  if (trimmed(doc.subject)) parts.push(`subject: ${doc.subject!.trim()}`);
  if (trimmed(doc.kit)) parts.push(`kit: ${doc.kit!.trim()}`);
  if (trimmed(doc.collection)) parts.push(`collection: ${doc.collection!.trim()}`);
  return parts;
}

type SectionName = "selection" | "doc" | "learner";
type Section = { name: SectionName; text: string };

/** Truncation priority (see the header comment): selection → doc → learner. */
const TRUNCATION_ORDER: readonly SectionName[] = ["selection", "doc", "learner"];

function buildSections(context: AutoContext | undefined): Section[] {
  const sections: Section[] = [];
  if (!context) return sections;
  if (context.selection && trimmed(context.selection.quote)) {
    sections.push({ name: "selection", text: selectionLine(context.selection) });
  }
  if (context.doc) {
    const parts = docParts(context.doc);
    if (parts.length > 0) sections.push({ name: "doc", text: `Doc: ${parts.join(" · ")}` });
  }
  if (trimmed(context.learner)) {
    sections.push({ name: "learner", text: `Learner:\n${context.learner!.trim()}` });
  }
  return sections;
}

function assemble(sections: Section[]): string {
  return sections.length === 0 ? "" : [CONTEXT_HEADER, ...sections.map((section) => section.text)].join("\n");
}

/**
 * Format the envelope as the context preamble block ("" when every section is
 * empty — the caller then prepends nothing, keeping empty-envelope prompts
 * byte-identical to their pre-envelope form). Capped at `cap` chars with the
 * documented truncation priority (selection first, learner last).
 */
export function formatAutoContext(context?: AutoContext, cap = AUTO_CONTEXT_MAX_CHARS): string {
  const sections = buildSections(context);
  if (sections.length === 0) return "";
  for (const name of TRUNCATION_ORDER) {
    const overflow = assemble(sections).length - cap;
    if (overflow <= 0) break;
    const index = sections.findIndex((section) => section.name === name);
    if (index < 0) continue;
    const section = sections[index];
    const room = section.text.length - overflow;
    if (room < MIN_SECTION_CHARS) {
      // Too small to say anything — drop the whole section (its newline goes too).
      sections.splice(index, 1);
    } else {
      sections[index] = { ...section, text: truncateTo(section.text, room) };
    }
  }
  if (sections.length === 0) return "";
  // Hard guard: the loop accounts exactly, but never hand back more than the cap.
  return truncateTo(assemble(sections), cap);
}

/**
 * The envelope mapped into the template variable namespace: FLAT dotted keys
 * ({{doc.title}} looks up values["doc.title"]) plus whole-section aliases
 * ({{selection}} = the quote, {{doc}} = the metadata line, {{learner}} = the
 * profile block). Only non-empty pieces appear, so a referenced-but-absent piece
 * renders "" through the engine's normal missing rule. The unbounded pieces
 * (selection quote, learner block) are individually capped at the envelope
 * budget so an explicit reference cannot blow the prompt up either.
 */
export function autoContextTemplateValues(context?: AutoContext): Record<string, string> {
  const values: Record<string, string> = {};
  if (!context) return values;
  if (context.selection && trimmed(context.selection.quote)) {
    values["selection"] = truncateTo(context.selection.quote.trim(), AUTO_CONTEXT_MAX_CHARS);
    values["selection.quote"] = values["selection"];
    if (trimmed(context.selection.anchorId)) values["selection.anchorId"] = context.selection.anchorId!.trim();
    if (trimmed(context.selection.sourceId)) values["selection.sourceId"] = context.selection.sourceId!.trim();
  }
  if (context.doc) {
    const parts = docParts(context.doc);
    if (parts.length > 0) values["doc"] = parts.join(" · ");
    if (trimmed(context.doc.title)) values["doc.title"] = context.doc.title!.trim();
    if (trimmed(context.doc.sourceType)) values["doc.sourceType"] = context.doc.sourceType!.trim();
    if (trimmed(context.doc.subject)) values["doc.subject"] = context.doc.subject!.trim();
    if (trimmed(context.doc.kit)) values["doc.kit"] = context.doc.kit!.trim();
    if (trimmed(context.doc.collection)) values["doc.collection"] = context.doc.collection!.trim();
  }
  if (trimmed(context.learner)) {
    values["learner"] = truncateTo(context.learner!.trim(), AUTO_CONTEXT_MAX_CHARS);
  }
  return values;
}

/**
 * Does a template reference any envelope piece explicitly? Used by resolvePrompt
 * to decide between "the author placed the context" (render only) and "the
 * author ignored it" (prepend the preamble so the model sees context either way).
 */
export function referencesAutoContext(names: readonly string[]): boolean {
  return names.some(
    (name) =>
      name === "selection" ||
      name === "doc" ||
      name === "learner" ||
      name.startsWith("selection.") ||
      name.startsWith("doc.")
  );
}

/** Prepend the preamble to a rendered prompt ("" preamble → the prompt verbatim). */
export function withAutoContextPreamble(preamble: string, prompt: string): string {
  return preamble ? `${preamble}\n\n${prompt}` : prompt;
}
