// @vitest-environment jsdom
// SPEECH-1b 朗读通用化 tests — the user's law: 读是所有文本的可读能力, not an anchor
// capability. Covers the three universal mounts:
//   • GlobalSpeakSelection — a host-document text selection floats the 朗读 chip
//     (speaks selection.toString(), flips to 停止, Escape dismisses, scroll hides);
//     selections inside the source-viewer pane (`.reader-panel`) are EXCLUDED (the
//     reader's own floating toolbar already serves them); unavailable status hides.
//   • ChatMessageBody — every ASSISTANT bubble carries the 朗读 control wired to the
//     reply text; user bubbles never do.
//   • FocusOverlay (the unified note shell) — ONE header 朗读 affordance reading the
//     note through its type's own toSearchText (the toSpokenText V1 default).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import type { ReactElement, ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GlobalSpeakSelection } from "./GlobalSpeakSelection";
import { resetSpeechStatusCacheForTests } from "./useSpeakText";
import { ChatMessageBody } from "../workspace/ChatMessageBody";
import { FocusOverlay } from "../workspace/FocusOverlay";
// Registers the built-in client note types so the overlay body renders realistically.
import "../notes/builtinNoteTypes";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// —— harness (the speech.test.tsx idioms) ——————————————————————————————————————

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

// jsdom's Range has no layout (no getBoundingClientRect at all) — install one for the
// whole file so the chip positions from a real-looking selection rect.
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

const chip = () => document.querySelector(".global-speak-chip") as HTMLButtonElement | null;

beforeEach(() => {
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
  MockAudio.instances = [];
  resetSpeechStatusCacheForTests();
  vi.stubGlobal("Audio", MockAudio);
  // jsdom has no blob URL support — stub the pair the hook uses.
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

describe("GlobalSpeakSelection — the host-level 朗读 chip", () => {
  it("floats over a host text selection, speaks selection.toString(), and flips to 停止", async () => {
    const calls = stubFetch();
    const host = document.createElement("p");
    host.textContent = "今天我们学习光合作用。";
    document.body.appendChild(host);
    const { cleanup } = mount(<GlobalSpeakSelection />);
    await flush();
    expect(chip()).toBeNull(); // nothing selected yet

    selectInside(host);
    const button = chip();
    expect(button).toBeTruthy();
    expect(button!.getAttribute("aria-label")).toBe("朗读");

    act(() => button!.click());
    await flush();
    expect(ttsBody(calls)?.text).toBe("今天我们学习光合作用。");
    expect(MockAudio.instances).toHaveLength(1);
    expect(MockAudio.instances[0].play).toHaveBeenCalledOnce();
    expect(chip()!.getAttribute("aria-label")).toBe("停止");
    expect(chip()!.hasAttribute("data-speaking")).toBe(true);

    // Playback ends → the chip returns to 朗读 (the selection is still live).
    act(() => MockAudio.instances[0].onended?.());
    expect(chip()).toBeTruthy();
    expect(chip()!.getAttribute("aria-label")).toBe("朗读");
    cleanup();
  });

  it("stays hidden for selections inside the source-viewer pane (.reader-panel)", async () => {
    stubFetch();
    const pane = document.createElement("div");
    pane.className = "reader-panel";
    const passage = document.createElement("p");
    passage.textContent = "pdf.js text layer passage";
    pane.appendChild(passage);
    document.body.appendChild(pane);
    const { cleanup } = mount(<GlobalSpeakSelection />);
    await flush();

    selectInside(passage);
    expect(chip()).toBeNull(); // the reader's own toolbar serves this selection
    cleanup();
  });

  it("keeps the 停止 affordance alive while speaking even after the selection clears", async () => {
    stubFetch();
    const host = document.createElement("p");
    host.textContent = "被朗读的句子";
    document.body.appendChild(host);
    const { cleanup } = mount(<GlobalSpeakSelection />);
    await flush();

    selectInside(host);
    act(() => chip()!.click());
    await flush();
    expect(chip()!.getAttribute("aria-label")).toBe("停止");

    clearSelection();
    expect(chip()).toBeTruthy(); // still speaking → the stop control must stay reachable

    act(() => MockAudio.instances[0].onended?.());
    expect(chip()).toBeNull(); // playback over + no selection → gone
    cleanup();
  });

  it("Escape stops the utterance and dismisses the chip", async () => {
    stubFetch();
    const host = document.createElement("p");
    host.textContent = "按下 Escape 应该停止";
    document.body.appendChild(host);
    const { cleanup } = mount(<GlobalSpeakSelection />);
    await flush();

    selectInside(host);
    act(() => chip()!.click());
    await flush();
    expect(chip()!.hasAttribute("data-speaking")).toBe(true);

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(chip()).toBeNull();
    expect(MockAudio.instances[0].pause).toHaveBeenCalled();
    cleanup();
  });

  it("renders nothing at all when the speech status is unavailable", async () => {
    stubFetch({ available: false });
    const host = document.createElement("p");
    host.textContent = "服务不可用时不该出现";
    document.body.appendChild(host);
    const { cleanup } = mount(<GlobalSpeakSelection />);
    await flush();

    selectInside(host);
    expect(chip()).toBeNull();
    cleanup();
  });

  it("a scroll hides an idle chip (its rect is stale)", async () => {
    stubFetch();
    const host = document.createElement("p");
    host.textContent = "滚动后隐藏";
    document.body.appendChild(host);
    const { cleanup } = mount(<GlobalSpeakSelection />);
    await flush();

    selectInside(host);
    expect(chip()).toBeTruthy();
    act(() => {
      document.dispatchEvent(new Event("scroll"));
    });
    expect(chip()).toBeNull();
    cleanup();
  });
});

describe("chat bubbles — AI 回答可读 (SPEECH-1b)", () => {
  it("an assistant bubble carries the 朗读 control wired to the reply's text", async () => {
    const calls = stubFetch();
    const reply = "光合作用把光能转化为化学能。";
    const { container, cleanup } = mount(<ChatMessageBody role="assistant" content={reply} />);
    await flush();

    const button = container.querySelector(".chat-artifact-actions .speak-btn") as HTMLButtonElement;
    expect(button).toBeTruthy();
    expect(button.disabled).toBe(false);

    act(() => button.click());
    await flush();
    expect(ttsBody(calls)?.text).toBe(reply);
    cleanup();
  });

  it("a user bubble has no 朗读 control", async () => {
    stubFetch();
    const { container, cleanup } = mount(<ChatMessageBody role="user" content={"我的提问"} />);
    await flush();
    expect(container.querySelector(".speak-btn")).toBeNull();
    cleanup();
  });
});

describe("note unified shell — the Center View header 朗读 (SPEECH-1b)", () => {
  it("shows ONE speaker affordance in the shell header, reading via the type's toSearchText", async () => {
    const calls = stubFetch();
    const content = { language: "python", code: "print('你好')" };
    const { cleanup } = mount(
      <FocusOverlay block={{ contentType: "code-snippet", content }} onClose={() => {}} />
    );
    await flush();

    const buttons = document.querySelectorAll(".sv-center-actions .speak-btn");
    expect(buttons).toHaveLength(1); // one shell affordance, never per note type
    const button = buttons[0] as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    act(() => button.click());
    await flush();
    // toSearchText for code-snippet = the code itself — NOT a JSON stringify.
    expect(ttsBody(calls)?.text).toBe("print('你好')");
    cleanup();
  });

  it("an unknown contentType (no spec) leaves the header control disabled, never crashing", async () => {
    stubFetch();
    const { cleanup } = mount(
      <FocusOverlay block={{ contentType: "not-a-real-type", content: "x" }} onClose={() => {}} />
    );
    await flush();
    const button = document.querySelector(".sv-center-actions .speak-btn") as HTMLButtonElement;
    expect(button).toBeTruthy();
    expect(button.disabled).toBe(true);
    cleanup();
  });
});
