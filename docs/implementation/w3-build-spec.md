# W3 — AI doc synthesis — BUILD SPEC (approve-with-changes)

Status: Plan agent → adversarial review → **APPROVE-WITH-CHANGES**. This folds the 5 required deltas
into the plan. **Build AFTER F-1 lands** (both edit views.tsx — F-1 in SourceViewerView, W3 a
StudyView button; disjoint functions, same file → sequence for clean rebase). W3 turns a chat
transcript (+ W2 attachments) into a NEW markdown source with heading-TOC.

## Design (review-confirmed)
Use `generateStructured(provider, {messages, schema, sample, contentType})` (`src/ai/structured.ts:153`,
request type :47) with a `{title, markdown}` schema — NOT plain `complete()`: structured gives the
deterministic mock echo (`MockModelProvider.completeStructured` returns `JSON.stringify(request.sample)`,
mockProvider.ts:89) + the re-prompt loop + clean title/body split. cli-agent providers have
`structured:false` → degrade to `complete()`+`extractJson` (structured.ts:128). Then
`ingestSource(vault, {sourceType:"markdown", title, content: markdown, origin:"authored", createdBy:"user"})`
(`src/core/store/sources.ts:77`; filename = slug+id-suffix so title collisions are safe). Markdown `#`/`##`
render as the outline via `projectedHtmlForSource`/`injectStudyIds` (NO schema change). Open the new source
in a NEW pane (`openSourceInNewPane`, WorkspaceContext.tsx:702) after `loadSources()` (forkActiveSource
create-then-open idiom :1672). SAFETY (verified): synthesis rides the plain chat lane (`provider.complete`,
no `applyProfileContextGate`/`composeAutoContext`) → no profileContext leak, no gate bypassed; sealed notes
already filtered by `buildSourceBundle` (sources.ts:245) via the reused `resolveAttachmentBundles`
(WorkspaceContext.tsx:1318, exposed registry.ts:237) → NO new unfiltered read.

## THE 5 REQUIRED DELTAS (from the review — MANDATORY)
1. **(BLOCKER) Add `"synthesize"` to the `CommandContext.client` `Pick` union** (registry.ts:~134). Commands reach the backend via `ctx.client.<method>`; without this, commit 5 (`ctx.client.synthesize(...)`) does NOT typecheck. Commit 4 adds it to the full `entityClient`; the Pick must ALSO gain it.
2. **(REQUIRED) NO directTransport parity route.** The direct transport carries `{vault,sealed,now}` with NO provider and explicitly EXCLUDES all AI/chat routes (directTransport.ts:19-51; its test asserts `/api/chat`→`DirectTransportUnsupportedError`). Synthesis is HTTP-only like every AI route. Commit 3 = ONLY the `app.ts` route (template: `/api/notes/generate-block` app.ts:1334 + `StructuredGenerationError→400` at :1324). Delete the parity sub-claim.
3. **(REQUIRED) `synthesisDocSchema = z.object({ title: z.string().min(1), markdown: z.string().min(1) })`.** `ingestSource` accepts empty content (sourceSchema has no content min) and `isAvailable` only gates the button, not the output — the `.min(1)`s are what stop an empty source being persisted.
4. **(REQUIRED) Commit 2 validates ONLY against `synthesisDocSchema` + ingests markdown directly.** Do NOT route output through `getNoteContentSpec` (there is no `synthesis-doc` note type — that path is `generateBlock`'s, ai.ts:203). Pass `contentType: ""` (or omit) to `generateStructured`, NOT a fabricated `"synthesis-doc"`.
5. **(SHOULD-FIX, may defer) Document the claude-cli file-path risk.** cli-agent `completeStructured` degrade can return a bare file path as `markdown` (passes `min(1)`, no `JSON_ONLY` markdown nudge — that guard names `html` only, structured.ts:25). Optionally extend `JSON_ONLY` to name `markdown` or add a pre-ingest path-sanity check. Mock/`sample` keeps the shipped default + e2e deterministic.

## Commit sequence (each compiles + tested)
1. **`src/ai/synthesizePrompt.ts` (+test)** — pure: `synthesisDocSchema` (delta 3) + `buildSynthesisMessages({transcript, context?, instruction?})` = system instruction ("synthesize the conversation + attached sources into ONE markdown doc; `#`/`##` = TOC; return title + markdown") + `contextPreamble(context)` (reuse buildPrompt.ts so the `attachmentsBlock` "Attached: N" marker rides) + capped transcript (`SYNTHESIS_TRANSCRIPT_CAP` ~24000, drop-oldest, keep final user turn). Imports only the provider seam. Test: transcript+excerpts present; marker present@non-empty / absent@zero; over-cap drops oldest keeps final; empty-transcript guard.
2. **`src/server/services/synthesis.ts` (+test)** — `synthesizeRequestSchema` + `synthesizeDocument({provider, vault}, input)`: buildSynthesisMessages → `generateStructured(provider, {messages, schema: synthesisDocSchema, sample: input.sample, contentType: ""})` (delta 4) → `ingestSource(...markdown authored...)` → `{source}`. `StructuredGenerationError→400`. Test vs a real vault + MockModelProvider(sample={title,markdown}): a markdown source is created (origin authored, content==sample), renders with headings; a context-with-sources case asserts the prompt carried attachments.
3. **`app.ts` route ONLY (delta 2)** — `POST /api/chat/synthesize` beside `/api/chat` (:1272), parses the schema, calls `synthesisService.synthesizeDocument({provider: await getProvider(), vault}, input)`, returns 201 `{source}`. NO directTransport edit. Route-level test.
4. **`entityClient.synthesize()`** — additive method beside `chat()` (:1106): `sendJson<{source}>("POST","/api/chat/synthesize", input)`.
5. **`registry.ts` `chat.synthesize` command** — `isAvailable: (ctx)=>(ctx.chatMessages?.length ?? 0)>0`; `run`: resolve `sources` via feature-detected `ctx.resolveAttachmentBundles?.()` (askAi idiom :265), `context = sources?.length ? {...ctx.chatContext, sources} : ctx.chatContext`, `ctx.client.synthesize({messages: ctx.chatMessages!, context, sample: ctx.payload.content})`, on success `ctx.actions.onSourceSynthesized?.(source)`. **Add `"synthesize"` to the client Pick (delta 1)** + `onSourceSynthesized?(source)` to `CommandActions`. Test: stubbed client.synthesize + chatMessages fixture → forwards transcript+context, fires onSourceSynthesized; availability false@empty.
6. **WorkspaceContext + StudyView button** — `onSourceSynthesized: (source)=>void loadSources().then(()=>openSourceInNewPane(source.id))` in the commandContext actions (~:1356) + `synthesize` on the client surface; a "生成文档" button (FileText) in StudyView `.chat-panel-actions` (views.tsx:547), `onClick=()=>void dispatch("chat.synthesize", {})`, `disabled={status==="saving"||chatMessages.length===0}`. ONLY views.tsx edit; StudyView (462+), disjoint from F-1's SourceViewerView (283-390).
7. **`e2e/chat-synthesize.spec.ts`** — mock provider; seed a session + attach a source (reuse chat-attachments setup); click 生成文档; assert a new markdown source appears + opens in a pane + rendered content has headings. Force determinism via `payload.content` as the `sample`.

## Deferred (per §2.6 + Locked)
Left-sidebar workspace page + default-directory landing (§2.6); `<ChatPanel>` extraction from StudyView (deepens F-1 collision); clickable bookmark-TOC (V2); regenerate/edit-before-create preview loop (V1 creates directly + opens).

## Gates: tsc 0 · full vitest green (baseline 224/2382 + F-1's additions once landed) · build · new e2e green. Commit own W3.N sequence, don't push, don't touch docs (report TEXT blocks). Build ONLY after F-1 lands (rebase views.tsx).
