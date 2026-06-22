import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AiProposal,
  AiProvider,
  DocumentPayload,
  FolderCachePayload,
  PageShell,
  SaveDocumentRequest,
  SelectionPayload,
  SourceLink,
  ThreadEntry
} from "../shared/types";

const rootDir = process.cwd();
const dataDir = path.join(rootDir, "data");
const documentDir = path.join(dataDir, "documents", "main");
const assetDir = path.join(documentDir, "assets");
const htmlPath = path.join(documentDir, "content.html");
const cssPath = path.join(documentDir, "style.css");
const standaloneHtmlPath = path.join(documentDir, "index.html");
const shellPath = path.join(documentDir, "shell.json");
const projectPath = path.join(documentDir, "project.json");
const threadPath = path.join(documentDir, "thread.json");
const folderCachePath = path.join(documentDir, "folder-cache.json");

type ThreadState = {
  threadId?: string | null;
  claudeThreadId: string | null;
  codexThreadId: string | null;
  history: ThreadEntry[];
};

const initialHtml = `<main class="learning-doc" data-ai-id="doc-root">
  <section class="hero" data-ai-id="sec-intro">
    <p class="eyebrow">GrowHTML</p>
    <h1>可生长 HTML 学习资料</h1>
    <p>选中任意章节或卡片，在右侧描述你想补充、搜索或改写的内容。AI 会只针对当前选区生成替换片段。</p>
  </section>

  <section class="note-grid" data-ai-id="sec-workflow">
    <article class="note-card" data-ai-id="card-direct-edit">
      <h2>直接编辑</h2>
      <p>画布由 GrapesJS 驱动，你可以直接点击文字、拖动模块、调整结构。</p>
    </article>
    <article class="note-card" data-ai-id="card-ai-extend">
      <h2>AI 续写</h2>
      <p>选中一个区域后，右侧输入“继续搜索并补充例子”等描述，所选 agent 会在同一文档线程里继续工作。</p>
    </article>
  </section>
</main>`;

const initialCss = `body {
  margin: 0;
  font-family: Inter, "Segoe UI", Arial, sans-serif;
  color: #202124;
  background: #f7f4ef;
}

.learning-doc {
  max-width: 980px;
  margin: 0 auto;
  padding: 56px 32px 88px;
}

.hero {
  padding: 56px 0 36px;
  border-bottom: 1px solid #ddd6ca;
}

.eyebrow {
  margin: 0 0 12px;
  color: #697a49;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
}

h1 {
  margin: 0 0 18px;
  font-size: 44px;
  line-height: 1.12;
}

h2 {
  margin: 0 0 12px;
  font-size: 22px;
}

p {
  font-size: 17px;
  line-height: 1.75;
}

.note-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
  margin-top: 28px;
}

.note-card {
  min-height: 160px;
  padding: 22px;
  border: 1px solid #d9d2c6;
  border-radius: 8px;
  background: #ffffff;
}

@media (max-width: 760px) {
  .learning-doc {
    padding: 32px 18px 64px;
  }

  h1 {
    font-size: 34px;
  }

  .note-grid {
    grid-template-columns: 1fr;
  }
}`;

const defaultShell: PageShell = {
  title: "GrowHTML Document",
  htmlAttrs: { lang: "zh-CN" },
  bodyAttrs: {},
  headHtml: ""
};

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function normalizeThreadState(thread: Partial<ThreadState>): ThreadState {
  return {
    claudeThreadId: thread.claudeThreadId ?? thread.threadId ?? null,
    codexThreadId: thread.codexThreadId ?? null,
    history: thread.history ?? []
  };
}

async function readText(filePath: string, fallback: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return fallback;
  }
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

function normalizeShell(shell: Partial<PageShell> | null | undefined): PageShell {
  return {
    title: shell?.title || defaultShell.title,
    htmlAttrs: shell?.htmlAttrs ?? defaultShell.htmlAttrs,
    bodyAttrs: shell?.bodyAttrs ?? defaultShell.bodyAttrs,
    headHtml: shell?.headHtml ?? defaultShell.headHtml
  };
}

function buildStandaloneHtml(html: string, css: string, shell: PageShell) {
  const htmlAttrs = serializeAttributes(shell.htmlAttrs);
  const bodyAttrs = serializeAttributes(shell.bodyAttrs);

  return `<!doctype html>
<html${htmlAttrs ? ` ${htmlAttrs}` : ""}>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${shell.title}</title>
${shell.headHtml}
    <style>
${css}
    </style>
  </head>
  <body${bodyAttrs ? ` ${bodyAttrs}` : ""}>
${html}
  </body>
</html>
`;
}

export async function ensureStorage() {
  await mkdir(documentDir, { recursive: true });
  await mkdir(assetDir, { recursive: true });

  const html = await readText(htmlPath, "");
  if (!html) {
    await writeFile(htmlPath, initialHtml, "utf8");
  }

  const css = await readText(cssPath, "");
  if (!css) {
    await writeFile(cssPath, initialCss, "utf8");
  }

  const standaloneHtml = await readText(standaloneHtmlPath, "");
  if (!standaloneHtml) {
    await writeFile(standaloneHtmlPath, buildStandaloneHtml(initialHtml, initialCss, defaultShell), "utf8");
  }

  const shell = await readText(shellPath, "");
  if (!shell) {
    await writeFile(shellPath, JSON.stringify(defaultShell, null, 2), "utf8");
  }

  const thread = await readText(threadPath, "");
  if (!thread) {
    await writeFile(
      threadPath,
      JSON.stringify(
        { claudeThreadId: null, codexThreadId: null, history: [] } satisfies ThreadState,
        null,
        2
      ),
      "utf8"
    );
  }
}

export async function loadDocument(): Promise<DocumentPayload> {
  await ensureStorage();

  const html = await readText(htmlPath, initialHtml);
  const css = await readText(cssPath, initialCss);
  const shell = normalizeShell(await readJson<Partial<PageShell> | null>(shellPath, defaultShell));
  const projectData = await readJson<unknown | null>(projectPath, null);
  const thread = await loadThread();
  const folderCache = await readJson<FolderCachePayload | null>(folderCachePath, null);

  return {
    documentId: "main",
    title: shell.title,
    html,
    css,
    shell,
    projectData,
    threadId: thread.claudeThreadId,
    threads: {
      claude: thread.claudeThreadId,
      codex: thread.codexThreadId
    },
    history: thread.history,
    folderCache
  };
}

export async function saveDocument(input: SaveDocumentRequest) {
  await ensureStorage();
  const shell = normalizeShell(input.shell);
  await writeFile(htmlPath, input.html, "utf8");
  await writeFile(cssPath, input.css, "utf8");
  await writeFile(shellPath, JSON.stringify(shell, null, 2), "utf8");
  await writeFile(standaloneHtmlPath, buildStandaloneHtml(input.html, input.css, shell), "utf8");
  await writeFile(projectPath, JSON.stringify(input.projectData ?? null, null, 2), "utf8");
  if (input.folderCache !== undefined) {
    await writeFile(folderCachePath, JSON.stringify(input.folderCache, null, 2), "utf8");
  }
}

export async function loadThread(): Promise<ThreadState> {
  await ensureStorage();
  return normalizeThreadState(
    await readJson<Partial<ThreadState>>(threadPath, {
      claudeThreadId: null,
      codexThreadId: null,
      history: []
    })
  );
}

export async function saveThread(thread: ThreadState) {
  await ensureStorage();
  await writeFile(threadPath, JSON.stringify(thread, null, 2), "utf8");
}

export async function setThreadId(provider: AiProvider, threadId: string | null) {
  const thread = await loadThread();
  if (provider === "claude") {
    thread.claudeThreadId = threadId;
  } else {
    thread.codexThreadId = threadId;
  }
  await saveThread(thread);
}

export async function appendHistory(input: {
  provider: AiProvider;
  selectionLabel: string;
  selection: SelectionPayload;
  instruction: string;
  summary: string;
  sources: SourceLink[];
  proposal: AiProposal;
}) {
  const thread = await loadThread();
  const entry: ThreadEntry = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    provider: input.provider,
    selectionLabel: input.selectionLabel,
    selection: input.selection,
    instruction: input.instruction,
    summary: input.summary,
    sources: input.sources,
    proposal: input.proposal
  };

  thread.history = [entry, ...thread.history].slice(0, 20);
  await saveThread(thread);
  return thread.history;
}

export function getDocumentWorkspace() {
  return documentDir;
}

export function getDocumentAssetDir() {
  return assetDir;
}
