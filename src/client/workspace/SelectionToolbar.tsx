// SelectionToolbar — the host surface for passage-scoped actions. When a passage is in
// focus it renders the configured anchor-scope action list (built-in kit actions like
// the Textbook kit's Explain / Practice / Mistake, PLUS custom Operations) and runs the
// backing action on click. The host (WorkspaceContext) assembles + orders the list from
// kit contributions and the user's operation-prefs; this component is a dumb renderer,
// so the order / enable-disable the user configured shows up here. Empty list → nothing.

import type { ToolbarAction } from "./WorkspaceContext";
import { ActionMoreMenu } from "./ActionMoreMenu";
import { actionIcon } from "./actionIcons";
import { SpeakButton } from "../speech/SpeakButton";

export type SelectionToolbarProps = {
  /** Show only when there's a passage to act on (a saved anchor or a fresh draft). */
  visible: boolean;
  /** The ordered, enabled anchor-scope actions (built-in + custom). */
  items: ToolbarAction[];
  /** Run an action (the host wires this to runAction). */
  onRun(action: ToolbarAction): void;
  /** Whether a command is currently running (disables the buttons). */
  busy?: boolean;
  /** Open the Customize panel (the host wires this to openOperationManager); the More
      menu's footer deep-links to this surface's Customize tab. */
  onCustomize?(surface: "inline" | "anchor" | "bottom"): void;
  /** Opt-in 朗读 (SPEECH-1): when set (even ""), a SpeakButton for this text joins the
      row — the host passes the focused passage's quote. Undefined → no speech button. */
  speakText?: string;
};

export function SelectionToolbar({ visible, items, onRun, busy, onCustomize, speakText }: SelectionToolbarProps) {
  if (!visible || items.length === 0) return null;

  return (
    <div className="selection-toolbar" role="toolbar" aria-label="Study actions">
      {items.map((item) => {
        // Icon-only (spec §7.2.1: "一行常用图标 + …"); the label lives in the hover
        // tooltip + aria-label. Same actionIcon resolver the Anchor bar uses (honours
        // user icon overrides + operation→noteTypeIcon), so all three surfaces match.
        const Icon = actionIcon(item);
        return (
          <button
            key={item.id}
            type="button"
            className="selection-toolbar-btn"
            data-action-kind={item.kind}
            data-action-id={item.id}
            aria-label={item.title}
            title={item.description ? `${item.title} — ${item.description}` : item.title}
            disabled={busy}
            onClick={() => onRun(item)}
          >
            <Icon size={16} />
          </button>
        );
      })}
      {/* 朗读 (SPEECH-1): reads the focused passage aloud — a stateful trigger (it
          becomes 停止 while speaking), so it is its own component beside the
          ToolbarAction row rather than a dispatched command. */}
      {speakText !== undefined ? <SpeakButton text={speakText} /> : null}
      {/* The grouped overflow twin (R6.2): the primary `.selection-toolbar-btn` row stays
          as-is; this trailing menu mirrors the full list bucketed by group + a Customize
          footer. Same items, same onRun — actions trigger, results render elsewhere. */}
      <ActionMoreMenu items={items} onRun={onRun} busy={busy} surface="inline" onCustomize={onCustomize} />
    </div>
  );
}
