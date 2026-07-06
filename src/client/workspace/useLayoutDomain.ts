// PLAT-LAYER Part-2 Slice 1 — the LAYOUT domain hook (a TIER-A leaf: it reads NO
// pipeline state). Extracted VERBATIM from WorkspaceContext.tsx: the `activeLayoutId`
// state, the `availableLayouts` preset list, and the `setActiveLayout` callback that
// persists the choice through the platform prefs seam (Part-1 landed) with a
// localStorage fallback.
//
// The surface is a `useMemo`-wrapped object so its identity is STABLE across unrelated
// provider re-renders (it only changes when `activeLayoutId` changes) — this is the
// memoized-surface contract the whole Part-2 split depends on: a fresh object literal
// each render would bust the provider's value memo and re-render all 25 consumers (the
// §A2 regression the render guard pins). Follows the proven `useChatSessions` reference.

import { useCallback, useMemo, useState } from "react";
import { getPlatformOptional } from "../platform";
import { LAYOUT_PRESETS, DEFAULT_LAYOUT_ID } from "./presets";

// Active dock layout preset id, persisted so the chosen layout sticks across reloads.
const ACTIVE_LAYOUT_KEY = "sv-active-layout";

function loadActiveLayout(): string {
  try {
    const prefs = getPlatformOptional()?.prefs;
    const raw = prefs ? prefs.get(ACTIVE_LAYOUT_KEY) : globalThis.localStorage?.getItem(ACTIVE_LAYOUT_KEY);
    return raw || DEFAULT_LAYOUT_ID;
  } catch {
    return DEFAULT_LAYOUT_ID;
  }
}

export interface LayoutDomain {
  activeLayoutId: string;
  availableLayouts: { id: string; name: string }[];
  setActiveLayout(id: string): void;
}

export function useLayoutDomain(): LayoutDomain {
  const [activeLayoutId, setActiveLayoutId] = useState<string>(loadActiveLayout);

  // —— workspace layout switching ——
  const availableLayouts = useMemo(
    () => LAYOUT_PRESETS.map((preset) => ({ id: preset.id, name: preset.name })),
    []
  );
  const setActiveLayout = useCallback((id: string) => {
    setActiveLayoutId(id);
    try {
      const prefs = getPlatformOptional()?.prefs;
      if (prefs) prefs.set(ACTIVE_LAYOUT_KEY, id);
      else globalThis.localStorage?.setItem(ACTIVE_LAYOUT_KEY, id);
    } catch {
      // storage unavailable — keep the in-memory choice
    }
  }, []);

  return useMemo<LayoutDomain>(
    () => ({ activeLayoutId, availableLayouts, setActiveLayout }),
    [activeLayoutId, availableLayouts, setActiveLayout]
  );
}
