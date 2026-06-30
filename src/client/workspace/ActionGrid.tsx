// ActionGrid — a dumb, reusable icon-grid renderer for a list of ToolbarActions. It is
// the shared body of the Anchor Action Bar (and, later, the other action surfaces): it
// only RENDERS + TRIGGERS — each button calls `onRun(action)`; the host's `runAction`
// decides what that means (a built-in command dispatch, or operation.run for a custom
// op whose result flows through the existing GenerationPreview). No render path for
// results lives here (adaptive-note contract: actions trigger, they do not render output).
//
// Icon-only buttons; the title/description show in the native tooltip. `density="grid"`
// lays them out as an auto-filling square grid; `density="row"` keeps them inline.

import { actionIcon } from "./actionIcons";
import type { ToolbarAction } from "./WorkspaceContext";

export type ActionGridProps = {
  /** The ordered, enabled actions to render (built-in + custom, already prefs-ordered). */
  items: ToolbarAction[];
  /** Trigger an action (the host wires this to runAction). */
  onRun(action: ToolbarAction): void;
  /** Greys out + disables every button (e.g. no passage focused). */
  disabled: boolean;
  /** A command/generation is in flight — also disables the buttons. */
  busy?: boolean;
  /** Square auto-fill grid ("grid", default) or inline row ("row"). */
  density?: "grid" | "row";
};

export function ActionGrid({ items, onRun, disabled, busy, density = "grid" }: ActionGridProps) {
  const isDisabled = disabled || !!busy;
  return (
    <div className={`action-grid action-grid-${density}`} role="toolbar" aria-label="Actions">
      {items.map((action) => {
        const Icon = actionIcon(action);
        return (
          <button
            key={action.id}
            type="button"
            className="action-grid-btn"
            data-action-id={action.id}
            data-action-kind={action.kind}
            disabled={isDisabled}
            title={action.description ? `${action.title} — ${action.description}` : action.title}
            aria-label={action.title}
            onClick={() => onRun(action)}
          >
            <Icon size={16} />
          </button>
        );
      })}
    </div>
  );
}
