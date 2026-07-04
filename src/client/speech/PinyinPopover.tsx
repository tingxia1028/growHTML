// PinyinPopover (SPEECH-3 注音) — the universal 注音 surface: given a piece of text it
// shows the CJK characters BIG (kid-friendly ~28px) with tone-marked pinyin above each
// as real `<ruby>字<rt>zì</rt></ruby>` runs; non-CJK stretches render as plain runs.
// A compact 朗读 SpeakButton sits in the header (reading and pinyin belong together —
// the same 低年级 kid who can't read the character wants to HEAR it too).
//
// Positioning: a small CENTERED dialog over a dismissable backdrop (the FocusOverlay
// modal idiom) — deliberately NOT anchored to the selection rect: selections live in
// scrolling panes/iframes and a centered card is the robust, kid-friendly V1. Escape,
// the ✕ button, and a backdrop click all dismiss. Input is capped (~200 chars) with an
// honest note beyond — 注音 is for a phrase you can't read, not for whole pages
// (reader-body inline ruby is the future N-batch enhancement).

import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { SpeakButton } from "./SpeakButton";
import { annotate } from "./pinyin";
import "./pinyinPopover.css";

/** Cap (in code points) on what one popover annotates — beyond it we truncate + note. */
export const PINYIN_POPOVER_MAX_CHARS = 200;

export type PinyinPopoverProps = {
  /** The text to annotate (already trimmed by the opener). */
  text: string;
  /** Dismiss (Escape / ✕ / backdrop). */
  onClose(): void;
};

/** Render model: consecutive non-CJK chars merge into one plain run so latin words
 *  and punctuation flow naturally between the per-character ruby runs. */
type PinyinRun = { kind: "ruby"; char: string; pinyin: string } | { kind: "plain"; text: string };

function toRuns(text: string): PinyinRun[] {
  const runs: PinyinRun[] = [];
  for (const item of annotate(text)) {
    if (item.pinyin) {
      runs.push({ kind: "ruby", char: item.char, pinyin: item.pinyin });
    } else {
      const last = runs[runs.length - 1];
      if (last?.kind === "plain") last.text += item.char;
      else runs.push({ kind: "plain", text: item.char });
    }
  }
  return runs;
}

export function PinyinPopover({ text, onClose }: PinyinPopoverProps) {
  // Cap by code points (never split a surrogate pair) — the 朗读 button reads exactly
  // what is shown, so the capped text feeds both the runs and the SpeakButton.
  const { shown, truncated } = useMemo(() => {
    const chars = Array.from(text);
    return chars.length > PINYIN_POPOVER_MAX_CHARS
      ? { shown: chars.slice(0, PINYIN_POPOVER_MAX_CHARS).join(""), truncated: true }
      : { shown: text, truncated: false };
  }, [text]);
  const runs = useMemo(() => toRuns(shown), [shown]);

  // Escape dismisses (document-level, same idiom as the speak chip / floating toolbar).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="pinyin-popover-backdrop" onClick={onClose}>
      <div
        className="pinyin-popover"
        role="dialog"
        aria-modal="true"
        aria-label="拼音注音"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="pinyin-popover-header">
          <span className="pinyin-popover-title">注音</span>
          {/* 朗读 rides along: the shared SpeakButton reads the SAME capped text. */}
          <SpeakButton text={shown} className="pinyin-popover-speak" size={14} />
          <button type="button" className="pinyin-popover-close" aria-label="关闭" title="关闭" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="pinyin-popover-text">
          {runs.map((run, index) =>
            run.kind === "ruby" ? (
              <ruby key={index}>
                {run.char}
                <rt>{run.pinyin}</rt>
              </ruby>
            ) : (
              <span key={index} className="pinyin-popover-plain">
                {run.text}
              </span>
            )
          )}
        </div>
        {truncated ? (
          <div className="pinyin-popover-truncated">内容较长，仅显示前 {PINYIN_POPOVER_MAX_CHARS} 个字的注音…</div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
