// SPEECH-1/2 route + service tests: /api/speech/tts + /api/speech/stt +
// /api/speech/status against a MOCKED edge synthesizer and a MOCKED stt sidecar
// probe/proxy (the createApp `speech.*` seams — no network, same idiom as the
// injected modelProvider). The real lanes are exercised once manually
// (scripts-level checks), never here.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openVault, type StudyVault } from "../core/vault";
import { createApp } from "./app";
import {
  createSpeechService,
  DEFAULT_STT_BASE_URL,
  DEFAULT_TTS_VOICE,
  STT_MAX_AUDIO_BYTES,
  TTS_MAX_TEXT_LENGTH,
  TTS_VOICES,
  type SttHealthProbe,
  type SttTranscriber
} from "./services/speech";

let tempDir = "";
let vault: StudyVault;

// Collect a binary response body into a Buffer so we can byte-compare the mp3.
function binaryParser(res: any, callback: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
  res.on("error", (err: Error) => callback(err, Buffer.alloc(0)));
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "study-vault-speech-"));
  vault = await openVault({ rootDir: tempDir });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

const FAKE_MP3 = Buffer.from([0xff, 0xf3, 0x64, 0xc4, 0x01, 0x02, 0x03, 0x04]);
const FAKE_WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03, 0x04, 0x05]);

// Hermetic by default: the stt probe resolves DOWN (never touches the network);
// tests inject their own probe/transcriber through the second argument.
function appWith(
  synthesizeEdge: (input: { text: string; voice: string }) => Promise<Buffer>,
  stt: { probeSttHealth?: SttHealthProbe; transcribeStt?: SttTranscriber; sttBaseUrl?: string } = {}
) {
  return createApp({
    vault,
    speech: {
      synthesizeEdge,
      probeSttHealth: stt.probeSttHealth ?? (async () => ({ ok: false })),
      transcribeStt: stt.transcribeStt,
      sttBaseUrl: stt.sttBaseUrl
    }
  });
}

describe("POST /api/speech/tts", () => {
  it("synthesizes with the default zh voice and passes the audio bytes through as audio/mpeg", async () => {
    const synth = vi.fn(async () => FAKE_MP3);
    const response = await request(appWith(synth))
      .post("/api/speech/tts")
      .send({ text: "你好，请朗读这段话。" })
      .buffer()
      .parse(binaryParser)
      .expect(200);

    expect(response.headers["content-type"]).toContain("audio/mpeg");
    expect(Buffer.compare(response.body as Buffer, FAKE_MP3)).toBe(0);
    expect(synth).toHaveBeenCalledExactlyOnceWith({ text: "你好，请朗读这段话。", voice: DEFAULT_TTS_VOICE });
  });

  it("honours a voice override from the curated list", async () => {
    const synth = vi.fn(async () => FAKE_MP3);
    await request(appWith(synth))
      .post("/api/speech/tts")
      .send({ text: "Hello there", voice: "en-US-JennyNeural" })
      .buffer()
      .parse(binaryParser)
      .expect(200);
    expect(synth).toHaveBeenCalledExactlyOnceWith({ text: "Hello there", voice: "en-US-JennyNeural" });
  });

  it("passes a bounded rate override to the edge lane", async () => {
    const synth = vi.fn(async () => FAKE_MP3);
    await request(appWith(synth))
      .post("/api/speech/tts")
      .send({ text: "Hello there", voice: "en-US-JennyNeural", rate: 1.25 })
      .buffer()
      .parse(binaryParser)
      .expect(200);
    expect(synth).toHaveBeenCalledExactlyOnceWith({ text: "Hello there", voice: "en-US-JennyNeural", rate: 1.25 });
  });

  it("rejects empty text with 400 before touching the lane", async () => {
    const synth = vi.fn(async () => FAKE_MP3);
    const response = await request(appWith(synth)).post("/api/speech/tts").send({ text: "" }).expect(400);
    expect(response.body.error).toBe("Invalid request");
    expect(synth).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only text with 400 (trim happens before the min-length gate)", async () => {
    const synth = vi.fn(async () => FAKE_MP3);
    await request(appWith(synth)).post("/api/speech/tts").send({ text: "   \n\t  " }).expect(400);
    expect(synth).not.toHaveBeenCalled();
  });

  it("rejects text past the cap with 400", async () => {
    const synth = vi.fn(async () => FAKE_MP3);
    await request(appWith(synth))
      .post("/api/speech/tts")
      .send({ text: "字".repeat(TTS_MAX_TEXT_LENGTH + 1) })
      .expect(400);
    expect(synth).not.toHaveBeenCalled();
  });

  it("rejects a voice outside the curated list with 400 and a friendly message", async () => {
    const synth = vi.fn(async () => FAKE_MP3);
    const response = await request(appWith(synth))
      .post("/api/speech/tts")
      .send({ text: "你好", voice: "zh-CN-EvilVoice<inject/>" })
      .expect(400);
    expect(response.body.error).toContain("未知语音");
    expect(synth).not.toHaveBeenCalled();
  });

  it("maps a lane failure (offline) to a 502 with the friendly { error, code } body", async () => {
    const synth = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND speech.platform.bing.com");
    });
    const response = await request(appWith(synth)).post("/api/speech/tts").send({ text: "你好" }).expect(502);
    expect(response.body).toEqual({
      error: expect.stringContaining("需要联网"),
      code: "tts_unavailable"
    });
  });

  it("treats a connected-but-empty audio stream as a 502 too (never a 0-byte mp3)", async () => {
    const synth = vi.fn(async () => Buffer.alloc(0));
    const response = await request(appWith(synth)).post("/api/speech/tts").send({ text: "你好" }).expect(502);
    expect(response.body.code).toBe("tts_unavailable");
  });
});

describe("GET /api/speech/status", () => {
  it("reports the edge lane with the curated voices (default first, one en voice)", async () => {
    const response = await request(appWith(vi.fn(async () => FAKE_MP3)))
      .get("/api/speech/status")
      .expect(200);

    expect(response.body.tts).toMatchObject({
      available: true,
      lane: "edge",
      defaultVoice: DEFAULT_TTS_VOICE
    });
    const ids = (response.body.tts.voices as { id: string }[]).map((voice) => voice.id);
    expect(ids).toEqual(TTS_VOICES.map((voice) => voice.id));
    expect(ids[0]).toBe(DEFAULT_TTS_VOICE);
    expect(ids.some((id) => id.startsWith("en-"))).toBe(true);
  });

  it("reports the stt local lane AVAILABLE (with the sidecar's model) when /health answers", async () => {
    const probe = vi.fn(async () => ({ ok: true, model: "large-v3" }));
    const response = await request(appWith(vi.fn(async () => FAKE_MP3), { probeSttHealth: probe }))
      .get("/api/speech/status")
      .expect(200);

    expect(response.body.stt).toEqual({ available: true, lane: "local", model: "large-v3" });
    expect(probe).toHaveBeenCalledExactlyOnceWith(DEFAULT_STT_BASE_URL);
  });

  it("reports the stt lane DOWN with a setup hint when the probe throws (sidecar not running)", async () => {
    const probe = vi.fn(async () => {
      throw new Error("fetch failed: ECONNREFUSED 127.0.0.1:8765");
    });
    const response = await request(appWith(vi.fn(async () => FAKE_MP3), { probeSttHealth: probe }))
      .get("/api/speech/status")
      .expect(200);

    expect(response.body.stt).toMatchObject({ available: false, lane: "local" });
    expect(response.body.stt.setupHint).toContain("stt-sidecar");
  });

  it("honours STUDY_VAULT_STT_URL-style base overrides (probe gets the custom base)", async () => {
    const probe = vi.fn(async () => ({ ok: true }));
    await request(
      appWith(vi.fn(async () => FAKE_MP3), { probeSttHealth: probe, sttBaseUrl: "http://127.0.0.1:9000/" })
    )
      .get("/api/speech/status")
      .expect(200);
    expect(probe).toHaveBeenCalledExactlyOnceWith("http://127.0.0.1:9000");
  });
});

describe("stt probe cache (service-level)", () => {
  it("caches the health probe for ~30s and re-probes after the TTL", async () => {
    const probe = vi.fn(async () => ({ ok: true, model: "small" }));
    let clock = 1_000;
    const service = createSpeechService({ probeSttHealth: probe, now: () => clock });

    await service.status();
    await service.status();
    expect(probe).toHaveBeenCalledTimes(1); // second call inside the TTL → cached

    clock += 31_000;
    await service.status();
    expect(probe).toHaveBeenCalledTimes(2); // TTL expired → fresh probe
  });

  it("a failed transcribe flips the cached availability to down immediately", async () => {
    const probe = vi.fn(async () => ({ ok: true, model: "small" }));
    const transcribe = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    let clock = 1_000;
    const service = createSpeechService({ probeSttHealth: probe, transcribeStt: transcribe, now: () => clock });

    expect((await service.status()).stt.available).toBe(true);
    await expect(service.transcribe({ audio: FAKE_WEBM, mimeType: "audio/webm" })).rejects.toThrow();
    expect((await service.status()).stt.available).toBe(false); // no 30s of stale optimism
    expect(probe).toHaveBeenCalledTimes(1); // the flip came from the transcribe, not a re-probe
  });
});

describe("POST /api/speech/stt", () => {
  it("proxies the audio bytes to the local sidecar and returns { text, language, durationMs }", async () => {
    const transcribe = vi.fn(async (_input: Parameters<SttTranscriber>[0]) => ({
      text: "你好，世界。",
      language: "zh",
      durationMs: 1800
    }));
    const response = await request(appWith(vi.fn(async () => FAKE_MP3), { transcribeStt: transcribe }))
      .post("/api/speech/stt")
      .set("Content-Type", "audio/webm")
      .send(FAKE_WEBM)
      .expect(200);

    expect(response.body).toEqual({ text: "你好，世界。", language: "zh", durationMs: 1800 });
    expect(transcribe).toHaveBeenCalledTimes(1);
    const input = transcribe.mock.calls[0][0];
    expect(input.baseUrl).toBe(DEFAULT_STT_BASE_URL);
    expect(Buffer.compare(input.audio, FAKE_WEBM)).toBe(0);
    expect(input.mimeType).toBe("audio/webm");
    expect(input.language).toBeUndefined();
  });

  it("passes ?language= through to the sidecar", async () => {
    const transcribe = vi.fn(async (_input: Parameters<SttTranscriber>[0]) => ({ text: "hello there", language: "en" }));
    await request(appWith(vi.fn(async () => FAKE_MP3), { transcribeStt: transcribe }))
      .post("/api/speech/stt?language=en")
      .set("Content-Type", "audio/webm")
      .send(FAKE_WEBM)
      .expect(200);
    expect(transcribe.mock.calls[0][0].language).toBe("en");
  });

  it("rejects a malformed language tag with 400 before touching the lane", async () => {
    const transcribe = vi.fn(async () => ({ text: "x" }));
    await request(appWith(vi.fn(async () => FAKE_MP3), { transcribeStt: transcribe }))
      .post("/api/speech/stt?language=<script>")
      .set("Content-Type", "audio/webm")
      .send(FAKE_WEBM)
      .expect(400);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("maps a down sidecar to 502 { error, code: 'stt_unavailable' } pointing at the setup guide", async () => {
    const transcribe = vi.fn(async () => {
      throw new Error("fetch failed: ECONNREFUSED 127.0.0.1:8765");
    });
    const response = await request(appWith(vi.fn(async () => FAKE_MP3), { transcribeStt: transcribe }))
      .post("/api/speech/stt")
      .set("Content-Type", "audio/webm")
      .send(FAKE_WEBM)
      .expect(502);

    expect(response.body.code).toBe("stt_unavailable");
    expect(response.body.error).toContain("stt-sidecar");
  });

  it("rejects a missing/empty audio body with 400", async () => {
    const transcribe = vi.fn(async () => ({ text: "x" }));
    const response = await request(appWith(vi.fn(async () => FAKE_MP3), { transcribeStt: transcribe }))
      .post("/api/speech/stt")
      .set("Content-Type", "audio/webm")
      .send(Buffer.alloc(0))
      .expect(400);
    expect(response.body.code).toBe("stt_bad_audio");
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("caps the audio body at 15MB with an honest 413", async () => {
    const transcribe = vi.fn(async () => ({ text: "x" }));
    const response = await request(appWith(vi.fn(async () => FAKE_MP3), { transcribeStt: transcribe }))
      .post("/api/speech/stt")
      .set("Content-Type", "audio/webm")
      .send(Buffer.alloc(STT_MAX_AUDIO_BYTES + 1))
      .expect(413);
    expect(response.body.code).toBe("stt_audio_too_large");
    expect(transcribe).not.toHaveBeenCalled();
  });
});
