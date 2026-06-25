// SourceActionsToolbar — host surface for kit `source-actions` contributions: actions
// that operate on the whole source, not a single passage (e.g. the Textbook kit's
// Review Pack, which synthesizes the source's blocks). Same pattern as SelectionToolbar
// but gated on "there is an active source" rather than "a passage is in focus". Renders
// nothing when no kit contributes — zero impact on the base app.

import { Star, Wand2 } from "lucide-react";
import type { ComponentType } from "react";
import { kitSurfaceItems } from "../../kits/clientContext";

const ICONS: Record<string, ComponentType<{ size?: number }>> = {
  star: Star
};

export type SourceActionsToolbarProps = {
  /** Show only when a source is open (source-level actions need one). */
  visible: boolean;
  /** The active source's effective kit ids — only these kits' actions are shown. */
  kitIds: readonly string[];
  onRun(commandId: string): void;
  busy?: boolean;
};

export function SourceActionsToolbar({ visible, kitIds, onRun, busy }: SourceActionsToolbarProps) {
  const items = kitSurfaceItems("source-actions", kitIds);
  if (!visible || items.length === 0) return null;

  return (
    <div className="source-actions-toolbar" role="toolbar" aria-label="Source actions">
      {items.map((item) => {
        const Icon = (item.icon && ICONS[item.icon]) || Wand2;
        return (
          <button
            key={item.commandId}
            type="button"
            className="source-actions-btn"
            title={item.group ? `${item.group}: ${item.title}` : item.title}
            disabled={busy}
            onClick={() => onRun(item.commandId)}
          >
            <Icon size={14} />
            {item.title}
          </button>
        );
      })}
    </div>
  );
}
