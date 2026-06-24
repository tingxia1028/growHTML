import { z } from "zod";
import { assetIdSchema } from "../schema/common";

// NoteContentSpec — the server+client-shared, React-free half of a note type.
// It owns how a note's `content` (which is `unknown` in the core schema) is
// validated, defaulted, and reduced to searchable text. The client adds the
// React render/edit half on top (see src/client/notes/noteTypeRegistry).
//
// The API validates content with `getNoteContentSpec(contentType).schema` before
// persisting, so an unknown/invalid content shape never reaches storage.
export type NoteContentSpec<T = unknown> = {
  contentType: string;
  schema: z.ZodType<T>;
  /** A blank value to seed a new note of this type in the editor. */
  createDefault(): T;
  /** Human-readable text for search / export (no structural noise). */
  toSearchText(content: T): string;
};

const registry = new Map<string, NoteContentSpec>();

export function registerNoteContentSpec<T>(spec: NoteContentSpec<T>): void {
  registry.set(spec.contentType, spec as NoteContentSpec);
}

export function getNoteContentSpec(contentType: string): NoteContentSpec | undefined {
  return registry.get(contentType);
}

export function listNoteContentSpecs(): readonly NoteContentSpec[] {
  return Array.from(registry.values());
}

/**
 * Validate a note's content against its type's spec. Returns the parsed value.
 * Throws a ZodError on mismatch and a plain Error for an unknown contentType
 * (the API turns the former into 400 via its ZodError handler, the latter is
 * caught and reported as an invalid request).
 */
export function parseNoteContent(contentType: string, content: unknown): unknown {
  const spec = registry.get(contentType);
  if (!spec) throw new Error(`Unknown note contentType: ${contentType}`);
  return spec.schema.parse(content);
}

// —— Built-in content specs ——————————————————————————————————————————————

const textSchema = z.string();

// Mindmap: a tree of labelled nodes. `title` or `text` carries the label so we
// stay compatible with the shape the existing mindmap renderer consumed.
type MindmapNode = { title?: string; text?: string; children?: MindmapNode[] };
const mindmapNodeSchema: z.ZodType<MindmapNode> = z.lazy(() =>
  z.object({
    title: z.string().optional(),
    text: z.string().optional(),
    children: z.array(mindmapNodeSchema).optional()
  })
);

function mindmapText(node: MindmapNode): string {
  const label = node.title ?? node.text ?? "";
  const children = (node.children ?? []).map(mindmapText).join(" ");
  return `${label} ${children}`.trim();
}

const flashcardSchema = z.object({ front: z.string(), back: z.string() });
const quizSchema = z.object({
  question: z.string().min(1),
  options: z.array(z.string()).min(2),
  answerIndex: z.number().int().nonnegative(),
  explanation: z.string().optional()
});
const codeSnippetSchema = z.object({ language: z.string().default("text"), code: z.string() });

// Asset-backed media: content holds a structured reference, not the bytes.
const imageSchema = z.object({ assetId: assetIdSchema, caption: z.string().optional() });
const timedMediaSchema = z.object({
  assetId: assetIdSchema,
  caption: z.string().optional(),
  startSec: z.number().nonnegative().optional(),
  endSec: z.number().nonnegative().optional()
});
const htmlSandboxSchema = z.object({ html: z.string() });

const stripTags = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

export const builtinNoteContentSpecs: NoteContentSpec[] = [
  {
    contentType: "markdown",
    schema: textSchema,
    createDefault: () => "",
    toSearchText: (c) => c as string
  },
  {
    contentType: "plain-text",
    schema: textSchema,
    createDefault: () => "",
    toSearchText: (c) => c as string
  },
  {
    contentType: "mindmap",
    schema: mindmapNodeSchema,
    createDefault: () => ({ title: "Root", children: [] }),
    toSearchText: (c) => mindmapText(c as MindmapNode)
  },
  {
    contentType: "flashcard",
    schema: flashcardSchema,
    createDefault: () => ({ front: "", back: "" }),
    toSearchText: (c) => {
      const card = c as z.infer<typeof flashcardSchema>;
      return `${card.front} ${card.back}`.trim();
    }
  },
  {
    contentType: "mermaid",
    schema: textSchema,
    createDefault: () => "graph TD;\n  A --> B;",
    toSearchText: (c) => c as string
  },
  {
    contentType: "markmap",
    schema: textSchema,
    createDefault: () => "# Root\n## Child",
    toSearchText: (c) => c as string
  },
  {
    contentType: "quiz",
    schema: quizSchema,
    createDefault: () => ({ question: "", options: ["", ""], answerIndex: 0 }),
    toSearchText: (c) => {
      const q = c as z.infer<typeof quizSchema>;
      return [q.question, ...q.options, q.explanation ?? ""].join(" ").trim();
    }
  },
  {
    contentType: "code-snippet",
    schema: codeSnippetSchema,
    createDefault: () => ({ language: "text", code: "" }),
    toSearchText: (c) => (c as z.infer<typeof codeSnippetSchema>).code
  },
  {
    contentType: "image",
    schema: imageSchema,
    createDefault: () => ({ assetId: "", caption: "" }) as unknown as z.infer<typeof imageSchema>,
    toSearchText: (c) => (c as z.infer<typeof imageSchema>).caption ?? ""
  },
  {
    contentType: "audio",
    schema: timedMediaSchema,
    createDefault: () => ({ assetId: "" }) as unknown as z.infer<typeof timedMediaSchema>,
    toSearchText: (c) => (c as z.infer<typeof timedMediaSchema>).caption ?? ""
  },
  {
    contentType: "video",
    schema: timedMediaSchema,
    createDefault: () => ({ assetId: "" }) as unknown as z.infer<typeof timedMediaSchema>,
    toSearchText: (c) => (c as z.infer<typeof timedMediaSchema>).caption ?? ""
  },
  {
    contentType: "html-sandbox",
    schema: htmlSandboxSchema,
    createDefault: () => ({ html: "" }),
    toSearchText: (c) => stripTags((c as z.infer<typeof htmlSandboxSchema>).html)
  }
];

let registered = false;
/** Register the built-in specs once. Safe to call repeatedly. */
export function registerBuiltinNoteContentSpecs(): void {
  if (registered) return;
  for (const spec of builtinNoteContentSpecs) registerNoteContentSpec(spec);
  registered = true;
}

// Built-ins are available the moment this module is imported.
registerBuiltinNoteContentSpecs();
