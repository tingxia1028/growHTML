import { describe, expect, it } from "vitest";
import {
  formRouterSchema,
  formRouterSample,
  routerOutputToNote,
  type FormRouterOutput
} from "./formRouter";
import { generateStructured } from "../../ai/structured";
import { MockModelProvider, FORM_ROUTER_CONTENT_TYPE } from "../../ai/mockProvider";
import { getNoteContentSpec } from "./contentTypes";

// formRouter (adaptive note forms · Phase 4 item 1). The router schema is a transport
// envelope; `routerOutputToNote` unwraps each member into a REGISTERED contentType +
// content shaped for that type's core NoteContentSpec schema. Every mapping is checked
// AND re-validated against the real core schema so the routed note is persistable.

// Assert the routed { contentType, content } parses against the live core spec.
function assertPersistable(routed: { contentType: string; content: unknown }) {
  const spec = getNoteContentSpec(routed.contentType);
  expect(spec, `contentType ${routed.contentType} must be registered`).toBeDefined();
  expect(() => spec!.schema.parse(routed.content)).not.toThrow();
}

describe("formRouterSchema — accepts each valid union member, rejects bad ones", () => {
  it("parses every offered form", () => {
    const members: FormRouterOutput[] = [
      { form: "markdown", markdown: "hi" },
      { form: "markmap", outline: "# A\n## B" },
      { form: "mermaid", diagram: "graph TD; A-->B" },
      { form: "code-snippet", language: "ts", code: "const x = 1;" },
      { form: "video-embed", url: "https://youtu.be/dQw4w9WgXcQ" },
      { form: "html-interactive", html: "<canvas></canvas>" },
      { form: "flashcard", front: "Q", back: "A" },
      { form: "quiz", question: "?", options: ["a", "b"], answerIndex: 0 }
    ];
    for (const m of members) expect(() => formRouterSchema.parse(m)).not.toThrow();
  });

  it("rejects an unknown form discriminator", () => {
    expect(() => formRouterSchema.parse({ form: "nope", x: 1 })).toThrow();
  });

  it("rejects a member missing its required field", () => {
    expect(() => formRouterSchema.parse({ form: "mermaid" })).toThrow();
    expect(() => formRouterSchema.parse({ form: "quiz", question: "?", options: ["only-one"], answerIndex: 0 })).toThrow();
  });

  it("defaults code-snippet language to 'text'", () => {
    const parsed = formRouterSchema.parse({ form: "code-snippet", code: "x" }) as Extract<
      FormRouterOutput,
      { form: "code-snippet" }
    >;
    expect(parsed.language).toBe("text");
  });
});

describe("routerOutputToNote — maps every variant to a registry-ready note", () => {
  it("markdown → markdown string", () => {
    const r = routerOutputToNote({ form: "markdown", markdown: "hello" });
    expect(r).toEqual({ contentType: "markdown", content: "hello" });
    assertPersistable(r);
  });

  it("markmap → markmap outline string", () => {
    const r = routerOutputToNote({ form: "markmap", outline: "# R\n## C" });
    expect(r).toEqual({ contentType: "markmap", content: "# R\n## C" });
    assertPersistable(r);
  });

  it("mermaid → mermaid diagram string", () => {
    const r = routerOutputToNote({ form: "mermaid", diagram: "graph TD; A-->B" });
    expect(r).toEqual({ contentType: "mermaid", content: "graph TD; A-->B" });
    assertPersistable(r);
  });

  it("code-snippet → { language, code }", () => {
    const r = routerOutputToNote({ form: "code-snippet", language: "python", code: "print(1)" });
    expect(r).toEqual({ contentType: "code-snippet", content: { language: "python", code: "print(1)" } });
    assertPersistable(r);
  });

  it("video-embed → video { kind:'embed', provider, videoId, url } for a real provider URL", () => {
    const r = routerOutputToNote({ form: "video-embed", url: "https://youtu.be/dQw4w9WgXcQ" });
    expect(r).toEqual({
      contentType: "video",
      content: {
        kind: "embed",
        provider: "youtube",
        videoId: "dQw4w9WgXcQ",
        url: "https://youtu.be/dQw4w9WgXcQ"
      }
    });
    assertPersistable(r);
  });

  it("video-embed with an UNPARSEABLE url degrades to a markdown note (never throws)", () => {
    const r = routerOutputToNote({ form: "video-embed", url: "not-a-video-url" });
    expect(r).toEqual({ contentType: "markdown", content: "not-a-video-url" });
    assertPersistable(r);
  });

  it("html-interactive → html-sandbox { html, interactive:true }", () => {
    const r = routerOutputToNote({ form: "html-interactive", html: "<canvas></canvas>" });
    expect(r).toEqual({ contentType: "html-sandbox", content: { html: "<canvas></canvas>", interactive: true } });
    assertPersistable(r);
  });

  it("flashcard → { front, back }", () => {
    const r = routerOutputToNote({ form: "flashcard", front: "Q", back: "A" });
    expect(r).toEqual({ contentType: "flashcard", content: { front: "Q", back: "A" } });
    assertPersistable(r);
  });

  it("quiz → { question, options, answerIndex, explanation? } (explanation omitted when absent)", () => {
    const r = routerOutputToNote({ form: "quiz", question: "?", options: ["a", "b"], answerIndex: 1 });
    expect(r).toEqual({ contentType: "quiz", content: { question: "?", options: ["a", "b"], answerIndex: 1 } });
    assertPersistable(r);
    const withExpl = routerOutputToNote({
      form: "quiz",
      question: "?",
      options: ["a", "b"],
      answerIndex: 0,
      explanation: "because"
    });
    expect((withExpl.content as { explanation?: string }).explanation).toBe("because");
    assertPersistable(withExpl);
  });
});

describe("mock provider is deterministic for the form-router union", () => {
  it("echoes a supplied valid union member as the router output", async () => {
    const sample: FormRouterOutput = { form: "markmap", outline: "# Root\n## A" };
    const out = (await generateStructured(new MockModelProvider(), {
      messages: [{ role: "user", content: "make a mind map" }],
      schema: formRouterSchema,
      sample,
      contentType: FORM_ROUTER_CONTENT_TYPE
    })) as FormRouterOutput;
    expect(out).toEqual(sample);
    // The full path: a valid union member that unwraps to a persistable markmap note.
    assertPersistable(routerOutputToNote(out));
  });

  it("synthesizes the FIRST valid union member when NO sample is supplied", async () => {
    // No sample → the mock must still return a VALID discriminated-union member (not {}),
    // so generateStructured's schema.parse succeeds offline.
    const out = (await generateStructured(new MockModelProvider(), {
      messages: [{ role: "user", content: "anything" }],
      schema: formRouterSchema,
      contentType: FORM_ROUTER_CONTENT_TYPE
    })) as FormRouterOutput;
    expect(out.form).toBe("markdown");
    expect(formRouterSchema.safeParse(out).success).toBe(true);
  });

  it("formRouterSample is a valid union member", () => {
    expect(formRouterSchema.safeParse(formRouterSample).success).toBe(true);
  });
});
