// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

// Composer "detected · override" chip (decision #2). The picker live-classifies the
// composer text and shows a "detected: <form>" chip; a HIGH-confidence detection
// auto-selects the form; "change" reveals the override <select> (all offered types);
// "auto" returns to the detected form. The choice is always user-overridable.
//
// Stub DiagramNote (heavy libs) — irrelevant here; the picker doesn't render notes.
vi.mock("../DiagramNote", () => ({ DiagramNote: () => <div className="mock-diagram" /> }));

import { ComposerTypePicker } from "./ComposerTypePicker";

const OPTIONS = [
  { contentType: "markdown", label: "markdown" },
  { contentType: "mermaid", label: "mermaid" },
  { contentType: "markmap", label: "markmap" },
  { contentType: "code-snippet", label: "code snippet" }
];

// A controlled harness: the picker's onChange feeds `value` back so auto-apply sticks.
function mountPicker(text: string) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let value = "markdown";
  const changes: string[] = [];
  const render = () =>
    root.render(
      <ComposerTypePicker
        text={text}
        value={value}
        onChange={(next) => {
          value = next;
          changes.push(next);
          render();
        }}
        options={OPTIONS}
      />
    );
  act(() => render());
  return {
    container,
    changes,
    get value() {
      return value;
    },
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    }
  };
}

describe("ComposerTypePicker — detect", () => {
  it("a mermaid source auto-selects mermaid and shows the detected chip", () => {
    const h = mountPicker("flowchart LR; A --> B");
    expect(h.container.querySelector(".composer-detected-chip")).toBeTruthy();
    expect(h.container.querySelector(".composer-detected-label strong")?.textContent).toBe("mermaid");
    expect(h.value).toBe("mermaid"); // high-confidence detection auto-applied
    h.cleanup();
  });

  it("a multi-level outline auto-selects markmap", () => {
    const h = mountPicker("# Root\n## Child A\n## Child B");
    expect(h.value).toBe("markmap");
    h.cleanup();
  });

  it("plain prose stays markdown (low confidence, never auto-applies a rich form)", () => {
    const h = mountPicker("just some ordinary prose without structure");
    expect(h.value).toBe("markdown");
    expect(h.container.querySelector(".composer-detected-label strong")?.textContent).toBe("markdown");
    h.cleanup();
  });
});

describe("ComposerTypePicker — override", () => {
  it("'change' reveals the override select listing every offered type; choosing one overrides", () => {
    const h = mountPicker("flowchart LR; A --> B"); // detects mermaid
    expect(h.value).toBe("mermaid");
    // Click "change" → the override select appears.
    const change = h.container.querySelector(".composer-detected-change") as HTMLButtonElement;
    act(() => change.click());
    const select = h.container.querySelector("select.note-type-select") as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      "markdown",
      "mermaid",
      "markmap",
      "code-snippet"
    ]);
    // Override to markdown — and it STICKS (no auto re-apply back to mermaid).
    act(() => {
      const proto = HTMLSelectElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(select, "markdown");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(h.value).toBe("markdown");
    h.cleanup();
  });

  it("'auto' returns to the detected form after an override", () => {
    const h = mountPicker("flowchart LR; A --> B");
    act(() => (h.container.querySelector(".composer-detected-change") as HTMLButtonElement).click());
    const auto = h.container.querySelector(".composer-type-auto") as HTMLButtonElement;
    act(() => auto.click());
    expect(h.value).toBe("mermaid"); // back to the detected form
    h.cleanup();
  });
});
