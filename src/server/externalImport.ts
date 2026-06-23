import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ImportExternalRequest, ImportExternalResponse } from "../shared/types";

const MAX_WEBPAGE_BYTES = 24 * 1024 * 1024;
const MAX_PDF_BYTES = 256 * 1024 * 1024;

type ImportExternalOptions = {
  assetDir: string;
  assetBaseUrl: string;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function extractTagContent(html: string, tagName: string) {
  const match = html.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match?.[1]?.trim() ?? "";
}

function extractTitle(html: string, fallback: string) {
  const rawTitle = extractTagContent(html, "title").replace(/\s+/g, " ").trim();
  return rawTitle ? stripTags(rawTitle).slice(0, 160) : fallback;
}

function stripTags(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function slugifyFilename(input: string, fallback: string) {
  const slug = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);

  return slug || fallback;
}

async function saveExternalAsset(input: {
  assetDir: string;
  assetBaseUrl: string;
  sourceUrl: string;
  title: string;
  extension: string;
  bytes: ArrayBuffer;
}) {
  await mkdir(input.assetDir, { recursive: true });

  const buffer = Buffer.from(input.bytes);
  const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 16);
  const stem = slugifyFilename(input.title || new URL(input.sourceUrl).hostname, "external-resource");
  const extension = input.extension.replace(/^\.+/, "") || "bin";
  const filename = `${stem}-${hash}.${extension}`;
  const filePath = path.join(input.assetDir, filename);

  await writeFile(filePath, buffer);

  return {
    filename,
    url: `${input.assetBaseUrl.replace(/\/$/, "")}/${encodeURIComponent(filename)}`
  };
}

function absolutizeAttributes(html: string, baseUrl: string) {
  return html.replace(/\b(href|src|poster|action)=("|')([^"']+)\2/gi, (full, attr: string, quote: string, value: string) => {
    if (/^(?:data:|blob:|mailto:|tel:|javascript:|#)/i.test(value)) return full;

    try {
      return `${attr}=${quote}${new URL(value, baseUrl).toString()}${quote}`;
    } catch {
      return full;
    }
  });
}

function sanitizeBody(html: string, baseUrl: string) {
  const body = extractTagContent(html, "body") || html;
  return absolutizeAttributes(body, baseUrl)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*("|')[\s\S]*?\1/gi, "")
    .replace(/\s+srcdoc\s*=\s*("|')[\s\S]*?\1/gi, "")
    .trim();
}

function extractInlineStyles(html: string) {
  return Array.from(html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi))
    .map((match) => match[1].trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 70000);
}

function baseDocumentCss() {
  return `
:root {
  color: #17202a;
  background: #f2f5f1;
  font-family: Inter, "Segoe UI", Arial, sans-serif;
}

body {
  margin: 0;
  color: #17202a;
  background: #f2f5f1;
}

.external-note-document {
  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(180px, 260px) minmax(0, 1fr);
}

.external-note-document-compact {
  display: block;
  grid-template-columns: none;
  min-height: auto;
}

.external-note-rail {
  position: sticky;
  top: 0;
  align-self: start;
  height: 100vh;
  overflow: auto;
  padding: 28px 22px;
  color: #dce8df;
  background: #121a20;
}

.external-note-rail a {
  color: #83b7ff;
  overflow-wrap: anywhere;
}

.external-note-rail h1 {
  margin: 0 0 12px;
  font-size: 18px;
  line-height: 1.3;
}

.external-note-meta {
  margin: 0 0 18px;
  color: #a8b8ae;
  font-size: 12px;
  line-height: 1.6;
}

.external-note-list {
  display: grid;
  gap: 10px;
  margin-top: 18px;
}

.external-note-card {
  min-height: 72px;
  padding: 12px;
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 8px;
  color: #dce8df;
  background: rgba(255, 255, 255, 0.04);
}

.external-note-content {
  min-width: 0;
  padding: 42px min(6vw, 72px);
}

.external-note-document-compact .external-note-content {
  padding: 22px min(4vw, 48px) 42px;
}

.external-page-body,
.external-pdf-panel {
  max-width: 980px;
  margin: 0 auto;
}

.external-pdf-panel {
  width: min(100%, 1120px);
  max-width: none;
}

.external-page-body img,
.external-page-body video {
  max-width: 100%;
  height: auto;
}

.external-page-body a {
  color: #1f6feb;
}

.external-pdf-viewport {
  position: relative;
  width: 100%;
  height: 1120px;
  min-height: 680px;
  border: 1px solid #cbd4ce;
  border-radius: 8px;
  overflow: hidden;
  background: #ffffff;
}

.external-pdf-frame {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
}

.external-note-callout {
  margin: 0 0 18px;
  padding: 12px 14px;
  border: 1px solid #cbd4ce;
  border-radius: 8px;
  color: #3b463f;
  background: #fbfbf8;
}

.external-note-source {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin: 0 0 14px;
  padding: 10px 12px;
  border: 1px solid #cbd4ce;
  border-radius: 8px;
  color: #3b463f;
  background: #fbfbf8;
}

.external-note-source strong {
  display: block;
  color: #17202a;
  font-size: 13px;
  line-height: 1.35;
}

.external-note-source span {
  color: #64756d;
  font-size: 12px;
}

.external-note-source a {
  color: #1f6feb;
  font-size: 12px;
  overflow-wrap: anywhere;
  text-align: right;
}

@media (max-width: 900px) {
  .external-note-document {
    grid-template-columns: 1fr;
  }

  .external-note-rail {
    position: relative;
    height: auto;
  }
}
`;
}

function buildWebpageImport(input: {
  url: string;
  html: string;
  fallbackTitle: string;
}): ImportExternalResponse {
  const title = extractTitle(input.html, input.fallbackTitle);
  const body = sanitizeBody(input.html, input.url);
  const inlineStyles = extractInlineStyles(input.html);

  return {
    title,
    sourceUrl: input.url,
    kind: "webpage",
    summary: "已把外部网页保存成本地 GrowHTML 笔记页，可继续阅读、搜索、标注和做笔记。",
    css: `${baseDocumentCss()}\n\n/* Imported inline styles */\n${inlineStyles}`.trim(),
    html: `
<article class="external-note-document" data-source-url="${escapeHtml(input.url)}">
  <aside class="external-note-rail">
    <h1>${escapeHtml(title)}</h1>
    <p class="external-note-meta">本地网页笔记<br /><a href="${escapeHtml(input.url)}">${escapeHtml(input.url)}</a></p>
    <div class="external-note-list">
      <div class="external-note-card" contenteditable="true">在这里写这篇资料的摘要、问题或待搜索点。</div>
      <div class="external-note-card" contenteditable="true">复制正文句子到右侧 AI，可以搜索并生成悬浮标注。</div>
    </div>
  </aside>
  <main class="external-note-content">
    <div class="external-note-callout">这份网页已经内置成本地 HTML。正文里的文字可以复制到右侧 AI 对话框，继续搜索、标注和应用。</div>
    <section class="external-page-body">
${body}
    </section>
  </main>
</article>`.trim()
  };
}

function buildPdfImport(input: {
  url: string;
  title: string;
  mimeType: string;
  bytes: ArrayBuffer;
}): ImportExternalResponse {
  const base64 = Buffer.from(input.bytes).toString("base64");
  const dataUrl = `data:${input.mimeType || "application/pdf"};base64,${base64}`;

  return {
    title: input.title,
    sourceUrl: input.url,
    kind: "pdf",
    summary: "已把 PDF 内置成本地阅读页，并加入笔记区。PDF 原生页面的逐字标注需要后续文本层转换。",
    css: baseDocumentCss(),
    html: `
<article class="external-note-document external-note-document-compact" data-source-url="${escapeHtml(input.url)}">
  <main class="external-note-content">
    <section class="external-pdf-panel">
      <div class="external-note-source" contenteditable="false">
        <div><strong>${escapeHtml(input.title)}</strong><span>Local PDF</span></div>
        <a href="${escapeHtml(input.url)}">source</a>
      </div>
      <iframe class="external-pdf-frame" src="${dataUrl}" title="${escapeHtml(input.title)}"></iframe>
    </section>
  </main>
</article>`.trim()
  };
}

function buildLocalPdfImport(input: {
  url: string;
  title: string;
  assetUrl: string;
  byteLength: number;
}): ImportExternalResponse {
  return {
    title: input.title,
    sourceUrl: input.url,
    kind: "pdf",
    summary:
      "PDF downloaded into the local GrowHTML notebook. The note shell is editable; native PDF text can be searched and copied into the AI panel.",
    css: baseDocumentCss(),
    html: `
<article class="external-note-document external-note-document-compact" data-source-url="${escapeHtml(input.url)}">
  <main class="external-note-content">
    <section class="external-pdf-panel">
      <div class="external-note-source" contenteditable="false">
        <div><strong>${escapeHtml(input.title)}</strong><span>Local PDF · ${Math.round(input.byteLength / 1024 / 1024)} MB</span></div>
        <a href="${escapeHtml(input.url)}">source</a>
      </div>
      <div class="external-pdf-viewport">
        <iframe class="external-pdf-frame" src="${escapeHtml(input.assetUrl)}" title="${escapeHtml(input.title)}"></iframe>
      </div>
    </section>
  </main>
</article>`.trim()
  };
}

export async function importExternalResource(
  request: ImportExternalRequest,
  options: ImportExternalOptions
): Promise<ImportExternalResponse> {
  const url = new URL(request.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http/https URLs can be imported.");
  }

  const response = await fetch(url, {
    headers: {
      "user-agent": "GrowHTML/0.1 local note importer"
    }
  });

  if (!response.ok) {
    throw new Error(`External resource returned ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const fallbackTitle = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? url.hostname);
  const isPdf = /application\/pdf/i.test(contentType) || /\.pdf(?:$|\?)/i.test(url.pathname);
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  const maxBytes = isPdf ? MAX_PDF_BYTES : MAX_WEBPAGE_BYTES;

  if (contentLength > maxBytes) {
    throw new Error(
      isPdf
        ? "This PDF is larger than GrowHTML's local download limit."
        : "This external resource is too large to inline as a local note."
    );
  }

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > maxBytes) {
    throw new Error(
      isPdf
        ? "This PDF is larger than GrowHTML's local download limit."
        : "This external resource is too large to inline as a local note."
    );
  }

  if (isPdf) {
    const asset = await saveExternalAsset({
      assetDir: options.assetDir,
      assetBaseUrl: options.assetBaseUrl,
      sourceUrl: url.toString(),
      title: fallbackTitle || "Imported PDF",
      extension: "pdf",
      bytes
    });

    return buildLocalPdfImport({
      url: url.toString(),
      title: fallbackTitle || "Imported PDF",
      assetUrl: asset.url,
      byteLength: bytes.byteLength
    });
  }

  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return buildWebpageImport({
    url: url.toString(),
    html: text,
    fallbackTitle: fallbackTitle || url.hostname
  });
}
