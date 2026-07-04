// Unit coverage for the I18N seed (LIB-2 pull-forward): locale default + flip,
// defineMessages identity, t() resolution, and LocalizedText/resolveText for both the
// plain-string and per-locale-record forms. The "missing translation = type error"
// guarantee is compile-time (Message requires every Locale) — exercised implicitly by
// this file type-checking, not assertable at runtime.
import { afterEach, describe, expect, it } from "vitest";
import { defineMessages, getLocale, resolveText, setLocale, t, type LocalizedText } from "./index";

const messages = defineMessages({
  library: { zh: "资料库", en: "Library" },
  refresh: { zh: "刷新", en: "Refresh" }
});

afterEach(() => {
  setLocale("zh");
});

describe("locale state", () => {
  it("defaults to zh", () => {
    expect(getLocale()).toBe("zh");
  });

  it("setLocale flips what getLocale reports", () => {
    setLocale("en");
    expect(getLocale()).toBe("en");
    setLocale("zh");
    expect(getLocale()).toBe("zh");
  });
});

describe("defineMessages + t", () => {
  it("defineMessages returns the dictionary unchanged (identity)", () => {
    expect(messages.library).toEqual({ zh: "资料库", en: "Library" });
  });

  it("t resolves in the active locale", () => {
    expect(t(messages.library)).toBe("资料库");
    setLocale("en");
    expect(t(messages.library)).toBe("Library");
  });

  it("every message resolves in every locale (no runtime fallback needed)", () => {
    for (const message of Object.values(messages)) {
      setLocale("zh");
      expect(t(message)).toBeTruthy();
      setLocale("en");
      expect(t(message)).toBeTruthy();
    }
  });
});

describe("LocalizedText / resolveText", () => {
  it("passes a plain string through as-is in any locale", () => {
    const text: LocalizedText = "教材包";
    expect(resolveText(text)).toBe("教材包");
    setLocale("en");
    expect(resolveText(text)).toBe("教材包");
  });

  it("resolves a per-locale record by the active locale", () => {
    const text: LocalizedText = { zh: "文档", en: "Documents" };
    expect(resolveText(text)).toBe("文档");
    setLocale("en");
    expect(resolveText(text)).toBe("Documents");
  });
});
