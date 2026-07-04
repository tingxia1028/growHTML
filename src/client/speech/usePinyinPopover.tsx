// usePinyinPopover + PinyinButton (SPEECH-3 注音) — the shared glue that puts 注音 on
// the TWO universal text-selection surfaces (the same universality law as 朗读
// SPEECH-1b: 注音 is a capability of TEXT, offered wherever text is selected — never a
// per-view bolt-on):
//   • GlobalSpeakSelection — the host-level chip gains a second 拼 button;
//   • SelectionFloatingToolbar — the reader's selection row gains the same button.
//
// The popover STATE is hoisted here (host level) on purpose: clicking anything —
// including the popover itself — collapses the document selection, which unmounts the
// chip/toolbar. If the popover lived inside them it would die with its opener; the
// hook keeps it alive until the user dismisses it.

import { useCallback, useState, type ReactNode } from "react";
import { PinyinPopover } from "./PinyinPopover";
import { containsCjk } from "./pinyin";
import "./pinyinPopover.css";

export type PinyinPopoverControls = {
  /** Open the popover for this text (ignored when empty / no CJK to annotate). */
  open(text: string): void;
  /** Render this once at the host level — it outlives the selection UI that opened it. */
  popover: ReactNode;
};

export function usePinyinPopover(): PinyinPopoverControls {
  const [text, setText] = useState<string | null>(null);
  const open = useCallback((value: string) => {
    const trimmed = value.trim();
    if (trimmed && containsCjk(trimmed)) setText(trimmed);
  }, []);
  const close = useCallback(() => setText(null), []);
  return { open, popover: text ? <PinyinPopover text={text} onClose={close} /> : null };
}

export type PinyinButtonProps = {
  /** The candidate text; no CJK in it → the button renders nothing (the gate). */
  text: string | null | undefined;
  /** Open the (hoisted) popover with the trimmed text. */
  onOpen(text: string): void;
  /** Optional extra class for surface-specific metrics (chip pill vs toolbar square). */
  className?: string;
  /** Show the 注音 text label beside the 拼 glyph (the chip does; toolbars don't). */
  showLabel?: boolean;
};

/** The dumb 拼 trigger both surfaces render — the CJK gate lives HERE so every host
 *  gets identical behavior for free (latin-only selections never see 注音). */
export function PinyinButton({ text, onOpen, className, showLabel }: PinyinButtonProps) {
  const trimmed = (text ?? "").trim();
  if (!containsCjk(trimmed)) return null;
  return (
    <button
      type="button"
      className={`pinyin-btn${className ? ` ${className}` : ""}`}
      aria-label="注音"
      title="注音（显示拼音）"
      onClick={() => onOpen(trimmed)}
    >
      <span className="pinyin-btn-glyph">拼</span>
      {showLabel ? <span className="pinyin-btn-label">注音</span> : null}
    </button>
  );
}
