# Speech & Young Learners — 朗读(TTS) · 语音输入(STT) · 注音 · 低龄模式

低年级用户有些字不认识:文字要能读出来,语音输入要能替代打字,认不得的字要有拼音。Mechanism =
core organs (speech seams), experience = kit defaults (小学 kit turns them on). Grounded
2026-07-02.

## 1. 朗读 TTS (SPEECH-1) — roundtable absorption (user-directed 2026-07-02)
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

## 2. 语音输入 STT (SPEECH-2) — honest China/Electron reality
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
