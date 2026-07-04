// @vitest-environment jsdom
// SPEECH-1 client tests: the useSpeakText hook (mocked fetch + Audio — speak →
// speaking → stop; a second speak stops the first) and the SpeakButton /
// SelectionToolbar 朗读 surface (renders, disabled when the status probe says
// unavailable, flips to 停止 while speaking).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import type { ReactElement, ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SpeakButton } from "./SpeakButton";
import { useSpeakText, resetSpeechStatusCacheForTests } from "./useSpeakText";
import { SelectionToolbar } from "../workspace/SelectionToolbar";
import type { ToolbarAction } from "../workspace/WorkspaceContext";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// —— harness ————————————————————————————————————————————————————————————————

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

function stubFetch({ available = true, ttsOk = true }: { available?: boolean; ttsOk?: boolean } = {}): FetchCall[] {
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
        if (!ttsOk) {
          return new Response(JSON.stringify({ error: "朗读服务暂时不可用", code: "tts_unavailable" }), {
            status: 502,
            headers: { "content-type": "application/json" }
          });
        }
        // Plain bytes (undici's Response won't take a jsdom Blob as its body).
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

beforeEach(() => {
  document.body.innerHTML = "";
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

// Probe component exposing the hook's state to the DOM.
function Probe() {
  const { speak, stop, speaking, available } = useSpeakText();
  return (
    <div>
      <button data-testid="speak-a" onClick={() => void speak("第一段话")} />
      <button data-testid="speak-b" onClick={() => void speak("第二段话")} />
      <button data-testid="stop" onClick={stop} />
      <output data-testid="state">{`${available ? "available" : "unavailable"}:${speaking ? "speaking" : "idle"}`}</output>
    </div>
  );
}

const byId = (container: HTMLElement, id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement;
const state = (container: HTMLElement) => byId(container, "state").textContent;

describe("useSpeakText", () => {
  it("speak() POSTs the text, plays the blob, and speaking tracks playback until ended", async () => {
    const calls = stubFetch();
    const { container, cleanup } = mount(<Probe />);
    await flush();
    expect(state(container)).toBe("available:idle");

    act(() => byId(container, "speak-a").click());
    await flush();

    expect(state(container)).toBe("available:speaking");
    expect(calls.some((call) => call.url === "/api/speech/tts")).toBe(true);
    expect(calls.find((call) => call.url === "/api/speech/tts")?.body).toEqual({ text: "第一段话" });
    expect(MockAudio.instances).toHaveLength(1);
    expect(MockAudio.instances[0].play).toHaveBeenCalledOnce();

    // Playback finishing flips speaking back off and releases the blob URL.
    act(() => MockAudio.instances[0].onended?.());
    expect(state(container)).toBe("available:idle");
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
    cleanup();
  });

  it("a second speak() stops the first utterance (one at a time)", async () => {
    stubFetch();
    const { container, cleanup } = mount(<Probe />);
    await flush();

    act(() => byId(container, "speak-a").click());
    await flush();
    expect(MockAudio.instances).toHaveLength(1);

    act(() => byId(container, "speak-b").click());
    await flush();

    expect(MockAudio.instances[0].pause).toHaveBeenCalled();
    expect(MockAudio.instances).toHaveLength(2);
    expect(MockAudio.instances[1].play).toHaveBeenCalledOnce();
    expect(state(container)).toBe("available:speaking");
    cleanup();
  });

  it("stop() pauses playback and clears speaking", async () => {
    stubFetch();
    const { container, cleanup } = mount(<Probe />);
    await flush();

    act(() => byId(container, "speak-a").click());
    await flush();
    expect(state(container)).toBe("available:speaking");

    act(() => byId(container, "stop").click());
    expect(MockAudio.instances[0].pause).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
    expect(state(container)).toBe("available:idle");
    cleanup();
  });

  it("a server failure (502) clears speaking instead of playing anything", async () => {
    stubFetch({ ttsOk: false });
    const { container, cleanup } = mount(<Probe />);
    await flush();

    act(() => byId(container, "speak-a").click());
    await flush();

    expect(state(container)).toBe("available:idle");
    expect(MockAudio.instances).toHaveLength(0);
    cleanup();
  });

  it("reports unavailable when the status probe says the lane is off", async () => {
    stubFetch({ available: false });
    const { container, cleanup } = mount(<Probe />);
    await flush();
    expect(state(container)).toBe("unavailable:idle");
    cleanup();
  });
});

describe("SpeakButton", () => {
  it("renders enabled with text once the status probe resolves available, and flips 朗读 ↔ 停止", async () => {
    stubFetch();
    const { container, cleanup } = mount(<SpeakButton text="你好，世界" />);
    const button = container.querySelector(".speak-btn") as HTMLButtonElement;
    expect(button).toBeTruthy();
    expect(button.disabled).toBe(true); // until the probe resolves
    await flush();
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-label")).toBe("朗读");

    act(() => button.click());
    await flush();
    expect(button.getAttribute("aria-label")).toBe("停止");
    expect(button.hasAttribute("data-speaking")).toBe(true);

    act(() => button.click()); // 停止
    expect(button.getAttribute("aria-label")).toBe("朗读");
    expect(MockAudio.instances[0].pause).toHaveBeenCalled();
    cleanup();
  });

  it("stays disabled when the speech status is unavailable", async () => {
    stubFetch({ available: false });
    const { container, cleanup } = mount(<SpeakButton text="你好" />);
    await flush();
    const button = container.querySelector(".speak-btn") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toContain("朗读不可用");
    cleanup();
  });

  it("stays disabled without text to read", async () => {
    stubFetch();
    const { container, cleanup } = mount(<SpeakButton text="   " />);
    await flush();
    expect((container.querySelector(".speak-btn") as HTMLButtonElement).disabled).toBe(true);
    cleanup();
  });
});

describe("SelectionToolbar 朗读 slot", () => {
  const action: ToolbarAction = {
    id: "bookmark.add",
    title: "Bookmark",
    icon: "bookmark",
    group: "Create Note",
    kind: "builtin",
    scope: "anchor"
  };

  it("renders the SpeakButton when the host passes speakText", async () => {
    stubFetch();
    const { container, cleanup } = mount(
      <SelectionToolbar visible items={[action]} onRun={vi.fn()} speakText="选中的段落" />
    );
    await flush();
    const button = container.querySelector(".speak-btn") as HTMLButtonElement;
    expect(button).toBeTruthy();
    expect(button.disabled).toBe(false);
    cleanup();
  });

  it("omits the SpeakButton entirely when the host does not opt in", async () => {
    stubFetch();
    const { container, cleanup } = mount(<SelectionToolbar visible items={[action]} onRun={vi.fn()} />);
    await flush();
    expect(container.querySelector(".speak-btn")).toBeNull();
    cleanup();
  });

  it("keeps the 朗读 button disabled when the lane is unavailable", async () => {
    stubFetch({ available: false });
    const { container, cleanup } = mount(
      <SelectionToolbar visible items={[action]} onRun={vi.fn()} speakText="选中的段落" />
    );
    await flush();
    expect((container.querySelector(".speak-btn") as HTMLButtonElement).disabled).toBe(true);
    cleanup();
  });
});
