// PlatformProvider / usePlatform — the React seam for the platform adapter, mounted
// at the App composition root outside WorkspaceProvider so any domain or view can
// reach the host through context. Non-React helpers use the module singleton
// (platformSingleton.ts); components use usePlatform() here.
// See docs/implementation/platform-layering-build-spec.md §1.6.

import { createContext, useContext, type ReactNode } from "react";
import { desktopPlatform } from "./desktopPlatform";
import { webPlatform } from "./webPlatform";
import type { PlatformAdapter } from "./types";

// Choose the adapter for the current host: the Electron preload sets
// `window.studyVault.desktop`; its absence means a plain browser.
export function detectPlatform(): PlatformAdapter {
  return window.studyVault?.desktop ? desktopPlatform() : webPlatform();
}

const PlatformContext = createContext<PlatformAdapter | null>(null);

export function PlatformProvider({
  platform,
  children
}: {
  platform: PlatformAdapter;
  children: ReactNode;
}) {
  return (
    <PlatformContext.Provider value={platform}>
      {children}
    </PlatformContext.Provider>
  );
}

export function usePlatform(): PlatformAdapter {
  const value = useContext(PlatformContext);
  if (!value) {
    throw new Error("usePlatform must be used within a PlatformProvider");
  }
  return value;
}

export function usePlatformOptional(): PlatformAdapter | null {
  return useContext(PlatformContext);
}
