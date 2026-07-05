// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { FlipCard, Reveal, useChoiceQuiz } from "./noteInteractive";

// Mount a node into a live container so click/keydown handlers actually fire, then run
// interactions inside act(). Returns the container + an unmount cleanup.
function mount(node: React.ReactNode): { container: HTMLElement; unmount(): void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node as React.ReactElement));
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    }
  };
}

describe("FlipCard", () => {
  it("shows the front only, and the back only after a click (hidden face is absent from the DOM)", () => {
    const { container, unmount } = mount(<FlipCard front={<span>FRONT</span>} back={<span>BACK</span>} />);
    const card = container.querySelector(".sv-flip") as HTMLElement;
    expect(card.getAttribute("data-face")).toBe("front");
    expect(card.getAttribute("aria-pressed")).toBe("false");
    expect(container.textContent).toContain("FRONT");
    expect(container.textContent).not.toContain("BACK"); // back genuinely absent pre-flip
    expect(container.querySelector(".sv-flip-back")).toBeNull();

    act(() => card.click());
    expect(card.getAttribute("data-face")).toBe("back");
    expect(card.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("BACK");
    expect(container.textContent).not.toContain("FRONT");
    unmount();
  });

  it("Enter toggles the face (keyboard a11y)", () => {
    const { container, unmount } = mount(<FlipCard front={<span>FRONT</span>} back={<span>BACK</span>} />);
    const card = container.querySelector(".sv-flip") as HTMLElement;
    act(() => card.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(card.getAttribute("data-face")).toBe("back");
    expect(container.textContent).toContain("BACK");
    unmount();
  });

  it("initialFlipped opens on the back face directly (the review reveal — no second flip)", () => {
    const { container, unmount } = mount(
      <FlipCard front={<span>FRONT</span>} back={<span>BACK</span>} initialFlipped />
    );
    const card = container.querySelector(".sv-flip") as HTMLElement;
    expect(card.getAttribute("data-face")).toBe("back"); // answer face up front
    expect(container.textContent).toContain("BACK");
    expect(container.textContent).not.toContain("FRONT"); // front is the hidden face now
    // Still freely toggleable — a click flips back to the question face.
    act(() => card.click());
    expect(card.getAttribute("data-face")).toBe("front");
    expect(container.textContent).toContain("FRONT");
    unmount();
  });
});

describe("Reveal", () => {
  it("hides the answer behind a button, then shows it once clicked", () => {
    const { container, unmount } = mount(<Reveal hidden={<span>THE ANSWER</span>} />);
    const btn = container.querySelector(".sv-reveal-btn") as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(container.textContent).not.toContain("THE ANSWER"); // absent until revealed

    act(() => btn.click());
    expect(container.querySelector(".sv-reveal-btn")).toBeNull(); // button consumed
    expect(container.querySelector(".sv-reveal-shown")).toBeTruthy();
    expect(container.textContent).toContain("THE ANSWER");
    unmount();
  });

  it("uses a custom trigger label when supplied", () => {
    const { container, unmount } = mount(<Reveal hidden={<span>A</span>} trigger="Show me" />);
    expect((container.querySelector(".sv-reveal-btn") as HTMLElement).textContent).toBe("Show me");
    unmount();
  });
});

describe("useChoiceQuiz", () => {
  // A tiny harness component that surfaces the hook's state as data-attributes so the
  // test can drive picks through the option buttons and read the outcome.
  function QuizHarness({ correctIndex }: { correctIndex: number }) {
    const quiz = useChoiceQuiz(3, correctIndex);
    return (
      <div
        className="harness"
        data-selected={quiz.selected === null ? "" : String(quiz.selected)}
        data-revealed={String(quiz.revealed)}
        data-correct={String(quiz.correct)}
      >
        {[0, 1, 2].map((i) => (
          <button key={i} className={`opt opt-${i}`} onClick={() => quiz.pick(i)}>
            option {i}
          </button>
        ))}
      </div>
    );
  }

  it("starts unanswered; a WRONG pick reveals with correct=false", () => {
    const { container, unmount } = mount(<QuizHarness correctIndex={2} />);
    const root = container.querySelector(".harness") as HTMLElement;
    expect(root.getAttribute("data-revealed")).toBe("false");
    expect(root.getAttribute("data-selected")).toBe("");

    act(() => (container.querySelector(".opt-0") as HTMLButtonElement).click());
    expect(root.getAttribute("data-revealed")).toBe("true");
    expect(root.getAttribute("data-selected")).toBe("0");
    expect(root.getAttribute("data-correct")).toBe("false");
    unmount();
  });

  it("a RIGHT pick reveals with correct=true", () => {
    const { container, unmount } = mount(<QuizHarness correctIndex={1} />);
    const root = container.querySelector(".harness") as HTMLElement;
    act(() => (container.querySelector(".opt-1") as HTMLButtonElement).click());
    expect(root.getAttribute("data-revealed")).toBe("true");
    expect(root.getAttribute("data-correct")).toBe("true");
    unmount();
  });

  it("locks in the FIRST pick — a later click does not change the selection", () => {
    const { container, unmount } = mount(<QuizHarness correctIndex={2} />);
    const root = container.querySelector(".harness") as HTMLElement;
    act(() => (container.querySelector(".opt-0") as HTMLButtonElement).click()); // wrong first
    act(() => (container.querySelector(".opt-2") as HTMLButtonElement).click()); // correct later — ignored
    expect(root.getAttribute("data-selected")).toBe("0");
    expect(root.getAttribute("data-correct")).toBe("false");
    unmount();
  });
});
