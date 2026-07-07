// PLAT-LAYER Part-2 Slice 5 — the KIT domain hook (a TIER-C composer over the pipeline).
// Extracted VERBATIM from WorkspaceContext.tsx: the per-source `activeKitIds` resolver
// memo, the module-const `installedKits` list (imported from kits/clientContext — the
// activation dropdown's id+name pairs), and `setActiveKit` (whose inline
// entityClient.updateSourceMetadata → loadSources write moves in here). No functional
// change — the resolver still re-runs per active source and the setter still PUTs the
// pin then reloads sources so the foreground gate recomputes.
//
// INJECTED (read-only) DEPS — `useKitDomain({ activeSource, activeSourceId, loadSources,
// onError })`, all now sourced off the landed documents surface (`docs.*`):
//   • `activeSource` — the SourceRecord the foreground resolver reads (its metadata pin +
//     title/type feed the M-A auto-switch). `activeKitIds`' memo dep is exactly this.
//   • `activeSourceId` — the write target: `setActiveKit` no-ops without it, else pins
//     the kit on THAT source's metadata.
//   • `loadSources` — re-fetch sources after the pin so the foreground gate recomputes
//     (byte-identical to the pre-extraction `docs.loadSources()` await).
//   • `onError` — the decoupled error sink (the documents surface's `setError`); a
//     failed pin routes here exactly as the inline callback routed to `docs.setError`.
//
// THE SURFACE is a `useMemo`-wrapped object keyed on EXACTLY its three fields
// (activeKitIds / installedKits / setActiveKit) — the memoized-surface contract the whole
// Part-2 split depends on: a fresh object literal each render would bust the provider's
// value memo and re-render all 25 consumers. `activeKitIds` changes only when
// `activeSource` changes (matching the pre-extraction cadence); `installedKits` is a
// stable module const; `setActiveKit`'s identity tracks its injected deps. Follows the
// proven useChatSessions / useDocumentsDomain / useConceptDomain reference.

import { useCallback, useMemo } from "react";
import { entityClient, type SourceRecord } from "../data/entityClient";
import { activeKitIdsForSource, CORE_KIT_ID } from "../../kits/activation";
import { installedKits } from "../../kits/clientContext";

export interface KitDomain {
  // —— product kits (per-source activation) ——
  /** Effective kit ids for the active source (per-source activation). Recomputed from the
      active source's metadata; rendering is never gated by this. */
  activeKitIds: string[];
  /** Resolve effective kit ids for an arbitrary source. Split panes use this so each
      reader header reflects its own document rather than the globally focused one. */
  kitIdsForSource(source: SourceRecord | null): string[];
  /** Installed kits (id + display name + optional icon) for the activation dropdown. */
  installedKits: { id: string; name: string; icon?: string }[];
  /** Apply a kit to an explicit source id. Split panes use this instead of relying on
      focus having re-rendered before the select change handler runs. */
  setSourceKit(sourceId: string, kitId: string): Promise<void>;
  /** Apply a kit to the active source ("core" = none); persists to its metadata then
      reloads sources so the foreground gate recomputes. */
  setActiveKit(kitId: string): Promise<void>;
}

export function useKitDomain({
  activeSource,
  activeSourceId,
  loadSources,
  onError
}: {
  /** The active SourceRecord — the foreground resolver reads its metadata pin + title/type
      (from the documents surface). `activeKitIds`' memo dep is exactly this. */
  activeSource: SourceRecord | null;
  /** The write target for `setActiveKit` (from the documents surface). */
  activeSourceId: string;
  /** Re-fetch sources after a pin so the foreground gate recomputes (documents surface). */
  loadSources: () => Promise<void>;
  /** Decoupled error sink (the documents surface's `setError`) — a failed pin surfaces here. */
  onError: (message: string) => void;
}): KitDomain {
  // Effective kit ids for the active source (per-source activation). Recomputed from
  // the active source's metadata; rendering is never gated by this.
  const kitIdsForSource = useCallback((source: SourceRecord | null) => activeKitIdsForSource(source), []);
  const activeKitIds = useMemo(() => kitIdsForSource(activeSource), [activeSource, kitIdsForSource]);

  const setSourceKit = useCallback(
    async (sourceId: string, kitId: string) => {
      if (!sourceId) return;
      const nextKitIds = kitId === CORE_KIT_ID ? [] : [kitId];
      try {
        await entityClient.updateSourceMetadata(sourceId, { activeKitIds: nextKitIds });
        await loadSources();
      } catch (err) {
        onError(err instanceof Error ? err.message : "Failed to set kit");
      }
    },
    [loadSources, onError]
  );

  // Apply a Product Kit to the active source ("core" = none). Persists to
  // source.metadata.activeKitIds, then reloads sources so the gate recomputes.
  const setActiveKit = useCallback(
    async (kitId: string) => {
      await setSourceKit(activeSourceId, kitId);
    },
    [activeSourceId, setSourceKit]
  );

  return useMemo<KitDomain>(
    () => ({
      activeKitIds,
      kitIdsForSource,
      installedKits,
      setSourceKit,
      setActiveKit
    }),
    [activeKitIds, kitIdsForSource, setSourceKit, setActiveKit]
  );
}
