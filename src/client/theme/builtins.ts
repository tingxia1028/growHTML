// Built-in themes — registered for side effect (imported once at startup, like
// src/kits/clientKits.tsx installs the built-in Product Kits). Ships two themes:
//
//   - "default" (light): declares the FULL --sv-* vocabulary. Every value here is
//     EXACTLY the literal it stands in for in src/client/styles.css, so the default
//     theme renders byte-identical to the pre-theme app. A unit test asserts the
//     default theme's tokens equal DEFAULT_THEME_TOKENS (the documented base palette).
//   - "dark": override-only. It re-declares the surface/text/border/accent/status
//     families inverted for a dark UI, but deliberately OMITS the intrinsic dark
//     surfaces (--sv-dark-*, --sv-reader-backdrop) and the typography/radius/space
//     scales, so those inherit the :root defaults and terminal/code/pdf backdrops
//     don't double-darken. See docs/design/theme-plugin.md §3.2.

import { registerTheme } from "./registry";

export const DEFAULT_THEME_ID = "default";
export const DARK_THEME_ID = "dark";

// The base palette — the single source of truth for the default theme's token values.
// These MUST mirror the :root defaults in src/client/styles.css value-for-value.
export const DEFAULT_THEME_TOKENS: Record<string, string> = {
  // —— Surfaces & text ——
  "--sv-bg": "#f4f1ea",
  "--sv-surface": "#fbfaf7",
  "--sv-surface-card": "#ffffff",
  "--sv-surface-tag": "#efe9dc",
  "--sv-surface-muted": "#f1ece1",
  "--sv-active-bg": "#e2efe9",
  "--sv-select-bg": "#fffdf5",
  "--sv-select-text": "#5c5340",
  "--sv-icon-muted": "#8a8579",
  "--sv-text": "#202124",
  "--sv-text-strong": "#24302c",
  "--sv-text-heading": "#39423e",
  "--sv-text-muted": "#66756a",
  "--sv-text-muted-soft": "#68706a",
  "--sv-text-faint": "#70766f",
  "--sv-text-subtle": "#5b6058",
  "--sv-text-quote": "#4a4f48",
  "--sv-border": "#d8d2c6",
  "--sv-border-soft": "#e2dccd",
  "--sv-border-muted": "#ddd7cc",

  // —— Accent ramp (the teal/green) ——
  "--sv-accent": "#2f6f64",
  "--sv-accent-strong": "#285c52",
  "--sv-accent-weak": "#edf6f3",
  "--sv-accent-weak-hover": "#ddeee8",
  "--sv-accent-border": "#cfe3dd",
  "--sv-accent-text": "#1f5c4f",
  "--sv-accent-text-strong": "#1f534b",
  "--sv-accent-weak-preview": "#f3faf7",
  "--sv-on-accent": "#ffffff",

  // —— Semantic status ——
  "--sv-danger": "#b3261e",
  "--sv-danger-strong": "#842020",
  "--sv-danger-2": "#9a3127",
  "--sv-danger-bg": "#fff5f5",
  "--sv-danger-bg-strong": "#f4dada",
  "--sv-danger-bg-tint": "#f6dad7",
  "--sv-warn-accent": "#e0a800",
  "--sv-warn-region": "#f0a500",
  "--sv-warn-text": "#604510",
  "--sv-warn-bg": "#f5e8be",
  "--sv-fuzzy-bg": "#fbeed2",
  "--sv-fuzzy-text": "#8a6d1f",
  "--sv-success": "#1f6b4a",
  "--sv-success-strong": "#2f7d54",
  "--sv-success-bg": "#d6efe3",

  // —— Intrinsic dark surfaces (terminal / code / reader backdrop) ——
  "--sv-dark-surface": "#1e1b16",
  "--sv-dark-surface-2": "#1f2622",
  "--sv-dark-surface-3": "#2c2a26",
  "--sv-reader-backdrop": "#555049",
  "--sv-dark-text": "#e6e3da",
  "--sv-dark-text-2": "#f1ece1",

  // —— Component accents ——
  "--sv-chat-user-bg": "#e8efe4",
  "--sv-chat-assistant-bg": "#f2ede0",
  "--sv-bookmark-dot": "#3b82f6",

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

// Dark theme — override-only. Omits --sv-dark-*/--sv-reader-backdrop (intrinsic dark
// surfaces, already dark) and the typography/radius/space scales, which inherit :root.
export const DARK_THEME_TOKENS: Record<string, string> = {
  "--sv-bg": "#1b1a17",
  "--sv-surface": "#232220",
  "--sv-surface-card": "#2b2a27",
  "--sv-surface-tag": "#33312c",
  "--sv-surface-muted": "#2b2a27",
  "--sv-active-bg": "#1f3a35",
  "--sv-select-bg": "#2b2a27",
  "--sv-select-text": "#c4bfb4",
  "--sv-icon-muted": "#8b857a",
  "--sv-text": "#e8e4da",
  "--sv-text-strong": "#f2efe6",
  "--sv-text-heading": "#e8e4da",
  "--sv-text-muted": "#a59f93",
  "--sv-text-muted-soft": "#9a9488",
  "--sv-text-faint": "#8b857a",
  "--sv-text-subtle": "#9a9488",
  "--sv-text-quote": "#c4bfb4",
  "--sv-border": "#3a3833",
  "--sv-border-soft": "#322f2a",
  "--sv-border-muted": "#3a3833",
  "--sv-accent": "#5fb6a4",
  "--sv-accent-strong": "#74c6b4",
  "--sv-accent-weak": "#1f3a35",
  "--sv-accent-weak-hover": "#25453f",
  "--sv-accent-border": "#2d534b",
  "--sv-accent-text": "#9fe0d2",
  "--sv-accent-text-strong": "#9fe0d2",
  "--sv-accent-weak-preview": "#1f3a35",
  "--sv-on-accent": "#11221f",
  "--sv-danger": "#e8857d",
  "--sv-danger-strong": "#f0a59e",
  "--sv-danger-2": "#e8857d",
  "--sv-danger-bg": "#3a2422",
  "--sv-danger-bg-strong": "#4a2a27",
  "--sv-danger-bg-tint": "#4a2a27",
  "--sv-warn-accent": "#e0a800",
  "--sv-warn-region": "#f0a500",
  "--sv-warn-text": "#e3c87a",
  "--sv-warn-bg": "#3a3220",
  "--sv-fuzzy-bg": "#3a3220",
  "--sv-fuzzy-text": "#e3c87a",
  "--sv-success": "#5fc295",
  "--sv-success-strong": "#74c695",
  "--sv-success-bg": "#1f3a2e",
  "--sv-chat-user-bg": "#1f3a35",
  "--sv-chat-assistant-bg": "#2c2a26",
  "--sv-bookmark-dot": "#74a9f0"
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
