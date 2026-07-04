// Teach-back Kit commands — the launch command. `teachback.start` navigates the shell to
// the runner panel (the SHELL-1/2 nav bus), exactly like the global-search NAV_COMMANDS
// and the review-push trigger's actionRef:navigate→review.panel. It is register-only kit
// code (a host Command wired through KitInstallContext.commands); the palette surfacing
// is the commit-6 commandEntries NAV_COMMANDS one-liner.

import type { Command } from "../../client/commands/registry";
import { navigateShell } from "../../client/workspace/shellNav";

/** The registered view kind the runner panel self-registers (TeachbackPanel.tsx). */
export const TEACHBACK_PANEL_KIND = "teachback.panel";

export const teachbackStartCommand: Command = {
  id: "teachback.start",
  title: { zh: "开始教回", en: "Start Teach-back" },
  group: "teachback",
  // Always runnable — it just opens the panel (which self-loads a topic or the empty
  // state on a fresh vault, delta 5). No focus/source required.
  isAvailable: () => true,
  run: () => {
    navigateShell({ type: "pane", kind: TEACHBACK_PANEL_KIND });
  }
};
