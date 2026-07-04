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
  /**
   * REV-CORE review capability (kit-flatten-and-core-review.md §1) — the reviewable
   * CONTRACT on the registry (the adaptive-note move: capability declared per spec,
   * the review engine reads the registry, core never imports kit files). A spec that
   * declares `review.reviewable` enters queue rule 2 (review material,
   * least-recently-reviewed); a GRADABLE spec also exposes `expectedAnswer` so the
   * AI check/grade flow knows the correct answer without poking the content shape.
   */
  review?: {
    reviewable: true;
    expectedAnswer?(content: T): string | null;
  };
  /** Marks a spec as 错题-material — queue rule 1 (mistakes first) keys on THIS
      capability, never on a contentType string. */
  mistake?: true;
};

const registry = new Map<string, NoteContentSpec>();

// —— contentType aliases (REV-CORE) ——————————————————————————————————————————
// A GENERIC alias map: an old persisted contentType id resolves to a live spec
// under a new id — zero data migration (existing vault records keep validating and
// rendering; new saves write the canonical id). A DIRECT registration for the alias
// id always wins over the alias (aliases only fill lookup gaps, never shadow).
const aliases = new Map<string, string>();

export function registerNoteContentSpecAlias(alias: string, contentType: string): void {
  aliases.set(alias, contentType);
}

/** The canonical contentType an alias points at (undefined when not an alias). */
export function resolveNoteContentTypeAlias(contentType: string): string | undefined {
  return aliases.get(contentType);
}

export function registerNoteContentSpec<T>(spec: NoteContentSpec<T>): void {
  registry.set(spec.contentType, spec as NoteContentSpec);
}

export function getNoteContentSpec(contentType: string): NoteContentSpec | undefined {
  const direct = registry.get(contentType);
  if (direct) return direct;
  const alias = aliases.get(contentType);
  return alias ? registry.get(alias) : undefined;
}

export function listNoteContentSpecs(): readonly NoteContentSpec[] {
  return Array.from(registry.values());
}

/**
 * Validate a note's content against its type's spec. Returns the parsed value.
 * Throws a ZodError on mismatch and a plain Error for an unknown contentType
 * (the API turns the former into 400 via its ZodError handler, the latter is
 * caught and reported as an invalid request). Alias-aware: an aliased legacy id
 * (e.g. "textbook.mistake") validates against its canonical spec.
 */
export function parseNoteContent(contentType: string, content: unknown): unknown {
  const spec = getNoteContentSpec(contentType);
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
// —— html (unified static | interactive; design plan §2.5, §3, §4 Phase 3) ————
// ONE `html` contentType (persisted id stays "html-sandbox" — DO NOT rename; existing
// notes persist this id and a rename would need a risky migration). Its content has an
// internal `interactive` variant handled by the single html render (NOT a competing
// top-level discriminator — §3). Two security postures:
//   • interactive:false (default) — INERT: rendered in <iframe sandbox=""> (no scripts,
//     no network, no same-origin). The original html-sandbox behavior.
//   • interactive:true — a hardened game frame: <iframe sandbox="allow-scripts"> (NEVER
//     allow-same-origin) + a strict default-src 'none' CSP. Runs ONLY in the overlay.
//
// BACKWARD COMPAT (critical): notes stored before Phase 3 are { html } with NO
// `interactive` field. `interactive` is OPTIONAL and DEFAULTS to false, so an old
// { html } note still parses → renders inert exactly as before (covered by a test).
const htmlSandboxSchema = z.object({ html: z.string(), interactive: z.boolean().optional().default(false) });

// —— video (unified asset | embed; design plan §2.5, §4 Phase 2) ————————————
// ONE `video` contentType with an internal `kind` variant handled by the single
// video render (NOT a competing top-level discriminator — §3). Two shapes:
//   • asset — a local file imported into the vault (the original shape).
//   • embed — a remote provider (YouTube / bilibili / Vimeo) played in an iframe.
//
// BACKWARD COMPAT (critical): notes stored before Phase 2 have { assetId, … } with
// NO `kind`. The asset member treats `kind` as OPTIONAL and DEFAULTS it to "asset",
// so an old `{ assetId }` note still parses → the union accepts the legacy shape
// unchanged. New asset notes may write `kind:"asset"` explicitly; both validate.
const VIDEO_PROVIDERS = ["youtube", "bilibili", "vimeo"] as const;
const videoAssetSchema = z.object({
  // Optional + defaulted: an absent kind (legacy note) is normalized to "asset".
  kind: z.literal("asset").default("asset"),
  assetId: assetIdSchema,
  caption: z.string().optional(),
  startSec: z.number().nonnegative().optional(),
  endSec: z.number().nonnegative().optional()
});
const videoEmbedSchema = z.object({
  kind: z.literal("embed"),
  provider: z.enum(VIDEO_PROVIDERS),
  videoId: z.string().min(1),
  url: z.string().min(1),
  caption: z.string().optional()
});
// A plain union (NOT discriminatedUnion) so the asset member's defaulted/absent
// `kind` still matches the legacy `{ assetId }` shape. The embed member's required
// `kind:"embed"` keeps the two unambiguous.
const videoSchema = z.union([videoEmbedSchema, videoAssetSchema]);
type VideoContent = z.infer<typeof videoSchema>;
function videoSearchText(c: VideoContent): string {
  return c.caption ?? "";
}

// Bookmark: a lightweight NAMED marker on a passage. It reuses the note envelope
// (anchor, layers, study-pack travel, search) but its content is intentionally
// minimal — a label, an optional color, an optional order. The bespoke "show it as
// a chip, not a card" presentation lives entirely in the client plugin; the data is
// a plain note. See docs/design/bookmark-modeling.md.
export const BOOKMARK_CONTENT_TYPE = "bookmark";
const bookmarkSchema = z.object({
  label: z.string(),
  color: z.string().optional(),
  order: z.number().optional(),
  // R8: an OPTIONAL grouping label for the hover-reveal Bookmark index. Additive — no
  // migration (absent = "Ungrouped"). Doesn't enter search text (the label is enough).
  category: z.string().optional()
});

const stripTags = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

// —— mistake (错题) — CORE built-in since REV-CORE ————————————————————————————
// The mission loop's rule-1 material moved out of the textbook kit
// (kit-flatten-and-core-review.md §1): the structure is EXACTLY the old
// `textbook.mistake` schema. Zero data migration: "textbook.mistake" registers as an
// ALIAS of this spec (see registerBuiltinNoteContentSpecs), so existing vault records
// keep validating/rendering; NEW saves write `"mistake"`.
export const MISTAKE_CONTENT_TYPE = "mistake";
const mistakeSchema = z.object({
  exerciseNoteId: z.string().optional(),
  question: z.string(),
  wrongAnswer: z.string(),
  correctAnswer: z.string(),
  mistakeReason: z.string().optional(),
  correction: z.string().optional(),
  retryCount: z.number().default(0),
  mastery: z.enum(["unknown", "weak", "improving", "mastered"]).default("weak")
});
export type MistakeContent = z.infer<typeof mistakeSchema>;

export const mistakeSpec: NoteContentSpec<MistakeContent> = {
  contentType: MISTAKE_CONTENT_TYPE,
  schema: mistakeSchema,
  createDefault: () => ({
    question: "",
    wrongAnswer: "",
    correctAnswer: "",
    retryCount: 0,
    mastery: "weak"
  }),
  toSearchText: (c) => [c.question, c.mistakeReason ?? "", c.correction ?? ""].join("\n"),
  // Queue rule 1 keys on this capability (NOT on the contentType string).
  mistake: true
};

// —— file-link (链接文件) — CORE built-in since SHELL-PRIM ————————————————————
// The raw shell's third primitive tool (kit-flatten-and-core-review.md §3): a note
// that POINTS at a local file (path + optional title/note). The note owns only the
// reference — the bytes stay on disk (unlike image/audio/video, which import into
// the vault as assets). 打开 opens it with the OS default app via the electron
// bridge; in a plain browser the action degrades to copy-the-path. A blank path is
// rejected before storage (like the media types' empty asset seeds).
export const FILE_LINK_CONTENT_TYPE = "file-link";
const fileLinkSchema = z.object({
  path: z.string().min(1),
  title: z.string().optional(),
  note: z.string().optional()
});
export type FileLinkContent = z.infer<typeof fileLinkSchema>;

export const fileLinkSpec: NoteContentSpec<FileLinkContent> = {
  contentType: FILE_LINK_CONTENT_TYPE,
  schema: fileLinkSchema,
  // Intentionally incomplete seed (path must be user-filled before save), mirroring
  // the image/audio/video empty-asset seeds.
  createDefault: () => ({ path: "" }) as unknown as FileLinkContent,
  toSearchText: (c) => [c.title ?? "", c.path, c.note ?? ""].filter(Boolean).join("\n")
};

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
    },
    // REV-CORE: review material (queue rule 2); the back IS the expected answer.
    review: {
      reviewable: true,
      expectedAnswer: (c) => (c as z.infer<typeof flashcardSchema>).back || null
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
    },
    // REV-CORE: quiz IS the core 可检验卡片 primitive — reviewable + gradable.
    review: {
      reviewable: true,
      expectedAnswer: (c) => {
        const q = c as z.infer<typeof quizSchema>;
        return q.options[q.answerIndex] ?? null;
      }
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
    schema: videoSchema,
    // Seed an asset video (the composer's "choose a file" path); embed videos are
    // created via the classifier / a pasted link, not this blank seed.
    createDefault: () => ({ kind: "asset", assetId: "" }) as unknown as VideoContent,
    toSearchText: (c) => videoSearchText(c as VideoContent)
  },
  {
    contentType: "html-sandbox",
    schema: htmlSandboxSchema,
    createDefault: () => ({ html: "" }),
    toSearchText: (c) => stripTags((c as z.infer<typeof htmlSandboxSchema>).html)
  },
  {
    contentType: BOOKMARK_CONTENT_TYPE,
    schema: bookmarkSchema,
    createDefault: () => ({ label: "" }),
    toSearchText: (c) => (c as z.infer<typeof bookmarkSchema>).label
  },
  mistakeSpec as NoteContentSpec,
  fileLinkSpec as NoteContentSpec
];

let registered = false;
/** Register the built-in specs once. Safe to call repeatedly. */
export function registerBuiltinNoteContentSpecs(): void {
  if (registered) return;
  for (const spec of builtinNoteContentSpecs) registerNoteContentSpec(spec);
  // REV-CORE zero-migration alias: pre-existing vault records persisted as
  // "textbook.mistake" resolve to the core mistake spec (validate, search, render).
  registerNoteContentSpecAlias("textbook.mistake", MISTAKE_CONTENT_TYPE);
  registered = true;
}

// Built-ins are available the moment this module is imported.
registerBuiltinNoteContentSpecs();
