// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import "./ShortcutHelp";

import { setLocale } from "../i18n";
import { getView } from "./viewRegistry";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  setLocale("zh");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("ShortcutHelp", () => {
  it("lists only real keyboard shortcuts, not selection-toolbar button labels", () => {
    act(() => {
      root.render(
        getView("shortcut.help")!.render({ id: "shortcut", kind: "shortcut.help" } as never, {} as never) as React.ReactElement
      );
    });

    const keys = Array.from(container.querySelectorAll("kbd")).map((node) => node.textContent);
    expect(keys).toEqual(["Ctrl / Cmd + K", "Esc", "?", "Enter"]);
    expect(keys).not.toContain("朗读 / Speak");
    expect(keys).not.toContain("拼 / Pinyin");
  });
});
