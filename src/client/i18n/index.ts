// I18N seed (pulled forward by LIB-2) — the smallest typed core the Library redesign
// needs so NO user-visible string is a hardcoded literal. Scope is deliberately tiny:
// a module-level locale (default "zh", no persistence, no React provider — that whole
// half is I18N-1), `defineMessages` for fully-typed {key: {zh,en}} dictionaries, `t()`
// resolution, and the contribution-facing `LocalizedText` (plain string OR a per-locale
// record) with `resolveText()`. Because `Message` requires EVERY locale, a missing
// translation is a compile error, not a runtime fallback.

export type Locale = "zh" | "en";

const DEFAULT_LOCALE: Locale = "zh";

let currentLocale: Locale = DEFAULT_LOCALE;

/** The active UI locale. Module-level for now; I18N-1 adds persistence + a provider. */
export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale): void {
  currentLocale = locale;
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
