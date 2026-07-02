// IconRail (R1) — the narrow (~56px) vertical strip on the far left. It is CHROME, not a
// dock pane (rendered by WorkspaceShell outside the resizable tree). Each icon swaps which
// view-kind fills the left rail slot (the dock's switchable left leaf); the default is
// Library. This is how the panes that used to be always-on columns (Bookmarks / Concepts /
// Operations / Layers) are now reached — they stay registered + fully reachable.
//
// Bottom: a static avatar placeholder that opens the same Settings affordance the gear
// hosts (account/settings menu) — here it just toggles the gear menu by selecting nothing
// destructive; R1 keeps it a placeholder per spec.
//
// R1.5 note: this app is local-first with NO user/account/auth concept (WorkspaceContext
// has no current-user/profile name, and there is no login). So there is no real user name
// to show. The avatar therefore carries a neutral app-derived identity ("Growte" / "G")
// instead of the old hardcoded "Alex". When an account model lands, point AVATAR_NAME at it.

import {
  Anchor,
  Blocks,
  BookOpenCheck,
  Code2,
  Folder,
  Layers,
  Network,
  NotebookPen
} from "lucide-react";
import type { ComponentType } from "react";

export type RailEntry = {
  kind: string;
  label: string;
  Icon: ComponentType<{ size?: number }>;
};

// Maps to existing registered view kinds (spec §4). "Notes" has no standalone pane in R1
// (notes live inside the study panel), so it focuses the study/notes column by selecting
// the library slot's note context — kept as a Library-adjacent entry that opens Library
// (the notes list is in the right column). To avoid a dead entry we map Notes → library
// for now and note it as deferred.
export const RAIL_ENTRIES: RailEntry[] = [
  { kind: "library", label: "Library", Icon: Folder },
  { kind: "bookmark.list", label: "Anchors / Bookmarks", Icon: Anchor },
  { kind: "study", label: "Notes", Icon: NotebookPen },
  { kind: "concept.list", label: "Concepts", Icon: Network },
  { kind: "operation.manager", label: "Operations", Icon: Code2 },
  { kind: "layer.switcher", label: "Layers", Icon: Layers },
  { kind: "plugin.manager", label: "Kit & Plugin", Icon: Blocks },
  { kind: "review.panel", label: "复习 (Review)", Icon: BookOpenCheck }
];

// Neutral app-derived identity for the bottom avatar. This app has no user/account model
// (see header note), so there is no real name to show — we use the product identity rather
// than the old hardcoded "Alex". AVATAR_DOT stays in sync with AVATAR_NAME's initial.
const AVATAR_NAME = "Growte";
const AVATAR_DOT = AVATAR_NAME.charAt(0).toUpperCase();

export type IconRailProps = {
  /** The view-kind currently shown in the left rail slot. */
  selected: string;
  /** Show a pane kind in the left rail slot. */
  onSelect(kind: string): void;
};

export function IconRail({ selected, onSelect }: IconRailProps) {
  return (
    <nav className="icon-rail" aria-label="Panels">
      <div className="icon-rail-entries">
        {RAIL_ENTRIES.map((entry) => (
          <button
            key={entry.kind}
            type="button"
            className={`icon-rail-btn${selected === entry.kind ? " active" : ""}`}
            aria-label={entry.label}
            aria-pressed={selected === entry.kind}
            title={entry.label}
            onClick={() => onSelect(entry.kind)}
          >
            <entry.Icon size={20} />
          </button>
        ))}
      </div>
      <button type="button" className="icon-rail-avatar" title={AVATAR_NAME}>
        <span className="icon-rail-avatar-dot" aria-hidden="true">
          {AVATAR_DOT}
        </span>
        <span className="icon-rail-avatar-label">{AVATAR_NAME}</span>
      </button>
    </nav>
  );
}
