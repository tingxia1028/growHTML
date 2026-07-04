// @vitest-environment jsdom
// SRC-4 — the predefined layout templates (sourceTemplates.ts): every template is a
// clean BODY fragment of study markup that (a) parses to well-formed HTML, (b) carries
// no scripts or javascript: URLs, and (c) round-trips through the SRC-2b serialize path
// unchanged so it is safe to drop into an authored page.
import { describe, expect, it } from "vitest";
import { setLocale } from "../i18n";
import { listSourceTemplates, getSourceTemplate, templateHtml } from "./sourceTemplates";
import { sanitizeEditedDom } from "./htmlInPlace";

describe("sourceTemplates", () => {
  it("lists a blank plus several real layouts, each with bilingual labels", () => {
    const templates = listSourceTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(4);
    expect(templates.some((tpl) => tpl.id === "blank")).toBe(true);
    for (const tpl of templates) {
      expect(tpl.label.zh).toBeTruthy();
      expect(tpl.label.en).toBeTruthy();
      expect(tpl.description.zh).toBeTruthy();
      expect(tpl.description.en).toBeTruthy();
    }
  });

  it("the blank template is empty; the rest carry non-empty layout HTML", () => {
    expect(getSourceTemplate("blank")?.html.zh).toBe("");
    for (const tpl of listSourceTemplates().filter((t) => t.id !== "blank")) {
      expect(tpl.html.zh.trim().length).toBeGreaterThan(0);
      expect(tpl.html.en.trim().length).toBeGreaterThan(0);
    }
  });

  it("templateHtml resolves the ACTIVE locale", () => {
    setLocale("en");
    expect(templateHtml("lessonNotes")).toContain("Lesson title");
    setLocale("zh");
    expect(templateHtml("lessonNotes")).toContain("课堂标题");
  });

  it("every template's HTML is well-formed and survives the SRC-2b sanitizer unchanged", () => {
    for (const tpl of listSourceTemplates()) {
      for (const locale of ["zh", "en"] as const) {
        const html = tpl.html[locale];
        if (!html) continue;
        const host = document.createElement("div");
        host.innerHTML = html;
        sanitizeEditedDom(host);
        // A stable round-trip (parse → serialize) proves well-formedness; equal after
        // sanitize proves no forbidden artifacts (scripts/on*/javascript:) live inside.
        const reparsed = document.createElement("div");
        reparsed.innerHTML = html;
        expect(host.innerHTML).toBe(reparsed.innerHTML);
        expect(html).not.toMatch(/<script/i);
        expect(html).not.toMatch(/javascript:/i);
        expect(html).not.toMatch(/\son\w+=/i);
      }
    }
  });
});
