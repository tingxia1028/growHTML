// AuthoredSourceView — the SRC-1/2 editor-capable surface for AUTHORED sources.
// Its OWN chrome hosts the 阅读 ⇄ 编辑 toggle (source-authoring.md §4: "own chrome
// hosts the toggle — avoids reader files"); 阅读 renders the normal reader node the
// host resolved, 编辑 renders the kid-first editor:
//   markdown → big toolbar buttons (加粗/标题/列表/引用 — zero syntax knowledge
//              needed) + a plain textarea + a LIVE preview rendered by the SAME
//              markdown renderer the reader path uses (adapters/notes/render).
//   html     → SRC-2b 所见即改: the page itself is the editor (HtmlInPlaceEditor —
//              contenteditable iframe + floating style bar; the DEFAULT), with a 源码
//              sub-toggle for the raw source editor + sandboxed live preview. Both
//              feed the SAME draft; the in-place DOM is serialized through the light
//              sanitizer before it ever reaches the pipeline. GrapesJS-grade rich
//              editing stays SRC-4.
// Saving runs the SRC-2 pipeline server-side (re-hash → revision bump → re-project
// anchors by quote+context); anchors that no longer match surface here as the
// 受影响的锚点 list. A true WYSIWYG (TipTap) is the recorded V1.1 follow-up.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Bold,
  BookOpen,
  Code,
  Heading1,
  Heading2,
  List,
  ListOrdered,
  Pencil,
  Quote,
  Save,
  TextCursorInput
} from "lucide-react";
import { renderMarkdownSourcePreview } from "../sourcePreview";
import { t } from "../i18n";
import type { SourceRecord } from "../data/entityClient";
import { useWorkspace } from "./WorkspaceContext";
import { sourceAuthoringMessages as m } from "./sourceAuthoringMessages";
import {
  getSourceAuthoringIo,
  type ReprojectedAnchorInfo
} from "./sourceAuthoringIo";
import { HtmlInPlaceEditor, type HtmlInPlaceHandle } from "./HtmlInPlaceEditor";
import "./sourceEditor.css";

// —— the kid-first toolbar transform (pure; unit-tested directly) ————————————————————

export type MarkdownToolbarAction = "bold" | "heading" | "subheading" | "list" | "ordered" | "quote";

type ToolbarPlaceholders = { bold: string; heading: string; listItem: string; quote: string };

type ApplyResult = { value: string; selectionStart: number; selectionEnd: number };

const HEADING_PREFIX = /^#{1,6} /;
const LIST_PREFIX = /^(?:- |\d+\. )/;
const QUOTE_PREFIX = /^> /;

/**
 * Apply a toolbar action to the textarea value: wrap the selection (bold) or
 * prefix the selected lines (headings/lists/quote). Pressing the same button on an
 * already-formatted line toggles the format off — a kid can always "un-click".
 * An empty selection inserts a selected placeholder so typing replaces it.
 */
export function applyMarkdownAction(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  action: MarkdownToolbarAction,
  placeholders: ToolbarPlaceholders
): ApplyResult {
  if (action === "bold") {
    const selected = value.slice(selectionStart, selectionEnd);
    const text = selected || placeholders.bold;
    const next = `${value.slice(0, selectionStart)}**${text}**${value.slice(selectionEnd)}`;
    return { value: next, selectionStart: selectionStart + 2, selectionEnd: selectionStart + 2 + text.length };
  }

  // Line-prefix actions operate on every line the selection touches.
  const lineStart = value.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
  const lineEndIndex = value.indexOf("\n", selectionEnd);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
  const block = value.slice(lineStart, lineEnd);
  const lines = block.split("\n");

  const placeholderFor = (kind: MarkdownToolbarAction) =>
    kind === "heading" || kind === "subheading"
      ? placeholders.heading
      : kind === "quote"
        ? placeholders.quote
        : placeholders.listItem;

  const transformed = lines.map((line, index) => {
    if (action === "heading" || action === "subheading") {
      const prefix = action === "heading" ? "# " : "## ";
      const stripped = line.replace(HEADING_PREFIX, "");
      const had = line.startsWith(prefix) && line.length - stripped.length === prefix.length;
      if (had) return stripped; // toggle off
      const body = stripped || (lines.length === 1 ? placeholderFor(action) : stripped);
      return `${prefix}${body}`;
    }
    if (action === "list" || action === "ordered") {
      const stripped = line.replace(LIST_PREFIX, "");
      const prefix = action === "list" ? "- " : `${index + 1}. `;
      const had = action === "list" ? line.startsWith("- ") : /^\d+\. /.test(line);
      if (had) return stripped; // toggle off
      const body = stripped || (lines.length === 1 ? placeholderFor(action) : stripped);
      return `${prefix}${body}`;
    }
    // quote
    const stripped = line.replace(QUOTE_PREFIX, "");
    if (QUOTE_PREFIX.test(line)) return stripped; // toggle off
    const body = stripped || (lines.length === 1 ? placeholderFor(action) : stripped);
    return `> ${body}`;
  });

  const nextBlock = transformed.join("\n");
  const next = `${value.slice(0, lineStart)}${nextBlock}${value.slice(lineEnd)}`;
  return { value: next, selectionStart: lineStart, selectionEnd: lineStart + nextBlock.length };
}

// —— shared-warning memory: warn once per source per session ————————————————————————

const confirmedSharedEdits = new Set<string>();

/** Test seam: forget which sources already confirmed the shared-edit warning. */
export function resetSharedEditConfirmationsForTests(): void {
  confirmedSharedEdits.clear();
}

// —— the view ————————————————————————————————————————————————————————————————————————

type EditorMode = "read" | "edit";
/** How an authored HTML source is edited: in place on the page (default) or as raw source. */
type HtmlEditView = "page" | "source";

export function AuthoredSourceView({ source, reader }: { source: SourceRecord; reader: ReactNode }) {
  const ctx = useWorkspace();
  const io = getSourceAuthoringIo();

  const [mode, setMode] = useState<EditorMode>("read");
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [titleDraft, setTitleDraft] = useState(source.title);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState("");
  const [affected, setAffected] = useState<ReprojectedAnchorInfo[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // SRC-2b: the html in-place surface. `htmlView` picks 页面编辑 (default) vs 源码;
  // `inPlaceDirty` marks unserialized in-place edits (the live DOM is the draft's
  // source of truth until we pull it out through the handle below).
  const [htmlView, setHtmlView] = useState<HtmlEditView>("page");
  const [inPlaceDirty, setInPlaceDirty] = useState(false);
  const inPlaceRef = useRef<HtmlInPlaceHandle | null>(null);

  const isMarkdown = source.sourceType === "markdown";
  const dirty = loaded && (draft !== savedContent || titleDraft !== source.title || inPlaceDirty);

  /** Serialize the LIVE in-place DOM (sanitized) into the draft; returns the text,
      or null when the in-place frame isn't mounted (source view / markdown / read). */
  const syncDraftFromInPlace = (): string | null => {
    const serialized = inPlaceRef.current?.serialize() ?? null;
    if (serialized !== null) setDraft(serialized);
    return serialized;
  };

  // Load the RAW stored content when the active source changes. A blank body means a
  // freshly created document — open straight into 编辑 so a kid is typing in seconds.
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setError("");
    setAffected([]);
    setTitleDraft(source.title);
    setHtmlView("page");
    setInPlaceDirty(false);
    io.fetchContent(source.id)
      .then((content) => {
        if (cancelled) return;
        setDraft(content);
        setSavedContent(content);
        setLoaded(true);
        if (!content.trim()) setMode("edit");
        else setMode("read");
      })
      .catch(() => {
        if (!cancelled) setError(t(m.loadFailed));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload per source only
  }, [source.id]);

  const enterEdit = async () => {
    if (mode === "edit") return;
    setError("");
    // Shared-source warning before the FIRST edit of a shared document (§2.2).
    if (!confirmedSharedEdits.has(source.id)) {
      try {
        const status = await io.fetchShareStatus(source.id);
        if (status.shared && !window.confirm(t(m.sharedEditWarning))) return;
      } catch {
        // Status unavailable → don't block editing on the warning lookup.
      }
      confirmedSharedEdits.add(source.id);
    }
    setMode("edit");
  };

  // Leaving 编辑 unmounts the in-place frame — pull its edits into the draft first so
  // nothing is lost (the 未保存 state survives the 阅读 round-trip, like markdown's).
  const showRead = () => {
    syncDraftFromInPlace();
    setMode("read");
  };

  // 页面编辑 ⇄ 源码 (SRC-2b): both edit the SAME draft. Into 源码 → serialize the live
  // DOM; back into 页面编辑 → the frame remounts from the (possibly hand-edited) draft.
  const showHtmlSource = () => {
    if (htmlView === "source") return;
    syncDraftFromInPlace();
    setHtmlView("source");
  };

  const showHtmlPage = () => {
    if (htmlView === "page") return;
    setHtmlView("page");
  };

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setError("");
    try {
      // In-place html edits live in the frame's DOM — serialize (light sanitize
      // included) NOW so the pipeline gets exactly what the page shows.
      const content = syncDraftFromInPlace() ?? draft;
      const outcome = await io.saveContent(source.id, {
        content,
        title: titleDraft.trim() && titleDraft !== source.title ? titleDraft.trim() : undefined
      });
      setSavedContent(content);
      setInPlaceDirty(false);
      setAffected(outcome.reprojection.anchors.filter((anchor) => anchor.status !== "matched"));
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2000);
      // Reflect the new content + re-projected anchors in the reader/painting, and
      // the (possibly renamed) title in the Library list.
      await ctx.reloadActiveSource();
      if (outcome.source.title !== source.title) await ctx.loadSources();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t(m.saveFailed));
    } finally {
      setSaving(false);
    }
  };

  const runToolbar = (action: MarkdownToolbarAction) => {
    const textarea = textareaRef.current;
    const placeholders: ToolbarPlaceholders = {
      bold: t(m.boldPlaceholder),
      heading: t(m.headingPlaceholder),
      listItem: t(m.listItemPlaceholder),
      quote: t(m.quotePlaceholder)
    };
    const start = textarea?.selectionStart ?? draft.length;
    const end = textarea?.selectionEnd ?? draft.length;
    const result = applyMarkdownAction(draft, start, end, action, placeholders);
    setDraft(result.value);
    const restore = () => {
      if (!textareaRef.current) return;
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(result.selectionStart, result.selectionEnd);
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(restore);
    else window.setTimeout(restore, 0);
  };

  const previewHtml = useMemo(
    () => (isMarkdown ? renderMarkdownSourcePreview(draft) : ""),
    [isMarkdown, draft]
  );

  const jumpToReader = (anchorId: string) => {
    showRead();
    const anchor = ctx.anchors.find((item) => item.id === anchorId);
    if (anchor) ctx.focus.setAnchor(anchor);
  };

  const toolbarButtons: Array<{ action: MarkdownToolbarAction; icon: ReactNode; label: string }> = [
    { action: "heading", icon: <Heading1 size={18} />, label: t(m.toolbarHeading) },
    { action: "subheading", icon: <Heading2 size={18} />, label: t(m.toolbarSubheading) },
    { action: "bold", icon: <Bold size={18} />, label: t(m.toolbarBold) },
    { action: "list", icon: <List size={18} />, label: t(m.toolbarList) },
    { action: "ordered", icon: <ListOrdered size={18} />, label: t(m.toolbarOrderedList) },
    { action: "quote", icon: <Quote size={18} />, label: t(m.toolbarQuote) }
  ];

  return (
    <div className="source-editor-host" data-mode={mode}>
      <div className="source-editor-bar">
        <div className="source-editor-modes" role="group" aria-label="阅读/编辑">
          <button
            className={`source-editor-mode-btn${mode === "read" ? " active" : ""}`}
            type="button"
            onClick={showRead}
          >
            <BookOpen size={15} />
            {t(m.modeRead)}
          </button>
          <button
            className={`source-editor-mode-btn${mode === "edit" ? " active" : ""}`}
            type="button"
            onClick={() => void enterEdit()}
          >
            <Pencil size={15} />
            {t(m.modeEdit)}
          </button>
        </div>
        {mode === "edit" ? (
          <>
            <input
              className="source-editor-title"
              value={titleDraft}
              aria-label={t(m.titleLabel)}
              placeholder={t(m.titleLabel)}
              onChange={(event) => setTitleDraft(event.target.value)}
            />
            {dirty ? <span className="source-editor-dirty">{t(m.unsaved)}</span> : null}
            {!dirty && savedFlash ? <span className="source-editor-saved">{t(m.savedJustNow)}</span> : null}
            <button
              className="source-editor-save"
              type="button"
              disabled={!dirty || saving}
              onClick={() => void save()}
            >
              <Save size={15} />
              {saving ? t(m.saving) : t(m.save)}
            </button>
          </>
        ) : null}
      </div>

      {error ? <div className="source-editor-error">{error}</div> : null}

      {mode === "edit" && affected.length > 0 ? (
        <div className="source-editor-affected">
          <div className="source-editor-affected-head">
            <strong>{t(m.affectedTitle)}</strong>
            <button className="source-editor-affected-dismiss" type="button" onClick={() => setAffected([])}>
              {t(m.affectedDismiss)}
            </button>
          </div>
          <p className="source-editor-affected-hint">{t(m.affectedHint)}</p>
          <ul>
            {affected.map((anchor) => (
              <li key={anchor.anchorId} className="source-editor-affected-row">
                <span className={`source-editor-affected-status is-${anchor.status}`}>
                  {anchor.status === "fuzzy" ? t(m.affectedFuzzy) : t(m.affectedUnmatched)}
                </span>
                <span className="source-editor-affected-quote">{anchor.quote}</span>
                <button
                  className="source-editor-affected-jump"
                  type="button"
                  onClick={() => jumpToReader(anchor.anchorId)}
                >
                  {t(m.affectedJump)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {mode === "read" ? (
        savedContent.trim() || !loaded ? (
          <div className="source-editor-reader">{reader}</div>
        ) : (
          <div className="source-editor-empty">{t(m.emptyReadHint)}</div>
        )
      ) : isMarkdown ? (
        <div className="source-editor-markdown">
          <div className="source-editor-toolbar" role="toolbar" aria-label={t(m.modeEdit)}>
            {toolbarButtons.map((button) => (
              <button
                key={button.action}
                className="source-editor-tool"
                type="button"
                data-md-action={button.action}
                onClick={() => runToolbar(button.action)}
              >
                {button.icon}
                <span>{button.label}</span>
              </button>
            ))}
          </div>
          <div className="source-editor-split">
            <textarea
              ref={textareaRef}
              className="source-editor-input"
              value={draft}
              placeholder={t(m.editorPlaceholder)}
              aria-label={t(m.modeEdit)}
              onChange={(event) => setDraft(event.target.value)}
            />
            <div className="source-editor-preview" aria-label={t(m.previewTitle)}>
              <div className="source-editor-preview-head">{t(m.previewTitle)}</div>
              {draft.trim() ? (
                <div
                  className="source-editor-preview-body"
                  // renderNoteContent escapes first and only introduces its own tags —
                  // the same sanitized renderer note cards feed into innerHTML.
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              ) : (
                <div className="source-editor-preview-empty">{t(m.previewEmpty)}</div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="source-editor-html">
          <div className="source-editor-html-head">
            <div className="source-editor-html-views" role="group" aria-label={t(m.modeEdit)}>
              <button
                className={`source-editor-html-view-btn${htmlView === "page" ? " active" : ""}`}
                type="button"
                data-html-view="page"
                onClick={showHtmlPage}
              >
                <TextCursorInput size={14} />
                {t(m.htmlViewPage)}
              </button>
              <button
                className={`source-editor-html-view-btn${htmlView === "source" ? " active" : ""}`}
                type="button"
                data-html-view="source"
                onClick={showHtmlSource}
              >
                <Code size={14} />
                {t(m.htmlViewSource)}
              </button>
            </div>
            <div className="source-editor-html-hint">
              {htmlView === "page" ? t(m.inPlaceHint) : t(m.htmlEditorHint)}
            </div>
          </div>
          {htmlView === "page" ? (
            // Keyed per source AND load generation: a source switch (or its content
            // fetch landing) always re-arms a fresh editing frame — the component
            // reads `html` once on mount by design.
            <HtmlInPlaceEditor
              key={`${source.id}:${loaded ? "loaded" : "loading"}`}
              ref={inPlaceRef}
              html={draft}
              onInput={() => setInPlaceDirty(true)}
            />
          ) : (
            <div className="source-editor-split">
              <textarea
                ref={textareaRef}
                className="source-editor-input source-editor-input-html"
                value={draft}
                placeholder={t(m.htmlEditorPlaceholder)}
                aria-label={t(m.modeEdit)}
                onChange={(event) => setDraft(event.target.value)}
                spellCheck={false}
              />
              <div className="source-editor-preview" aria-label={t(m.previewTitle)}>
                <div className="source-editor-preview-head">{t(m.previewTitle)}</div>
                <iframe className="source-editor-html-preview" title={t(m.previewTitle)} sandbox="" srcDoc={draft} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
