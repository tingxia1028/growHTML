import { beforeEach, describe, expect, it } from "vitest";
import { getTheme, listThemes, registerTheme, resetThemes, type Theme } from "./registry";
import { DARK_THEME_TOKENS, DEFAULT_THEME_TOKENS } from "./builtins";

const sample = (overrides: Partial<Theme> = {}): Theme => ({
  id: "sample",
  name: "Sample",
  colorScheme: "light",
  tokens: { "--sv-accent": "#123456" },
  ...overrides
});

describe("theme registry", () => {
  beforeEach(() => resetThemes());

  it("registers a theme and resolves it by id", () => {
    const theme = sample();
    registerTheme(theme);
    expect(getTheme("sample")).toBe(theme);
  });

  it("listThemes includes the registered ids in insertion order", () => {
    registerTheme(sample({ id: "a", name: "A" }));
    registerTheme(sample({ id: "b", name: "B" }));
    expect(listThemes().map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("a later registration for the same id wins", () => {
    registerTheme(sample({ id: "dup", name: "First" }));
    registerTheme(sample({ id: "dup", name: "Second" }));
    expect(getTheme("dup")?.name).toBe("Second");
    expect(listThemes().filter((t) => t.id === "dup")).toHaveLength(1);
  });

  it("getTheme returns undefined for an unknown id", () => {
    expect(getTheme("nope")).toBeUndefined();
  });

  it("resetThemes drops all registered themes", () => {
    registerTheme(sample());
    resetThemes();
    expect(listThemes()).toHaveLength(0);
  });
});

// Value-preserving guard: the default theme's tokens must equal the documented base
// palette literal-for-literal, so the default stays byte-identical to the pre-theme app
// and any drift in builtins.ts fails the build. Keep this frozen map in sync with
// styles.css :root and DEFAULT_THEME_TOKENS — that is the whole point of the guard.
describe("default theme value-preservation", () => {
  const EXPECTED_BASE_PALETTE: Record<string, string> = {
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
    "--sv-accent": "#2f6f64",
    "--sv-accent-strong": "#285c52",
    "--sv-accent-weak": "#edf6f3",
    "--sv-accent-weak-hover": "#ddeee8",
    "--sv-accent-border": "#cfe3dd",
    "--sv-accent-text": "#1f5c4f",
    "--sv-accent-text-strong": "#1f534b",
    "--sv-accent-weak-preview": "#f3faf7",
    "--sv-on-accent": "#ffffff",
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
    "--sv-dark-surface": "#1e1b16",
    "--sv-dark-surface-2": "#1f2622",
    "--sv-dark-surface-3": "#2c2a26",
    "--sv-reader-backdrop": "#555049",
    "--sv-dark-text": "#e6e3da",
    "--sv-dark-text-2": "#f1ece1",
    "--sv-chat-user-bg": "#e8efe4",
    "--sv-chat-assistant-bg": "#f2ede0",
    "--sv-bookmark-dot": "#3b82f6",
    "--sv-font-sans": 'Inter, "Segoe UI", Arial, sans-serif',
    "--sv-font-mono": "ui-monospace, SFMono-Regular, Menlo, monospace",
    "--sv-radius": "8px",
    "--sv-radius-sm": "6px",
    "--sv-radius-xs": "4px",
    "--sv-radius-pill": "999px",
    "--sv-space-1": "4px",
    "--sv-space-2": "8px",
    "--sv-space-3": "12px",
    "--sv-space-4": "18px"
  };

  it("default tokens equal the documented base palette", () => {
    expect(DEFAULT_THEME_TOKENS).toEqual(EXPECTED_BASE_PALETTE);
  });

  it("dark overrides only a subset and never touches intrinsic dark surfaces", () => {
    // Dark must omit the intrinsic dark surfaces so they inherit :root (no double-darken).
    for (const key of ["--sv-dark-surface", "--sv-dark-surface-2", "--sv-reader-backdrop"]) {
      expect(DARK_THEME_TOKENS[key]).toBeUndefined();
    }
    // And every key it does declare must be part of the known vocabulary.
    for (const key of Object.keys(DARK_THEME_TOKENS)) {
      expect(EXPECTED_BASE_PALETTE).toHaveProperty(key);
    }
  });
});
