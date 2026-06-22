import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import grapesjs, { type Component, type Editor } from "grapesjs";
import { BookOpenText, FilePenLine, Highlighter, NotebookPen, Sparkles } from "lucide-react";
import type {
  AiProposal,
  AiProposalRequest,
  AiProposalResponse,
  AiProvider,
  DocumentPayload,
  FolderCachePayload,
  FolderPagePayload,
  GenerateDocumentRequest,
  GenerateDocumentResponse,
  ImportExternalRequest,
  ImportExternalResponse,
  PageShell,
  SaveDocumentRequest,
  SelectionPayload,
  ThreadEntry
} from "../shared/types";

type Status = "idle" | "loading" | "saving" | "applying" | "thinking" | "ready" | "error";

const DEFAULT_AGENT_PANEL_WIDTH = 360;
const MIN_AGENT_PANEL_WIDTH = 300;
const MAX_AGENT_PANEL_WIDTH = 760;
const AGENT_PANEL_WIDTH_STORAGE_KEY = "growhtml-agent-panel-width";
const GROWHTML_CLIPBOARD_TYPE = "application/x-growhtml-selection";
const GROWHTML_CLIPBOARD_PREFIX = "growhtml-selection:";
const LIGHT_CONTEXT_AROUND_SELECTION_CHARS = 3600;
const LIGHT_CONTEXT_MAX_HTML_CHARS = 14000;
const LIGHT_CONTEXT_MAX_CSS_CHARS = 7000;

type PendingChatTurn = {
  id: string;
  provider: AiProvider;
  instruction: string;
  selectionLabel: string;
  createdAt: string;
};

type ProposalPreviewDraft = {
  id: string;
  html: string;
  css: string;
  shell: PageShell;
  preserveScroll: boolean;
  selection: SelectionPayload;
  instruction: string;
  replacementHtml: string;
};

type SelectionAction = {
  id: "annotate" | "explain" | "source" | "rewrite" | "note";
  label: string;
  title: string;
  instruction: string;
  icon: typeof Highlighter;
};

type SelectionActionConfig = Omit<SelectionAction, "icon">;

type FolderCandidate = {
  path: string;
  file?: File;
  page?: FolderPagePayload;
};

type WritableFileLike = {
  write(data: Blob | string): Promise<void>;
  close(): Promise<void>;
};

type FileSystemFileHandleLike = {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<WritableFileLike>;
};

type FileSystemDirectoryHandleLike = {
  kind: "directory";
  name: string;
  entries(): AsyncIterable<[string, FileSystemHandleLike]>;
};

type FileSystemHandleLike = FileSystemFileHandleLike | FileSystemDirectoryHandleLike;

type BrowserFile = File & {
  relativePath?: string;
  webkitRelativePath?: string;
};

type ScrollSnapshot = {
  top: number;
  ratio: number;
  outerTop: number;
  outerRatio: number;
};

type PanelTheme = {
  background: string;
  color: string;
  fontFamily: string;
  accent: string;
  card: string;
};

const DEFAULT_SHELL: PageShell = {
  title: "GrowHTML Document",
  htmlAttrs: { lang: "zh-CN" },
  bodyAttrs: {},
  headHtml: ""
};

const DEFAULT_PANEL_THEME: PanelTheme = {
  background: "#f8f9f6",
  color: "#24272b",
  fontFamily: 'Inter, "Segoe UI", Arial, sans-serif',
  accent: "#3f5f52",
  card: "#ffffff"
};

const GROWHTML_ANNOTATION_CSS = `
/* GrowHTML knowledge annotations */
.growhtml-annotation {
  position: relative;
  display: inline;
  cursor: help;
  border-bottom: 1px dotted currentColor;
  background: color-mix(in srgb, #f7c948 22%, transparent);
}

.growhtml-annotation-popover {
  position: absolute;
  z-index: 40;
  left: 0;
  bottom: calc(100% + 8px);
  width: min(360px, 80vw);
  max-width: 80vw;
  padding: 10px 12px;
  border: 1px solid rgba(148, 163, 184, 0.34);
  border-radius: 8px;
  color: #f8fafc;
  font-size: 0.9em;
  line-height: 1.55;
  white-space: normal;
  background: #111827;
  box-shadow: 0 16px 38px rgba(15, 23, 42, 0.28);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transform: translateY(4px);
  transition: opacity 120ms ease, transform 120ms ease, visibility 120ms ease;
}

.growhtml-annotation:hover .growhtml-annotation-popover,
.growhtml-annotation:focus .growhtml-annotation-popover,
.growhtml-annotation:focus-within .growhtml-annotation-popover {
  opacity: 1;
  visibility: visible;
  transform: translateY(0);
}
`;

const PREVIEW_RUNTIME_CSS = `
html {
  height: 100%;
  overflow-y: auto;
}

body {
  min-height: 100%;
}

[data-growhtml-preview-selected] {
  outline: 2px solid #2388ff !important;
  outline-offset: 3px !important;
}

[data-growhtml-preview-change] {
  outline: 2px solid #22c55e !important;
  outline-offset: 4px !important;
}

.growhtml-preview-action-toolbar {
  position: absolute;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px;
  border: 1px solid rgba(15, 23, 42, 0.16);
  border-radius: 10px;
  background: rgba(248, 250, 252, 0.96);
  box-shadow: 0 14px 34px rgba(15, 23, 42, 0.22);
  backdrop-filter: blur(10px);
}

.growhtml-preview-action-toolbar button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid rgba(148, 163, 184, 0.55);
  border-radius: 8px;
  color: #0f172a;
  font: 700 16px/1 Inter, "Segoe UI", Arial, sans-serif;
  background: #ffffff;
  cursor: pointer;
}

.growhtml-preview-action-toolbar button:hover,
.growhtml-preview-action-toolbar button:focus-visible {
  color: #ffffff;
  border-color: #2388ff;
  background: #2388ff;
  outline: none;
}

.growhtml-preview-action-toolbar button[data-growhtml-preview-action="apply"] {
  color: #ffffff;
  border-color: #16a34a;
  background: #16a34a;
}

.growhtml-preview-action-toolbar button[data-growhtml-preview-action="reject"] {
  color: #ffffff;
  border-color: #dc2626;
  background: #dc2626;
}
`;

const PREVIEW_ASSOCIABLE_SELECTOR = [
  "[data-ai-id]",
  "main",
  "article",
  "section",
  "aside",
  "header",
  "footer",
  "nav",
  "figure",
  "table",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "canvas",
  "svg",
  "div"
].join(",");

const SELECTION_ACTIONS: SelectionAction[] = ([
  {
    id: "annotate",
    label: "标注",
    title: "搜索并做成悬浮知识标注",
    instruction: "请搜索选中内容的背景知识，并把结果做成鼠标悬浮可见的知识标注。保留原句，只在 popover 中放简短解释和必要来源。请返回可直接替换选中内容的 HTML。使用 growhtml-annotation 结构。"
  },
  {
    id: "explain",
    label: "解释",
    title: "解释这段内容",
    instruction: "请把选中内容解释得更清楚，适合当前文章读者理解。保留原文核心含义，返回可替换选中内容的 HTML。"
  },
  {
    id: "source",
    label: "来源",
    title: "补充来源和引用",
    instruction: "请搜索选中内容的可靠来源，并补充成简短来源说明或引用链接。返回可替换选中内容的 HTML。"
  },
  {
    id: "rewrite",
    label: "改写",
    title: "改写这段内容",
    instruction: "请改写选中内容，让表达更顺、更适合学习材料。不要额外搜索，返回可替换选中内容的 HTML。"
  },
  {
    id: "note",
    label: "笔记",
    title: "做成旁注/笔记卡",
    instruction: "请基于选中内容生成一张简短学习笔记卡，包含要点、疑问或记忆提示。返回可插入文档的 HTML。"
  }
 ] satisfies SelectionActionConfig[]).map((action) => ({
  ...action,
  icon:
    action.id === "annotate"
      ? Highlighter
      : action.id === "explain"
        ? BookOpenText
        : action.id === "source"
          ? Sparkles
          : action.id === "rewrite"
            ? FilePenLine
            : NotebookPen
}));

const api = {
  async getDocument() {
    const response = await fetch("/api/document");
    if (!response.ok) throw new Error("无法加载文档");
    return (await response.json()) as DocumentPayload;
  },

  async saveDocument(input: SaveDocumentRequest) {
    const response = await fetch("/api/document/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    });
    if (!response.ok) throw new Error("保存失败");
  },

  async propose(input: AiProposalRequest) {
    const response = await fetch("/api/ai/propose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Claude Agent 生成失败");
    return body as AiProposalResponse;
  },

  async generate(input: GenerateDocumentRequest) {
    const response = await fetch("/api/ai/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "生成 HTML 失败");
    return body as GenerateDocumentResponse;
  },

  async importExternal(input: ImportExternalRequest) {
    const response = await fetch("/api/external/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "外部资料内置失败");
    return body as ImportExternalResponse;
  }
};

function normalizeShell(shell: Partial<PageShell> | null | undefined): PageShell {
  return {
    title: shell?.title || DEFAULT_SHELL.title,
    htmlAttrs: shell?.htmlAttrs ?? DEFAULT_SHELL.htmlAttrs,
    bodyAttrs: shell?.bodyAttrs ?? DEFAULT_SHELL.bodyAttrs,
    headHtml: shell?.headHtml ?? DEFAULT_SHELL.headHtml
  };
}

function collectAttributes(element: Element | null) {
  const attrs: Record<string, string> = {};
  if (!element) return attrs;

  for (const attr of Array.from(element.attributes)) {
    attrs[attr.name] = attr.value;
  }
  return attrs;
}

function serializeAttributes(attrs: Record<string, string>) {
  return Object.entries(attrs)
    .filter(([name]) => /^[^\s"'<>/=]+$/.test(name))
    .map(([name, value]) => {
      const escaped = String(value)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return `${name}="${escaped}"`;
    })
    .join(" ");
}

function cleanDocumentCss(css: string) {
  let cleanCss = css;
  const grapesCanvasDefaults = cleanCss.search(/\n\s*body\s*\{\s*background-color\s*:\s*#fff\s*\}/i);

  if (grapesCanvasDefaults >= 0) {
    cleanCss = cleanCss.slice(0, grapesCanvasDefaults);
  }

  return cleanCss
    .replace(/\/\*\s*GrapesJS[\s\S]*?\*\//gi, "")
    .replace(/#gjs[^{]*\{[\s\S]*?\}/gi, "")
    .trimEnd();
}

function ensureGrowHtmlAnnotationCss(css: string, html: string) {
  const cleanCss = cleanDocumentCss(css);
  if (!/\bgrowhtml-annotation\b/.test(html)) return cleanCss;
  if (/\.growhtml-annotation\b/.test(cleanCss)) return cleanCss;

  return `${cleanCss.trimEnd()}\n\n${GROWHTML_ANNOTATION_CSS}`.trim();
}

function buildFullHtml(html: string, css: string, shell: PageShell, runtimeCss = "") {
  const normalized = normalizeShell(shell);
  const htmlAttrs = serializeAttributes(normalized.htmlAttrs);
  const bodyAttrs = serializeAttributes(normalized.bodyAttrs);
  const cleanCss = cleanDocumentCss(css);
  const runtimeStyle = runtimeCss
    ? `
    <style>
${runtimeCss}
    </style>`
    : "";

  return `<!doctype html>
<html${htmlAttrs ? ` ${htmlAttrs}` : ""}>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${normalized.title}</title>
${normalized.headHtml}
    <style>
${cleanCss}
    </style>
${runtimeStyle}
  </head>
  <body${bodyAttrs ? ` ${bodyAttrs}` : ""}>
${html}
  </body>
</html>`;
}

function replaceElementAttributes(element: Element, attrs: Record<string, string>) {
  for (const [name, value] of Object.entries(attrs)) {
    element.setAttribute(name, value);
  }
}

function applyShellToCanvas(editor: Editor, shell: PageShell) {
  const canvasDocument = editor.Canvas.getDocument();
  if (!canvasDocument) return;

  const normalized = normalizeShell(shell);
  replaceElementAttributes(canvasDocument.documentElement, normalized.htmlAttrs);
  replaceElementAttributes(canvasDocument.body, normalized.bodyAttrs);
}

function applyRawCssToCanvas(editor: Editor, css: string) {
  const canvasDocument = editor.Canvas.getDocument();
  if (!canvasDocument) return;

  const cleanCss = cleanDocumentCss(css);
  let styleElement = canvasDocument.getElementById("growhtml-raw-css") as HTMLStyleElement | null;
  let bridgeElement = canvasDocument.getElementById("growhtml-canvas-bridge-css") as HTMLStyleElement | null;

  if (!styleElement) {
    styleElement = canvasDocument.createElement("style");
    styleElement.id = "growhtml-raw-css";
  }

  if (!bridgeElement) {
    bridgeElement = canvasDocument.createElement("style");
    bridgeElement.id = "growhtml-canvas-bridge-css";
  }

  styleElement.textContent = cleanCss;
  bridgeElement.textContent = buildCanvasBridgeCss(cleanCss);
  canvasDocument.head.appendChild(styleElement);
  canvasDocument.head.appendChild(bridgeElement);
  applyCanvasThemeInline(editor, cleanCss);
}

function applyDocumentToEditor(editor: Editor, html: string, css: string, shell: PageShell) {
  setEditorComponents(editor, html);
  editor.setStyle(cleanDocumentCss(css));
  applyShellToCanvas(editor, shell);
  applyRawCssToCanvas(editor, css);
}

function safeGetProjectData(editor: Editor) {
  try {
    return editor.getProjectData();
  } catch (error) {
    console.warn("GrapesJS project snapshot failed; saving HTML/CSS only.", error);
    return null;
  }
}

function getComponentsModule(editor: Editor) {
  const candidate = editor as Editor & {
    Components?: {
      getWrapper?: () => Component | null;
      setComponents?: (components: string) => unknown;
    };
    DomComponents?: {
      getWrapper?: () => Component | null;
      setComponents?: (components: string) => unknown;
    };
  };

  return candidate.Components ?? candidate.DomComponents ?? null;
}

function getEditorWrapper(editor: Editor) {
  return getComponentsModule(editor)?.getWrapper?.() ?? null;
}

function setEditorComponents(editor: Editor, html: string) {
  const cleanHtml = cleanEditorHtml(html);

  try {
    editor.setComponents(cleanHtml);
    return;
  } catch (error) {
    console.warn("GrapesJS setComponents failed; retrying through wrapper.", error);
  }

  const components = getComponentsModule(editor);
  if (components?.setComponents) {
    components.setComponents(cleanHtml);
    return;
  }

  const wrapper = getEditorWrapper(editor);
  if (!wrapper) throw new Error("GrapesJS wrapper is not ready.");
  wrapper.components(cleanHtml);
}

function stripCssComments(css: string) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function getCssBlock(css: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = stripCssComments(css).match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, "i"));
  return match?.[1] ?? "";
}

function getCssDeclaration(block: string, property: string) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`(?:^|;)\\s*${escaped}\\s*:\\s*([^;]+)`, "i"));
  return match?.[1]?.trim() ?? "";
}

function getRootVars(css: string) {
  const rootBlock = getCssBlock(css, ":root");
  const vars: Record<string, string> = {};

  for (const match of rootBlock.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) {
    vars[match[1]] = match[2].trim();
  }

  return vars;
}

function resolveCssVars(value: string, vars: Record<string, string>) {
  return value.replace(/var\(\s*(--[\w-]+)(?:\s*,\s*([^)]+))?\s*\)/g, (_match, name: string, fallback: string) => {
    return vars[name] ?? fallback?.trim() ?? "";
  });
}

function getDocumentCssTheme(css: string) {
  const vars = getRootVars(css);
  const bodyBlock = getCssBlock(css, "body");
  const htmlBlock = getCssBlock(css, "html");
  const background = resolveCssVars(
    getCssDeclaration(bodyBlock, "background") ||
      getCssDeclaration(bodyBlock, "background-color") ||
      getCssDeclaration(htmlBlock, "background") ||
      getCssDeclaration(htmlBlock, "background-color"),
    vars
  );
  const color = resolveCssVars(getCssDeclaration(bodyBlock, "color") || getCssDeclaration(htmlBlock, "color"), vars);
  const fontFamily = resolveCssVars(
    getCssDeclaration(bodyBlock, "font-family") || getCssDeclaration(htmlBlock, "font-family"),
    vars
  );

  return {
    background: background || vars["--bg"] || "",
    color: color || vars["--text"] || "",
    fontFamily: fontFamily || vars["--sans"] || ""
  };
}

function applyCanvasThemeInline(editor: Editor, css: string) {
  const canvasDocument = editor.Canvas.getDocument();
  if (!canvasDocument) return;

  const theme = getDocumentCssTheme(css);
  const targets = [canvasDocument.documentElement, canvasDocument.body];

  for (const target of targets) {
    target.style.setProperty("min-height", "100%", "important");
    target.style.setProperty("margin", "0", "important");

    if (theme.background) {
      target.style.setProperty("background", theme.background, "important");
      target.style.setProperty("background-color", theme.background, "important");
    }

    if (theme.color) {
      target.style.setProperty("color", theme.color, "important");
    }

    if (theme.fontFamily) {
      target.style.setProperty("font-family", theme.fontFamily, "important");
    }
  }
}

function buildCanvasBridgeCss(css: string) {
  const theme = getDocumentCssTheme(css);
  const background = theme.background ? `background: ${theme.background} !important;` : "";
  const color = theme.color ? `color: ${theme.color} !important;` : "";
  const fontFamily = theme.fontFamily ? `font-family: ${theme.fontFamily} !important;` : "";

  return `
html,
body {
  min-height: 100% !important;
  margin: 0 !important;
  ${background}
  ${color}
  ${fontFamily}
}
html {
  height: 100% !important;
  overflow-y: auto !important;
}
body > * {
  box-sizing: border-box;
}
`;
}

function isTransparentColor(value: string) {
  return !value || value === "transparent" || value === "rgba(0, 0, 0, 0)";
}

function extractPanelTheme(document: Document): PanelTheme {
  const bodyStyle = document.defaultView?.getComputedStyle(document.body);
  const htmlStyle = document.defaultView?.getComputedStyle(document.documentElement);
  const accentElement = document.querySelector<HTMLElement>("a, h1, h2, .brand, .accent, [class*='accent']");
  const accentStyle = accentElement ? document.defaultView?.getComputedStyle(accentElement) : null;

  const background = !isTransparentColor(bodyStyle?.backgroundColor ?? "")
    ? bodyStyle?.backgroundColor
    : !isTransparentColor(htmlStyle?.backgroundColor ?? "")
      ? htmlStyle?.backgroundColor
      : DEFAULT_PANEL_THEME.background;

  return {
    background: background || DEFAULT_PANEL_THEME.background,
    color: bodyStyle?.color || htmlStyle?.color || DEFAULT_PANEL_THEME.color,
    fontFamily: bodyStyle?.fontFamily || htmlStyle?.fontFamily || DEFAULT_PANEL_THEME.fontFamily,
    accent: accentStyle?.color || DEFAULT_PANEL_THEME.accent,
    card: !isTransparentColor(bodyStyle?.backgroundColor ?? "") ? bodyStyle?.backgroundColor || "#ffffff" : "#ffffff"
  };
}

function stripHtml(value: string) {
  const withoutBlocks = value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const plain = withoutBlocks.replace(/<[^>]+>/g, " ");
  const textarea = document.createElement("textarea");
  textarea.innerHTML = plain;
  return textarea.value;
}

function normalizeSearchText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function extractDocumentOutline(html: string) {
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const outline = Array.from(parsed.body.querySelectorAll("h1, h2, h3, h4, h5, h6"))
    .slice(0, 80)
    .map((heading) => {
      const level = heading.tagName.toLowerCase();
      const id = heading.id ? `#${heading.id}` : "";
      return `${level}${id}: ${normalizeSearchText(heading.textContent ?? "").slice(0, 180)}`;
    })
    .filter(Boolean);

  return outline.length ? outline.join("\n") : normalizeSearchText(stripHtml(html)).slice(0, 1200);
}

function buildNearbyHtmlContext(html: string, selectedHtml: string) {
  const index = selectedHtml ? html.indexOf(selectedHtml) : -1;
  if (index < 0) return "";

  const before = html.slice(Math.max(0, index - LIGHT_CONTEXT_AROUND_SELECTION_CHARS), index);
  const after = html.slice(index + selectedHtml.length, index + selectedHtml.length + LIGHT_CONTEXT_AROUND_SELECTION_CHARS);
  return `${before}\n<!-- selectedHtml is omitted here; see selectedHtml field -->\n${after}`.trim();
}

function extractSelectorHints(html: string) {
  const hints = new Set(["html", "body", ":root"]);
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");

  for (const element of Array.from(parsed.body.querySelectorAll("*")).slice(0, 200)) {
    const tagName = element.tagName.toLowerCase();
    if (tagName) hints.add(tagName);
    if (element.id) hints.add(`#${element.id}`);
    for (const className of Array.from(element.classList)) {
      hints.add(`.${className}`);
    }
  }

  return Array.from(hints).filter((hint) => hint.length > 1);
}

function buildRelevantCssContext(css: string, selectedHtml: string) {
  const cleanCss = cleanDocumentCss(css);
  if (!cleanCss.trim()) return "";

  const hints = extractSelectorHints(selectedHtml);
  const blocks: string[] = [];
  const blockPattern = /([^{}]+)\{[^{}]*\}/g;
  let match: RegExpExecArray | null;

  while ((match = blockPattern.exec(cleanCss)) && blocks.join("\n").length < LIGHT_CONTEXT_MAX_CSS_CHARS) {
    const block = match[0];
    const selector = match[1];
    if (hints.some((hint) => selector.includes(hint))) {
      blocks.push(block.trim());
    }
  }

  const relevant = blocks.join("\n\n").trim();
  return (relevant || cleanCss).slice(0, LIGHT_CONTEXT_MAX_CSS_CHARS);
}

function buildLightweightProposalDocument(input: {
  html: string;
  css: string;
  shell: PageShell;
  selection: SelectionPayload;
}) {
  const outline = extractDocumentOutline(input.html);
  const nearby = buildNearbyHtmlContext(input.html, input.selection.selectedHtml);
  const htmlContext = [
    `<!-- GrowHTML lightweight context. Full page omitted by default. -->`,
    `<document-title>${input.shell.title}</document-title>`,
    `<selected-label>${input.selection.label}</selected-label>`,
    `<document-outline>\n${outline}\n</document-outline>`,
    nearby ? `<nearby-html>\n${nearby}\n</nearby-html>` : ""
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, LIGHT_CONTEXT_MAX_HTML_CHARS);

  return {
    html: htmlContext,
    css: buildRelevantCssContext(input.css, input.selection.selectedHtml)
  };
}

function getSearchNeedles(input: string) {
  const plain = stripHtml(input);
  return plain
    .split(/\r?\n|[。！？!?]/)
    .map((part) => normalizeSearchText(part).replace(/^(请|帮我|把|将|改成|补充|搜索|继续|说明|解释)\s*/, ""))
    .filter((part) => part.length >= 10)
    .sort((a, b) => b.length - a.length)
    .slice(0, 8);
}

function findComponentByPastedText(editor: Editor, input: string) {
  const wrapper = getEditorWrapper(editor);
  if (!wrapper) return null;

  const needles = getSearchNeedles(input);
  if (!needles.length) return null;

  let best: Component | null = null;
  let bestScore = 0;
  let bestSize = Number.POSITIVE_INFINITY;

  for (const component of wrapper.find("*")) {
    const html = component.toHTML();
    const text = normalizeSearchText(stripHtml(html));
    const score = needles.reduce((total, needle) => total + (text.includes(needle) ? needle.length : 0), 0);

    if (score > bestScore || (score === bestScore && score > 0 && html.length < bestSize)) {
      best = component;
      bestScore = score;
      bestSize = html.length;
    }
  }

  return bestScore >= 10 ? best : null;
}

function replaceHtmlFragmentByPastedText(html: string, input: string, replacementHtml: string) {
  const needles = getSearchNeedles(input);
  if (!needles.length || !html.trim()) return "";

  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  let best: Element | null = null;
  let bestScore = 0;
  let bestSize = Number.POSITIVE_INFINITY;

  for (const element of Array.from(parsed.body.querySelectorAll("*"))) {
    const outerHtml = element.outerHTML;
    const text = normalizeSearchText(stripHtml(outerHtml));
    const score = needles.reduce((total, needle) => total + (text.includes(needle) ? needle.length : 0), 0);

    if (score > bestScore || (score === bestScore && score > 0 && outerHtml.length < bestSize)) {
      best = element;
      bestScore = score;
      bestSize = outerHtml.length;
    }
  }

  if (!best || bestScore < 10) return "";

  best.outerHTML = replacementHtml;
  return parsed.body.innerHTML.trim();
}

function makeChatSelection(input: string): SelectionPayload {
  return {
    componentId: null,
    aiId: null,
    label: "AI 对话输入",
    tagName: "chat",
    selectedHtml: input.slice(0, 12000)
  };
}

function compactClassName(value: unknown) {
  if (!value) return "";
  if (Array.isArray(value)) return value.join(".");
  return String(value).trim().replace(/\s+/g, ".");
}

function makeSelectionPayload(component: Component): SelectionPayload {
  const attrs = component.getAttributes();
  const tagName = String(component.get("tagName") || component.get("type") || "component");
  const className = compactClassName(attrs.class);
  const id = attrs.id ? `#${attrs.id}` : "";
  const classes = className ? `.${className}` : "";
  const aiId = typeof attrs["data-ai-id"] === "string" ? attrs["data-ai-id"] : null;
  const label = `${tagName}${id}${classes}${aiId ? ` [${aiId}]` : ""}`;

  return {
    componentId: component.cid ?? null,
    aiId,
    label,
    tagName,
    selectedHtml: component.toHTML()
  };
}

function makePreviewSelectionPayload(element: Element): SelectionPayload {
  const tagName = element.tagName.toLowerCase();
  const className = compactClassName(element.getAttribute("class"));
  const id = element.id ? `#${element.id}` : "";
  const classes = className ? `.${className}` : "";
  const aiId = element.getAttribute("data-ai-id");
  const label = `${tagName}${id}${classes}${aiId ? ` [${aiId}]` : ""}`;
  const cleanClone = element.cloneNode(true) as Element;
  cleanClone.removeAttribute("data-growhtml-preview-selected");
  cleanClone.querySelectorAll("[data-growhtml-preview-selected]").forEach((item) => {
    item.removeAttribute("data-growhtml-preview-selected");
  });

  return {
    componentId: null,
    aiId,
    label,
    tagName,
    selectedHtml: cleanClone.outerHTML
  };
}

function parseClipboardSelectionPayload(value: string) {
  if (!value.trim()) return null;

  try {
    const parsed = JSON.parse(value) as Partial<SelectionPayload>;
    if (
      typeof parsed.label !== "string" ||
      typeof parsed.tagName !== "string" ||
      typeof parsed.selectedHtml !== "string"
    ) {
      return null;
    }

    return {
      componentId: typeof parsed.componentId === "string" ? parsed.componentId : null,
      aiId: typeof parsed.aiId === "string" ? parsed.aiId : null,
      label: parsed.label,
      tagName: parsed.tagName,
      selectedHtml: parsed.selectedHtml
    } satisfies SelectionPayload;
  } catch {
    return null;
  }
}

function readClipboardSelectionPayload(data: DataTransfer) {
  const direct = data.getData(GROWHTML_CLIPBOARD_TYPE);
  const directPayload = parseClipboardSelectionPayload(direct);
  if (directPayload) return directPayload;

  const html = data.getData("text/html");
  const match = html.match(/<!--\s*growhtml-selection:([\s\S]*?)-->/i);
  if (!match) return null;

  try {
    return parseClipboardSelectionPayload(decodeURIComponent(match[1].trim()));
  } catch {
    return null;
  }
}

function getSelectionHtml(selection: Selection) {
  if (!selection.rangeCount) return "";

  const container = document.createElement("div");
  container.appendChild(selection.getRangeAt(0).cloneContents());
  return container.innerHTML;
}

function elementFromNode(node: Node | null) {
  if (!node) return null;
  return node instanceof Element ? node : node.parentElement;
}

function escapeCssIdentifier(value: string) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function getFirstElementFromHtml(html: string) {
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  return parsed.body.firstElementChild;
}

function ensureAiId(component: Component) {
  const attrs = component.getAttributes();
  if (attrs["data-ai-id"]) return;
  const tagName = String(component.get("tagName") || component.get("type") || "block");
  const id = `${tagName.replace(/[^a-z0-9-]/gi, "").toLowerCase() || "node"}-${Date.now().toString(36)}`;
  component.addAttributes({ "data-ai-id": id });
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getStoredAgentPanelWidth() {
  const stored = window.localStorage.getItem(AGENT_PANEL_WIDTH_STORAGE_KEY);
  const parsed = stored ? Number(stored) : Number.NaN;
  return Number.isFinite(parsed)
    ? clampNumber(parsed, MIN_AGENT_PANEL_WIDTH, MAX_AGENT_PANEL_WIDTH)
    : DEFAULT_AGENT_PANEL_WIDTH;
}

function isKnownIframeBlockedUrl(value: string) {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    return (
      host === "github.com" ||
      host.endsWith(".github.com") ||
      host === "x.com" ||
      host === "twitter.com" ||
      host === "youtube.com" ||
      host === "youtu.be"
    );
  } catch {
    return false;
  }
}

function getRelativePath(file: File) {
  const typed = file as BrowserFile;
  return (typed.relativePath || typed.webkitRelativePath || file.name).replace(/\\/g, "/");
}

function normalizeRelativePath(value: string) {
  const parts: string[] = [];
  for (const part of value.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

function getRelativePathKey(value: string) {
  return normalizeRelativePath(value).toLowerCase();
}

function withRelativePath(file: File, relativePath: string) {
  try {
    Object.defineProperty(file, "relativePath", {
      value: normalizeRelativePath(relativePath),
      configurable: true
    });
  } catch {
    // Some browser file objects may be sealed; falling back to file.name is still usable.
  }
  return file;
}

function dirname(value: string) {
  const normalized = normalizeRelativePath(value);
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(0, index) : "";
}

function isHtmlPath(value: string) {
  return /\.html?$/i.test(value);
}

function isSkippableUrl(value: string) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value.trim());
}

function makeFileIndex(files: File[]) {
  const index = new Map<string, File>();
  for (const file of files) {
    const relativePath = normalizeRelativePath(getRelativePath(file));
    index.set(relativePath.toLowerCase(), file);
  }
  return index;
}

function resolveFilePath(baseDir: string, url: string, fileIndex: Map<string, File>) {
  if (!url || isSkippableUrl(url)) return null;

  const withoutHash = url.split("#")[0];
  const withoutQuery = withoutHash.split("?")[0];
  const decoded = decodeURIComponent(withoutQuery);
  const candidate = decoded.startsWith("/")
    ? normalizeRelativePath(decoded.slice(1))
    : normalizeRelativePath(`${baseDir}/${decoded}`);

  return fileIndex.has(candidate.toLowerCase()) ? candidate : null;
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function rewriteCssUrls(css: string, baseDir: string, fileIndex: Map<string, File>) {
  const regex = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
  let output = "";
  let lastIndex = 0;

  for (const match of css.matchAll(regex)) {
    const index = match.index ?? 0;
    const rawUrl = match[2].trim();
    output += css.slice(lastIndex, index);

    const resolvedPath = resolveFilePath(baseDir, rawUrl, fileIndex);
    const file = resolvedPath ? fileIndex.get(resolvedPath.toLowerCase()) : null;
    output += file ? `url("${await fileToDataUrl(file)}")` : match[0];
    lastIndex = index + match[0].length;
  }

  return output + css.slice(lastIndex);
}

function parseSrcset(value: string) {
  return value
    .split(",")
    .map((part) => {
      const [url, ...descriptor] = part.trim().split(/\s+/);
      return { url, descriptor: descriptor.join(" ") };
    })
    .filter((item) => item.url);
}

async function rewriteDomResourceUrls(document: Document, baseDir: string, fileIndex: Map<string, File>) {
  const urlAttributes: Array<[string, string]> = [
    ["img[src]", "src"],
    ["source[src]", "src"],
    ["video[poster]", "poster"],
    ["audio[src]", "src"],
    ["video[src]", "src"]
  ];

  for (const [selector, attribute] of urlAttributes) {
    for (const element of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      const value = element.getAttribute(attribute);
      if (!value) continue;

      const resolvedPath = resolveFilePath(baseDir, value, fileIndex);
      const file = resolvedPath ? fileIndex.get(resolvedPath.toLowerCase()) : null;
      if (file) element.setAttribute(attribute, await fileToDataUrl(file));
    }
  }

  for (const element of Array.from(document.querySelectorAll<HTMLElement>("[srcset]"))) {
    const srcset = element.getAttribute("srcset");
    if (!srcset) continue;

    const rewritten = await Promise.all(
      parseSrcset(srcset).map(async (item) => {
        const resolvedPath = resolveFilePath(baseDir, item.url, fileIndex);
        const file = resolvedPath ? fileIndex.get(resolvedPath.toLowerCase()) : null;
        const url = file ? await fileToDataUrl(file) : item.url;
        return item.descriptor ? `${url} ${item.descriptor}` : url;
      })
    );
    element.setAttribute("srcset", rewritten.join(", "));
  }

  for (const element of Array.from(document.querySelectorAll<HTMLElement>("[style]"))) {
    const style = element.getAttribute("style");
    if (style) element.setAttribute("style", await rewriteCssUrls(style, baseDir, fileIndex));
  }
}

async function prepareFolderHtml(files: File[], htmlFile: File) {
  const fileIndex = makeFileIndex(files);
  const htmlPath = normalizeRelativePath(getRelativePath(htmlFile));
  const htmlBaseDir = dirname(htmlPath);
  const raw = await htmlFile.text();
  const parsed = new DOMParser().parseFromString(raw, "text/html");
  const cssParts: string[] = [];
  const title = parsed.title || htmlFile.name;
  parsed.head.querySelector("title")?.remove();

  const styleSources = Array.from(parsed.querySelectorAll<HTMLStyleElement | HTMLLinkElement>("style, link"));
  for (const node of styleSources) {
    if (node instanceof HTMLStyleElement) {
      cssParts.push(await rewriteCssUrls(node.textContent ?? "", htmlBaseDir, fileIndex));
      node.remove();
      continue;
    }

    const rel = node.getAttribute("rel") ?? "";
    const href = node.getAttribute("href") ?? "";
    if (!/\bstylesheet\b/i.test(rel) || !href) continue;

    const resolvedPath = resolveFilePath(htmlBaseDir, href, fileIndex);
    const cssFile = resolvedPath ? fileIndex.get(resolvedPath.toLowerCase()) : null;
    if (cssFile && resolvedPath) {
      cssParts.push(await rewriteCssUrls(await cssFile.text(), dirname(resolvedPath), fileIndex));
    } else if (!isSkippableUrl(href) || /^https?:\/\//i.test(href) || /^\/\//.test(href)) {
      cssParts.push(`@import url("${href}");`);
    }
    node.remove();
  }

  await rewriteDomResourceUrls(parsed, htmlBaseDir, fileIndex);

  return {
    html: parsed.body.innerHTML.trim() || raw,
    css: cssParts.join("\n\n"),
    shell: normalizeShell({
      title,
      htmlAttrs: collectAttributes(parsed.documentElement),
      bodyAttrs: collectAttributes(parsed.body),
      headHtml: parsed.head.innerHTML.trim()
    })
  };
}

function chooseDefaultHtmlFile(files: File[]) {
  const htmlFiles = files
    .filter((file) => isHtmlPath(getRelativePath(file)))
    .sort((a, b) => getRelativePath(a).localeCompare(getRelativePath(b)));

  return (
    htmlFiles.find((file) => /(^|\/)index\.html?$/i.test(getRelativePath(file))) ??
    htmlFiles.find((file) => !dirname(getRelativePath(file))) ??
    htmlFiles[0] ??
    null
  );
}

function makeFolderCandidatesFromCache(cache: FolderCachePayload | null) {
  return (cache?.pages ?? [])
    .map((page) => ({ path: page.path, page }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function updateFolderCachePage(
  cache: FolderCachePayload | null,
  selectedPath: string,
  html: string,
  css: string,
  shell: PageShell
) {
  const selectedKey = getRelativePathKey(selectedPath);
  if (!cache || !selectedKey) return cache;

  let didUpdate = false;
  const pages = cache.pages.map((page) => {
    if (getRelativePathKey(page.path) !== selectedKey) return page;
    didUpdate = true;
    return {
      ...page,
      title: shell.title || page.title,
      html,
      css,
      shell
    };
  });

  return didUpdate ? { ...cache, selectedPath, pages } : cache;
}

function slugifyLocalPageName(input: string, fallback: string) {
  const ascii = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return ascii || fallback;
}

function makeExternalLocalPath(sourceUrl: string, title: string, existingPaths: string[]) {
  let base = slugifyLocalPageName(title, "external-note");

  try {
    const url = new URL(sourceUrl);
    const host = slugifyLocalPageName(url.hostname.replace(/^www\./, ""), "external");
    const tail = slugifyLocalPageName(url.pathname.split("/").filter(Boolean).pop() ?? "", "");
    base = tail ? `${host}-${tail}` : `${host}-${base}`;
  } catch {
    base = slugifyLocalPageName(title, "external-note");
  }

  const existing = new Set(existingPaths.map((path) => getRelativePathKey(path)));
  let candidate = normalizeRelativePath(`external/${base}.html`);
  let index = 2;
  while (existing.has(getRelativePathKey(candidate))) {
    candidate = normalizeRelativePath(`external/${base}-${index}.html`);
    index += 1;
  }

  return candidate;
}

function addExternalPageToNotebookCache(input: {
  cache: FolderCachePayload | null;
  currentPath: string;
  currentTitle: string;
  currentHtml: string;
  currentCss: string;
  currentShell: PageShell;
  externalPath: string;
  externalTitle: string;
  externalHtml: string;
  externalCss: string;
  externalShell: PageShell;
}) {
  const currentPath = normalizeRelativePath(input.currentPath || "index.html");
  const currentKey = getRelativePathKey(currentPath);
  const externalKey = getRelativePathKey(input.externalPath);
  const pageMap = new Map<string, FolderPagePayload>();

  for (const page of input.cache?.pages ?? []) {
    pageMap.set(getRelativePathKey(page.path), page);
  }

  const previousCurrentPage = pageMap.get(currentKey);
  pageMap.set(currentKey, {
    path: previousCurrentPage?.path ?? currentPath,
    title: input.currentTitle || input.currentShell.title || previousCurrentPage?.title || currentPath,
    html: input.currentHtml,
    css: input.currentCss,
    shell: normalizeShell({ ...input.currentShell, title: input.currentShell.title || input.currentTitle || currentPath })
  });

  pageMap.set(externalKey, {
    path: input.externalPath,
    title: input.externalTitle,
    html: input.externalHtml,
    css: input.externalCss,
    shell: input.externalShell
  });

  return {
    selectedPath: input.externalPath,
    pages: Array.from(pageMap.values()).sort((a, b) => a.path.localeCompare(b.path))
  } satisfies FolderCachePayload;
}

async function readDirectoryHandle(
  directoryHandle: FileSystemDirectoryHandleLike,
  basePath = ""
): Promise<{ files: File[]; handles: Map<string, FileSystemFileHandleLike> }> {
  const files: File[] = [];
  const handles = new Map<string, FileSystemFileHandleLike>();

  for await (const [name, handle] of directoryHandle.entries()) {
    const relativePath = normalizeRelativePath(`${basePath}/${name}`);

    if (handle.kind === "file") {
      const file = withRelativePath(await handle.getFile(), relativePath);
      files.push(file);
      handles.set(getRelativePathKey(relativePath), handle);
      continue;
    }

    const nested = await readDirectoryHandle(handle, relativePath);
    files.push(...nested.files);
    for (const [path, fileHandle] of nested.handles) {
      handles.set(path, fileHandle);
    }
  }

  return { files, handles };
}

function getFilePickerApi() {
  return window as Window & {
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandleLike>;
    showOpenFilePicker?: (options?: {
      multiple?: boolean;
      types?: Array<{
        description: string;
        accept: Record<string, string[]>;
      }>;
    }) => Promise<FileSystemFileHandleLike[]>;
  };
}

function cleanEditorHtml(html: string) {
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");

  for (const element of Array.from(
    parsed.body.querySelectorAll<HTMLElement>(
      ".gjs-css-rules, .gjs-js-cont, #gjs-css-rules, #gjs-css-rules-992, #gjs-css-rules-768, #gjs-css-rules-480"
    )
  )) {
    element.remove();
  }

  for (const style of Array.from(parsed.body.querySelectorAll<HTMLStyleElement>("style"))) {
    const text = style.textContent ?? "";
    if (
      /(^|\s)body\s*\{\s*background-color\s*:\s*#fff\s*\}/i.test(text) ||
      /\.gjs-|#gjs|data-gjs|::-webkit-scrollbar/i.test(text)
    ) {
      style.remove();
    }
  }

  for (const element of Array.from(parsed.body.querySelectorAll<HTMLElement>("*"))) {
    for (const attr of Array.from(element.attributes)) {
      if (
        attr.name.startsWith("data-gjs-") ||
        attr.name === "data-highlightable" ||
        attr.name === "contenteditable" ||
        attr.name === "spellcheck" ||
        attr.name === "draggable"
      ) {
        element.removeAttribute(attr.name);
      }
    }
  }

  return parsed.body.innerHTML.trim();
}

function getEditorHtmlForSave(editor: Editor) {
  const body = editor.Canvas.getDocument()?.body;
  const liveHtml = body?.innerHTML.trim();
  return cleanEditorHtml(liveHtml || editor.getHtml());
}

function isStarterDocument(html: string, shell: PageShell) {
  return (
    shell.title === DEFAULT_SHELL.title &&
    html.includes("learning-doc") &&
    html.includes('data-ai-id="doc-root"')
  );
}

function getDocumentScrollSnapshot(document: Document | null | undefined): ScrollSnapshot {
  const scrollingElement = document?.scrollingElement ?? document?.documentElement;
  const outerElement = window.document.scrollingElement ?? window.document.documentElement;
  const outerTop = window.scrollY || outerElement.scrollTop;
  const outerMaxTop = Math.max(0, outerElement.scrollHeight - outerElement.clientHeight);
  const outerRatio = outerMaxTop > 0 ? outerTop / outerMaxTop : 0;

  if (!document || !scrollingElement) return { top: 0, ratio: 0, outerTop, outerRatio };

  const top = document.defaultView?.scrollY ?? scrollingElement.scrollTop;
  const maxTop = Math.max(0, scrollingElement.scrollHeight - scrollingElement.clientHeight);
  return {
    top,
    ratio: maxTop > 0 ? top / maxTop : 0,
    outerTop,
    outerRatio
  };
}

function restoreDocumentScroll(document: Document | null | undefined, snapshot: ScrollSnapshot) {
  const scrollingElement = document?.scrollingElement ?? document?.documentElement;
  const outerElement = window.document.scrollingElement ?? window.document.documentElement;
  const outerMaxTop = Math.max(0, outerElement.scrollHeight - outerElement.clientHeight);
  const outerTop = snapshot.outerTop <= outerMaxTop ? snapshot.outerTop : snapshot.outerRatio * outerMaxTop;
  outerElement.scrollTop = outerTop;
  window.scrollTo({ top: outerTop, left: 0, behavior: "instant" as ScrollBehavior });

  if (!document || !scrollingElement) return;

  const maxTop = Math.max(0, scrollingElement.scrollHeight - scrollingElement.clientHeight);
  const top = snapshot.top <= maxTop ? snapshot.top : snapshot.ratio * maxTop;
  scrollingElement.scrollTop = top;
  document.body.scrollTop = top;
  document.defaultView?.scrollTo({ top, left: 0, behavior: "instant" as ScrollBehavior });
}

export default function App() {
  const editorRef = useRef<Editor | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const previewFrameRef = useRef<HTMLIFrameElement | null>(null);
  const instructionInputRef = useRef<HTMLTextAreaElement | null>(null);
  const chatLogRef = useRef<HTMLElement | null>(null);
  const currentCssRef = useRef("");
  const pageShellRef = useRef<PageShell>(DEFAULT_SHELL);
  const writeHandlesRef = useRef<Map<string, FileSystemFileHandleLike>>(new Map());
  const standaloneWriteHandleRef = useRef<FileSystemFileHandleLike | null>(null);
  const modeSwitchingRef = useRef(false);
  const scrollSnapshotRef = useRef<ScrollSnapshot>({ top: 0, ratio: 0, outerTop: 0, outerRatio: 0 });
  const pendingScrollRestoreRef = useRef<"preview" | "edit" | null>(null);
  const pendingImportHashRef = useRef("");
  const modeRef = useRef<"preview" | "edit">("preview");
  const applyingRef = useRef(false);
  const pastedSelectionRef = useRef<SelectionPayload | null>(null);
  const previewToolbarActionRef = useRef<(action: string) => void>(() => undefined);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");
  const [documentTitle, setDocumentTitle] = useState("GrowHTML");
  const [provider, setProvider] = useState<AiProvider>("codex");
  const [agentPanelWidth, setAgentPanelWidth] = useState(getStoredAgentPanelWidth);
  const [threads, setThreads] = useState<Record<AiProvider, string | null>>({
    claude: null,
    codex: null
  });
  const [history, setHistory] = useState<ThreadEntry[]>([]);
  const [selection, setSelection] = useState<SelectionPayload | null>(null);
  const [selectionOrigin, setSelectionOrigin] = useState<"editor" | "preview" | "chat" | null>(null);
  const [copiedContextVisible, setCopiedContextVisible] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [proposal, setProposal] = useState<AiProposal | null>(null);
  const [pendingTurn, setPendingTurn] = useState<PendingChatTurn | null>(null);
  const [applyingEntryId, setApplyingEntryId] = useState<string | null>(null);
  const [previewDraft, setPreviewDraft] = useState<ProposalPreviewDraft | null>(null);
  const [folderFiles, setFolderFiles] = useState<File[]>([]);
  const [folderCandidates, setFolderCandidates] = useState<FolderCandidate[]>([]);
  const [selectedFolderPath, setSelectedFolderPath] = useState("");
  const [folderCache, setFolderCache] = useState<FolderCachePayload | null>(null);
  const [screen, setScreen] = useState<"home" | "document">("home");
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [modeTransition, setModeTransition] = useState<"to-edit" | null>(null);
  const [pageShell, setPageShell] = useState<PageShell>(DEFAULT_SHELL);
  const [currentHtml, setCurrentHtml] = useState("");
  const [currentCss, setCurrentCss] = useState("");
  const [previewSrcDoc, setPreviewSrcDoc] = useState("");
  const [homePrompt, setHomePrompt] = useState("");
  const [panelTheme, setPanelTheme] = useState<PanelTheme>(DEFAULT_PANEL_THEME);
  const [externalPreviewUrl, setExternalPreviewUrl] = useState("");
  const [importingExternal, setImportingExternal] = useState(false);

  useEffect(() => {
    currentCssRef.current = currentCss;
  }, [currentCss]);

  useEffect(() => {
    pageShellRef.current = pageShell;
  }, [pageShell]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const statusLabel = useMemo(() => {
    if (status === "loading") return "加载中";
    if (status === "saving") return "保存中";
    if (status === "applying") return "应用中";
    if (status === "thinking") return `${provider === "claude" ? "Claude" : "Codex"} 工作中`;
    if (status === "error") return "需要处理";
    return "就绪";
  }, [provider, status]);

  const currentThreadId = threads[provider];
  const chatEntries = useMemo(() => [...history].reverse(), [history]);
  const latestHistoryId = history[0]?.id ?? "";
  const externalPreviewBlocked = externalPreviewUrl ? isKnownIframeBlockedUrl(externalPreviewUrl) : false;
  const agentPanelStyle = useMemo(
    () =>
      ({
        "--doc-panel-bg": panelTheme.background,
        "--doc-panel-color": panelTheme.color,
        "--doc-panel-font": panelTheme.fontFamily,
        "--doc-panel-accent": panelTheme.accent,
        "--doc-panel-card": panelTheme.card
      }) as CSSProperties,
    [panelTheme]
  );
  const workspaceStyle = useMemo(
    () =>
      ({
        "--agent-panel-width": `${agentPanelWidth}px`
      }) as CSSProperties,
    [agentPanelWidth]
  );

  useEffect(() => {
    window.localStorage.setItem(AGENT_PANEL_WIDTH_STORAGE_KEY, String(agentPanelWidth));
  }, [agentPanelWidth]);

  function scrollChatLogToBottom(behavior: ScrollBehavior = "smooth") {
    const element = chatLogRef.current;
    if (!element) return;

    element.scrollTo({
      top: element.scrollHeight,
      left: 0,
      behavior
    });
  }

  useEffect(() => {
    if (screen !== "document") return;

    const scroll = () => scrollChatLogToBottom("smooth");
    window.requestAnimationFrame(scroll);
    const timeout = window.setTimeout(scroll, 90);
    return () => window.clearTimeout(timeout);
  }, [screen, latestHistoryId, pendingTurn?.id]);

  function setClampedAgentPanelWidth(nextWidth: number) {
    const viewportMax = Math.max(
      MIN_AGENT_PANEL_WIDTH,
      Math.min(MAX_AGENT_PANEL_WIDTH, window.innerWidth - 420)
    );
    setAgentPanelWidth(clampNumber(nextWidth, MIN_AGENT_PANEL_WIDTH, viewportMax));
  }

  function handleAgentResizePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.classList.add("is-resizing-agent-panel");

    const updateWidth = (clientX: number) => {
      setClampedAgentPanelWidth(window.innerWidth - clientX);
    };
    const handlePointerMove = (moveEvent: PointerEvent) => updateWidth(moveEvent.clientX);
    const handlePointerUp = () => {
      document.body.classList.remove("is-resizing-agent-panel");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };

    updateWidth(event.clientX);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  }

  function handleAgentResizeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

    event.preventDefault();
    const step = event.shiftKey ? 40 : 16;
    setClampedAgentPanelWidth(agentPanelWidth + (event.key === "ArrowLeft" ? step : -step));
  }

  function syncPanelThemeFromDocument(document: Document | null | undefined) {
    if (!document?.body) return;
    setPanelTheme(extractPanelTheme(document));
  }

  function restoreEditorCanvasTheme(editor: Editor) {
    applyShellToCanvas(editor, pageShellRef.current);
    applyRawCssToCanvas(editor, currentCssRef.current);
    syncPanelThemeFromDocument(editor.Canvas.getDocument());
  }

  function restoreScrollSoon(document: Document | null | undefined, target: "preview" | "edit") {
    if (pendingScrollRestoreRef.current !== target) return;

    const snapshot = scrollSnapshotRef.current;
    const restore = () => restoreDocumentScroll(document, snapshot);
    window.requestAnimationFrame(restore);
    window.setTimeout(restore, 80);
    window.setTimeout(restore, 220);
    window.setTimeout(() => {
      if (pendingScrollRestoreRef.current === target) {
        pendingScrollRestoreRef.current = null;
      }
    }, 260);
  }

  function restorePendingImportHash(document: Document | null | undefined) {
    const hash = pendingImportHashRef.current;
    if (!document || !hash) return false;

    const tryScroll = () => {
      if (pendingImportHashRef.current === hash && scrollDocumentToHash(document, hash)) {
        pendingImportHashRef.current = "";
      }
    };

    window.requestAnimationFrame(tryScroll);
    window.setTimeout(tryScroll, 80);
    window.setTimeout(() => {
      tryScroll();
      if (pendingImportHashRef.current === hash) pendingImportHashRef.current = "";
    }, 260);

    return true;
  }

  function capturePreviewScroll() {
    scrollSnapshotRef.current = getDocumentScrollSnapshot(previewFrameRef.current?.contentDocument);
  }

  function captureEditorScroll(editor: Editor) {
    scrollSnapshotRef.current = getDocumentScrollSnapshot(editor.Canvas.getDocument());
  }

  function openExternalPreview(url: string) {
    setExternalPreviewUrl(url);
    setError("");
  }

  function scrollDocumentToHash(document: Document, hash: string) {
    const id = decodeURIComponent(hash.replace(/^#/, ""));
    if (!id) return false;

    const target = document.getElementById(id) ?? (document.getElementsByName(id)[0] as HTMLElement | undefined);
    target?.scrollIntoView({ block: "start" });
    return Boolean(target);
  }

  function resolveLocalDocumentPath(rawHref: string) {
    const withoutHash = rawHref.split("#")[0];
    const withoutQuery = withoutHash.split("?")[0];
    if (!withoutQuery || isSkippableUrl(withoutQuery)) return "";

    const decoded = decodeURIComponent(withoutQuery);
    const baseDir = dirname(selectedFolderPath || "index.html");
    return decoded.startsWith("/")
      ? normalizeRelativePath(decoded.slice(1))
      : normalizeRelativePath(`${baseDir}/${decoded}`);
  }

  function normalizeHashTarget(hash: string | undefined) {
    if (!hash) return "";
    const cleanHash = hash.replace(/^#/, "");
    return cleanHash ? `#${cleanHash}` : "";
  }

  function findFolderCandidate(targetPath: string) {
    const normalizedTarget = normalizeRelativePath(targetPath);
    const targetKey = getRelativePathKey(normalizedTarget);
    if (!targetKey) return null;

    const exact = folderCandidates.find((item) => getRelativePathKey(item.path) === targetKey);
    if (exact) return exact;

    const selectedRoot = normalizeRelativePath(selectedFolderPath).split("/")[0];
    if (selectedRoot && !targetKey.startsWith(`${selectedRoot.toLowerCase()}/`)) {
      const rootedKey = getRelativePathKey(`${selectedRoot}/${normalizedTarget}`);
      const rooted = folderCandidates.find((item) => getRelativePathKey(item.path) === rootedKey);
      if (rooted) return rooted;
    }

    const suffixMatches = folderCandidates.filter((item) => {
      const itemKey = getRelativePathKey(item.path);
      return itemKey.endsWith(`/${targetKey}`);
    });

    return suffixMatches.length === 1 ? suffixMatches[0] : null;
  }

  function bindDocumentLinks(document: Document | null | undefined) {
    if (!document?.body) return;

    document.onclick = (event) => {
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;

      const rawHref = anchor.getAttribute("href")?.trim() ?? "";
      if (!rawHref || rawHref.startsWith("javascript:")) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (/^https?:/i.test(rawHref)) {
        event.preventDefault();
        event.stopPropagation();
        openExternalPreview(anchor.href);
        return;
      }

      if (/^(?:mailto:|tel:)/i.test(rawHref)) {
        event.preventDefault();
        event.stopPropagation();
        window.open(anchor.href, "_blank", "noopener,noreferrer");
        return;
      }

      const [pathPart, hashPart] = rawHref.split("#");
      const hashTarget = normalizeHashTarget(hashPart);
      const targetPath = resolveLocalDocumentPath(rawHref);
      const currentPath = normalizeRelativePath(selectedFolderPath || "");
      const pathWithoutQuery = pathPart.split("?")[0];
      const isSameDocument =
        !pathPart ||
        (!!hashTarget && (!pathWithoutQuery || pathWithoutQuery === "." || pathWithoutQuery === "./")) ||
        (!!targetPath && !!currentPath && targetPath.toLowerCase() === currentPath.toLowerCase()) ||
        (!currentPath && /(^|\/)index\.html?$/i.test(targetPath));

      event.preventDefault();
      event.stopPropagation();

      if (hashTarget && isSameDocument) {
        scrollDocumentToHash(document, hashTarget);
        return;
      }

      if (isSameDocument) return;

      if (!targetPath || !isHtmlPath(targetPath)) return;

      const candidate = findFolderCandidate(targetPath);
      if (candidate) {
        void openFolderCandidate(candidate, hashTarget);
        return;
      }

      if (hashTarget && scrollDocumentToHash(document, hashTarget)) return;

      setError("这个章节链接指向另一个本地 HTML 文件，但当前没有在已导入文件夹里找到它。已阻止 iframe 直接跳转以避免套娃；请导入完整文件夹后再点这个章节链接。");
      setStatus("error");
    };
  }

  function findPreviewAssociableElement(target: EventTarget | null, document: Document) {
    const element = target instanceof Element ? target.closest(PREVIEW_ASSOCIABLE_SELECTOR) : null;
    if (!element || element === document.body || element === document.documentElement) return null;
    return element;
  }

  function findPreviewCopyElement(target: EventTarget | null, selection: Selection | null, document: Document) {
    if (selection?.rangeCount) {
      const rangeElement = elementFromNode(selection.getRangeAt(0).commonAncestorContainer)?.closest(
        PREVIEW_ASSOCIABLE_SELECTOR
      );
      if (rangeElement && rangeElement !== document.body && rangeElement !== document.documentElement) {
        return rangeElement;
      }
    }

    return findPreviewAssociableElement(target, document);
  }

  function markPreviewElement(document: Document, element: Element) {
    document.querySelectorAll("[data-growhtml-preview-selected]").forEach((item) => {
      item.removeAttribute("data-growhtml-preview-selected");
    });
    element.setAttribute("data-growhtml-preview-selected", "true");
  }

  function bindPreviewComponentSelection(document: Document | null | undefined) {
    if (!document?.body) return;

    document.body.onclick = (event) => {
      if ((event.target as Element | null)?.closest?.(".growhtml-preview-action-toolbar")) return;
      if ((event.target as Element | null)?.closest?.("a[href]")) return;

      const element = findPreviewAssociableElement(event.target, document);
      if (!element) return;

      markPreviewElement(document, element);
      setSelection(makePreviewSelectionPayload(element));
      setSelectionOrigin("preview");
      setCopiedContextVisible(false);
      setProposal(null);
    };
  }

  function bindPreviewClipboard(document: Document | null | undefined) {
    if (!document?.body) return;

    document.body.oncopy = (event) => {
      if (!event.clipboardData) return;

      const documentSelection = document.getSelection();
      const element = findPreviewCopyElement(event.target, documentSelection, document);
      if (!element) return;

      const payload = makePreviewSelectionPayload(element);
      const payloadText = JSON.stringify(payload);
      const selectedText =
        documentSelection && !documentSelection.isCollapsed ? documentSelection.toString() : stripHtml(payload.selectedHtml);
      const selectedHtml =
        documentSelection && !documentSelection.isCollapsed ? getSelectionHtml(documentSelection) : payload.selectedHtml;

      event.clipboardData.setData("text/plain", selectedText);
      event.clipboardData.setData(
        "text/html",
        `${selectedHtml}\n<!-- ${GROWHTML_CLIPBOARD_PREFIX}${encodeURIComponent(payloadText)} -->`
      );
      event.clipboardData.setData(GROWHTML_CLIPBOARD_TYPE, payloadText);
      event.preventDefault();

      markPreviewElement(document, element);
      setSelection(payload);
      setSelectionOrigin("preview");
      setCopiedContextVisible(true);
      setProposal(null);
    };
  }

  function bindEditorFrameDoubleClick(editor: Editor) {
    const canvasDocument = editor.Canvas.getDocument();
    if (!canvasDocument?.body) return;

    canvasDocument.body.ondblclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      leaveEditMode();
    };

    bindDocumentLinks(canvasDocument);
    restoreScrollSoon(canvasDocument, "edit");
  }

  function syncPreviewSrcDoc(html: string, css: string, shell: PageShell) {
    setPreviewSrcDoc(buildFullHtml(html, css, shell, PREVIEW_RUNTIME_CSS));
  }

  function patchPreviewDocument(
    html: string,
    css: string,
    shell: PageShell,
    options: { preserveScroll?: boolean } = {}
  ) {
    const previewDocument = previewFrameRef.current?.contentDocument;
    if (!previewDocument?.body) return false;

    const preserveScroll = options.preserveScroll ?? true;
    const snapshot = preserveScroll ? getDocumentScrollSnapshot(previewDocument) : null;
    const normalized = normalizeShell(shell);
    const cleanCss = cleanDocumentCss(css);
    let styleElement = previewDocument.getElementById("growhtml-preview-inline-css") as HTMLStyleElement | null;

    if (!styleElement) {
      styleElement = previewDocument.createElement("style");
      styleElement.id = "growhtml-preview-inline-css";
      previewDocument.head.appendChild(styleElement);
    }

    previewDocument.title = normalized.title;
    replaceElementAttributes(previewDocument.documentElement, normalized.htmlAttrs);
    replaceElementAttributes(previewDocument.body, normalized.bodyAttrs);
    styleElement.textContent = `${cleanCss}\n${PREVIEW_RUNTIME_CSS}`;
    previewDocument.body.innerHTML = html;

    syncPanelThemeFromDocument(previewDocument);
    bindDocumentLinks(previewDocument);
    bindPreviewComponentSelection(previewDocument);
    bindPreviewClipboard(previewDocument);
    bindPreviewToolbarActions(previewDocument);
    previewDocument.body.ondblclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      enterEditMode();
    };

    window.requestAnimationFrame(() => {
      if (snapshot) {
        restoreDocumentScroll(previewDocument, snapshot);
        return;
      }

      const scrollingElement = previewDocument.scrollingElement ?? previewDocument.documentElement;
      const top = Math.max(0, scrollingElement.scrollHeight - scrollingElement.clientHeight);
      scrollingElement.scrollTop = top;
      previewDocument.body.scrollTop = top;
      previewDocument.defaultView?.scrollTo({ top, left: 0, behavior: "smooth" });
    });
    return true;
  }

  function renderPreviewDocument(html: string, css: string, shell: PageShell, preserveScroll: boolean) {
    if (modeRef.current === "preview" && patchPreviewDocument(html, css, shell, { preserveScroll })) {
      return;
    }

    syncPreviewSrcDoc(html, css, shell);
  }

  function findPreviewDraftTarget(document: Document, draft: ProposalPreviewDraft) {
    if (draft.selection.aiId) {
      const byAiId = document.querySelector(`[data-ai-id="${escapeCssIdentifier(draft.selection.aiId)}"]`);
      if (byAiId) return byAiId;
    }

    const replacementRoot = getFirstElementFromHtml(draft.replacementHtml);
    const replacementAiId = replacementRoot?.getAttribute("data-ai-id");
    if (replacementAiId) {
      const byReplacementAiId = document.querySelector(`[data-ai-id="${escapeCssIdentifier(replacementAiId)}"]`);
      if (byReplacementAiId) return byReplacementAiId;
    }

    if (replacementRoot?.id) {
      const byId = document.getElementById(replacementRoot.id);
      if (byId) return byId;
    }

    if (/\bgrowhtml-annotation\b/.test(draft.replacementHtml)) {
      const annotation = document.querySelector(".growhtml-annotation");
      if (annotation) return annotation;
    }

    const replacementText = normalizeSearchText(stripHtml(draft.replacementHtml)).slice(0, 180);
    if (replacementText.length >= 16) {
      let best: Element | null = null;
      let bestLength = Number.POSITIVE_INFINITY;

      for (const element of Array.from(document.body.querySelectorAll(PREVIEW_ASSOCIABLE_SELECTOR))) {
        const text = normalizeSearchText(element.textContent ?? "");
        if (text.includes(replacementText) && element.outerHTML.length < bestLength) {
          best = element;
          bestLength = element.outerHTML.length;
        }
      }

      if (best) return best;
    }

    return document.body.firstElementChild;
  }

  function bindPreviewToolbarActions(document: Document | null | undefined) {
    if (!document?.body) return;

    const body = document.body as HTMLBodyElement & { __growhtmlToolbarClick?: EventListener };
    if (body.__growhtmlToolbarClick) {
      body.removeEventListener("click", body.__growhtmlToolbarClick, true);
    }

    const handleClick: EventListener = (event) => {
      const button = (event.target as Element | null)?.closest?.("[data-growhtml-preview-action]") as HTMLElement | null;
      if (!button) return;

      event.preventDefault();
      event.stopPropagation();

      const action = button.dataset.growhtmlPreviewAction;
      if (action) previewToolbarActionRef.current(action);
    };

    body.__growhtmlToolbarClick = handleClick;
    body.addEventListener("click", handleClick, true);
  }

  function showPreviewDraftToolbar(draft: ProposalPreviewDraft) {
    const previewDocument = previewFrameRef.current?.contentDocument;
    if (!previewDocument?.body) return false;

    previewDocument.querySelectorAll(".growhtml-preview-action-toolbar").forEach((item) => item.remove());
    previewDocument.querySelectorAll("[data-growhtml-preview-change]").forEach((item) => {
      item.removeAttribute("data-growhtml-preview-change");
    });

    const target = findPreviewDraftTarget(previewDocument, draft) as HTMLElement | null;
    if (!target) return false;

    target.setAttribute("data-growhtml-preview-change", "true");

    const toolbar = previewDocument.createElement("div");
    toolbar.className = "growhtml-preview-action-toolbar";
    toolbar.setAttribute("contenteditable", "false");
    toolbar.innerHTML = `
      <button type="button" data-growhtml-preview-action="apply" title="应用">✓</button>
      <button type="button" data-growhtml-preview-action="reject" title="取消">×</button>
      <button type="button" data-growhtml-preview-action="regenerate" title="重新生成">↻</button>
      <button type="button" data-growhtml-preview-action="discuss" title="继续讨论">?</button>
    `;
    previewDocument.body.appendChild(toolbar);

    const rect = target.getBoundingClientRect();
    const win = previewDocument.defaultView;
    const scrollX = win?.scrollX ?? previewDocument.documentElement.scrollLeft;
    const scrollY = win?.scrollY ?? previewDocument.documentElement.scrollTop;
    const left = Math.max(8, rect.left + scrollX);
    const top = Math.max(8, rect.top + scrollY - 48);
    toolbar.style.left = `${left}px`;
    toolbar.style.top = `${top}px`;

    bindPreviewToolbarActions(previewDocument);
    return true;
  }

  function schedulePreviewDraftToolbar(draft: ProposalPreviewDraft) {
    window.requestAnimationFrame(() => showPreviewDraftToolbar(draft));
    window.setTimeout(() => showPreviewDraftToolbar(draft), 80);
    window.setTimeout(() => showPreviewDraftToolbar(draft), 240);
  }

  function clearProposalPreview(options: { restore?: boolean } = {}) {
    const restore = options.restore ?? true;
    setPreviewDraft(null);

    if (restore) {
      renderPreviewDocument(currentHtml, currentCss, pageShell, true);
    }
  }

  async function writeBackImportedDocument(html: string, css: string, shell: PageShell) {
    const selectedPath = selectedFolderPath ? getRelativePathKey(selectedFolderPath) : "";
    const handle =
      (selectedPath ? writeHandlesRef.current.get(selectedPath) : null) ?? standaloneWriteHandleRef.current;

    if (!handle) return "skipped" as const;

    const writable = await handle.createWritable();
    await writable.write(buildFullHtml(html, css, shell));
    await writable.close();
    return "written" as const;
  }

  async function persistDocument(input: SaveDocumentRequest) {
    await api.saveDocument(input);

    try {
      await writeBackImportedDocument(input.html, input.css, input.shell);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      setError(`已保存到 GrowHTML 内部文件，但写回原 HTML 失败：${message}`);
      setStatus("error");
      return false;
    }
  }

  useEffect(() => {
    folderInputRef.current?.setAttribute("webkitdirectory", "");
    folderInputRef.current?.setAttribute("directory", "");

    const editor = grapesjs.init({
      container: "#gjs",
      height: "100%",
      storageManager: false,
      fromElement: false,
      selectorManager: { componentFirst: true },
      panels: {
        defaults: []
      },
      layerManager: {
        appendTo: undefined
      },
      styleManager: {
        appendTo: undefined
      },
      traitManager: {
        appendTo: undefined
      }
    });

    editorRef.current = editor;

    editor.on("component:selected", (component: Component) => {
      ensureAiId(component);
      setSelection(makeSelectionPayload(component));
      setSelectionOrigin("editor");
      setCopiedContextVisible(false);
      setProposal(null);
      setError("");
      setStatus("ready");
    });

    editor.on("component:deselected", () => {
      setSelection(null);
      setSelectionOrigin(null);
      setCopiedContextVisible(false);
      setProposal(null);
    });

    editor.on("canvas:load", () => {
      restoreEditorCanvasTheme(editor);
      bindEditorFrameDoubleClick(editor);
    });

    editor.on("canvas:frame:load", () => {
      restoreEditorCanvasTheme(editor);
      bindEditorFrameDoubleClick(editor);
    });

    editor.on("canvas:frame:load:head", () => {
      restoreEditorCanvasTheme(editor);
    });

    editor.on("canvas:frame:load:body", () => {
      restoreEditorCanvasTheme(editor);
      bindEditorFrameDoubleClick(editor);
    });

    api
      .getDocument()
      .then((doc) => {
        const shell = normalizeShell(doc.shell);
        const html = cleanEditorHtml(doc.html);
        const css = cleanDocumentCss(doc.css);
        currentCssRef.current = css;
        pageShellRef.current = shell;
        setDocumentTitle(doc.title);
        setThreads(doc.threads ?? { claude: doc.threadId, codex: null });
        setHistory(doc.history);
        setCurrentHtml(html);
        setCurrentCss(css);
        setPageShell(shell);
        syncPreviewSrcDoc(html, css, shell);
        setFolderCache(doc.folderCache ?? null);
        setFolderCandidates(makeFolderCandidatesFromCache(doc.folderCache ?? null));
        setSelectedFolderPath(doc.folderCache?.selectedPath ?? "");
        if (!isStarterDocument(html, shell)) {
          setMode("preview");
          setScreen("document");
        }

        setStatus("ready");
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "加载失败");
        setStatus("error");
      });

    return () => {
      editor.destroy();
      editorRef.current = null;
    };
  }, []);

  async function saveDocumentSnapshot(input: { html: string; css: string; projectData: unknown }) {
    setStatus("saving");
    setError("");

    try {
      const css = cleanDocumentCss(input.css);
      const nextFolderCache = updateFolderCachePage(folderCache, selectedFolderPath, input.html, css, pageShell);
      const saved = await persistDocument({
        html: input.html,
        css,
        shell: pageShell,
        projectData: input.projectData,
        folderCache: nextFolderCache ?? undefined
      });
      currentCssRef.current = css;
      setCurrentHtml(input.html);
      setCurrentCss(css);
      if (nextFolderCache !== folderCache) setFolderCache(nextFolderCache);
      if (saved) setStatus("ready");
      return saved;
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
      setStatus("error");
      return false;
    }
  }

  async function saveCurrentDocument() {
    const editor = editorRef.current;
    if (!editor) return false;

    const html = getEditorHtmlForSave(editor);
    const css = currentCss || editor.getCss() || "";
    return saveDocumentSnapshot({
      html,
      css,
      projectData: safeGetProjectData(editor)
    });
  }

  async function autoSaveDocument() {
    if (screen !== "document") return;
    if (!currentHtml.trim()) return;
    if (status === "loading" || status === "saving" || status === "applying" || status === "thinking") return;

    const editor = editorRef.current;
    if (mode === "edit" && editor) {
      await saveCurrentDocument();
      return;
    }

    await saveDocumentSnapshot({
      html: cleanEditorHtml(currentHtml),
      css: currentCss,
      projectData: editor ? safeGetProjectData(editor) : null
    });
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      void autoSaveDocument();
    }, 60000);

    return () => window.clearInterval(timer);
  }, [screen, mode, currentHtml, currentCss, pageShell, status]);

  async function savePreparedDocument(input: {
    title: string;
    html: string;
    css: string;
    shell: PageShell;
    projectData?: unknown;
    folderCache?: FolderCachePayload | null;
  }) {
    const editor = editorRef.current;
    if (!editor) return;

    const shell = normalizeShell({ ...input.shell, title: input.title || input.shell.title });
    const css = cleanDocumentCss(input.css);
    currentCssRef.current = css;
    pageShellRef.current = shell;

    setDocumentTitle(shell.title);
    setPageShell(shell);
    setCurrentHtml(input.html);
    setCurrentCss(css);
    syncPreviewSrcDoc(input.html, css, shell);
    if (input.folderCache !== undefined) setFolderCache(input.folderCache);
    setSelection(null);
    setSelectionOrigin(null);
    setCopiedContextVisible(false);
    setProposal(null);
    setPendingTurn(null);
    setPreviewDraft(null);
    setInstruction("");
    setMode("preview");
    setScreen("document");

    await api.saveDocument({
      html: input.html,
      css,
      shell,
      projectData: input.projectData ?? safeGetProjectData(editor),
      folderCache: input.folderCache
    });
    setStatus("ready");
  }

  async function askClaude(
    action?: SelectionAction,
    override?: {
      instruction?: string;
      displayInstruction?: string;
      selection?: SelectionPayload | null;
    }
  ) {
    const editor = editorRef.current;
    if (!editor) return;

    const supplement = override?.instruction?.trim() ?? instruction.trim();
    const trimmed = action
      ? `${action.instruction}${supplement ? `\n\n补充要求：${supplement}` : ""}`
      : supplement;
    if (!trimmed) {
      setError("写一句你想怎么改");
      setStatus("error");
      return;
    }

    const previewSelection = override?.selection ?? (selectionOrigin === "preview" ? selection : pastedSelectionRef.current);
    const selectedComponent = previewSelection ? null : editor.getSelected() ?? (action ? null : findComponentByPastedText(editor, trimmed));
    if (selectedComponent) ensureAiId(selectedComponent);

    const freshSelection = previewSelection ?? (selectedComponent ? makeSelectionPayload(selectedComponent) : makeChatSelection(trimmed));
    if (action && !previewSelection && !selectedComponent && !selection) {
      setError("先在正文里选中或复制一段内容，再点这个动作");
      setStatus("error");
      return;
    }

    pastedSelectionRef.current = null;
    clearProposalPreview({ restore: true });
    setSelection(freshSelection);
    setSelectionOrigin(previewSelection ? "preview" : selectedComponent ? "editor" : "chat");
    setCopiedContextVisible(false);
    setProposal(null);
    setPendingTurn({
      id: `pending-${Date.now().toString(36)}`,
      provider,
      instruction: override?.displayInstruction ?? (action ? `${action.label}${supplement ? `：${supplement}` : ""}` : trimmed),
      selectionLabel: freshSelection.label,
      createdAt: new Date().toISOString()
    });
    setInstruction("");
    setError("");
    setStatus("thinking");

    try {
      const sourceHtml = mode === "preview" ? currentHtml : getEditorHtmlForSave(editor);
      const sourceCss = cleanDocumentCss(currentCss || editor.getCss() || "");
      const lightweightDocument = buildLightweightProposalDocument({
        html: sourceHtml,
        css: sourceCss,
        shell: pageShell,
        selection: freshSelection
      });
      const response = await api.propose({
        provider,
        instruction: trimmed,
        selection: freshSelection,
        document: lightweightDocument
      });

      const nextHistory = response.history.map((entry, index) =>
        index === 0
          ? {
              ...entry,
              selection: entry.selection ?? freshSelection,
              proposal: entry.proposal ?? response.proposal,
              summary: entry.summary || response.proposal.summary,
              sources: entry.sources.length ? entry.sources : response.proposal.sources
            }
          : entry
      );

      setThreads(response.threads);
      setProposal(response.proposal);
      setHistory(nextHistory);
      setPendingTurn(null);
      setInstruction("");
      setStatus("ready");
      if (nextHistory[0]?.proposal) {
        previewProposal(nextHistory[0]);
      }
    } catch (err) {
      setPendingTurn(null);
      setError(err instanceof Error ? err.message : "Claude Agent 生成失败");
      setStatus("error");
    }
  }

  function handleInstructionKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;

    event.preventDefault();
    if (status === "thinking" || !instruction.trim()) return;

    void askClaude();
  }

  function handleInstructionPaste(event: ReactClipboardEvent<HTMLTextAreaElement>) {
    const payload = readClipboardSelectionPayload(event.clipboardData);
    if (!payload) return;

    event.preventDefault();
    pastedSelectionRef.current = payload;
    setSelection(payload);
    setSelectionOrigin("preview");
    setCopiedContextVisible(true);
    setProposal(null);
    setError("");
  }

  function getProposalContext(entry?: ThreadEntry) {
    const activeProposal = entry?.proposal ?? proposal;
    const instructionText = entry?.instruction ?? instruction;

    return {
      id: entry?.id ?? "current-proposal",
      activeProposal,
      replacementHtml: activeProposal?.replacementHtml.trim() ?? "",
      instructionText,
      activeSelection: entry?.selection ?? selection ?? makeChatSelection(instructionText)
    };
  }

  function resolveProposalHtml(
    editor: Editor,
    context: ReturnType<typeof getProposalContext>
  ): { html: string; css: string; preserveScroll: boolean } {
    const baseHtml = mode === "preview" ? currentHtml : getEditorHtmlForSave(editor);
    const baseCss = cleanDocumentCss(currentCss || editor.getCss() || "");
    const finalize = (html: string, preserveScroll: boolean) => ({
      html,
      css: ensureGrowHtmlAnnotationCss(baseCss, html),
      preserveScroll
    });

    if (context.activeSelection.selectedHtml && baseHtml.includes(context.activeSelection.selectedHtml)) {
      return finalize(baseHtml.replace(context.activeSelection.selectedHtml, context.replacementHtml), true);
    }

    const fuzzyHtml = replaceHtmlFragmentByPastedText(
      baseHtml,
      `${context.activeSelection.selectedHtml}\n${context.instructionText}`,
      context.replacementHtml
    );
    if (fuzzyHtml && fuzzyHtml !== baseHtml) {
      return finalize(fuzzyHtml, true);
    }

    return finalize(`${baseHtml.trim()}\n\n${context.replacementHtml}`.trim(), false);
  }

  function previewProposal(entry?: ThreadEntry) {
    const editor = editorRef.current;
    const context = getProposalContext(entry);

    if (!editor || !context.replacementHtml) {
      setError("这条回复里没有可以预览的 HTML 片段");
      setStatus("error");
      return;
    }

    try {
      const resolved = resolveProposalHtml(editor, context);
      const draft = {
        id: context.id,
        html: resolved.html,
        css: resolved.css,
        shell: pageShell,
        preserveScroll: resolved.preserveScroll,
        selection: context.activeSelection,
        instruction: context.instructionText,
        replacementHtml: context.replacementHtml
      };

      setPreviewDraft(draft);
      setError("");
      setStatus("ready");
      renderPreviewDocument(draft.html, draft.css, draft.shell, draft.preserveScroll);
      schedulePreviewDraftToolbar(draft);

      if (mode !== "preview") {
        modeRef.current = "preview";
        setMode("preview");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "预览失败");
      setStatus("error");
    }
  }

  function findPreviewDraftEntry() {
    if (!previewDraft) return null;
    return history.find((entry) => entry.id === previewDraft.id) ?? null;
  }

  async function applyPreviewDraft() {
    const entry = findPreviewDraftEntry();
    await applyProposal(entry ?? undefined);
  }

  async function regeneratePreviewDraft() {
    if (!previewDraft || status === "thinking") return;

    const entry = findPreviewDraftEntry();
    const baseInstruction = entry?.instruction || previewDraft.instruction;
    const regenerateInstruction = `${baseInstruction}\n\n请重新生成一个不同版本，避免重复当前预览。`;
    clearProposalPreview({ restore: true });
    await askClaude(undefined, {
      instruction: regenerateInstruction,
      displayInstruction: "重新生成",
      selection: entry?.selection ?? previewDraft.selection
    });
  }

  function startPreviewDiscussion() {
    if (!previewDraft) return;

    const entry = findPreviewDraftEntry();
    setSelection(entry?.selection ?? previewDraft.selection);
    setSelectionOrigin("preview");
    setInstruction("继续讨论：");
    window.requestAnimationFrame(() => {
      instructionInputRef.current?.focus();
      const length = instructionInputRef.current?.value.length ?? 0;
      instructionInputRef.current?.setSelectionRange(length, length);
    });
  }

  async function applyProposal(entry?: ThreadEntry) {
    if (applyingRef.current) return;

    const editor = editorRef.current;
    const context = getProposalContext(entry);

    if (!editor || !context.replacementHtml) {
      setError("这条回复里没有可以应用的 HTML 片段");
      setStatus("error");
      return;
    }

    const applyId = context.id;
    applyingRef.current = true;
    setApplyingEntryId(applyId);
    setError("");
    setStatus("applying");

    try {
      const selectedComponent =
        mode === "edit"
          ? editor.getSelected() ??
            (context.activeSelection.aiId
              ? getEditorWrapper(editor)?.find(`[data-ai-id="${context.activeSelection.aiId}"]`)[0]
              : null) ??
            findComponentByPastedText(editor, `${context.activeSelection.selectedHtml}\n${context.instructionText}`)
          : null;

      if (selectedComponent) {
        const replacement = selectedComponent.replaceWith(context.replacementHtml);
        const nextComponent = Array.isArray(replacement) ? replacement[0] : replacement;

        if (nextComponent) {
          editor.select(nextComponent);
          setSelection(makeSelectionPayload(nextComponent));
          setSelectionOrigin("editor");
        }

        setProposal(null);
        setInstruction("");
        setPreviewDraft(null);
        setCopiedContextVisible(false);
        const saved = await saveCurrentDocument();
        if (saved) setStatus("ready");
        return;
      }

      const resolved = resolveProposalHtml(editor, context);

      const applyHtmlChange = async (nextHtml: string, preserveScroll: boolean) => {
        currentCssRef.current = resolved.css;
        if (mode === "edit") {
          applyDocumentToEditor(editor, nextHtml, resolved.css, pageShell);
        } else if (!patchPreviewDocument(nextHtml, resolved.css, pageShell, { preserveScroll })) {
          syncPreviewSrcDoc(nextHtml, resolved.css, pageShell);
        }
        setCurrentHtml(nextHtml);
        setCurrentCss(resolved.css);
        setProposal(null);
        setInstruction("");
        setPreviewDraft(null);
        setSelection(null);
        setSelectionOrigin(null);
        setCopiedContextVisible(false);
        const nextFolderCache = updateFolderCachePage(folderCache, selectedFolderPath, nextHtml, resolved.css, pageShell);
        const saved = await persistDocument({
          html: nextHtml,
          css: resolved.css,
          shell: pageShell,
          projectData: safeGetProjectData(editor),
          folderCache: nextFolderCache ?? undefined
        });
        if (nextFolderCache !== folderCache) setFolderCache(nextFolderCache);
        if (saved) setStatus("ready");
      };

      await applyHtmlChange(resolved.html, resolved.preserveScroll);
    } catch (err) {
      setError(err instanceof Error ? err.message : "应用失败");
      setStatus("error");
    } finally {
      applyingRef.current = false;
      setApplyingEntryId(null);
    }
  }

  function enterEditMode() {
    if (modeSwitchingRef.current || modeRef.current === "edit") return;

    if (previewDraft) {
      clearProposalPreview({ restore: true });
    }

    capturePreviewScroll();
    pendingScrollRestoreRef.current = "edit";
    modeSwitchingRef.current = true;
    setModeTransition("to-edit");

    window.requestAnimationFrame(() => {
      const editor = editorRef.current;
      if (editor) {
        applyDocumentToEditor(editor, currentHtml, currentCss, pageShell);
        applyShellToCanvas(editor, pageShell);
        applyRawCssToCanvas(editor, currentCss);
        syncPanelThemeFromDocument(editor.Canvas.getDocument());
        bindEditorFrameDoubleClick(editor);
        editor.refresh();
        window.setTimeout(() => bindEditorFrameDoubleClick(editor), 80);
        window.setTimeout(() => bindEditorFrameDoubleClick(editor), 220);
      }

      window.requestAnimationFrame(() => {
        modeRef.current = "edit";
        setMode("edit");
        setModeTransition(null);

        window.setTimeout(() => {
          modeSwitchingRef.current = false;
        }, 260);
      });
    });
  }

  function leaveEditMode() {
    if (modeSwitchingRef.current || modeRef.current === "preview") return;

    const editor = editorRef.current;
    if (!editor) {
      modeRef.current = "preview";
      setMode("preview");
      return;
    }

    captureEditorScroll(editor);
    pendingScrollRestoreRef.current = "preview";
    modeSwitchingRef.current = true;
    modeRef.current = "preview";
    const html = getEditorHtmlForSave(editor);
    const css = cleanDocumentCss(currentCss || editor.getCss() || "");
    currentCssRef.current = css;
    setCurrentHtml(html);
    setCurrentCss(css);
    syncPreviewSrcDoc(html, css, pageShell);
    setSelection(null);
    setSelectionOrigin(null);
    setCopiedContextVisible(false);
    setProposal(null);
    setMode("preview");

    void saveDocumentSnapshot({
      html,
      css,
      projectData: safeGetProjectData(editor)
    });

    window.setTimeout(() => {
      modeSwitchingRef.current = false;
    }, 320);
  }

  function bindPreviewFrame() {
    const previewDocument = previewFrameRef.current?.contentDocument;
    if (!previewDocument) return;

    syncPanelThemeFromDocument(previewDocument);
    bindDocumentLinks(previewDocument);
    bindPreviewComponentSelection(previewDocument);
    bindPreviewClipboard(previewDocument);
    bindPreviewToolbarActions(previewDocument);
    if (previewDraft) schedulePreviewDraftToolbar(previewDraft);
    previewDocument.ondblclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      enterEditMode();
    };
    if (!restorePendingImportHash(previewDocument)) {
      restoreScrollSoon(previewDocument, "preview");
    }
  }

  async function importHtmlFile(file: File, fileHandle: FileSystemFileHandleLike | null = null) {
    const editor = editorRef.current;
    if (!editor) return;

    setStatus("loading");
    setError("");

    try {
      const prepared = await prepareFolderHtml([file], file);
      const htmlPath = getRelativePath(file);
      writeHandlesRef.current = fileHandle ? new Map([[getRelativePathKey(htmlPath), fileHandle]]) : new Map();
      standaloneWriteHandleRef.current = fileHandle;
      await savePreparedDocument({
        title: prepared.shell.title || file.name,
        html: prepared.html,
        css: prepared.css,
        shell: prepared.shell,
        folderCache: null
      });
      setFolderFiles([]);
      setFolderCandidates([]);
      setFolderCache(null);
      setSelectedFolderPath(fileHandle ? htmlPath : "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入 HTML 失败");
      setStatus("error");
    }
  }

  async function importFolderPage(files: File[], htmlFile: File, hashTarget = "") {
    const editor = editorRef.current;
    if (!editor) return;

    setStatus("loading");
    setError("");

    try {
      const prepared = await prepareFolderHtml(files, htmlFile);
      const htmlPath = getRelativePath(htmlFile);

      const shell = normalizeShell({ ...prepared.shell, title: prepared.shell.title || htmlPath });
      pendingImportHashRef.current = normalizeHashTarget(hashTarget);
      setSelectedFolderPath(htmlPath);
      await savePreparedDocument({
        title: shell.title,
        html: prepared.html,
        css: prepared.css,
        shell,
        folderCache: folderCache ? { ...folderCache, selectedPath: htmlPath } : undefined
      });
    } catch (err) {
      pendingImportHashRef.current = "";
      setError(err instanceof Error ? err.message : "导入文件夹失败");
      setStatus("error");
    }
  }

  async function openCachedFolderPage(
    page: FolderPagePayload,
    hashTarget = "",
    cacheOverride: FolderCachePayload | null = folderCache
  ) {
    pendingImportHashRef.current = normalizeHashTarget(hashTarget);
    const nextFolderCache = cacheOverride ? { ...cacheOverride, selectedPath: page.path } : null;
    setSelectedFolderPath(page.path);
    await savePreparedDocument({
      title: page.title || page.shell.title || page.path,
      html: page.html,
      css: page.css,
      shell: normalizeShell({ ...page.shell, title: page.shell.title || page.title || page.path }),
      folderCache: nextFolderCache
    });
  }

  async function openFolderCandidate(candidate: FolderCandidate, hashTarget = "") {
    if (candidate.page) {
      await openCachedFolderPage(candidate.page, hashTarget);
      return;
    }

    if (candidate.file) {
      await importFolderPage(folderFiles, candidate.file, hashTarget);
    }
  }

  async function importHtmlFolder(fileList: FileList | null) {
    const files = Array.from(fileList ?? []);
    writeHandlesRef.current = new Map();
    standaloneWriteHandleRef.current = null;
    await importHtmlFolderFiles(files);
  }

  async function importHtmlFolderFiles(files: File[], writeHandles = new Map<string, FileSystemFileHandleLike>()) {
    const htmlFile = chooseDefaultHtmlFile(files);

    if (!htmlFile) {
      setError("这个文件夹里没有找到 .html 文件");
      setStatus("error");
      return;
    }

    writeHandlesRef.current = writeHandles;
    standaloneWriteHandleRef.current = null;

    setStatus("loading");
    setError("");

    const htmlFiles = files.filter((file) => isHtmlPath(getRelativePath(file)));
    const pages = await Promise.all(
      htmlFiles.map(async (file) => {
        const path = getRelativePath(file);
        const prepared = await prepareFolderHtml(files, file);
        const shell = normalizeShell({ ...prepared.shell, title: prepared.shell.title || path });
        return {
          path,
          title: shell.title,
          html: prepared.html,
          css: cleanDocumentCss(prepared.css),
          shell
        } satisfies FolderPagePayload;
      })
    );
    const pageByPath = new Map(pages.map((page) => [getRelativePathKey(page.path), page]));
    const cache: FolderCachePayload = {
      selectedPath: getRelativePath(htmlFile),
      pages: pages.sort((a, b) => a.path.localeCompare(b.path))
    };
    const candidates = cache.pages.map((page) => ({
      path: page.path,
      file: htmlFiles.find((file) => getRelativePathKey(getRelativePath(file)) === getRelativePathKey(page.path)),
      page
    }));

    setFolderFiles(files);
    setFolderCandidates(candidates);
    setFolderCache(cache);

    const defaultPage = pageByPath.get(getRelativePathKey(getRelativePath(htmlFile))) ?? cache.pages[0];
    if (defaultPage) await openCachedFolderPage(defaultPage, "", cache);
  }

  async function chooseHtmlFileImport() {
    const picker = getFilePickerApi().showOpenFilePicker;
    if (!picker) {
      fileInputRef.current?.click();
      return;
    }

    try {
      const [handle] = await picker({
        multiple: false,
        types: [
          {
            description: "HTML",
            accept: { "text/html": [".html", ".htm"] }
          }
        ]
      });

      if (!handle) return;
      const file = withRelativePath(await handle.getFile(), handle.name);
      await importHtmlFile(file, handle);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "导入 HTML 失败");
      setStatus("error");
    }
  }

  async function chooseFolderImport() {
    const picker = getFilePickerApi().showDirectoryPicker;
    if (!picker) {
      folderInputRef.current?.click();
      return;
    }

    try {
      setStatus("loading");
      setError("");
      const directoryHandle = await picker();
      const imported = await readDirectoryHandle(directoryHandle);
      await importHtmlFolderFiles(imported.files, imported.handles);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "导入文件夹失败");
      setStatus("error");
    }
  }

  async function generateFromHome() {
    const trimmed = homePrompt.trim();
    if (!trimmed) {
      setError("先描述你想生成什么 HTML 学习资料");
      setStatus("error");
      return;
    }

    setStatus("thinking");
    setError("");

    try {
      const generated = await api.generate({
        provider,
        instruction: trimmed
      });

      await savePreparedDocument({
        title: generated.title,
        html: generated.html,
        css: generated.css,
        shell: normalizeShell({
          title: generated.title,
          htmlAttrs: { lang: "zh-CN" },
          bodyAttrs: {},
          headHtml: ""
        }),
        folderCache: null
      });
      setHomePrompt("");
      writeHandlesRef.current = new Map();
      standaloneWriteHandleRef.current = null;
      setFolderFiles([]);
      setFolderCandidates([]);
      setFolderCache(null);
      setSelectedFolderPath("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成 HTML 失败");
      setStatus("error");
    }
  }

  async function importCurrentExternalPreview() {
    if (!externalPreviewUrl || importingExternal) return;

    const editor = editorRef.current;
    if (!editor) return;

    setImportingExternal(true);
    setStatus("loading");
    setError("");

    try {
      const sourceUrl = externalPreviewUrl;
      const currentDocumentHtml = mode === "edit" ? getEditorHtmlForSave(editor) : currentHtml;
      const currentDocumentCss = cleanDocumentCss(mode === "edit" ? currentCss || editor.getCss() || "" : currentCss);
      const currentDocumentShell = pageShell;
      const imported = await api.importExternal({ url: sourceUrl });
      const externalShell = normalizeShell({
        title: imported.title,
        htmlAttrs: { lang: "zh-CN" },
        bodyAttrs: {},
        headHtml: `<meta name="growhtml-source-url" content="${sourceUrl.replace(/"/g, "&quot;")}" />`
      });
      const externalPath = makeExternalLocalPath(
        imported.sourceUrl || sourceUrl,
        imported.title,
        folderCache?.pages.map((page) => page.path) ?? [selectedFolderPath || "index.html"]
      );
      const nextFolderCache = addExternalPageToNotebookCache({
        cache: folderCache,
        currentPath: selectedFolderPath || "index.html",
        currentTitle: documentTitle,
        currentHtml: currentDocumentHtml,
        currentCss: currentDocumentCss,
        currentShell: currentDocumentShell,
        externalPath,
        externalTitle: imported.title,
        externalHtml: imported.html,
        externalCss: imported.css,
        externalShell
      });

      if (standaloneWriteHandleRef.current && !selectedFolderPath) {
        writeHandlesRef.current = new Map([
          [getRelativePathKey("index.html"), standaloneWriteHandleRef.current]
        ]);
      }
      standaloneWriteHandleRef.current = null;
      setSelectedFolderPath(externalPath);
      setFolderCandidates(makeFolderCandidatesFromCache(nextFolderCache));
      await savePreparedDocument({
        title: imported.title,
        html: imported.html,
        css: imported.css,
        shell: externalShell,
        folderCache: nextFolderCache
      });
      setExternalPreviewUrl("");
      setStatus("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "外部资料内置失败");
      setStatus("error");
    } finally {
      setImportingExternal(false);
    }
  }

  const showPreviewSurface = mode === "preview" || modeTransition === "to-edit";
  const hideEditorSurface = mode === "preview" && modeTransition !== "to-edit";
  const showSelectionActions = screen === "document" && Boolean(selection) && selectionOrigin !== "chat";
  previewToolbarActionRef.current = (action: string) => {
    if (action === "apply") {
      void applyPreviewDraft();
    } else if (action === "reject") {
      clearProposalPreview();
    } else if (action === "regenerate") {
      void regeneratePreviewDraft();
    } else if (action === "discuss") {
      startPreviewDiscussion();
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="product-name">GrowHTML</p>
          <h1>{screen === "home" ? "GrowHTML" : documentTitle}</h1>
        </div>
        <div className="topbar-actions">
          <input
            ref={fileInputRef}
            className="file-input"
            type="file"
            accept=".html,text/html"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importHtmlFile(file);
              event.currentTarget.value = "";
            }}
          />
          <input
            ref={folderInputRef}
            className="file-input"
            type="file"
            multiple
            onChange={(event) => {
              void importHtmlFolder(event.target.files);
              event.currentTarget.value = "";
            }}
          />
          <span className={`status-pill status-${status}`}>{statusLabel}</span>
          <select
            className="agent-select"
            value={provider}
            onChange={(event) => {
              setProvider(event.target.value as AiProvider);
              setProposal(null);
              setError("");
            }}
            title="选择 AI agent"
          >
            <option value="claude">Claude</option>
            <option value="codex">Codex</option>
          </select>
          {folderCandidates.length > 1 ? (
            <select
              className="page-select"
              value={selectedFolderPath}
              onChange={(event) => {
                const next = folderCandidates.find((candidate) => candidate.path === event.target.value);
                if (next) void openFolderCandidate(next);
              }}
              title="选择文件夹中的 HTML"
            >
              {folderCandidates.map((candidate) => (
                <option key={candidate.path} value={candidate.path}>
                  {candidate.path}
                </option>
              ))}
            </select>
          ) : null}
          <button className="ghost-button" type="button" onClick={() => void chooseHtmlFileImport()}>
            导入 HTML
          </button>
          <button className="ghost-button" type="button" onClick={() => void chooseFolderImport()}>
            导入文件夹
          </button>
          {screen === "document" ? (
            <>
              <button
                className="ghost-button"
                type="button"
                onClick={() => {
                  if (mode === "edit") {
                    leaveEditMode();
                  } else {
                    enterEditMode();
                  }
                }}
              >
                {mode === "edit" ? "预览" : "编辑"}
              </button>
              <button className="ghost-button" type="button" onClick={() => setScreen("home")}>
                首页
              </button>
            </>
          ) : null}
        </div>
      </header>

      {screen === "home" ? (
        <main className="home-screen">
          <section className="home-dialog">
            <p className="product-name">Start</p>
            <h2>生成或导入一份 HTML 学习资料</h2>
            <textarea
              value={homePrompt}
              onChange={(event) => setHomePrompt(event.target.value)}
              placeholder="描述你想生成的学习资料，例如：生成一份 ReSTIR GI 到 UE ShaderSharp 移植教程，带目录、示例、交互区域。"
            />
            <div className="home-actions">
              <button
                className="primary-button"
                type="button"
                onClick={generateFromHome}
                disabled={status === "thinking"}
              >
                生成 HTML
              </button>
              <button className="ghost-button" type="button" onClick={() => void chooseHtmlFileImport()}>
                导入 HTML
              </button>
              <button className="ghost-button" type="button" onClick={() => void chooseFolderImport()}>
                导入文件夹
              </button>
              {currentHtml ? (
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => {
                    setMode("preview");
                    setScreen("document");
                  }}
                >
                  打开当前文档
                </button>
              ) : null}
            </div>
            {error ? <div className="error-box">{error}</div> : null}
          </section>
        </main>
      ) : null}

      <main className={`workspace mode-${mode} ${screen === "home" ? "workspace-hidden" : ""}`} style={workspaceStyle}>
        <section className="canvas-shell">
          {showPreviewSurface ? (
            <div
              className={`preview-surface${modeTransition === "to-edit" ? " preview-surface-hold" : ""}`}
              onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                enterEditMode();
              }}
            >
              <iframe
                ref={previewFrameRef}
                title="GrowHTML preview"
                srcDoc={previewSrcDoc}
                sandbox="allow-scripts allow-forms allow-same-origin"
                onLoad={bindPreviewFrame}
              />
              <div className="preview-hint">双击切换编辑</div>
            </div>
          ) : null}
          <div id="gjs" className={hideEditorSurface ? "editor-hidden" : ""} />
        </section>
        <div
          className="agent-resizer"
          role="separator"
          aria-label="调整 AI 对话栏宽度"
          aria-orientation="vertical"
          tabIndex={0}
          title="拖动调整 AI 对话栏宽度"
          onPointerDown={handleAgentResizePointerDown}
          onKeyDown={handleAgentResizeKeyDown}
        />

        <aside className="agent-panel" style={agentPanelStyle}>
          <section className="panel-section chat-header">
            <p className="section-label">AI</p>
            <div className="thread-id">{currentThreadId ? currentThreadId : "未创建会话"}</div>
          </section>

          <section ref={chatLogRef} className="chat-log" aria-live="polite">
            {chatEntries.length === 0 && !pendingTurn ? (
              <div className="empty-chat">
                把想改的文字或 HTML 贴到底部输入框，AI 的回复会像 Codex 对话一样留在这里。
              </div>
            ) : null}

            {chatEntries.map((entry) => {
              return (
                <div className="chat-turn" key={entry.id}>
                  <article className="chat-message chat-message-user">
                    <div className="chat-meta">
                      你 · {formatTime(entry.createdAt)} · {entry.selectionLabel}
                    </div>
                    <div className="chat-bubble">{entry.instruction}</div>
                  </article>

                  <article className="chat-message chat-message-assistant">
                    <div className="chat-meta">
                      {entry.provider === "claude" ? "Claude" : "Codex"} · {formatTime(entry.createdAt)}
                    </div>
                    <div className="chat-bubble">
                      <div className="chat-summary">{entry.summary}</div>
                      {entry.sources.length > 0 ? (
                        <div className="chat-sources">
                          {entry.sources.map((source) => (
                            <a
                              key={`${entry.id}-${source.title}-${source.url}`}
                              href={source.url}
                              onClick={(event) => {
                                event.preventDefault();
                                openExternalPreview(source.url);
                              }}
                            >
                              {source.title}
                            </a>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </article>
                </div>
              );
            })}

            {pendingTurn ? (
              <div className="chat-turn chat-turn-pending" key={pendingTurn.id}>
                <article className="chat-message chat-message-user">
                  <div className="chat-meta">
                    你 · {formatTime(pendingTurn.createdAt)} · {pendingTurn.selectionLabel}
                  </div>
                  <div className="chat-bubble">{pendingTurn.instruction}</div>
                </article>
                <article className="chat-message chat-message-assistant">
                  <div className="chat-meta">{pendingTurn.provider === "claude" ? "Claude" : "Codex"}</div>
                  <div className="chat-bubble chat-thinking">正在生成...</div>
                </article>
              </div>
            ) : null}
          </section>

          {error ? <div className="error-box chat-error">{error}</div> : null}
          {previewDraft ? (
            <div className="preview-note">
              正在预览 AI 改动，只有点击“应用”才会保存到文档。
            </div>
          ) : null}

          <section className="panel-section prompt-section chat-composer">
            {showSelectionActions ? (
              <div className="selection-action-bar" aria-label="选中内容动作">
                <div className="selection-context-row">
                  <div className="selection-context-chip" title={selection?.label}>
                    已关联：{selection?.tagName}
                  </div>
                  {copiedContextVisible ? (
                    <div className="copied-context-token" title="复制内容已作为隐藏上下文关联到本轮对话">
                      copy
                    </div>
                  ) : null}
                </div>
                <div className="selection-action-buttons">
                  {SELECTION_ACTIONS.map((action) => {
                    const Icon = action.icon;
                    return (
                      <button
                        key={action.id}
                        className="selection-action-button"
                        type="button"
                        title={action.title}
                        aria-label={action.title}
                        onClick={() => void askClaude(action)}
                        disabled={status === "thinking" || applyingEntryId !== null}
                      >
                        <Icon aria-hidden="true" size={16} strokeWidth={2.2} />
                        <span className="sr-only">{action.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
            <textarea
              ref={instructionInputRef}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              onKeyDown={handleInstructionKeyDown}
              onPaste={handleInstructionPaste}
              placeholder={
                copiedContextVisible
                  ? "copy 已关联。可以直接点上方图标，或输入你的补充想法。"
                  : "把想改的文字或 HTML 贴到这里，再写想法。比如：搜索这段内容并补充来源；把这段改成更适合初学者的解释。"
              }
            />
            <button
              className={`primary-button send-button send-button-${provider}`}
              type="button"
              onClick={() => void askClaude()}
              disabled={status === "thinking" || !instruction.trim()}
            >
              发送给 {provider === "claude" ? "Claude" : "Codex"}
            </button>
          </section>
          <section className="panel-section prompt-section">
            <p className="section-label">AI</p>
            <textarea
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              onKeyDown={handleInstructionKeyDown}
              onPaste={handleInstructionPaste}
              placeholder={
                copiedContextVisible
                  ? "copy 已关联。可以继续写你的要求。"
                  : "把你想改的文字或 HTML 贴到这里，再写想法。比如：搜索这段内容并补充来源；把这段改成更适合初学者的解释。"
              }
            />
            <button
              className={`primary-button send-button send-button-${provider}`}
              type="button"
              onClick={() => void askClaude()}
              disabled={status === "thinking" || !instruction.trim()}
            >
              发送给 {provider === "claude" ? "Claude" : "Codex"}
            </button>
          </section>

          {proposal ? (
            <section className="panel-section proposal-section">
              <p className="section-label">Proposal</p>
              <div className="proposal-summary">{proposal.summary}</div>
              <div className="proposal-actions">
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => void applyProposal()}
                  disabled={status === "thinking" || (applyingEntryId !== null && applyingEntryId !== "current-proposal")}
                >
                  {applyingEntryId === "current-proposal" ? "应用中..." : "应用"}
                </button>
                <button className="ghost-button" type="button" onClick={() => setProposal(null)}>
                  丢弃
                </button>
              </div>
              {proposal.sources.length > 0 ? (
                <div className="sources">
                  {proposal.sources.map((source) => (
                    <a
                      key={`${source.title}-${source.url}`}
                      href={source.url}
                      onClick={(event) => {
                        event.preventDefault();
                        openExternalPreview(source.url);
                      }}
                    >
                      {source.title}
                    </a>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {error ? <div className="error-box">{error}</div> : null}

          <section className="panel-section history-section">
            <p className="section-label">Thread</p>
            <div className="thread-id">{currentThreadId ? currentThreadId : "未创建"}</div>
            <div className="history-list">
              {history.slice(0, 5).map((entry) => (
                <article key={entry.id} className="history-item">
                  <div>{entry.summary}</div>
                  <span>
                    {entry.provider} · {formatTime(entry.createdAt)} · {entry.selectionLabel}
                  </span>
                </article>
              ))}
            </div>
          </section>
        </aside>
      </main>

      {externalPreviewUrl ? (
        <section className="external-preview" aria-label="External link preview">
          <div className="external-preview-header">
            <div>
              <p className="section-label">External</p>
              <div className="external-preview-url">{externalPreviewUrl}</div>
            </div>
            <div className="external-preview-actions">
              <button
                className="primary-button external-preview-import"
                type="button"
                onClick={() => void importCurrentExternalPreview()}
                disabled={importingExternal}
              >
                {importingExternal ? "内置中..." : "内置到本地笔记"}
              </button>
              <button
                className="ghost-button"
                type="button"
                onClick={() => window.open(externalPreviewUrl, "_blank", "noopener,noreferrer")}
              >
                外部打开
              </button>
              <button className="ghost-button" type="button" onClick={() => setExternalPreviewUrl("")}>
                关闭
              </button>
            </div>
          </div>
          <div className="external-preview-note">
            如果这里空白或显示拒绝连接，说明目标网站禁止被嵌入 iframe，需要用“外部打开”。
          </div>
          {externalPreviewBlocked ? (
            <div className="external-preview-blocked">
              <div className="external-preview-blocked-card">
                <p className="section-label">Blocked</p>
                <h2>这个网站不允许嵌入预览</h2>
                <p>GitHub 等站点会通过安全策略拒绝 iframe，所以这里不会再显示一大片空白页。</p>
                <button
                  className="primary-button external-preview-open"
                  type="button"
                  onClick={() => window.open(externalPreviewUrl, "_blank", "noopener,noreferrer")}
                >
                  外部打开
                </button>
              </div>
            </div>
          ) : (
            <iframe
              key={externalPreviewUrl}
              title="External link preview"
              src={externalPreviewUrl}
              sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin"
            />
          )}
        </section>
      ) : null}
    </div>
  );
}
