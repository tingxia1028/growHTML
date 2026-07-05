// App is now just the composition root: FocusProvider (the selection/anchor kernel)
// wraps WorkspaceProvider (the shared workspace state + actions), and WorkspaceShell
// renders a layout's nodes through the ViewRegistry. There is NO panel JSX and NO
// per-surface reader branching here anymore — the three panels are registered views
// (src/client/workspace/views.tsx) and the source reader's surface switch lives in
// readerForSource. Adding a new view = register a plugin + add its node to a preset;
// zero edits to this file. See docs/design/workspace-runtime.md.

import { useEffect, type ReactNode } from "react";
import { entityClient } from "./data/entityClient";
import { FocusProvider } from "./focus/FocusContext";
import { LocaleProvider, setLocale } from "./i18n";
import { PlatformProvider, getPlatform } from "./platform";
import { WorkspaceProvider, useWorkspace } from "./workspace/WorkspaceContext";
import { WorkspaceShell } from "./workspace/WorkspaceShell";
import { getLayoutPreset } from "./workspace/presets";

function LocaleBootstrap({ children }: { children: ReactNode }) {
  useEffect(() => {
    let cancelled = false;
    void entityClient
      .uiPrefs()
      .then(({ prefs }) => {
        if (!cancelled) setLocale(prefs.locale);
      })
      .catch(() => {
        // LocalStorage/default locale still drives the UI when the server is unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return <>{children}</>;
}

// Reads the active layout preset id from the workspace context (the reader-header layout
// switcher writes it) and renders that preset. Kept inside the provider so switching
// layouts is just a context state change — no prop drilling from App.
function ActiveWorkspaceShell() {
  const { activeLayoutId } = useWorkspace();
  return <WorkspaceShell layout={getLayoutPreset(activeLayoutId)} />;
}

export default function App() {
  return (
    // ONE source of truth: reuse the singleton main.tsx set before createRoot (getPlatform),
    // NOT a 2nd detectPlatform() — that would mint a separate adapter instance so the non-hook
    // pref helpers (singleton) and components (context) could diverge, and re-detect every render.
    <PlatformProvider platform={getPlatform()}>
      <LocaleProvider>
        <LocaleBootstrap>
          <FocusProvider>
            <WorkspaceProvider>
              <ActiveWorkspaceShell />
            </WorkspaceProvider>
          </FocusProvider>
        </LocaleBootstrap>
      </LocaleProvider>
    </PlatformProvider>
  );
}
