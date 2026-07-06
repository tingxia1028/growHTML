// I18N core: a tiny typed dictionary helper plus a React-visible locale store. The
// exported API stays intentionally small (`defineMessages`, `t`, `setLocale`,
// `LocaleProvider`, `LocalizedText/resolveText`) so feature code can be bilingual
// without bringing in a third-party i18n runtime.

import {
  createContext,
  createElement,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode
} from "react";
import { getPlatformOptional } from "../platform/platformSingleton";

export type Locale = "zh" | "en";

const DEFAULT_LOCALE: Locale = "zh";
const LOCALE_STORAGE_KEY = "growte.locale";

function isLocale(value: unknown): value is Locale {
  return value === "zh" || value === "en";
}

function readStoredLocale(): Locale {
  try {
    const prefs = getPlatformOptional()?.prefs;
    const raw = prefs ? prefs.get(LOCALE_STORAGE_KEY) : globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY);
    return isLocale(raw) ? raw : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

let currentLocale: Locale = readStoredLocale();
const listeners = new Set<() => void>();

/** The active UI locale. */
export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale): void {
  if (currentLocale === locale) return;
  currentLocale = locale;
  try {
    const prefs = getPlatformOptional()?.prefs;
    if (prefs) prefs.set(LOCALE_STORAGE_KEY, locale);
    else globalThis.localStorage?.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage may be unavailable in tests or hardened desktop contexts.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): Locale {
  return currentLocale;
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export type LocaleContextValue = {
  locale: Locale;
  setLocale(locale: Locale): void;
};

const LocaleContext = createContext<LocaleContextValue>({ locale: DEFAULT_LOCALE, setLocale });

export function LocaleProvider({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const value = useMemo(() => ({ locale, setLocale }), [locale]);
  return createElement(LocaleContext.Provider, { value }, children);
}

export function useLocaleContext(): LocaleContextValue {
  return useContext(LocaleContext);
}

/** One translatable string — a value for EVERY locale (missing one = type error). */
export type Message = Readonly<Record<Locale, string>>;

/**
 * Define a message dictionary. Identity at runtime; the generic keeps every entry
 * checked as a complete `Message` while preserving the literal key set for callers.
 */
export function defineMessages<T extends Record<string, Message>>(messages: T): T {
  return messages;
}

/** Resolve a message in the active locale. */
export function t(message: Message): string {
  return message[currentLocale];
}

/**
 * Contribution-facing text (registry titles, hints…): a plain string is used as-is
 * (a kit may ship a single-language label), a record resolves per locale.
 */
export type LocalizedText = string | Message;

export function resolveText(text: LocalizedText): string {
  return typeof text === "string" ? text : text[currentLocale];
}
