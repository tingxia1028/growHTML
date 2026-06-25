// SelectionToolbar — the host surface for kit `selection-toolbar` contributions. When
// a passage is in focus, it renders the installed kits' quick actions (e.g. the
// Textbook kit's Explain / Practice / Mistake) and dispatches the backing command on
// click. With no kit installed it renders nothing — zero impact on the base app.

import { ListChecks, Sparkles, TriangleAlert, Wand2 } from "lucide-react";
import type { ComponentType } from "react";
import { kitSurfaceItems } from "../../kits/clientContext";

// Map the kit's icon names (presentation hints) to concrete lucide icons.
const ICONS: Record<string, ComponentType<{ size?: number }>> = {
  sparkles: Sparkles,
  "list-checks": ListChecks,
  "triangle-alert": TriangleAlert
};

export type SelectionToolbarProps = {
  /** Show only when there's a passage to act on (a saved anchor or a fresh draft). */
  visible: boolean;
  /** The active source's effective kit ids — only these kits' actions are shown. */
  kitIds: readonly string[];
  /** Run a command by id (the host wires this to its dispatch). */
  onRun(commandId: string): void;
  /** Whether a command is currently running (disables the buttons). */
  busy?: boolean;
};

export function SelectionToolbar({ visible, kitIds, onRun, busy }: SelectionToolbarProps) {
  const items = kitSurfaceItems("selection-toolbar", kitIds);
  if (!visible || items.length === 0) return null;

  return (
    <div className="selection-toolbar" role="toolbar" aria-label="Study actions">
      {items.map((item) => {
        const Icon = (item.icon && ICONS[item.icon]) || Wand2;
        return (
          <button
            key={item.commandId}
            type="button"
            className="selection-toolbar-btn"
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
