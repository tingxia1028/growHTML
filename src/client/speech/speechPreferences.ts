import { useSyncExternalStore } from "react";
import { getPlatformOptional } from "../platform/platformSingleton";

const KEY = "growte.speech.preferences";
const MIN_RATE = 0.5;
const MAX_RATE = 1.5;

export type SpeechPreferences = {
  voice?: string;
  rate: number;
};

const DEFAULT_PREFS: SpeechPreferences = { rate: 1 };
const listeners = new Set<() => void>();
let prefs = readPrefs();

function clampRate(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_PREFS.rate;
  return Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(n * 100) / 100));
}

function normalize(value: unknown): SpeechPreferences {
  const raw = value && typeof value === "object" ? (value as Partial<SpeechPreferences>) : {};
  const voice = typeof raw.voice === "string" && raw.voice.trim() ? raw.voice.trim() : undefined;
  return { ...(voice ? { voice } : {}), rate: clampRate(raw.rate ?? DEFAULT_PREFS.rate) };
}

function readPrefs(): SpeechPreferences {
  try {
    const prefs = getPlatformOptional()?.prefs;
    const raw = prefs ? prefs.get(KEY) : globalThis.localStorage?.getItem(KEY);
    return raw ? normalize(JSON.parse(raw)) : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): SpeechPreferences {
  return prefs;
}

export function getSpeechPreferences(): SpeechPreferences {
  return prefs;
}

export function setSpeechPreferences(next: Partial<SpeechPreferences>): SpeechPreferences {
  prefs = normalize({ ...prefs, ...next });
  try {
    const store = getPlatformOptional()?.prefs;
    if (store) store.set(KEY, JSON.stringify(prefs));
    else globalThis.localStorage?.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Local persistence is best-effort; the in-memory preference still applies now.
  }
  emit();
  return prefs;
}

export function useSpeechPreferences(): SpeechPreferences {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function resetSpeechPreferencesForTests(): void {
  prefs = DEFAULT_PREFS;
  try {
    const store = getPlatformOptional()?.prefs;
    if (store) store.remove(KEY);
    else globalThis.localStorage?.removeItem(KEY);
  } catch {
    // ignored
  }
  emit();
}
