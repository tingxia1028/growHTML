import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { entityClient, type AnyAnchor, type CreateAnchorInput } from "../data/entityClient";

// AnchorDraft — a passage the user has selected/marked in a reader but not yet
// saved as a real Anchor. It is materialized into a stored Anchor lazily, only
// when an action needs one (save a note, ask AI, create a patch) — so plain
// selecting never writes to storage.
//
// Anchors are NOT text-only: a selection is either a text QUOTE (html/web/pdf) or
// a geometric REGION (a rubber-banded rectangle over a pdf page or an image). The
// draft is a mode union so the two never get mixed up; `kind` is the rendering
// SURFACE, `mode` is what was captured on it.
export type QuoteAnchorDraft = {
  mode: "quote";
  sourceId: string;
  kind: "html" | "web" | "pdf";
  quote: string;
  prefix?: string;
  suffix?: string;
  // html
  studyId?: string;
  selector?: string;
  // pdf
  page?: number;
  // web (and local-HTML, keyed by its /api/local url)
  url?: string;
  normalizedUrl?: string;
};

export type RegionAnchorDraft = {
  mode: "region";
  sourceId: string;
  kind: "pdf" | "image";
  /** Normalized rectangle [x, y, w, h] (0..1) on the page/image. */
  rect: [number, number, number, number];
  // pdf
  page?: number;
  url?: string;
};

export type AnchorDraft = QuoteAnchorDraft | RegionAnchorDraft;

// The shared `quote` shown in the source chip / used for chat context — empty for
// region drafts (a region has no text).
export function draftQuoteText(draft: AnchorDraft | null): string {
  return draft && draft.mode === "quote" ? draft.quote : "";
}

// FocusTarget — what the user is currently acting on. Anchors (and their drafts)
// are the main reading focus, but notes/patches/concepts/relations can be focused
// too (e.g. from search or an inspector). Nodes read this to stay in sync without
// knowing about each other.
export type FocusTarget =
  | { type: "source"; sourceId: string }
  | { type: "anchor"; anchorId: string }
  | { type: "anchor-draft"; draft: AnchorDraft }
  | { type: "note"; noteId: string }
  | { type: "patch"; patchId: string }
  | { type: "concept"; conceptId: string }
  | { type: "relation"; relationId: string };

// Pure mapping: an AnchorDraft → the createAnchor request body. Exported so it can
// be unit-tested without React. Covers both capture modes:
//   quote + html  → html_selection {studyId, selector, quote, ctx}
//   quote + web   → web_text_quote {normalizedUrl, quote, ctx}
//   quote + pdf   → pdf_selection {page, quote, ctx}
//   region + pdf  → pdf_selection {page, rect, quote:""}
//   region + image→ image_region {rect}
export function buildAnchorInput(draft: AnchorDraft): CreateAnchorInput {
  if (draft.mode === "region") {
    if (draft.kind === "image") {
      return { sourceId: draft.sourceId, anchorKind: "image_region", rect: draft.rect, quote: "" };
    }
    // region + pdf
    return {
      sourceId: draft.sourceId,
      anchorKind: "pdf_selection",
      page: draft.page ?? 1,
      rect: draft.rect,
      quote: ""
    };
  }

  if (draft.kind === "web") {
    // The url a web/local-HTML draft is keyed by comes from webview.getURL(), which
    // can be an empty/whitespace string before the guest finishes attaching (and a
    // blank `??` operand is NOT nullish, so it would survive as `normalizedUrl: ""`).
    // An empty normalizedUrl then (a) fails the server's z.string().min(1) → 400 and
    // (b) blocks the server's `?? source.metadata.normalizedUrl` fallback (again, ""
    // isn't nullish) — so the anchor is never created. Coalesce blank → undefined so
    // an unknown page url falls back to the source's stored normalizedUrl instead.
    const url = (draft.url ?? draft.normalizedUrl ?? "").trim();
    return {
      sourceId: draft.sourceId,
      anchorKind: "web_text_quote",
      normalizedUrl: url || undefined,
      quote: draft.quote,
      contextBefore: draft.prefix ?? "",
      contextAfter: draft.suffix ?? ""
    };
  }
  if (draft.kind === "pdf") {
    return {
      sourceId: draft.sourceId,
      anchorKind: "pdf_selection",
      page: draft.page ?? 1,
      quote: draft.quote,
      contextBefore: draft.prefix ?? "",
      contextAfter: draft.suffix ?? ""
    };
  }
  return {
    sourceId: draft.sourceId,
    anchorKind: "html_selection",
    studyId: draft.studyId,
    selector: draft.selector,
    quote: draft.quote,
    contextBefore: draft.prefix ?? "",
    contextAfter: draft.suffix ?? ""
  };
}

export type FocusContextValue = {
  focus: FocusTarget | null;
  /** The current anchor draft, if the focus is an unsaved selection. */
  draft: AnchorDraft | null;
  /** The materialized/selected anchor record currently in focus, if any. */
  anchor: AnyAnchor | null;
  setFocus(next: FocusTarget | null): void;
  /** Focus a fresh selection (or clear it). */
  setDraft(draft: AnchorDraft | null): void;
  /** Focus an existing anchor record (caches it for context building/painting). */
  setAnchor(anchor: AnyAnchor | null): void;
  clear(): void;
  /**
   * Ensure there is a saved Anchor for the current focus: returns the focused
   * anchor if already materialized, otherwise creates one from the draft, caches
   * it, and switches focus to it. Returns null if there is nothing to anchor.
   */
  materializeAnchor(): Promise<AnyAnchor | null>;
};

const FocusContext = createContext<FocusContextValue | null>(null);

export type FocusProviderProps = {
  children: ReactNode;
  /** Injected for testing; defaults to the real client. */
  createAnchor?: (input: CreateAnchorInput) => Promise<{ anchor: AnyAnchor }>;
  /** Called when a draft is materialized into a new anchor (e.g. to add it to a list). */
  onAnchorMaterialized?: (anchor: AnyAnchor) => void;
};

export function FocusProvider({
  children,
  createAnchor = entityClient.createAnchor,
  onAnchorMaterialized
}: FocusProviderProps) {
  const [focus, setFocusState] = useState<FocusTarget | null>(null);
  const [anchorRecord, setAnchorRecord] = useState<AnyAnchor | null>(null);

  const setDraft = useCallback((draft: AnchorDraft | null) => {
    setAnchorRecord(null);
    setFocusState(draft ? { type: "anchor-draft", draft } : null);
  }, []);

  const setAnchor = useCallback((anchor: AnyAnchor | null) => {
    setAnchorRecord(anchor);
    setFocusState(anchor ? { type: "anchor", anchorId: anchor.id } : null);
  }, []);

  const clear = useCallback(() => {
    setAnchorRecord(null);
    setFocusState(null);
  }, []);

  const materializeAnchor = useCallback(async (): Promise<AnyAnchor | null> => {
    if (anchorRecord) return anchorRecord;
    if (focus?.type !== "anchor-draft") return null;
    const { anchor } = await createAnchor(buildAnchorInput(focus.draft));
    setAnchorRecord(anchor);
    setFocusState({ type: "anchor", anchorId: anchor.id });
    onAnchorMaterialized?.(anchor);
    return anchor;
  }, [anchorRecord, focus, createAnchor, onAnchorMaterialized]);

  const value = useMemo<FocusContextValue>(
    () => ({
      focus,
      draft: focus?.type === "anchor-draft" ? focus.draft : null,
      anchor: anchorRecord,
      setFocus: setFocusState,
      setDraft,
      setAnchor,
      clear,
      materializeAnchor
    }),
    [focus, anchorRecord, setDraft, setAnchor, clear, materializeAnchor]
  );

  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>;
}

export function useFocus(): FocusContextValue {
  const value = useContext(FocusContext);
  if (!value) throw new Error("useFocus must be used within a FocusProvider");
  return value;
}
