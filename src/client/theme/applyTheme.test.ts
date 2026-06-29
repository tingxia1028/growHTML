// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
// Importing builtins registers default + dark for side effect (as it does at startup).
import "./builtins";
import { injectThemeStyles, readPersistedThemeId, setActiveTheme, THEME_STORAGE_KEY } from "./applyTheme";

function themeStyleEls(): NodeListOf<HTMLStyleElement> {
  return document.head.querySelectorAll<HTMLStyleElement>("style[data-sv-themes]");
}

describe("applyTheme", () => {
  beforeEach(() => {
    document.head.querySelectorAll("style[data-sv-themes]").forEach((el) => el.remove());
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.colorScheme = "";
    try {
      globalThis.localStorage?.clear();
    } catch {
      // ignore
    }
  });

  it("injects exactly one managed <style>, and re-injecting updates rather than duplicates", () => {
    injectThemeStyles();
    injectThemeStyles();
    expect(themeStyleEls()).toHaveLength(1);
  });

  it("emits a default :root block and a [data-theme=\"dark\"] override block", () => {
    injectThemeStyles();
    const css = themeStyleEls()[0].textContent ?? "";
    expect(css).toContain(":root, [data-theme=\"default\"]");
    expect(css).toContain("[data-theme=\"dark\"]");
    // Dark's accent override is present; an intrinsic dark surface is NOT in the dark block.
    expect(css).toContain("--sv-accent: #5b8cf5;");
    const darkBlock = css.slice(css.indexOf("[data-theme=\"dark\"]"));
    expect(darkBlock).not.toContain("--sv-dark-surface");
  });

  it("setActiveTheme('dark') flips the data-theme attribute and color-scheme", () => {
    setActiveTheme("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("setActiveTheme('default') applies the light scheme", () => {
    setActiveTheme("default");
    expect(document.documentElement.getAttribute("data-theme")).toBe("default");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("an unknown id falls back to default without throwing", () => {
    expect(() => setActiveTheme("does-not-exist")).not.toThrow();
    expect(document.documentElement.getAttribute("data-theme")).toBe("default");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("readPersistedThemeId returns the stored id, else default", () => {
    expect(readPersistedThemeId()).toBe("default");
    globalThis.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    expect(readPersistedThemeId()).toBe("dark");
  });
});
