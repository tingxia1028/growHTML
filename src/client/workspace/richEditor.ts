// richEditor — the PURE DOM logic behind SRC-4 (rich HTML editing + templates for
// AUTHORED html sources). Like htmlInPlace.ts (SRC-2b), this is ZERO-dep plain DOM so
// it unit-tests directly in jsdom and the React surface stays thin.
//
// THE SRC-4 EDITOR VERDICT (2026-07-05, the M-B/KaTeX-style measured decision):
// SRC-4's §4 intent is "rich editing + templates". The three options were weighed by
// bundle + fit:
//   (a) GrapesJS full page-builder — 1.1 MB min JS + 60 KB CSS. It is a DRAG-DROP page
//       BUILDER whose editing model replaces the page with its own component tree and
//       re-serializes through that model — it does NOT preserve arbitrary existing HTML
//       or the data-study-id attributes the anchor pipeline pins losslessly. That breaks
//       SRC-2/2b's core contract (re-project anchors by quote+context over the user's OWN
//       preserved markup). htmlInPlace.ts already records "GrapesJS stays sealed". A
//       drag-drop builder is also the wrong INTERACTION for a kids' study app.
//   (b) TipTap / Lexical — schema-based rich text (~200–400 KB). Schema round-trips are
//       LOSSY over arbitrary study HTML (unknown tags/attrs, study-ids stripped) — already
//       recorded as "TipTap rejected for existing-HTML editing (schema-lossy)".
//   (c) EXTEND SRC-2b + add TEMPLATES — SRC-2b already ships true in-place WYSIWYG
//       (contenteditable + floating style bar, pure-DOM, lossless serialize that keeps
//       study-ids). The genuinely-missing rich pieces are BLOCK INSERTION (headings/
//       lists/quote/callout/divider/table/image beyond the inline style bar) and
//       TEMPLATES (predefined layouts to start from).
// VERDICT: (c). The lightest option that satisfies §4, adds ZERO heavy deps (no multi-MB
// dependency), and preserves the anchor/study-id contract a page-builder would break.
// Rich blocks + templates emit SIMPLE HTML by construction and flow through the SAME
// SRC-2b sanitize → SRC-2 save pipeline (re-hash → re-project anchors → 受影响的锚点).
//
// If a heavy lib were EVER adopted it would have to be a lazy import() chunk (the
// diagrams.ts mermaid / KaTeX pattern). It is NOT — richEditor imports nothing but the
// DOM, so the rich editor is provably absent from the main entry (guard test + build).

// —— block insertion at the caret ——————————————————————————————————————————————————————

/** The rich blocks the SRC-4 block toolbar can drop at the caret. Each maps to SIMPLE,
    predictable HTML (headings, real list elements, a styled callout, an <hr>, a small
    table, an image placeholder) — nothing the sanitizer or the anchor projector chokes on. */
export type RichBlockKind =
  | "heading"
  | "subheading"
  | "paragraph"
  | "bulletList"
  | "numberList"
  | "quote"
  | "callout"
  | "divider"
  | "table"
  | "image";

export type RichBlockLabels = {
  heading: string;
  subheading: string;
  paragraph: string;
  listItem: string;
  quote: string;
  callout: string;
  tableCell: string;
  imageAlt: string;
};

/** The nearest top-level block under body (an insertion anchor), else null. */
function topLevelBlockAt(doc: Document, node: Node | null): Element | null {
  let el: Element | null = node
    ? node.nodeType === 1
      ? (node as Element)
      : node.parentElement
    : null;
  while (el && el.parentElement && el.parentElement !== doc.body) el = el.parentElement;
  return el && el.parentElement === doc.body ? el : null;
}

/** Build the DOM node(s) for a block into a fragment. Kept construction-simple so the
    serialized markup is clean and the anchor projector sees ordinary passages. */
function buildBlock(doc: Document, kind: RichBlockKind, labels: RichBlockLabels): Node {
  switch (kind) {
    case "heading": {
      const h = doc.createElement("h1");
      h.textContent = labels.heading;
      return h;
    }
    case "subheading": {
      const h = doc.createElement("h2");
      h.textContent = labels.subheading;
      return h;
    }
    case "paragraph": {
      const p = doc.createElement("p");
      p.textContent = labels.paragraph;
      return p;
    }
    case "bulletList":
    case "numberList": {
      const list = doc.createElement(kind === "bulletList" ? "ul" : "ol");
      for (let i = 0; i < 3; i += 1) {
        const li = doc.createElement("li");
        li.textContent = labels.listItem;
        list.appendChild(li);
      }
      return list;
    }
    case "quote": {
      const q = doc.createElement("blockquote");
      q.textContent = labels.quote;
      return q;
    }
    case "callout": {
      // A simple styled box — inline style only (no external CSS dependency), so it
      // survives serialize/sanitize and renders the same in the read-mode DomReader.
      const box = doc.createElement("div");
      box.setAttribute(
        "style",
        "padding:12px 14px;border-left:4px solid #2456c9;background:#eef4ff;border-radius:8px;margin:12px 0"
      );
      const p = doc.createElement("p");
      p.style.margin = "0";
      p.textContent = labels.callout;
      box.appendChild(p);
      return box;
    }
    case "divider":
      return doc.createElement("hr");
    case "table": {
      const table = doc.createElement("table");
      table.setAttribute("style", "border-collapse:collapse;width:100%;margin:12px 0");
      // An explicit <tbody> so the live DOM and a re-parse of the serialized HTML agree
      // (the parser injects an implicit tbody otherwise — a spurious serialize diff).
      const tbody = doc.createElement("tbody");
      for (let r = 0; r < 2; r += 1) {
        const tr = doc.createElement("tr");
        for (let c = 0; c < 2; c += 1) {
          const cell = doc.createElement(r === 0 ? "th" : "td");
          cell.setAttribute("style", "border:1px solid #d9d9de;padding:6px 10px;text-align:left");
          cell.textContent = labels.tableCell;
          tr.appendChild(cell);
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      return table;
    }
    case "image": {
      // A neutral placeholder image (data-URI 1×1 so it needs no network); the user
      // swaps src in 源码. No javascript: so the sanitizer keeps it.
      const img = doc.createElement("img");
      img.setAttribute("alt", labels.imageAlt);
      img.setAttribute(
        "src",
        "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='320'%20height='160'%3E%3Crect%20width='320'%20height='160'%20fill='%23eef1f6'/%3E%3C/svg%3E"
      );
      img.setAttribute("style", "max-width:100%;height:auto;border-radius:8px");
      return img;
    }
  }
}

/**
 * Insert a rich block at the document's current selection. The new block lands AFTER the
 * caret's top-level block (or at the end of body when the caret is bare/absent), then the
 * selection is placed inside it so the user is immediately typing in the block. Returns
 * true when the DOM changed (the caller marks the session dirty). Pure DOM — no
 * execCommand, jsdom-testable.
 */
export function insertRichBlock(doc: Document, kind: RichBlockKind, labels: RichBlockLabels): boolean {
  if (!doc.body) return false;
  const node = buildBlock(doc, kind, labels);

  const selection = doc.getSelection?.();
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  const anchorBlock =
    range && doc.body.contains(range.startContainer)
      ? topLevelBlockAt(doc, range.startContainer)
      : null;

  if (anchorBlock && anchorBlock.parentElement === doc.body) {
    anchorBlock.after(node);
  } else {
    doc.body.appendChild(node);
  }

  // Drop the caret into the first editable text of the new block so typing replaces the
  // placeholder (mirrors the markdown toolbar's type-to-replace ergonomics).
  if (node.nodeType === 1) placeCaretInside(doc, node as Element);
  return true;
}

/** Select the first text-bearing descendant of `el` (or its start) so the user types
    straight into the fresh block. Best-effort — a no-op selection API is fine. */
function placeCaretInside(doc: Document, el: Element): void {
  const selection = doc.getSelection?.();
  if (!selection) return;
  const range = doc.createRange();
  const firstText = firstTextNode(el);
  if (firstText) {
    range.selectNodeContents(firstText);
  } else {
    range.selectNodeContents(el);
  }
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function firstTextNode(el: Element): Node | null {
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  return walker.nextNode();
}

// —— templates: predefined layouts to START a page from ————————————————————————————————

/**
 * Apply a template's HTML to the editing document. `mode`:
 *   • "replace" — swap the whole body for the template (starting a blank page from a
 *     layout). Re-arms editing (contenteditable). Used when the page is empty.
 *   • "insert" — drop the template's blocks AFTER the caret's block (adding a section to
 *     an existing page).
 * The template HTML is parsed with DOMParser (scripts stay inert) and only its BODY
 * children are imported — a template is a fragment of study markup, never a whole doc.
 * Returns true when the DOM changed. The result flows through the normal serialize →
 * sanitize → SRC-2 save path like any other edit.
 */
export function applyTemplate(doc: Document, html: string, mode: "replace" | "insert"): boolean {
  if (!doc.body) return false;
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const children = Array.from(parsed.body.childNodes).map((child) => doc.importNode(child, true));
  if (children.length === 0) return false;

  if (mode === "replace") {
    doc.body.replaceChildren(...children);
    doc.body.setAttribute("contenteditable", "true");
    return true;
  }

  const selection = doc.getSelection?.();
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  const anchorBlock =
    range && doc.body.contains(range.startContainer)
      ? topLevelBlockAt(doc, range.startContainer)
      : null;

  if (anchorBlock && anchorBlock.parentElement === doc.body) {
    let cursor: Node = anchorBlock;
    for (const child of children) {
      (cursor as ChildNode).after(child);
      cursor = child;
    }
  } else {
    for (const child of children) doc.body.appendChild(child);
  }
  return true;
}
