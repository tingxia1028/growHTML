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
    "--sv-accent": "#3b6fe0",
    "--sv-accent-strong": "#2b5bd0",
    "--sv-accent-weak": "#eaf1fe",
    "--sv-accent-weak-hover": "#dbe7fd",
    "--sv-accent-border": "#cfe0fb",
    "--sv-accent-text": "#2b5bd0",
    "--sv-accent-text-strong": "#2451c4",
    "--sv-accent-weak-preview": "#f3f7fe",
    "--sv-on-accent": "#ffffff",
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
    "--sv-dark-surface": "#13161c",
    "--sv-dark-surface-2": "#181c23",
    "--sv-dark-surface-3": "#1b1f27",
    "--sv-reader-backdrop": "#ffffff",
    "--sv-dark-text": "#e6e9ee",
    "--sv-dark-text-2": "#f2f4f7",
    "--sv-chat-user-bg": "#e9f1fe",
    "--sv-chat-assistant-bg": "#f5f6f8",
    "--sv-bookmark-dot": "#3b6fe0",
    "--sv-highlight-bg": "#fdeec3",
    "--sv-highlight-text": "#5b4a1e",
    "--sv-connector": "#cdd3dc",
    "--sv-anchor-marker": "#9aa1ab",
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
