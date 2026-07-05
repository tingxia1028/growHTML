# V-1 (A5) — vision/multimodal content-parts SEAM — BUILD SPEC (revised after REVISE verdict)

Status: Plan → adversarial review → **REVISE** → all 6 required deltas folded here (the review kept
the approach — "capability bit + union content + shared collapse helper + server-side JIT resolution
at the ai.ts choke point is right and reachable" — but re-scoped the fan-out + designed the 2 undesigned
seams). This spec IS the revised plan. Foundation-then-demo. Text-first; 拍错题 kit = V-2 (deferred).

## THE SAFETY NET (why we can trust completeness): tsc-as-enumerator
The moment `chatMessageSchema.content` becomes `string | ContentPart[]`, TypeScript ERRORS on EVERY
unguarded string op (`.trim()/.replace()/.includes()/.slice()/.length`, `${...content}` interpolation)
across the whole tree. The compiler itself enumerates any reader the review missed. Commit 1 is NOT
done until `npm run check` is 0 — that gate is the exhaustive proof, not a hand-list. The list below is
the KNOWN set; tsc guarantees the FULL set.

## CORE-vs-KIT (kernel law): V-1 = a provider CAPABILITY + a content-type widening = CORE engine (a new
modality on the existing chat rung), NO kit, NO new entity — the `asset`/`image` entity ALREADY exists
(`src/core/schema/asset.ts:10-22`). 拍错题 extraction pipeline = V-2 KIT (deferred).

## THE TWO ContentPart SHAPES (delta 1 — the load-bearing seam the plan left undesigned)
- **WIRE / PERSISTED** (in request body, `ChatSessionRecord.messages`, vault JSONL): `{type:"image", assetId, mimeType?}` — a bounded ULID **ref** to the existing asset store. NEVER base64 in anything durable (roadmap.md:159 guard). Text part: `{type:"text", text}`.
- **PROVIDER-FACING / RESOLVED** (ephemeral, in-process only): `{type:"image", data /* base64|bytes */, mimeType}`. The server resolves wire→resolved by `readAssetBytes` ONLY for `capabilities.vision` providers, in `chatComplete`/`streamChatDeltas` (`src/server/services/ai.ts:55,65`) right beside the existing `applyProfileContextGate` precedent (`ai.ts:97`). **Providers only ever see the resolved variant** → `src/ai/**` never imports the store (iron rule intact; grep-confirmed clean today). AI SDK v7 wants bytes, not a ULID — this seam is what bridges them.
- Where the schema lives: `src/core/schema` CANNOT import `src/ai` (chatSession.ts:14 comment confirms). Define `contentPartSchema` (wire) in a pure core module (`src/core/schema/contentPart.ts`) that BOTH `src/ai/provider.ts` and `src/core/schema/chatSession.ts` import (verify src/ai may import a pure core schema; if the import boundary forbids it, hand-mirror as chatSession already does). The resolved shape is an `src/ai`-local type (never persisted, never in core).

## THE FOUR content validators — widen in LOCKSTEP (delta 2)
1. `src/ai/provider.ts:14` `chatMessageSchema.content`: `z.string().min(1)` → `z.union([z.string().min(1), z.array(contentPartSchema).min(1)])`.
2. `src/core/schema/chatSession.ts:20` `chatSessionMessageSchema.content` (PERSISTED vault record) — same union.
3. `src/server/services/chatSessions.ts:30` `sessionMessageInputSchema.content` (wire input for POST /api/chat/sessions + /messages) — same union.
4. (client mirror) `src/client/chat/sessionClient.ts:13` `ChatMessage.content` — widen the TS type.
**Own the persisted-JSONL shape change:** an image message's `content` is now an ARRAY (the assetId ref sits inside it), not a scalar string. Text-only messages stay a bare string → byte-identical (the union still admits the string; regression-lock test).

## THREAD messageText() THROUGH EVERY REQUEST-SIDE READER (delta 3)
Add pure `messageText(content: string | ContentPart[]): string` (text verbatim; image → `[image]` placeholder) in `src/ai/buildPrompt.ts`. KNOWN sites (tsc will confirm the full set):
| site | file:line | note |
|---|---|---|
| mockProvider.answer | mockProvider.ts:31 | `.trim()` |
| **mockProvider.completeStructured** | mockProvider.ts:102 | `.includes()` — MISSED by plan |
| mockAgentProvider.runAgent | mockAgentProvider.ts:72 | `.trim()` |
| aiSdkProvider.toModelMessage (user/system/assistant) | aiSdkProvider.ts:61,63,65 | user → real part map (commit 3); system/assistant → messageText |
| cliAgent lastUserMessage/flattenPrompt | spec.ts:78,93 | placeholder degrade |
| **claudePtyProvider.complete** | claudePtyProvider.ts:57 | writes to PTY — MISSED (would write `[object Object]`) |
| **synthesizePrompt.renderTurn** | synthesizePrompt.ts:58 | `${...content}` — MISSED |
| **synthesizePrompt.defaultSynthesisDoc** | synthesizePrompt.ts:105 | `.replace` — MISSED |
| **synthesizePrompt.capTranscript** | synthesizePrompt.ts:83 | `renderTurn(...).length` budget — MISSED |
| **deriveSessionTitle** | chatSessions.ts:74 | `.content.replace` — MISSED, hard CRASH on first-turn title |
Reply-side reads (`response.message.content`, structured.ts:129, managed.ts:281, gateway) stay a string → safe, no change.

## THE `vision` CAPABILITY BIT (delta 5 pulls the tests into scope)
Add `vision: boolean` to `ProviderCapabilities` (`src/ai/provider.ts:89-119`) beside `tools`. Per-provider literal (tsc forces each): **mock=true** (offline vision proof), mock-agent=false, **aiSdk=true** (transport-honest; model-vision-fit — `DEFAULT_DEEPSEEK_MODEL="deepseek-v4-flash"` presets.ts:45 may not be a vision model — flag in a CODE COMMENT "verify per-preset vision model-id at V-2", NOT a V-1 blocker), managed=false, cli-agent(claude-agent/codex/claude-cli/claude-pty)=false. Typed `VisionUnsupportedError` (beside HttpProviderNotConfiguredError presets.ts:37) → thrown in ai.ts BEFORE calling a non-vision provider that got an image part → clean 400 via handleServiceError. **Update the 4 exact-shape capability tests** (add `vision`): `ai.test.ts:60`, `http/aiSdkProvider.test.ts:205`, `managed.test.ts:333`, `http/registration.test.ts:58` (all `toEqual`); + client capability literals `AiProvidersSection.test.tsx:39,45,59` + the `AiProviderCapabilities` type (`entityClient.ts:626-633`).

## IMAGE RENDER (delta 4 — else the persisted demo message crashes)
`ChatMessageBody` takes `content: string` today (`ChatMessageBody.tsx:29-49`, classifyContent + markdown render). For an ARRAY content: render text parts as today (join) + each image part as a thumbnail `<img src={"/api/assets/"+assetId} .../>` (the existing byte route, app.ts:941). Same at the render call site `views.tsx:673-679` and `AgentTranscript.tsx:101`. A small `renderMessageContent(content)` helper keeps it one place. An image message renders a thumbnail, never crashes.

## ASSET base64 IMPORT (delta 6 — net-new, NOT a wrapper)
`importLocalAsset` reads a DISK PATH (assets.ts:29-36); there is NO base64 path. Add `importAssetBytes(vault, {dataBase64, mimeType})` in `src/core/store/assets.ts` replicating the hash-dedup + `writeBytes` + `assetSchema.parse` block (assets.ts:38-70) — honestly net-new, ~15 lines. `MAX_INLINE_IMAGE_BYTES` NEW constant (e.g. 8 MiB) enforced at the route → oversize 400s (no vault bloat). `POST /api/assets` (base64→asset, near app.ts:912) returns `{assetId}`. Do NOT reuse `POST /api/sources/image` (app.ts:485) — that makes a SOURCE, wrong entity for a chat ref.

## Commit sequence (each compiles + full-suite green)
1. **Core content-part schema + widen provider.ts + vision cap + VisionUnsupportedError + messageText + thread ALL readers.** `src/core/schema/contentPart.ts` (wire schema) · provider.ts content union + `vision` on each capabilities literal + error type · buildPrompt.ts `messageText` · thread it through EVERY known reader above · update the 4 capability `toEqual` tests. **Gate: `npm run check`=0 (the tsc enumerator — this is the completeness proof).** Test: chatMessageSchema accepts string AND `[{text},{image,assetId}]`; text-only serializes byte-identically; messageText collapses parts; each provider's `vision` value; VisionUnsupportedError constructs.
2. **Widen the 2 session validators (persisted + wire) + guard deriveSessionTitle.** chatSession.ts:20 + chatSessions.ts:30 union; deriveSessionTitle uses messageText. Test: create+append an image message round-trips (assetId ref INSIDE the array in JSONL, not base64); title derives from an image-first turn without crash; text-only session byte-identical.
3. **aiSdk FilePart mapping + cli degrade.** toModelMessage user content: resolved image part → AI SDK v7 **`FilePart`** `{type:"file", mediaType:mimeType, data}` (NOT deprecated ImagePart); system/assistant via messageText. cli-agent placeholder. Test: toModelMessages with a RESOLVED image part yields the SDK file-part shape (capture-the-wire-shape); cli-agent flatten renders `[image]` and stays a valid transcript.
4. **Asset base64 import + JIT wire→resolved resolver + typed gate.** assets.ts `importAssetBytes`+`MAX_INLINE_IMAGE_BYTES` · `POST /api/assets` · ai.ts `chatComplete`/`streamChatDeltas`: if any message has image parts → (vision provider: resolve each assetId→bytes into resolved parts before calling provider; non-vision: throw VisionUnsupportedError). Test: base64 import → asset persists (`assetType:"image"`, app.test.ts:503 idiom); oversize → 400; vault JSONL = ref not base64 (the guard test); chat w/ image under mock → provider receives a RESOLVED part → reply "Saw 1 image."; chat w/ image under a vision:false provider → 400.
5. **Client demo: image-attach + render + chip.** widen sessionClient.ts `ChatMessage` + entityClient `ContentPart`/`importImageBase64`/`AiProviderCapabilities.vision` · small image-attach affordance beside `ChatAttachments.tsx` (file `<input accept="image/*">` → POST /api/assets → push an image part onto the pending user message; desktop file-pick only, camera=V-3) · `renderMessageContent` thumbnail in ChatMessageBody/views/AgentTranscript · "视觉" chip in AiProvidersSection.tsx:114-117. DEGRADE-NOT-DISAPPEAR on non-vision (the A4a invisible-feature trap): the affordance stays visible; a non-vision send surfaces the clean 400 ONCE (don't hide chat). Test: component (fake api, ChatAttachments.test idiom) picking an image adds a chip + an image part; ChatMessageBody renders a thumbnail for an array message (no crash); e2e (mock, playwright.config default) attach a fixture image → send → reply "Saw 1 image." + thumbnail visible.

## MISC decisions (delta 6): image parts ride the message array, NOT `ChatContext.sources`, so the W2 context-excerpt budget is neither charged nor bypassed — an inline image does NOT count against the W2 cap in V-1 (documented; a per-modality budget is a V-2/later concern). Reserved `{type:"audio"}` part is NOT added now (SPEECH-2 STT lane; shape stays open in the union design, unimplemented).

## Collision: tree clean at 9058ac2; NOTE-FOCUS-POLISH-001 (codex, committed) touched NONE of src/ai/* or the chat routes. LOW risk. provider.ts is highest-fanout — land commit 1's type change first, let tsc drive.

## Gates: tsc 0 (the enumerator) · full vitest green (baseline 251f/2589t) · build · e2e (mock). Commit V1.N own sequence, DON'T push, DON'T touch docs (report TEXT blocks for the impl log). Avoid codex's files (styles.css/SlashPalette/anchorViews/actionIcons/FileTree/the *.test files it holds — all committed now, but stay clear of a re-touch). Kit-free, entity-free; the wrap is the chat demo, rendered via the existing note render path for text + a thumbnail for images.

## Deferred: V-2 = 拍错题 kit (declared-form photo→mistake-note extraction, threshold-route-to-preview, PaddleOCR local lane at C:\CG\AIHomework services/ai-ocr-service). V-3 = X2 mobile camera. Also: managed-vision (gateway text-SSE-only today); claude-agent-sdk native image-block adapter; per-modality context budget; the audio part.
