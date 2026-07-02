// registerSettingsSection (SHELL-1) — the additive section registry: stable order
// (order then id), idempotent replace per id, additive registration from anywhere.

import { afterEach, describe, expect, it } from "vitest";
import { clearSettingsSectionsForTests, listSettingsSections, registerSettingsSection } from "./registry";

const section = (id: string, order: number, title = id) => ({
  id,
  order,
  title,
  render: () => null
});

afterEach(() => {
  clearSettingsSectionsForTests();
});

describe("settings section registry", () => {
  it("lists sections sorted by order, breaking ties on id (stable, deterministic)", () => {
    registerSettingsSection(section("zeta", 30));
    registerSettingsSection(section("alpha", 10));
    registerSettingsSection(section("beta", 20));
    // Tie on order 20 — id decides.
    registerSettingsSection(section("aardvark", 20));

    expect(listSettingsSections().map((s) => s.id)).toEqual(["alpha", "aardvark", "beta", "zeta"]);
  });

  it("re-registering the same id REPLACES the entry (idempotent, no duplicates)", () => {
    registerSettingsSection(section("ai", 10, "old title"));
    registerSettingsSection(section("ai", 40, "new title"));

    const sections = listSettingsSections();
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe("new title");
    expect(sections[0].order).toBe(40);
  });

  it("is additive: later registrations slot into the existing order without edits", () => {
    registerSettingsSection(section("ai-providers", 10));
    registerSettingsSection(section("about", 40));
    // A future track (e.g. A3b) lands its panel between the shipped ones.
    registerSettingsSection(section("appearance", 25));

    expect(listSettingsSections().map((s) => s.id)).toEqual(["ai-providers", "appearance", "about"]);
  });
});
