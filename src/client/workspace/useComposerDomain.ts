// PLAT-LAYER Part-2 Slice 7b — the COMPOSER domain hook (the SECOND of Slice 7's three
// sub-slices; it REUSES the trampoline-ref machinery 7a established). Extracted VERBATIM
// from WorkspaceContext.tsx (no functional change): the right-panel composer state (the
// note-type picker + its structured draft, the ask/note mode toggle, the chat input, the
// V-1 pending-image attachments, the patch-editor HTML), the lone shell `showTerminal`
// toggle (folded here for cohesion — the plan §2), and the composer submit/attach actions.
// The 2 entityClient image-import call-sites move in with them: importImageBase64
// (attachImage + captureMistakePhoto).
//
// THE CRUX — the trampoline seams (docs/implementation/part-2-slice7-build-plan.md §CRUX):
// this hook reads the coordinator's `dispatch` (submitComposer/captureMistakePhoto/
// submitNoteContent dispatch commands) AND owns `resetReaderDraftInputs`, which the
// documents hook consumes (it resets THIS composer's own patchHtml/chatInput on a source
// switch). Both apparent cycles are resolved exactly as 7a resolved `dispatch`/`parkDraft`:
//   • `dispatch` is handed in as a STABLE ([]-deps) trampoline (backed by dispatchRef), so
//     this hook's callback identities don't churn.
//   • `resetReaderDraftInputs` is re-homed HERE (it resets composer-owned atoms), and the
//     provider hands the documents hook a STABLE `resetRef` trampoline that render-time-
//     assigns to `composer.resetReaderDraftInputs` — so documents keeps calling the same
//     stable seam it did in 7a, now backed by composer instead of the inline provider body.
//
// R5 (composerDisabled forward-ref): `composerDisabled` stays a PROVIDER-BODY derive (it
// reads the command context + this hook's chatInput/pendingImages, all provider-visible).
// `submitComposer`'s early-return guard reads it through the injected `disabledRef` at CALL
// TIME (submit is only invoked in the composer's submit handler, post-commit), so the hook
// never captures a stale disabled value and its callback identity stays stable.
//
// THE SURFACE is a `useMemo`-wrapped object keyed on EVERY field it exposes — the
// memoized-surface contract the whole Part-2 split depends on: a fresh object literal each
// render would bust the provider's value memo and re-render all 25 consumers. Follows the
// proven useGenerationDomain / useDocumentsDomain reference. The public WorkspaceContextValue
// composer fields ride on it plus one coordinator-only rider (resetReaderDraftInputs) — a
// harmless extra no context consumer reads (mirroring generation's parkDraft rider).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { entityClient } from "../data/entityClient";
import type { FocusContextValue } from "../focus/FocusContext";
import { createDefaultContent, isTextContentType } from "../notes/noteTypeRegistry";
import type { Dispatch } from "./useGenerationDomain";

// V-1 (vision-input.md §2): a picked File → base64 (strip the data-URL prefix) for the
// /api/assets import. Small + local so the composer's image-attach carries no extra dep.
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.onload = () => {
      const url = String(reader.result ?? "");
      const comma = url.indexOf(",");
      resolve(comma >= 0 ? url.slice(comma + 1) : url);
    };
    reader.readAsDataURL(file);
  });
}

/** The memoized surface the provider spreads into its value. Every PUBLIC
    WorkspaceContextValue composer field is here, plus the coordinator-only
    `resetReaderDraftInputs` rider (re-homed here in 7b; the provider's resetRef trampoline
    render-time-assigns to it so the documents hook keeps consuming a stable seam) — a
    harmless extra no context consumer reads. */
export interface ComposerDomain {
  composerMode: "ask" | "note";
  setComposerMode(mode: "ask" | "note"): void;
  noteContentType: string;
  /** = changeNoteContentType — the public field NAME the value object exposes. */
  setNoteContentType(type: string): void;
  /** Structured note draft for object content types (flashcard/quiz/image/…). */
  noteContent: unknown;
  setNoteContent(content: unknown): void;
  /** Save the structured `noteContent` as a note (object content types). */
  submitNoteContent(): void;
  chatInput: string;
  setChatInput(text: string): void;
  /** V-1: images picked for the NEXT ask-ai turn (already imported → assetId REFs). */
  pendingImages: Array<{ assetId: string; mimeType: string }>;
  /** V-1: import a picked image File into the vault + stage it as a pending attachment. */
  attachImage(file: File): Promise<void>;
  /** V-1: drop a staged pending image before sending. */
  removePendingImage(assetId: string): void;
  /** V-2 (拍错题): import a picked PHOTO + run the VLM extract → the extracted `mistake`
      draft parks in the generation preview (preview-then-Save). */
  captureMistakePhoto(file: File, hint?: string): Promise<void>;
  patchHtml: string;
  setPatchHtml(html: string): void;
  showTerminal: boolean;
  setShowTerminal(show: boolean | ((value: boolean) => boolean)): void;
  submitComposer(): void;
  // —— coordinator-only rider (not on the public value surface) ——
  /** The SOURCE-SWITCH reset of the composer-owned reader draft inputs (patchHtml +
      chatInput). Injected into the documents hook via the provider's resetRef trampoline. */
  resetReaderDraftInputs(): void;
}

export function useComposerDomain({
  focus,
  dispatch,
  onError,
  disabledRef
}: {
  /** The shared kernel focus (from the provider's useFocus()). Read-only here — the
      patch-seed effect reads focus.draft. */
  focus: FocusContextValue;
  /** The coordinator's dispatch — handed in as a STABLE trampoline (never the real one) so
      this hook's submitComposer/captureMistakePhoto/submitNoteContent identities stay
      stable. */
  dispatch: Dispatch;
  /** Decoupled error sink (the documents surface's setError) — attachImage /
      captureMistakePhoto surface image-import failures through it. */
  onError: (message: string) => void;
  /** R5: `composerDisabled` is a provider-body derive (it reads the command context +
      chatInput/pendingImages). submitComposer's early-return reads it through this ref at
      CALL TIME so the hook never captures a stale value — the provider render-time-assigns
      `disabledRef.current = composerDisabled`. */
  disabledRef: React.MutableRefObject<boolean>;
}): ComposerDomain {
  const [noteContentType, setNoteContentType] = useState<string>("markdown");
  // Structured draft for OBJECT content types (flashcard/quiz/image/…). Seeded from
  // the type's core `createDefault()` whenever the type changes; string types ignore
  // it (they author through the shared text textarea). Initialized lazily so a
  // string default doesn't seed it.
  const [noteContent, setNoteContent] = useState<unknown>(undefined);
  const [composerMode, setComposerMode] = useState<"ask" | "note">("ask");
  const [chatInput, setChatInput] = useState("");
  // V-1 (vision-input.md §2): images the user picked for the NEXT ask-ai turn but hasn't
  // sent yet — each already imported into the vault (so it carries an assetId REF, never
  // base64). Rendered as removable chips above the composer; folded into the user
  // message on submit, then cleared. DEGRADE-NOT-DISAPPEAR: the attach affordance stays
  // visible on every provider; a non-vision send just surfaces the server's 400 once.
  const [pendingImages, setPendingImages] = useState<Array<{ assetId: string; mimeType: string }>>([]);
  const attachImageError = useRef("");
  const [showTerminal, setShowTerminal] = useState(false);
  const [patchHtml, setPatchHtml] = useState("");

  // The SOURCE-SWITCH reset of the reader draft inputs (patchHtml + chatInput) that the
  // documents hook fires after a load/refocus. Those two atoms live HERE now (7b), so the
  // reset is a STABLE ([]-deps) callback the provider hands the documents hook through the
  // resetRef trampoline (render-time `resetRef.current = composer.resetReaderDraftInputs`)
  // — called at the EXACT original points, preserving timing + the error-path behavior.
  const resetReaderDraftInputs = useCallback(() => {
    setPatchHtml("");
    // W1: the chat SESSION survives a source switch (switch/attach, not wipe); only the
    // draft input resets with the reader.
    setChatInput("");
  }, []);

  // Pre-fill the "Edit source (patch)" textarea from an HTML-surface selection (the
  // only surface whose patches replace study-id elements). All selection/paint logic
  // itself lives in the surface adapters now; this is just the composer reacting to the
  // shared draft to seed an unrelated input.
  useEffect(() => {
    const draft = focus.draft;
    if (draft?.mode === "quote" && draft.kind === "html" && draft.studyId) {
      setPatchHtml(`<p data-study-id="${draft.studyId}">${draft.quote}</p>`);
    }
  }, [focus.draft]);

  // V-1: import a picked image into the vault and stage it as a pending attachment. Reads
  // the File as base64, POSTs /api/assets (server caps the size → 400 on oversize), and
  // pushes the returned assetId REF. Errors surface via onError (degrade-not-disappear).
  const attachImage = useCallback(
    async (file: File) => {
      try {
        attachImageError.current = "";
        const dataBase64 = await fileToBase64(file);
        const { assetId } = await entityClient.importImageBase64({
          dataBase64,
          mimeType: file.type || "image/png",
          fileName: file.name
        });
        setPendingImages((prev) => [...prev, { assetId, mimeType: file.type || "image/png" }]);
      } catch (error) {
        onError(error instanceof Error ? error.message : "图片添加失败");
      }
    },
    [onError]
  );

  const removePendingImage = useCallback((assetId: string) => {
    setPendingImages((prev) => prev.filter((image) => image.assetId !== assetId));
  }, []);

  // V-2 (拍错题, vision-input.md §3): import a picked PHOTO into the vault and dispatch the
  // `mistake-photo.capture` command with the image REF as a SIBLING payload — the server
  // runs the VLM extract prompt and the extracted `mistake` draft parks in the generation
  // preview (preview-then-Save). Reuses the SAME importImageBase64 path as attachImage (zero
  // new asset plumbing). DEGRADE-NOT-DISAPPEAR: on a non-vision provider the server surfaces
  // the clean 400 once (onError), the affordance never hides. `hint` is optional user text.
  const captureMistakePhoto = useCallback(
    async (file: File, hint?: string) => {
      try {
        const dataBase64 = await fileToBase64(file);
        const { assetId } = await entityClient.importImageBase64({
          dataBase64,
          mimeType: file.type || "image/png",
          fileName: file.name
        });
        await dispatch("mistake-photo.capture", {
          images: [{ type: "image", assetId, mimeType: file.type || "image/png" }],
          ...(hint && hint.trim() ? { text: hint.trim() } : {})
        });
      } catch (error) {
        onError(error instanceof Error ? error.message : "错题照片处理失败");
      }
    },
    [dispatch, onError]
  );

  const submitComposer = useCallback(() => {
    if (disabledRef.current) return;
    const text = chatInput;
    const images = pendingImages.map((image) => ({ type: "image" as const, assetId: image.assetId, mimeType: image.mimeType }));
    setChatInput("");
    setPendingImages([]);
    void dispatch("anchor.ask-ai", { text, images: images.length > 0 ? images : undefined });
  }, [chatInput, pendingImages, dispatch, disabledRef]);

  // Switching the note type re-seeds the structured draft from the NEW type's core
  // default (object types only; string types author through the text textarea and
  // leave the draft undefined). Keeps the editor showing a valid blank value.
  const changeNoteContentType = useCallback((type: string) => {
    setNoteContentType(type);
    setNoteContent(isTextContentType(type) ? undefined : createDefaultContent(type));
  }, []);

  // Save the structured draft as a note (object content types). Sends the `content`
  // object verbatim — the plugin's editor already shaped it; the server re-validates
  // it against the core spec. After save, re-seed a fresh blank draft of the type.
  const submitNoteContent = useCallback(() => {
    void dispatch("anchor.add-note", { content: noteContent, contentType: noteContentType }).then(() =>
      setNoteContent(createDefaultContent(noteContentType))
    );
  }, [dispatch, noteContent, noteContentType]);

  return useMemo<ComposerDomain>(
    () => ({
      composerMode,
      setComposerMode,
      noteContentType,
      setNoteContentType: changeNoteContentType,
      noteContent,
      setNoteContent,
      submitNoteContent,
      chatInput,
      setChatInput,
      pendingImages,
      attachImage,
      removePendingImage,
      captureMistakePhoto,
      patchHtml,
      setPatchHtml,
      showTerminal,
      setShowTerminal,
      submitComposer,
      // coordinator-only rider
      resetReaderDraftInputs
    }),
    [
      composerMode,
      noteContentType,
      changeNoteContentType,
      noteContent,
      submitNoteContent,
      chatInput,
      pendingImages,
      attachImage,
      removePendingImage,
      captureMistakePhoto,
      patchHtml,
      showTerminal,
      submitComposer,
      resetReaderDraftInputs
    ]
  );
}
