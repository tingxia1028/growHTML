// Speech service (SPEECH-1/2 — docs/design/speech-and-young-learners.md §1–2):
// server-side TTS **and STT** through the "modality lanes" pattern (the same recurring
// shape as vision/OCR). TTS V1 lane = `edge` — the msedge-tts port of edge-tts:
// Microsoft Edge read-aloud neural voices over wss, free and KEYLESS but ONLINE (it
// talks to Microsoft; the protocol needs a custom Sec-WebSocket-Version handshake that
// only Node can set, which is why this lives in the server, never the browser).
// STT V1 lane = `local` (SPEECH-2, kit-flatten-and-core-review.md §4): a detected
// faster-whisper SIDECAR (scripts/stt-sidecar — roundtable stt.py adapted), fully
// offline and free; availability = a short GET /health probe (cached ~30s) so the mic
// 点亮s only when the engine is really there; transcribe = proxy the recorded audio
// to the sidecar. The lane seams exist so `managed` (gateway-priced) and BYOK
// audio-model lanes slot in later WITHOUT reshaping callers: the service owns lane
// pick + friendly failure; routes/clients only see synthesize()/transcribe()/status().
//
// The edge synthesizer AND the stt probe/proxy are INJECTABLE (createApp's `speech.*`,
// same seam style as the AI provider manager's injected ModelProvider) so tests never
// touch the network. Offline / engine down → SpeechSynthesisFailedError /
// SpeechTranscriptionFailedError, which the routes map to a 502 with the usual
// { error, code } body — graceful, honest errors.

import { z } from "zod";
import { ValidationError } from "./errors";

/** Hard cap on one utterance (the client slices before sending; zod re-guards). */
export const TTS_MAX_TEXT_LENGTH = 2000;

/** Neural voice the 朗读 button uses when the caller names none (roundtable's pick). */
export const DEFAULT_TTS_VOICE = "zh-CN-XiaoxiaoNeural";

// The curated shortlist (roundtable tts.py absorbed the same idea: a small, GOOD set
// the UI mirrors, not the full Azure catalog). zh voices lead — the target users are
// 低年级 kids reading Chinese; one en voice for English passages.
export const TTS_VOICES = [
  { id: "zh-CN-XiaoxiaoNeural", label: "晓晓（女声·温暖）", locale: "zh-CN" },
  { id: "zh-CN-YunxiNeural", label: "云希（男声·少年）", locale: "zh-CN" },
  { id: "zh-CN-XiaoyiNeural", label: "晓伊（女声·活泼）", locale: "zh-CN" },
  { id: "en-US-JennyNeural", label: "Jenny (English)", locale: "en-US" }
] as const;

export type TtsVoice = (typeof TTS_VOICES)[number];

/** Body for POST /api/speech/tts. */
export const ttsRequestSchema = z.object({
  text: z.string().trim().min(1).max(TTS_MAX_TEXT_LENGTH),
  voice: z.string().min(1).optional(),
  rate: z.number().min(0.5).max(1.5).optional()
});
export type TtsRequestInput = z.infer<typeof ttsRequestSchema>;

/**
 * The edge lane could not produce audio (offline, Microsoft unreachable, protocol
 * drift). The route maps this to HTTP 502 — the failure is upstream, not the caller's.
 */
export class SpeechSynthesisFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpeechSynthesisFailedError";
  }
}

/**
 * The local STT lane could not transcribe (sidecar not running / crashed mid-request).
 * The route maps this to HTTP 502 `{ error, code: "stt_unavailable" }` — the fix is
 * starting the sidecar (setup guide), never a client-side retry loop.
 */
export class SpeechTranscriptionFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpeechTranscriptionFailedError";
  }
}

/** One lane's synthesizer: text+voice in, encoded audio bytes out (mp3 for edge). */
export type EdgeTtsSynthesizer = (input: { text: string; voice: string; rate?: number }) => Promise<Buffer>;

/** Local-lane health probe: sidecar base URL in, its /health readout out (throw = down). */
export type SttHealthProbe = (baseUrl: string) => Promise<{ ok: boolean; model?: string }>;

/** Local-lane transcriber: recorded audio in, the sidecar's transcript out (throw = down). */
export type SttTranscriber = (input: {
  baseUrl: string;
  audio: Buffer;
  mimeType: string;
  language?: string;
}) => Promise<{ text: string; language?: string; durationMs?: number }>;

export type SttLaneStatus = {
  /** REAL probe result (unlike tts V1's "configured" semantics) — the mic 点亮 gate. */
  available: boolean;
  lane: "local";
  /** The sidecar's loaded/configured model, when it answered the probe. */
  model?: string;
  /** Friendly pointer at the one-click setup guide, present when unavailable. */
  setupHint?: string;
};

export type SpeechStatus = {
  tts: {
    available: boolean;
    lane: "edge";
    defaultVoice: string;
    voices: readonly TtsVoice[];
  };
  stt: SttLaneStatus;
};

export type SpeechService = {
  synthesize(input: { text: string; voice?: string; rate?: number }): Promise<{ audio: Buffer; mimeType: "audio/mpeg"; voice: string }>;
  transcribe(input: {
    audio: Buffer;
    mimeType: string;
    language?: string;
  }): Promise<{ text: string; language?: string; durationMs?: number }>;
  status(): Promise<SpeechStatus>;
};

/** Friendly failure the client can show verbatim (edge lane = keyless but ONLINE). */
const EDGE_FAILURE_MESSAGE =
  "朗读服务暂时不可用：edge 语音通道需要联网（连接微软语音服务失败）。请检查网络后重试。";

/** Don't hold a request hostage on a hung wss handshake. */
const EDGE_SYNTH_TIMEOUT_MS = 30_000;

// —— STT local lane (SPEECH-2) ————————————————————————————————————————————————

/** Hard cap on one recorded utterance — push-to-talk segments, not podcast files. */
export const STT_MAX_AUDIO_BYTES = 15 * 1024 * 1024;

/** Where the faster-whisper sidecar listens unless STUDY_VAULT_STT_URL overrides. */
export const DEFAULT_STT_BASE_URL = "http://127.0.0.1:8765";

/** The one-click setup pointer (VoiceInputButton renders the same steps as a panel). */
export const STT_SETUP_HINT =
  "本地语音识别引擎（faster-whisper sidecar）未运行。三步启动：进入 scripts/stt-sidecar，" +
  "python -m venv .venv 并激活 → pip install -r requirements.txt → python server.py。" +
  "详见 scripts/stt-sidecar/README.md。";

/** Friendly 502 body for a down sidecar — recognition is LOCAL, so the fix is local too. */
const STT_FAILURE_MESSAGE = `语音识别暂时不可用：${STT_SETUP_HINT}`;

/** The probe must never make /api/speech/status feel slow — fail fast, cache below. */
const STT_PROBE_TIMEOUT_MS = 800;

/** Probe cache TTL: N mounted mics + repeated status calls cost one health check. */
const STT_STATUS_CACHE_MS = 30_000;

/** First transcription can pay model-load time on the sidecar — be generous here. */
const STT_TRANSCRIBE_TIMEOUT_MS = 120_000;

/** ?language= on /api/speech/stt — a BCP-47-ish tag the sidecar hands to whisper. */
export const sttQuerySchema = z.object({
  language: z
    .string()
    .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/, "language 需为 zh / en / zh-CN 这类语言标签")
    .optional()
});

// The REAL local lane, split in two injectable halves (tests mock both):
// health probe (availability) + transcribe proxy (the audio roundtrip). Both use the
// global fetch — the sidecar is plain loopback HTTP, no special handshake needed.
const defaultSttProbe: SttHealthProbe = async (baseUrl) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STT_PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: controller.signal });
    if (!response.ok) return { ok: false };
    const body = (await response.json().catch(() => ({}))) as { ok?: boolean; model?: string };
    return { ok: body.ok !== false, model: typeof body.model === "string" ? body.model : undefined };
  } finally {
    clearTimeout(timer);
  }
};

const defaultSttTranscriber: SttTranscriber = async ({ baseUrl, audio, mimeType, language }) => {
  const url = new URL(`${baseUrl}/transcribe`);
  if (language) url.searchParams.set("language", language);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STT_TRANSCRIBE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": mimeType || "application/octet-stream" },
      body: new Uint8Array(audio),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`stt sidecar answered ${response.status}`);
    const body = (await response.json()) as { text?: string; language?: string; durationMs?: number };
    if (typeof body.text !== "string") throw new Error("stt sidecar returned no text field");
    return {
      text: body.text,
      language: typeof body.language === "string" ? body.language : undefined,
      durationMs: typeof body.durationMs === "number" ? body.durationMs : undefined
    };
  } finally {
    clearTimeout(timer);
  }
};

// The REAL edge lane: msedge-tts over wss. Lazily imported (roundtable's lazy-import +
// graceful-degrade pattern) so the module never loads in tests that inject a mock, and
// a broken install degrades to the friendly 502 instead of failing app boot. A fresh
// client per call keeps the ws lifecycle trivially correct (mirrors tts.py's fresh
// asyncio.run per request); close() in finally releases the socket either way.
const defaultEdgeSynthesizer: EdgeTtsSynthesizer = async ({ text, voice, rate }) => {
  const { MsEdgeTTS, OUTPUT_FORMAT } = await import("msedge-tts");
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = rate === undefined ? tts.toStream(text) : tts.toStream(text, { rate });
    const chunks: Buffer[] = [];
    for await (const chunk of audioStream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  } finally {
    tts.close();
  }
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`edge-tts timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export type SpeechServiceOptions = {
  /** Edge-lane synthesizer override (tests inject a mock; default = msedge-tts). */
  synthesizeEdge?: EdgeTtsSynthesizer;
  /** STT local-lane health probe override (tests inject; default = GET /health). */
  probeSttHealth?: SttHealthProbe;
  /** STT local-lane transcriber override (tests inject; default = POST /transcribe). */
  transcribeStt?: SttTranscriber;
  /** Sidecar base URL override (default: STUDY_VAULT_STT_URL env, then 127.0.0.1:8765). */
  sttBaseUrl?: string;
  /** Clock override so tests can drive the probe cache's TTL. */
  now?: () => number;
};

export function createSpeechService(options: SpeechServiceOptions = {}): SpeechService {
  const synthesizeEdge = options.synthesizeEdge ?? defaultEdgeSynthesizer;
  const probeSttHealth = options.probeSttHealth ?? defaultSttProbe;
  const transcribeStt = options.transcribeStt ?? defaultSttTranscriber;
  const now = options.now ?? Date.now;
  const sttBaseUrl = (options.sttBaseUrl ?? process.env.STUDY_VAULT_STT_URL ?? DEFAULT_STT_BASE_URL).replace(/\/+$/, "");

  // Probe cache: N mounted mics / repeated status fetches share ONE health check per
  // TTL window. Both up AND down results are cached — a freshly started sidecar shows
  // up within 30s, and a dead one doesn't get hammered.
  let sttCache: { at: number; value: SttLaneStatus } | null = null;
  const probeSttLane = async (): Promise<SttLaneStatus> => {
    const at = now();
    if (sttCache && at - sttCache.at < STT_STATUS_CACHE_MS) return sttCache.value;
    let value: SttLaneStatus;
    try {
      const health = await probeSttHealth(sttBaseUrl);
      value = health.ok
        ? { available: true, lane: "local", ...(health.model ? { model: health.model } : {}) }
        : { available: false, lane: "local", setupHint: STT_SETUP_HINT };
    } catch {
      value = { available: false, lane: "local", setupHint: STT_SETUP_HINT };
    }
    sttCache = { at, value };
    return value;
  };

  return {
    async synthesize({ text, voice, rate }) {
      const voiceId = voice ?? DEFAULT_TTS_VOICE;
      // The voice goes into the SSML template verbatim — restrict it to the curated
      // list (a 400: the caller named a voice we don't offer, not an upstream fault).
      if (!TTS_VOICES.some((candidate) => candidate.id === voiceId)) {
        throw new ValidationError(`未知语音 "${voiceId}"，可用语音见 GET /api/speech/status`);
      }
      let audio: Buffer;
      try {
        audio = await withTimeout(
          synthesizeEdge({ text, voice: voiceId, ...(rate !== undefined ? { rate } : {}) }),
          EDGE_SYNTH_TIMEOUT_MS
        );
      } catch {
        throw new SpeechSynthesisFailedError(EDGE_FAILURE_MESSAGE);
      }
      // A connected-but-empty stream is still a failure — never hand back a 0-byte mp3.
      if (audio.length === 0) throw new SpeechSynthesisFailedError(EDGE_FAILURE_MESSAGE);
      return { audio, mimeType: "audio/mpeg", voice: voiceId };
    },

    async transcribe({ audio, mimeType, language }) {
      // Route-level body limits re-guarded here so non-HTTP hosts get the same caps.
      if (audio.length === 0) throw new ValidationError("音频为空 — 请先录一段话再上传");
      if (audio.length > STT_MAX_AUDIO_BYTES) {
        throw new ValidationError(`音频超过 ${Math.floor(STT_MAX_AUDIO_BYTES / (1024 * 1024))}MB 上限 — 请分段录音`);
      }
      try {
        const result = await transcribeStt({ baseUrl: sttBaseUrl, audio, mimeType, language });
        // A successful roundtrip IS a health signal — refresh the cache so the mic
        // lights up immediately after the user starts the sidecar mid-session.
        sttCache = { at: now(), value: { available: true, lane: "local" } };
        return { text: result.text.trim(), language: result.language, durationMs: result.durationMs };
      } catch {
        // And a failed one un-lights it: drop the cached "available" optimism.
        sttCache = { at: now(), value: { available: false, lane: "local", setupHint: STT_SETUP_HINT } };
        throw new SpeechTranscriptionFailedError(STT_FAILURE_MESSAGE);
      }
    },

    async status() {
      // tts V1: the edge lane is always CONFIGURED (available = the lane exists; being
      // an online service, actual reachability only shows at synthesize time → 502).
      // stt V1: availability is the REAL local probe result (cached) — the client's
      // mic 点亮s only when the sidecar truly answers /health.
      return {
        tts: { available: true, lane: "edge", defaultVoice: DEFAULT_TTS_VOICE, voices: TTS_VOICES },
        stt: await probeSttLane()
      };
    }
  };
}
