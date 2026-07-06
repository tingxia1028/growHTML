// shellIo — the WorkspaceShell first-run bootstrap read seam (PLAT-LAYER §2.5 Rule C).
// WorkspaceShell's SHELL-2 first-run detection reads the vault's source list (to test
// "fresh vault → auto-open the onboarding checklist"). It previously called
// `entityClient.sources()` inline (the paired `onboardingState()` read now flows through
// the existing onboardingIo.fetchState seam). This thin facade relocates the sources read
// out of the shell so it imports no entityClient at runtime. It is a LEAF module: it
// imports ONLY entityClient (+ the SourceRecord type its caller re-exports), never a
// view/workspace module, so it can never cycle with the workspace/ dir.
//
// BYTE-EQUIVALENT call-time pass-through — `(...args) => entityClient.sources(...args)` —
// so any spy/global-fetch stub on the entityClient seam still intercepts (WorkspaceShell's
// test stubs global fetch to reject; this read hits the same catch).

import { entityClient } from "../data/entityClient";

export type { SourceRecord } from "../data/entityClient";

export const shellIo = {
  sources: (...args: Parameters<typeof entityClient.sources>) => entityClient.sources(...args)
};
