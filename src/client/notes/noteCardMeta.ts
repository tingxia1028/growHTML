import { getNoteType } from "./noteTypeRegistry";

export type NoteCardMeta = {
  typeLabel: string;
  title: string;
  extra?: string;
};

const TYPE_LABELS: Record<string, string> = {
  markdown: "Markdown",
  "plain-text": "Text",
  quiz: "Quiz",
  flashcard: "Flashcard",
  image: "Media",
  audio: "Media",
  video: "Media",
  "html-sandbox": "HTML / Interactive",
  mermaid: "Mermaid / Mindmap",
  markmap: "Mermaid / Mindmap",
  mindmap: "Mermaid / Mindmap",
  "code-snippet": "Code",
  bookmark: "Bookmark"
};

function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function stripMarkdown(text: string): string {
  return compact(
    text
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/[*_`>#-]/g, " ")
      .replace(/\[(.*?)\]\([^)]*\)/g, "$1")
  );
}

function stripHtml(html: string): string {
  return compact(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
}

function textTitle(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const heading = lines.find((line) => /^#{1,6}\s+/.test(line));
  return stripMarkdown(heading ?? lines[0] ?? "");
}

function asRecord(content: unknown): Record<string, unknown> {
  return content && typeof content === "object" ? (content as Record<string, unknown>) : {};
}

function stringField(content: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = content[key];
    if (typeof value === "string" && value.trim()) return compact(value);
  }
  return "";
}

function firstCodeFunction(code: string): string {
  const match =
    code.match(/\bfunction\s+([A-Za-z_$][\w$]*)/) ??
    code.match(/\bdef\s+([A-Za-z_]\w*)/) ??
    code.match(/\bclass\s+([A-Za-z_]\w*)/);
  return match ? match[1] : "";
}

function diagramTitle(contentType: string, source: string): string {
  if (contentType === "markmap") return textTitle(source);
  const node = source
    .split(/\r?\n|;|-->|---|->/)
    .map((part) => compact(part.replace(/^[A-Za-z0-9_]+\[?/, "").replace(/[\[\](){}"']/g, " ")))
    .find(Boolean);
  return node ?? "";
}

export function noteCardMeta(contentType: string, content: unknown): NoteCardMeta {
  const typeLabel = TYPE_LABELS[contentType] ?? getNoteType(contentType)?.label ?? contentType;
  const record = asRecord(content);
  let title = stringField(record, ["title", "label", "name"]);
  let extra: string | undefined;

  if (!title) {
    if (typeof content === "string") {
      title = contentType === "mermaid" || contentType === "markmap" ? diagramTitle(contentType, content) : textTitle(content);
    } else if (contentType === "quiz") {
      title = stringField(record, ["question"]);
    } else if (contentType === "flashcard") {
      title = stringField(record, ["front"]);
    } else if (contentType === "code-snippet") {
      const code = typeof record.code === "string" ? record.code : "";
      title = firstCodeFunction(code);
    } else if (contentType === "html-sandbox") {
      const html = typeof record.html === "string" ? record.html : "";
      title =
        html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ??
        html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ??
        stripHtml(html);
    } else if (contentType === "mindmap") {
      title = stringField(record, ["title", "text"]);
    }
  }

  if (contentType === "quiz") {
    const questions = Array.isArray(record.questions) ? record.questions.length : 1;
    extra = `${questions} ${questions === 1 ? "question" : "questions"}`;
  } else if (contentType === "code-snippet") {
    const language = stringField(record, ["language"]);
    extra = language || undefined;
  } else if (contentType === "html-sandbox" && record.interactive === true) {
    extra = "Interactive";
  } else if (contentType.startsWith("textbook.")) {
    extra = stringField(record, ["level", "difficulty", "mastery"]) || undefined;
  } else if (contentType === "video" || contentType === "audio" || contentType === "image") {
    extra = contentType === "image" ? "image" : contentType;
  }

  return {
    typeLabel,
    title: compact(title || `${typeLabel} note`),
    extra
  };
}
