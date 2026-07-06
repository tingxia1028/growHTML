# PLAT-LAYER Part-2 Slice 7 — Build Plan (the "only-composes" flipper)

Verified against `src/client/workspace/WorkspaceContext.tsx` @ d6e7f49 (1549 lines). Slice 7 moves
the LAST 16 bare `useState`, 4 `useRef`, 8 inline `entityClient` sites out of the provider into three
new domain hooks, leaving only the coordinator (`commandContext`/`dispatch` — useMemo/useCallback,
allowed) + focus/locale derives. After Slice 7 the acceptance row
`platform-layering-build-spec.md:268` (`WorkspaceContext only-composes`) flips **RED → GREEN**.

The row is a HAND-VERIFIED doc row (no automated guard). "no inline entityClient" = no call-sites
`entityClient.foo(...)` in the provider body. The `client: entityClient` seam-pass at commandContext
(:833) is a reference handed to the command registry (by design — commands do their own IO), NOT a
provider-body call → it does not block GREEN (document it).

## Split into 3 landable sub-slices (each: tsc-0 + full-vitest-green + render guard 3/3 + characterization 4/4)

- **7a — `useGenerationDomain`** (biggest; establishes the trampoline machinery). Land FIRST.
- **7b — `useComposerDomain`** (mechanical once 7a's trampoline exists).
- **7c — `useAgentDomain` + coordinator cleanup** — carries the buildChatContext/resolveAttachmentBundles
  bridge + the aiProviders effect + the last entityClient site; **flips the acceptance row GREEN**.

## THE CRUX — cycle resolution via `[]`-deps trampoline refs (the established `materializeAnchorRef` idiom)

The coordinator (`commandContext`/`dispatch`) reads generation/agent outputs AND those hooks read
`dispatch` → an apparent cycle. Resolved exactly as the file already resolves `materializeAnchorRef`
(:623 declare / :1235 render-time assign / :863,:1108 async read): the provider declares STABLE
`[]`-deps trampoline `useCallback`s backed by refs BEFORE the hooks; hooks capture the stable
trampoline (never `.current`), so their callback identities don't churn; render-time assigns resolve
the trampolines (safe — trampolines are only invoked in effects/handlers, never during render).

Trampolines introduced: `dispatchRef`+`dispatch` (7a), `parkRef`+`parkDraft` (7a),
`resetRef`+`resetReaderDraftInputs` (7b), `disabledRef` for `composerDisabled` (7b).

### Final provider hook-call ORDER (acyclic; every ref points backward, 3 render-time assigns)

```
1.  focus         = useFocus()
2.  locale        = useLocale()
3.  dispatchRef   = useRef(null); dispatch = useCallback((id,p)=>dispatchRef.current!(id,p), [])   // 7a
4.  parkRef       = useRef; parkDraft            = useCallback(()=>parkRef.current(d), [])          // 7a
5.  resetRef      = useRef; resetReaderDraftInputs= useCallback(()=>resetRef.current(), [])         // 7b
6.  layout, theme = useLayoutDomain(), useThemeDomain()
7.  docs          = useDocumentsDomain({ focus, parkDraft, resetReaderDraftInputs })   // consumes trampolines
8.  kit           = useKitDomain({ activeSource, activeSourceId, loadSources, onError: docs.setError })
9.  plugin        = usePluginDomain({ onError: docs.setError })
10. concept       = useConceptDomain({ refreshAnnotations: docs.refreshAnnotations, onError: docs.setError })
11. chatDomain    = useChatSessionDomain({ activeSourceId: docs.activeSourceId })
12. generation    = useGenerationDomain({ focus, dispatch, activeSourceId: docs.activeSourceId,
                       refreshAnnotations: docs.refreshAnnotations, onError: docs.setError, onStatus: docs.setStatus })
       // render-time: parkRef.current = generation.parkDraft
13. composer      = useComposerDomain({ dispatch, onError: docs.setError, disabledRef })            // 7b
       // render-time: resetRef.current = composer.resetReaderDraftInputs
14. agent         = useAgentDomain({ chat: chatDomain, focus, activeSource: docs.activeSource,
                       activeSourceId: docs.activeSourceId, dispatch, onStatus: docs.setStatus, onError: docs.setError })
       // agent OWNS buildChatContext + resolveAttachmentBundles (the sourceBundle entityClient site)
15. commandContext= useCallback(... reads generation.parkDraft, generation.materializeAnchorRef,
                       agent.buildChatContext, agent.resolveAttachmentBundles, concept, docs, chatDomain, composer.chatInput ...)
16. composerDisabled = derive off commandContext + composer.chatInput/pendingImages;  disabledRef.current = composerDisabled  // 7b
17. dispatch(real)= useCallback(async (id,p)=>{ ...generation.beginGeneration()/endGeneration(); runCommand(commandContext(p))... },
                       [commandContext, docs.setStatus, docs.setError, generation.beginGeneration, generation.endGeneration])
       // render-time: dispatchRef.current = dispatch
18. operation     = useOperationDomain({ activeKitIds: kit.activeKitIds, focus, locale, dispatch })
19. value memo    = useMemo(() => ({ ...all surfaces + coordinator derives }), [surfaces + derives])
```

## 7a — `useGenerationDomain` (NEW `src/client/workspace/useGenerationDomain.ts`)

- **State (4 useState + 3 useRef):** draftNote(+draftNoteSeqRef), pendingDraft, pendingDraftRect
  (+lastGenerationRectRef), regenerating, generating, materializeAnchorRef.
- **Callbacks (VERBATIM):** parkDraft, savePendingDraft, regeneratePendingDraft, discardPendingDraft,
  openManualEditor, aiClassify, previewClassifiedReply, addReplyAsNote, materializeAnchor,
  undoDraftNote, dismissDraftNote, selectedTextOr. Render-time `materializeAnchorRef.current = materializeAnchor`.
- **Seams for the coordinator dispatch (concept-domain `bumpConceptsVersion` pattern):**
  `beginGeneration()` = `lastGenerationRectRef.current = getSelectionRect(); setGenerating(true)`;
  `endGeneration()` = `setGenerating(false)`. dispatch's isGen branch (:920-939) calls these.
- **entityClient moved in:** generateStructured(:993), classifyForm(:1052), createNote(:1215).
- **Injected:** `{ focus, dispatch, activeSourceId, refreshAnnotations, onError, onStatus }`.
- **Surface (memo-keyed on public fields):** pendingDraft, pendingDraftRect, openManualEditor,
  regenerating, generating, savePendingDraft, regeneratePendingDraft, discardPendingDraft,
  previewClassifiedReply, addReplyAsNote, materializeAnchor, draftNote, undoDraftNote, dismissDraftNote
  + coordinator-only riders: parkDraft, beginGeneration, endGeneration, materializeAnchorRef.
- **§5 knot:** parkDraft has `[]` deps + reads only generation-owned atoms → docs consumes it via the
  parkRef trampoline (declared before docs; `parkRef.current = generation.parkDraft` render-time). In 7a,
  `resetReaderDraftInputs` STAYS a provider callback injected to docs (moves to composer in 7b).
- **Oracles (strong, real-provider):** generatingState.test.tsx (generating flip via dispatch seam),
  draftMaterialize.test.tsx (materializeAnchor/undoDraftNote), floatingNoteEditor.test.tsx
  (openManualEditor/pendingDraft/savePendingDraft/regenerate). **Add characterization for the UNCOVERED
  paths: previewClassifiedReply + aiClassify** (mirror documentsDomain.characterization.test.tsx).

## 7b — `useComposerDomain` (NEW `src/client/workspace/useComposerDomain.ts`)

- **State (7 useState + 1 useRef):** noteContentType, noteContent, composerMode, chatInput, pendingImages,
  patchHtml, showTerminal (the lone shell toggle — folds here for cohesion), attachImageError ref.
- **Callbacks (VERBATIM):** changeNoteContentType, submitNoteContent, attachImage, removePendingImage,
  captureMistakePhoto, submitComposer, resetReaderDraftInputs (re-homed here — resets composer's own
  patchHtml/chatInput), setShowTerminal. Move `fileToBase64` (:212) in.
- **Owned effect:** the patch-seed effect (:761-766, reads focus.draft → setPatchHtml).
- **entityClient moved in:** importImageBase64(:1280, :1307).
- **Injected:** `{ dispatch, onError, disabledRef }` (composerDisabled read via disabledRef so
  submitComposer's early-return reads `disabledRef.current`). `resetRef.current = composer.resetReaderDraftInputs`
  render-time; docs' injected resetReaderDraftInputs becomes the resetRef trampoline.
- **Surface:** composerMode/setComposerMode, noteContentType/setNoteContentType(=changeNoteContentType),
  noteContent/setNoteContent, submitNoteContent, chatInput/setChatInput, pendingImages, attachImage,
  removePendingImage, captureMistakePhoto, patchHtml/setPatchHtml, showTerminal/setShowTerminal,
  submitComposer + rider resetReaderDraftInputs.
- **Oracles:** slashComposer/composerTypePicker (submit path). **Add characterization for captureMistakePhoto
  + attachImage** (importImageBase64 wiring) if uncovered.

## 7c — `useAgentDomain` (NEW `src/client/workspace/useAgentDomain.ts`) + coordinator cleanup — FLIPS GREEN

- **State (4 useState):** agentTurn, agentAvailable, visionAvailable, offlineMock.
- **Callbacks (VERBATIM):** runAgentTurn, regenerateChatReply. **OWNS the bridge:** buildChatContext(:770),
  resolveAttachmentBundles(:802) — their consumers are runAgentTurn + commandContext (reads agent.*).
- **Owned effect:** the aiProviders availability effect (:727-755) — sets all three availabilities.
- **entityClient moved in:** aiProviders(:730,:733), sourceBundle(:818 — inside resolveAttachmentBundles,
  the LAST provider-body entityClient site), agentStream(:1153).
- **Injected:** `{ chat, focus, activeSource, activeSourceId, dispatch, onStatus, onError }`.
- **Surface (memo-keyed):** agentTurn, agentAvailable, visionAvailable, offlineMock, runAgentTurn,
  regenerateChatReply + riders buildChatContext, resolveAttachmentBundles.
- **R2 SAFETY NET (REQUIRED — like Slice 4a):** the view tests (studyViewAgent/mistakeCapture/
  offlineMockBanner/AgentTranscript) use makeCtx() FAKES → they do NOT cover the aiProviders effect or
  runAgentTurn. Add `generationAgentDomain.characterization.test.tsx` (real WorkspaceProvider + stubbed
  entityClient) pinning: (a) aiProviders mount effect sets agentAvailable/visionAvailable/offlineMock from
  a stubbed aiProviders; (b) runAgentTurn records history once + folds agentStream events + persists the
  final message. Liveness-probe each before landing.

## Risks
- **R1 (highest): trampoline render-time assigns must NOT bust the render guard.** The trampolines are
  `[]`-deps useCallbacks (stable forever); hooks capture the stable trampoline, not `.current`. Verify
  `WorkspaceContext.render.test.tsx` 3/3 after EACH sub-slice (assertion #1 = the exact oracle).
- **R2: agent/aiProviders untested** → the characterization net above (7c).
- **R4: `client: entityClient` seam-pass** (:833) is by-design (command registry) → document, does not block GREEN.
- **R5: composerDisabled forward-ref** → the disabledRef seam (7b); keep composerDisabled a provider-body derive.
