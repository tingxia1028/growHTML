// useSpeakText (SPEECH-1 — docs/design/speech-and-young-learners.md §1): the client
// half of the 朗读 action. POSTs the text to the server's edge TTS lane, plays the
// returned mp3 via an Audio element + blob URL, and enforces ONE utterance at a time
// (a new speak stops the old; stop() also cancels an in-flight fetch via the seq
// guard). Availability comes from the SHARED speech status cache (speechStatus.ts) —
// fetched ONCE per session, so N mounted 朗读 buttons + mics cost one request.
//
// UI-only state (entity/registry law): no new entities, no vault writes — the audio
// lives and dies in the blob URL.

import { useCallback, useEffect, useRef, useState } from "react";
import { getSpeechStatus, type SpeechTtsStatus } from "./speechStatus";
import { getSpeechPreferences } from "./speechPreferences";

export type { SpeechTtsStatus } from "./speechStatus";
export { resetSpeechStatusCacheForTests } from "./speechStatus";

/** The tts half of the shared status (kept for existing callers of SPEECH-1 vintage). */
export function getSpeechTtsStatus(): Promise<SpeechTtsStatus> {
  return getSpeechStatus().then((status) => status.tts);
}

export type SpeakTextControls = {
  /** Speak this text (stops any current utterance first). Failures are surfaced on `error`. */
  speak(text: string, options?: { voice?: string; rate?: number }): Promise<void>;
  /** Stop the current utterance (and cancel an in-flight synthesis). */
  stop(): void;
  /** True from the moment speak() is called until playback ends/stops/fails. */
  speaking: boolean;
  /** The TTS lane is configured server-side (status probe; false until it resolves). */
  available: boolean;
  /** The last speak() failure's friendly message; cleared by the next speak(). */
  error: string | null;
};

/** Client-side mirror of the server's zod cap — slice instead of erroring at 400. */
const MAX_SPEAK_CHARS = 2000;

export function useSpeakText(): SpeakTextControls {
  const [available, setAvailable] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The live utterance; `seq` invalidates stale async continuations (stop/new speak).
  const currentRef = useRef<{ audio: HTMLAudioElement; url: string } | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    let alive = true;
    void getSpeechStatus().then(({ tts }) => {
      if (alive) setAvailable(!!tts.available);
    });
    return () => {
      alive = false;
    };
  }, []);

  const stop = useCallback(() => {
    seqRef.current += 1;
    const current = currentRef.current;
    currentRef.current = null;
    if (current) {
      current.audio.pause();
      URL.revokeObjectURL(current.url);
    }
    setSpeaking(false);
  }, []);

  // Unmount → stop playback and release the blob URL.
  useEffect(() => stop, [stop]);

  const speak = useCallback(
    async (text: string, options?: { voice?: string; rate?: number }) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      stop(); // one utterance at a time — also bumps the seq, cancelling stale fetches
      const seq = seqRef.current;
      const prefs = getSpeechPreferences();
      const voice = options?.voice ?? prefs.voice;
      const rate = options?.rate ?? prefs.rate;
      setError(null);
      setSpeaking(true);
      try {
        const response = await fetch("/api/speech/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: trimmed.slice(0, MAX_SPEAK_CHARS),
            ...(voice ? { voice } : {}),
            ...(rate !== 1 ? { rate } : {})
          })
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `朗读失败（HTTP ${response.status}）`);
        }
        const blob = await response.blob();
        if (seq !== seqRef.current) return; // superseded by a newer speak()/stop()
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        const finish = () => {
          if (currentRef.current?.audio !== audio) return;
          currentRef.current = null;
          URL.revokeObjectURL(url);
          setSpeaking(false);
        };
        audio.onended = finish;
        audio.onerror = finish;
        currentRef.current = { audio, url };
        await audio.play();
      } catch (cause) {
        if (seq !== seqRef.current) return; // a newer utterance owns the state now
        currentRef.current = null;
        setSpeaking(false);
        setError(cause instanceof Error ? cause.message : "朗读失败");
      }
    },
    [stop]
  );

  return { speak, stop, speaking, available, error };
}
