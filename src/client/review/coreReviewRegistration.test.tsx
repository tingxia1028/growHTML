// @vitest-environment jsdom
// REV-CORE core registration (ported from the dissolved review plugin's install
// test): the hidden review.grade type registers BOTH halves (core spec + client
// plugin) at CORE SEED — with the built-ins, not via any kit — and the SC-0
// contract holds: the hidden type is EXCLUDED from the slash palette and the
// composer's type-picker universe while still rendering through getNoteType().
// Also the REV-CORE severing proofs: the core `mistake` type replaces the kit's
// `textbook.mistake` (alias-aware lookup + render).
//
// Lens→kit migration: the review.panel DRILL VIEW is now a register-only KIT lens
// (reviewKit — a relocation of the view's code, owner-decided). That gives review a
// register-only kit vehicle + a plugin record, but the REV-CORE guarantee is UNBROKEN:
// reviewKit is UNCATALOGED → isPluginEffectiveInstalled==true → the mission loop is NOT
// uninstallable (no market entry), and the kit registers NO content spec, so the review
// ENGINE (review.grade type + SRS schedule + queue/scope/io) stays a CORE built-in.

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

// Stub DiagramNote so importing the built-ins doesn't pull mermaid/markmap-view into
// jsdom — the same stub every registry-level test uses.
vi.mock("../DiagramNote", () => ({
  DiagramNote: () => <div className="mock-diagram" />
}));

// Side effects: the core built-ins (incl. mistake + review.grade) + the Product Kits.
import "../notes/builtinNoteTypes";
import "../../kits/clientKits";

import { getNoteType, listNoteTypes } from "../notes/noteTypeRegistry";
import { getNoteContentSpec, MISTAKE_CONTENT_TYPE } from "../../core/notes/contentTypes";
import { REVIEW_GRADE_CONTENT_TYPE } from "../../core/review/contentTypes";
import { slashEntriesFromNoteTypes } from "../slash/adapters";
import { installedKits } from "../../kits/clientContext";
import { getCatalogEntry } from "../../kits/catalog";
import { isPluginEffectiveInstalled } from "../../kits/installState";

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

describe("REV-CORE — review registers from core (no plugin)", () => {
  it("registers the hidden review.grade type (both halves) as a CORE built-in", () => {
    const plugin = getNoteType(REVIEW_GRADE_CONTENT_TYPE);
    expect(plugin).toBeTruthy();
    expect(plugin!.hidden).toBe(true);
    expect(plugin!.pluginId, "core registrations carry no owning plugin").toBeUndefined();
    expect(getNoteContentSpec(REVIEW_GRADE_CONTENT_TYPE)).toBeTruthy();
  });

  it("review is UNCATALOGED + engine-free: the mission loop stays core (not uninstallable)", () => {
    // The review.panel drill VIEW moved into a register-only KIT lens (reviewKit), so review
    // now HAS a kit vehicle — but the REV-CORE guarantee holds: it is UNCATALOGED (no market
    // good), so it is always-available (not uninstallable) and the ENGINE is not kit-gated.
    expect(getCatalogEntry("review")).toBeUndefined();
    expect(isPluginEffectiveInstalled("review")).toBe(true); // uncataloged ⇒ always available
    // The kit registers NO content spec: the review.grade + mistake ENGINE types stay CORE
    // built-ins (test 1 above pins review.grade is a core spec with no owning plugin).
    const reviewKit = installedKits.find((kit) => kit.id === "review");
    expect(reviewKit, "the review.panel lens is a register-only kit vehicle").toBeTruthy();
    // The textbook kit is untouched.
    expect(installedKits.some((kit) => kit.id === "textbook-learning")).toBe(true);
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

describe("REV-CORE — the core mistake type + the textbook.mistake alias", () => {
  it("`mistake` is a core built-in, offered in the palette WITHOUT a provider badge", () => {
    const plugin = getNoteType(MISTAKE_CONTENT_TYPE);
    expect(plugin).toBeTruthy();
    expect(plugin!.pluginId).toBeUndefined(); // core — never gated by kit install state
    const entry = slashEntriesFromNoteTypes().find((e) => e.id === MISTAKE_CONTENT_TYPE);
    expect(entry).toMatchObject({ title: "错题", kitId: undefined });
    // The legacy id is an ALIAS, not a palette entry of its own.
    expect(slashEntriesFromNoteTypes().find((e) => e.id === "textbook.mistake")).toBeUndefined();
  });

  it("an OLD textbook.mistake record renders through the core plugin via the alias", () => {
    // The alias-aware registry lookup: no client plugin registers "textbook.mistake"
    // anymore, yet the persisted id still resolves and renders (zero data migration).
    expect(listNoteTypes().some((p) => p.contentType === "textbook.mistake")).toBe(false);
    const plugin = getNoteType("textbook.mistake");
    expect(plugin).toBeTruthy();
    expect(plugin!.contentType).toBe(MISTAKE_CONTENT_TYPE);
    const html = renderToHtml(
      plugin!.render({
        content: { question: "Q?", wrongAnswer: "12", correctAnswer: "14", retryCount: 0, mastery: "weak" }
      })
    );
    expect(html).toContain("tb-mistake"); // the unchanged mistake card markup
    expect(html).toContain("Q?");
    expect(html).toContain("14");
  });
});
