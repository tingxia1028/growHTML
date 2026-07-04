// SPEECH-1 route + service tests: /api/speech/tts + /api/speech/status against a
// MOCKED edge synthesizer (the createApp `speech.synthesizeEdge` seam — no network,
// same idiom as the injected modelProvider). The real wss lane is exercised once
// manually (scripts-level check), never here.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openVault, type StudyVault } from "../core/vault";
import { createApp } from "./app";
import { DEFAULT_TTS_VOICE, TTS_MAX_TEXT_LENGTH, TTS_VOICES } from "./services/speech";

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

function appWith(synthesizeEdge: (input: { text: string; voice: string }) => Promise<Buffer>) {
  return createApp({ vault, speech: { synthesizeEdge } });
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
});
