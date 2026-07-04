// htmlInPlace — the PURE DOM logic behind SRC-2b (HTML 所见即改: in-place editing for
// AUTHORED html sources). ZERO deps by decision (2026-07-04): ContentTools is an
// inspiration, not a dependency; GrapesJS stays sealed for SRC-4; TipTap was rejected
// for existing-HTML editing (schema-lossy). Everything here is plain DOM so it unit-
// tests directly in jsdom and the React surface (HtmlInPlaceEditor) stays thin:
//   • detectHtmlShape / prepareEditingDocument / serializeEditingDocument — load the
//     stored html into an editing iframe document (body contenteditable + a marked
//     editing <style>) and serialize it back OUT in the SAME shape it came in
//     (fragment stays a fragment; a full document keeps head/doctype).
//   • sanitizeEditedDom — the "light sanitize" between the edited DOM and the SRC-2
//     save pipeline. BLACKLIST by design (it is the user's OWN document — never
//     destroy their markup): strip editing artifacts (contenteditable, our marked
//     helpers), inline event handlers (on*), javascript:/vbscript: URLs, empty
//     style attrs and attribute-less leftover <span>s. Everything else — including
//     the data-study-id attributes the anchor pipeline stamps at rest — survives.
//   • applyInPlaceStyle — the floating style bar's actions as deterministic DOM
//     transforms (execCommand is dead + untestable in jsdom). Simple output HTML by
//     construction: <b>/<i>, real heading tags, <span style="…"> for size/color,
//     text-align inline style on the block. Every action toggles OFF on re-press.

export type HtmlDocShape = { kind: "document" | "fragment"; hasDoctype: boolean };

/** Attribute marking OUR editing-session helpers (the injected style tag); anything
    carrying it is removed wholesale by the sanitizer. */
export const EDITING_MARKER_ATTR = "data-growhtml-editing";

/** What a blank page starts as, so the caret lands inside a real paragraph. */
const EMPTY_SEED = "<p><br></p>";

/** Minimal editing chrome INSIDE the frame: the whole page is clickable and the
    focused body doesn't grow a focus ring. Removed on serialize (marker attr). */
const EDITING_CSS = "body{min-height:92vh;cursor:text}body:focus{outline:none}";

// —— shape: serialize back OUT the way the source came IN ————————————————————————————

/**
 * Whether the stored source is a full document (<html>…/doctype) or a bare fragment.
 * The editing iframe always hosts a full document (parsers wrap fragments), so the
 * shape decides what serializeEditingDocument returns: body.innerHTML for fragments,
 * the whole documentElement (+ canonical doctype when one was present) for documents.
 */
export function detectHtmlShape(source: string): HtmlDocShape {
  const hasDoctype = /^\s*<!doctype/i.test(source);
  const kind = hasDoctype || /<html[\s>]/i.test(source) ? "document" : "fragment";
  return { kind, hasDoctype };
}

// —— load: stored html → an editable iframe document ————————————————————————————————

/**
 * Replace `doc`'s content with the stored html (or the empty-page seed), then arm it
 * for editing: body[contenteditable] + the marked editing <style>. DOMParser + node
 * import instead of doc.write — deterministic, jsdom-safe, and parsed scripts stay
 * inert (the frame is additionally sandboxed without allow-scripts by the caller).
 */
export function prepareEditingDocument(doc: Document, html: string): void {
  const parsed = new DOMParser().parseFromString(html.trim() ? html : EMPTY_SEED, "text/html");
  const imported = doc.importNode(parsed.documentElement, true);
  if (doc.documentElement) doc.replaceChild(imported, doc.documentElement);
  else doc.appendChild(imported);

  const style = doc.createElement("style");
  style.setAttribute(EDITING_MARKER_ATTR, "");
  style.textContent = EDITING_CSS;
  doc.head.appendChild(style);
  doc.body.setAttribute("contenteditable", "true");
}

// —— sanitize: edited DOM → what the SRC-2 pipeline stores ———————————————————————————

const EVENT_HANDLER_ATTR = /^on/i;
const DANGEROUS_URL = /^\s*(?:javascript|vbscript)\s*:/i;
const URL_ATTRS = new Set(["href", "src", "xlink:href", "action", "formaction"]);

/**
 * Light, in-place blacklist sanitize of an edited tree (call it on a CLONE — see
 * serializeEditingDocument). Strips: our marked editing helpers, contenteditable
 * (the body artifact + anything pasted in), inline event handlers, javascript:/
 * vbscript: URLs, empty style attributes, and <span>s left with no attributes at all
 * (residue of style-bar toggle-offs). User formatting and data-study-id attrs stay.
 */
export function sanitizeEditedDom(root: Element): void {
  for (const helper of Array.from(root.querySelectorAll(`[${EDITING_MARKER_ATTR}]`))) {
    helper.remove();
  }

  const elements = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const el of elements) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name === "contenteditable" || name === EDITING_MARKER_ATTR || EVENT_HANDLER_ATTR.test(name)) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (URL_ATTRS.has(name) && DANGEROUS_URL.test(attr.value)) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (name === "style" && !attr.value.trim()) el.removeAttribute(attr.name);
    }
  }

  // Second pass AFTER attribute stripping: spans that ended up attribute-less are
  // pure residue — unwrap them so the produced HTML stays simple.
  for (const span of Array.from(root.querySelectorAll("span"))) {
    if (span.attributes.length === 0) unwrapElement(span);
  }
}

/**
 * Serialize the editing document back to source text: clone → sanitize → emit in the
 * ORIGINAL shape. The result is what the SRC-2 save pipeline receives (the server
 * then re-stamps study ids over it, preserving the ones that survived).
 */
export function serializeEditingDocument(doc: Document, shape: HtmlDocShape): string {
  const root = doc.documentElement;
  if (!root) return "";
  const clone = root.cloneNode(true) as HTMLElement;
  sanitizeEditedDom(clone);
  if (shape.kind === "fragment") {
    return (clone.querySelector("body")?.innerHTML ?? "").trim();
  }
  const serialized = clone.outerHTML;
  return shape.hasDoctype ? `<!DOCTYPE html>\n${serialized}` : serialized;
}

// —— the style bar's actions ——————————————————————————————————————————————————————————

export type InPlaceStyleAction =
  | { kind: "bold" }
  | { kind: "italic" }
  | { kind: "block"; tag: "h1" | "h2" }
  | { kind: "fontSize"; value: "large" | "small" }
  | { kind: "color"; value: string | null }
  | { kind: "align"; value: "left" | "center" | "right" };

const BLOCK_TAGS = new Set([
  "P", "H1", "H2", "H3", "H4", "H5", "H6", "DIV", "LI", "BLOCKQUOTE", "PRE",
  "SECTION", "ARTICLE", "HEADER", "FOOTER", "TD", "TH"
]);

const FONT_SIZE_CSS: Record<"large" | "small", string> = { large: "1.25em", small: "0.85em" };

/**
 * Apply a style-bar action to the document's CURRENT selection. Returns true when the
 * DOM changed (the caller marks the session dirty). Toggle semantics throughout —
 * a kid can always "un-click": bold on bold unwraps, H1 on an H1 goes back to 正文,
 * the same size/color/alignment pressed again removes itself.
 */
export function applyInPlaceStyle(doc: Document, action: InPlaceStyleAction): boolean {
  switch (action.kind) {
    case "bold":
      return toggleInlineTag(doc, ["B", "STRONG"], "b");
    case "italic":
      return toggleInlineTag(doc, ["I", "EM"], "i");
    case "block":
      return applyBlockTag(doc, action.tag);
    case "fontSize":
      return applyFontSize(doc, action.value);
    case "color":
      return applyColor(doc, action.value);
    case "align":
      return applyAlign(doc, action.value);
  }
}

/** The current selection's range inside the editable body, else null. */
function selectionRange(doc: Document): Range | null {
  const selection = doc.getSelection?.();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!doc.body || !doc.body.contains(range.startContainer)) return null;
  return range;
}

/**
 * The selection's bounding rect in the document's viewport coords (the style bar's
 * anchor). Collapsed carets fall back to the containing element's rect. Null when
 * there is no selection (or rects are unsupported, e.g. bare jsdom).
 */
export function selectionRectInDoc(
  doc: Document
): { top: number; left: number; width: number; height: number; bottom: number } | null {
  const range = selectionRange(doc);
  if (!range) return null;
  let rect: DOMRect | null =
    typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : null;
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    const el = elementFor(range.startContainer);
    rect = el && typeof el.getBoundingClientRect === "function" ? el.getBoundingClientRect() : rect;
  }
  if (!rect) return null;
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height, bottom: rect.bottom };
}

function elementFor(node: Node | null): Element | null {
  if (!node) return null;
  return node.nodeType === 1 ? (node as Element) : node.parentElement;
}

/** Nearest BLOCK ancestor within body (never body itself). */
function closestBlock(node: Node, doc: Document): HTMLElement | null {
  let el = elementFor(node);
  while (el && el !== doc.body && el !== doc.documentElement) {
    if (BLOCK_TAGS.has(el.tagName)) return el as HTMLElement;
    el = el.parentElement;
  }
  return null;
}

/** Nearest INLINE ancestor matching `match`, stopping at body or any block. */
function inlineAncestor(
  node: Node,
  doc: Document,
  match: (el: HTMLElement) => boolean
): HTMLElement | null {
  let el = elementFor(node);
  while (el && el !== doc.body && el !== doc.documentElement && !BLOCK_TAGS.has(el.tagName)) {
    if (match(el as HTMLElement)) return el as HTMLElement;
    el = el.parentElement;
  }
  return null;
}

function unwrapElement(el: Element): void {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
  if (parent.nodeType === 1) (parent as Element).normalize();
}

/** Wrap the range's contents in `wrapper` and reselect them (so a follow-up action —
    e.g. bold then color — still has the selection). */
function wrapRangeWith(doc: Document, range: Range, wrapper: HTMLElement): void {
  wrapper.appendChild(range.extractContents());
  range.insertNode(wrapper);
  const selection = doc.getSelection?.();
  if (selection) {
    selection.removeAllRanges();
    const next = doc.createRange();
    next.selectNodeContents(wrapper);
    selection.addRange(next);
  }
}

/** Drop an empty style attr; unwrap a <span> that lost its last attribute. */
function cleanupStyledElement(el: HTMLElement): void {
  if (!el.style.cssText.trim()) el.removeAttribute("style");
  if (el.tagName === "SPAN" && el.attributes.length === 0) unwrapElement(el);
}

function toggleInlineTag(doc: Document, tags: string[], createTag: string): boolean {
  const range = selectionRange(doc);
  if (!range) return false;
  const existing = inlineAncestor(range.startContainer, doc, (el) => tags.includes(el.tagName));
  if (existing) {
    unwrapElement(existing);
    return true;
  }
  if (range.collapsed) return false;
  wrapRangeWith(doc, range, doc.createElement(createTag));
  return true;
}

function applyBlockTag(doc: Document, tag: "h1" | "h2"): boolean {
  const range = selectionRange(doc);
  if (!range) return false;
  const block = closestBlock(range.startContainer, doc);

  if (!block) {
    // Bare text directly under body — wrap its top-level node in the heading.
    let node: Node | null = range.startContainer;
    while (node && node.parentNode !== doc.body) node = node.parentNode;
    if (!node || node === doc.body) return false;
    const wrapper = doc.createElement(tag);
    doc.body.replaceChild(wrapper, node);
    wrapper.appendChild(node);
    return true;
  }

  // Same tag again toggles back to a plain paragraph (正文).
  const target = block.tagName.toLowerCase() === tag ? "p" : tag;
  if (block.tagName.toLowerCase() === target) return false;
  const next = doc.createElement(target);
  // Attributes ride along — data-study-id in particular keeps surviving anchors bound.
  for (const attr of Array.from(block.attributes)) next.setAttribute(attr.name, attr.value);
  while (block.firstChild) next.appendChild(block.firstChild);
  block.replaceWith(next);
  return true;
}

function applyFontSize(doc: Document, value: "large" | "small"): boolean {
  const range = selectionRange(doc);
  if (!range) return false;
  const css = FONT_SIZE_CSS[value];
  const existing = inlineAncestor(
    range.startContainer,
    doc,
    (el) => el.tagName === "SPAN" && !!el.style.fontSize
  );
  if (existing) {
    if (existing.style.fontSize === css) existing.style.fontSize = ""; // toggle off
    else existing.style.fontSize = css;
    cleanupStyledElement(existing);
    return true;
  }
  if (range.collapsed) return false;
  const span = doc.createElement("span");
  span.style.fontSize = css;
  wrapRangeWith(doc, range, span);
  return true;
}

/** Normalize a CSS color the way THIS document's style engine will store it, so
    toggle-off compares apples to apples ("#d0342c" vs "rgb(208, 52, 44)"). */
function normalizedColor(doc: Document, value: string): string {
  const probe = doc.createElement("span");
  probe.style.color = value;
  return probe.style.color || value;
}

function applyColor(doc: Document, value: string | null): boolean {
  const range = selectionRange(doc);
  if (!range) return false;
  const existing = inlineAncestor(
    range.startContainer,
    doc,
    (el) => el.tagName === "SPAN" && !!el.style.color
  );
  if (value === null) {
    if (!existing) return false;
    existing.style.color = "";
    cleanupStyledElement(existing);
    return true;
  }
  if (existing) {
    if (existing.style.color === normalizedColor(doc, value)) existing.style.color = ""; // toggle off
    else existing.style.color = value;
    cleanupStyledElement(existing);
    return true;
  }
  if (range.collapsed) return false;
  const span = doc.createElement("span");
  span.style.color = value;
  wrapRangeWith(doc, range, span);
  return true;
}

function applyAlign(doc: Document, value: "left" | "center" | "right"): boolean {
  const range = selectionRange(doc);
  if (!range) return false;
  const block = closestBlock(range.startContainer, doc);
  if (!block) return false;
  if (block.style.textAlign === value) block.style.textAlign = ""; // toggle off
  else block.style.textAlign = value;
  if (!block.style.cssText.trim()) block.removeAttribute("style");
  return true;
}
