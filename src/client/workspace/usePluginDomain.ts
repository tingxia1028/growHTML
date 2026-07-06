// PLAT-LAYER Part-2 Slice 2 — the PLUGIN domain hook (a TIER-A leaf: it reads NO
// pipeline state). Extracted VERBATIM from WorkspaceContext.tsx: the read-only
// `installedPlugins` snapshot (from the registry `listInstalledPlugins()` populated at
// install), the `pluginPrefs` state + its mount-load effect, and the two write seams
// `setContributionEnabled` (disabled-contribution toggle) and `pinViewer` (the explicit
// viewer-pin tier of the exclusive resolver). All three of the provider's inline
// `entityClient.pluginPrefs()`/`.putPluginPrefs()` sites move in here — progress toward the
// provider "only-composes" acceptance.
//
// The mount-load effect keeps its EXACT `[]` dep-array and the ORDER of
// `setPluginPrefs(prefs)` → `setDisabledContributions(prefs.disabledContributions)` so the
// clientContext disabled set hydrates identically from the first render. Unlike the
// localStorage-backed layout/theme siblings, the two write seams persist through an ASYNC
// `entityClient.putPluginPrefs` call, so a persistence FAILURE is surfaced via the injected
// `onError` reporter — byte-for-byte the provider's prior `setError(...)` behavior (a leaf
// still: `onError` is a decoupled error sink, not pipeline state).
//
// The surface is a `useMemo`-wrapped object so its identity is STABLE across unrelated
// provider re-renders (it only changes when one of its 4 fields changes) — the
// memoized-surface contract the whole Part-2 split depends on: a fresh object literal each
// render would bust the provider's value memo and re-render all 25 consumers. Follows the
// proven `useChatSessions` / `useLayoutDomain` reference.

import { useCallback, useEffect, useMemo, useState } from "react";
import { setDisabledContributions } from "../../kits/clientContext";
import { listInstalledPlugins, type PluginRecord } from "../../kits/plugin";
import { entityClient, type PluginPrefs } from "../data/entityClient";

const EMPTY_PLUGIN_PREFS: PluginPrefs = {
  disabledContributions: [],
  viewerAssociations: { byContentType: {}, byNoteId: {} },
  userKits: []
};

export interface PluginDomain {
  installedPlugins: readonly PluginRecord[];
  pluginPrefs: PluginPrefs;
  setContributionEnabled(contributionId: string, enabled: boolean): void;
  pinViewer(target: { contentType?: string; noteId?: string }, viewerId: string): void;
}

export function usePluginDomain({ onError }: { onError: (message: string) => void }): PluginDomain {
  // Kit & Plugin: the per-vault prefs (disabled contribution ids + declared P3/P4 slots).
  // Loaded once on mount; the disabled set is pushed into the clientContext module setter
  // so surface/command filtering reflects it. The installed plugins are read from the
  // registry (populated at install), snapshotted so a toggle re-renders consumers.
  const [pluginPrefs, setPluginPrefs] = useState<PluginPrefs>(EMPTY_PLUGIN_PREFS);
  const [installedPlugins] = useState<readonly PluginRecord[]>(() => listInstalledPlugins());

  // Load the Kit & Plugin prefs on mount and push the disabled set into the clientContext
  // module setter, so surface/command filtering reflects the user's toggles from the first
  // render. Additive + best-effort: a failure leaves nothing disabled (the panel + toolbars
  // still work). No version token — the panel mutates prefs through setContributionEnabled,
  // which updates state directly.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { prefs } = await entityClient.pluginPrefs();
        if (cancelled) return;
        setPluginPrefs(prefs);
        setDisabledContributions(prefs.disabledContributions);
      } catch {
        // plugin prefs are additive — keep the panel + toolbars working with nothing disabled
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The single WRITE seam for the Kit & Plugin manager (IRON LAW): merge one contribution
  // id into/out of `disabledContributions`, push the next disabled set into the
  // clientContext module setter (so surface/command filtering updates immediately), update
  // local state (so the panel re-renders its toggle), and PUT the next prefs. Mirrors
  // saveActionPrefs — the panel never calls entityClient directly.
  const setContributionEnabled = useCallback(
    (contributionId: string, enabled: boolean) => {
      setPluginPrefs((prev) => {
        const set = new Set(prev.disabledContributions);
        if (enabled) set.delete(contributionId);
        else set.add(contributionId);
        const nextDisabled = Array.from(set);
        const next: PluginPrefs = { ...prev, disabledContributions: nextDisabled };
        setDisabledContributions(nextDisabled);
        void entityClient.putPluginPrefs(next).catch((err) => {
          onError(err instanceof Error ? err.message : "Failed to save plugin prefs");
        });
        return next;
      });
    },
    [onError]
  );

  // Viewer pin — the user-explicit-association tier of the exclusive viewer resolver
  // (plugin-viewer-model §4). Merge the (target → viewerId) association into
  // viewerAssociations.byNoteId or byContentType, update local state (so the resolver +
  // panel re-render), and PUT the next prefs. Mirrors setContributionEnabled: the note
  // "Open with…" control and the manager panel's conflict picker call this; neither
  // touches entityClient directly. A note pin (noteId) and a type pin (contentType) can
  // both be set in one call; each honored where present.
  const pinViewer = useCallback(
    (target: { contentType?: string; noteId?: string }, viewerId: string) => {
      setPluginPrefs((prev) => {
        const associations = prev.viewerAssociations ?? { byContentType: {}, byNoteId: {} };
        const byContentType = { ...associations.byContentType };
        const byNoteId = { ...associations.byNoteId };
        if (target.noteId) byNoteId[target.noteId] = viewerId;
        if (target.contentType) byContentType[target.contentType] = viewerId;
        const next: PluginPrefs = { ...prev, viewerAssociations: { byContentType, byNoteId } };
        void entityClient.putPluginPrefs(next).catch((err) => {
          onError(err instanceof Error ? err.message : "Failed to save viewer association");
        });
        return next;
      });
    },
    [onError]
  );

  return useMemo<PluginDomain>(
    () => ({ installedPlugins, pluginPrefs, setContributionEnabled, pinViewer }),
    [installedPlugins, pluginPrefs, setContributionEnabled, pinViewer]
  );
}
