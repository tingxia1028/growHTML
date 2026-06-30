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
    "--sv-bg": "#f7f8fa",
    "--sv-surface": "#ffffff",
    "--sv-surface-card": "#ffffff",
    "--sv-surface-tag": "#eef0f4",
    "--sv-surface-muted": "#f7f9fc",
    "--sv-active-bg": "#edf4ff",
    "--sv-select-bg": "#dfeaff",
    "--sv-select-text": "#252b34",
    "--sv-icon-muted": "#6f7784",
    "--sv-text": "#252b34",
    "--sv-text-strong": "#171c24",
    "--sv-text-heading": "#171c24",
    "--sv-text-muted": "#737b88",
    "--sv-text-muted-soft": "#858d99",
    "--sv-text-faint": "#a3aab5",
    "--sv-text-subtle": "#6f7784",
    "--sv-text-quote": "#4a515c",
    "--sv-border": "#e9edf3",
    "--sv-border-soft": "#f0f3f7",
    "--sv-border-muted": "#e9edf3",
    "--sv-accent": "#3474e6",
    "--sv-accent-strong": "#2f67d7",
    "--sv-accent-weak": "#f1f6ff",
    "--sv-accent-weak-hover": "#e7f0ff",
    "--sv-accent-border": "#c9dcff",
    "--sv-accent-text": "#2f67d7",
    "--sv-accent-text-strong": "#285cc7",
    "--sv-accent-weak-preview": "#f5f8ff",
    "--sv-on-accent": "#ffffff",
    "--sv-danger": "#d23a32",
    "--sv-danger-strong": "#a32820",
    "--sv-danger-2": "#b3362c",
    "--sv-danger-bg": "#fdf2f1",
    "--sv-danger-bg-strong": "#f6dad7",
    "--sv-danger-bg-tint": "#f6dad7",
    "--sv-warn-accent": "#3474e6",
    "--sv-warn-region": "#3474e6",
    "--sv-warn-text": "#2f67d7",
    "--sv-warn-bg": "#eef5ff",
    "--sv-fuzzy-bg": "#eef5ff",
    "--sv-fuzzy-text": "#2f67d7",
    "--sv-success": "#1f8a5b",
    "--sv-success-strong": "#1a7a4f",
    "--sv-success-bg": "#d9f1e4",
    "--sv-dark-surface": "#13161c",
    "--sv-dark-surface-2": "#181c23",
    "--sv-dark-surface-3": "#1b1f27",
    "--sv-reader-backdrop": "#ffffff",
    "--sv-dark-text": "#e6e9ee",
    "--sv-dark-text-2": "#f2f4f7",
    "--sv-chat-user-bg": "#eef5ff",
    "--sv-chat-assistant-bg": "#ffffff",
    "--sv-bookmark-dot": "#3474e6",
    "--sv-highlight-bg": "#eef5ff",
    "--sv-highlight-text": "#2f67d7",
    "--sv-connector": "#d0d6df",
    "--sv-anchor-marker": "#a3aab5",
    "--sv-font-sans": '"Inter", "Segoe UI", Arial, sans-serif',
    "--sv-font-serif": '"Source Serif 4", Georgia, "Times New Roman", serif',
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
    // It DOES override --sv-reader-backdrop, because the Growte light backdrop is white paper.
    for (const key of ["--sv-dark-surface", "--sv-dark-surface-2", "--sv-dark-surface-3"]) {
      expect(DARK_THEME_TOKENS[key]).toBeUndefined();
    }
    // And every key it does declare must be part of the known vocabulary.
    for (const key of Object.keys(DARK_THEME_TOKENS)) {
      expect(EXPECTED_BASE_PALETTE).toHaveProperty(key);
    }
  });
});
