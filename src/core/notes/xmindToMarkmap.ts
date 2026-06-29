// xmindToMarkmap — PURE converter from an XMind topic tree to a `markmap` markdown
// outline string. This is Phase 4 item 3 of the adaptive-note-forms plan
// (docs/design/adaptive-note-forms.plan.zh.md §4): a `.xmind` import becomes a
// `markmap` note — NO new contentType, NO new renderer. The existing `markmap`
// type (markdown outline → interactive SVG) renders the result.
//
// Contract (design law §0.5; mirrors classifyContent's purity):
//   • PURE: no zip, no fs, no React, no DOM, no module-level state.
//   • NEVER throws: a malformed/empty input degrades to an empty/partial outline.
//   • Input is the ALREADY-unzipped+parsed map data — either:
//       - the parsed `content.json` value (modern XMind: an array of sheets, each
//         with a `rootTopic`), OR
//       - the raw `content.xml` STRING (legacy XMind: <topic><title>…<children>…).
//     The impure unzip/parse layer (src/server/xmindImport.ts) feeds this function;
//     keeping the parse-to-object step out of here makes the mapping trivially
//     unit-testable for both shapes.
//
// Output: a markmap markdown outline. Depth → markdown level:
//   • A sheet's ROOT topic  → an H1 heading ("# Root").
//   • Depth-1 children      → H2 ("## Child").
//   • Depth ≥2 descendants  → nested bullets ("  - leaf"), indented by 2 spaces per
//     extra level. (Headings only go to H1/H2 so a deep tree stays a clean mind-map
//     outline; markmap renders the nested bullets as the lower branches.)
//
// Multi-sheet behavior (documented decision — simplest sensible): EACH sheet becomes
// its OWN H1 root, concatenated in order with a blank line between. A single-sheet
// file (the common case) yields one rooted outline; a multi-sheet file yields several
// `#` roots in one markmap (markmap supports multiple roots).

// —— the normalized tree the converter walks ————————————————————————————————
// Both content.json and content.xml are normalized to this shape first.
export type XmindTopicNode = {
  title: string;
  children: XmindTopicNode[];
};

/** Collapse whitespace + strip control chars from a topic title (markmap is markdown,
 *  so a title spanning lines would break the outline). Never throws. */
function sanitizeTitle(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/\r\n/g, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// —— content.json normalization ————————————————————————————————————————————
// Modern XMind content.json: a top-level array of sheet objects. Each sheet has a
// `rootTopic`; a topic has a `title` and `children.attached` (an array of child
// topics — there can also be `children.detached`, which we ignore: detached topics
// are floating, not part of the main tree).

function topicFromJson(raw: unknown): XmindTopicNode | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  const title = sanitizeTitle(t.title);
  const children: XmindTopicNode[] = [];
  const kids = t.children;
  if (kids && typeof kids === "object") {
    const attached = (kids as Record<string, unknown>).attached;
    if (Array.isArray(attached)) {
      for (const child of attached) {
        const node = topicFromJson(child);
        if (node) children.push(node);
      }
    }
  }
  // A topic with no title AND no children carries nothing — drop it.
  if (!title && children.length === 0) return null;
  return { title, children };
}

/** Normalize the parsed content.json value → one root topic per sheet. */
function rootsFromJson(parsed: unknown): XmindTopicNode[] {
  const sheets = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  const roots: XmindTopicNode[] = [];
  for (const sheet of sheets) {
    if (!sheet || typeof sheet !== "object") continue;
    const rootTopic = (sheet as Record<string, unknown>).rootTopic;
    const node = topicFromJson(rootTopic);
    if (node) roots.push(node);
  }
  return roots;
}

// —— content.xml normalization (legacy, best-effort, DOM-free) ——————————————
// Legacy XMind content.xml:
//   <xmap-content><sheet><topic><title>Root</title>
//     <children><topics type="attached">
//       <topic><title>Child</title>…</topic>
//     </topics></children>
//   </topic></sheet></xmap-content>
// We parse it with a tiny tag tokenizer (no DOM dependency, so the core stays pure):
// walk the tag stream tracking <topic>/<title>/<topics> nesting. This is best-effort
// (the JSON path is primary); it handles the standard structure above.

type XmlToken =
  | { kind: "open"; name: string; selfClose: boolean }
  | { kind: "close"; name: string }
  | { kind: "text"; text: string };

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&"); // last, so a literal &amp; doesn't double-decode
}

function tokenizeXml(xml: string): XmlToken[] {
  const tokens: XmlToken[] = [];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<([!\/]?)([a-zA-Z][\w.:-]*)([^>]*?)(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const whole = m[0];
    if (whole.startsWith("<!--") || whole.startsWith("<?") || whole.startsWith("<!")) continue;
    if (m[2]) {
      // a tag: m[1] = "" (open) or "/" (close); m[2] = name; m[4] = "/" if self-close
      const name = m[2].toLowerCase();
      if (m[1] === "/") tokens.push({ kind: "close", name });
      else tokens.push({ kind: "open", name, selfClose: m[4] === "/" });
    } else if (m[5] !== undefined) {
      const text = decodeEntities(m[5]);
      if (text.trim() !== "") tokens.push({ kind: "text", text });
    }
  }
  return tokens;
}

// Build the topic tree from the token stream. We track a stack of in-progress
// topics; the FIRST direct <title> text under a <topic> is that topic's title; a
// nested <topic> (inside this topic's <children><topics>) becomes a child.
function rootsFromXml(xml: string): XmindTopicNode[] {
  const tokens = tokenizeXml(xml);
  const roots: XmindTopicNode[] = [];
  const stack: XmindTopicNode[] = [];
  // Track whether we're directly inside a <title> AND whose title it fills.
  let inTitleFor: XmindTopicNode | null = null;

  for (const tok of tokens) {
    if (tok.kind === "open") {
      if (tok.name === "topic") {
        const node: XmindTopicNode = { title: "", children: [] };
        const parent = stack[stack.length - 1];
        if (parent) parent.children.push(node);
        else roots.push(node);
        if (!tok.selfClose) stack.push(node);
      } else if (tok.name === "title") {
        // The title belongs to the nearest enclosing topic.
        inTitleFor = tok.selfClose ? null : stack[stack.length - 1] ?? null;
      }
    } else if (tok.kind === "close") {
      if (tok.name === "topic") stack.pop();
      else if (tok.name === "title") inTitleFor = null;
    } else {
      // text
      if (inTitleFor && !inTitleFor.title) inTitleFor.title = sanitizeTitle(tok.text);
    }
  }

  // Drop empty roots (no title + no children).
  return roots.filter((r) => r.title || r.children.length > 0);
}

// —— outline emission ————————————————————————————————————————————————————————
// depth 0 → "# ", depth 1 → "## "; depth ≥2 → "  "*(depth-2) + "- ".
function emitNode(node: XmindTopicNode, depth: number, out: string[]): void {
  const title = node.title || "(untitled)";
  if (depth === 0) out.push(`# ${title}`);
  else if (depth === 1) out.push(`## ${title}`);
  else out.push(`${"  ".repeat(depth - 2)}- ${title}`);
  for (const child of node.children) emitNode(child, depth + 1, out);
}

function rootsToMarkdown(roots: XmindTopicNode[]): string {
  if (roots.length === 0) return "# (empty mind map)";
  const blocks: string[] = [];
  for (const root of roots) {
    const lines: string[] = [];
    emitNode(root, 0, lines);
    blocks.push(lines.join("\n"));
  }
  // Each sheet is its own H1 root; separate sheets with a blank line.
  return blocks.join("\n\n");
}

// —— public API ——————————————————————————————————————————————————————————————

/** Convert a parsed content.json value (sheet array / single sheet) → markmap markdown. */
export function xmindJsonToMarkmap(parsedJson: unknown): string {
  try {
    return rootsToMarkdown(rootsFromJson(parsedJson));
  } catch {
    return "# (empty mind map)";
  }
}

/** Convert a legacy content.xml string → markmap markdown (best-effort). */
export function xmindXmlToMarkmap(xml: string): string {
  try {
    if (typeof xml !== "string" || xml.trim() === "") return "# (empty mind map)";
    return rootsToMarkdown(rootsFromXml(xml));
  } catch {
    return "# (empty mind map)";
  }
}

/**
 * Convert an already-extracted XMind map to a `markmap` markdown outline.
 * Pass the parsed `content.json` value (preferred) OR the raw `content.xml` string.
 * NEVER throws — bad input degrades to a placeholder "# (empty mind map)".
 */
export function xmindToMarkmap(input: { json?: unknown; xml?: string }): string {
  if (input.json !== undefined && input.json !== null) return xmindJsonToMarkmap(input.json);
  if (typeof input.xml === "string") return xmindXmlToMarkmap(input.xml);
  return "# (empty mind map)";
}
