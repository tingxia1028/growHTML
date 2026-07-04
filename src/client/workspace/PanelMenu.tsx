// PanelMenu — a tiny shared "⋯ overflow menu" used across the redesigned panels to hold
// relocated-but-not-removed controls (Library import actions, Reader kit-select/status,
// Anchor + AI Chat overflow). A trigger button toggles a popover; clicking outside or the
// trigger closes it. Children are the menu body (rows/inputs/buttons) so each panel
// composes its own contents while sharing the open/close + styling.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";

const POPOVER_WIDTH = 260;
const ESTIMATED_HEIGHT = 360;
const VIEWPORT_MARGIN = 8;
const TRIGGER_GAP = 4;

export function PanelMenu({
  label,
  icon,
  children,
  align = "right",
  buttonClassName
}: {
  /** Accessible label for the trigger (e.g. "Library actions"). */
  label: string;
  /** Trigger glyph; defaults to the ⋯ horizontal dots. */
  icon?: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
  /** Extra class on the trigger button (stable hook for a specific menu, e.g. W2 "+"). */
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxHeight: number }>({
    top: 0,
    left: 0,
    width: POPOVER_WIDTH,
    maxHeight: ESTIMATED_HEIGHT
  });

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(POPOVER_WIDTH, Math.max(160, window.innerWidth - VIEWPORT_MARGIN * 2));
      const height = popoverRef.current?.offsetHeight || ESTIMATED_HEIGHT;
      const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);

      const rawLeft = align === "left" ? rect.left : rect.right - width;
      const left = Math.min(Math.max(VIEWPORT_MARGIN, rawLeft), maxLeft);

      const belowSpace = Math.max(96, window.innerHeight - rect.bottom - TRIGGER_GAP - VIEWPORT_MARGIN);
      const aboveSpace = Math.max(96, rect.top - TRIGGER_GAP - VIEWPORT_MARGIN);
      const openBelow = height <= belowSpace || belowSpace >= aboveSpace;
      const maxHeight = openBelow ? belowSpace : aboveSpace;
      const top = openBelow
        ? rect.bottom + TRIGGER_GAP
        : Math.max(VIEWPORT_MARGIN, rect.top - TRIGGER_GAP - Math.min(height, maxHeight));

      setPos({ top, left, width, maxHeight });
    };

    place();
    let raf2 = 0;
    const raf = requestAnimationFrame(() => {
      place();
      if (popoverRef.current) {
        // A second frame catches scrollbars/content wrapping after max-height lands.
        raf2 = requestAnimationFrame(place);
      }
    });
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      cancelAnimationFrame(raf);
      if (raf2) cancelAnimationFrame(raf2);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [align, open]);

  useEffect(() => {
    if (!open) return;
    const isInside = (target: Node) => {
      const insideTrigger = ref.current?.contains(target);
      const insidePopover = popoverRef.current?.contains(target);
      return !!insideTrigger || !!insidePopover;
    };
    const onPointerDown = (event: PointerEvent | MouseEvent) => {
      const target = event.target as Node;
      if (!isInside(target)) setOpen(false);
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as Node | null;
      if (target && !isInside(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("focusin", onFocusIn, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("focusin", onFocusIn, true);
    };
  }, [open]);

  return (
    <div className="panel-menu" ref={ref}>
      <button
        type="button"
        ref={triggerRef}
        className={`panel-menu-trigger${open ? " active" : ""}${buttonClassName ? ` ${buttonClassName}` : ""}`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((value) => !value)}
      >
        {icon ?? <MoreHorizontal size={16} />}
      </button>
      {open
        ? createPortal(
            <div
              className={`panel-menu-popover panel-menu-${align}`}
              ref={popoverRef}
              style={{
                position: "fixed",
                top: pos.top,
                left: pos.left,
                right: "auto",
                width: pos.width,
                maxHeight: pos.maxHeight,
                overflowY: "auto"
              }}
              // Close after a one-shot action item (a `.panel-menu-item` button) fires, but
              // keep the menu open for inline controls inside it (the Reader's kit <select>,
              // the relocated patch fold / terminal) so they stay usable while editing.
              onClick={(event) => {
                const target = event.target as HTMLElement;
                if (target.closest('.panel-menu-item, [data-panel-menu-close="true"]')) setOpen(false);
              }}
            >
              {children}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
