// VoiceInputButton (SPEECH-2) — the 语音输入 mic for a text field. Click to record,
// click again to stop; the transcript then shows in a CONFIRM popover (确认插入 /
// 重录 / 取消) BEFORE anything reaches the host input — the preview-gate principle:
// kids' recognition errors must never silently enter notes. When the local engine
// isn't running the mic stays clickable and opens the one-click setup guide (the
// sidecar README's three steps rendered as a small panel — not a settings surface).
//
// Pure trigger, UI-only state: the host passes `onInsert` and owns its input value.

import { Loader2, Mic, MicOff } from "lucide-react";
import { useState } from "react";
import { useVoiceInput } from "./useVoiceInput";
import "./voiceInput.css";

export type VoiceInputButtonProps = {
  /** Receives the CONFIRMED transcript (the host appends it to its input state). */
  onInsert(text: string): void;
  /** Optional extra class so host rows can size/align it. */
  className?: string;
  /** Icon size (defaults to the action-row 16px). */
  size?: number;
  /** Recognition language hint for the local engine (default zh). */
  language?: string;
};

export function VoiceInputButton({ onInsert, className, size = 16, language }: VoiceInputButtonProps) {
  const { start, stop, cancel, state, transcript, clearTranscript, error, available, setupHint } =
    useVoiceInput({ language });
  const [showGuide, setShowGuide] = useState(false);

  const recording = state === "recording";
  const transcribing = state === "transcribing";
  const label = !available ? "语音输入未就绪" : recording ? "停止录音" : transcribing ? "识别中" : "语音输入";
  const title = !available
    ? "语音输入未就绪 — 点击查看本地识别引擎的启动指引"
    : error ?? (recording ? "停止录音并识别" : transcribing ? "正在识别…" : "按一下开始录音");

  const onClick = () => {
    if (!available) {
      setShowGuide((value) => !value);
      return;
    }
    setShowGuide(false);
    if (recording) stop();
    else if (state === "idle" && !transcript) void start();
  };

  return (
    <span className={`voice-input${className ? ` ${className}` : ""}`}>
      <button
        type="button"
        className="voice-input-btn"
        data-recording={recording || undefined}
        data-unavailable={!available || undefined}
        data-error={error ? true : undefined}
        disabled={transcribing}
        aria-label={label}
        title={title}
        onClick={onClick}
      >
        {transcribing ? (
          <Loader2 size={size} className="voice-input-spin" />
        ) : !available ? (
          <MicOff size={size} />
        ) : (
          <Mic size={size} />
        )}
      </button>

      {/* Transcript-confirm popover — nothing lands in the input until 确认插入. */}
      {transcript !== null ? (
        <div className="voice-input-popover voice-input-confirm" role="dialog" aria-label="语音识别结果">
          <p className="voice-input-transcript">{transcript}</p>
          <div className="voice-input-actions">
            <button
              type="button"
              className="voice-input-action voice-input-action-primary"
              onClick={() => {
                onInsert(transcript);
                clearTranscript();
              }}
            >
              确认插入
            </button>
            <button
              type="button"
              className="voice-input-action"
              onClick={() => {
                clearTranscript();
                void start();
              }}
            >
              重录
            </button>
            <button type="button" className="voice-input-action" onClick={cancel}>
              取消
            </button>
          </div>
        </div>
      ) : null}

      {/* One-click setup guide — the sidecar README's three steps, in place. */}
      {showGuide && !available ? (
        <div className="voice-input-popover voice-input-guide" role="dialog" aria-label="语音输入启动指引">
          <strong>语音输入未就绪</strong>
          <p>{setupHint ?? "本地语音识别引擎（faster-whisper sidecar）未运行。识别在本机进行，不联网、不收费。"}</p>
          <ol>
            <li>
              进入 <code>scripts/stt-sidecar/</code>，运行 <code>python -m venv .venv</code> 并激活
            </li>
            <li>
              <code>pip install -r requirements.txt</code>
            </li>
            <li>
              <code>python server.py</code>（模型首次使用自动下载；弱机可设 <code>WHISPER_MODEL=small</code>）
            </li>
          </ol>
          <p className="voice-input-guide-path">
            完整指引：<code>scripts/stt-sidecar/README.md</code>
          </p>
          <div className="voice-input-actions">
            <button type="button" className="voice-input-action" onClick={() => setShowGuide(false)}>
              知道了
            </button>
          </div>
        </div>
      ) : null}
    </span>
  );
}
