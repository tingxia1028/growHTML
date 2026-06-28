// Theme registry — React-free. A theme is pure data: an id, a display name, a
// color-scheme hint, and a set of design-token overrides (CSS custom properties).
// Mirrors the kit-language registry (src/kits/language.ts) and the layout/kit
// switcher precedents: a registry list + accessors, populated for side effect by
// src/client/theme/builtins.ts (and, later, by kit-contributed themes).
//
// Applying a theme is just flipping one [data-theme] attribute on <html>; the
// component stylesheet reads var(--sv-*), so the whole app re-skins with no React
// re-render and no network. See docs/design/theme-plugin.md.

export type Theme = {
  /** "default" | "dark" | kit-supplied. Matches the [data-theme="id"] attribute. */
  id: string;
  /** Shown in the header theme switcher. */
  name: string;
  /** Drives the CSS `color-scheme` property so native form controls / scrollbars match. */
  colorScheme: "light" | "dark";
  /** Token overrides, emitted as a [data-theme="id"] block. The default theme
      declares the FULL --sv-* vocabulary; other themes declare only what they change. */
  tokens: Record<string, string>;
  /** Built-in (default/dark) vs plugin-supplied — informational only. */
  builtin?: boolean;
};

const themes = new Map<string, Theme>();

/** Register a theme (a later registration for the same id wins). */
export function registerTheme(theme: Theme): void {
  themes.set(theme.id, theme);
}

/** All registered themes, in insertion order. */
export function listThemes(): Theme[] {
  return [...themes.values()];
}

/** The theme registered under `id`, or undefined. */
export function getTheme(id: string): Theme | undefined {
  return themes.get(id);
}

/** Test/reset hook — drops all registered themes (mirrors resetKitLanguages). */
export function resetThemes(): void {
  themes.clear();
}
