// Shared interactive primitives for note-type FULL renders (N4-D7). A note type's
// render({mode:"full"}) may now RETURN a small stateful React sub-component built from
// these primitives so a saved note becomes INTERACTIVE (quiz answer-check, flashcard
// flip, vocab flip, exercise answer-reveal) — without a new render path, a host branch,
// or a schema change (the adaptive-note contract: getNoteType().render stays the ONE
// entry; the interactivity lives inside the type's own `full` switch).
//
// The primitives OWN behavior + a11y; each note type OWNS its markup (it passes its own
// `sv-quiz-*`/`sv-flashcard-*`/`sv-vocab-*`/`tb-*` nodes so existing CSS/tests keep
// matching). V1 state is EPHEMERAL local useState — no persistence, no store; a remount
// (overlay close/reopen) resets to a fresh start, which is the intended V1 behavior.

import { useState, type KeyboardEvent, type ReactNode } from "react";

// —— FlipCard ————————————————————————————————————————————————————————————————
// A two-faced card that shows ONE face at a time. Click / Enter / Space toggles the
// `flipped` state; the hidden face is genuinely ABSENT from the DOM (conditional render,
// not a CSS 3D flip) so a test/reader never sees the back before the flip. `role=button`
// + `aria-pressed` announce the toggle; `data-face` names the visible face. Used by the
// flashcard + subject-vocab full renders.
//
// `initialFlipped` seeds the STARTING face (default front). The review reveal position
// passes `initialFlipped` so "显示答案" lands straight on the ANSWER (back) face — no
// second manual flip (N4-D7 known wrinkle). It only seeds the initial state; the card
// still toggles freely afterward. Normal (non-review) renders omit it → start on front.
export function FlipCard({
  front,
  back,
  className,
  initialFlipped = false
}: {
  front: ReactNode;
  back: ReactNode;
  className?: string;
  initialFlipped?: boolean;
}) {
  const [flipped, setFlipped] = useState(initialFlipped);
  const toggle = () => setFlipped((f) => !f);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      toggle();
    }
  };
  return (
    <div
      className={`sv-flip${flipped ? " sv-flip-flipped" : ""}${className ? ` ${className}` : ""}`}
      role="button"
      tabIndex={0}
      aria-pressed={flipped}
      data-face={flipped ? "back" : "front"}
      onClick={toggle}
      onKeyDown={onKeyDown}
    >
      {flipped ? (
        <div className="sv-flip-face sv-flip-back">{back}</div>
      ) : (
        <div className="sv-flip-face sv-flip-front">{front}</div>
      )}
    </div>
  );
}

// —— Reveal ——————————————————————————————————————————————————————————————————
// A "show answer" affordance: a button up front; once clicked, the button is replaced by
// the `hidden` content (so the answer is genuinely absent from the DOM until revealed).
// Used by the textbook exercise full render. `trigger` overrides the button label.
export function Reveal({
  hidden,
  trigger,
  className
}: {
  hidden: ReactNode;
  trigger?: ReactNode;
  className?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  if (revealed) {
    return <div className={`sv-reveal sv-reveal-shown${className ? ` ${className}` : ""}`}>{hidden}</div>;
  }
  return (
    <div className={`sv-reveal${className ? ` ${className}` : ""}`}>
      <button type="button" className="sv-reveal-btn link-button" onClick={() => setRevealed(true)}>
        {trigger ?? "显示答案"}
      </button>
    </div>
  );
}

// —— useChoiceQuiz ————————————————————————————————————————————————————————————
// The behavior/state for a single-answer multiple-choice quiz. `pick(i)` records the
// chosen option and reveals the outcome; `correct` is a boolean V1 score = whether the
// FIRST (and only) pick hit `correctIndex`. Ephemeral: a remount resets to unanswered.
// The type owns the markup (renders `optionCount` option buttons + the reveal); this hook
// owns only WHICH option is selected and WHETHER it was right.
export function useChoiceQuiz(
  optionCount: number,
  correctIndex: number
): {
  selected: number | null;
  revealed: boolean;
  correct: boolean;
  pick(index: number): void;
} {
  const [selected, setSelected] = useState<number | null>(null);
  const revealed = selected !== null;
  const pick = (index: number) => {
    // Lock in the first pick — a quiz answer is committed once (V1: no retry/change).
    if (selected !== null) return;
    if (index < 0 || index >= optionCount) return;
    setSelected(index);
  };
  return {
    selected,
    revealed,
    correct: revealed && selected === correctIndex,
    pick
  };
}
