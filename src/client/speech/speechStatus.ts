// Shared speech status cache (SPEECH-1/2): ONE session-wide fetch of
// GET /api/speech/status serves every mounted 朗读 button AND every mic — the tts
// half gates SpeakButton, the stt half (a REAL sidecar probe server-side) gates
// VoiceInputButton and carries the setup hint when the local engine isn't running.
// Factored out of useSpeakText when useVoiceInput arrived so neither hook owns the
// cache privately (abstract-recurring-capabilities: one capability, one impl).

export type SpeechTtsStatus = {
  available: boolean;
  lane: string;
  defaultVoice?: string;
  voices?: { id: string; label: string; locale: string }[];
};

export type SpeechSttStatus = {
  available: boolean;
  lane: string;
  model?: string;
  setupHint?: string;
};

export type SpeechStatusView = {
  tts: SpeechTtsStatus;
  stt: SpeechSttStatus;
};

const UNAVAILABLE: SpeechStatusView = {
  tts: { available: false, lane: "edge" },
  stt: { available: false, lane: "local" }
};

// Session-wide status cache. A FAILED probe resets the cache so a later mount retries
// (the server may simply not be up yet in dev), but resolves unavailable for now.
let statusPromise: Promise<SpeechStatusView> | null = null;

export function getSpeechStatus(): Promise<SpeechStatusView> {
  if (!statusPromise) {
    statusPromise = fetch("/api/speech/status")
      .then(async (response) => {
        if (!response.ok) throw new Error(`speech status ${response.status}`);
        const body = (await response.json()) as { tts?: SpeechTtsStatus; stt?: SpeechSttStatus };
        return { tts: body.tts ?? UNAVAILABLE.tts, stt: body.stt ?? UNAVAILABLE.stt };
      })
      .catch(() => {
        statusPromise = null;
        return UNAVAILABLE;
      });
  }
  return statusPromise;
}

/** Tests only: drop the module-level status cache between cases. */
export function resetSpeechStatusCacheForTests(): void {
  statusPromise = null;
}
