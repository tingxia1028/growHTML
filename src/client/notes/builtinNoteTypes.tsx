// Built-in client NoteType plugins — the React render/edit half for the core
// content specs (src/core/notes/contentTypes.ts). Each plugin PAIRS with its core
// spec (it imports schema/createDefault from there via `spec()`); it never redefines
// the shape. Importing this module registers them all (the side-effect pattern the
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

import { useState } from "react";
import { escapeHtml, renderNoteContent } from "../../adapters/notes/render";
import { videoEmbedSrc, type VideoProvider } from "../../core/notes/parseVideoUrl";
import { DiagramNote } from "../DiagramNote";
import { entityClient } from "../data/entityClient";
import {
  registerNoteType,
  spec,
  type NoteEditInput,
  type NoteRenderInput
} from "./noteTypeRegistry";
import { getRecentCategories } from "./recentCategories";

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

// —— per-type CARD bodies (§10.3) ——————————————————————————————————————————
// A NoteType's render({mode:"card"}) returns the lightweight PREVIEW body that the
// shared PreviewCard wrapper drops under its [icon · type · ⋯] header + bold title +
// footer meta. The wrapper owns the chrome; each type owns only WHAT little to preview
// (first lines / the question / a thumbnail / a code snippet) — never the full,
// interactive content (that runs only in the Center View, mode:"full"). Keeping the
// card body inside the plugin (not the host) honors the adaptive-note display contract:
// card AND full both come from getNoteType().render({mode}).

// The first ~N non-empty lines of a markdown/plain body — the markdown card preview.
function firstLines(text: string, n: number): string {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(0, n)
    .join("\n");
}

// —— markdown / plain-text ————————————————————————————————————————————————
// content is a string. markdown renders via the sanitized renderer; plain-text
// shows as escaped <pre> (no markdown interpretation) — both inert-safe. In "card"
// mode markdown shows only the first ~3 lines of body (§10.3).
function MarkdownRender({ content, mode }: NoteRenderInput) {
  const text = typeof content === "string" ? content : String(content ?? "");
  if (mode === "card") {
    return <div className="note-rendered sv-card-md">{firstLines(text, 3) || "(empty note)"}</div>;
  }
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

// Slash-palette display meta (slash-composer §2 / SC-0): every registration carries a
// natural 中文 `title` + `aliases` (中文 synonyms + English shorthands) so `/文本`,
// `/判断题`, `/md` … all resolve. The contentType id itself always matches (engine
// rank 0), so aliases never repeat it. Hidden types keep meta too (other surfaces may
// use it) but the slash adapter skips them — they aren't authored from a composer.
registerNoteType({
  contentType: "markdown",
  label: "markdown",
  title: "文本",
  aliases: ["笔记", "md", "text"],
  render: (input) => <MarkdownRender {...input} />,
  edit: (input) => <TextEditor {...input} placeholder="Write markdown…" />
});
// plain-text is FOLDED INTO markdown (consolidation §2.5): it is no longer offered as
// a NEW choice (hidden from the composer picker), but the plugin stays registered so
// EXISTING `plain-text` notes still open — rendered as inert escaped <pre> (their
// original presentation; markdown is a superset so this never loses content).
registerNoteType({
  contentType: "plain-text",
  label: "plain text",
  title: "纯文本",
  aliases: ["plain"],
  hidden: true,
  render: (input) => <PlainTextRender {...input} />,
  edit: (input) => <TextEditor {...input} placeholder="Write plain text…" />
});

// —— mermaid / markmap ————————————————————————————————————————————————————
// content is the diagram source string; rendered by the existing async DiagramNote.
// A diagram is HEAVY (it mounts mermaid / markmap-view), so in "card" mode it opts
// into a LIGHT preview (an icon + a source snippet) instead of mounting the live
// renderer — the ArtifactCard shows this in the thread; the full interactive diagram
// only mounts when the FocusOverlay opens (mode:"full"). This is the rich-form card
// opt-in the contract allows; ignoring `mode` would still get the generic card.
// A LIGHT diagram thumbnail for the card: a tiny structure glyph (a few connected
// node bars derived from the source's first lines) + a one-line snippet. This is the
// "downscaled static render / simple structure glyph" §10.3 calls for — it never
// mounts mermaid/markmap (the full, zoomable diagram only mounts in the Center View).
function DiagramCard({ contentType, content }: { contentType: string; content: string }) {
  const snippet = content.replace(/\s+/g, " ").trim().slice(0, 80);
  // Up to 4 node labels from the outline/source for the glyph (cheap, never throws).
  const nodes = content
    .split(/\n|;|-->|->/)
    .map((l) => l.replace(/^[#\-*\s>]+/, "").replace(/[\[\](){}]/g, " ").trim())
    .filter((l) => l.length > 0)
    .slice(0, 4);
  return (
    <div className={`note-rendered sv-diagram-card sv-diagram-card-${contentType}`}>
      <div className="sv-diagram-glyph" aria-hidden="true">
        {(nodes.length ? nodes : ["diagram"]).map((label, i) => (
          <span key={i} className="sv-diagram-glyph-node" style={{ marginLeft: `${i * 10}px` }}>
            {label.slice(0, 18)}
          </span>
        ))}
      </div>
      <pre className="sv-diagram-card-snippet">{snippet || "(empty diagram)"}</pre>
    </div>
  );
}
function diagramPlugin(
  contentType: string,
  label: string,
  display: { title: string; aliases: string[] },
  placeholder: string
) {
  registerNoteType({
    contentType,
    label,
    // F5 / plugin-viewer-model §8.1: the diagram types belong to the cataloged
    // `diagrams` plugin (one plugin providing mermaid + markmap + the legacy mindmap),
    // not to the synthetic "core" record.
    pluginId: "diagrams",
    title: display.title,
    aliases: display.aliases,
    render: ({ content, mode }) => {
      const source = typeof content === "string" ? content : "";
      // "card" → a light static preview (no live diagram mount); "full" (default) →
      // the interactive DiagramNote a saved note uses.
      return mode === "card" ? (
        <DiagramCard contentType={contentType} content={source} />
      ) : (
        <DiagramNote contentType={contentType} content={source} />
      );
    },
    edit: (input) => <TextEditor {...input} placeholder={placeholder} />
  });
}
diagramPlugin("mermaid", "mermaid", { title: "图表", aliases: ["流程图", "diagram"] }, "graph TD; A --> B;");
// "mindmap" is an ALIAS here on purpose: the static `mindmap` type is retired as a new
// choice (§2.5 below), so `/mindmap` should land the user on the interactive markmap.
diagramPlugin("markmap", "markmap", { title: "脑图", aliases: ["思维导图", "导图", "mindmap"] }, "# Root\n## Child");

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
// The static `mindmap` is DROPPED as a new choice in favor of the interactive
// `markmap` (consolidation §2.5): hidden from the composer picker, but the plugin
// stays registered so EXISTING `mindmap` notes still open — rendered by the original
// static tree renderer (the nested <ul>). New mind-maps are authored as `markmap`.
registerNoteType({
  contentType: "mindmap",
  label: "mindmap",
  pluginId: "diagrams",
  title: "思维导图",
  aliases: ["静态导图"],
  hidden: true,
  render: (input) => <MindmapRender {...input} />,
  edit: (input) => <StructuredJsonEditor {...input} contentType="mindmap" />
});

// —— flashcard ————————————————————————————————————————————————————————————
type Flashcard = { front: string; back: string };
function asFlashcard(content: unknown): Flashcard {
  const c = (content ?? {}) as Partial<Flashcard>;
  return { front: typeof c.front === "string" ? c.front : "", back: typeof c.back === "string" ? c.back : "" };
}
function FlashcardRender({ content, mode }: NoteRenderInput) {
  const card = asFlashcard(content);
  // "card" → the front summary + a muted hint; the BACK is never shown until the
  // Center View flips it (§10.3). "full" → the flip card (front + reveal-able back).
  if (mode === "card") {
    return (
      <div className="note-rendered sv-card-flashcard">
        <p className="sv-card-flashcard-front">{card.front || "(empty flashcard)"}</p>
        <p className="sv-card-flashcard-hint">点击翻开查看背面</p>
      </div>
    );
  }
  return (
    <div className="note-rendered sv-flashcard sv-flashcard-expanded">
      <section className="sv-flashcard-face">
        <span className="sv-flashcard-face-label">Front</span>
        <p>{card.front || "(empty flashcard)"}</p>
      </section>
      <span className="sv-flashcard-swap" aria-hidden="true">
        ↔
      </span>
      <section className="sv-flashcard-face">
        <span className="sv-flashcard-face-label">Back</span>
        <p>{card.back || "(empty back)"}</p>
      </section>
    </div>
  );
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
  // F5: reclassified out of the "core" seed — the cataloged `flashcard` plugin.
  pluginId: "flashcard",
  title: { zh: "闪卡", en: "Flashcard" },
  aliases: ["卡片", "记忆卡", "card"],
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
function QuizRender({ content, mode }: NoteRenderInput) {
  const quiz = asQuiz(content);
  // "card" → just the question (1 line, truncated) — never the options (§10.3). The
  // option count is shown by the wrapper footer (extraMeta), so the body stays a single
  // line. "full" → the question + options with the answer marked (the Center View).
  if (mode === "card") {
    return (
      <div className="note-rendered sv-card-quiz">
        <p className="sv-quiz-question sv-card-quiz-question">{quiz.question || "(empty quiz)"}</p>
      </div>
    );
  }
  return (
    <div className="note-rendered sv-quiz">
      <p className="sv-quiz-question">{quiz.question}</p>
      <ul className="sv-quiz-options">
        {quiz.options.map((option, index) => (
          <li
            key={index}
            className={`sv-quiz-option${index === quiz.answerIndex ? " sv-quiz-answer" : ""}`}
            data-option={option}
            data-letter={String.fromCharCode(65 + index)}
          >
            {index === quiz.answerIndex ? "✓ " : ""}
            {option}
          </li>
        ))}
      </ul>
      {quiz.explanation ? <p className="sv-quiz-explanation">{quiz.explanation}</p> : null}
      <aside className="sv-quiz-overview">
        <strong>Overview</strong>
        <span>{quiz.options.length} options</span>
        {quiz.options.map((_option, index) => (
          <span key={index} className={index === quiz.answerIndex ? "active" : ""}>
            {index + 1}
          </span>
        ))}
      </aside>
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
  // F5: reclassified out of the "core" seed — the cataloged `quiz` plugin.
  pluginId: "quiz",
  // Reality check vs the design sketch: this quiz IS a options+answerIndex 选择题, so
  // "小测" titles it; "判断题" stays an alias (the design doc's example query must hit).
  title: { zh: "小测", en: "Quiz" },
  aliases: ["选择题", "判断题", "测验", "判断"],
  render: (input) => <QuizRender {...input} />,
  edit: (input) => <QuizEditor {...input} />
});

// —— code-snippet —————————————————————————————————————————————————————————
type CodeSnippet = { language: string; code: string };
function asCode(content: unknown): CodeSnippet {
  const c = (content ?? {}) as Partial<CodeSnippet>;
  return { language: typeof c.language === "string" ? c.language : "text", code: typeof c.code === "string" ? c.code : "" };
}
function CodeRender({ content, mode }: NoteRenderInput) {
  const snippet = asCode(content);
  // "card" → a 2–3 line monospace preview (the language is shown by the wrapper footer).
  if (mode === "card") {
    const preview = snippet.code.split("\n").slice(0, 3).join("\n");
    return (
      <div className="note-rendered sv-card-code">
        <pre className={`sv-card-code-pre language-${snippet.language}`}>
          <code>{preview || "(empty)"}</code>
        </pre>
      </div>
    );
  }
  // "full" → the whole code with line numbers + a copy affordance (the Center View).
  const lines = snippet.code.split("\n");
  return (
    <div className="note-rendered sv-code sv-code-full">
      <div className="sv-code-toolbar">
        <span className="sv-code-lang">{snippet.language}</span>
        <button type="button" className="sv-code-run link-button" title="Run code">
          Run
        </button>
        <button
          type="button"
          className="sv-code-copy link-button"
          title="Copy code"
          onClick={() => void navigator.clipboard?.writeText(snippet.code)}
        >
          Copy
        </button>
      </div>
      <pre className={`sv-code-pre sv-code-numbered language-${snippet.language}`}>
        <code>
          {lines.map((line, i) => (
            <span key={i} className="sv-code-line">
              <span className="sv-code-ln" aria-hidden="true">{i + 1}</span>
              <span className="sv-code-lc">{line || " "}</span>
            </span>
          ))}
        </code>
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
  title: "代码",
  aliases: ["代码片段", "code", "snippet"],
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

// A mm:ss (or h:mm:ss) duration badge from a seconds count — only when we actually know
// a length (a trimmed clip's start/end). Never fabricates a duration.
function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;
}
function mediaDuration(media: MediaContent): string | null {
  if (typeof media.endSec === "number" && typeof media.startSec === "number" && media.endSec > media.startSec) {
    return formatDuration(media.endSec - media.startSec);
  }
  return null;
}

function MediaRender({ content, mode, kind }: NoteRenderInput & { kind: "image" | "audio" | "video" }) {
  const media = asMedia(content);
  if (!media.assetId) return <div className="note-rendered sv-media-empty">No media selected.</div>;
  const src = entityClient.assetUrl(media.assetId);
  const duration = mediaDuration(media);

  // "card" → a LIGHTWEIGHT thumbnail (§10.3): image shows the actual <img> thumbnail
  // (the e2e relies on .sv-media-img + .sv-media-caption in a card); audio/video show
  // an inert poster glyph + an optional duration badge — never an autoplaying/controls
  // player (the live player runs only in the Center View, mode:"full").
  if (mode === "card") {
    return (
      <div className={`note-rendered sv-media sv-media-card sv-media-card-${kind}`}>
        <span className="sv-media-thumb">
          {kind === "image" ? (
            <img className="sv-media-img" src={src} alt={media.caption ?? ""} loading="lazy" />
          ) : (
            <span className="sv-media-poster" aria-hidden="true">
              {kind === "audio" ? "♪" : "▶"}
            </span>
          )}
          {duration ? <span className="sv-media-duration">{duration}</span> : null}
        </span>
        {media.caption ? <figcaption className="sv-media-caption">{media.caption}</figcaption> : null}
      </div>
    );
  }

  // "full" → the real, interactive player (Center View). Image stays an <img>.
  return (
    <div className={`note-rendered sv-media sv-media-${kind}`}>
      {kind === "image" ? <img className="sv-media-img" src={src} alt={media.caption ?? ""} /> : null}
      {kind === "audio" ? <audio className="sv-media-audio" src={src} controls preload="metadata" /> : null}
      {kind === "video" ? <video className="sv-media-video" src={src} controls preload="metadata" /> : null}
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
  title: "图片",
  aliases: ["插图", "照片", "img"],
  render: (input) => <MediaRender {...input} kind="image" />,
  edit: (input) => <MediaEditor {...input} accept="image/*" />
});
registerNoteType({
  contentType: "audio",
  label: "audio",
  title: "音频",
  aliases: ["录音", "声音"],
  render: (input) => <MediaRender {...input} kind="audio" />,
  edit: (input) => <MediaEditor {...input} accept="audio/*" />
});
// —— video (unified: asset | embed) ———————————————————————————————————————
// ONE `video` plugin whose single render() switches on the content's `kind` — an
// INTERNAL variant switch in one renderer (legal per design plan §3), NOT host-side
// branching. asset → <video src=/api/assets/:id> (now Range-streamed for long files);
// embed → a provider <iframe>. An ABSENT kind is treated as "asset" (backward-compat
// with pre-Phase-2 notes, mirroring the core schema default).
type VideoEmbed = { kind: "embed"; provider: VideoProvider; videoId: string; url: string; caption?: string };

function asVideo(content: unknown): MediaContent | VideoEmbed {
  const c = (content ?? {}) as Record<string, unknown>;
  if (c.kind === "embed") {
    const provider = c.provider;
    return {
      kind: "embed",
      provider: (provider === "youtube" || provider === "bilibili" || provider === "vimeo"
        ? provider
        : "youtube") as VideoProvider,
      videoId: typeof c.videoId === "string" ? c.videoId : "",
      url: typeof c.url === "string" ? c.url : "",
      caption: typeof c.caption === "string" ? c.caption : undefined
    };
  }
  // Absent or "asset" kind → the local-asset shape (asMedia is inert-safe).
  return asMedia(content);
}

function VideoRender({ content, mode }: NoteRenderInput) {
  const video = asVideo(content);
  if ("kind" in video && video.kind === "embed") {
    // "card" → an INERT poster (provider glyph + caption); never mount the live player
    // iframe in a thread/list card (§10.3 "不默认运行"). The real player runs in the
    // Center View (mode:"full").
    if (mode === "card") {
      return (
        <div className="note-rendered sv-media sv-media-card sv-media-card-video sv-video-embed-card">
          <span className="sv-media-thumb">
            <span className="sv-media-poster" aria-hidden="true">▶</span>
            <span className="sv-media-duration sv-media-provider">{video.provider}</span>
          </span>
          {video.caption ? <figcaption className="sv-media-caption">{video.caption}</figcaption> : null}
        </div>
      );
    }
    // Build the provider player src from { provider, videoId } — never trust the raw
    // URL's query noise. videoId/provider come from parseVideoUrl at classify/save time.
    const src = videoEmbedSrc({ provider: video.provider, videoId: video.videoId });
    return (
      <div className="note-rendered sv-media sv-media-video sv-video-embed">
        {/* sandbox: allow-scripts (player JS) + allow-same-origin + allow-presentation.
            allow-same-origin is acceptable HERE ONLY because `src` is a REMOTE provider
            origin (youtube.com / bilibili.com / vimeo.com), NOT our own origin — so the
            frame is same-origin with the PROVIDER, never with the host app/vault.
            `allow=` is restricted to media capabilities; referrerpolicy limits leakage. */}
        <iframe
          className="sv-video-embed-frame"
          title={video.caption ?? `${video.provider} video`}
          src={src}
          sandbox="allow-scripts allow-same-origin allow-presentation"
          allow="fullscreen; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          loading="lazy"
        />
        {video.caption ? <figcaption className="sv-media-caption">{video.caption}</figcaption> : null}
      </div>
    );
  }
  // Local asset video. Reuse the shared MediaRender so the card (poster glyph + duration
  // badge) and the full player are identical to image/audio — one media presentation, not
  // a bespoke video one.
  const media = video as MediaContent;
  if (!media.assetId) return <div className="note-rendered sv-media-empty">No video selected.</div>;
  return <MediaRender content={media} mode={mode} kind="video" />;
}

registerNoteType({
  contentType: "video",
  label: "video",
  title: "视频",
  aliases: ["影片", "录像"],
  render: (input) => <VideoRender {...input} />,
  edit: (input) => <MediaEditor {...input} accept="video/*" />
});

// —— html (unified: static | interactive) ————————————————————————————————————
// ONE `html` plugin (persisted contentType id stays "html-sandbox" — a stable id, NOT
// renamed; presented to the user simply as "html"). Its single render() switches on the
// content's `interactive` flag — an INTERNAL variant switch in one renderer (legal per
// design plan §3, NOT host-side branching). content = { html, interactive? }.
//
//   • interactive:false (default, backward-compatible with pre-Phase-3 { html } notes)
//     → <iframe sandbox=""> — MOST restrictive: no scripts, no forms, no same-origin,
//       no top navigation; the note's HTML (even a <script>) is fully inert.
//   • interactive:true → the HARDENED game frame (design plan §5): sandbox="allow-scripts"
//     (NEVER allow-same-origin — with both, a srcdoc frame is SAME-ORIGIN with the host
//     and the AI code gets full host-DOM/vault access = sandbox escape) + a strict CSP
//     applied BOTH as the iframe `csp` attribute AND as a <meta http-equiv> prepended
//     into the srcdoc (the repo sets no server CSP). default-src 'none' blocks ALL network
//     (fetch/XHR/WebSocket/beacon/external script); script-src/style-src 'unsafe-inline'
//     run only the inline game code; img-src data: allows inline images. The opaque
//     ("null") origin means window.parent / window.top / our cookies / our localStorage /
//     window.studyVault are ALL unreachable.
//
// The live interactive frame mounts ONLY in the FocusOverlay (mode:"full"); in a card
// (mode:"card") an interactive note shows an INERT sandbox="" preview so the thread never
// runs many allow-scripts frames at once (design plan §3.5/§5). EDIT is a textarea + an
// "interactive" checkbox.

// The strict CSP for the interactive frame (design plan §5). Verbatim — also injected as
// a <meta http-equiv> inside the srcdoc as the no-server-CSP fallback.
const HTML_INTERACTIVE_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";

function asHtmlContent(content: unknown): { html: string; interactive: boolean } {
  const c = (content ?? {}) as { html?: unknown; interactive?: unknown };
  return {
    html: typeof c.html === "string" ? c.html : "",
    interactive: c.interactive === true
  };
}

// Prepend the CSP <meta> so it is the FIRST thing the frame parses (so the policy is in
// force before any inline <script> runs), regardless of whether the note's html is a full
// document or a bare fragment.
function withCspMeta(html: string): string {
  return `<meta http-equiv="Content-Security-Policy" content="${HTML_INTERACTIVE_CSP}">\n${html}`;
}

// A one-line plain-text gist of an HTML body for the card description — tags stripped,
// inert (never inserted as HTML). Cheap; never throws.
function htmlGist(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

function HtmlSandboxRender({ content, mode }: NoteRenderInput) {
  const { html, interactive } = asHtmlContent(content);
  // CARD (§10.3): NEVER run an iframe — show a short text gist + a blue `Interactive`
  // badge for interactive notes. The live frame mounts only in the Center View.
  if (mode === "card") {
    return (
      <div className="note-rendered sv-card-html">
        <p className="sv-card-html-gist">{htmlGist(html) || "(empty html)"}</p>
        {interactive ? <span className="sv-card-interactive-badge">Interactive</span> : null}
      </div>
    );
  }
  // Interactive games RUN only in the overlay (mode:"full") — the card path returned
  // above, so reaching here means full mode.
  if (interactive) {
    return (
      <div className="note-rendered sv-html-sandbox sv-html-interactive">
        {/* sandbox="allow-scripts" with NO allow-same-origin → the frame is an opaque
            ("null") origin: scripts run, but window.parent/top, our cookies/localStorage,
            same-origin fetch, and window.studyVault are ALL unreachable. NO allow-forms /
            allow-popups / allow-top-navigation / allow-modals / allow-downloads. The CSP
            is applied via BOTH the `csp` attribute (Chromium/Electron) and a <meta> in the
            srcdoc (fallback, since the repo sets no server CSP) → default-src 'none' blocks
            all network. referrerpolicy=no-referrer prevents any URL leakage. */}
        <iframe
          className="sv-sandbox-frame sv-interactive-frame"
          sandbox="allow-scripts"
          // @ts-expect-error `csp` is a valid iframe attribute (Chromium) not yet in the React DOM types.
          csp={HTML_INTERACTIVE_CSP}
          referrerPolicy="no-referrer"
          title="Interactive HTML note"
          srcDoc={withCspMeta(html)}
        />
      </div>
    );
  }
  // Inert HTML (interactive:false) AND the card preview of an interactive note: both use
  // the MOST restrictive sandbox="" (no scripts, no forms, no same-origin, no navigation).
  return (
    <div className="note-rendered sv-html-sandbox">
      <iframe className="sv-sandbox-frame" sandbox="" title="HTML note" srcDoc={html} />
    </div>
  );
}
function HtmlSandboxEditor({ content, onChange }: NoteEditInput) {
  const { html, interactive } = asHtmlContent(content);
  return (
    <div className="note-edit note-edit-html-wrap">
      <textarea
        className="note-edit note-edit-text note-edit-html"
        placeholder="<p>HTML…</p>"
        value={html}
        onChange={(event) => onChange({ html: event.target.value, interactive })}
      />
      <label className="note-edit-html-interactive sv-check">
        <input
          type="checkbox"
          className="sv-check-input"
          checked={interactive}
          onChange={(event) => onChange({ html, interactive: event.target.checked })}
        />
        <span className="sv-check-box" aria-hidden="true" />
        <span>Interactive (run scripts in a hardened sandbox)</span>
      </label>
    </div>
  );
}
registerNoteType({
  contentType: "html-sandbox",
  label: "html",
  // "html" is an alias (not just an id-prefix hit) so the natural `/html` query lands
  // in the exact-alias tier — the persisted id stays "html-sandbox" (stable, unrenamed).
  title: "HTML",
  aliases: ["html", "网页", "互动", "游戏"],
  // Rich, self-contained interactive content → focusable into the shared overlay (where
  // the live allow-scripts frame mounts). A registry capability flag, NOT a host branch.
  focusable: true,
  render: (input) => <HtmlSandboxRender {...input} />,
  edit: (input) => <HtmlSandboxEditor {...input} />
});

// —— bookmark —————————————————————————————————————————————————————————————
// A lightweight NAMED marker. Unlike every other type it RENDERS as a compact label
// chip (color dot + label), not a full note card — the data is a plain note, the
// bespoke chip presentation lives here. Click-to-jump is wired by the Bookmarks
// panel (render is handed the note, not focus). EDIT is a tiny label + color editor,
// not the rich note editor. asBookmark is inert-safe (mirrors asFlashcard) so a
// foreign/mis-shaped content can't crash the chip.
type Bookmark = { label: string; color?: string; order?: number; category?: string };
function asBookmark(content: unknown): Bookmark {
  const c = (content ?? {}) as Partial<Bookmark>;
  return {
    label: typeof c.label === "string" ? c.label : "",
    color: typeof c.color === "string" ? c.color : undefined,
    order: typeof c.order === "number" ? c.order : undefined,
    category: typeof c.category === "string" ? c.category : undefined
  };
}
function BookmarkChip({ content }: NoteRenderInput) {
  const bookmark = asBookmark(content);
  return (
    <span className="note-rendered sv-bookmark-chip">
      <span
        className="sv-bookmark-dot"
        style={bookmark.color ? { backgroundColor: bookmark.color } : undefined}
      />
      <span className="sv-bookmark-label">{bookmark.label || "Untitled bookmark"}</span>
    </span>
  );
}
// A module-stable id so the category input can reference its <datalist> sibling.
let bookmarkCategoryListSeq = 0;
function BookmarkEditor({ content, onChange }: NoteEditInput) {
  const bookmark = asBookmark(content);
  // R8: category is an OPTIONAL grouping field for the hover-reveal Bookmark index. The
  // text input is backed by a <datalist> of recently-used categories (published by the
  // bookmark hook — the editor has no ctx access). An empty value drops `category` so the
  // bookmark falls back to the "Ungrouped" section. Saving flows through the existing
  // note.edit path (the inline rename editor passes this whole content object on save).
  const [listId] = useState(() => `bookmark-categories-${++bookmarkCategoryListSeq}`);
  const recent = getRecentCategories();
  const setCategory = (value: string) => {
    const trimmed = value.trim();
    const next: Bookmark = { ...bookmark };
    if (trimmed) next.category = value;
    else delete next.category;
    onChange(next);
  };
  return (
    <div className="note-edit note-edit-bookmark">
      <div className="note-edit-bookmark-row">
        <input
          className="note-edit-field bookmark-label"
          placeholder="Bookmark label"
          value={bookmark.label}
          onChange={(event) => onChange({ ...bookmark, label: event.target.value })}
        />
        <input
          type="color"
          className="note-edit-field bookmark-color"
          value={bookmark.color ?? "#3b82f6"}
          onChange={(event) => onChange({ ...bookmark, color: event.target.value })}
        />
      </div>
      <input
        className="note-edit-field bookmark-category"
        placeholder="Category (optional)"
        list={listId}
        value={bookmark.category ?? ""}
        onChange={(event) => setCategory(event.target.value)}
      />
      <datalist id={listId}>
        {recent.map((category) => (
          <option key={category} value={category} />
        ))}
      </datalist>
    </div>
  );
}
registerNoteType({
  contentType: "bookmark",
  label: "bookmark",
  // F5 / §8.6: bookmark is an upper-layer functional unit — the cataloged `bookmark`
  // plugin (metadata-first; the spec stays in core contentTypes for now, §8.10).
  pluginId: "bookmark",
  title: "书签",
  aliases: ["收藏", "mark"],
  // Hidden from the composer's generic type picker — a bookmark is created via the
  // bookmark.add command (which materializes the focused anchor), never authored
  // anchor-less from the composer. Render/edit through the registry still work (the
  // chip in the note registry, the tiny editor for rename).
  hidden: true,
  render: (input) => <BookmarkChip {...input} />,
  edit: (input) => <BookmarkEditor {...input} />
});

// —— REV-CORE core-seed registrations ————————————————————————————————————————
// The mission loop's types register WITH the built-ins (kit-flatten-and-core-review
// §1): `mistake` (错题, moved out of the textbook kit; old `textbook.mistake` records
// reach it via the registry alias) and the hidden `review.grade` transport verdict
// (moved out of the dissolved review plugin).
import "./mistakeNoteType";
import "../review/gradeNoteType";

// —— SHELL-PRIM core-seed registration ————————————————————————————————————————
// 链接文件 — the raw shell's third primitive tool (kit-flatten-and-core-review §3):
// the core `file-link` type registers WITH the built-ins, visible in the palette.
import "./fileLinkNoteType";

// Exported only so a host can show an inert fallback for an UNKNOWN contentType
// (one with no registered plugin) instead of nothing.
export function InertNote({ content }: { content: unknown }) {
  return <InertText content={content} />;
}
