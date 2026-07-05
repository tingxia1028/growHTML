# Vision Input — 多模态(图片/文件)进 LLM + 拍错题 kit(吸收 AIHomework)

Answers "llm 支持输入图片和其他文件么" (yes) and turns it into the product's photo→mistake-note
pipeline, absorbing the sibling prototype C:\CG\AIHomework (小学数学/作文批改 MVP: 受控版式 +
题号锚定 + 规则优先 + 阈值路由 + 本地 PaddleOCR 服务 + 成本路由 + 班级报告/错题派生).
Grounded 2026-07-02.

## 1. Reality: what LLMs accept today
- **Images: yes, first-class** — Claude (images + PDF native), OpenAI 4o-family, Gemini, and
  the domestic lines all ship vision variants (Qwen-VL / GLM-4V etc.); the OpenAI-compatible
  wire format carries them as standardized content parts (`{type:"image_url"|"input_image"}`),
  so our `openai-compatible` preset passes them through untouched. AI SDK v7 messages accept
  `content: [{type:"text"},{type:"image", image: bytes|url}]`; claude-agent-sdk accepts image
  blocks; codex likewise. **⚠️ verify per-preset at build time** (deepseek vision model id, GLM
  naming) — flagged for the implementation task, not assumed.
- **PDFs**: Claude native; others via our EXISTING ingest path (PDF → source → anchors) — the
  chat should attach the SOURCE (W2 bundle), not raw PDF bytes, except on providers that take
  documents natively (capability-gated).
- Audio/video: out of scope until a concrete kit needs them (kernel law).

## 2. The seam (A5 — provider track extension)
- `ChatMessage.content: string | ContentPart[]` where `ContentPart = {type:"text"|"image", ...}`
  (image = bytes ref via the asset store, never base64 in vault JSONL). The union RESERVES
  `{type:"audio"}` now — SPEECH-2's STT-via-audio-model lane rides the same seam
  (speech-and-young-learners.md §2); design the part shape once.
- `ProviderCapabilities.vision: boolean`; providers translate parts (aiSdk/cliAgent/managed);
  non-vision provider + image → typed `VisionUnsupportedError` BEFORE any call.
- Managed: vision rides the EXISTING modality×vendor×model pricing table (the gateway was
  designed for multimodal AI Groups from day one) — no billing rework.

## 3. 拍错题 kit (the AIHomework absorption — upper-layer plugin, kernel-law clean)
Photo (mobile X2 camera / desktop file-drop) → vision call with DECLARED FORM
(`textbook.mistake` / `subject.*`) → GeneratedDraft → preview → save. Zero new core concepts.
**What AIHomework taught us (absorb as kit logic, not a second system):**
- **VLM eats OCR+understanding in one call** — but its baseline holds: OCR/VLM 必然不完美 →
  规则优先 (math answer normalization/grading stays deterministic code where possible),
  阈值路由 (low confidence → human-confirm, which IS our preview gate), 题号锚定 (crop/anchor
  per problem number before the model call — better accuracy, smaller tokens).
- **Cost has three lanes now, killing the OCR-billing pain:** ① BYOK vision key (user pays
  their own); ② managed credits (our gateway prices the vision modality); ③ **local PaddleOCR
  (AIHomework's services/ai-ocr-service, FastAPI, free)** as an optional local preprocessor
  lane — wrap as a detected local tool (cli-agent-style detection probe), OFF by default,
  zero external spend when present. The AIHomework cost-router concept becomes: per-operation
  lane choice (rules → local OCR → VLM) with the threshold config kit-owned.
- Its 错题派生/班级报告 domain logic maps onto mistake notes + study-report (see
  study-report-delivery.md) — data model absorption, not code import.

## 4. Phasing
- **V-1 (A5 seam) ✅ SHIPPED (V1-001, 2026-07-05, commits 9934baa→3784f61).** The multimodal content-parts seam: `chatMessageSchema.content` widened `string → string | ContentPart[]` (a pure core `contentPartSchema` shared by provider.ts + the persisted chatSession schema; text-only stays a bare string = byte-identical). **TWO ContentPart shapes** — WIRE/persisted `{type:"image", assetId}` (a bounded ref to the EXISTING vault asset store, NEVER base64 in JSONL) vs provider-facing RESOLVED `{type:"image", data}` (bytes, ephemeral); the server resolves wire→resolved by `readAssetBytes` ONLY for `capabilities.vision` providers in ai.ts (beside the applyProfileContextGate precedent) so `src/ai/**` never imports the store (iron rule intact). A `vision:boolean` capability bit (mock/mock-agent/aiSdk = true, managed/cli-agent = false) + a typed `VisionUnsupportedError` (non-vision + image → clean 400 pre-flight). aiSdk maps to AI SDK v7 **FilePart** (not deprecated ImagePart); text-first providers degrade to a `[image]` placeholder via a shared `messageText()` collapse threaded through EVERY request-side reader (the widen-to-union made **tsc itself enumerate every unguarded reader** — the completeness proof). Base64 upload via `POST /api/assets` (`importAssetBytes` + `MAX_INLINE_IMAGE_BYTES` cap → oversize 400). **Demo:** chat 附加图片 (desktop file input, rides W2's composer) → mock echoes "Saw N image(s)." → an `<img src="/api/assets/:id">` thumbnail renders (ChatMessageBody/views/AgentTranscript). Degrade-not-disappear on non-vision (the A4a invisible-feature lesson). Gates: tsc 0 · vitest 254f/2623t · build · e2e vision-chat + agent-tools(A4b regression) green.
  <br/>_Original scope: content parts + vision capability + preset translation + typed gating; chat accepts image attachments (rides W2's attachment design). Desktop file-drop._
- **V-2 (拍错题 kit) ✅ SHIPPED (V2-001, 2026-07-05, commits 06f8f4e→895468d).** The killer flow 拍照错题 → VLM 抽取 → 预览 → 存错题本, offline-deterministic under the mock. **A small CORE foundation** first: the structured/kit generation seam did NOT carry an image (`generateForPrompt` built a bare string; `generateKitContent` never resolved vision) — extended it with an `images?` sibling on `GenerateStructuredRequest`/`kitGenerateSchema`/the client, a CONDITIONAL array message (bare string when no image, so every text kit stays byte-identical), a shared `resolveImageParts` the V-1 chat resolver now DELEGATES to (no duplicate gate; both VisionUnsupportedError strings preserved), and an image-present-ONLY resolve+gate in `generateKitContent` (text-only = untouched no-op → zero blast radius). Then a **register-only KIT** `src/kits/mistake-photo/`: an `extractMistake` KitPrompt (outputType = the CORE `mistake` contentType — REUSED, not forked; deterministic mockContent), a `capture` command that imports the photo (`importImageBase64`, V-1) → `generateStructured({images})` → the SHIPPED `onGenerated` preview loop (anchor-less source-level draft, the Review-Pack precedent, NOT autoMaterialize) → Save → a rendered `mistake` card, and a 拍错题 capture button (degrade-not-disappear on non-vision, reads `capabilities.vision`). Core-touch = the foundation + the teachback-style aggregation one-liners (kitPrompts + productKits); NO new entity, NO new contentSpec. Gates: tsc 0 · vitest 257f/2640t · build · e2e mistake-photo + vision-chat + agent-tools green; the chat-vision + text-kit regression suites stayed byte-green (95/95).
  <br/>_Original scope: the declared-form photo→mistake pipeline + preview + 存为错题; threshold-route config; PaddleOCR local-lane detection (optional) — cost-routing + PaddleOCR DEFERRED (§4 optional; the preview gate IS the human-confirm 阈值路由 for V-2)._
- **V-3 (X2):** mobile camera entry — the killer capture flow (add to X2's V1 scope).

## 5. Tests
Part-translation per provider (mock captures wire shape); non-vision gating typed error;
photo→draft→save e2e with a fixture image + mock VLM; threshold routes to preview-confirm;
PaddleOCR lane detection absent/present; asset-store refs (no base64 in JSONL — guard test).
