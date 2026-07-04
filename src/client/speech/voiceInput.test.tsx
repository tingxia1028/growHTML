// @vitest-environment jsdom
// SPEECH-2 client tests: the useVoiceInput hook (mocked MediaRecorder + getUserMedia +
// fetch — record → stop → transcript; cancel discards; unavailable disables) and the
// VoiceInputButton confirm UX (the transcript popover inserts ONLY on 确认插入; 取消
// discards; unavailable click opens the setup guide instead of recording). Plus the
// shared status cache: one /api/speech/status fetch serves useSpeakText AND
// useVoiceInput together.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import type { ReactElement, ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { VoiceInputButton } from "./VoiceInputButton";
import { useVoiceInput } from "./useVoiceInput";
import { useSpeakText } from "./useSpeakText";
import { resetSpeechStatusCacheForTests } from "./speechStatus";

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

/** Let the getUserMedia/fetch promise chains settle inside act. */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// Mocked MediaRecorder — start/stop drive ondataavailable/onstop synchronously.
class MockMediaRecorder {
  static instances: MockMediaRecorder[] = [];
  static isTypeSupported = vi.fn((type: string) => type === "audio/webm;codecs=opus");
  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_stream: unknown, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? "";
    MockMediaRecorder.instances.push(this);
  }
  start = vi.fn(() => {
    this.state = "recording";
  });
  stop = vi.fn(() => {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/webm" }) });
    this.onstop?.();
  });
}

let mockTracks: { stop: ReturnType<typeof vi.fn> }[] = [];
let getUserMedia: ReturnType<typeof vi.fn>;

type FetchCall = { url: string; body?: unknown };

function stubFetch({
  sttAvailable = true,
  sttText = "你好世界",
  sttOk = true,
  setupHint = "本地语音识别引擎未运行，见 scripts/stt-sidecar/README.md"
}: { sttAvailable?: boolean; sttText?: string; sttOk?: boolean; setupHint?: string } = {}): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body });
      if (url === "/api/speech/status") {
        return new Response(
          JSON.stringify({
            tts: { available: true, lane: "edge", defaultVoice: "zh-CN-XiaoxiaoNeural", voices: [] },
            stt: sttAvailable
              ? { available: true, lane: "local", model: "large-v3" }
              : { available: false, lane: "local", setupHint }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.startsWith("/api/speech/stt")) {
        if (!sttOk) {
          return new Response(JSON.stringify({ error: "语音识别暂时不可用", code: "stt_unavailable" }), {
            status: 502,
            headers: { "content-type": "application/json" }
          });
        }
        return new Response(JSON.stringify({ text: sttText, language: "zh", durationMs: 900 }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    })
  );
  return calls;
}

beforeEach(() => {
  document.body.innerHTML = "";
  MockMediaRecorder.instances = [];
  MockMediaRecorder.isTypeSupported.mockClear();
  resetSpeechStatusCacheForTests();
  vi.stubGlobal("MediaRecorder", MockMediaRecorder);
  mockTracks = [{ stop: vi.fn() }];
  getUserMedia = vi.fn(async () => ({ getTracks: () => mockTracks }));
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia },
    configurable: true
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (navigator as { mediaDevices?: unknown }).mediaDevices;
});

// Probe component exposing the hook's state machine to the DOM.
function VoiceProbe() {
  const voice = useVoiceInput();
  return (
    <div>
      <button data-testid="start" onClick={() => void voice.start()} />
      <button data-testid="stop" onClick={voice.stop} />
      <button data-testid="cancel" onClick={voice.cancel} />
      <output data-testid="vstate">
        {`${voice.available ? "on" : "off"}:${voice.state}:${voice.transcript ?? "-"}:${voice.error ?? "-"}`}
      </output>
    </div>
  );
}

const byId = (container: HTMLElement, id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement;
const vstate = (container: HTMLElement) => byId(container, "vstate").textContent;

describe("useVoiceInput", () => {
  it("record → stop → transcribing → transcript (posted to /api/speech/stt with the zh default)", async () => {
    const calls = stubFetch();
    const { container, cleanup } = mount(<VoiceProbe />);
    await flush();
    expect(vstate(container)).toBe("on:idle:-:-");

    act(() => byId(container, "start").click());
    await flush();
    expect(vstate(container)).toBe("on:recording:-:-");
    expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({ audio: true });
    expect(MockMediaRecorder.instances).toHaveLength(1);
    expect(MockMediaRecorder.instances[0].mimeType).toBe("audio/webm;codecs=opus");

    act(() => byId(container, "stop").click());
    await flush();
    expect(vstate(container)).toBe("on:idle:你好世界:-");

    const sttCall = calls.find((call) => call.url.startsWith("/api/speech/stt"));
    expect(sttCall).toBeTruthy();
    expect(sttCall!.url).toBe("/api/speech/stt?language=zh");
    expect((sttCall!.body as Blob).size).toBeGreaterThan(0);
    // The mic is released once the segment is captured.
    expect(mockTracks[0].stop).toHaveBeenCalled();
    cleanup();
  });

  it("cancel during recording discards the segment — no transcription request", async () => {
    const calls = stubFetch();
    const { container, cleanup } = mount(<VoiceProbe />);
    await flush();

    act(() => byId(container, "start").click());
    await flush();
    expect(vstate(container)).toBe("on:recording:-:-");

    act(() => byId(container, "cancel").click());
    await flush();
    expect(vstate(container)).toBe("on:idle:-:-");
    expect(calls.some((call) => call.url.startsWith("/api/speech/stt"))).toBe(false);
    expect(mockTracks[0].stop).toHaveBeenCalled();
    cleanup();
  });

  it("a 502 from the stt route lands on error (not transcript)", async () => {
    stubFetch({ sttOk: false });
    const { container, cleanup } = mount(<VoiceProbe />);
    await flush();

    act(() => byId(container, "start").click());
    await flush();
    act(() => byId(container, "stop").click());
    await flush();

    expect(vstate(container)).toBe("on:idle:-:语音识别暂时不可用");
    cleanup();
  });

  it("stays unavailable (start is a no-op) when the status probe says the sidecar is down", async () => {
    stubFetch({ sttAvailable: false });
    const { container, cleanup } = mount(<VoiceProbe />);
    await flush();
    expect(vstate(container)).toBe("off:idle:-:-");

    act(() => byId(container, "start").click());
    await flush();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(vstate(container)).toBe("off:idle:-:-");
    cleanup();
  });
});

describe("VoiceInputButton — transcript confirm UX", () => {
  async function recordOnce(container: HTMLElement) {
    const button = container.querySelector(".voice-input-btn") as HTMLButtonElement;
    act(() => button.click()); // start
    await flush();
    act(() => button.click()); // stop → transcribe
    await flush();
    return button;
  }

  it("shows the transcript in a confirm popover and inserts ONLY on 确认插入", async () => {
    stubFetch({ sttText: "今天天气很好。" });
    const onInsert = vi.fn();
    const { container, cleanup } = mount(<VoiceInputButton onInsert={onInsert} />);
    await flush();

    await recordOnce(container);
    const popover = container.querySelector(".voice-input-confirm") as HTMLElement;
    expect(popover).toBeTruthy();
    expect(popover.querySelector(".voice-input-transcript")!.textContent).toBe("今天天气很好。");
    expect(onInsert).not.toHaveBeenCalled(); // nothing inserted before the confirm

    const confirm = Array.from(popover.querySelectorAll("button")).find((b) => b.textContent === "确认插入")!;
    act(() => confirm.click());
    expect(onInsert).toHaveBeenCalledExactlyOnceWith("今天天气很好。");
    expect(container.querySelector(".voice-input-confirm")).toBeNull();
    cleanup();
  });

  it("取消 discards the transcript without inserting", async () => {
    stubFetch();
    const onInsert = vi.fn();
    const { container, cleanup } = mount(<VoiceInputButton onInsert={onInsert} />);
    await flush();

    await recordOnce(container);
    const popover = container.querySelector(".voice-input-confirm") as HTMLElement;
    const cancel = Array.from(popover.querySelectorAll("button")).find((b) => b.textContent === "取消")!;
    act(() => cancel.click());

    expect(onInsert).not.toHaveBeenCalled();
    expect(container.querySelector(".voice-input-confirm")).toBeNull();
    cleanup();
  });

  it("重录 drops the transcript and starts a fresh recording", async () => {
    stubFetch();
    const onInsert = vi.fn();
    const { container, cleanup } = mount(<VoiceInputButton onInsert={onInsert} />);
    await flush();

    await recordOnce(container);
    const popover = container.querySelector(".voice-input-confirm") as HTMLElement;
    const retry = Array.from(popover.querySelectorAll("button")).find((b) => b.textContent === "重录")!;
    act(() => retry.click());
    await flush();

    expect(container.querySelector(".voice-input-confirm")).toBeNull();
    expect(MockMediaRecorder.instances).toHaveLength(2); // a second recording session
    expect(onInsert).not.toHaveBeenCalled();
    cleanup();
  });

  it("when the sidecar is down the mic opens the setup guide instead of recording", async () => {
    stubFetch({ sttAvailable: false });
    const onInsert = vi.fn();
    const { container, cleanup } = mount(<VoiceInputButton onInsert={onInsert} />);
    await flush();

    const button = container.querySelector(".voice-input-btn") as HTMLButtonElement;
    expect(button.hasAttribute("data-unavailable")).toBe(true);
    act(() => button.click());

    const guide = container.querySelector(".voice-input-guide") as HTMLElement;
    expect(guide).toBeTruthy();
    expect(guide.textContent).toContain("scripts/stt-sidecar/README.md");
    expect(guide.textContent).toContain("本地语音识别引擎未运行");
    expect(getUserMedia).not.toHaveBeenCalled();
    cleanup();
  });
});

describe("shared speech status cache", () => {
  function BothHooks() {
    const speak = useSpeakText();
    const voice = useVoiceInput();
    return <output data-testid="both">{`${speak.available}:${voice.available}`}</output>;
  }

  it("one /api/speech/status fetch serves useSpeakText AND useVoiceInput", async () => {
    const calls = stubFetch();
    const { container, cleanup } = mount(<BothHooks />);
    await flush();

    expect(byId(container, "both").textContent).toBe("true:true");
    expect(calls.filter((call) => call.url === "/api/speech/status")).toHaveLength(1);
    cleanup();
  });
});
