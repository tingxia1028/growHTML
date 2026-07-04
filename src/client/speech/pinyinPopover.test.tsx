// @vitest-environment jsdom
// SPEECH-3 注音 surface tests — the same universality pattern as 朗读 (SPEECH-1b):
// 注音 is a capability of selected TEXT, offered on the SAME two surfaces.
//   • PinyinPopover — per-CJK-char `<ruby>字<rt>zì</rt></ruby>` runs (context-resolved
//     多音字), plain runs for latin, header 朗读 wired to the shared TTS lane, Escape /
//     backdrop / ✕ dismiss, ~200-char cap with an honest note.
//   • GlobalSpeakSelection — a CJK selection shows the 拼 button beside 朗读 (opens the
//     popover, which OUTLIVES the selection); a latin selection shows 朗读 only.
//   • SelectionToolbar (the reader floating-toolbar renderer) — same gate, same button,
//     opens through the host's onPinyin.
// Harness idioms copied from globalSpeakSelection.test.tsx / speech.test.tsx.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import type { ReactElement, ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PinyinPopover, PINYIN_POPOVER_MAX_CHARS } from "./PinyinPopover";
import { GlobalSpeakSelection } from "./GlobalSpeakSelection";
import { resetSpeechStatusCacheForTests } from "./useSpeakText";
import { SelectionToolbar } from "../workspace/SelectionToolbar";
import type { ToolbarAction } from "../workspace/WorkspaceContext";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// —— harness (the globalSpeakSelection.test.tsx idioms) ————————————————————————

function mount(node: ReactNode): { container: HTMLElement; root: Root; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node as ReactElement));
  return {
    container,
    root,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    }
  };
}

/** Let the fetch→blob→play promise chain settle inside act. */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// Mocked HTMLAudioElement — records play/pause; tests fire onended manually.
class MockAudio {
  static instances: MockAudio[] = [];
  src: string;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn(async () => {});
  pause = vi.fn();
  constructor(src: string) {
    this.src = src;
    MockAudio.instances.push(this);
  }
}

type FetchCall = { url: string; body?: unknown };

function stubFetch({ available = true }: { available?: boolean } = {}): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
      if (url === "/api/speech/status") {
        return new Response(
          JSON.stringify({
            tts: { available, lane: "edge", defaultVoice: "zh-CN-XiaoxiaoNeural", voices: [] }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url === "/api/speech/tts") {
        return new Response(new Uint8Array([0xff, 0xf3, 1, 2]), {
          status: 200,
          headers: { "content-type": "audio/mpeg" }
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    })
  );
  return calls;
}

const ttsBody = (calls: FetchCall[]) =>
  calls.find((call) => call.url === "/api/speech/tts")?.body as { text?: string } | undefined;

// jsdom's Range has no layout — install a rect so the chip positions like in the app.
const FAKE_RECT = {
  top: 40,
  left: 10,
  right: 130,
  bottom: 58,
  width: 120,
  height: 18,
  x: 10,
  y: 40,
  toJSON: () => ({})
} as DOMRect;
(Range.prototype as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () => FAKE_RECT;

/** Select all text inside `el` on the HOST document and fire selectionchange. */
function selectInside(el: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  act(() => {
    document.dispatchEvent(new Event("selectionchange"));
  });
}

function clearSelection() {
  window.getSelection()?.removeAllRanges();
  act(() => {
    document.dispatchEvent(new Event("selectionchange"));
  });
}

const popover = () => document.querySelector(".pinyin-popover") as HTMLElement | null;
const pinyinBtn = () => document.querySelector(".pinyin-btn") as HTMLButtonElement | null;
const speakChip = () => document.querySelector(".global-speak-chip") as HTMLButtonElement | null;

beforeEach(() => {
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
  MockAudio.instances = [];
  resetSpeechStatusCacheForTests();
  vi.stubGlobal("Audio", MockAudio);
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(
    () => `blob:mock-${MockAudio.instances.length}`
  );
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
  delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
});

describe("PinyinPopover — ruby rendering", () => {
  it("renders one <ruby>字<rt>zì</rt></ruby> per CJK char with context-resolved 多音字", async () => {
    stubFetch();
    const { cleanup } = mount(<PinyinPopover text="他长大了 well done，长度" onClose={vi.fn()} />);
    await flush();

    const rubies = Array.from(popover()!.querySelectorAll("ruby"));
    expect(rubies).toHaveLength(6); // 他 长 大 了 长 度 — latin/punct never get ruby
    const pairs = rubies.map((ruby) => [ruby.childNodes[0]!.textContent, ruby.querySelector("rt")!.textContent]);
    expect(pairs).toEqual([
      ["他", "tā"],
      ["长", "zhǎng"], // 长大 → zhǎng …
      ["大", "dà"],
      ["了", "le"],
      ["长", "cháng"], // … 长度 → cháng, in the SAME text (word-level context)
      ["度", "dù"]
    ]);
    cleanup();
  });

  it("merges consecutive non-CJK chars into one plain run (no ruby)", async () => {
    stubFetch();
    const { cleanup } = mount(<PinyinPopover text="他长大了 well done，长度" onClose={vi.fn()} />);
    await flush();

    const plains = Array.from(popover()!.querySelectorAll(".pinyin-popover-plain"));
    expect(plains.map((el) => el.textContent)).toEqual([" well done，"]);
    expect(plains[0]!.querySelector("ruby")).toBeNull();
    cleanup();
  });

  it("wires the header 朗读 button to the shared TTS lane with the shown text", async () => {
    const calls = stubFetch();
    const { cleanup } = mount(<PinyinPopover text="今天我们学习光合作用" onClose={vi.fn()} />);
    await flush();

    const speak = popover()!.querySelector(".speak-btn") as HTMLButtonElement;
    expect(speak).toBeTruthy();
    expect(speak.disabled).toBe(false);
    act(() => speak.click());
    await flush();
    expect(ttsBody(calls)?.text).toBe("今天我们学习光合作用");
    expect(MockAudio.instances).toHaveLength(1);
    expect(MockAudio.instances[0].play).toHaveBeenCalledOnce();
    cleanup();
  });

  it("Escape, the ✕ button, and a backdrop click all dismiss", async () => {
    stubFetch();
    const onClose = vi.fn();
    const { cleanup } = mount(<PinyinPopover text="按键关闭" onClose={onClose} />);
    await flush();

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => (document.querySelector(".pinyin-popover-close") as HTMLButtonElement).click());
    expect(onClose).toHaveBeenCalledTimes(2);

    act(() => (document.querySelector(".pinyin-popover-backdrop") as HTMLElement).click());
    expect(onClose).toHaveBeenCalledTimes(3);

    // A click INSIDE the dialog must NOT dismiss (stopPropagation).
    act(() => popover()!.click());
    expect(onClose).toHaveBeenCalledTimes(3);
    cleanup();
  });

  it("caps the annotated text at the char limit, notes the truncation, and 朗读 reads the capped text", async () => {
    const calls = stubFetch();
    const long = "字".repeat(PINYIN_POPOVER_MAX_CHARS + 50);
    const { cleanup } = mount(<PinyinPopover text={long} onClose={vi.fn()} />);
    await flush();

    expect(popover()!.querySelectorAll("ruby")).toHaveLength(PINYIN_POPOVER_MAX_CHARS);
    const note = document.querySelector(".pinyin-popover-truncated");
    expect(note?.textContent).toContain(String(PINYIN_POPOVER_MAX_CHARS));

    act(() => (popover()!.querySelector(".speak-btn") as HTMLButtonElement).click());
    await flush();
    expect(ttsBody(calls)?.text).toBe("字".repeat(PINYIN_POPOVER_MAX_CHARS));
    cleanup();
  });

  it("shows no truncation note at or below the limit", async () => {
    stubFetch();
    const { cleanup } = mount(<PinyinPopover text={"字".repeat(PINYIN_POPOVER_MAX_CHARS)} onClose={vi.fn()} />);
    await flush();
    expect(document.querySelector(".pinyin-popover-truncated")).toBeNull();
    cleanup();
  });
});

describe("GlobalSpeakSelection — the 注音 chip gate (SPEECH-3 on the SPEECH-1b surface)", () => {
  it("a CJK selection shows 拼 beside 朗读; clicking it opens the popover, which outlives the selection", async () => {
    stubFetch();
    const host = document.createElement("p");
    host.textContent = "我们一起长大";
    document.body.appendChild(host);
    const { cleanup } = mount(<GlobalSpeakSelection />);
    await flush();

    selectInside(host);
    expect(speakChip()).toBeTruthy(); // 朗读 still first-class
    const button = pinyinBtn();
    expect(button).toBeTruthy();
    expect(button!.getAttribute("aria-label")).toBe("注音");

    act(() => button!.click());
    expect(popover()).toBeTruthy();
    // The selected text, annotated: 长大 in context → zhǎng.
    const rts = Array.from(popover()!.querySelectorAll("rt")).map((rt) => rt.textContent);
    expect(rts).toEqual(["wǒ", "men", "yì", "qǐ", "zhǎng", "dà"]);

    // Opening/using the popover collapses the selection → the chip goes, the popover stays.
    clearSelection();
    expect(speakChip()).toBeNull();
    expect(popover()).toBeTruthy();

    // Escape dismisses the popover.
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(popover()).toBeNull();
    cleanup();
  });

  it("a pure-latin selection shows 朗读 only — no 拼 button", async () => {
    stubFetch();
    const host = document.createElement("p");
    host.textContent = "plain english selection";
    document.body.appendChild(host);
    const { cleanup } = mount(<GlobalSpeakSelection />);
    await flush();

    selectInside(host);
    expect(speakChip()).toBeTruthy();
    expect(pinyinBtn()).toBeNull();
    cleanup();
  });
});

describe("SelectionToolbar — the 注音 slot (the reader floating-toolbar surface)", () => {
  const action: ToolbarAction = {
    id: "bookmark.add",
    title: "Bookmark",
    icon: "bookmark",
    group: "Create Note",
    kind: "builtin",
    scope: "anchor"
  };

  it("shows the 拼 button for a CJK passage and opens through the host's onPinyin", async () => {
    stubFetch();
    const onPinyin = vi.fn();
    const { container, cleanup } = mount(
      <SelectionToolbar visible items={[action]} onRun={vi.fn()} speakText="课文选段" onPinyin={onPinyin} />
    );
    await flush();

    const button = container.querySelector(".pinyin-btn") as HTMLButtonElement;
    expect(button).toBeTruthy();
    act(() => button.click());
    expect(onPinyin).toHaveBeenCalledWith("课文选段");
    cleanup();
  });

  it("hides 注音 for a latin-only passage (朗读 stays)", async () => {
    stubFetch();
    const { container, cleanup } = mount(
      <SelectionToolbar visible items={[action]} onRun={vi.fn()} speakText="english passage" onPinyin={vi.fn()} />
    );
    await flush();

    expect(container.querySelector(".speak-btn")).toBeTruthy();
    expect(container.querySelector(".pinyin-btn")).toBeNull();
    cleanup();
  });

  it("renders no 注音 affordance when the host does not opt in (no onPinyin)", async () => {
    stubFetch();
    const { container, cleanup } = mount(
      <SelectionToolbar visible items={[action]} onRun={vi.fn()} speakText="中文选段" />
    );
    await flush();
    expect(container.querySelector(".pinyin-btn")).toBeNull();
    cleanup();
  });
});
