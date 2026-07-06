// PLAT-LAYER Part-2 Slice 4b — the DOCUMENTS domain hook (the XL CORE, ONE unit). This
// is the TIER-B cluster: panes ↔ sourceBundles ↔ activeSourceId ↔ top-level reader state.
// The "cycle" is ORCHESTRATION, not data (panes owns activeSourceId, but the bundles + the
// top-level reader state react to it via effects that ALSO write panes, and
// refreshAnnotations reads activeSourceId+sourceBundles while writing BOTH), so it CANNOT
// be sub-split without threading setters across hook boundaries — it is extracted as one
// hook. See docs/implementation/part-2-workspacecontext-split-plan.md §2 (TIER-B / slice 4).
//
// Extracted VERBATIM from WorkspaceContext.tsx (no functional change):
//   • STATE: status/error, sources, the open-panes model (openPanes/focusedPaneId/
//     focusedPaneIdRef + setActiveSourceId/openSourceInNewPane/focusPaneById/closePaneById),
//     sourceBundles, the top-level reader state (renderedHtml/anchors/notes/patches/
//     sourceLayers), recentSourceIds, folderRoots, importUrl, layersVersion, annotationMode.
//   • DERIVED SELECTORS: activeSourceId (from the focused pane), activeSource, activeFilePath,
//     sourceForPane, recentSources, activeViewer, visibleAnchors, enabledLayerIds,
//     visibleNotes, focusedPaint/paintAnchors/revealAnchors, paintAnchorsForPane,
//     renderedHtmlForPane, activePatches.
//   • CALLBACKS (all the fetch/mutation IO): rememberSourceId/forgetSourceId, folder roots,
//     loadSources, fetchSourceBundle, mirrorBundleToTopLevel, loadSourceWorkspace,
//     loadPaneBundle, reloadActiveSource, refreshAnnotations, importFromUrl/openLiveUrl/
//     openLocalFile, importXmindFromPath, openFileDialog/openFolderDialog, deleteSourceItem,
//     changePatchStatus, forkActiveSource/canForkActiveSource, refreshLayers/toggleLayerFilter/
//     setLayersEnabled, setAnnotationMode. The ~17 entityClient sites these use move WITH them.
//   • The 5 documents-owned EFFECTS (loadSources on mount, rememberSourceId on id change, the
//     focused-source load, the per-pane background load, persist-panes), each with its EXACT
//     dep-array + ordering preserved.
//
// INJECTED (read-only) DEPS — `useDocumentsDomain({ focus, parkDraft })`:
//   • `focus` (from the provider's useFocus()): focus.clear() / focus.materializeAnchor() /
//     focus.draft / focus.anchor. Passed in so the hook does not re-subscribe.
//   • `parkDraft` (the generation-cluster's stable park-a-draft callback): used by
//     importXmindFromPath. INVESTIGATED: parkDraft has `[]` deps and reads only generation
//     state (setPendingDraft/setPendingDraftRect + a ref + a DOM read) — it does NOT depend
//     on any documents output, so injecting it introduces NO circular hook dependency. All
//     THREE parkDraft-consuming callbacks that ARE documents (importXmindFromPath) move into
//     the hook; changePatchStatus/forkActiveSource read no parkDraft and move in cleanly too.
//
// COORDINATOR SEAMS: the provider's still-in-body coordinator (commandContext / dispatch /
// generation cluster, plus the kit/operation slices) reads documents fields through the
// returned surface (docs.activeSourceId / docs.sources / docs.refreshAnnotations /
// docs.loadSources / docs.openSourceInNewPane / docs.setError / docs.importXmindFromPath …),
// so those internal-but-consumed callbacks ride on the surface even though a few aren't in
// the public WorkspaceContextValue (harmless extras, mirroring the concept surface's
// bumpConceptsVersion/notifyConceptMarked seams).
//
// THE SURFACE is a `useMemo`-wrapped object keyed on EVERY field it exposes — the
// memoized-surface contract the whole Part-2 split depends on: a fresh object literal each
// render would bust the provider's value memo and re-render all 25 consumers. Follows the
// proven useChatSessions / useLayoutDomain / usePluginDomain / useConceptDomain reference.
// refreshAnnotations keeps its EXACT pre-existing (non-memo-stable) cadence — its deps
// [activeSourceId, sourceBundles, renderedHtml, mirrorBundleToTopLevel] are preserved as-is.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  entityClient,
  type AnyAnchor,
  type NoteRecord,
  type PatchRecord,
  type SourceRecord,
  type StudyLayerRecord
} from "../data/entityClient";
import type { FocusContextValue } from "../focus/FocusContext";
import { getPlatformOptional, platformDialogs } from "../platform";
import { getSourceViewer, type SourceViewer } from "../viewers";
import type { PaintAnchor } from "../surfaces/types";
import type { GeneratedDraft } from "../commands/registry";
import {
  closePane,
  focusPane,
  focusedPane,
  openOrFocusPane,
  persistPanes,
  prunePanes,
  readStoredPanes,
  switchFocusedPane,
  type OpenPane
} from "./panes";
import { getBundle, hasBundle, pruneBundles, putBundle, type SourceBundle } from "./sourceBundles";
import { buildPaintPipeline } from "./paneSelectors";
import { getSourceAuthoringIo, isForkableImportedSource } from "./sourceAuthoringIo";
import { DEFAULT_ANNOTATION_MODE, type HtmlAnnotationMode } from "../annotations";
import { mergeFocusedAnchor } from "./WorkspaceContext";

export type Status = "idle" | "loading" | "saving" | "error";

const RECENT_SOURCE_IDS_KEY = "sv-recent-source-ids";

function readStoredRecentSourceIds(): string[] {
  try {
    const prefs = getPlatformOptional()?.prefs;
    const raw = prefs ? prefs.get(RECENT_SOURCE_IDS_KEY) : globalThis.localStorage?.getItem(RECENT_SOURCE_IDS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function persistRecentSourceIds(ids: string[]): void {
  try {
    const prefs = getPlatformOptional()?.prefs;
    if (prefs) prefs.set(RECENT_SOURCE_IDS_KEY, JSON.stringify(ids));
    else globalThis.localStorage?.setItem(RECENT_SOURCE_IDS_KEY, JSON.stringify(ids));
  } catch {
    // storage unavailable - keep the in-memory order
  }
}

// Opened "Open Folder" tree roots — persisted (mirroring recentSourceIds above) so the
// folders the user opened in the Library survive a restart instead of resetting to [].
const FOLDER_ROOTS_KEY = "sv-folder-roots";

function readStoredFolderRoots(): string[] {
  try {
    const prefs = getPlatformOptional()?.prefs;
    const raw = prefs ? prefs.get(FOLDER_ROOTS_KEY) : globalThis.localStorage?.getItem(FOLDER_ROOTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((root): root is string => typeof root === "string") : [];
  } catch {
    return [];
  }
}

function persistFolderRoots(roots: string[]): void {
  try {
    const prefs = getPlatformOptional()?.prefs;
    if (prefs) prefs.set(FOLDER_ROOTS_KEY, JSON.stringify(roots));
    else globalThis.localStorage?.setItem(FOLDER_ROOTS_KEY, JSON.stringify(roots));
  } catch {
    // storage unavailable - keep the in-memory roots
  }
}

function normalizeFolderRoot(root: string): string {
  return root.trim().replace(/[\\/]+$/, "");
}

/** The memoized surface the provider spreads into its value + the coordinator reads
    documents fields off. Every PUBLIC WorkspaceContextValue documents field is here, plus a
    handful of internal callbacks the still-in-provider coordinator consumes (setError /
    refreshAnnotations / importXmindFromPath) — harmless extras no context consumer reads. */
export interface DocumentsSurface {
  // —— status ——
  status: Status;
  error: string;
  /** Coordinator seams: the still-in-provider dispatch / generation / kit callbacks set the
      shared busy/error state through these (status/error own the workspace's busy indicator).
      Not on the public value surface. */
  setStatus(status: Status): void;
  setError(message: string): void;
  // —— sources ——
  sources: SourceRecord[];
  recentSources: SourceRecord[];
  activeSourceId: string;
  activeSource: SourceRecord | null;
  activeViewer: SourceViewer;
  setActiveSourceId(id: string): void;
  openSourceInNewPane(id: string): void;
  openPanes: OpenPane[];
  focusedPaneId: string;
  focusPane(paneId: string): void;
  closePane(paneId: string): void;
  sourceForPane(paneId: string): SourceRecord | null;
  paintAnchorsForPane(sourceId: string): { paintAnchors: PaintAnchor[]; revealAnchors: PaintAnchor[] };
  renderedHtmlForPane(sourceId: string): string;
  loadSources(): Promise<void>;
  deleteSourceItem(sourceId: string, title: string): Promise<void>;
  removeRecentSourceId(sourceId: string): void;
  reloadActiveSource(): Promise<void>;
  /** Coordinator seam: re-fetch anchors/notes/patches/layers after a mutation (mirror only
      when the refreshed source is the focused one). Not on the public value surface. */
  refreshAnnotations(sourceId?: string): Promise<void>;
  // —— reader data ——
  renderedHtml: string;
  anchors: AnyAnchor[];
  notes: NoteRecord[];
  patches: PatchRecord[];
  paintAnchors: PaintAnchor[];
  revealAnchors: PaintAnchor[];
  activePatches: PatchRecord[];
  annotationMode: HtmlAnnotationMode;
  setAnnotationMode(mode: HtmlAnnotationMode): void;
  // —— opening / importing ——
  folderRoots: string[];
  closeFolderRoot(root: string): void;
  activeFilePath: string | undefined;
  importUrl: string;
  setImportUrl(url: string): void;
  openLocalFile(filePath: string): Promise<void>;
  openFileDialog(): Promise<void>;
  openFolderDialog(): Promise<void>;
  importFromUrl(): Promise<void>;
  openLiveUrl(): Promise<void>;
  /** Coordinator seam: the path half of the .xmind import (openFileDialog routes here, and
      importXmindFile — which stays in the provider — delegates to it). Not a value field. */
  importXmindFromPath(filePath: string): Promise<void>;
  // —— patches / fork ——
  changePatchStatus(patch: PatchRecord, nextStatus: "applied" | "reverted" | "rejected"): Promise<void>;
  canForkActiveSource: boolean;
  forkActiveSource(): Promise<void>;
  // —— study layers ——
  layersVersion: number;
  refreshLayers(): void;
  sourceLayers: StudyLayerRecord[];
  enabledLayerIds: Set<string>;
  visibleNotes: NoteRecord[];
  setLayersEnabled(layerIds: string[], enabled: boolean): Promise<void>;
}

export function useDocumentsDomain({
  focus,
  parkDraft,
  resetReaderDraftInputs
}: {
  /** The shared kernel focus (from the provider's useFocus()). Read-only here. */
  focus: FocusContextValue;
  /** The generation cluster's stable park-a-draft callback (importXmindFromPath consumes
      it). Stable + documents-independent → injecting it is not circular. */
  parkDraft: (draft: GeneratedDraft) => void;
  /** The SOURCE-SWITCH reset of the COORDINATOR-owned reader draft inputs (patchHtml +
      chatInput) — `setPatchHtml("")` + `setChatInput("")` in the original loadSourceWorkspace
      / focused-source effect. Those two state atoms stay in the provider (composer/patch,
      slice 7), so this reset is injected as a STABLE (`[]`-deps) coordinator callback and
      called at the EXACT original points (after mirror on a fresh load; inline on a cached
      re-focus) — preserving both timing AND the error-path behavior (a fetch failure never
      reaches the reset). It reads no documents output → not circular. */
  resetReaderDraftInputs: () => void;
}): DocumentsSurface {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [sources, setSources] = useState<SourceRecord[]>([]);
  // F1 (P-A1): the open-panes model. `activeSourceId` is no longer a useState — it is
  // DERIVED from the focused pane (the back-compat shim, below), so every single-pane
  // caller keeps reading the same string while the workspace grows to multiple panes.
  // Seeded from localStorage (mirrors recentSourceIds) so the open docs + focus survive a
  // reload; reconciled against the live sources list on first loadSources (delta 4 prune).
  const [openPanes, setOpenPanes] = useState<OpenPane[]>(() => readStoredPanes().openPanes);
  const [focusedPaneId, setFocusedPaneId] = useState<string>(() => readStoredPanes().focusedPaneId);
  // Always-current focus id so the stable-deps callbacks (loadSources has []) read the
  // live value instead of a captured stale one.
  const focusedPaneIdRef = useRef(focusedPaneId);
  focusedPaneIdRef.current = focusedPaneId;
  // F1 (P-A1 §A.1): the per-source reader-data cache — filled when a pane opens, reused
  // across panes/refocus. The FOCUSED pane's bundle is mirrored into the top-level
  // anchors/notes/patches/sourceLayers/renderedHtml state so the 8 per-source memos keep
  // deriving unchanged. Each pane's own bundle feeds its reader in P-A2.
  const [sourceBundles, setSourceBundles] = useState<Map<string, SourceBundle>>(() => new Map());
  const currentFocusedPane = focusedPane(openPanes, focusedPaneId);
  const activeSourceId = currentFocusedPane?.sourceId ?? "";
  // `setActiveSourceId(id)` → open-or-focus a pane for that source (the shim). id==="" is
  // "no doc" → close the currently focused pane (VERIFIED: the only two "" call sites are
  // the reader tab-close and deleteSourceItem, both meaning "close the active document").
  // The shim: a library-row click / ingest focus. SWITCH semantics — it replaces the
  // focused pane's source (single tab preserved, byte-identical to the pre-F1 "one active
  // source" UX) or focuses an already-open pane. id==="" closes the focused pane (the
  // reader tab-close / deleteSourceItem "no doc" signal). Opening a SECOND concurrent doc
  // is the explicit `openSourceInNewPane` entry (below), so the single-pane path is intact.
  const setActiveSourceId = useCallback((id: string) => {
    setOpenPanes((panes) => {
      const state = { openPanes: panes, focusedPaneId: focusedPaneIdRef.current };
      const focused = focusedPane(panes, focusedPaneIdRef.current);
      const next = id ? switchFocusedPane(state, id) : closePane(state, focused?.paneId ?? "");
      setFocusedPaneId(next.focusedPaneId);
      return next.openPanes;
    });
  }, []);
  // Open a source in a NEW pane (multi-document): add a tab (or focus if already open),
  // never replacing the focused pane. The explicit multi-doc entry (Ctrl/Cmd-click a
  // library row, "open to the side").
  const openSourceInNewPane = useCallback((id: string) => {
    setOpenPanes((panes) => {
      const next = openOrFocusPane({ openPanes: panes, focusedPaneId: focusedPaneIdRef.current }, id);
      setFocusedPaneId(next.focusedPaneId);
      return next.openPanes;
    });
  }, []);
  // Focus a pane (any pane click / selection routes here first — focus-follows-pane).
  const focusPaneById = useCallback((paneId: string) => {
    setOpenPanes((panes) => {
      const next = focusPane({ openPanes: panes, focusedPaneId: focusedPaneIdRef.current }, paneId);
      setFocusedPaneId(next.focusedPaneId);
      return next.openPanes;
    });
  }, []);
  // Close a pane (tab-strip ×). Focus flips to the neighbour that took its slot.
  const closePaneById = useCallback((paneId: string) => {
    setOpenPanes((panes) => {
      const next = closePane({ openPanes: panes, focusedPaneId: focusedPaneIdRef.current }, paneId);
      setFocusedPaneId(next.focusedPaneId);
      return next.openPanes;
    });
  }, []);
  const [renderedHtml, setRenderedHtml] = useState("");
  const [anchors, setAnchors] = useState<AnyAnchor[]>([]);
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [patches, setPatches] = useState<PatchRecord[]>([]);
  // The active source's layers (the lens axis). Loaded with anchors/notes so the note
  // OR-filter and the per-note layer chips can read them without their own fetch.
  const [sourceLayers, setSourceLayers] = useState<StudyLayerRecord[]>([]);
  const [importUrl, setImportUrl] = useState("");
  const [folderRoots, setFolderRoots] = useState<string[]>(readStoredFolderRoots);
  const [recentSourceIds, setRecentSourceIds] = useState<string[]>(readStoredRecentSourceIds);
  // Note-presentation mode for the DOM HTML reader. Pinned to the "margin" default
  // (the "floating"/Document tab was removed 2026-07-04 — see TopBar.tsx); the setter
  // keeps the field for the context surface but the value never leaves "margin".
  const [annotationMode, setAnnotationModeState] = useState<HtmlAnnotationMode>(DEFAULT_ANNOTATION_MODE);
  const [layersVersion, setLayersVersion] = useState(0);

  const activeFilePath =
    (sources.find((source) => source.id === activeSourceId)?.metadata?.originalPath as string | undefined) ?? undefined;

  const activeSource = sources.find((source) => source.id === activeSourceId) ?? null;
  // The SourceRecord a pane shows — resolve the pane's sourceId against the sources list.
  const sourceForPane = useCallback(
    (paneId: string): SourceRecord | null => {
      const pane = openPanes.find((item) => item.paneId === paneId);
      return pane ? (sources.find((source) => source.id === pane.sourceId) ?? null) : null;
    },
    [openPanes, sources]
  );
  const recentSources = useMemo(() => {
    const byId = new Map(sources.map((source) => [source.id, source]));
    const ordered = recentSourceIds.map((id) => byId.get(id)).filter((source): source is SourceRecord => !!source);
    const seen = new Set(ordered.map((source) => source.id));
    return [...ordered, ...sources.filter((source) => !seen.has(source.id))];
  }, [sources, recentSourceIds]);
  const activeViewer = getSourceViewer(activeSource?.sourceType);
  const selectedAnchorId = focus.anchor?.id ?? "";
  // Server anchor lists are intentionally note-backed so historical no-note anchors
  // do not repaint. The current focused anchor is different: it may have just been
  // materialized and not yet returned by the note-backed refresh. Merge it in so the
  // reader can immediately show/reveal the marker for the active passage.
  const visibleAnchors = useMemo(
    () => mergeFocusedAnchor(anchors, focus.anchor, activeSourceId),
    [anchors, focus.anchor, activeSourceId]
  );

  // The enabled-layer set — the multi-select filter's "on" set. Driven off each
  // layer's stored `enabled` flag (the same source of truth the server filters by, so
  // the client and server agree on which notes/anchors show).
  const enabledLayerIds = useMemo(
    () => new Set(sourceLayers.filter((layer) => layer.enabled).map((layer) => layer.id)),
    [sourceLayers]
  );

  // The OR filter (layer-as-lens): a note shows iff its layerIds intersect the enabled
  // set, OR it has no layers (never orphaned — mirrors the server's empty="always
  // visible" rule). Everything the views render — the note list, the painted note text —
  // derives from this filtered list rather than the raw `notes`.
  const visibleNotes = useMemo(
    () =>
      notes.filter(
        (note) => note.layerIds.length === 0 || note.layerIds.some((id) => enabledLayerIds.has(id))
      ),
    [notes, enabledLayerIds]
  );

  // The FOCUSED pane's paint + reveal lists. Extracted into the pure `buildPaintPipeline`
  // (paneSelectors.ts) so this call reproduces the old paintAnchors/revealAnchors
  // BYTE-FOR-BYTE (the regression lock — same visibleAnchors/notes/sourceLayers/enabled
  // inputs → same output) AND each open reader pane can run the same builder on ITS OWN
  // bundle to paint its own source (P-A2). `paintAnchorsForPane` (below) is that per-pane
  // entry. paintAnchors excludes bookmark-only anchors; revealAnchors keeps all.
  const focusedPaint = useMemo(
    () => buildPaintPipeline({ visibleAnchors, notes, sourceLayers, enabledLayerIds }),
    [visibleAnchors, notes, sourceLayers, enabledLayerIds]
  );
  const paintAnchors = focusedPaint.paintAnchors;
  const revealAnchors = focusedPaint.revealAnchors;

  // P-A2: compute a NON-focused pane's own paint + reveal lists from its cached bundle,
  // under the single global focused-pane layer lens (delta 2: no per-pane Layer Lens in
  // V1). The focused pane reads the memos above; a background pane calls this with its
  // sourceId. A shared cross-source note paints in BOTH panes because it appears in each
  // source's own `notes` (via its anchors in that source).
  const paintAnchorsForPane = useCallback(
    (sourceId: string): { paintAnchors: PaintAnchor[]; revealAnchors: PaintAnchor[] } => {
      if (sourceId === activeSourceId) return focusedPaint;
      const bundle = getBundle(sourceBundles, sourceId);
      if (!bundle) return { paintAnchors: [], revealAnchors: [] };
      return buildPaintPipeline({
        visibleAnchors: bundle.anchors,
        notes: bundle.notes,
        sourceLayers: bundle.sourceLayers,
        enabledLayerIds
      });
    },
    [activeSourceId, focusedPaint, sourceBundles, enabledLayerIds]
  );
  // A pane's rendered HTML — the focused pane reads the top-level state (already mirrored),
  // a background pane reads its cached bundle.
  const renderedHtmlForPane = useCallback(
    (sourceId: string): string => {
      if (sourceId === activeSourceId) return renderedHtml;
      return getBundle(sourceBundles, sourceId)?.renderedHtml ?? "";
    },
    [activeSourceId, renderedHtml, sourceBundles]
  );
  const activePatches = useMemo(
    () => patches.filter((patch) => !selectedAnchorId || patch.anchorId === selectedAnchorId),
    [patches, selectedAnchorId]
  );

  const rememberSourceId = useCallback((sourceId: string) => {
    if (!sourceId) return;
    setRecentSourceIds((current) => {
      const next = [sourceId, ...current.filter((id) => id !== sourceId)].slice(0, 40);
      persistRecentSourceIds(next);
      return next;
    });
  }, []);

  const forgetSourceId = useCallback((sourceId: string) => {
    setRecentSourceIds((current) => {
      const next = current.filter((id) => id !== sourceId);
      persistRecentSourceIds(next);
      return next;
    });
  }, []);

  const addFolderRoot = useCallback((root: string) => {
    const normalized = normalizeFolderRoot(root);
    if (!normalized) return;
    const normalizedKey = normalized.toLocaleLowerCase();
    setFolderRoots((current) => {
      const next = current.some((item) => normalizeFolderRoot(item).toLocaleLowerCase() === normalizedKey)
        ? current
        : [...current, normalized];
      persistFolderRoots(next);
      return next;
    });
  }, []);

  const closeFolderRoot = useCallback((root: string) => {
    const normalizedKey = normalizeFolderRoot(root).toLocaleLowerCase();
    setFolderRoots((current) => {
      const next = current.filter((item) => normalizeFolderRoot(item).toLocaleLowerCase() !== normalizedKey);
      persistFolderRoots(next);
      return next;
    });
  }, []);

  const loadSources = useCallback(async () => {
    setStatus("loading");
    setError("");
    try {
      const response = await entityClient.sources();
      setSources(response.sources);
      // DELTA 4: reconcile the (possibly persisted) panes against the live sources —
      // drop every pane whose source no longer exists — THEN, if nothing is open,
      // default-open the first source (DELTA 1: the explicit first-load auto-open that
      // replaced the old `setActiveSourceId((c)=>c||sources[0]?.id)` functional updater).
      const liveIds = new Set(response.sources.map((source) => source.id));
      const firstSourceId = response.sources[0]?.id;
      setOpenPanes((panes) => {
        const pruned = prunePanes({ openPanes: panes, focusedPaneId: focusedPaneIdRef.current }, liveIds);
        const next =
          pruned.openPanes.length === 0 && firstSourceId
            ? openOrFocusPane(pruned, firstSourceId)
            : pruned;
        setFocusedPaneId(next.focusedPaneId);
        return next.openPanes;
      });
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sources");
      setStatus("error");
    }
  }, []);

  // Fetch a source's full reader data into a SourceBundle. Pure fetch (no state writes)
  // so both the focused-source load (mirror to top-level) and the background per-pane
  // load (cache only) share one network path.
  const fetchSourceBundle = useCallback(
    async (sourceId: string): Promise<SourceBundle> => {
      const sourceRecord = sources.find((item) => item.id === sourceId);
      const viewer = getSourceViewer(sourceRecord?.sourceType);
      const isLocalHtml = viewer.htmlPipeline && !!sourceRecord?.metadata?.originalPath;
      const [rendered, anchorsResponse, notesResponse, patchesResponse, layersResponse] = await Promise.all([
        viewer.htmlPipeline && !isLocalHtml ? entityClient.rendered(sourceId) : Promise.resolve(null),
        entityClient.anchors(sourceId),
        entityClient.notes(sourceId),
        entityClient.patches(sourceId),
        entityClient.layers(sourceId)
      ]);
      return {
        renderedHtml: rendered?.content ?? "",
        anchors: anchorsResponse.anchors,
        notes: notesResponse.notes,
        patches: patchesResponse.patches,
        sourceLayers: layersResponse.layers
      };
    },
    [sources]
  );

  // Mirror a bundle into the top-level anchors/notes/patches/sourceLayers/renderedHtml
  // state (the focused pane's data — every per-source memo derives from these).
  const mirrorBundleToTopLevel = useCallback((bundle: SourceBundle) => {
    setRenderedHtml(bundle.renderedHtml);
    setAnchors(bundle.anchors);
    setNotes(bundle.notes);
    setPatches(bundle.patches);
    setSourceLayers(bundle.sourceLayers);
  }, []);

  // Load (or reuse the cached) bundle for the FOCUSED source: fetch → cache → mirror to
  // top-level, plus the source-switch side effects (clear focus, reset the draft input).
  // On a re-focus onto an already-cached source the bundle is mirrored WITHOUT a refetch.
  const loadSourceWorkspace = useCallback(
    async (sourceId: string) => {
      setStatus("loading");
      setError("");
      try {
        const bundle = await fetchSourceBundle(sourceId);
        setSourceBundles((cache) => putBundle(cache, sourceId, bundle));
        mirrorBundleToTopLevel(bundle);
        focus.clear();
        // W1: the chat SESSION survives a source switch (ai-workspace §5 — switch/
        // attach, not wipe); only the reader draft inputs (patchHtml + chatInput) reset,
        // via the injected coordinator seam (those atoms stay in the provider).
        resetReaderDraftInputs();
        setStatus("idle");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load source");
        setStatus("error");
      }
    },
    [fetchSourceBundle, mirrorBundleToTopLevel, focus, resetReaderDraftInputs]
  );

  // Load a NON-focused pane's bundle into the cache only (no top-level mirror, no focus
  // reset) — the per-pane load effect calls this so a background pane paints its own
  // source without disturbing the focused pane's state.
  const loadPaneBundle = useCallback(
    async (sourceId: string) => {
      try {
        const bundle = await fetchSourceBundle(sourceId);
        setSourceBundles((cache) => putBundle(cache, sourceId, bundle));
      } catch {
        // A background pane's fetch failure is non-fatal — its reader shows empty until
        // the next refresh; the focused pane's load surfaces errors.
      }
    },
    [fetchSourceBundle]
  );

  // SRC-2: the authored editor's post-save refresh — a full workspace reload of the
  // ACTIVE source (rendered HTML changes on save, so refreshAnnotations isn't enough).
  const reloadActiveSource = useCallback(async () => {
    if (activeSourceId) await loadSourceWorkspace(activeSourceId);
  }, [activeSourceId, loadSourceWorkspace]);

  // Re-fetch anchors/notes/patches after a mutation that may have created a new anchor
  // (note/patch save), so the painted highlights and lists stay in sync — without
  // resetting the chat the way a full workspace reload would. Takes an explicit sourceId
  // (default: the focused/active source) so a mutation on ANY open pane's source refreshes
  // THAT pane's bundle; the top-level state only mirrors when the refreshed source is the
  // focused one (the per-source memos derive from it).
  const refreshAnnotations = useCallback(
    async (sourceId?: string) => {
      const targetId = sourceId ?? activeSourceId;
      if (!targetId) return;
      try {
        const [anchorsResponse, notesResponse, patchesResponse, layersResponse] = await Promise.all([
          entityClient.anchors(targetId),
          entityClient.notes(targetId),
          entityClient.patches(targetId),
          entityClient.layers(targetId)
        ]);
        const bundle: SourceBundle = {
          // Keep the cached renderedHtml — this refresh only re-reads annotations.
          renderedHtml: getBundle(sourceBundles, targetId)?.renderedHtml ?? renderedHtml,
          anchors: anchorsResponse.anchors,
          notes: notesResponse.notes,
          patches: patchesResponse.patches,
          sourceLayers: layersResponse.layers
        };
        setSourceBundles((cache) => putBundle(cache, targetId, bundle));
        if (targetId === activeSourceId) mirrorBundleToTopLevel(bundle);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to refresh");
      }
    },
    [activeSourceId, sourceBundles, renderedHtml, mirrorBundleToTopLevel]
  );

  const importFromUrl = useCallback(async () => {
    if (!importUrl.trim()) return;
    setStatus("saving");
    setError("");
    try {
      const response = await entityClient.ingestUrl(importUrl.trim());
      await loadSources();
      setActiveSourceId(response.source.id);
      setImportUrl("");
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import URL");
      setStatus("error");
    }
  }, [importUrl, loadSources, setActiveSourceId]);

  const openLiveUrl = useCallback(async () => {
    if (!importUrl.trim()) return;
    setStatus("saving");
    setError("");
    try {
      const response = await entityClient.ingestWebLive(importUrl.trim());
      await loadSources();
      setActiveSourceId(response.source.id);
      setImportUrl("");
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open live URL");
      setStatus("error");
    }
  }, [importUrl, loadSources, setActiveSourceId]);

  const openLocalFile = useCallback(
    async (filePath: string) => {
      setStatus("saving");
      setError("");
      try {
        const response = await entityClient.ingestLocalFile(filePath);
        await loadSources();
        setActiveSourceId(response.source.id);
        setStatus("idle");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to open file");
        setStatus("error");
      }
    },
    [loadSources, setActiveSourceId]
  );

  // The path half of the .xmind import (server unzip+parse → markmap outline parked in
  // the generation preview). Split from the dialog so the ONE Library 文件… picker can
  // route an already-picked path here (LIB-2 folds .xmind into the unified file import).
  const importXmindFromPath = useCallback(
    async (filePath: string) => {
      setStatus("saving");
      setError("");
      try {
        const anchor = await focus.materializeAnchor();
        const result = await entityClient.importXmind(filePath);
        parkDraft({
          promptId: "",
          contentType: result.contentType,
          input: {},
          content: result.content,
          anchorId: anchor?.id,
          sourceId: activeSourceId || undefined,
          classified: true
        });
        setStatus("idle");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to import .xmind");
        setStatus("error");
      }
    },
    [focus, activeSourceId, parkDraft]
  );

  // ONE file picker for every importable file (LIB-2): .xmind routes to the mind-map
  // import above, everything else ingests as a source. The native dialog has no
  // extension filter, so the split happens here by extension.
  const openFileDialog = useCallback(async () => {
    const filePath = await (getPlatformOptional()?.files.pickFile() ??
      (window.studyVault?.openFile?.() ?? Promise.resolve(null)));
    if (!filePath) return;
    if (/\.xmind$/i.test(filePath)) await importXmindFromPath(filePath);
    else await openLocalFile(filePath);
  }, [openLocalFile, importXmindFromPath]);

  const openFolderDialog = useCallback(async () => {
    const dir = await (getPlatformOptional()?.files.pickDirectory() ??
      (window.studyVault?.pickDirectory?.() ?? Promise.resolve(null)));
    if (dir) addFolderRoot(dir);
  }, [addFolderRoot]);

  const deleteSourceItem = useCallback(
    async (sourceId: string, title: string) => {
      if (!(await platformDialogs().confirm(`Remove "${title}"? This also deletes its notes and highlights.`))) {
        return;
      }
      setStatus("saving");
      setError("");
      try {
        await entityClient.deleteSource(sourceId);
        forgetSourceId(sourceId);
        // DELTA 4: drop EVERY open pane showing the deleted source (not just the focused
        // one), collapsing an emptied split/tab-group, and evict its cached bundle. When
        // the focused pane was one of them, the top-level state is cleared so the reader
        // shows empty until loadSources re-homes focus.
        const wasFocusedSource = activeSourceId === sourceId;
        setOpenPanes((panes) => {
          const live = new Set(panes.map((p) => p.sourceId).filter((id) => id !== sourceId));
          const next = prunePanes({ openPanes: panes, focusedPaneId: focusedPaneIdRef.current }, live);
          setFocusedPaneId(next.focusedPaneId);
          return next.openPanes;
        });
        setSourceBundles((cache) => pruneBundles(cache, new Set([...cache.keys()].filter((id) => id !== sourceId))));
        if (wasFocusedSource) {
          setRenderedHtml("");
          setNotes([]);
          setAnchors([]);
          setPatches([]);
          setSourceLayers([]);
        }
        await loadSources();
        setStatus("idle");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete source");
        setStatus("error");
      }
    },
    [activeSourceId, forgetSourceId, loadSources]
  );

  const changePatchStatus = useCallback(
    async (patch: PatchRecord, nextStatus: "applied" | "reverted" | "rejected") => {
      if (!activeSource) return;
      setStatus("saving");
      setError("");
      try {
        await entityClient.updatePatch(patch.id, nextStatus);
        await loadSourceWorkspace(activeSource.id);
        setStatus("idle");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update patch");
        setStatus("error");
      }
    },
    [activeSource, loadSourceWorkspace]
  );

  // SRC-3: fork the active IMPORTED source into an editable AUTHORED copy — the copy is
  // a fresh document (notes/anchors STAY on the original, per §3), so we just reload the
  // library and open the new source (which then routes to the authored editor view).
  const forkActiveSource = useCallback(async () => {
    if (!activeSource || !isForkableImportedSource(activeSource)) return;
    setStatus("saving");
    setError("");
    try {
      const { source } = await getSourceAuthoringIo().forkSource(activeSource.id);
      await loadSources();
      setActiveSourceId(source.id);
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fork source");
      setStatus("error");
    }
  }, [activeSource, loadSources, setActiveSourceId]);

  const canForkActiveSource = useMemo(
    () => !!activeSource && isForkableImportedSource(activeSource),
    [activeSource]
  );

  // Flip the note-presentation mode. Persistence was removed with the dead
  // readStoredAnnotationMode/persistAnnotationMode pair (the stored key was never read
  // back — the mode is effectively pinned to "margin"); the setter still drives the
  // live React state so the context surface is unchanged.
  const setAnnotationMode = useCallback((mode: HtmlAnnotationMode) => {
    setAnnotationModeState(mode);
  }, []);

  // Reload the layer switcher (token) AND repaint the reader (enabled layers drive
  // which anchors the server returns). Used by the switcher after a direct import.
  const refreshLayers = useCallback(() => {
    setLayersVersion((value) => value + 1);
    void refreshAnnotations();
  }, [refreshAnnotations]);

  // NOTE: `toggleLayerFilter` (a public value field) is NOT moved here — it dispatches the
  // `layer.toggle` COMMAND through the coordinator's `dispatch`, and `dispatch` transitively
  // depends on this documents surface (commandContext → docs.refreshAnnotations/activeSourceId),
  // so injecting it would create a circular hook dependency. Per the split plan's
  // circular-edge rule, it stays in the provider coordinator (it reads only `dispatch` + its
  // `layer` argument — zero documents state — so keeping it there is clean).

  // CASCADE set (Layer Lens parent toggle): flip several leaf layers to the SAME enabled
  // state at once, then refresh layers + annotations ONCE (instead of per-layer, which
  // would re-fetch N times and race). Only patches layers whose state actually changes.
  const setLayersEnabled = useCallback(
    async (layerIds: string[], enabled: boolean) => {
      const targets = sourceLayers.filter((layer) => layerIds.includes(layer.id) && layer.enabled !== enabled);
      if (targets.length === 0) return;
      setStatus("saving");
      setError("");
      try {
        await Promise.all(targets.map((layer) => entityClient.patchLayer(layer.id, { enabled })));
        setLayersVersion((value) => value + 1);
        await refreshAnnotations();
        setStatus("idle");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update layers");
        setStatus("error");
      }
    },
    [sourceLayers, refreshAnnotations]
  );

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  useEffect(() => {
    rememberSourceId(activeSourceId);
  }, [activeSourceId, rememberSourceId]);

  // The FOCUSED source's load: on an id change (a focus flip or a switch), reuse the
  // cached bundle without a refetch when present (mirror it to top-level + run the
  // source-switch side effects), else fetch it. This is the "no-refetch on refocus" path.
  useEffect(() => {
    if (!activeSourceId) return;
    if (hasBundle(sourceBundles, activeSourceId)) {
      const cached = getBundle(sourceBundles, activeSourceId);
      if (cached) {
        mirrorBundleToTopLevel(cached);
        focus.clear();
        resetReaderDraftInputs();
      }
      return;
    }
    void loadSourceWorkspace(activeSourceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mirror App: load on id change only
  }, [activeSourceId]);

  // Per-pane bundle load: every OPEN pane's source needs its bundle cached so its reader
  // can paint (P-A2 feeds each pane its own list). The focused effect above only loads the
  // focused source; this loads any pane's source that isn't cached yet (no top-level mirror).
  useEffect(() => {
    for (const pane of openPanes) {
      if (pane.sourceId && pane.sourceId !== activeSourceId && !hasBundle(sourceBundles, pane.sourceId)) {
        void loadPaneBundle(pane.sourceId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load a pane's bundle on open
  }, [openPanes]);

  // Persist the open panes + focus (mirrors recentSourceIds) so the workspace's open docs
  // survive a reload; reconciled against live sources on the next loadSources (prune).
  useEffect(() => {
    persistPanes({ openPanes, focusedPaneId });
  }, [openPanes, focusedPaneId]);

  return useMemo<DocumentsSurface>(
    () => ({
      status,
      error,
      setStatus,
      setError,
      sources,
      recentSources,
      activeSourceId,
      activeSource,
      activeViewer,
      setActiveSourceId,
      openSourceInNewPane,
      openPanes,
      focusedPaneId,
      focusPane: focusPaneById,
      closePane: closePaneById,
      sourceForPane,
      paintAnchorsForPane,
      renderedHtmlForPane,
      loadSources,
      deleteSourceItem,
      removeRecentSourceId: forgetSourceId,
      reloadActiveSource,
      refreshAnnotations,
      renderedHtml,
      anchors: visibleAnchors,
      notes,
      patches,
      paintAnchors,
      revealAnchors,
      activePatches,
      annotationMode,
      setAnnotationMode,
      folderRoots,
      closeFolderRoot,
      activeFilePath,
      importUrl,
      setImportUrl,
      openLocalFile,
      openFileDialog,
      openFolderDialog,
      importFromUrl,
      openLiveUrl,
      importXmindFromPath,
      changePatchStatus,
      canForkActiveSource,
      forkActiveSource,
      layersVersion,
      refreshLayers,
      sourceLayers,
      enabledLayerIds,
      visibleNotes,
      setLayersEnabled
    }),
    [
      status,
      error,
      sources,
      recentSources,
      activeSourceId,
      activeSource,
      activeViewer,
      setActiveSourceId,
      openSourceInNewPane,
      openPanes,
      focusedPaneId,
      focusPaneById,
      closePaneById,
      sourceForPane,
      paintAnchorsForPane,
      renderedHtmlForPane,
      loadSources,
      deleteSourceItem,
      forgetSourceId,
      reloadActiveSource,
      refreshAnnotations,
      renderedHtml,
      visibleAnchors,
      notes,
      patches,
      paintAnchors,
      revealAnchors,
      activePatches,
      annotationMode,
      setAnnotationMode,
      folderRoots,
      closeFolderRoot,
      activeFilePath,
      importUrl,
      openLocalFile,
      openFileDialog,
      openFolderDialog,
      importFromUrl,
      openLiveUrl,
      importXmindFromPath,
      changePatchStatus,
      canForkActiveSource,
      forkActiveSource,
      layersVersion,
      refreshLayers,
      sourceLayers,
      enabledLayerIds,
      visibleNotes,
      setLayersEnabled
    ]
  );
}
