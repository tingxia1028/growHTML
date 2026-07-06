// FloatingNoteEditor (D5 — note-presentation-unified §5): the floating card editor
// that REPLACES the bottom-parked GenerationPreview stage. When a draft parks in
// `pendingDraft` (kit Explain/Practice, operation.run, classify-reply, .xmind import,
// or the slash composer's manual `/type`), this card floats NEXT TO THE PASSAGE
// (pendingDraftRect — the selection rect snapshotted when the draft parked) instead
// of at the AI-Chat pane bottom, and offers the SAME Save / Edit / Regenerate /
// Discard loop. Nothing is persisted until Save (savePendingDraft → anchor.add-note).
//
// It keeps the `.generation-preview` / `.gen-preview-*` structural classes VERBATIM
// — those are the preview loop's e2e contract (operation-authoring.spec.ts drives
// them live) — wrapped in the positioned `.floating-note-editor` container.
//
// Manual mode (draft.manual — slash bare-`/type` / openManualEditor): the card opens
// straight in EDIT mode with the type's createDefault() seed and no Regenerate; Save
// materializes the focused passage via anchor.add-note's normal fallback.
//
// Autosave-draft: keystrokes debounce into localStorage (per anchor/source+type key,
// the readCardGeom idiom). Esc/✕ close KEEPS that local draft (a reopened manual
// editor restores it); explicit 丢弃 clears it. Size is CardGeom-persisted per the
// same key; position always derives from the live passage rect, never from stale
// viewport coordinates.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useWorkspace } from "./WorkspaceContext";
import { getNoteType } from "../notes/noteTypeRegistry";
import { noteTypeIcon } from "../notes/noteTypeIcon";
import { readCardGeom, writeCardGeom } from "../annotationLayer";
import { getPlatformOptional } from "../platform/platformSingleton";
import type { SelectionRect } from "../selection/selectionRect";
import "./floatingEditor.css";

/** Viewport margin + gap below/above the passage rect (SelectionFloatingToolbar idiom). */
const VIEWPORT_MARGIN = 8;
const PASSAGE_GAP = 10;
const DEFAULT_WIDTH = 320;
const ESTIMATED_HEIGHT = 260;
/** Debounce for the local autosave draft. */
const AUTOSAVE_MS = 400;

const LOCAL_DRAFT_PREFIX = "sv-edit-draft:";

// —— local autosave draft (per anchor/source + contentType) ——————————————————
function readLocalDraft(key: string): unknown {
  try {
    const prefs = getPlatformOptional()?.prefs;
    const storageKey = LOCAL_DRAFT_PREFIX + key;
    const raw = prefs ? prefs.get(storageKey) : globalThis.localStorage?.getItem(storageKey);
    if (!raw) return undefined;
    return (JSON.parse(raw) as { content?: unknown }).content;
  } catch {
    return undefined;
  }
}

function writeLocalDraft(key: string, content: unknown): void {
  try {
    const prefs = getPlatformOptional()?.prefs;
    const storageKey = LOCAL_DRAFT_PREFIX + key;
    const value = JSON.stringify({ content });
    if (prefs) prefs.set(storageKey, value);
    else globalThis.localStorage?.setItem(storageKey, value);
  } catch {
    // storage unavailable / quota — autosave is best-effort
  }
}

export function clearLocalDraft(key: string): void {
  try {
    const prefs = getPlatformOptional()?.prefs;
    const storageKey = LOCAL_DRAFT_PREFIX + key;
    if (prefs) prefs.remove(storageKey);
    else globalThis.localStorage?.removeItem(storageKey);
  } catch {
    // ignore
  }
}

// Position the editor below the passage rect (flip above when it would overflow),
// clamped to the viewport; without a rect, fall back to the reader panel's top-right
// (the draft still belongs to the document even when we couldn't measure a passage).
export function placeEditor(
  rect: SelectionRect | null,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  readerRect?: { left: number; top: number; right: number } | null
): { left: number; top: number } {
  const clampLeft = (left: number) =>
    Math.max(VIEWPORT_MARGIN, Math.min(left, viewport.width - size.width - VIEWPORT_MARGIN));
  if (rect) {
    let top = rect.bottom + PASSAGE_GAP;
    if (top + size.height > viewport.height - VIEWPORT_MARGIN) {
      const flipped = rect.top - size.height - PASSAGE_GAP;
      top = flipped < VIEWPORT_MARGIN ? VIEWPORT_MARGIN : flipped;
    }
    return { left: clampLeft(rect.left), top };
  }
  if (readerRect) {
    return { left: clampLeft(readerRect.right - size.width - 24), top: Math.max(VIEWPORT_MARGIN, readerRect.top + 56) };
  }
  return {
    left: clampLeft((viewport.width - size.width) / 2),
    top: Math.max(VIEWPORT_MARGIN, viewport.height * 0.2)
  };
}

export function FloatingNoteEditor() {
  const { pendingDraft, pendingDraftRect, regenerating, savePendingDraft, regeneratePendingDraft, discardPendingDraft } =
    useWorkspace();

  // Whether the registry editor is showing (vs the type's render), and the working
  // copy it edits. Re-seeded whenever the draft identity changes so a stale edit
  // can't leak across drafts (the GenerationPreview rule, moved here verbatim).
  const [editing, setEditing] = useState(false);
  const [editedContent, setEditedContent] = useState<unknown>(pendingDraft?.content);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // The autosave/geometry key: per anchor (generated drafts) or source (manual /
  // unanchored) + contentType — the "per anchorId+contentType" rule from the doc.
  const draftKey = pendingDraft
    ? `${pendingDraft.anchorId ?? pendingDraft.sourceId ?? "global"}:${pendingDraft.contentType}`
    : "";

  useEffect(() => {
    if (!pendingDraft) return;
    // Manual drafts restore a kept local draft (Esc/close keeps it); generated
    // drafts always show the fresh generation (the local copy is only a safety net).
    let content = pendingDraft.content;
    if (pendingDraft.manual) {
      const saved = readLocalDraft(draftKey);
      if (saved !== undefined) content = saved;
    }
    setEditedContent(content);
    setEditing(!!pendingDraft.manual);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed on draft identity only
  }, [pendingDraft]);

  // Debounced autosave of the working copy (best-effort, localStorage).
  useEffect(() => {
    if (!pendingDraft || !draftKey) return;
    const timer = setTimeout(() => writeLocalDraft(draftKey, editedContent), AUTOSAVE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editedContent]);

  // Place the card next to the passage when a draft opens; re-place once after first
  // paint so the measured size drives clamping/flip (the floating-toolbar idiom).
  useLayoutEffect(() => {
    if (!pendingDraft || typeof window === "undefined") return;
    const place = () => {
      const el = wrapRef.current;
      const saved = draftKey ? readCardGeom(document, `sv-fe:${draftKey}`) : null;
      const width = el?.offsetWidth || saved?.width || DEFAULT_WIDTH;
      const height = el?.offsetHeight || saved?.height || ESTIMATED_HEIGHT;
      const reader = document.querySelector(".reader-panel")?.getBoundingClientRect() ?? null;
      setPos(
        placeEditor(
          pendingDraftRect,
          { width, height },
          { width: window.innerWidth, height: window.innerHeight },
          reader
        )
      );
    };
    place();
    const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame(place) : null;
    return () => {
      if (raf != null) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- placement follows the draft, not every keystroke
  }, [pendingDraft, pendingDraftRect]);

  if (!pendingDraft) return null;

  const plugin = getNoteType(pendingDraft.contentType);
  const Icon = noteTypeIcon(pendingDraft.contentType);
  const saved = readCardGeom(document, `sv-fe:${draftKey}`);

  // The body: the type's registry editor when editing, else its render — the ONE
  // sanctioned render/edit entry (adaptive-note contract). Unknown type → inert JSON.
  const body = !plugin ? (
    <pre className="generation-preview-fallback">{JSON.stringify(editedContent, null, 2)}</pre>
  ) : editing ? (
    plugin.edit({ content: editedContent, onChange: setEditedContent })
  ) : (
    plugin.render({ content: editedContent })
  );

  // ✕ / Esc: close WITHOUT saving a note — the local autosave draft is kept (an
  // explicit 丢弃 is what clears it).
  const close = () => discardPendingDraft();

  // Persist the card's size after a CSS `resize: both` gesture (mouseup ends it).
  const persistGeom = () => {
    const el = wrapRef.current;
    if (!el || !draftKey) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return; // not laid out (jsdom)
    writeCardGeom(document, `sv-fe:${draftKey}`, {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    });
  };

  return createPortal(
    <div
      ref={wrapRef}
      className="floating-note-editor generation-preview"
      role="dialog"
      aria-label={`${pendingDraft.contentType} draft`}
      data-content-type={pendingDraft.contentType}
      data-manual={pendingDraft.manual ? "1" : undefined}
      style={{
        left: pos.left,
        top: pos.top,
        width: saved?.width ? `${saved.width}px` : undefined,
        height: saved?.height ? `${saved.height}px` : undefined
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          close();
        }
      }}
      onMouseUp={persistGeom}
    >
      <div className="generation-preview-head floating-note-editor-head">
        <Icon size={14} className="floating-note-editor-icon" aria-hidden="true" />
        <span className="generation-preview-label">{pendingDraft.manual ? "新建" : "Preview"}</span>
        <span className="generation-preview-type">{pendingDraft.contentType}</span>
        <button
          type="button"
          className="floating-note-editor-close"
          aria-label="Close draft editor"
          title="关闭（保留草稿）"
          onClick={close}
        >
          <X size={14} />
        </button>
      </div>

      <div className="generation-preview-body">{body}</div>

      <div className="generation-preview-actions">
        <button
          type="button"
          className="gen-preview-save"
          onClick={() => {
            savePendingDraft(editedContent);
            clearLocalDraft(draftKey);
          }}
          disabled={regenerating}
          title="Save this draft as a note"
        >
          Save
        </button>
        <button
          type="button"
          className="gen-preview-edit"
          onClick={() => setEditing((value) => !value)}
          disabled={!plugin}
          title="Edit the draft before saving"
        >
          {editing ? "Done editing" : "Edit"}
        </button>
        {/* Manual drafts have nothing to re-run — the button only renders for
            generated drafts (classified drafts keep it visible-but-no-op, the
            GenerationPreview rule moved verbatim). */}
        {pendingDraft.manual ? null : (
          <button
            type="button"
            className="gen-preview-regenerate"
            onClick={() => void regeneratePendingDraft()}
            disabled={regenerating}
            title="Re-run the generation"
          >
            {regenerating ? "Regenerating…" : "Regenerate"}
          </button>
        )}
        <button
          type="button"
          className="gen-preview-discard"
          onClick={() => {
            clearLocalDraft(draftKey);
            discardPendingDraft();
          }}
          disabled={regenerating}
          title="Discard this draft without saving"
        >
          Discard
        </button>
      </div>
    </div>,
    document.body
  );
}
