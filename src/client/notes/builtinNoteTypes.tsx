// Built-in client NoteType plugins — the React render/edit half for the 12 core
// content specs (src/core/notes/contentTypes.ts). Each plugin PAIRS with its core
// spec (it imports schema/createDefault from there via `spec()`); it never redefines
// the shape. Importing this module registers all 12 (the side-effect pattern the
// views/inspectors use).
//
// The split per type:
//   markdown / plain-text → render: sanitized markdown HTML · edit: textarea
//   mindmap               → render: nested tree · edit: JSON textarea (validated)
//   flashcard             → render: flip card · edit: front/back fields
//   quiz                  → render: question + options · edit: question/options/answer form
//   mermaid / markmap     → render: <DiagramNote> · edit: textarea
//   code-snippet          → render: <pre><code> · edit: language + code
//   image/audio/video     → render: <img>/<audio>/<video src=assetUrl> · edit: file picker
//   html-sandbox          → render: sandboxed <iframe> (no scripts) · edit: textarea
//
// A render NEVER throws on a bad/foreign content shape — it falls back to inert,
// escaped text, mirroring `renderNoteContent`'s contract (so a hand-rolled or stale
// note can't crash the note list).

import { escapeHtml, renderNoteContent } from "../../adapters/notes/render";
import { DiagramNote } from "../DiagramNote";
import { entityClient } from "../data/entityClient";
import {
  registerNoteType,
  spec,
  type NoteEditInput,
  type NoteRenderInput
} from "./noteTypeRegistry";

// Whether the desktop file picker is available (media EDIT needs it; render is
// browser-friendly). Checked lazily so SSR / jsdom without a window don't crash.
function canPickFile(): boolean {
  return typeof window !== "undefined" && !!window.studyVault?.openFile;
}

// Inert, escaped <pre> — never interprets the text as HTML/markdown. Used both for
// plain-text notes and as the fallback for content a plugin can't shape (so a stale
// or hand-rolled note can't inject markup into the note list).
function inertPreHtml(text: string): string {
  return `<pre class="sv-plain">${escapeHtml(text)}</pre>`;
}
function InertText({ content }: { content: unknown }) {
  const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  return <div className="note-rendered" dangerouslySetInnerHTML={{ __html: inertPreHtml(text) }} />;
}

// —— markdown / plain-text ————————————————————————————————————————————————
// content is a string. markdown renders via the sanitized renderer; plain-text
// shows as escaped <pre> (no markdown interpretation) — both inert-safe.
function MarkdownRender({ content }: NoteRenderInput) {
  const text = typeof content === "string" ? content : String(content ?? "");
  return <div className="note-rendered" dangerouslySetInnerHTML={{ __html: renderNoteContent("markdown", text).html }} />;
}
function PlainTextRender({ content }: NoteRenderInput) {
  const text = typeof content === "string" ? content : String(content ?? "");
  // Escaped <pre> — no markdown interpretation, never raw HTML.
  return <div className="note-rendered" dangerouslySetInnerHTML={{ __html: inertPreHtml(text) }} />;
}
function TextEditor({ content, onChange, placeholder }: NoteEditInput & { placeholder?: string }) {
  const text = typeof content === "string" ? content : "";
  return (
    <textarea
      className="note-edit note-edit-text"
      value={text}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

registerNoteType({
  contentType: "markdown",
  label: "markdown",
  render: (input) => <MarkdownRender {...input} />,
  edit: (input) => <TextEditor {...input} placeholder="Write markdown…" />
});
registerNoteType({
  contentType: "plain-text",
  label: "plain text",
  render: (input) => <PlainTextRender {...input} />,
  edit: (input) => <TextEditor {...input} placeholder="Write plain text…" />
});

// —— mermaid / markmap ————————————————————————————————————————————————————
// content is the diagram source string; rendered by the existing async DiagramNote.
function diagramPlugin(contentType: string, label: string, placeholder: string) {
  registerNoteType({
    contentType,
    label,
    render: ({ content }) => <DiagramNote contentType={contentType} content={typeof content === "string" ? content : ""} />,
    edit: (input) => <TextEditor {...input} placeholder={placeholder} />
  });
}
diagramPlugin("mermaid", "mermaid", "graph TD; A --> B;");
diagramPlugin("markmap", "markmap", "# Root\n## Child");

// —— mindmap ——————————————————————————————————————————————————————————————
// content is a { title?/text?, children? } tree. Render reuses the sanitized tree
// renderer (it expects a JSON string, so we stringify the structured object). Edit
// is a JSON textarea validated against the core spec on every change — invalid JSON
// or a shape mismatch leaves the last valid content in place (onChange not called).
type MindmapNode = { title?: string; text?: string; children?: MindmapNode[] };
function MindmapRender({ content }: NoteRenderInput) {
  // renderNoteContent("mindmap", json) parses + builds the nested <ul>; on bad JSON
  // it falls back to inert text, so this never throws.
  const json = typeof content === "string" ? content : JSON.stringify(content ?? {});
  return <div className="note-rendered" dangerouslySetInnerHTML={{ __html: renderNoteContent("mindmap", json).html }} />;
}
function StructuredJsonEditor({ content, onChange, contentType }: NoteEditInput & { contentType: string }) {
  const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  return (
    <textarea
      className="note-edit note-edit-json"
      defaultValue={text}
      onChange={(event) => {
        try {
          const parsed = JSON.parse(event.target.value);
          // Validate against the core spec; only emit when it parses cleanly.
          onChange(spec(contentType).schema.parse(parsed));
        } catch {
          // Invalid (syntax or shape) — keep the previous content; don't emit.
        }
      }}
    />
  );
}
registerNoteType({
  contentType: "mindmap",
  label: "mindmap",
  render: (input) => <MindmapRender {...input} />,
  edit: (input) => <StructuredJsonEditor {...input} contentType="mindmap" />
});

// —— flashcard ————————————————————————————————————————————————————————————
type Flashcard = { front: string; back: string };
function asFlashcard(content: unknown): Flashcard {
  const c = (content ?? {}) as Partial<Flashcard>;
  return { front: typeof c.front === "string" ? c.front : "", back: typeof c.back === "string" ? c.back : "" };
}
function FlashcardRender({ content }: NoteRenderInput) {
  // Reuse the sanitized flashcard renderer (flip card via <details>). It expects a
  // JSON string of {front, back}; stringify our structured content for it.
  const json = JSON.stringify(asFlashcard(content));
  return <div className="note-rendered" dangerouslySetInnerHTML={{ __html: renderNoteContent("flashcard", json).html }} />;
}
function FlashcardEditor({ content, onChange }: NoteEditInput) {
  const card = asFlashcard(content);
  return (
    <div className="note-edit note-edit-flashcard">
      <input
        className="note-edit-field flashcard-front"
        placeholder="Front (question)"
        value={card.front}
        onChange={(event) => onChange({ ...card, front: event.target.value })}
      />
      <input
        className="note-edit-field flashcard-back"
        placeholder="Back (answer)"
        value={card.back}
        onChange={(event) => onChange({ ...card, back: event.target.value })}
      />
    </div>
  );
}
registerNoteType({
  contentType: "flashcard",
  label: "flashcard",
  render: (input) => <FlashcardRender {...input} />,
  edit: (input) => <FlashcardEditor {...input} />
});

// —— quiz —————————————————————————————————————————————————————————————————
type Quiz = { question: string; options: string[]; answerIndex: number; explanation?: string };
function asQuiz(content: unknown): Quiz {
  const c = (content ?? {}) as Partial<Quiz>;
  const options = Array.isArray(c.options) ? c.options.map((o) => String(o ?? "")) : ["", ""];
  return {
    question: typeof c.question === "string" ? c.question : "",
    options: options.length >= 2 ? options : [...options, "", ""].slice(0, 2),
    answerIndex: typeof c.answerIndex === "number" && c.answerIndex >= 0 ? c.answerIndex : 0,
    explanation: typeof c.explanation === "string" ? c.explanation : undefined
  };
}
function QuizRender({ content }: NoteRenderInput) {
  const quiz = asQuiz(content);
  return (
    <div className="note-rendered sv-quiz">
      <p className="sv-quiz-question">{quiz.question}</p>
      <ul className="sv-quiz-options">
        {quiz.options.map((option, index) => (
          <li key={index} className={`sv-quiz-option${index === quiz.answerIndex ? " sv-quiz-answer" : ""}`}>
            {index === quiz.answerIndex ? "✓ " : ""}
            {option}
          </li>
        ))}
      </ul>
      {quiz.explanation ? <p className="sv-quiz-explanation">{quiz.explanation}</p> : null}
    </div>
  );
}
function QuizEditor({ content, onChange }: NoteEditInput) {
  const quiz = asQuiz(content);
  const setOption = (index: number, value: string) => {
    const options = quiz.options.slice();
    options[index] = value;
    onChange({ ...quiz, options });
  };
  return (
    <div className="note-edit note-edit-quiz">
      <input
        className="note-edit-field quiz-question"
        placeholder="Question"
        value={quiz.question}
        onChange={(event) => onChange({ ...quiz, question: event.target.value })}
      />
      <div className="quiz-options">
        {quiz.options.map((option, index) => (
          <label key={index} className="quiz-option-row">
            <input
              type="radio"
              className="quiz-answer-radio"
              name="quiz-answer"
              checked={index === quiz.answerIndex}
              onChange={() => onChange({ ...quiz, answerIndex: index })}
            />
            <input
              className="note-edit-field quiz-option"
              placeholder={`Option ${index + 1}`}
              value={option}
              onChange={(event) => setOption(index, event.target.value)}
            />
          </label>
        ))}
      </div>
      <button
        type="button"
        className="link-button quiz-add-option"
        onClick={() => onChange({ ...quiz, options: [...quiz.options, ""] })}
      >
        + Add option
      </button>
    </div>
  );
}
registerNoteType({
  contentType: "quiz",
  label: "quiz",
  render: (input) => <QuizRender {...input} />,
  edit: (input) => <QuizEditor {...input} />
});

// —— code-snippet —————————————————————————————————————————————————————————
type CodeSnippet = { language: string; code: string };
function asCode(content: unknown): CodeSnippet {
  const c = (content ?? {}) as Partial<CodeSnippet>;
  return { language: typeof c.language === "string" ? c.language : "text", code: typeof c.code === "string" ? c.code : "" };
}
function CodeRender({ content }: NoteRenderInput) {
  const snippet = asCode(content);
  return (
    <div className="note-rendered sv-code">
      <pre className={`sv-code-pre language-${snippet.language}`}>
        <code>{snippet.code}</code>
      </pre>
    </div>
  );
}
function CodeEditor({ content, onChange }: NoteEditInput) {
  const snippet = asCode(content);
  return (
    <div className="note-edit note-edit-code">
      <input
        className="note-edit-field code-language"
        placeholder="Language (e.g. ts)"
        value={snippet.language}
        onChange={(event) => onChange({ ...snippet, language: event.target.value })}
      />
      <textarea
        className="note-edit note-edit-text code-body"
        placeholder="Code…"
        value={snippet.code}
        onChange={(event) => onChange({ ...snippet, code: event.target.value })}
      />
    </div>
  );
}
registerNoteType({
  contentType: "code-snippet",
  label: "code snippet",
  render: (input) => <CodeRender {...input} />,
  edit: (input) => <CodeEditor {...input} />
});

// —— image / audio / video (local asset notes) ————————————————————————————
// content is { assetId, caption?, … }. RENDER points the media element at the asset
// bytes route (/api/assets/:id) — browser-friendly. EDIT picks a LOCAL file via the
// desktop dialog, imports it (copied into the vault), and stores the returned
// assetId. The pick is desktop-only; in a browser the editor shows a hint.
type MediaContent = { assetId: string; caption?: string; startSec?: number; endSec?: number };
function asMedia(content: unknown): MediaContent {
  const c = (content ?? {}) as Partial<MediaContent>;
  return {
    assetId: typeof c.assetId === "string" ? c.assetId : "",
    caption: typeof c.caption === "string" ? c.caption : undefined,
    startSec: typeof c.startSec === "number" ? c.startSec : undefined,
    endSec: typeof c.endSec === "number" ? c.endSec : undefined
  };
}

function MediaRender({ content, kind }: NoteRenderInput & { kind: "image" | "audio" | "video" }) {
  const media = asMedia(content);
  if (!media.assetId) return <div className="note-rendered sv-media-empty">No media selected.</div>;
  const src = entityClient.assetUrl(media.assetId);
  return (
    <div className={`note-rendered sv-media sv-media-${kind}`}>
      {kind === "image" ? <img className="sv-media-img" src={src} alt={media.caption ?? ""} /> : null}
      {kind === "audio" ? <audio className="sv-media-audio" src={src} controls /> : null}
      {kind === "video" ? <video className="sv-media-video" src={src} controls /> : null}
      {media.caption ? <figcaption className="sv-media-caption">{media.caption}</figcaption> : null}
    </div>
  );
}

function MediaEditor({ content, onChange, accept }: NoteEditInput & { accept: string }) {
  const media = asMedia(content);
  const desktop = canPickFile();
  const pick = async () => {
    const path = await window.studyVault?.openFile?.();
    if (!path) return;
    const { asset } = await entityClient.importAsset(path);
    onChange({ ...media, assetId: asset.id });
  };
  return (
    <div className="note-edit note-edit-media" data-accept={accept}>
      <button type="button" className="icon-button media-pick" disabled={!desktop} onClick={() => void pick()}>
        {media.assetId ? "Replace file…" : "Choose file…"}
      </button>
      {media.assetId ? <small className="media-chosen">Asset: {media.assetId}</small> : null}
      {!desktop ? <small className="tree-hint">Choosing a local file is available in the desktop app.</small> : null}
      <input
        className="note-edit-field media-caption"
        placeholder="Caption (optional)"
        value={media.caption ?? ""}
        onChange={(event) => onChange({ ...media, caption: event.target.value || undefined })}
      />
    </div>
  );
}

registerNoteType({
  contentType: "image",
  label: "image",
  render: (input) => <MediaRender {...input} kind="image" />,
  edit: (input) => <MediaEditor {...input} accept="image/*" />
});
registerNoteType({
  contentType: "audio",
  label: "audio",
  render: (input) => <MediaRender {...input} kind="audio" />,
  edit: (input) => <MediaEditor {...input} accept="audio/*" />
});
registerNoteType({
  contentType: "video",
  label: "video",
  render: (input) => <MediaRender {...input} kind="video" />,
  edit: (input) => <MediaEditor {...input} accept="video/*" />
});

// —— html-sandbox —————————————————————————————————————————————————————————
// content is { html }. RENDERED inside a sandboxed <iframe sandbox> with NO tokens
// → scripts can't run, the frame can't navigate the top window, submit forms, or
// reach the parent (same-origin is also denied). The HTML goes in via `srcdoc`, so
// even a <script> in the note is inert. EDIT is a textarea.
function HtmlSandboxRender({ content }: NoteRenderInput) {
  const html = (content as { html?: unknown } | null)?.html;
  const doc = typeof html === "string" ? html : "";
  return (
    <div className="note-rendered sv-html-sandbox">
      {/* sandbox="" (empty) = MOST restrictive: no scripts, no forms, no same-origin,
          no top navigation. The note's HTML is fully isolated. */}
      <iframe className="sv-sandbox-frame" sandbox="" title="HTML note" srcDoc={doc} />
    </div>
  );
}
function HtmlSandboxEditor({ content, onChange }: NoteEditInput) {
  const html = typeof (content as { html?: unknown } | null)?.html === "string" ? (content as { html: string }).html : "";
  return (
    <textarea
      className="note-edit note-edit-text note-edit-html"
      placeholder="<p>HTML…</p>"
      value={html}
      onChange={(event) => onChange({ html: event.target.value })}
    />
  );
}
registerNoteType({
  contentType: "html-sandbox",
  label: "html (sandboxed)",
  render: (input) => <HtmlSandboxRender {...input} />,
  edit: (input) => <HtmlSandboxEditor {...input} />
});

// Exported only so a host can show an inert fallback for an UNKNOWN contentType
// (one with no registered plugin) instead of nothing.
export function InertNote({ content }: { content: unknown }) {
  return <InertText content={content} />;
}
