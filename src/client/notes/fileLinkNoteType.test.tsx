// @vitest-environment jsdom
// SHELL-PRIM — the core `file-link` (链接文件) note type (kit-flatten-and-core-review
// §3). Follows the coreReviewRegistration idioms: registration (both halves, at core
// seed, VISIBLE), the slash palette entry + `/链接` alias resolution, the ONE
// getNoteType().render path (card basename/title/path · full note text), the 打开
// action's desktop (bridge openPath) vs web (clipboard copy) branches, and the
// declared composer form producing a schema-valid draft.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

// Stub DiagramNote so importing the built-ins doesn't pull mermaid/markmap-view into
// jsdom — the same stub every registry-level test uses.
vi.mock("../DiagramNote", () => ({
  DiagramNote: () => <div className="mock-diagram" />
}));

// Side effects: the core built-ins (incl. file-link).
import "./builtinNoteTypes";

import { getNoteType, listNoteTypes, spec } from "./noteTypeRegistry";
import { FILE_LINK_CONTENT_TYPE, getNoteContentSpec } from "../../core/notes/contentTypes";
import { fileLinkBasename } from "./fileLinkNoteType";
import { slashEntriesFromNoteTypes } from "../slash/adapters";
import { parseSlashInput, resolveSlashEntries } from "../slash/engine";

function renderToHtml(node: React.ReactNode): string {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node as React.ReactElement));
  const html = container.innerHTML;
  act(() => root.unmount());
  container.remove();
  return html;
}

// Render into a LIVE container so we can click the 打开 button; caller must dispose.
function mount(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node as React.ReactElement));
  return {
    container,
    dispose() {
      act(() => root.unmount());
      container.remove();
    }
  };
}

// Set an <input>/<textarea> value the React way (so its onChange fires in jsdom).
function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const flush = () => act(async () => {});

afterEach(() => {
  delete (window as { studyVault?: unknown }).studyVault;
  delete (navigator as { clipboard?: unknown }).clipboard;
  vi.restoreAllMocks();
});

describe("SHELL-PRIM — file-link registers from core (not a plugin)", () => {
  it("registers BOTH halves at core seed: spec + client plugin, no owning pluginId, VISIBLE", () => {
    const plugin = getNoteType(FILE_LINK_CONTENT_TYPE);
    expect(plugin).toBeTruthy();
    expect(plugin!.pluginId, "core registrations carry no owning plugin").toBeUndefined();
    expect(plugin!.hidden, "the shell primitive is offered in composers").toBeFalsy();
    expect(getNoteContentSpec(FILE_LINK_CONTENT_TYPE)).toBeTruthy();
    expect(listNoteTypes().some((p) => p.contentType === FILE_LINK_CONTENT_TYPE)).toBe(true);
  });

  it("appears in the slash palette with the 链接文件 title and NO provider badge", () => {
    const entry = slashEntriesFromNoteTypes().find((e) => e.id === FILE_LINK_CONTENT_TYPE);
    expect(entry).toMatchObject({ kind: "noteType", title: "链接文件", kitId: undefined });
    expect(entry!.aliases).toEqual(expect.arrayContaining(["链接", "文件", "file", "link"]));
  });

  it('"/链接 …" and "/file" resolve to file-link first (alias lookup through the engine)', () => {
    const parsed = parseSlashInput("/链接 我的讲义")!;
    expect(parsed).toEqual({ query: "链接", instruction: "我的讲义" });
    expect(resolveSlashEntries(parsed.query, slashEntriesFromNoteTypes())[0]?.id).toBe(FILE_LINK_CONTENT_TYPE);
    expect(resolveSlashEntries("file", slashEntriesFromNoteTypes())[0]?.id).toBe(FILE_LINK_CONTENT_TYPE);
  });
});

describe("file-link render — ONE getNoteType().render path", () => {
  const plugin = () => getNoteType(FILE_LINK_CONTENT_TYPE)!;

  it("card shows the title + dimmed path + a one-line note gist + the action button", () => {
    const html = renderToHtml(
      plugin().render({
        content: { path: "C:\\docs\\physics.pdf", title: "物理讲义", note: "第三章重点\n第二行不进卡片" },
        mode: "card"
      })
    );
    expect(html).toContain("sv-file-link-card");
    expect(html).toContain("物理讲义");
    expect(html).toContain("C:\\docs\\physics.pdf");
    expect(html).toContain("sv-file-link-note-line");
    expect(html).toContain("第三章重点");
    expect(html).not.toContain("第二行不进卡片"); // card = one-line gist only
    expect(html).toContain("sv-file-link-open"); // 打开 present on the card too
  });

  it("falls back to the path BASENAME as the title (Windows and POSIX separators)", () => {
    expect(fileLinkBasename("C:\\a\\b\\paper.pdf")).toBe("paper.pdf");
    expect(fileLinkBasename("/home/me/notes.md")).toBe("notes.md");
    expect(fileLinkBasename("C:\\a\\dir\\")).toBe("dir");
    const html = renderToHtml(plugin().render({ content: { path: "/home/me/notes.md" }, mode: "card" }));
    expect(html).toContain("notes.md");
  });

  it("full mode shows the WHOLE note text", () => {
    const html = renderToHtml(
      plugin().render({ content: { path: "/x/y.md", note: "第一行\n第二行也显示" }, mode: "full" })
    );
    expect(html).not.toContain("sv-file-link-card");
    expect(html).toContain("第一行");
    expect(html).toContain("第二行也显示");
  });

  it("never throws on a foreign/mis-shaped content (the registry contract)", () => {
    expect(() => renderToHtml(plugin().render({ content: "garbage" }))).not.toThrow();
    expect(() => renderToHtml(plugin().render({ content: { path: 42 } }))).not.toThrow();
  });
});

describe("file-link 打开 action — desktop bridge vs web clipboard", () => {
  const plugin = () => getNoteType(FILE_LINK_CONTENT_TYPE)!;

  it("workspace: the 打开 button opens the file inside Growte when the host provides openLocalFile", async () => {
    const openLocalFile = vi.fn(async () => {});
    const { container, dispose } = mount(
      plugin().render({
        content: { path: "C:\\docs\\paper.pdf" },
        ctx: { openLocalFile }
      })
    );
    const button = container.querySelector<HTMLButtonElement>(".sv-file-link-open")!;
    expect(button.textContent).toBe("打开");
    expect(button.getAttribute("data-file-link-path")).toBe("C:\\docs\\paper.pdf");
    act(() => button.click());
    await flush();
    expect(openLocalFile).toHaveBeenCalledWith("C:\\docs\\paper.pdf");
    dispose();
  });

  it("desktop: the 打开 button dispatches the bridge's openPath with the note's path", async () => {
    const openPath = vi.fn().mockResolvedValue("");
    (window as { studyVault?: unknown }).studyVault = { desktop: true, platform: "win32", openPath };
    const { container, dispose } = mount(plugin().render({ content: { path: "C:\\docs\\paper.pdf" } }));
    const button = container.querySelector<HTMLButtonElement>(".sv-file-link-open")!;
    expect(button.textContent).toBe("打开");
    act(() => button.click());
    await flush();
    expect(openPath).toHaveBeenCalledWith("C:\\docs\\paper.pdf");
    // shell.openPath succeeded ("") → no error feedback shown.
    expect(container.querySelector(".sv-file-link-feedback")).toBeNull();
    dispose();
  });

  it("desktop: shell.openPath's error string surfaces as feedback", async () => {
    const openPath = vi.fn().mockResolvedValue("No application found");
    (window as { studyVault?: unknown }).studyVault = { desktop: true, platform: "win32", openPath };
    const { container, dispose } = mount(plugin().render({ content: { path: "C:\\gone.xyz" } }));
    act(() => container.querySelector<HTMLButtonElement>(".sv-file-link-open")!.click());
    await flush();
    expect(container.querySelector(".sv-file-link-feedback")!.textContent).toContain("No application found");
    dispose();
  });

  it("web (no bridge): the SAME button reads 复制路径 and copies the path to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { container, dispose } = mount(plugin().render({ content: { path: "/home/me/notes.md" } }));
    const button = container.querySelector<HTMLButtonElement>(".sv-file-link-open")!;
    expect(button.textContent).toBe("复制路径");
    act(() => button.click());
    await flush();
    expect(writeText).toHaveBeenCalledWith("/home/me/notes.md");
    expect(container.querySelector(".sv-file-link-feedback")!.textContent).toBe("已复制");
    dispose();
  });
});

describe("file-link declared form — the composer editor authors a valid draft", () => {
  // Drive the editor as a stateful parent (the renderEditor idiom from
  // noteTypeRegistry.test.tsx): every onChange feeds back as content.
  function renderEditor(content: unknown) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const plugin = getNoteType(FILE_LINK_CONTENT_TYPE)!;
    let current = content;
    const render = () => root.render(plugin.edit({ content: current, onChange }) as React.ReactElement);
    const onChange = (next: unknown) => {
      current = next;
      render();
    };
    act(() => render());
    return {
      container,
      value: () => current,
      dispose() {
        act(() => root.unmount());
        container.remove();
      }
    };
  }

  it("seeds from the core createDefault and collects path/title/note into a schema-valid draft", () => {
    const editor = renderEditor(spec(FILE_LINK_CONTENT_TYPE).createDefault());
    act(() => setValue(editor.container.querySelector<HTMLInputElement>(".file-link-path")!, "C:\\docs\\paper.pdf"));
    act(() => setValue(editor.container.querySelector<HTMLInputElement>(".file-link-title")!, "论文"));
    act(() => setValue(editor.container.querySelector<HTMLTextAreaElement>(".file-link-note")!, "周五读"));
    const draft = editor.value();
    expect(draft).toEqual({ path: "C:\\docs\\paper.pdf", title: "论文", note: "周五读" });
    expect(() => spec(FILE_LINK_CONTENT_TYPE).schema.parse(draft)).not.toThrow();
    editor.dispose();
  });

  it("web: the 选择文件… picker is disabled with the standard desktop hint", () => {
    const editor = renderEditor({ path: "" });
    expect(editor.container.querySelector<HTMLButtonElement>(".file-link-pick")!.disabled).toBe(true);
    expect(editor.container.textContent).toContain("desktop app");
    editor.dispose();
  });

  it("desktop: 选择文件… fills the path via the EXISTING dialog:openFile bridge", async () => {
    const openFile = vi.fn().mockResolvedValue("D:\\books\\algebra.pdf");
    (window as { studyVault?: unknown }).studyVault = { desktop: true, platform: "win32", openFile };
    const editor = renderEditor({ path: "" });
    const pick = editor.container.querySelector<HTMLButtonElement>(".file-link-pick")!;
    expect(pick.disabled).toBe(false);
    act(() => pick.click());
    await flush();
    expect(openFile).toHaveBeenCalled();
    expect(editor.value()).toMatchObject({ path: "D:\\books\\algebra.pdf" });
    editor.dispose();
  });
});
