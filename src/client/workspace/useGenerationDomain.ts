// PLAT-LAYER Part-2 Slice 7a — the GENERATION domain hook (the first of Slice 7's three
// sub-slices; it establishes the trampoline-ref machinery 7b/7c reuse). Extracted VERBATIM
// from WorkspaceContext.tsx (no functional change): the generation-preview loop (the parked
// AI draft + its passage rect + the regenerate flag), the D6 auto-materialize (draft note +
// its undo/dismiss toast), and the chat-reply classify/save paths (previewClassifiedReply /
// aiClassify / addReplyAsNote / selectedTextOr). The 3 entityClient generation call-sites
// move in with them: generateStructured (regeneratePendingDraft), classifyForm (aiClassify),
// createNote (materializeAnchor).
//
// THE CRUX — the trampoline seam (docs/implementation/part-2-slice7-build-plan.md §CRUX):
// this hook reads the coordinator's `dispatch` (savePendingDraft/addReplyAsNote/undoDraftNote
// dispatch commands), AND the coordinator's `dispatch` reads THIS hook's outputs
// (beginGeneration/endGeneration) — an apparent cycle. It is resolved exactly as the file
// already resolves `materializeAnchorRef`: the provider hands this hook a STABLE ([]-deps)
// `dispatch` trampoline useCallback (backed by `dispatchRef`), so the hook's callback
// identities don't churn; the provider assigns the REAL dispatch into the ref at render-time
// (safe — the trampoline is only invoked in handlers/effects, never during render).
//
// SEAMS for the coordinator dispatch (the concept-domain bumpConceptsVersion pattern): the
// isGen branch of the still-in-provider dispatch used to do
// `lastGenerationRectRef.current = getSelectionRect(); setGenerating(true)` … `setGenerating(false)`.
// Those atoms now live here, so this hook exposes `beginGeneration()` / `endGeneration()` and
// dispatch calls them — behavior-identical.
//
// §5 KNOT: `parkDraft` has []-deps and reads ONLY generation-owned atoms (setPendingDraft /
// setPendingDraftRect / lastGenerationRectRef + a DOM read) — it depends on no documents/
// coordinator output. The documents hook consumes it through the provider's `parkRef`
// trampoline (declared before docs; `parkRef.current = generation.parkDraft` render-time), so
// injecting it into documents introduces NO circular hook dependency and is behavior-identical.
//
// THE SURFACE is a `useMemo`-wrapped object keyed on EVERY field it exposes — the
// memoized-surface contract the whole Part-2 split depends on: a fresh object literal each
// render would bust the provider's value memo and re-render all 25 consumers. Follows the
// proven useDocumentsDomain / useConceptDomain / useKitDomain reference. The public
// WorkspaceContextValue generation fields ride on it plus a handful of coordinator-only
// riders (parkDraft / beginGeneration / endGeneration / materializeAnchorRef) — harmless
// extras no context consumer reads (mirroring docs' setError/setStatus riders).

import { useCallback, useMemo, useRef, useState } from "react";
import { entityClient, type NoteRecord } from "../data/entityClient";
import type { FocusContextValue } from "../focus/FocusContext";
import { resolveFormAsync, type AiClassify } from "../../core/notes/resolveForm";
import { classifyContent } from "../../core/notes/classifyContent";
import { createDefaultContent } from "../notes/noteTypeRegistry";
import type { CommandContext, GeneratedDraft } from "../commands/registry";
import { getSelectionRect, type SelectionRect } from "../selection/selectionRect";
import type { DraftNoteFeedback } from "./WorkspaceContext";

/** The coordinator's dispatch signature — a command id + a per-invocation payload. Handed
    in as a STABLE trampoline (never the real dispatch) so this hook's callback identities
    stay stable across provider re-renders. */
export type Dispatch = (commandId: string, payload: CommandContext["payload"]) => Promise<void>;

export interface GenerationDomain {
  // —— generation preview (generate → preview → edit → save) ——
  pendingDraft: GeneratedDraft | null;
  pendingDraftRect: SelectionRect | null;
  openManualEditor(contentType: string): void;
  regenerating: boolean;
  generating: boolean;
  savePendingDraft(content: unknown, conceptNames?: string[]): void;
  regeneratePendingDraft(): Promise<void>;
  discardPendingDraft(): void;
  /** The selected text in a reply, or the full reply if nothing is highlighted. */
  selectedTextOr(fullContent: string): string;
  previewClassifiedReply(text: string): Promise<void>;
  addReplyAsNote(text: string): Promise<void>;
  // —— D6 auto-materialized draft note (anchor-context AI answer → note chip + undo) ——
  materializeAnchor(anchorId: string, contentType: string, content: unknown): Promise<NoteRecord | null>;
  draftNote: DraftNoteFeedback | null;
  undoDraftNote(): Promise<void>;
  dismissDraftNote(): void;
  // —— coordinator-only riders (not on the public value surface) ——
  /** Park a NEW draft (generation / classification / import / manual): remember the passage
      rect alongside it so the D5 floating editor opens next to the passage. Injected into the
      documents hook via the provider's parkRef trampoline (importXmindFromPath consumes it). */
  parkDraft(draft: GeneratedDraft): void;
  /** Snapshot the passage rect + flip `generating` on — the coordinator dispatch's isGen
      branch calls this on start (concept-domain bumpConceptsVersion pattern). */
  beginGeneration(): void;
  /** Clear `generating` — the coordinator dispatch's isGen branch calls this in finally. */
  endGeneration(): void;
  /** The D6 bridge ref the coordinator's onGenerated reads to route an eligible anchor-context
      draft to auto-materialize (assigned render-time inside this hook). */
  materializeAnchorRef: React.MutableRefObject<
    ((anchorId: string, contentType: string, content: unknown) => Promise<NoteRecord | null>) | null
  >;
}

export function useGenerationDomain({
  focus,
  dispatch,
  activeSourceId,
  refreshAnnotations,
  onError,
  onStatus
}: {
  /** The shared kernel focus (from the provider's useFocus()). Read-only here. */
  focus: FocusContextValue;
  /** The coordinator's dispatch — handed in as a STABLE trampoline (never the real one) so
      this hook's savePendingDraft/addReplyAsNote/undoDraftNote identities stay stable. */
  dispatch: Dispatch;
  /** The focused/active source id (from the documents surface) — the save target for a
      classified draft / a materialized note. */
  activeSourceId: string;
  /** Repaint after materialize creates the draft note (documents surface). */
  refreshAnnotations: (sourceId?: string) => Promise<void> | void;
  /** Decoupled error sink (the documents surface's setError). */
  onError: (message: string) => void;
  /** Decoupled busy-state sink (the documents surface's setStatus). */
  onStatus: (status: "idle" | "loading" | "saving" | "error") => void;
}): GenerationDomain {
  // D6 auto-materialize feedback: the pending "已生成笔记 · 撤销" toast payload + a
  // monotonic counter so a rapid second materialize re-arms the toast timer.
  const [draftNote, setDraftNote] = useState<DraftNoteFeedback | null>(null);
  const draftNoteSeqRef = useRef(0);
  // D6: a stable bridge so the commandContext's onGenerated (memoized earlier than the
  // materializeAnchor callback is declared) can route an eligible anchor-context draft
  // to auto-materialize without a temporal-dead-zone reference. Assigned once below.
  const materializeAnchorRef = useRef<
    ((anchorId: string, contentType: string, content: unknown) => Promise<NoteRecord | null>) | null
  >(null);
  // The AI draft awaiting preview/edit/save (null = nothing pending), plus a flag for
  // an in-flight regenerate so the preview can show/disable while it re-runs.
  const [pendingDraft, setPendingDraft] = useState<GeneratedDraft | null>(null);
  // Where the pending draft's passage was (D5): the selection rect snapshotted when
  // the draft parks. `lastGenerationRectRef` remembers the rect at DISPATCH time —
  // generation is async and the selection may have collapsed by the time the draft
  // arrives, so park-time falls back to that snapshot.
  const [pendingDraftRect, setPendingDraftRect] = useState<SelectionRect | null>(null);
  const lastGenerationRectRef = useRef<SelectionRect | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  // Whether an AI structured-generation request is in flight (see `generating` in the
  // context type). Set true around a generation command/flow, cleared on done/error.
  const [generating, setGenerating] = useState(false);

  // Park a NEW draft (generation / classification / import / manual): remember the
  // passage rect alongside it so the D5 floating editor opens next to the passage.
  // The live selection rect wins; a collapsed selection falls back to the rect
  // snapshotted when the generation dispatched. STABLE ([]-deps) — injected into the
  // documents hook (importXmindFromPath consumes it), documents-independent → not circular.
  const parkDraft = useCallback((draft: GeneratedDraft) => {
    setPendingDraftRect(getSelectionRect() ?? lastGenerationRectRef.current);
    setPendingDraft(draft);
  }, []);

  // —— coordinator dispatch seams (concept-domain bumpConceptsVersion pattern) ——
  // The isGen branch of the still-in-provider dispatch: snapshot the passage rect NOW (the
  // selection is still live under the toolbar click) — parkDraft falls back to it when the
  // async generation finishes after the selection has collapsed (D5 editor placement).
  const beginGeneration = useCallback(() => {
    lastGenerationRectRef.current = getSelectionRect();
    setGenerating(true);
  }, []);
  const endGeneration = useCallback(() => setGenerating(false), []);

  // —— generation preview actions ——
  // Persist the previewed (possibly edited) content as a note via the normal
  // add-note command, attaching to the anchor the generation already created (passed
  // as explicit anchorIds so the command SKIPs materializing a duplicate). Clear the
  // preview afterward.
  const savePendingDraft = useCallback(
    (content: unknown, conceptNames?: string[]) => {
      const draft = pendingDraft;
      if (!draft) return;
      // Clear the draft BEFORE the async dispatch so a rapid double-click on Save
      // sees a null draft and early-returns — otherwise two `anchor.add-note`
      // dispatches fire while the draft is still set, creating a duplicate note.
      setPendingDraft(null);
      // A MANUAL draft (D5 floating editor) has no pre-materialized anchor — OMIT
      // anchorIds entirely so anchor.add-note materializes the focused passage
      // (its normal fallback). Generated drafts keep the explicit list ([] when the
      // generation ran without a passage) so no duplicate anchor is materialized.
      // CG-2 auto-tag: an EXPLICIT conceptNames (the preview's surviving chips —
      // possibly [] after removals) wins; a caller that doesn't pass one falls back
      // to the draft's own AI suggestions, so suggested concepts link on save even
      // before a host mounts the removable-chips row.
      const names = conceptNames ?? draft.concepts;
      void dispatch("anchor.add-note", {
        content,
        contentType: draft.contentType,
        ...(names && names.length > 0 ? { conceptNames: names } : {}),
        ...(draft.manual ? {} : { anchorIds: draft.anchorId ? [draft.anchorId] : [] })
      });
    },
    [pendingDraft, dispatch]
  );

  // Re-run the same generation (same prompt/contentType/input) and swap in the new
  // content. The mock provider is deterministic, so this may yield identical content —
  // the UX must not depend on the content changing.
  const regeneratePendingDraft = useCallback(async () => {
    const draft = pendingDraft;
    if (!draft) return;
    // A CLASSIFIED draft (chat reply routed through resolveForm/classifyContent) has no
    // prompt to re-run — Regenerate is a no-op for it.
    if (draft.classified) return;
    setRegenerating(true);
    onError("");
    try {
      // An AUTO-output draft (a simple action with no pinned type — ACTION-2a) must
      // re-run WITHOUT a contentType: the server rejects a pinned type for it, and
      // the form router may legitimately route the rerun to a different form. The
      // response's contentType keeps the preview in sync either way.
      const { content, contentType } = await entityClient.generateStructured({
        promptId: draft.promptId,
        contentType: draft.autoForm ? undefined : draft.contentType,
        input: draft.input
      });
      setPendingDraft({ ...draft, content, contentType: contentType ?? draft.contentType });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to regenerate");
    } finally {
      setRegenerating(false);
    }
  }, [pendingDraft, onError]);

  // Drop the pending draft without persisting anything.
  const discardPendingDraft = useCallback(() => setPendingDraft(null), []);

  // D5 manual creation: park a MANUAL draft (createDefault-seeded, no promptId) so
  // the floating editor opens next to the current passage in EDIT mode. Save goes
  // through savePendingDraft → anchor.add-note with NO anchorIds, which materializes
  // the focused passage if there is one (else saves unanchored on the source) —
  // exactly the composer path this replaces. `classified` makes Regenerate a no-op.
  const openManualEditor = useCallback(
    (contentType: string) => {
      parkDraft({
        promptId: "",
        contentType,
        input: {},
        content: createDefaultContent(contentType),
        sourceId: activeSourceId || undefined,
        classified: true,
        manual: true
      });
    },
    [activeSourceId, parkDraft]
  );

  // The user's current text selection within a reply, or the full reply if they
  // haven't highlighted anything — lets them keep just the useful part.
  const selectedTextOr = useCallback((fullContent: string): string => {
    const selected = typeof window !== "undefined" ? window.getSelection()?.toString().trim() : "";
    return selected || fullContent;
  }, []);

  // Save-a-chat-reply, routed through the IDENTIFICATION contract (§0.5-A / §6.6): the
  // reply text goes through `resolveForm` (no declared form → classifyContent), and the
  // DETECTED form is parked in the SAME generation-preview loop a kit draft uses — so
  // the user previews the recognized form (markmap / mermaid / code / markdown) before
  // it is saved, instead of the old hardcoded contentType:"markdown". Materialize the
  // focused passage first (if any) so Save attaches the note to it (matching the
  // generation-preview Save path), then mark the draft `classified` (Regenerate no-ops).
  // The OPTIONAL AI classify pass (Phase 4 item 2), wired as resolveFormAsync's gated
  // callback. It is invoked ONLY when the pure heuristic is low-confidence (the
  // heuristic stays primary). It asks the model — via the server's /api/notes/classify
  // (the form router) — to decide the form for ambiguous prose. Best-effort: a failure
  // returns null so resolveFormAsync keeps the heuristic's markdown fallback. With the
  // default offline mock the router returns markdown, so the deterministic flow is
  // unchanged (today's heuristic + markdown fallback).
  const aiClassify = useCallback<AiClassify>(async (text) => {
    try {
      const result = await entityClient.classifyForm({ text });
      return { contentType: result.contentType, content: result.content, confidence: result.confidence };
    } catch {
      return null;
    }
  }, []);

  const previewClassifiedReply = useCallback(
    async (text: string) => {
      const trimmed = (text ?? "").trim();
      if (!trimmed) return;
      onStatus("saving");
      onError("");
      // Classify can hit the AI form-router (low-confidence fallback), so it's a
      // generation flow too — show the shared indicator while it runs.
      setGenerating(true);
      try {
        const anchor = await focus.materializeAnchor();
        const form = await resolveFormAsync({ text: trimmed }, { classify: aiClassify });
        parkDraft({
          promptId: "",
          contentType: form.contentType,
          input: {},
          content: form.content,
          anchorId: anchor?.id,
          sourceId: activeSourceId || undefined,
          classified: true
        });
        onStatus("idle");
      } catch (err) {
        onError(err instanceof Error ? err.message : "Failed to classify reply");
        onStatus("error");
      } finally {
        setGenerating(false);
      }
    },
    [focus, activeSourceId, onStatus, onError, aiClassify, parkDraft]
  );

  // §10 chat card "Add as note": classify the reply into its registered form (the SAME
  // pure heuristic the preview path uses) and create the note in ONE step. Respects the
  // user's TEXT SELECTION within the reply (selectedTextOr → keep just the useful part).
  //
  // D6 (note-presentation-unified.md §6): WITH anchor context (a passage is focused when
  // the reply is kept), the note AUTO-MATERIALIZES as a status:"draft" note on that anchor
  // + an undo toast — the chip appears at the passage immediately, no Save click. WITHOUT
  // anchor context (free chat), it stays the one-step add through anchor.add-note (which
  // saves unanchored on the active source) — chat-only path UNCHANGED.
  const addReplyAsNote = useCallback(
    async (rawContent: string) => {
      const text = selectedTextOr(rawContent ?? "").trim();
      if (!text) return;
      const form = classifyContent(text);
      // Anchor context = a focused saved anchor or a fresh selection draft. Materialize it
      // (a saved anchor materializes to itself) so the draft note attaches to the passage.
      const hasAnchorContext = !!focus.anchor || !!focus.draft;
      if (hasAnchorContext && materializeAnchorRef.current) {
        const anchor = await focus.materializeAnchor();
        if (anchor) {
          await materializeAnchorRef.current(anchor.id, form.contentType, form.content);
          return;
        }
      }
      await dispatch("anchor.add-note", { content: form.content, contentType: form.contentType });
    },
    [dispatch, selectedTextOr, focus]
  );

  // —— D6 auto-materialize (note-presentation-unified.md §6) ——————————————————
  // Materialize an anchor-context AI answer AS a note ON `anchorId`: create it with
  // status:"draft" (so it exists + paints immediately, distinguishable as a draft) and
  // park the undo feedback. This is the auto-save consumer that sits BESIDE the
  // preview-loop parkDraft consumer; the generation command already materialized the
  // anchor, so createNote attaches to it directly (no float-and-edit). Repaint on
  // success (the D2 chip appears at the passage — paint is note-derived, so it's free).
  const materializeAnchor = useCallback(
    async (anchorId: string, contentType: string, content: unknown): Promise<NoteRecord | null> => {
      try {
        const { note } = await entityClient.createNote({
          sourceId: activeSourceId || undefined,
          anchorIds: [anchorId],
          contentType,
          content,
          status: "draft"
        });
        draftNoteSeqRef.current += 1;
        setDraftNote({ noteId: note.id, contentType: note.contentType, seq: draftNoteSeqRef.current });
        await refreshAnnotations();
        return note;
      } catch (err) {
        onError(err instanceof Error ? err.message : "Failed to materialize note");
        return null;
      }
    },
    [activeSourceId, refreshAnnotations, onError]
  );
  // Keep the onGenerated bridge pointing at the current callback (render-time assign is
  // fine — the ref is only read inside async onGenerated handlers, never during render).
  materializeAnchorRef.current = materializeAnchor;

  // Undo the last auto-materialize: dispatch note.delete on the draft note (painting is
  // note-derived, so the chip disappears on the delete's onNoteDeleted repaint). Goes
  // through the SAME command as any delete — no bespoke removal path. The confirm gate
  // is skipped here: this IS the undo affordance for a note the user never explicitly
  // saved, so re-confirming would be nonsense (dispatch's confirm covers manual deletes).
  const undoDraftNote = useCallback(async () => {
    const feedback = draftNote;
    if (!feedback) return;
    setDraftNote(null);
    await dispatch("note.delete", { noteId: feedback.noteId, skipConfirm: true });
  }, [draftNote, dispatch]);

  const dismissDraftNote = useCallback(() => setDraftNote(null), []);

  return useMemo<GenerationDomain>(
    () => ({
      pendingDraft,
      pendingDraftRect,
      openManualEditor,
      regenerating,
      generating,
      savePendingDraft,
      regeneratePendingDraft,
      discardPendingDraft,
      selectedTextOr,
      previewClassifiedReply,
      addReplyAsNote,
      materializeAnchor,
      draftNote,
      undoDraftNote,
      dismissDraftNote,
      // coordinator-only riders
      parkDraft,
      beginGeneration,
      endGeneration,
      materializeAnchorRef
    }),
    [
      pendingDraft,
      pendingDraftRect,
      openManualEditor,
      regenerating,
      generating,
      savePendingDraft,
      regeneratePendingDraft,
      discardPendingDraft,
      selectedTextOr,
      previewClassifiedReply,
      addReplyAsNote,
      materializeAnchor,
      draftNote,
      undoDraftNote,
      dismissDraftNote,
      parkDraft,
      beginGeneration,
      endGeneration,
      materializeAnchorRef
    ]
  );
}
