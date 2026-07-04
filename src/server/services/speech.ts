// Speech service (SPEECH-1 — docs/design/speech-and-young-learners.md §1): server-side
// TTS through the "modality lanes" pattern (the same recurring shape as vision/OCR and
// STT). V1 ships ONE lane — `edge` — the msedge-tts port of edge-tts: Microsoft Edge
// read-aloud neural voices over wss, free and KEYLESS but ONLINE (it talks to
// Microsoft; the protocol needs a custom Sec-WebSocket-Version handshake that only
// Node can set, which is why this lives in the server, never the browser). The lane
// seam exists so `local` (sherpa-onnx / OS voices) and `managed` (gateway-priced
// cloud TTS) slot in later WITHOUT reshaping callers: the service owns lane pick +
// friendly failure; routes/clients only ever see synthesize()/status().
//
// The edge synthesizer is INJECTABLE (createApp's `speech.synthesizeEdge`, same seam
// style as the AI provider manager's injected ModelProvider) so tests never touch the
// network. Offline / Microsoft unreachable → SpeechSynthesisFailedError, which the
// route maps to a 502 with the usual { error, code } body — graceful, honest error.

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
  voice: z.string().min(1).optional()
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

/** One lane's synthesizer: text+voice in, encoded audio bytes out (mp3 for edge). */
export type EdgeTtsSynthesizer = (input: { text: string; voice: string }) => Promise<Buffer>;

export type SpeechStatus = {
  tts: {
    available: boolean;
    lane: "edge";
    defaultVoice: string;
    voices: readonly TtsVoice[];
  };
};

export type SpeechService = {
  synthesize(input: { text: string; voice?: string }): Promise<{ audio: Buffer; mimeType: "audio/mpeg"; voice: string }>;
  status(): SpeechStatus;
};

/** Friendly failure the client can show verbatim (edge lane = keyless but ONLINE). */
const EDGE_FAILURE_MESSAGE =
  "朗读服务暂时不可用：edge 语音通道需要联网（连接微软语音服务失败）。请检查网络后重试。";

/** Don't hold a request hostage on a hung wss handshake. */
const EDGE_SYNTH_TIMEOUT_MS = 30_000;

// The REAL edge lane: msedge-tts over wss. Lazily imported (roundtable's lazy-import +
// graceful-degrade pattern) so the module never loads in tests that inject a mock, and
// a broken install degrades to the friendly 502 instead of failing app boot. A fresh
// client per call keeps the ws lifecycle trivially correct (mirrors tts.py's fresh
// asyncio.run per request); close() in finally releases the socket either way.
const defaultEdgeSynthesizer: EdgeTtsSynthesizer = async ({ text, voice }) => {
  const { MsEdgeTTS, OUTPUT_FORMAT } = await import("msedge-tts");
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text);
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
};

export function createSpeechService(options: SpeechServiceOptions = {}): SpeechService {
  const synthesizeEdge = options.synthesizeEdge ?? defaultEdgeSynthesizer;

  return {
    async synthesize({ text, voice }) {
      const voiceId = voice ?? DEFAULT_TTS_VOICE;
      // The voice goes into the SSML template verbatim — restrict it to the curated
      // list (a 400: the caller named a voice we don't offer, not an upstream fault).
      if (!TTS_VOICES.some((candidate) => candidate.id === voiceId)) {
        throw new ValidationError(`未知语音 "${voiceId}"，可用语音见 GET /api/speech/status`);
      }
      let audio: Buffer;
      try {
        audio = await withTimeout(synthesizeEdge({ text, voice: voiceId }), EDGE_SYNTH_TIMEOUT_MS);
      } catch {
        throw new SpeechSynthesisFailedError(EDGE_FAILURE_MESSAGE);
      }
      // A connected-but-empty stream is still a failure — never hand back a 0-byte mp3.
      if (audio.length === 0) throw new SpeechSynthesisFailedError(EDGE_FAILURE_MESSAGE);
      return { audio, mimeType: "audio/mpeg", voice: voiceId };
    },

    status() {
      // V1: the edge lane is always CONFIGURED (available = the lane exists; being an
      // online service, actual reachability only shows at synthesize time → 502).
      // When local/managed lanes land, this reports per-lane availability honestly.
      return {
        tts: { available: true, lane: "edge", defaultVoice: DEFAULT_TTS_VOICE, voices: TTS_VOICES }
      };
    }
  };
}
