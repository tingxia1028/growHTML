import { resolveTextQuote, type TextQuoteSelector } from "../../adapters/web/textQuote";

const TEXT_NODE = 3;

type MappedChar = {
  index: number;
  rawStart: number;
  rawEnd: number;
  span: HTMLElement;
  char: string;
};

type TextLayerMap = {
  text: string;
  chars: MappedChar[];
  nodeStarts: Map<Text, number>;
};

export type PdfTextSelector = TextQuoteSelector;

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ");
}

function normalizeSelector(selector: TextQuoteSelector): TextQuoteSelector {
  return {
    exact: collapseWhitespace(selector.exact).trim(),
    prefix: collapseWhitespace(selector.prefix),
    suffix: collapseWhitespace(selector.suffix)
  };
}

function textNodesUnder(element: Element): Text[] {
  const doc = element.ownerDocument;
  const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    nodes.push(node as Text);
    node = walker.nextNode();
  }
  return nodes;
}

function buildTextLayerMap(textLayer: ParentNode): TextLayerMap {
  const spans = Array.from(textLayer.querySelectorAll("span")) as HTMLElement[];
  const chars: MappedChar[] = [];
  const nodeStarts = new Map<Text, number>();
  let text = "";
  let raw = 0;
  let lastWasSpace = false;

  for (const span of spans) {
    for (const node of textNodesUnder(span)) {
      nodeStarts.set(node, raw);
      const value = node.nodeValue ?? "";
      for (let offset = 0; offset < value.length; offset += 1) {
        const rawStart = raw;
        const rawEnd = raw + 1;
        const char = value[offset];
        if (/\s/.test(char)) {
          if (!lastWasSpace) {
            chars.push({ index: text.length, rawStart, rawEnd, span, char: " " });
            text += " ";
            lastWasSpace = true;
          }
        } else {
          chars.push({ index: text.length, rawStart, rawEnd, span, char });
          text += char;
          lastWasSpace = false;
        }
        raw = rawEnd;
      }
    }
  }

  return { text, chars, nodeStarts };
}

function spansOverRange(map: TextLayerMap, start: number, end: number): HTMLElement[] {
  const spans: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  for (const char of map.chars) {
    if (char.index < start || char.index >= end || !char.char.trim()) continue;
    if (seen.has(char.span)) continue;
    seen.add(char.span);
    spans.push(char.span);
  }
  return spans;
}

function firstMappedText(map: TextLayerMap, node: Node): Text | null {
  if (node.nodeType === TEXT_NODE && map.nodeStarts.has(node as Text)) return node as Text;
  if (!("ownerDocument" in node) || !node.ownerDocument) return null;
  const walker = node.ownerDocument.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    if (map.nodeStarts.has(current as Text)) return current as Text;
    current = walker.nextNode();
  }
  return null;
}

function lastMappedText(map: TextLayerMap, node: Node): Text | null {
  if (node.nodeType === TEXT_NODE && map.nodeStarts.has(node as Text)) return node as Text;
  if (!("ownerDocument" in node) || !node.ownerDocument) return null;
  const walker = node.ownerDocument.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  let last: Text | null = null;
  let current = walker.nextNode();
  while (current) {
    if (map.nodeStarts.has(current as Text)) last = current as Text;
    current = walker.nextNode();
  }
  return last;
}

function textRawStart(map: TextLayerMap, node: Text): number | null {
  return map.nodeStarts.get(node) ?? null;
}

function textRawEnd(map: TextLayerMap, node: Text): number | null {
  const start = textRawStart(map, node);
  return start == null ? null : start + (node.nodeValue?.length ?? 0);
}

function rawBoundary(map: TextLayerMap, container: Node, offset: number): number | null {
  if (container.nodeType === TEXT_NODE) {
    const start = textRawStart(map, container as Text);
    if (start == null) return null;
    const length = container.nodeValue?.length ?? 0;
    return start + Math.max(0, Math.min(offset, length));
  }
  const children = Array.from(container.childNodes ?? []);
  for (let i = offset; i < children.length; i += 1) {
    const text = firstMappedText(map, children[i]);
    const start = text ? textRawStart(map, text) : null;
    if (start != null) return start;
  }
  for (let i = Math.min(offset, children.length) - 1; i >= 0; i -= 1) {
    const text = lastMappedText(map, children[i]);
    const end = text ? textRawEnd(map, text) : null;
    if (end != null) return end;
  }
  return null;
}

export function spansForPdfQuote(textLayer: ParentNode, selector: TextQuoteSelector): HTMLElement[] {
  const normalized = normalizeSelector(selector);
  if (!normalized.exact) return [];
  const map = buildTextLayerMap(textLayer);
  const hit = resolveTextQuote(map.text, normalized);
  return hit ? spansOverRange(map, hit.start, hit.end) : [];
}

export function selectorFromPdfRange(
  textLayer: ParentNode,
  range: Range,
  context = 32
): PdfTextSelector | null {
  const map = buildTextLayerMap(textLayer);
  const rawStart = rawBoundary(map, range.startContainer, range.startOffset);
  const rawEnd = rawBoundary(map, range.endContainer, range.endOffset);
  if (rawStart == null || rawEnd == null || rawEnd <= rawStart) return null;

  const selected = map.chars.filter((char) => char.rawStart >= rawStart && char.rawEnd <= rawEnd);
  if (!selected.length) return null;

  const start = selected[0].index;
  const end = selected[selected.length - 1].index + 1;
  const selectedText = map.text.slice(start, end);
  const leadingTrim = selectedText.length - selectedText.trimStart().length;
  const trailingTrim = selectedText.length - selectedText.trimEnd().length;
  const exactStart = start + leadingTrim;
  const exactEnd = end - trailingTrim;
  const exact = map.text.slice(exactStart, exactEnd);
  if (!exact.trim()) return null;

  return {
    exact,
    prefix: map.text.slice(Math.max(0, exactStart - context), exactStart),
    suffix: map.text.slice(exactEnd, exactEnd + context)
  };
}
