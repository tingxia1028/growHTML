// NoteContentRenderer — turns a note's `content` (interpreted per `contentType`)
// into a sanitized HTML string for display. Pure + dependency-free so it is
// unit-testable without a DOM and safe to feed into `dangerouslySetInnerHTML`.
//
// Tiers (see docs): A = markdown (prose), B = structured data (mindmap, flashcard).
// Tier C (sandboxed artifact iframes) and heavy diagram libs (mermaid/markmap)
// are deliberately out of scope here and will register as additional renderers.

export type RenderedNote = {
  contentType: string;
  html: string;
  error?: string;
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Only allow links we can vouch for; everything else renders as inert text.
function safeHref(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/") || trimmed.startsWith("#")) return trimmed;
  return null;
}

// Inline markdown on already-HTML-escaped text. Because the input is escaped
// first, the only tags that can appear are the ones we introduce here.
function renderInline(escaped: string): string {
  let out = escaped.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
    const href = safeHref(url);
    return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${text}</a>` : match;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, (_m, t) => `<strong>${t}</strong>`);
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, (_m, lead, t) => `${lead}<em>${t}</em>`);
  out = out.replace(/(^|[^_])_([^_]+)_/g, (_m, lead, t) => `${lead}<em>${t}</em>`);
  return out;
}

function renderMarkdown(content: string): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let ulItems: string[] = [];
  let olItems: string[] = [];
  let quoteLines: string[] = [];
  let codeLines: string[] | null = null; // non-null while inside a ``` fence

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push(`<p>${renderInline(escapeHtml(paragraph.join(" ")))}</p>`);
      paragraph = [];
    }
  };
  const flushUl = () => {
    if (ulItems.length) {
      blocks.push(`<ul>${ulItems.map((item) => `<li>${renderInline(escapeHtml(item))}</li>`).join("")}</ul>`);
      ulItems = [];
    }
  };
  const flushOl = () => {
    if (olItems.length) {
      blocks.push(`<ol>${olItems.map((item) => `<li>${renderInline(escapeHtml(item))}</li>`).join("")}</ol>`);
      olItems = [];
    }
  };
  const flushQuote = () => {
    if (quoteLines.length) {
      blocks.push(`<blockquote>${renderInline(escapeHtml(quoteLines.join(" ")))}</blockquote>`);
      quoteLines = [];
    }
  };
  const flushBlocks = () => {
    flushParagraph();
    flushUl();
    flushOl();
    flushQuote();
  };

  for (const line of lines) {
    // Fenced code block: ``` toggles a verbatim, escaped <pre><code> block.
    if (/^\s*```/.test(line)) {
      if (codeLines) {
        blocks.push(`<pre class="sv-code"><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = null;
      } else {
        flushBlocks();
        codeLines = [];
      }
      continue;
    }
    if (codeLines) {
      codeLines.push(line);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const hr = /^\s*([-*_])\1{2,}\s*$/.test(line);
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const quote = /^\s*>\s?(.*)$/.exec(line);

    if (heading) {
      flushBlocks();
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInline(escapeHtml(heading[2].trim()))}</h${level}>`);
    } else if (hr) {
      flushBlocks();
      blocks.push("<hr>");
    } else if (ul) {
      flushParagraph();
      flushOl();
      flushQuote();
      ulItems.push(ul[1].trim());
    } else if (ol) {
      flushParagraph();
      flushUl();
      flushQuote();
      olItems.push(ol[1].trim());
    } else if (quote) {
      flushParagraph();
      flushUl();
      flushOl();
      quoteLines.push(quote[1]);
    } else if (line.trim() === "") {
      flushBlocks();
    } else {
      flushUl();
      flushOl();
      flushQuote();
      paragraph.push(line.trim());
    }
  }
  if (codeLines) blocks.push(`<pre class="sv-code"><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  flushBlocks();
  return blocks.join("");
}

type MindmapNode = { title?: string; text?: string; children?: MindmapNode[] };

function renderMindmapNode(node: MindmapNode): string {
  const label = escapeHtml(String(node.title ?? node.text ?? ""));
  const children = Array.isArray(node.children) ? node.children : [];
  const childHtml = children.length
    ? `<ul>${children.map((child) => renderMindmapNode(child)).join("")}</ul>`
    : "";
  return `<li><span class="sv-node">${label}</span>${childHtml}</li>`;
}

function renderMindmap(content: string): string {
  const root = JSON.parse(content) as MindmapNode;
  return `<div class="sv-mindmap"><ul>${renderMindmapNode(root)}</ul></div>`;
}

function renderFlashcard(content: string): string {
  const card = JSON.parse(content) as { front?: string; back?: string };
  const front = escapeHtml(String(card.front ?? ""));
  const back = escapeHtml(String(card.back ?? ""));
  return `<div class="sv-flashcard"><details><summary>${front}</summary><div class="sv-flashcard-back">${back}</div></details></div>`;
}

export type NoteRenderer = (content: string) => string;

// Extensible registry: plugins add contentType → renderer entries here.
export const noteRenderers: Record<string, NoteRenderer> = {
  markdown: renderMarkdown,
  mindmap: renderMindmap,
  flashcard: renderFlashcard
};

export function renderNoteContent(contentType: string | undefined, content: string): RenderedNote {
  const type = contentType || "markdown";
  const renderer = noteRenderers[type];
  if (!renderer) {
    // Unknown types render as inert, escaped plain text (never raw HTML).
    return { contentType: type, html: `<pre class="sv-plain">${escapeHtml(content)}</pre>` };
  }
  try {
    return { contentType: type, html: renderer(content) };
  } catch (error) {
    return {
      contentType: type,
      html: `<pre class="sv-plain">${escapeHtml(content)}</pre>`,
      error: error instanceof Error ? error.message : "render error"
    };
  }
}
