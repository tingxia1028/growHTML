import { createEntityId } from "../../core/ids";
import {
  htmlSelectionAnchorSchema,
  type CreatedBy,
  type HtmlSelectionAnchor,
  type PatchRecord,
  type SourceRecord
} from "../../core/schema";
import { applyHtmlPatch, parseHtmlDocument, serializeHtmlDocument, type HtmlPatchApplyResult } from "./core";

export type HtmlAnchorDraft = {
  sourceId: string;
  studyId: string;
  selector?: string;
  quote: string;
  contextBefore?: string;
  contextAfter?: string;
  createdBy?: CreatedBy;
  createdAt?: string;
};

export type HtmlAnchorResolveResult =
  | {
      ok: true;
      anchor: HtmlSelectionAnchor;
      content: string;
      matchedBy: "studyId" | "selector" | "quote";
      text: string;
    }
  | {
      ok: false;
      anchor: HtmlSelectionAnchor;
      content: string;
      reason: "anchor_not_found";
      message: string;
    };

export type GuardedHtmlPatchResult =
  | (HtmlPatchApplyResult & { conflict?: false })
  | {
      kind: "conflict";
      ok: false;
      conflict: true;
      patchId: string;
      reason: "text_mismatch" | "anchor_not_found";
      message: string;
      content: string;
    };

const dataStudyIdAttribute = "data-study-id";

export function createHtmlSelectionAnchor(draft: HtmlAnchorDraft): HtmlSelectionAnchor {
  const now = draft.createdAt ?? new Date().toISOString();
  const selector = draft.selector ?? `[data-study-id="${cssEscape(draft.studyId)}"]`;

  return htmlSelectionAnchorSchema.parse({
    id: createEntityId("anchor"),
    type: "anchor",
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: draft.createdBy ?? "user",
    sourceId: draft.sourceId,
    anchorKind: "html_selection",
    studyId: draft.studyId,
    selector,
    quote: draft.quote,
    contextBefore: draft.contextBefore ?? "",
    contextAfter: draft.contextAfter ?? ""
  });
}

export function createAnchorFromElement(input: {
  source: SourceRecord;
  elementHtml: string;
  studyId: string;
  selector?: string;
  createdBy?: CreatedBy;
  createdAt?: string;
}): HtmlSelectionAnchor {
  const document = parseHtmlDocument(input.elementHtml);
  const text = normalizeText(document.body?.textContent ?? document.textContent ?? "");

  return createHtmlSelectionAnchor({
    sourceId: input.source.id,
    studyId: input.studyId,
    selector: input.selector,
    quote: text,
    createdBy: input.createdBy,
    createdAt: input.createdAt
  });
}

export function resolveHtmlAnchor(content: string, anchor: HtmlSelectionAnchor): HtmlAnchorResolveResult {
  const document = parseHtmlDocument(content);
  const byStudyId = findByStudyId(document, anchor.studyId);
  if (byStudyId) {
    return createResolveSuccess(anchor, content, byStudyId, "studyId");
  }

  const bySelector = querySelectorSafe(document, anchor.selector);
  if (bySelector) {
    return createResolveSuccess(anchor, content, bySelector, "selector");
  }

  const byQuote = findByQuote(document, anchor.quote);
  if (byQuote) {
    return createResolveSuccess(anchor, content, byQuote, "quote");
  }

  return {
    ok: false,
    anchor,
    content,
    reason: "anchor_not_found",
    message: `Could not resolve HTML anchor ${anchor.id}`
  };
}

export function applyHtmlPatchWithGuard(
  content: string,
  anchor: HtmlSelectionAnchor,
  patch: PatchRecord
): GuardedHtmlPatchResult {
  const resolved = resolveHtmlAnchor(content, anchor);
  if (!resolved.ok) {
    return {
      kind: "conflict",
      ok: false,
      conflict: true,
      patchId: patch.id,
      reason: "anchor_not_found",
      message: resolved.message,
      content
    };
  }

  const expectedText = normalizeText(patch.oldText || anchor.quote);
  if (expectedText && !normalizeText(resolved.text).includes(expectedText)) {
    return {
      kind: "conflict",
      ok: false,
      conflict: true,
      patchId: patch.id,
      reason: "text_mismatch",
      message: `Patch ${patch.id} expected text no longer matches anchor ${anchor.id}`,
      content
    };
  }

  return applyHtmlPatch(content, anchor, patch);
}

function createResolveSuccess(
  anchor: HtmlSelectionAnchor,
  content: string,
  element: Element,
  matchedBy: "studyId" | "selector" | "quote"
): HtmlAnchorResolveResult {
  const text = normalizeText(element.textContent ?? "");
  return {
    ok: true,
    anchor,
    content: serializeHtmlDocument(element.ownerDocument),
    matchedBy,
    text
  };
}

function findByStudyId(document: ReturnType<typeof parseHtmlDocument>, studyId: string) {
  for (const element of Array.from(document.querySelectorAll(`[${dataStudyIdAttribute}]`))) {
    if (element.getAttribute(dataStudyIdAttribute) === studyId) {
      return element;
    }
  }
  return null;
}

function querySelectorSafe(document: ReturnType<typeof parseHtmlDocument>, selector: string) {
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

function findByQuote(document: ReturnType<typeof parseHtmlDocument>, quote: string) {
  const normalizedQuote = normalizeText(quote);
  if (!normalizedQuote) return null;

  let best: Element | null = null;
  for (const element of Array.from(document.querySelectorAll("*"))) {
    const text = normalizeText(element.textContent ?? "");
    if (!text.includes(normalizedQuote)) continue;

    if (!best || text.length < normalizeText(best.textContent ?? "").length) {
      best = element;
    }
  }

  return best;
}

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function cssEscape(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
