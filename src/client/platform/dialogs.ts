// platformDialogs — the non-hook accessor for the platform's confirm/prompt/alert
// (PLAT-LAYER STEP-2, the dialogs funnel — sibling of entityClient.assetUrl). Scattered
// `window.confirm/prompt/alert` call sites route through here so a future mobile
// (Capacitor) platform can supply NATIVE dialogs without touching every call site.
//
// NON-hook by design: it works in components AND module-scope code with NO
// PlatformProvider dependency (existing component tests that never wrap in a provider
// keep working). The `?? window.*` fallback means BEFORE setPlatform() runs (unit tests)
// the behavior is exactly today's synchronous window.* — just promise-wrapped. On
// web/desktop the real adapters already wrap window.* (desktopPlatform/webPlatform
// `dialogs`), so runtime behavior is byte-identical.
//
// See docs/implementation/platform-layering-build-spec.md §1.5 and the assetUrl funnel
// in ../data/entityClient.ts.

import { getPlatformOptional } from "./platformSingleton";
import type { PlatformDialogs } from "./types";

export function platformDialogs(): PlatformDialogs {
  return (
    getPlatformOptional()?.dialogs ?? {
      confirm: (message: string) =>
        Promise.resolve(typeof window !== "undefined" ? window.confirm(message) : true),
      prompt: (message: string, defaultValue?: string) =>
        Promise.resolve(
          typeof window !== "undefined" ? window.prompt(message, defaultValue ?? "") : null
        ),
      alert: (message: string) => {
        if (typeof window !== "undefined") window.alert(message);
        return Promise.resolve();
      }
    }
  );
}
