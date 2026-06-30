// SelectionToolbar — the host surface for passage-scoped actions. When a passage is in
// focus it renders the configured anchor-scope action list (built-in kit actions like
// the Textbook kit's Explain / Practice / Mistake, PLUS custom Operations) and runs the
// backing action on click. The host (WorkspaceContext) assembles + orders the list from
// kit contributions and the user's operation-prefs; this component is a dumb renderer,
// so the order / enable-disable the user configured shows up here. Empty list → nothing.

import { Bookmark, ListChecks, Sparkles, TriangleAlert, Wand2 } from "lucide-react";
import type { ComponentType } from "react";
import type { ToolbarAction } from "./WorkspaceContext";
import { ActionMoreMenu } from "./ActionMoreMenu";

// Map the kit's icon names (presentation hints) to concrete lucide icons. Custom ops
// carry no icon and fall back to the generic wand.
const ICONS: Record<string, ComponentType<{ size?: number }>> = {
  sparkles: Sparkles,
  "list-checks": ListChecks,
  "triangle-alert": TriangleAlert,
  bookmark: Bookmark
};

export type SelectionToolbarProps = {
  /** Show only when there's a passage to act on (a saved anchor or a fresh draft). */
  visible: boolean;
  /** The ordered, enabled anchor-scope actions (built-in + custom). */
  items: ToolbarAction[];
  /** Run an action (the host wires this to runAction). */
  onRun(action: ToolbarAction): void;
  /** Whether a command is currently running (disables the buttons). */
  busy?: boolean;
};

export function SelectionToolbar({ visible, items, onRun, busy }: SelectionToolbarProps) {
  if (!visible || items.length === 0) return null;

  return (
    <div className="selection-toolbar" role="toolbar" aria-label="Study actions">
      {items.map((item) => {
        const Icon = (item.icon && ICONS[item.icon]) || Wand2;
        return (
          <button
            key={item.id}
            type="button"
            className="selection-toolbar-btn"
            data-action-kind={item.kind}
            data-action-id={item.id}
            title={item.group ? `${item.group}: ${item.title}` : item.title}
            disabled={busy}
            onClick={() => onRun(item)}
          >
            <Icon size={14} />
            {item.title}
          </button>
        );
      })}
      {/* The grouped overflow twin (R6.2): the primary `.selection-toolbar-btn` row stays
          as-is; this trailing menu mirrors the full list bucketed by group + a Customize
          footer. Same items, same onRun — actions trigger, results render elsewhere. */}
      <ActionMoreMenu items={items} onRun={onRun} busy={busy} surface="inline" />
    </div>
  );
}
