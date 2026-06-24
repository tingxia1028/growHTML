// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { getNoteContentSpec } from "../../core/notes/contentTypes";
import {
  getNoteType,
  isTextContentType,
  listNoteTypes,
  registerNoteType,
  spec
} from "./noteTypeRegistry";

// Stub DiagramNote so mermaid/markmap plugin renders don't pull the heavy
// mermaid/markmap-view libs (which need a real browser) into jsdom. We assert the
// plugin DELEGATES to it (renders the contentType), not that mermaid produces SVG.
vi.mock("../DiagramNote", () => ({
  DiagramNote: ({ contentType, content }: { contentType: string; content: string }) => (
    <div className="mock-diagram" data-content-type={contentType}>
      {content}
    </div>
  )
}));

// Importing the built-ins registers all 12 plugins (the same side-effect the study
// view uses). Done after the mock so the plugins capture the mocked DiagramNote.
import "./builtinNoteTypes";

// Render a React node into a detached container and return its HTML.
function renderToHtml(node: React.ReactNode): string {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(node as React.ReactElement));
  const html = container.innerHTML;
  act(() => root.unmount());
  return html;
}

// Render an editor as a STATEFUL parent would: each onChange feeds the emitted value
// back as the editor's `content` and re-renders (the editors are controlled, so a
// real parent threads state back — without that, setting a 2nd field would revert the
// 1st to its seed). `drive` performs DOM interactions (typing/clicking); after each,
// React processes the onChange synchronously inside act() and re-renders with the new
// content, so the next interaction sees the accumulated value. Returns the LAST
// emitted value + how many times onChange fired.
function renderEditor(
  contentType: string,
  content: unknown,
  drive: (container: HTMLElement) => void
): { last: unknown; calls: number; html: string } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const plugin = getNoteType(contentType)!;
  let current = content;
  let calls = 0;
  const render = () =>
    root.render(plugin.edit({ content: current, onChange }) as React.ReactElement);
  const onChange = (next: unknown) => {
    current = next;
    calls += 1;
    render(); // a real parent re-renders the controlled editor with the new content
  };
  act(() => render());
  act(() => drive(container));
  const html = container.innerHTML;
  act(() => root.unmount());
  container.remove();
  return { last: current, calls, html };
}

// Set an <input>/<textarea> value the React way (so its onChange fires in jsdom).
function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const ALL_TYPES = [
  "markdown",
  "plain-text",
  "mindmap",
  "flashcard",
  "mermaid",
  "markmap",
  "quiz",
  "code-snippet",
  "image",
  "audio",
  "video",
  "html-sandbox"
];

describe("NoteTypeRegistry", () => {
  it("registers a client plugin for every one of the 12 core content specs", () => {
    for (const type of ALL_TYPES) {
      expect(getNoteType(type), `missing plugin for ${type}`).toBeTruthy();
      expect(listNoteTypes().map((p) => p.contentType)).toContain(type);
    }
  });

  it("a later registration for the same contentType wins", () => {
    const sentinel = { contentType: "markdown", render: () => null, edit: () => null };
    const original = getNoteType("markdown")!;
    registerNoteType(sentinel);
    expect(getNoteType("markdown")).toBe(sentinel);
    registerNoteType(original); // restore for the other tests
    expect(getNoteType("markdown")).toBe(original);
  });

  it("spec() returns the paired core spec and throws for an unknown type", () => {
    expect(spec("flashcard")).toBe(getNoteContentSpec("flashcard"));
    expect(() => spec("not-a-type")).toThrow();
  });

  it("isTextContentType distinguishes string vs object content", () => {
    expect(isTextContentType("markdown")).toBe(true);
    expect(isTextContentType("plain-text")).toBe(true);
    expect(isTextContentType("mermaid")).toBe(true);
    expect(isTextContentType("flashcard")).toBe(false);
    expect(isTextContentType("image")).toBe(false);
  });
});

describe("NoteType render — sample content per type", () => {
  it("markdown renders sanitized HTML (and escapes injected markup)", () => {
    const html = renderToHtml(getNoteType("markdown")!.render({ content: "# Hi\n\n**bold**" }));
    expect(html).toContain("<h1>Hi</h1>");
    expect(html).toContain("<strong>bold</strong>");
    const unsafe = renderToHtml(getNoteType("markdown")!.render({ content: "<script>x</script>" }));
    expect(unsafe).not.toContain("<script>");
    expect(unsafe).toContain("&lt;script&gt;");
  });

  it("plain-text renders escaped inert text (no markdown, no HTML)", () => {
    const html = renderToHtml(getNoteType("plain-text")!.render({ content: "**not bold** <b>x</b>" }));
    expect(html).toContain("sv-plain");
    expect(html).toContain("**not bold**");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<strong>");
  });

  it("mindmap renders a nested tree", () => {
    const content = { title: "Root", children: [{ title: "A" }, { title: "B", children: [{ title: "B1" }] }] };
    const html = renderToHtml(getNoteType("mindmap")!.render({ content }));
    expect(html).toContain("sv-mindmap");
    expect(html).toContain("Root");
    expect(html).toContain("B1");
  });

  it("flashcard renders front + back (flip card)", () => {
    const html = renderToHtml(getNoteType("flashcard")!.render({ content: { front: "Q?", back: "A!" } }));
    expect(html).toContain("<summary>Q?</summary>");
    expect(html).toContain("A!");
  });

  it("mermaid / markmap delegate to DiagramNote with the source string", () => {
    const mer = renderToHtml(getNoteType("mermaid")!.render({ content: "graph TD; A-->B;" }));
    expect(mer).toContain("mock-diagram");
    expect(mer).toContain('data-content-type="mermaid"');
    expect(mer).toContain("A--&gt;B;");
    const mk = renderToHtml(getNoteType("markmap")!.render({ content: "# Root" }));
    expect(mk).toContain('data-content-type="markmap"');
  });

  it("quiz renders the question, options, and marks the answer", () => {
    const content = { question: "2+2?", options: ["3", "4", "5"], answerIndex: 1 };
    const html = renderToHtml(getNoteType("quiz")!.render({ content }));
    expect(html).toContain("2+2?");
    expect(html).toContain("sv-quiz-options");
    // The answer option carries the answer class.
    expect(html).toMatch(/sv-quiz-answer[^>]*>(✓\s*)?4/);
  });

  it("code-snippet renders <pre><code> with the language", () => {
    const html = renderToHtml(getNoteType("code-snippet")!.render({ content: { language: "ts", code: "const x=1;" } }));
    expect(html).toContain("<pre");
    expect(html).toContain("language-ts");
    expect(html).toContain("const x=1;");
  });

  it("image / audio / video render the media element pointed at the asset bytes route", () => {
    const img = renderToHtml(getNoteType("image")!.render({ content: { assetId: "asset_img1", caption: "a cat" } }));
    expect(img).toContain('src="/api/assets/asset_img1"');
    expect(img).toContain("<img");
    expect(img).toContain("a cat");

    const audio = renderToHtml(getNoteType("audio")!.render({ content: { assetId: "asset_a1" } }));
    expect(audio).toContain("<audio");
    expect(audio).toContain('src="/api/assets/asset_a1"');

    const video = renderToHtml(getNoteType("video")!.render({ content: { assetId: "asset_v1" } }));
    expect(video).toContain("<video");
    expect(video).toContain('src="/api/assets/asset_v1"');
  });

  it("image render shows an empty hint when no asset is chosen", () => {
    const html = renderToHtml(getNoteType("image")!.render({ content: { assetId: "" } }));
    expect(html).toContain("sv-media-empty");
    expect(html).not.toContain("<img");
  });

  it("html-sandbox renders a sandboxed (scriptless) iframe carrying the html", () => {
    const html = renderToHtml(getNoteType("html-sandbox")!.render({ content: { html: "<p>hi</p><script>evil()</script>" } }));
    expect(html).toContain("<iframe");
    expect(html).toContain('sandbox=""'); // empty sandbox = no scripts/forms/same-origin
    // The HTML is delivered via srcdoc (inert in a scriptless frame), not injected
    // into the host DOM — so the host never gets a live <script>.
    expect(html).toContain("srcdoc");
  });

  it("a render NEVER throws on a foreign/mis-shaped content (inert fallback)", () => {
    // flashcard given a string, quiz given null, code given a number — none should throw.
    expect(() => renderToHtml(getNoteType("flashcard")!.render({ content: "oops" }))).not.toThrow();
    expect(() => renderToHtml(getNoteType("quiz")!.render({ content: null }))).not.toThrow();
    expect(() => renderToHtml(getNoteType("code-snippet")!.render({ content: 42 }))).not.toThrow();
    expect(() => renderToHtml(getNoteType("mindmap")!.render({ content: "not json" }))).not.toThrow();
  });
});

describe("NoteType edit — onChange emits content that round-trips the core schema", () => {
  it("markdown / text editor emits the typed string", () => {
    const { last } = renderEditor("markdown", "", (container) => {
      setValue(container.querySelector("textarea")!, "hello world");
    });
    expect(last).toBe("hello world");
    expect(() => spec("markdown").schema.parse(last)).not.toThrow();
  });

  it("flashcard editor emits {front, back} that the core schema accepts", () => {
    const seed = spec("flashcard").createDefault();
    const { last } = renderEditor("flashcard", seed, (container) => {
      const [front, back] = Array.from(container.querySelectorAll("input")) as HTMLInputElement[];
      setValue(front, "What is X?");
      setValue(back, "X is Y.");
    });
    expect(last).toMatchObject({ front: "What is X?", back: "X is Y." });
    expect(() => spec("flashcard").schema.parse(last)).not.toThrow();
  });

  it("quiz editor emits a valid quiz (question, options, answerIndex) and can mark the answer", () => {
    const seed = spec("quiz").createDefault();
    const { last } = renderEditor("quiz", seed, (container) => {
      const inputs = Array.from(container.querySelectorAll("input")) as HTMLInputElement[];
      const question = inputs.find((i) => i.classList.contains("quiz-question"))!;
      const optionInputs = inputs.filter((i) => i.classList.contains("quiz-option"));
      const radios = inputs.filter((i) => i.type === "radio");
      setValue(question, "Capital of France?");
      setValue(optionInputs[0], "Paris");
      setValue(optionInputs[1], "Berlin");
      radios[0].click(); // mark option 0 as the answer
    });
    expect(last).toMatchObject({ question: "Capital of France?", answerIndex: 0 });
    expect((last as { options: string[] }).options).toEqual(expect.arrayContaining(["Paris", "Berlin"]));
    expect(() => spec("quiz").schema.parse(last)).not.toThrow();
  });

  it("code-snippet editor emits {language, code} the core schema accepts", () => {
    const seed = spec("code-snippet").createDefault();
    const { last } = renderEditor("code-snippet", seed, (container) => {
      setValue(container.querySelector("input.code-language")!, "python");
      setValue(container.querySelector("textarea.code-body")!, "print('hi')");
    });
    expect(last).toMatchObject({ language: "python", code: "print('hi')" });
    expect(() => spec("code-snippet").schema.parse(last)).not.toThrow();
  });

  it("mindmap JSON editor validates against the spec — valid JSON emits, invalid does not", () => {
    const seed = spec("mindmap").createDefault();
    // Valid structured JSON → emitted + schema-valid.
    const ok = renderEditor("mindmap", seed, (container) => {
      setValue(container.querySelector("textarea")!, JSON.stringify({ title: "Root", children: [{ title: "Leaf" }] }));
    });
    expect(ok.last).toMatchObject({ title: "Root" });
    expect(() => spec("mindmap").schema.parse(ok.last)).not.toThrow();
    // Invalid JSON → onChange NOT called (last stays undefined).
    const bad = renderEditor("mindmap", seed, (container) => {
      setValue(container.querySelector("textarea")!, "{ not json");
    });
    expect(bad.calls).toBe(0);
  });

  it("html-sandbox editor emits {html} the core schema accepts", () => {
    const { last } = renderEditor("html-sandbox", { html: "" }, (container) => {
      setValue(container.querySelector("textarea")!, "<p>note</p>");
    });
    expect(last).toEqual({ html: "<p>note</p>" });
    expect(() => spec("html-sandbox").schema.parse(last)).not.toThrow();
  });

  it("media editor emits a caption (asset pick is desktop-only; covered in electron/e2e)", () => {
    // No window.studyVault in jsdom → the pick button is disabled, but the caption
    // field still emits content that, with a (valid) assetId, satisfies the image
    // schema. A valid asset id is `asset_<ULID>` (26-char Crockford base32).
    const assetId = "asset_01ARZ3NDEKTSV4RRFFQ69G5FAV";
    const { last } = renderEditor("image", { assetId }, (container) => {
      setValue(container.querySelector("input.media-caption")!, "diagram");
    });
    expect(last).toMatchObject({ assetId, caption: "diagram" });
    expect(() => spec("image").schema.parse(last)).not.toThrow();
  });
});
