// The React half of the CORE `file-link` (链接文件) note type — SHELL-PRIM
// (kit-flatten-and-core-review.md §3): the raw shell's third primitive tool. A note
// that POINTS at a local file; the core spec (src/core/notes/contentTypes.ts) owns
// the { path, title?, note? } schema, this module owns only the React:
//
//   • render — card: file icon + title (fallback: the path's basename) + dimmed path
//     + a one-line note gist; full: the same plus the whole note text. Both carry the
//     打开 action. ONE registry render path (the adaptive-note display contract) —
//     never a bespoke bypass.
//   • 打开 — inside a Growte workspace, import/focus the file as a Growte source.
//     Outside a workspace, desktop falls back to shell.openPath; web falls back to
//     复制路径 (navigator.clipboard).
//   • edit — the composer's declared form: path (+ a desktop 选择文件… picker via the
//     EXISTING dialog:openFile IPC) + optional title + optional note.
//
// Importing this module registers the type (the built-in side-effect pattern).
// Styling lives in fileLinkNoteType.css (NOT styles.css — that file is contended).

import { useState } from "react";
import { File as FileIcon } from "lucide-react";
import { FILE_LINK_CONTENT_TYPE, type FileLinkContent } from "../../core/notes/contentTypes";
import { getPlatformOptional } from "../platform/platformSingleton";
import { registerNoteType, type NoteEditInput, type NoteRenderInput } from "./noteTypeRegistry";
import "./fileLinkNoteType.css";

// Inert-safe shaping (mirrors asFlashcard/asMistake): a foreign/mis-shaped content
// can never crash the card.
function asFileLink(content: unknown): FileLinkContent {
  const c = (content ?? {}) as Partial<FileLinkContent>;
  return {
    path: typeof c.path === "string" ? c.path : "",
    title: typeof c.title === "string" ? c.title : undefined,
    note: typeof c.note === "string" ? c.note : undefined
  };
}

/** The last path segment (Windows or POSIX separators) — the title fallback. */
export function fileLinkBasename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const segments = trimmed.split(/[\\/]/);
  return segments[segments.length - 1] || trimmed;
}

// Whether the desktop shell-open bridge is present (Electron). Checked lazily so
// SSR / jsdom without a window don't crash — same idiom as canPickFile.
function canShellOpen(): boolean {
  return (
    getPlatformOptional()?.capabilities.shellOpen ??
    (typeof window !== "undefined" && !!window.studyVault?.openPath)
  );
}
function canPickFile(): boolean {
  return (
    getPlatformOptional()?.capabilities.nativeFileDialogs ??
    (typeof window !== "undefined" && !!window.studyVault?.openFile)
  );
}

// The 打开 action: workspace → Growte source; standalone desktop → shell.openPath;
// web → copy the path to the clipboard instead. The data-file-link-path attr is for
// framework-free annotation previews: React handlers are stripped by renderToStaticMarkup,
// so the annotation layer forwards the click back to the workspace host.
function FileLinkOpenAction({ path, openLocalFile }: { path: string; openLocalFile?: (filePath: string) => Promise<void> | void }) {
  const desktop = canShellOpen();
  const [feedback, setFeedback] = useState("");
  const activate = async () => {
    if (!path) return;
    if (openLocalFile) {
      await openLocalFile(path);
      setFeedback("");
      return;
    }
    if (desktop) {
      const shellOpenPath =
        getPlatformOptional()?.native?.shellOpenPath ?? window.studyVault?.openPath;
      const error = await shellOpenPath!(path);
      setFeedback(error ? `打开失败：${error}` : "");
      return;
    }
    try {
      await (getPlatformOptional()?.clipboard.writeText(path) ??
        navigator.clipboard.writeText(path));
      setFeedback("已复制");
    } catch {
      setFeedback("复制失败");
    }
  };
  return (
    <span className="sv-file-link-actions">
      <button
        type="button"
        className="link-button sv-file-link-open"
        data-file-link-path={path}
        title={openLocalFile ? "在 Growte 中打开" : desktop ? "用系统默认应用打开" : "复制文件路径"}
        onClick={(event) => {
          // The card sits inside clickable rows (note list / preview cards) — don't
          // let the action also toggle/select the row.
          event.stopPropagation();
          void activate();
        }}
      >
        {openLocalFile || desktop ? "打开" : "复制路径"}
      </button>
      {feedback ? (
        <small className="sv-file-link-feedback" role="status">
          {feedback}
        </small>
      ) : null}
    </span>
  );
}

function FileLinkRender({ content, mode, ctx }: NoteRenderInput) {
  const c = asFileLink(content);
  const title = c.title?.trim() || fileLinkBasename(c.path) || "(no file)";
  // Card (§10.3): a one-line note gist; the full note text shows in mode:"full".
  const noteLine = c.note?.split("\n").find((line) => line.trim().length > 0);
  return (
    <div className={`note-rendered sv-file-link${mode === "card" ? " sv-file-link-card" : ""}`}>
      <div className="sv-file-link-head">
        <FileIcon className="sv-file-link-icon" size={15} aria-hidden="true" />
        <span className="sv-file-link-title">{title}</span>
        <FileLinkOpenAction path={c.path} openLocalFile={ctx?.openLocalFile} />
      </div>
      <div className="sv-file-link-path">{c.path || "(no path)"}</div>
      {c.note ? (
        mode === "card" ? (
          <p className="sv-file-link-note sv-file-link-note-line">{noteLine}</p>
        ) : (
          <p className="sv-file-link-note">{c.note}</p>
        )
      ) : null}
    </div>
  );
}

// The declared composer form: path (+ desktop picker) · title · note. The picker
// reuses the EXISTING dialog:openFile IPC (the same one the media editors use); in
// a browser it is disabled with the standard hint.
function FileLinkEditor({ content, onChange }: NoteEditInput) {
  const c = asFileLink(content);
  const desktop = canPickFile();
  const pick = async () => {
    const picked =
      (await (getPlatformOptional()?.files.pickFile() ??
        (window.studyVault?.openFile?.() ?? Promise.resolve(null)))) ?? null;
    if (!picked) return;
    onChange({ ...c, path: picked });
  };
  return (
    <div className="note-edit note-edit-file-link">
      <div className="note-edit-file-link-path-row">
        <input
          className="note-edit-field file-link-path"
          placeholder="File path (e.g. C:\docs\paper.pdf)"
          value={c.path}
          onChange={(event) => onChange({ ...c, path: event.target.value })}
        />
        <button type="button" className="icon-button file-link-pick" disabled={!desktop} onClick={() => void pick()}>
          选择文件…
        </button>
      </div>
      {!desktop ? <small className="tree-hint">Picking a local file is available in the desktop app.</small> : null}
      <input
        className="note-edit-field file-link-title"
        placeholder="Title (optional; defaults to the file name)"
        value={c.title ?? ""}
        onChange={(event) => onChange({ ...c, title: event.target.value || undefined })}
      />
      <textarea
        className="note-edit note-edit-text file-link-note"
        placeholder="Note (optional)"
        value={c.note ?? ""}
        onChange={(event) => onChange({ ...c, note: event.target.value || undefined })}
      />
    </div>
  );
}

// A CORE registration (no pluginId): the shell primitive is never gated by kit
// install state, and it is VISIBLE — offered in the slash palette (`/链接`) and the
// composer exactly like the other authored types.
registerNoteType({
  contentType: FILE_LINK_CONTENT_TYPE,
  label: "file link",
  title: "链接文件",
  aliases: ["链接", "文件", "本地文件", "file", "link"],
  render: (input) => <FileLinkRender {...input} />,
  edit: (input) => <FileLinkEditor {...input} />
});
