// SourceActionsToolbar — host surface for source-scoped actions: actions that operate
// on the whole source, not a single passage (e.g. the Textbook kit's Review Pack, or a
// custom source-scope Operation). Same pattern as SelectionToolbar but gated on "there
// is an active source" rather than "a passage is in focus". The host assembles + orders
// the list (built-in source contributions + custom ops) from operation-prefs; this is a
// dumb renderer. Renders nothing when the list is empty.

import { Star, Wand2 } from "lucide-react";
import type { ComponentType } from "react";
import type { ToolbarAction } from "./WorkspaceContext";

const ICONS: Record<string, ComponentType<{ size?: number }>> = {
  star: Star
};

export type SourceActionsToolbarProps = {
  /** Show only when a source is open (source-level actions need one). */
  visible: boolean;
  /** The ordered, enabled source-scope actions (built-in + custom). */
  items: ToolbarAction[];
  onRun(action: ToolbarAction): void;
  busy?: boolean;
};

export function SourceActionsToolbar({ visible, items, onRun, busy }: SourceActionsToolbarProps) {
  if (!visible || items.length === 0) return null;

  return (
    <div className="source-actions-toolbar" role="toolbar" aria-label="Source actions">
      {items.map((item) => {
        const Icon = (item.icon && ICONS[item.icon]) || Wand2;
        return (
          <button
            key={item.id}
            type="button"
            className="source-actions-btn"
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
    </div>
  );
}
