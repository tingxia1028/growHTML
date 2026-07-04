// useVoiceInput (SPEECH-2 — docs/design/speech-and-young-learners.md §2): the client
// half of 语音输入. MediaRecorder captures a push-to-talk segment (webm/opus with
// fallbacks), which is POSTed as-is to the server's LOCAL stt lane (the faster-whisper
// sidecar proxy) — recognition runs on the user's machine, costs nothing, and the
// transcript comes back as plain text for the EXISTING flows (no LLM in this step).
//
// State machine: idle → recording → transcribing → idle (+transcript). The transcript
// is NOT auto-inserted anywhere — VoiceInputButton shows it in a confirm popover first
// (preview-gate principle: kids' recognition errors must never silently enter notes).
// Availability comes from the SHARED speech status cache (one fetch serves this hook
// and useSpeakText); a seq guard makes cancel()/unmount discard stale async results.
//
// UI-only state: no entities, no vault writes — the recording lives and dies in RAM.

import { useCallback, useEffect, useRef, useState } from "react";
import { getSpeechStatus } from "./speechStatus";

export type VoiceInputState = "idle" | "recording" | "transcribing";

export type VoiceInputControls = {
  /** Ask for the mic and start recording (no-op unless available and idle). */
  start(): Promise<void>;
  /** Stop recording and send the segment off for transcription. */
  stop(): void;
  /** Discard everything: an active recording, an in-flight transcription, a pending transcript. */
  cancel(): void;
  state: VoiceInputState;
  /** The last transcription result, awaiting the caller's confirm UX. */
  transcript: string | null;
  /** Clear the pending transcript (confirm-consumed / 重录 / 取消). */
  clearTranscript(): void;
  error: string | null;
  /** The LOCAL stt lane answered the health probe (from the shared cached status). */
  available: boolean;
  /** Friendly setup pointer when the sidecar isn't running (renders as the guide panel). */
  setupHint: string | null;
};

// Preference order for the recording container; the first one this Chromium supports
// wins. Electron/Chrome take webm/opus; mp4/ogg cover other embedders.
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

type MediaRecorderCtor = {
  new (stream: MediaStream, options?: { mimeType?: string }): MediaRecorder;
  isTypeSupported?(type: string): boolean;
};

function pickMimeType(recorderCtor: MediaRecorderCtor): string | undefined {
  if (typeof recorderCtor.isTypeSupported !== "function") return MIME_CANDIDATES[0];
  return MIME_CANDIDATES.find((type) => recorderCtor.isTypeSupported!(type));
}

/** One recording in flight: the recorder + its stream + collected chunks. */
type RecordingSession = {
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  /** cancel() flips this so onstop discards instead of transcribing. */
  cancelled: boolean;
};

export function useVoiceInput(options: { language?: string } = {}): VoiceInputControls {
  const language = options.language ?? "zh";
  const [available, setAvailable] = useState(false);
  const [setupHint, setSetupHint] = useState<string | null>(null);
  const [state, setState] = useState<VoiceInputState>("idle");
  const [transcript, setTranscript] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<RecordingSession | null>(null);
  // Bumping seq invalidates every pending async continuation (cancel / unmount).
  const seqRef = useRef(0);

  useEffect(() => {
    let alive = true;
    void getSpeechStatus().then(({ stt }) => {
      if (!alive) return;
      setAvailable(!!stt.available);
      setSetupHint(stt.setupHint ?? null);
    });
    return () => {
      alive = false;
    };
  }, []);

  const releaseSession = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (!session) return;
    session.cancelled = true;
    if (session.recorder.state !== "inactive") {
      try {
        session.recorder.stop();
      } catch {
        // already stopped — releasing the tracks below is what matters
      }
    }
    session.stream.getTracks().forEach((track) => track.stop());
  }, []);

  const cancel = useCallback(() => {
    seqRef.current += 1;
    releaseSession();
    setTranscript(null);
    setError(null);
    setState("idle");
  }, [releaseSession]);

  // Unmount → drop the mic and orphan any in-flight fetch.
  useEffect(() => cancel, [cancel]);

  const transcribeBlob = useCallback(
    async (blob: Blob, seq: number) => {
      try {
        const response = await fetch(`/api/speech/stt?language=${encodeURIComponent(language)}`, {
          method: "POST",
          headers: { "Content-Type": blob.type || "audio/webm" },
          body: blob
        });
        if (seq !== seqRef.current) return; // cancelled while in flight
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `语音识别失败（HTTP ${response.status}）`);
        }
        const body = (await response.json()) as { text?: string };
        if (seq !== seqRef.current) return;
        const text = (body.text ?? "").trim();
        if (!text) {
          setError("没有识别到文字 — 请靠近麦克风再试一次");
          setState("idle");
          return;
        }
        setTranscript(text);
        setState("idle");
      } catch (cause) {
        if (seq !== seqRef.current) return;
        setError(cause instanceof Error ? cause.message : "语音识别失败");
        setState("idle");
      }
    },
    [language]
  );

  const start = useCallback(async () => {
    if (!available || sessionRef.current) return;
    const recorderCtor = (globalThis as { MediaRecorder?: MediaRecorderCtor }).MediaRecorder;
    if (!recorderCtor || !navigator.mediaDevices?.getUserMedia) {
      setError("此环境不支持录音（缺少 MediaRecorder）");
      return;
    }
    seqRef.current += 1;
    const seq = seqRef.current;
    setError(null);
    setTranscript(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      if (seq === seqRef.current) setError("无法访问麦克风 — 请检查系统权限");
      return;
    }
    if (seq !== seqRef.current) {
      // cancelled while the permission prompt was up
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    const mimeType = pickMimeType(recorderCtor);
    const recorder = new recorderCtor(stream, mimeType ? { mimeType } : undefined);
    const session: RecordingSession = { recorder, stream, chunks: [], cancelled: false };
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) session.chunks.push(event.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      if (session.cancelled || seq !== seqRef.current) return;
      sessionRef.current = null;
      const blob = new Blob(session.chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
      if (blob.size === 0) {
        setError("没有录到声音 — 请再试一次");
        setState("idle");
        return;
      }
      void transcribeBlob(blob, seq);
    };
    sessionRef.current = session;
    recorder.start();
    setState("recording");
  }, [available, transcribeBlob]);

  const stop = useCallback(() => {
    const session = sessionRef.current;
    if (!session || session.recorder.state === "inactive") return;
    setState("transcribing");
    session.recorder.stop(); // onstop assembles the blob and posts it
  }, []);

  const clearTranscript = useCallback(() => {
    setTranscript(null);
  }, []);

  return { start, stop, cancel, state, transcript, clearTranscript, error, available, setupHint };
}
