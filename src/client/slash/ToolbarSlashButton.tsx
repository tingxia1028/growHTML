// ToolbarSlashButton (SC-2; docs/design/slash-composer.md §5 "toolbar surfaces") — the
// `/` affordance for the toolbar surfaces that have NO text input (the selection
// floating toolbar + the anchor action bar). It mounts the SHIPPED SC-0 <SlashPalette>
// in a popover anchored to a `/` button, so a user can pick a note-type / operation
// straight from a selection or a focused anchor — the same palette the chat composer
// drops, without a chat.
//
// The whole risk is SELECTION-BLUR: every dispatch path materializes the LIVE
// focus.draft at run time (note.generate-block / operation.run / openManualEditor→Save),
// so this button's ONLY job is to keep focus.draft alive until the pick dispatches. Three
// guards make that airtight:
//   • NO focusable filter input — a focused input would steal focus + collapse the
//     reader range → drop focus.draft. Filtering is driven from KEYDOWN on the button
//     (printable keys grow the query, Backspace trims it), exactly the way the chat
//     forwards its input's keydown through slashPaletteKeyDown for arrows/Enter.
//   • onMouseDown → preventDefault on the button, the popover wrapper, AND every row
//     (rows via SlashPalette's own handler) so opening / navigating never collapses the
//     selection before the pick's command reads it.
//   • Escape stopPropagation — Escape closes the palette FIRST, without also firing the
//     document-level Escape that clears the selection/toolbar. A second Escape (palette
//     already closed) falls through and clears the selection as usual.
//
// It reads its live deps off useWorkspace() (operations / prefs / active kit for the
// list; dispatch + openManualEditor for the pick via the shared dispatchSlashEntry) —
// the mount just renders <ToolbarSlashButton surface=… /> and gates visibility.

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useWorkspace } from "../workspace/WorkspaceContext";
import { slashEntries as buildSlashEntries } from "./adapters";
import { resolveSlashEntries } from "./engine";
import { dispatchSlashEntry } from "./dispatchSlashEntry";
import { SlashPalette, slashPaletteKeyDown } from "./SlashPalette";

export type ToolbarSlashButtonProps = {
  /** Which toolbar hosts the button — drives the data-surface hook + aria wording. */
  surface: "selection" | "anchor";
  /** Extra disable gate (the anchor bar passes !(focus.anchor || focus.draft)). The
      selection toolbar leaves it undefined (it only appears with a live selection). */
  disabled?: boolean;
};

// A printable single character (the keys that GROW the query). Modifier chords, function
// keys, arrows, Enter, Escape, Backspace all have multi-char `key`s and are handled
// separately, so a length-1 key that isn't one of those is a query character.
function isPrintable(event: ReactKeyboardEvent | KeyboardEvent): boolean {
  return event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
}

export function ToolbarSlashButton({ surface, disabled }: ToolbarSlashButtonProps) {
  const { operations, operationPrefs, activeKitIds, dispatch, openManualEditor } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // The FULL palette list (note types + operations, active-kit-first), rebuilt only when
  // the operation set / prefs / active kit change — the per-keystroke work is the resolve.
  const allEntries = useMemo(
    () =>
      buildSlashEntries({
        operations,
        disabled: operationPrefs.disabled,
        foregroundKitIds: activeKitIds
      }),
    [operations, operationPrefs, activeKitIds]
  );
  // Bare `/` (empty query) = the whole list; a query filters + ranks it.
  const entries = useMemo(() => resolveSlashEntries(query, allEntries), [query, allEntries]);

  // Reset the active row whenever the filtered set changes so the top match is the Enter
  // target (mirrors the chat composer's setSlashIndex(0) on input).
  useEffect(() => setIndex(0), [query]);

  // Keep keyboard focus on the button while the popover is open so its keydown drives the
  // palette (there is no input to hold focus). Focus once on open.
  useEffect(() => {
    if (open) buttonRef.current?.focus();
  }, [open]);

  // Outside-click closes the popover. mousedown (not click) so it fires before a reader
  // click would collapse the selection; a click INSIDE the root is preventDefault'd
  // already, so this only closes on a genuine outside press.
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery("");
    setIndex(0);
  };

  const pick = (entry: (typeof entries)[number]) => {
    // Toolbar picks carry NO instruction (no mini-composer): bare noteType → manual
    // editor; operation → operation.run. The instruction path stays chat-only.
    dispatchSlashEntry(entry, "", { dispatch, openManualEditor });
    close();
  };

  // The button's keydown IS the palette's keyboard (no input). Arrows/Enter forward to
  // the shared slashPaletteKeyDown; Escape closes the palette and stops propagation so
  // the document Escape doesn't also clear the selection; Backspace trims the query;
  // any printable key grows it. Every consumed key is preventDefault'd so the button's
  // default (space = click, etc.) never fires.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      // Close the palette FIRST — don't let the document-level Escape clear the selection
      // on the same keystroke.
      event.stopPropagation();
      close();
      return;
    }
    if (slashPaletteKeyDown(event.key, { entries, activeIndex: index, onPick: pick, onNavigate: setIndex })) {
      event.preventDefault();
      return;
    }
    if (event.key === "Backspace") {
      event.preventDefault();
      setQuery((q) => q.slice(0, -1));
      return;
    }
    if (isPrintable(event)) {
      event.preventDefault();
      setQuery((q) => q + event.key);
    }
  };

  return (
    <div
      ref={rootRef}
      className="toolbar-slash"
      data-surface={surface}
      // Don't steal the selection: opening / navigating the palette must not collapse
      // the reader range before a pick's command materializes focus.draft.
      onMouseDown={(event) => event.preventDefault()}
      onKeyDown={onKeyDown}
    >
      <button
        ref={buttonRef}
        type="button"
        className="toolbar-slash-btn"
        aria-label="Slash commands"
        aria-haspopup="listbox"
        aria-expanded={open}
        title="/ 命令"
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => (open ? close() : setOpen(true))}
      >
        /
      </button>
      {open ? (
        <div className="toolbar-slash-popover" onMouseDown={(event) => event.preventDefault()}>
          <SlashPalette query={query} entries={entries} activeIndex={index} onPick={pick} onNavigate={setIndex} />
        </div>
      ) : null}
    </div>
  );
}
