import { parseHTML } from "linkedom";
import type { HtmlSelectionAnchor, PatchAction, PatchRecord, PatchStatus } from "../../core/schema";

export const supportedHtmlPatchActions = [
  "replace_selection",
  "insert_before_selection",
  "insert_after_selection",
  "append_to_section",
  "rewrite_section"
] as const satisfies readonly PatchAction[];

export type SupportedHtmlPatchAction = (typeof supportedHtmlPatchActions)[number];

export type HtmlPatchFailureReason = "target_not_found" | "unsupported_action";

export type HtmlPatchApplyResult =
  | {
      kind: "applied";
      ok: true;
      patchId: string;
      action: SupportedHtmlPatchAction;
      content: string;
    }
  | {
      kind: "failed";
      ok: false;
      patchId: string;
      action: PatchAction;
      reason: HtmlPatchFailureReason;
      message: string;
      content: string;
    };

export type HtmlPatchSkippedResult = {
  kind: "skipped";
  ok: true;
  patchId: string;
  action: PatchAction;
  status: Exclude<PatchStatus, "applied">;
  content: string;
};

export type HtmlMaterializePatchResult = HtmlPatchApplyResult | HtmlPatchSkippedResult;

export type HtmlAnchorsById =
  | Readonly<Record<string, HtmlSelectionAnchor | undefined>>
  | ReadonlyMap<string, HtmlSelectionAnchor>;

export type InjectStudyIdsOptions = {
  idPrefix?: string;
  startAt?: number;
};

export type InjectStudyIdsResult = {
  content: string;
  added: number;
  ids: string[];
};

export type MaterializeHtmlResult = {
  content: string;
  results: HtmlMaterializePatchResult[];
};

const dataStudyIdAttribute = "data-study-id";
const defaultStudyIdPrefix = "study";

const meaningfulElementNames = new Set([
  "article",
  "aside",
  "blockquote",
  "caption",
  "code",
  "dd",
  "details",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul"
]);

const standaloneMeaningfulElementNames = new Set(["audio", "canvas", "iframe", "img", "svg", "video"]);

export function parseHtmlDocument(content: string) {
  return parseHTML(content).document;
}

export type HtmlDocument = ReturnType<typeof parseHtmlDocument>;

export function serializeHtmlDocument(document: HtmlDocument) {
  return document.toString();
}

export function injectStudyIds(content: string, options: InjectStudyIdsOptions = {}): InjectStudyIdsResult {
  const document = parseHtmlDocument(content);
  const idPrefix = options.idPrefix?.trim() || defaultStudyIdPrefix;
  let nextIdNumber = options.startAt ?? 1;
  const usedIds = new Set<string>();
  const addedIds: string[] = [];
  const elements = Array.from(document.querySelectorAll("*"));

  for (const element of elements) {
    const existingId = element.getAttribute(dataStudyIdAttribute);
    if (existingId) {
      usedIds.add(existingId);
    }
  }

  for (const element of elements) {
    const existingId = element.getAttribute(dataStudyIdAttribute);
    if (existingId || !isMeaningfulElement(element)) {
      continue;
    }

    const id = nextAvailableStudyId(usedIds, idPrefix, () => nextIdNumber++);
    element.setAttribute(dataStudyIdAttribute, id);
    usedIds.add(id);
    addedIds.push(id);
  }

  return {
    content: serializeHtmlDocument(document),
    added: addedIds.length,
    ids: addedIds
  };
}

export function applyHtmlPatch(
  content: string,
  anchor: HtmlSelectionAnchor,
  patch: PatchRecord
): HtmlPatchApplyResult {
  if (!isSupportedHtmlPatchAction(patch.action)) {
    return createPatchFailure(
      content,
      patch,
      "unsupported_action",
      `Unsupported HTML patch action: ${patch.action}`
    );
  }

  const document = parseHtmlDocument(content);
  const target = findAnchorElement(document, anchor);
  if (!target) {
    return createPatchFailure(
      content,
      patch,
      "target_not_found",
      `Could not find HTML target for anchor ${anchor.id}`
    );
  }

  const changed = applySupportedPatch(document, target, patch.action, patch.newContent);
  if (!changed) {
    return createPatchFailure(
      content,
      patch,
      "target_not_found",
      `Could not apply HTML patch ${patch.id} because the target cannot be edited`
    );
  }

  return {
    kind: "applied",
    ok: true,
    patchId: patch.id,
    action: patch.action,
    content: serializeHtmlDocument(document)
  };
}

export function materializeHtml(
  content: string,
  anchorsById: HtmlAnchorsById,
  patches: readonly PatchRecord[]
): MaterializeHtmlResult {
  let currentContent = content;
  const results: HtmlMaterializePatchResult[] = [];

  for (const patch of patches) {
    if (patch.status !== "applied") {
      results.push({
        kind: "skipped",
        ok: true,
        patchId: patch.id,
        action: patch.action,
        status: patch.status,
        content: currentContent
      });
      continue;
    }

    if (!isSupportedHtmlPatchAction(patch.action)) {
      results.push(
        createPatchFailure(
          currentContent,
          patch,
          "unsupported_action",
          `Unsupported HTML patch action: ${patch.action}`
        )
      );
      continue;
    }

    const anchor = getAnchorById(anchorsById, patch.anchorId);
    if (!anchor) {
      results.push(
        createPatchFailure(
          currentContent,
          patch,
          "target_not_found",
          `Could not find anchor ${patch.anchorId} for HTML patch ${patch.id}`
        )
      );
      continue;
    }

    const result = applyHtmlPatch(currentContent, anchor, patch);
    results.push(result);
    if (result.ok) {
      currentContent = result.content;
    }
  }

  return {
    content: currentContent,
    results
  };
}

export function isSupportedHtmlPatchAction(action: PatchAction): action is SupportedHtmlPatchAction {
  return (supportedHtmlPatchActions as readonly PatchAction[]).includes(action);
}

function isMeaningfulElement(element: Element) {
  const tagName = element.tagName.toLowerCase();
  if (standaloneMeaningfulElementNames.has(tagName)) {
    return true;
  }

  return meaningfulElementNames.has(tagName) && Boolean(element.textContent?.trim());
}

function nextAvailableStudyId(usedIds: ReadonlySet<string>, prefix: string, nextNumber: () => number) {
  let candidate = "";

  do {
    candidate = `${prefix}-${nextNumber()}`;
  } while (usedIds.has(candidate));

  return candidate;
}

function findAnchorElement(document: HtmlDocument, anchor: HtmlSelectionAnchor): Element | null {
  const byStudyId = findByStudyId(document, anchor.studyId);
  if (byStudyId) {
    return byStudyId;
  }

  try {
    return document.querySelector(anchor.selector);
  } catch {
    return null;
  }
}

function findByStudyId(document: HtmlDocument, studyId: string): Element | null {
  for (const element of Array.from(document.querySelectorAll(`[${dataStudyIdAttribute}]`))) {
    if (element.getAttribute(dataStudyIdAttribute) === studyId) {
      return element;
    }
  }

  return null;
}

function applySupportedPatch(
  document: HtmlDocument,
  target: Element,
  action: SupportedHtmlPatchAction,
  newContent: string
) {
  switch (action) {
    case "replace_selection":
      return replaceElement(document, target, newContent);
    case "insert_before_selection":
      return insertSibling(document, target, newContent, "before");
    case "insert_after_selection":
      return insertSibling(document, target, newContent, "after");
    case "append_to_section":
      appendChildren(document, target, newContent);
      return true;
    case "rewrite_section":
      rewriteElement(document, target, newContent);
      return true;
  }
}

function replaceElement(document: HtmlDocument, target: Element, newContent: string) {
  const parent = target.parentNode;
  if (!parent) {
    return false;
  }

  insertNodes(document, parent, target, newContent);
  parent.removeChild(target);
  return true;
}

function insertSibling(
  document: HtmlDocument,
  target: Element,
  newContent: string,
  placement: "before" | "after"
) {
  const parent = target.parentNode;
  if (!parent) {
    return false;
  }

  insertNodes(document, parent, placement === "before" ? target : target.nextSibling, newContent);
  return true;
}

function appendChildren(document: HtmlDocument, target: Element, newContent: string) {
  for (const node of nodesFromHtml(document, newContent)) {
    target.appendChild(node);
  }
}

function rewriteElement(document: HtmlDocument, target: Element, newContent: string) {
  const replacementNodes = nodesFromHtml(document, newContent.trim());
  const replacementElement = getSingleElementNode(replacementNodes);

  if (replacementElement && replacementElement.tagName.toLowerCase() === target.tagName.toLowerCase()) {
    replaceElement(document, target, newContent.trim());
    return;
  }

  target.innerHTML = newContent;
}

function insertNodes(document: HtmlDocument, parent: Node, referenceNode: ChildNode | null, newContent: string) {
  for (const node of nodesFromHtml(document, newContent)) {
    parent.insertBefore(node, referenceNode);
  }
}

function nodesFromHtml(document: HtmlDocument, html: string) {
  const template = document.createElement("template");
  template.innerHTML = html;
  return Array.from(template.content.childNodes);
}

function getSingleElementNode(nodes: readonly ChildNode[]) {
  if (nodes.length !== 1 || nodes[0].nodeType !== 1) {
    return null;
  }

  return nodes[0] as Element;
}

function getAnchorById(anchorsById: HtmlAnchorsById, anchorId: string) {
  const maybeMap = anchorsById as ReadonlyMap<string, HtmlSelectionAnchor>;
  if (typeof maybeMap.get === "function") {
    return maybeMap.get(anchorId);
  }

  return (anchorsById as Readonly<Record<string, HtmlSelectionAnchor | undefined>>)[anchorId];
}

function createPatchFailure(
  content: string,
  patch: PatchRecord,
  reason: HtmlPatchFailureReason,
  message: string
): HtmlPatchApplyResult {
  return {
    kind: "failed",
    ok: false,
    patchId: patch.id,
    action: patch.action,
    reason,
    message,
    content
  };
}
