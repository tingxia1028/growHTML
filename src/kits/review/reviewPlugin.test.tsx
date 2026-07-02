// @vitest-environment jsdom
// Review plugin client install — the kit registration idiom end-to-end: the hidden
// review.grade type registers BOTH halves (core spec + client plugin) through the
// same sinks the textbook kit uses, the plugin read model records the contribution,
// and — the SC-0 contract — the hidden type is EXCLUDED from the slash palette and
// the composer's type-picker universe while still rendering through getNoteType().

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

// Stub DiagramNote so importing the built-ins doesn't pull mermaid/markmap-view into
// jsdom — the same stub every registry-level test uses.
vi.mock("../../client/DiagramNote", () => ({
  DiagramNote: () => <div className="mock-diagram" />
}));

// Side effects: the 13 built-ins + the Product Kits (textbook + review).
import "../../client/notes/builtinNoteTypes";
import "../clientKits";

import { getNoteType, listNoteTypes } from "../../client/notes/noteTypeRegistry";
import { getNoteContentSpec } from "../../core/notes/contentTypes";
import { slashEntriesFromNoteTypes } from "../../client/slash/adapters";
import { listInstalledPlugins } from "../plugin";
import { installedKits } from "../clientContext";
import { REVIEW_GRADE_CONTENT_TYPE } from "./contentTypes";

function renderToHtml(node: React.ReactNode): string {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node as React.ReactElement));
  const html = container.innerHTML;
  act(() => root.unmount());
  container.remove();
  return html;
}

describe("review plugin client install", () => {
  it("registers the hidden review.grade type (both halves) under the review plugin", () => {
    const plugin = getNoteType(REVIEW_GRADE_CONTENT_TYPE);
    expect(plugin).toBeTruthy();
    expect(plugin!.hidden).toBe(true);
    expect(plugin!.pluginId).toBe("review");
    expect(getNoteContentSpec(REVIEW_GRADE_CONTENT_TYPE)).toBeTruthy();
    expect(installedKits.some((kit) => kit.id === "review")).toBe(true);
  });

  it("records the noteType contribution on the plugin read model (manager panel rows)", () => {
    const record = listInstalledPlugins().find((p) => p.id === "review");
    expect(record).toBeTruthy();
    expect(record!.contributions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `review:noteType:${REVIEW_GRADE_CONTENT_TYPE}`,
          kind: "noteType",
          key: REVIEW_GRADE_CONTENT_TYPE
        })
      ])
    );
  });

  it("SC-0: the hidden type is EXCLUDED from the slash palette (and quiz stays in)", () => {
    const entries = slashEntriesFromNoteTypes();
    expect(entries.find((entry) => entry.id === REVIEW_GRADE_CONTENT_TYPE)).toBeUndefined();
    expect(entries.find((entry) => entry.id === "quiz")).toBeTruthy();
  });

  it("hidden also means 'not offered in composers': it is out of the visible-type universe", () => {
    const visible = listNoteTypes().filter((plugin) => !plugin.hidden);
    expect(visible.some((plugin) => plugin.contentType === REVIEW_GRADE_CONTENT_TYPE)).toBe(false);
    // …but the registry still knows it (rendering is never gated).
    expect(listNoteTypes().some((plugin) => plugin.contentType === REVIEW_GRADE_CONTENT_TYPE)).toBe(true);
  });

  it("renders a grade verdict through the ONE getNoteType().render path (pass + fail)", () => {
    const plugin = getNoteType(REVIEW_GRADE_CONTENT_TYPE)!;
    const pass = renderToHtml(plugin.render({ content: { correct: true, explanation: "正是要点" } }));
    expect(pass).toContain("答对了");
    expect(pass).toContain("正是要点");
    expect(pass).toContain("review-grade-pass");

    const fail = renderToHtml(plugin.render({ content: { correct: false, explanation: "再想想" } }));
    expect(fail).toContain("答错了");
    expect(fail).toContain("review-grade-fail");

    // Defensive on foreign shapes (the registry contract: renders never throw).
    const inert = renderToHtml(plugin.render({ content: "garbage" }));
    expect(inert).toContain("答错了"); // coerces to the safe default verdict
  });
});
