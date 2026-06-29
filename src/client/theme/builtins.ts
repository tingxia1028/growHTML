// Built-in themes — registered for side effect (imported once at startup, like
// src/kits/clientKits.tsx installs the built-in Product Kits). Ships two themes:
//
//   - "default" (light): declares the FULL --sv-* vocabulary. Every value here is
//     EXACTLY the literal it stands in for in src/client/styles.css, so the default
//     theme renders byte-identical to the pre-theme app. A unit test asserts the
//     default theme's tokens equal DEFAULT_THEME_TOKENS (the documented base palette).
//   - "dark": override-only. It re-declares the surface/text/border/accent/status
//     families inverted for a dark UI, but deliberately OMITS the intrinsic dark
//     surfaces (--sv-dark-*) and the typography/radius/space scales, so those inherit
//     the :root defaults and terminal/code backdrops don't double-darken. NOTE: since
//     the Growte light theme's reader backdrop is white paper, dark DOES override
//     --sv-reader-backdrop back to a dark surface. See docs/design/theme-plugin.md §3.2.

import { registerTheme } from "./registry";

export const DEFAULT_THEME_ID = "default";
export const DARK_THEME_ID = "dark";

// The base palette — the single source of truth for the default theme's token values.
// These MUST mirror the :root defaults in src/client/styles.css value-for-value.
export const DEFAULT_THEME_TOKENS: Record<string, string> = {
  // —— Surfaces & text —— (Growte light, ui-redesign-growte.md §2)
  "--sv-bg": "#f3f4f6",
  "--sv-surface": "#ffffff",
  "--sv-surface-card": "#ffffff",
  "--sv-surface-tag": "#eef0f4",
  "--sv-surface-muted": "#f6f7f9",
  "--sv-active-bg": "#eef2fb",
  "--sv-select-bg": "#cfe0fb",
  "--sv-select-text": "#1f2329",
  "--sv-icon-muted": "#6b7280",
  "--sv-text": "#1f2329",
  "--sv-text-strong": "#11141a",
  "--sv-text-heading": "#11141a",
  "--sv-text-muted": "#6b7280",
  "--sv-text-muted-soft": "#7b828c",
  "--sv-text-faint": "#9aa1ab",
  "--sv-text-subtle": "#6b7280",
  "--sv-text-quote": "#4b515a",
  "--sv-border": "#e6e8ee",
  "--sv-border-soft": "#eef0f4",
  "--sv-border-muted": "#e6e8ee",

  // —— Accent ramp (the Growte blue) ——
  "--sv-accent": "#3b6fe0",
  "--sv-accent-strong": "#2b5bd0",
  "--sv-accent-weak": "#eaf1fe",
  "--sv-accent-weak-hover": "#dbe7fd",
  "--sv-accent-border": "#cfe0fb",
  "--sv-accent-text": "#2b5bd0",
  "--sv-accent-text-strong": "#2451c4",
  "--sv-accent-weak-preview": "#f3f7fe",
  "--sv-on-accent": "#ffffff",

  // —— Semantic status ——
  "--sv-danger": "#d23a32",
  "--sv-danger-strong": "#a32820",
  "--sv-danger-2": "#b3362c",
  "--sv-danger-bg": "#fdf2f1",
  "--sv-danger-bg-strong": "#f6dad7",
  "--sv-danger-bg-tint": "#f6dad7",
  "--sv-warn-accent": "#e0a800",
  "--sv-warn-region": "#f0a500",
  "--sv-warn-text": "#5b4a1e",
  "--sv-warn-bg": "#fdeec3",
  "--sv-fuzzy-bg": "#fdeec3",
  "--sv-fuzzy-text": "#8a6d1f",
  "--sv-success": "#1f8a5b",
  "--sv-success-strong": "#1a7a4f",
  "--sv-success-bg": "#d9f1e4",

  // —— Intrinsic dark surfaces (terminal / code / reader backdrop) ——
  "--sv-dark-surface": "#13161c",
  "--sv-dark-surface-2": "#181c23",
  "--sv-dark-surface-3": "#1b1f27",
  "--sv-reader-backdrop": "#ffffff",
  "--sv-dark-text": "#e6e9ee",
  "--sv-dark-text-2": "#f2f4f7",

  // —— Component accents ——
  "--sv-chat-user-bg": "#e9f1fe",
  "--sv-chat-assistant-bg": "#f5f6f8",
  "--sv-bookmark-dot": "#3b6fe0",
  "--sv-highlight-bg": "#fdeec3",
  "--sv-highlight-text": "#5b4a1e",
  "--sv-connector": "#cdd3dc",
  "--sv-anchor-marker": "#9aa1ab",

  // —— Typography ——
  "--sv-font-sans": 'Inter, "Segoe UI", Arial, sans-serif',
  "--sv-font-mono": "ui-monospace, SFMono-Regular, Menlo, monospace",

  // —— Shape / rhythm ——
  "--sv-radius": "8px",
  "--sv-radius-sm": "6px",
  "--sv-radius-xs": "4px",
  "--sv-radius-pill": "999px",
  "--sv-space-1": "4px",
  "--sv-space-2": "8px",
  "--sv-space-3": "12px",
  "--sv-space-4": "18px"
};

// Dark theme — override-only. Omits --sv-dark-* (intrinsic dark surfaces, already dark)
// and the typography/radius/space scales, which inherit :root. It DOES override
// --sv-reader-backdrop because light's backdrop is white paper, not a dark surface.
export const DARK_THEME_TOKENS: Record<string, string> = {
  "--sv-bg": "#0b0d11",
  "--sv-surface": "#13161c",
  "--sv-surface-card": "#181c23",
  "--sv-surface-tag": "#1b1f27",
  "--sv-surface-muted": "#1b1f27",
  "--sv-active-bg": "#1d2740",
  "--sv-select-bg": "#24344f",
  "--sv-select-text": "#e6e9ee",
  "--sv-icon-muted": "#9aa1ab",
  "--sv-text": "#e6e9ee",
  "--sv-text-strong": "#f2f4f7",
  "--sv-text-heading": "#f2f4f7",
  "--sv-text-muted": "#9aa1ab",
  "--sv-text-muted-soft": "#8b929c",
  "--sv-text-faint": "#6b727c",
  "--sv-text-subtle": "#9aa1ab",
  "--sv-text-quote": "#b6bcc6",
  "--sv-border": "#262b34",
  "--sv-border-soft": "#1e232b",
  "--sv-border-muted": "#262b34",
  "--sv-accent": "#5b8cf5",
  "--sv-accent-strong": "#7aa2f7",
  "--sv-accent-weak": "#1d2740",
  "--sv-accent-weak-hover": "#243150",
  "--sv-accent-border": "#2f4a78",
  "--sv-accent-text": "#9bbcfb",
  "--sv-accent-text-strong": "#b3cdfd",
  "--sv-accent-weak-preview": "#1d2740",
  "--sv-on-accent": "#0b1020",
  "--sv-danger": "#e8857d",
  "--sv-danger-strong": "#f0a59e",
  "--sv-danger-2": "#e8857d",
  "--sv-danger-bg": "#3a2422",
  "--sv-danger-bg-strong": "#4a2a27",
  "--sv-danger-bg-tint": "#4a2a27",
  "--sv-warn-accent": "#e0a800",
  "--sv-warn-region": "#f0a500",
  "--sv-warn-text": "#e9d9a6",
  "--sv-warn-bg": "#3a3320",
  "--sv-fuzzy-bg": "#3a3320",
  "--sv-fuzzy-text": "#e3c87a",
  "--sv-success": "#5fc295",
  "--sv-success-strong": "#74c695",
  "--sv-success-bg": "#143028",
  "--sv-reader-backdrop": "#0e1116",
  "--sv-chat-user-bg": "#1e2a44",
  "--sv-chat-assistant-bg": "#181c23",
  "--sv-bookmark-dot": "#5b8cf5",
  "--sv-highlight-bg": "#3a3320",
  "--sv-highlight-text": "#e9d9a6",
  "--sv-connector": "#2c333d",
  "--sv-anchor-marker": "#6b727c"
};

registerTheme({
  id: DEFAULT_THEME_ID,
  name: "Default",
  colorScheme: "light",
  builtin: true,
  tokens: DEFAULT_THEME_TOKENS
});

registerTheme({
  id: DARK_THEME_ID,
  name: "Dark",
  colorScheme: "dark",
  builtin: true,
  tokens: DARK_THEME_TOKENS
});
