// Shell navigation bus (SHELL-1/SHELL-2) — the tiny module-scope seam that lets
// registered views and shell chrome (user menu, settings sections, onboarding steps)
// ask the WorkspaceShell to swap panes WITHOUT growing WorkspaceContext or reaching
// into the shell (IRON LAW). Same push idiom as the kit install-state store and the
// context's registerOpenOperationManager: the shell registers ONE navigator handler
// while mounted; callers fire-and-forget through `navigateShell`.

export type ShellNavTarget =
  /** Show a registered view-kind in the switchable LEFT rail slot (IconRail idiom). */
  | { type: "pane"; kind: string }
  /** Open/close the onboarding checklist in the CENTER slot (SHELL-2). */
  | { type: "onboarding"; open: boolean };

type ShellNavigator = (target: ShellNavTarget) => void;

let navigator: ShellNavigator | null = null;

/** WorkspaceShell registers its handler on mount (null on unmount). Last one wins. */
export function registerShellNavigator(fn: ShellNavigator | null): void {
  navigator = fn;
}

/**
 * Ask the shell to navigate. Returns whether a shell was listening — standalone
 * mounts (jsdom tests without a shell) get `false` and nothing throws.
 */
export function navigateShell(target: ShellNavTarget): boolean {
  if (!navigator) return false;
  navigator(target);
  return true;
}
