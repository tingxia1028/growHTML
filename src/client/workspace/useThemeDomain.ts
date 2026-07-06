// PLAT-LAYER Part-2 Slice 1 — the THEME domain hook (a TIER-A leaf, strict SIBLING of
// useLayoutDomain: it never reads `activeLayoutId` nor any pipeline state). Extracted
// VERBATIM from WorkspaceContext.tsx: the `activeThemeId` state, the `availableThemes`
// registry list, and the `setActiveTheme` callback that flips <html data-theme> via
// `applyActiveTheme` and persists the choice through the platform prefs seam (Part-1
// landed) with a localStorage fallback.
//
// The side-effect import populates the theme registry before `listThemes()` runs at hook
// mount (mirroring the provider's prior import order). The surface is a `useMemo`-wrapped
// object so its identity is STABLE across unrelated provider re-renders (it only changes
// when `activeThemeId` changes) — the memoized-surface contract the Part-2 split depends
// on. Follows the proven `useChatSessions` reference.

import { useCallback, useMemo, useState } from "react";
import { getPlatformOptional } from "../platform";
import "../theme/builtins";
import { DEFAULT_THEME_ID } from "../theme/builtins";
import { listThemes } from "../theme/registry";
import { setActiveTheme as applyActiveTheme, THEME_STORAGE_KEY } from "../theme/applyTheme";

// Active theme id, persisted so the chosen skin sticks across reloads (V1: localStorage,
// the same precedent as the layout id). Orthogonal to layout — separate key.
function loadActiveTheme(): string {
  try {
    const prefs = getPlatformOptional()?.prefs;
    const raw = prefs ? prefs.get(THEME_STORAGE_KEY) : globalThis.localStorage?.getItem(THEME_STORAGE_KEY);
    return raw || DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

export interface ThemeDomain {
  activeThemeId: string;
  availableThemes: { id: string; name: string }[];
  setActiveTheme(id: string): void;
}

export function useThemeDomain(): ThemeDomain {
  const [activeThemeId, setActiveThemeId] = useState<string>(loadActiveTheme);

  // —— theme switching (sibling of layout) ——
  const availableThemes = useMemo(
    () => listThemes().map((theme) => ({ id: theme.id, name: theme.name })),
    []
  );
  const setActiveTheme = useCallback((id: string) => {
    setActiveThemeId(id);
    applyActiveTheme(id); // flips <html data-theme> + color-scheme — the whole-app re-skin
    try {
      const prefs = getPlatformOptional()?.prefs;
      if (prefs) prefs.set(THEME_STORAGE_KEY, id);
      else globalThis.localStorage?.setItem(THEME_STORAGE_KEY, id);
    } catch {
      // storage unavailable — keep the in-memory choice
    }
  }, []);

  return useMemo<ThemeDomain>(
    () => ({ activeThemeId, availableThemes, setActiveTheme }),
    [activeThemeId, availableThemes, setActiveTheme]
  );
}
