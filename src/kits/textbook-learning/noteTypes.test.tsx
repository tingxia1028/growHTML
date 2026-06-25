// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { getNoteType, listNoteTypes, spec } from "../../client/notes/noteTypeRegistry";
import { kitContentTypeLabel } from "../language";

// Side-effect: installs the Product Kits (registers textbook specs + plugins + language).
import "../clientKits";

function renderToHtml(node: React.ReactNode): string {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(node as React.ReactElement));
  const html = container.innerHTML;
  act(() => root.unmount());
  return html;
}

function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const TYPES = ["textbook.explanation", "textbook.exercise", "textbook.mistake"];

describe("Textbook Kit client install", () => {
  it("registers a client plugin for each Study Block type", () => {
    for (const t of TYPES) {
      expect(getNoteType(t), `missing plugin ${t}`).toBeTruthy();
      expect(listNoteTypes().map((p) => p.contentType)).toContain(t);
    }
  });

  it("exposes domain display names via the kit language", () => {
    expect(kitContentTypeLabel("textbook.explanation")).toBe("Explanation");
    expect(kitContentTypeLabel("textbook.exercise")).toBe("Practice");
    expect(kitContentTypeLabel("textbook.mistake")).toBe("Mistake");
  });
});

describe("Textbook Kit render", () => {
  it("explanation renders title, level, prose, key points", () => {
    const html = renderToHtml(
      getNoteType("textbook.explanation")!.render({
        content: {
          title: "Photosynthesis",
          level: "simple",
          explanation: "Plants make **food**.",
          analogy: "Like a kitchen.",
          keyPoints: ["needs light"],
          commonMisunderstandings: ["it is not breathing"]
        }
      })
    );
    expect(html).toContain("Photosynthesis");
    expect(html).toContain("simple");
    expect(html).toContain("<strong>food</strong>"); // prose is sanitized markdown
    expect(html).toContain("needs light");
    expect(html).toContain("it is not breathing");
  });

  it("exercise renders question, options, marked answer, difficulty", () => {
    const html = renderToHtml(
      getNoteType("textbook.exercise")!.render({
        content: {
          question: "2+2?",
          type: "single-choice",
          options: ["3", "4"],
          answer: "4",
          explanation: "Add.",
          difficulty: "easy",
          relatedKnowledgePoints: []
        }
      })
    );
    expect(html).toContain("2+2?");
    expect(html).toContain("tb-exercise-options");
    expect(html).toContain("Answer:");
    expect(html).toContain("easy");
  });

  it("mistake renders wrong vs correct + mastery", () => {
    const html = renderToHtml(
      getNoteType("textbook.mistake")!.render({
        content: {
          question: "Q?",
          wrongAnswer: "12",
          correctAnswer: "14",
          mistakeReason: "misread",
          retryCount: 2,
          mastery: "improving"
        }
      })
    );
    expect(html).toContain("Q?");
    expect(html).toContain("12");
    expect(html).toContain("14");
    expect(html).toContain("improving");
  });

  it("a render NEVER throws on foreign/mis-shaped content", () => {
    expect(() => renderToHtml(getNoteType("textbook.explanation")!.render({ content: "oops" }))).not.toThrow();
    expect(() => renderToHtml(getNoteType("textbook.exercise")!.render({ content: null }))).not.toThrow();
    expect(() => renderToHtml(getNoteType("textbook.mistake")!.render({ content: 42 }))).not.toThrow();
  });
});

describe("Textbook Kit edit — onChange emits content the core schema accepts", () => {
  it("explanation editor emits a schema-valid value", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let current: unknown = spec("textbook.explanation").createDefault();
    const onChange = (next: unknown) => {
      current = next;
      root.render(getNoteType("textbook.explanation")!.edit({ content: current, onChange }) as React.ReactElement);
    };
    act(() => root.render(getNoteType("textbook.explanation")!.edit({ content: current, onChange }) as React.ReactElement));
    act(() => {
      setValue(container.querySelector(".tb-explanation-title")!, "Title");
      setValue(container.querySelector(".tb-explanation-text")!, "Body");
      setValue(container.querySelector(".tb-explanation-keypoints")!, "one\ntwo");
    });
    expect(current).toMatchObject({ title: "Title", explanation: "Body", keyPoints: ["one", "two"] });
    expect(() => spec("textbook.explanation").schema.parse(current)).not.toThrow();
    act(() => root.unmount());
    container.remove();
  });
});
