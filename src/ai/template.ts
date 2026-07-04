// Pure {{var}} template engine for operation-as-data.
//
// IRON RULE: this module imports NOTHING from src/kits or src/core. It is a
// total string -> string utility (it never throws on author input) so it can be
// reused by both the server (resolvePrompt) and the client builder UI without
// dragging in schema/kit/provider concerns.

// A single source of truth for what a placeholder looks like: {{name}} where
// name is a JS-ish identifier, optionally DOTTED ({{doc.title}} — the ACTION-2a
// auto-context namespace). Surrounding whitespace is tolerated so that
// {{ name }} and {{name}} are equivalent. A dotted name is a FLAT key into the
// values record (values["doc.title"]) — the engine never walks nested objects,
// so plain-identifier semantics are byte-identical to before. Anything that is
// not a valid (dotted) identifier inside the braces is left untouched as
// literal text.
const VARIABLE_PATTERN = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*\}\}/g;

/**
 * Returns the DISTINCT variable names referenced by a template, in first-seen
 * order, with surrounding whitespace trimmed ({{ x }} === {{x}}). Brace groups
 * that are not valid identifiers are ignored (left as literal text).
 */
export function extractVariables(template: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  // Reset lastIndex defensively: the regex is module-scoped + global.
  VARIABLE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = VARIABLE_PATTERN.exec(template)) !== null) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

export interface RenderTemplateOptions {
  /** Separator used when a value is an array. Defaults to "\n". */
  arrayJoin?: string;
  /** Produces the replacement for a missing/null/undefined variable. Defaults to "". */
  missing?: (name: string) => string;
}

/**
 * Substitutes every {{name}} placeholder with the matching value:
 *   - string            -> used as-is
 *   - number | boolean  -> String(value)
 *   - array             -> value.map(String).join(opts.arrayJoin ?? "\n")
 *   - null | undefined  -> opts.missing?.(name) ?? "" (also covers absent keys)
 *   - object            -> JSON.stringify(value)
 * Literal text and stray single braces pass through unchanged. Never throws.
 */
export function renderTemplate(
  template: string,
  values: Record<string, unknown>,
  opts?: RenderTemplateOptions
): string {
  const arrayJoin = opts?.arrayJoin ?? "\n";
  const missing = opts?.missing ?? (() => "");
  return template.replace(VARIABLE_PATTERN, (_full, name: string) => {
    const value = values[name];
    if (value === null || value === undefined) {
      return missing(name);
    }
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    if (Array.isArray(value)) {
      return value.map((item) => String(item)).join(arrayJoin);
    }
    if (typeof value === "object") {
      return JSON.stringify(value);
    }
    // bigint / symbol / function fall back to a total String() coercion.
    return String(value);
  });
}
