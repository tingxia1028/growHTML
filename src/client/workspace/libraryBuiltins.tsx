// Core Library contributions (LIB-2) — the three built-in sections (最近/文档/文件夹)
// and the built-in `+` menu actions, registered through the SAME registries kits use
// (librarySections.tsx). Importing this module runs the registrations (the
// builtinNoteTypes side-effect idiom); LibraryView renders purely from the registries
// and never special-cases a built-in.
//
// Section bodies reuse the pre-LIB-2 markup (`.source-item` rows, `.folder-tree-host`
// trees) so row styling + behaviors (open / delete / close-folder / active highlight)
// port unchanged; only WHERE they render moved (a registered section, not inline JSX).

import { useState, type ReactNode } from "react";
import { File, FileCode2, FilePlus2, FolderOpen, Globe, Trash2, X } from "lucide-react";
import { baseName, FileTree } from "../FileTree";
import { type SourceRecord } from "../data/entityClient";
import { t, type Message } from "../i18n";
import { libraryMessages as m } from "./libraryMessages";
import { getSourceAuthoringIo } from "./sourceAuthoringIo";
import { sourceAuthoringMessages as sam } from "./sourceAuthoringMessages";
import {
  registerLibraryAddAction,
  registerLibrarySection,
  type LibrarySectionContext
} from "./librarySections";
import type { WorkspaceContext } from "./viewRegistry";

/** How many rows 最近 shows (blessed layout: "3–5 compact rows, one-click open"). */
const RECENT_LIMIT = 5;

function matchesQuery(title: string, query: string): boolean {
  return !query || title.toLowerCase().includes(query);
}

// —— shared source row (ported verbatim from the old Recent Read markup) ————————————

function SourceRow({ source, ctx }: { source: SourceRecord; ctx: WorkspaceContext }) {
  return (
    <div
      className={`source-item${source.id === ctx.activeSourceId ? " active" : ""}`}
      title={[
        source.title,
        `Type: ${source.sourceType}`,
        source.metadata?.originalPath ? `Path: ${source.metadata.originalPath}` : `ID: ${source.id}`
      ].join("\n")}
    >
      <button className="source-item-open" type="button" onClick={() => ctx.setActiveSourceId(source.id)}>
        <File size={15} className="source-item-icon" />
        <span className="source-item-text">
          <span>{source.title}</span>
          <small>
            {source.sourceType} · {source.id}
          </small>
        </span>
      </button>
      <button
        className="source-item-delete"
        type="button"
        title={t(m.removeDocument)}
        aria-label={t(m.removeDocument)}
        onClick={() => void ctx.deleteSourceItem(source.id, source.title)}
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}

// —— 最近 ————————————————————————————————————————————————————————————————————————

function recentRows(ctx: LibrarySectionContext): SourceRecord[] {
  return ctx.workspace.recentSources
    .filter((source) => matchesQuery(source.title, ctx.query))
    .slice(0, RECENT_LIMIT);
}

function RecentSectionBody({ ctx }: { ctx: LibrarySectionContext }) {
  return (
    <div className="source-list recent-source-list">
      {recentRows(ctx).map((source) => (
        <SourceRow key={source.id} source={source} ctx={ctx.workspace} />
      ))}
    </div>
  );
}

// —— 文档 (the NEW full sources list + type filter chips) ————————————————————————————

// Types partition by FILTER CHIP, not by section (per-type sections would shred the
// list). The chip set derives from the sourceTypes actually present — never an
// exhaustive hardcoded list. The two web flavors collapse into one 网页 chip.
function chipKeyFor(sourceType: string): string {
  return sourceType === "webpage" || sourceType === "web_live" ? "web" : sourceType;
}

const CHIP_LABELS: Record<string, Message> = {
  pdf: m.chipPdf,
  web: m.chipWeb,
  image: m.chipImage,
  html: m.chipHtml,
  markdown: m.chipMarkdown,
  word: m.chipWord,
  code: m.chipCode
};

function chipLabel(key: string): string {
  const label = CHIP_LABELS[key];
  return label ? t(label) : key;
}

function documentRows(ctx: LibrarySectionContext): SourceRecord[] {
  return ctx.workspace.sources.filter((source) => matchesQuery(source.title, ctx.query));
}

function DocumentsSectionBody({ ctx }: { ctx: LibrarySectionContext }) {
  const [chip, setChip] = useState("all");
  const docs = documentRows(ctx);
  // Chips reflect the whole library (not the current search), in first-seen order.
  const chipKeys: string[] = [];
  for (const source of ctx.workspace.sources) {
    const key = chipKeyFor(source.sourceType);
    if (!chipKeys.includes(key)) chipKeys.push(key);
  }
  const active = chip === "all" || chipKeys.includes(chip) ? chip : "all";
  const visible = active === "all" ? docs : docs.filter((source) => chipKeyFor(source.sourceType) === active);

  return (
    <div className="library-documents">
      {chipKeys.length > 1 ? (
        <div className="library-chip-row" role="group" aria-label={t(m.typeFilter)}>
          <button
            className={`library-chip${active === "all" ? " active" : ""}`}
            type="button"
            onClick={() => setChip("all")}
          >
            {t(m.chipAll)}
          </button>
          {chipKeys.map((key) => (
            <button
              key={key}
              className={`library-chip${active === key ? " active" : ""}`}
              type="button"
              onClick={() => setChip(key)}
            >
              {chipLabel(key)}
            </button>
          ))}
        </div>
      ) : null}
      <div className="source-list library-doc-list">
        {visible.map((source) => (
          <SourceRow key={source.id} source={source} ctx={ctx.workspace} />
        ))}
        {visible.length === 0 ? <div className="empty-state library-empty">{t(m.noMatches)}</div> : null}
      </div>
    </div>
  );
}

// —— 文件夹 (mounted local folder trees — moved in unchanged) ————————————————————————

function folderRows(ctx: LibrarySectionContext): string[] {
  return ctx.workspace.folderRoots.filter(
    (root) => matchesQuery(baseName(root), ctx.query) || matchesQuery(root, ctx.query)
  );
}

function FoldersSectionBody({ ctx }: { ctx: LibrarySectionContext }) {
  const { closeFolderRoot, openLocalFile, activeFilePath } = ctx.workspace;
  return (
    <div className="open-folder-list">
      {folderRows(ctx).map((root) => (
        <div className="folder-tree-host" key={root}>
          <button
            className="folder-tree-close"
            type="button"
            onClick={() => closeFolderRoot(root)}
            title={t(m.closeFolder)}
            aria-label={t(m.closeFolder)}
          >
            <X size={14} />
          </button>
          <FileTree root={root} onOpenFile={(filePath) => void openLocalFile(filePath)} activePath={activeFilePath} />
        </div>
      ))}
    </div>
  );
}

// —— core section registrations ——————————————————————————————————————————————————————

registerLibrarySection({
  id: "core.recent",
  title: m.sectionRecent,
  order: 10,
  count: (ctx) => recentRows(ctx).length,
  emptyText: m.emptyRecent,
  render: (ctx) => <RecentSectionBody ctx={ctx} />
});

registerLibrarySection({
  id: "core.documents",
  title: m.sectionDocuments,
  order: 20,
  count: (ctx) => documentRows(ctx).length,
  emptyText: m.emptyDocuments,
  render: (ctx) => <DocumentsSectionBody ctx={ctx} />
});

registerLibrarySection({
  id: "core.folders",
  title: m.sectionFolders,
  order: 30,
  count: (ctx) => folderRows(ctx).length,
  emptyText: m.emptyFolders,
  render: (ctx) => <FoldersSectionBody ctx={ctx} />
});

// —— core + menu actions ————————————————————————————————————————————————————————————

const desktopOnly = {
  disabled: (ctx: WorkspaceContext) => !ctx.canOpenLocal,
  disabledHint: m.desktopOnly
};

// 文件… — ONE picker for PDF/图片/HTML/MD/.xmind/…: openFileDialog routes .xmind to the
// mind-map import (WorkspaceContext folds it in), so .xmind is no longer a separate item.
registerLibraryAddAction({
  id: "core.import-file",
  group: "import",
  title: m.importFile,
  icon: <File size={15} />,
  order: 10,
  ...desktopOnly,
  run: (ctx) => void ctx.openFileDialog()
});

// 网页… — the inline URL input + 抓取/实时打开 pair, exactly the old kebab-menu block.
registerLibraryAddAction({
  id: "core.import-web",
  group: "import",
  title: m.importWeb,
  order: 20,
  render: (ctx) => (
    <div className="library-add-web">
      <div className="panel-menu-label">{t(m.importWeb)}</div>
      <input
        className="panel-menu-input"
        value={ctx.importUrl}
        placeholder={t(m.urlPlaceholder)}
        aria-label={t(m.importWeb)}
        onChange={(event) => ctx.setImportUrl(event.target.value)}
      />
      <button className="panel-menu-item" type="button" onClick={() => void ctx.importFromUrl()}>
        <FilePlus2 size={15} />
        {t(m.fetchUrl)}
      </button>
      <button className="panel-menu-item" type="button" onClick={() => void ctx.openLiveUrl()}>
        <Globe size={15} />
        {t(m.openLive)}
      </button>
    </div>
  )
});

registerLibraryAddAction({
  id: "core.mount-folder",
  group: "import",
  title: m.mountFolder,
  icon: <FolderOpen size={15} />,
  order: 30,
  ...desktopOnly,
  run: (ctx) => void ctx.openFolderDialog()
});

// 新建 → the SRC-1 blank-creates (source-authoring.md §4): 新建 Markdown (the default,
// first) + 新建 HTML 页. Both create an AUTHORED source (POST /api/sources/authored —
// origin "authored", the only sources with an editable body) with an untitled title and
// a BLANK body, then open it: the authored editor view starts in 编辑 mode for a blank
// document, so a kid is typing within seconds (no title prompt in the way — the title
// is edited inline in the editor chrome). These supersede the LIB-2 transitional
// 新建→文档 action that borrowed the POST /api/sources/html import seam.
function registerCreateAuthoredAction(input: {
  id: string;
  order: number;
  title: Message;
  icon: ReactNode;
  sourceType: "markdown" | "html";
  newTitle: Message;
}) {
  registerLibraryAddAction({
    id: input.id,
    group: "create",
    title: input.title,
    icon: input.icon,
    order: input.order,
    run: async (ctx) => {
      try {
        const { source } = await getSourceAuthoringIo().createAuthored({
          title: t(input.newTitle),
          sourceType: input.sourceType
        });
        await ctx.loadSources();
        ctx.setActiveSourceId(source.id);
      } catch (error) {
        // The menu fire-and-forgets; surface create failures like other view-level IO.
        console.error("Failed to create document", error);
      }
    }
  });
}

registerCreateAuthoredAction({
  id: "core.create-markdown",
  order: 10,
  title: sam.createMarkdown,
  icon: <FilePlus2 size={15} />,
  sourceType: "markdown",
  newTitle: sam.newMarkdownTitle
});

registerCreateAuthoredAction({
  id: "core.create-html",
  order: 20,
  title: sam.createHtml,
  icon: <FileCode2 size={15} />,
  sourceType: "html",
  newTitle: sam.newHtmlTitle
});
