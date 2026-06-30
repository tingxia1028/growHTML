// ActionMoreMenu — the grouped "More" overflow for an action surface (R6.2). Each action
// surface (the inline selection toolbar, the Anchor Action Bar, the bottom bar) shows a
// compact set of triggers; this menu MIRRORS the full action list, bucketed into the fixed
// group sections (via the pure `groupActions`), plus a "Customize Toolbar" footer. It is a
// pure RENDER + TRIGGER surface: every row calls `onRun(action)` and the host's runAction
// decides what that means — results still flow through the existing GenerationPreview / note
// render, never here (adaptive-note contract: actions trigger, they do not render output).
//
// Open/close + outside-click mirror PanelMenu's tiny pattern, but the trigger/popover carry
// the `.action-more-*` classNames the action surfaces (and e2e) key off, so it reads as one
// family with .action-grid rather than a panel header menu.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import { actionIcon } from "./actionIcons";
import { groupActions } from "./actionGroups";
import type { ToolbarAction } from "./WorkspaceContext";

/** Mirrors `width: 248px` on `.action-more-menu` in styles.css — drives right-alignment. */
const POPOVER_WIDTH = 248;
/** Fallback height used for the flip decision before the popover has been measured. */
const ESTIMATED_HEIGHT = 360;
/** Min gap from the viewport edges so the popover never sits flush against them. */
const VIEWPORT_MARGIN = 8;

const SURFACE_LABELS: Record<ActionMoreMenuProps["surface"], string> = {
  inline: "More — Selection",
  anchor: "More — Anchor",
  bottom: "More — Actions"
};

export type ActionMoreMenuProps = {
  /** The full, ordered action list for this surface (mirrored + grouped in the menu). */
  items: ToolbarAction[];
  /** Trigger an action (the host wires this to runAction). */
  onRun(action: ToolbarAction): void;
  /** A command/generation is in flight — greys out + disables every row. */
  busy?: boolean;
  /** Which surface this menu hangs off (drives the header title + a data attribute). */
  surface: "inline" | "anchor" | "bottom";
  /** Open the toolbar-customization UI for THIS menu's surface (the footer passes its
      own `surface`, so the panel deep-links to the matching Customize tab). Undefined →
      the footer button renders disabled, so the affordance stays visible. */
  onCustomize?(surface: "inline" | "anchor" | "bottom"): void;
};

export function ActionMoreMenu({ items, onRun, busy, surface, onCustomize }: ActionMoreMenuProps) {
  const [open, setOpen] = useState(false);
  // Container of the trigger; also one of the two "inside" nodes for outside-click.
  const ref = useRef<HTMLDivElement | null>(null);
  // The trigger button itself — we read its rect to place the (portaled) popover.
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  // The portaled popover element — the second "inside" node, and the source of the
  // measured height used to decide whether to flip above the trigger.
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  // Compute the fixed position from the trigger rect. Right-aligned + clamped horizontally;
  // prefer below, flip above when it would overflow the bottom of the viewport.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      // Use the real measured height once painted; fall back to an estimate on first pass.
      const height = popoverRef.current?.offsetHeight || ESTIMATED_HEIGHT;

      let left = rect.right - POPOVER_WIDTH;
      if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;

      let top = rect.bottom + 4;
      if (rect.bottom + height > window.innerHeight - VIEWPORT_MARGIN) {
        const flipped = rect.top - height - 4;
        top = flipped < VIEWPORT_MARGIN ? VIEWPORT_MARGIN : flipped;
      }
      setPos({ top, left });
    };
    place();
    // Re-run once after first paint so the real popover height drives the flip decision.
    const raf = requestAnimationFrame(place);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      // Portaled popover is NOT a DOM descendant of the trigger container, so treat both
      // the trigger container AND the popover element as "inside".
      const insideTrigger = ref.current?.contains(target);
      const insidePopover = popoverRef.current?.contains(target);
      if (!insideTrigger && !insidePopover) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const groups = groupActions(items);

  return (
    <div className="action-more" data-surface={surface} ref={ref}>
      <button
        type="button"
        ref={triggerRef}
        className={`action-more-trigger${open ? " active" : ""}`}
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={open}
        title="More"
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal size={16} />
      </button>
      {open
        ? createPortal(
        <div
          className="action-more-menu"
          role="menu"
          ref={popoverRef}
          style={{ position: "fixed", top: pos.top, left: pos.left, width: POPOVER_WIDTH }}
        >
          <div className="action-more-header">{SURFACE_LABELS[surface]}</div>
          {groups.map((section) => (
            <div className="action-more-group" key={section.group}>
              <div className="action-more-label">{section.group}</div>
              {section.items.map((action) => {
                const Icon = actionIcon(action);
                return (
                  <button
                    key={action.id}
                    type="button"
                    className="action-more-item"
                    data-action-id={action.id}
                    data-action-kind={action.kind}
                    role="menuitem"
                    disabled={!!busy}
                    title={action.description ? `${action.title} — ${action.description}` : action.title}
                    onClick={() => {
                      onRun(action);
                      setOpen(false);
                    }}
                  >
                    <Icon size={15} />
                    <span className="action-more-item-label">{action.title}</span>
                  </button>
                );
              })}
            </div>
          ))}
          <div className="action-more-footer">
            <button
              type="button"
              className="action-more-customize"
              disabled={!onCustomize}
              onClick={() => {
                onCustomize?.(surface);
                setOpen(false);
              }}
            >
              Customize Toolbar
            </button>
          </div>
        </div>,
            document.body
          )
        : null}
    </div>
  );
}
