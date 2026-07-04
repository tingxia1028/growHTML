// SpeakButton (SPEECH-1) — the 朗读 trigger for a piece of text. Rides existing
// action rows (the floating selection toolbar, the Anchor Action Bar, the note-list
// row actions) as one shared component: disabled until the server's speech status
// says the TTS lane is available (and while there's nothing to read); while speaking
// it flips to 停止. Target users include 低年级 kids who can't read every character —
// any selected passage must be one tap from being read aloud.
//
// Pure trigger, UI-only state: no entities, no vault writes, no render path for
// results (the "result" is sound).

import { Square, Volume2 } from "lucide-react";
import { useSpeakText } from "./useSpeakText";
import "./speech.css";

export type SpeakButtonProps = {
  /** What to read aloud. Empty/null → the button renders disabled. */
  text: string | null | undefined;
  /** Optional extra class so host rows can size/align it (e.g. note-list rows). */
  className?: string;
  /** Icon size (defaults to the action-row 16px). */
  size?: number;
};

export function SpeakButton({ text, className, size = 16 }: SpeakButtonProps) {
  const { speak, stop, speaking, available, error } = useSpeakText();
  const trimmed = (text ?? "").trim();
  const disabled = !available || (!speaking && !trimmed);
  const label = speaking ? "停止" : "朗读";
  const title = !available
    ? "朗读不可用（语音服务未就绪或需要联网）"
    : error ?? (speaking ? "停止朗读" : "朗读这段文字");

  return (
    <button
      type="button"
      className={`speak-btn${className ? ` ${className}` : ""}`}
      data-speaking={speaking || undefined}
      disabled={disabled}
      aria-label={label}
      title={title}
      onClick={() => (speaking ? stop() : void speak(trimmed))}
    >
      {speaking ? <Square size={Math.max(10, size - 4)} /> : <Volume2 size={size} />}
    </button>
  );
}
