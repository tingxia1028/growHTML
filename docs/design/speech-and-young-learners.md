# Speech & Young Learners — 朗读(TTS) · 语音输入(STT) · 注音 · 低龄模式

低年级用户有些字不认识:文字要能读出来,语音输入要能替代打字,认不得的字要有拼音。Mechanism =
core organs (speech seams), experience = kit defaults (小学 kit turns them on). Grounded
2026-07-02.

## 1. 朗读 TTS (SPEECH-1) — roundtable absorption (user-directed 2026-07-02)

**Status: ✅ shipped (SPEECH-1-001, 2026-07-04)** — the edge lane is live server-side:
`src/server/services/speech.ts` (lane-seamed `SpeechService`, injectable edge synthesizer,
`msedge-tts@2.0.6`, curated 3-zh+1-en voice shortlist, default `zh-CN-XiaoxiaoNeural`) +
`POST /api/speech/tts` (zod ≤2000 chars → audio/mpeg; offline → friendly 502
`{error, code:"tts_unavailable"}`) + `GET /api/speech/status`. Client: `src/client/speech/`
(`useSpeakText` hook — blob-URL Audio playback, one utterance at a time, cached status probe —
+ shared `SpeakButton` 朗读↔停止) mounted on the floating selection toolbar, the Anchor Action
Bar, and the note-list row action strip (reads via the type's own `toSearchText` — the
`toSpokenText` V1 default below). Real-synthesis verified 2026-07-04 (30KB mp3 back from
Microsoft). Still open from this section: review-runner 听题, onboarding steps, Settings Hub
voice/speed picker, dedicated `toSpokenText` overrides, offline `speechSynthesis` fallback lane.

The sibling prototype **C:\CG\roundtable** (本地播客录制台) shipped the answer: **edge-tts** —
Microsoft Edge read-aloud neural voices over wss, free, keyless, VERY natural zh
(zh-CN-XiaoxiaoNeural family). Honest correction: it is **free-and-keyless but ONLINE**
(talks to Microsoft; proxy env fallback), not offline.
- **Desktop primary lane: edge-tts SERVER-SIDE in our Express** — mature JS ports exist
  (research-verified: `edge-tts-universal`, `msedge-tts`, `node-edge-tts` …); the protocol
  needs a custom `Sec-WebSocket-Version` header that browser WebSocket API canNOT set →
  **must run in Node, which we have**. Absorb from roundtable's tts.py: the curated zh voice
  shortlist, rate/pitch delta mapping, lazy-import + graceful-degrade pattern.
- **Offline fallback lane:** `speechSynthesis` (OS voices — robotic but zero-dep, works
  air-gapped) ⚠️ zh voice presence on real Electron build verify in-task.
- **Mobile lane (X2): native OS TTS** — Android `TextToSpeech` / iOS `AVSpeechSynthesizer` via
  the Capacitor community plugin (offline, free; China Android ROMs ship decent zh engines).
  edge-tts from the WebView is ruled out by the header restriction (no Node on the phone).
- **Paid quality lane later:** cloud neural TTS = another MODALITY in the managed AI Group
  (the gateway pricing table already models modality×vendor — no billing rework).
- **Content source:** `toSpokenText(content)` per content type — defaults to the existing
  `toSearchText`, overridable where reading order matters (quiz: 题干→选项 slowly; formula:
  KaTeX → spoken form is HARD, V1 reads the explanation text and skips TeX, honestly).
- **Surfaces:** 朗读 button on note cards/full views + review runner (听题 — the young-learner
  killer: question auto-read, 显示答案 read on reveal) + onboarding steps. Reader
  selection-朗读 rides the contended toolbar (gated, SC-2 window). Speed/voice picker in
  Settings Hub (registerSettingsSection — the seam keeps paying).

## 1b. 朗读通用化 (SPEECH-1b) — 朗读=文本的能力

**Status: ✅ shipped (SPEECH-1B-001, 2026-07-04).** User law (2026-07-04): "读本质上不是一个
anchor 的能力，而是所有文本的可读能力，包括 AI chat 里的回答。" Read-aloud is a property of
TEXT, not of any one surface — so it is layered, never bolted on per view (the
abstract-recurring-capabilities principle: one capability behind a shared contract):

- **Host-level: `GlobalSpeakSelection`** (`src/client/speech/GlobalSpeakSelection.tsx`) —
  mounted ONCE in the WorkspaceShell chrome (sibling of SelectionFloatingToolbar). Any
  non-empty host-document text selection floats a small 朗读 chip near the selection end
  (停止 while speaking; Escape dismisses; scroll hides an idle chip; hidden entirely when
  the status probe says unavailable). Deliberately dumb: `selection.toString()` →
  `useSpeakText`, no anchors, no persistence.
- **Exclusion rule (no double-serving):** a selection whose anchorNode is inside the
  source-viewer pane (`.reader-panel` — the same scope selector SelectionFloatingToolbar
  uses) is the reader toolbar's job (it already carries 朗读, SPEECH-1); reader
  iframes/webview guests never reach the host selection anyway (separate realms).
- **Per-block affordances where selection is clumsy:** every ASSISTANT chat bubble
  carries a compact SpeakButton (ChatMessageBody actions row — AI 回答可读; user prompts
  don't), and the unified note shell (`FocusOverlay` Center View header) carries ONE
  speaker affordance reading via the type's own `toSearchText` (the toSpokenText V1
  default; per the adaptive contract this lives in the SHELL, never per note type).
- **Readers keep their own toolbars** — the SPEECH-1 mounts (floating selection toolbar,
  Anchor Action Bar, note-list rows) are unchanged; SPEECH-1b adds the universal layer
  above them, it does not replace them.

## 2. 语音输入 STT (SPEECH-2) — honest China/Electron reality

**Status: ✅ V1 local lane shipped (SPEECH-2-001, 2026-07-04)** — the desktop faster-whisper
lane is live end-to-end. Sidecar: `scripts/stt-sidecar/` (stdlib-http `server.py` adapted from
roundtable stt.py — GPU float16 → CPU int8 fallback, single-flight infer lock, zh-biased
decode; `GET /health` + `POST /transcribe`; 127.0.0.1:8765, `WHISPER_MODEL`/`STT_PORT` env;
zh 3-step README). Server: the SPEECH-1 `SpeechService` gained `transcribe()` + a per-lane stt
status (REAL /health probe, 800ms timeout, cached 30s, injectable probe/proxy seams) +
`POST /api/speech/stt` (raw audio ≤15MB → `{text, language, durationMs}`; sidecar down →
friendly 502 `{error, code:"stt_unavailable"}` whose message IS the setup pointer) and
`GET /api/speech/status` now carries `stt:{available, lane:"local", model?, setupHint?}`;
base URL via `STUDY_VAULT_STT_URL`. Client: `useVoiceInput` (MediaRecorder webm/opus+fallbacks,
idle→recording→transcribing, seq-guarded cancel) + `VoiceInputButton` (mic 点亮 from the shared
status cache — one fetch serves it AND useSpeakText; **transcript-confirm popover** 确认插入/
重录/取消 before ANY insert; unavailable → in-place 3-step setup-guide panel, not a settings
surface), mounted on the chat composer — which IS the slash composer's main text field, so one
mount covers both. Real check 2026-07-04: edge-TTS mp3 → sidecar large-v3 (GPU) → verbatim
transcript back in 1.1s. Still open from this section: BYOK audio-model lane (①), managed lane
(②), note-editor dictation + review-runner 语音作答 mounts, sherpa-onnx consolidation (V1.1).

- **Web Speech `SpeechRecognition` is NOT viable here**: in Chromium it proxies Google servers
  (blocked/unreliable in China, needs API keys in Electron). Do not build on it.
- **The THREE-LANE pattern again (same as vision/OCR — this is now a named recurring
  capability, "modality lanes"):**
  ① **BYOK audio-capable model** — audio content part to Qwen-Audio/GPT-4o-audio class models
  (the A5 ContentPart union gains `{type:"audio"}` — vision-input.md V-1 should reserve it now);
  ② **managed STT** — aliyun/讯飞 behind the gateway as a priced modality;
  ③ **local lane, per platform:**
  - **Desktop:** roundtable's proven **faster-whisper** service (large-v3 on the user's GPU,
    PyAV webm decode, single-flight infer lock — stt.py is the reference; wrap as a detected
    local service like PaddleOCR) — fully offline, best zh accuracy.
  - **Mobile (X2): sherpa-onnx** — research-verified (active, v1.13.3 2026-06): official
    Android/iOS on-device ASR with **Paraformer zh models** (FunASR lineage, fast+accurate
    Chinese), NNAPI/CoreML/QNN acceleration, RN/Flutter bindings exist → a Capacitor bridge is
    realistic. faster-whisper/large-v3 canNOT run on phones (CTranslate2 + ~3GB — ruled out).
  - **Consolidation candidate ⚠️ verify:** sherpa-onnx also does offline TTS + has Node
    bindings — potentially ONE local speech engine across desktop+mobile (ASR+TTS); evaluate
    at SPEECH-2 build vs the faster-whisper desktop lane.
- **UX:** push-to-talk mic in the chat composer (mount rides the views.tsx gate — the button
  itself is a clean component) + in note editors (dictation → text field) + the review runner
  (语音作答 → grade-answer takes the transcript). Recording = MediaRecorder (works in Electron),
  blob → asset store → lane. Always shows the transcript for confirmation before it becomes
  content (preview-gate principle, and kids' recognition errors are common).

## 3. 注音 (SPEECH-3) — the implied third leg
- `pinyin-pro` (offline js lib, ⚠️ verify bundle size + polyphone quality in-task) → ruby
  annotations (`<ruby>字<rt>zì</rt></ruby>`) as a RENDER-LAYER decoration over CJK text.
- **注音模式 toggle**: per-source or global (Settings Hub); rendering hooks in the note render
  path are clean; reader-body annotation rides the reader-gated batch (D-track files).
- Kit default: 小学-grade kits ship `young: {pinyin: true, autoRead: true}` kit config
  (F5 kit-level config slot) — experience in the kit, mechanism in core.

## 4. 低龄复习环 (the payoff scenario)
Review runner + speech = 听题 (auto TTS) → 语音作答 (STT lane) → transcript confirm →
grade-answer → explanation READ ALOUD → next. A 7-year-old runs the full loop without reading
fluency or typing. This is REV-3-adjacent but ships independently (runner files are ours).

## 5. Phasing
- **SPEECH-1** TTS: speechSynthesis service + toSpokenText + 朗读 on cards/runner/onboarding +
  hub settings. Clean files.
- **SPEECH-2** STT: MediaRecorder + lane router (probe/BYOK/managed stubs per what exists) +
  runner 语音作答 + editor dictation; composer mic gated.
- **SPEECH-3** 注音: pinyin-pro + ruby render decoration + 注音模式 + kit young-config;
  reader-body rides the gated batch.

## 6. Tests
toSpokenText per type (quiz order, formula skips TeX); TTS service (mock speechSynthesis —
enable/disable on voice absence, rate); lane router (probe matrix, no-lane typed error,
transcript-confirm gate); runner speech flow jsdom (auto-read fires, 语音作答 feeds
grade-answer only after confirm); ruby decoration (CJK-only, polyphone fixture, toggles off
clean); kit young-config applies defaults.
