// Theme application — owns the managed <style data-sv-themes> element and the single
// [data-theme] attribute flip. This is the whole "整体换掉" mechanism: every component
// reads var(--sv-*), so setting one attribute on <html> re-skins the app instantly,
// with no React re-render and no network. See docs/design/theme-plugin.md §3.2/§4.
//
// Cascade order is intentionally simple for V1: styles.css already declares the default
// tokens at :root (so first paint is correct with zero JS), and this injected style adds
// a [data-theme="id"] override block per registered theme. The default theme also
// re-seeds :root from the registry so the token layer is complete + self-describing.
// (V2 grows this same injector to also emit raw theme CSS / user overrides / snippets.)

import { DEFAULT_THEME_ID } from "./builtins";
import { getTheme, listThemes } from "./registry";

/** The one managed <style> element; keyed so re-injection updates rather than duplicates. */
const STYLE_MARKER = "data-sv-themes";

/** localStorage key for the active theme id (V1 persistence; mirrors ACTIVE_LAYOUT_KEY). */
export const THEME_STORAGE_KEY = "sv-active-theme";

// Render one theme's tokens as a CSS declaration block. The default theme also seeds
// :root so the bundled stylesheet + the registry agree and the default is explicit.
function themeBlock(selector: string, tokens: Record<string, string>): string {
  const decls = Object.entries(tokens)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");
  return `${selector} {\n${decls}\n}`;
}

/** Build the full managed-style CSS text from the current registry. */
function buildThemeCss(): string {
  return listThemes()
    .map((theme) => {
      const selector =
        theme.id === DEFAULT_THEME_ID
          ? `:root, [data-theme="${theme.id}"]`
          : `[data-theme="${theme.id}"]`;
      return themeBlock(selector, theme.tokens);
    })
    .join("\n\n");
}

/**
 * Create (or refresh) the single managed <style data-sv-themes> from the registry.
 * Idempotent — calling it again updates the existing element instead of adding another.
 */
export function injectThemeStyles(): void {
  if (typeof document === "undefined") return;
  let style = document.head.querySelector<HTMLStyleElement>(`style[${STYLE_MARKER}]`);
  if (!style) {
    style = document.createElement("style");
    style.setAttribute(STYLE_MARKER, "");
    document.head.appendChild(style);
  }
  style.textContent = buildThemeCss();
}

/**
 * Apply a theme by flipping one attribute on <html>: set data-theme + the CSS
 * color-scheme. An unknown id falls back to the default theme without throwing.
 */
export function setActiveTheme(id: string): void {
  if (typeof document === "undefined") return;
  const theme = getTheme(id) ?? getTheme(DEFAULT_THEME_ID);
  const resolvedId = theme?.id ?? DEFAULT_THEME_ID;
  const root = document.documentElement;
  root.setAttribute("data-theme", resolvedId);
  root.style.colorScheme = theme?.colorScheme ?? "light";
}

/** The persisted active theme id, or the default when none is stored / storage is unavailable. */
export function readPersistedThemeId(): string {
  try {
    return globalThis.localStorage?.getItem(THEME_STORAGE_KEY) || DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}
