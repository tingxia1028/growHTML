// WorkspaceContext — the shared state + actions the workspace views consume. This
// is the relocation target for everything that used to live inline in the App's
// `Workspace` component: the active source, the sources list, anchors/notes/patches,
// chat messages, status/error, the `paintAnchors` memo, and the handlers
// (loadSources, openLocalFile/import, dispatch(command), changePatchStatus, …).
//
// Views read/write ONLY through this context (which is itself backed by Focus,
// EntityClient, and the CommandRegistry) — never by reaching into each other. So the
// three panels are now registered views that pull from `useWorkspace()` instead of
// being hard-coded JSX inside one component. FocusProvider wraps this unchanged.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import {
  entityClient,
  type AnyAnchor,
  type ChatContext,
  type ChatMessage,
  type NoteRecord,
  type PatchRecord,
  type SourceRecord
} from "../data/entityClient";
import { useFocus, draftQuoteText, type FocusContextValue } from "../focus/FocusContext";
import { getSourceViewer, type SourceViewer } from "../viewers";
import { getCommand, runCommand, type CommandContext } from "../commands/registry";
import type { PaintAnchor } from "../surfaces/types";

export type Status = "idle" | "loading" | "saving" | "error";

// Note `content` is `unknown` (structured per contentType). For display we want a
// string: string content passes through; structured content is shown as JSON.
export function noteText(content: unknown): string {
  return typeof content === "string" ? content : JSON.stringify(content, null, 2);
}

// Empty input → empty string (the terminal then uses the app's default cwd).
function parentDir(filePath: string): string {
  const normalized = filePath.replace(/[\\/]+$/, "");
  const cut = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return cut > 0 ? normalized.slice(0, cut) : "";
}

// The value every workspace view renders against. It is intentionally broad — it is
// the union of what the three panels need — but it is a single, explicit seam, so a
// view's data dependencies are visible and it can't smuggle state in from a sibling.
export type WorkspaceContextValue = {
  // —— shared kernel ——
  focus: FocusContextValue;

  // —— status ——
  status: Status;
  error: string;

  // —— sources ——
  sources: SourceRecord[];
  activeSourceId: string;
  activeSource: SourceRecord | null;
  activeViewer: SourceViewer;
  setActiveSourceId(id: string): void;
  loadSources(): Promise<void>;
  deleteSourceItem(sourceId: string, title: string): Promise<void>;

  // —— reader data ——
  renderedHtml: string;
  anchors: AnyAnchor[];
  notes: NoteRecord[];
  patches: PatchRecord[];
  /** ONE normalized paint list for the active source (every reader filters it). */
  paintAnchors: PaintAnchor[];
  /** Patches scoped to the focused anchor (or all when nothing is focused). */
  activePatches: PatchRecord[];

  // —— opening / importing ——
  canOpenLocal: boolean;
  folderRoot: string | null;
  setFolderRoot(root: string | null): void;
  activeFilePath: string | undefined;
  importUrl: string;
  setImportUrl(url: string): void;
  openLocalFile(filePath: string): Promise<void>;
  openFileDialog(): Promise<void>;
  openFolderDialog(): Promise<void>;
  importFromUrl(): Promise<void>;
  openLiveUrl(): Promise<void>;

  // —— study panel (chat / notes / patches / terminal) ——
  chatMessages: ChatMessage[];
  composerMode: "ask" | "note";
  setComposerMode(mode: "ask" | "note"): void;
  noteContentType: string;
  setNoteContentType(type: string): void;
  chatInput: string;
  setChatInput(text: string): void;
  patchHtml: string;
  setPatchHtml(html: string): void;
  showTerminal: boolean;
  setShowTerminal(show: boolean | ((value: boolean) => boolean)): void;
  activeFileDir: string;
  /** The focused passage's quote (empty for region drafts) + whether it's a region. */
  draftQuote: string;
  hasRegionDraft: boolean;
  /** Whether the composer's primary action (ask/note) is currently available. */
  composerDisabled: boolean;
  submitComposer(): void;
  /** Run a registered command with a per-invocation payload. */
  dispatch(commandId: string, payload: CommandContext["payload"]): Promise<void>;
  /** The selected text in a reply, or the full reply if nothing is highlighted. */
  selectedTextOr(fullContent: string): string;
  changePatchStatus(patch: PatchRecord, nextStatus: "applied" | "reverted" | "rejected"): Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const focus = useFocus();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [activeSourceId, setActiveSourceId] = useState("");
  const [renderedHtml, setRenderedHtml] = useState("");
  const [anchors, setAnchors] = useState<AnyAnchor[]>([]);
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [patches, setPatches] = useState<PatchRecord[]>([]);
  const [noteContentType, setNoteContentType] = useState<string>("markdown");
  const [composerMode, setComposerMode] = useState<"ask" | "note">("ask");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [showTerminal, setShowTerminal] = useState(false);
  const [patchHtml, setPatchHtml] = useState("");
  const [importUrl, setImportUrl] = useState("");
  const [folderRoot, setFolderRoot] = useState<string | null>(null);

  // Native file/folder dialogs come from the Electron preload; absent in a browser.
  const canOpenLocal = typeof window !== "undefined" && !!window.studyVault?.openFile;
  const activeFilePath =
    (sources.find((source) => source.id === activeSourceId)?.metadata?.originalPath as string | undefined) ?? undefined;

  const activeSource = sources.find((source) => source.id === activeSourceId) ?? null;
  const activeViewer = getSourceViewer(activeSource?.sourceType);
  const selectedAnchorId = focus.anchor?.id ?? "";
  const activeFileDir = parentDir((activeSource?.metadata?.originalPath as string | undefined) ?? "");

  // Note text per anchor id — a note can hang off several anchors, and several
  // notes can share an anchor (their text is merged for the one hover card).
  const noteTextByAnchorId = useMemo(() => {
    const map = new Map<string, string>();
    for (const note of notes) {
      const text = noteText(note.content);
      for (const anchorId of note.anchorIds) {
        const existing = map.get(anchorId);
        map.set(anchorId, (existing ? `${existing}\n\n` : "") + text);
      }
    }
    return map;
  }, [notes]);

  // ONE normalized paint list for the active source: every anchor it has, mapped to
  // the uniform PaintAnchor shape with its merged note text. The host hands this
  // SAME list to whichever reader matches the source; each reader filters it to the
  // anchorKinds it understands and paints those.
  const paintAnchors = useMemo<PaintAnchor[]>(
    () =>
      anchors.map((anchor) => ({
        id: anchor.id,
        anchorKind: anchor.anchorKind,
        quote: "quote" in anchor ? anchor.quote : undefined,
        contextBefore: "contextBefore" in anchor ? anchor.contextBefore : undefined,
        contextAfter: "contextAfter" in anchor ? anchor.contextAfter : undefined,
        studyId: "studyId" in anchor ? anchor.studyId : undefined,
        page: "page" in anchor ? anchor.page : undefined,
        rect: "rect" in anchor ? anchor.rect : undefined,
        note: noteTextByAnchorId.get(anchor.id) ?? ""
      })),
    [anchors, noteTextByAnchorId]
  );
  const activePatches = useMemo(
    () => patches.filter((patch) => !selectedAnchorId || patch.anchorId === selectedAnchorId),
    [patches, selectedAnchorId]
  );

  const loadSources = useCallback(async () => {
    setStatus("loading");
    setError("");
    try {
      const response = await entityClient.sources();
      setSources(response.sources);
      setActiveSourceId((current) => current || response.sources[0]?.id || "");
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sources");
      setStatus("error");
    }
  }, []);

  const loadSourceWorkspace = useCallback(
    async (sourceId: string) => {
      setStatus("loading");
      setError("");
      try {
        const sourceRecord = sources.find((item) => item.id === sourceId);
        const viewer = getSourceViewer(sourceRecord?.sourceType);
        const isLocalHtml = viewer.htmlPipeline && !!sourceRecord?.metadata?.originalPath;
        const [rendered, anchorsResponse, notesResponse, patchesResponse] = await Promise.all([
          viewer.htmlPipeline && !isLocalHtml ? entityClient.rendered(sourceId) : Promise.resolve(null),
          entityClient.anchors(sourceId),
          entityClient.notes(sourceId),
          entityClient.patches(sourceId)
        ]);
        setRenderedHtml(rendered?.content ?? "");
        setAnchors(anchorsResponse.anchors);
        setNotes(notesResponse.notes);
        setPatches(patchesResponse.patches);
        focus.clear();
        setPatchHtml("");
        setChatMessages([]);
        setChatInput("");
        setStatus("idle");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load source");
        setStatus("error");
      }
    },
    [sources, focus]
  );

  // Re-fetch anchors/notes/patches after a mutation that may have created a new
  // anchor (note/patch save), so the painted highlights and lists stay in sync —
  // without resetting the chat the way a full workspace reload would.
  const refreshAnnotations = useCallback(async () => {
    if (!activeSourceId) return;
    try {
      const [anchorsResponse, notesResponse, patchesResponse] = await Promise.all([
        entityClient.anchors(activeSourceId),
        entityClient.notes(activeSourceId),
        entityClient.patches(activeSourceId)
      ]);
      setAnchors(anchorsResponse.anchors);
      setNotes(notesResponse.notes);
      setPatches(patchesResponse.patches);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh");
    }
  }, [activeSourceId]);

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
  }, [importUrl, loadSources]);

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
  }, [importUrl, loadSources]);

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
    [loadSources]
  );

  const openFileDialog = useCallback(async () => {
    const filePath = await window.studyVault?.openFile?.();
    if (filePath) await openLocalFile(filePath);
  }, [openLocalFile]);

  const openFolderDialog = useCallback(async () => {
    const dir = await window.studyVault?.pickDirectory?.();
    if (dir) setFolderRoot(dir);
  }, []);

  const deleteSourceItem = useCallback(
    async (sourceId: string, title: string) => {
      if (
        typeof window !== "undefined" &&
        !window.confirm(`Remove "${title}"? This also deletes its notes and highlights.`)
      ) {
        return;
      }
      setStatus("saving");
      setError("");
      try {
        await entityClient.deleteSource(sourceId);
        if (activeSourceId === sourceId) {
          setActiveSourceId("");
          setRenderedHtml("");
          setNotes([]);
          setAnchors([]);
          setPatches([]);
        }
        await loadSources();
        setStatus("idle");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete source");
        setStatus("error");
      }
    },
    [activeSourceId, loadSources]
  );

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  useEffect(() => {
    if (activeSourceId) {
      void loadSourceWorkspace(activeSourceId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mirror App: load on id change only
  }, [activeSourceId]);

  // Pre-fill the "Edit source (patch)" textarea from an HTML-surface selection (the
  // only surface whose patches replace study-id elements). All selection/paint logic
  // itself lives in the surface adapters now; this is just the host reacting to the
  // shared draft to seed an unrelated input.
  useEffect(() => {
    const draft = focus.draft;
    if (draft?.mode === "quote" && draft.kind === "html" && draft.studyId) {
      setPatchHtml(`<p data-study-id="${draft.studyId}">${draft.quote}</p>`);
    }
  }, [focus.draft]);

  // Where the active source lives + the focused passage, so the assistant knows
  // exactly which source + passage a question is about.
  const buildChatContext = useCallback((): ChatContext => {
    const meta = (activeSource?.metadata ?? {}) as Record<string, unknown>;
    const url = (meta.sourceUrl ?? meta.normalizedUrl) as string | undefined;
    const filePath = meta.originalPath as string | undefined;
    const draft = focus.draft;
    const quoteDraft = draft?.mode === "quote" ? draft : null;
    const anchorLike = focus.anchor as { contextBefore?: string; contextAfter?: string; page?: number } | null;
    const page = (draft && "page" in draft ? draft.page : undefined) ?? anchorLike?.page;
    const locationParts: string[] = [];
    if (url) locationParts.push(url);
    else if (filePath) locationParts.push(filePath);
    else if (activeSource?.path) locationParts.push(activeSource.path);
    if (page) locationParts.push(`page ${page}`);
    return {
      sourceTitle: activeSource?.title,
      sourceType: activeSource?.sourceType,
      location: locationParts.join(" · ") || undefined,
      quote: quoteDraft?.quote ?? focus.anchor?.quote,
      contextBefore: quoteDraft?.prefix ?? anchorLike?.contextBefore,
      contextAfter: quoteDraft?.suffix ?? anchorLike?.contextAfter
    };
  }, [activeSource, focus.draft, focus.anchor]);

  // Assemble the shared CommandContext. Commands collaborate through focus, the
  // entity client, and these action callbacks — never by touching node internals.
  const commandContext = useCallback(
    (payload: CommandContext["payload"]): CommandContext => ({
      focus,
      client: entityClient,
      sourceId: activeSourceId || undefined,
      payload,
      chatMessages,
      chatContext: buildChatContext(),
      actions: {
        onNoteCreated: () => void refreshAnnotations(),
        onPatchCreated: () => void refreshAnnotations(),
        onChatHistory: (history) => setChatMessages(history),
        onAssistantMessage: (message) => setChatMessages((items) => [...items, message])
      }
    }),
    [focus, activeSourceId, chatMessages, buildChatContext, refreshAnnotations]
  );

  const dispatch = useCallback(
    async (commandId: string, payload: CommandContext["payload"]) => {
      setStatus("saving");
      setError("");
      try {
        await runCommand(commandId, commandContext(payload));
        setStatus("idle");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Command failed");
        setStatus("error");
      }
    },
    [commandContext]
  );

  // The user's current text selection within a reply, or the full reply if they
  // haven't highlighted anything — lets them keep just the useful part.
  const selectedTextOr = useCallback((fullContent: string): string => {
    const selected = typeof window !== "undefined" ? window.getSelection()?.toString().trim() : "";
    return selected || fullContent;
  }, []);

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

  // Whether the composer's primary action is available, via the command itself.
  const composerCommandId = composerMode === "ask" ? "anchor.ask-ai" : "anchor.add-note";
  const composerCtx = commandContext({ text: chatInput, contentType: noteContentType });
  const composerDisabled = !getCommand(composerCommandId)?.isAvailable(composerCtx);

  const submitComposer = useCallback(() => {
    if (composerDisabled) return;
    const text = chatInput;
    setChatInput("");
    void dispatch(composerCommandId, { text, contentType: noteContentType });
  }, [composerDisabled, chatInput, dispatch, composerCommandId, noteContentType]);

  // The chip / patch text uses the focused passage's quote — empty for region
  // drafts (a region has no text, but the chip still shows a "Region selected" hint
  // below so the user knows there IS a focus).
  const draftQuote = draftQuoteText(focus.draft) || focus.anchor?.quote || "";
  const hasRegionDraft = focus.draft?.mode === "region";

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      focus,
      status,
      error,
      sources,
      activeSourceId,
      activeSource,
      activeViewer,
      setActiveSourceId,
      loadSources,
      deleteSourceItem,
      renderedHtml,
      anchors,
      notes,
      patches,
      paintAnchors,
      activePatches,
      canOpenLocal,
      folderRoot,
      setFolderRoot,
      activeFilePath,
      importUrl,
      setImportUrl,
      openLocalFile,
      openFileDialog,
      openFolderDialog,
      importFromUrl,
      openLiveUrl,
      chatMessages,
      composerMode,
      setComposerMode,
      noteContentType,
      setNoteContentType,
      chatInput,
      setChatInput,
      patchHtml,
      setPatchHtml,
      showTerminal,
      setShowTerminal,
      activeFileDir,
      draftQuote,
      hasRegionDraft,
      composerDisabled,
      submitComposer,
      dispatch,
      selectedTextOr,
      changePatchStatus
    }),
    [
      focus,
      status,
      error,
      sources,
      activeSourceId,
      activeSource,
      activeViewer,
      loadSources,
      deleteSourceItem,
      renderedHtml,
      anchors,
      notes,
      patches,
      paintAnchors,
      activePatches,
      canOpenLocal,
      folderRoot,
      activeFilePath,
      importUrl,
      openLocalFile,
      openFileDialog,
      openFolderDialog,
      importFromUrl,
      openLiveUrl,
      chatMessages,
      composerMode,
      noteContentType,
      chatInput,
      patchHtml,
      showTerminal,
      activeFileDir,
      draftQuote,
      hasRegionDraft,
      composerDisabled,
      submitComposer,
      dispatch,
      selectedTextOr,
      changePatchStatus
    ]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used within a WorkspaceProvider");
  return value;
}
