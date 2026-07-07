// SlashPalette (SC-0; docs/design/slash-composer.md §4) — ONE dumb, controlled list
// component for all three mounts (chat composer / selection toolbar / anchor bar).
// It owns NO state and NO registry access: the mount parses the draft with the
// engine, resolves entries, and hands them down; the palette only paints rows and
// reports intents (onNavigate / onPick). Keyboard mapping lives in an exported
// helper so a mount whose FOCUS stays in its own input (the composer, SC-1) can
// drive the palette from its keydown without re-implementing the arrows.

import { useEffect, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { noteTypeIcon } from "../notes/noteTypeIcon";
import { namedActionIcon } from "../workspace/actionIcons";
import type { SlashEntry } from "./engine";

export type SlashPaletteProps = {
  /** The parsed slash query — shown in the empty state ("No match for /xyz"). */
  query: string;
  /** The RESOLVED entries (engine order = display order). */
  entries: readonly SlashEntry[];
  /** Which row is active (highlighted / Enter target). The parent owns it. */
  activeIndex: number;
  /** A row was chosen (Enter on the active row, or a click). */
  onPick(entry: SlashEntry): void;
  /** The active row should move (arrow keys wrap; hover follows the pointer). */
  onNavigate(nextIndex: number): void;
};

type SlashKeyTarget = Pick<SlashPaletteProps, "entries" | "activeIndex" | "onPick" | "onNavigate">;

/**
 * Map one keydown onto palette intents: ArrowDown/ArrowUp move (wrapping), Enter
 * picks the active row. Returns true when the key was consumed — the caller then
 * preventDefault()s so the composer caret / form submit don't also react. Escape is
 * NOT handled here: closing the palette is the parent's state, not the list's.
 */
export function slashPaletteKeyDown(key: string, palette: SlashKeyTarget): boolean {
  const count = palette.entries.length;
  if (count === 0) return false;
  if (key === "ArrowDown") {
    palette.onNavigate((palette.activeIndex + 1) % count);
    return true;
  }
  if (key === "ArrowUp") {
    palette.onNavigate((palette.activeIndex - 1 + count) % count);
    return true;
  }
  if (key === "Enter") {
    const active = palette.entries[palette.activeIndex];
    if (!active) return false;
    palette.onPick(active);
    return true;
  }
  return false;
}

// A row's glyph: an explicit registration icon STRING wins; a noteType row falls
// back to the central noteTypeIcon map (same icon the note list shows — one icon
// per type everywhere); an operation row (SC-3) gets a generic spark.
function RowIcon({ entry }: { entry: SlashEntry }) {
  if (entry.icon) {
    const Icon = namedActionIcon(entry.icon);
    if (Icon) return <Icon className="slash-palette-icon" size={14} aria-hidden="true" />;
    return (
      <span className="slash-palette-icon" aria-hidden="true">
        {entry.icon}
      </span>
    );
  }
  if (entry.kind === "noteType") {
    const Icon = noteTypeIcon(entry.id);
    return <Icon className="slash-palette-icon" size={14} aria-hidden="true" />;
  }
  return (
    <span className="slash-palette-icon" aria-hidden="true">
      ✦
    </span>
  );
}

export function SlashPalette({ query, entries, activeIndex, onPick, onNavigate }: SlashPaletteProps) {
  const activeRef = useRef<HTMLLIElement | null>(null);

  // Keep the active row visible as arrows move it. Guarded: jsdom has no
  // scrollIntoView, and a short list never scrolls anyway.
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  if (entries.length === 0) {
    return (
      <div className="slash-palette slash-palette-empty" role="status">
        No match for <code>/{query}</code>
      </div>
    );
  }

  return (
    <div
      className="slash-palette"
      // The component is usable standalone (keyboard on the list itself); the SC-1
      // composer instead forwards its input's keydown through slashPaletteKeyDown.
      onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (slashPaletteKeyDown(event.key, { entries, activeIndex, onPick, onNavigate })) {
          event.preventDefault();
        }
      }}
      tabIndex={-1}
    >
      <ul className="slash-palette-list" role="listbox" aria-label="Slash commands">
        {entries.map((entry, index) => {
          const active = index === activeIndex;
          return (
            <li
              key={`${entry.kind}:${entry.id}`}
              ref={active ? activeRef : undefined}
              className={`slash-palette-row${active ? " active" : ""}`}
              role="option"
              aria-selected={active}
              data-entry-id={entry.id}
              // mousedown (not click) so a composer mount doesn't lose input focus
              // before the pick lands.
              onMouseDown={(event) => {
                event.preventDefault();
                onPick(entry);
              }}
              onMouseEnter={() => onNavigate(index)}
            >
              <RowIcon entry={entry} />
              <span className="slash-palette-main">
                <span className="slash-palette-title">{entry.title}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
