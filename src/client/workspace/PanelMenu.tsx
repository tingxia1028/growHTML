// PanelMenu — a tiny shared "⋯ overflow menu" used across the redesigned panels to hold
// relocated-but-not-removed controls (Library import actions, Reader kit-select/status,
// Anchor + AI Chat overflow). A trigger button toggles a popover; clicking outside or the
// trigger closes it. Children are the menu body (rows/inputs/buttons) so each panel
// composes its own contents while sharing the open/close + styling.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";

export function PanelMenu({
  label,
  icon,
  children,
  align = "right"
}: {
  /** Accessible label for the trigger (e.g. "Library actions"). */
  label: string;
  /** Trigger glyph; defaults to the ⋯ horizontal dots. */
  icon?: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="panel-menu" ref={ref}>
      <button
        type="button"
        className={`panel-menu-trigger${open ? " active" : ""}`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((value) => !value)}
      >
        {icon ?? <MoreHorizontal size={16} />}
      </button>
      {open ? (
        <div
          className={`panel-menu-popover panel-menu-${align}`}
          // Close after a one-shot action item (a `.panel-menu-item` button) fires, but
          // keep the menu open for inline controls inside it (the Reader's kit <select>,
          // the relocated patch fold / terminal) so they stay usable while editing.
          onClick={(event) => {
            const target = event.target as HTMLElement;
            if (target.closest(".panel-menu-item")) setOpen(false);
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
