// @vitest-environment jsdom
// F5 seeding + the §8.2 ownership agreement, against the REAL registrations:
//   • every cataloged plugin's provided contentType is registered with
//     `pluginId === catalog id` (renderer registry, read model, catalog agree);
//   • the synthetic "core" record no longer over-claims flashcard/quiz/bookmark/
//     diagrams (each has its own PluginRecord) — the seedCorePlugin fix;
//   • the textbook kit decomposes into per-member records so catalog `members[]`
//     resolve against the read model (plugin==kit 1:1 is dead);
//   • the table viewer re-homes from "core" to the `table-viewer` plugin.
import { describe, expect, it, vi } from "vitest";

vi.mock("../client/DiagramNote", () => ({
  DiagramNote: () => <div className="mock-diagram" />
}));

// Side effects: the built-ins + the Product Kits + the table viewer registration.
import "../client/notes/builtinNoteTypes";
import "./clientKits";
import "../client/notes/tableViewer";

import { getNoteType } from "../client/notes/noteTypeRegistry";
import { getViewer } from "../client/notes/viewerRegistry";
import { TABLE_VIEWER_ID } from "../client/notes/tableViewer";
import { listCatalogEntries, catalogKitMembers } from "./catalog";
import { listInstalledPlugins } from "./plugin";
import { installedKits } from "./clientContext";

const record = (id: string) => listInstalledPlugins().find((p) => p.id === id);

describe("§8.2 hard requirement 1 — contentType ownership agreement", () => {
  it("every cataloged plugin's provides[] is registered under pluginId === catalog id", () => {
    for (const entry of listCatalogEntries().filter((e) => e.kind === "plugin")) {
      for (const contentType of entry.provides ?? []) {
        const registration = getNoteType(contentType);
        expect(registration, `${contentType} must be registered`).toBeTruthy();
        expect(registration!.pluginId, `${contentType} owner`).toBe(entry.id);
      }
    }
  });

  it("core primitives keep pluginId ABSENT (deliberately not cataloged)", () => {
    for (const contentType of ["markdown", "plain-text", "code-snippet", "image", "audio", "video", "html-sandbox"]) {
      expect(getNoteType(contentType)?.pluginId, contentType).toBeUndefined();
    }
  });
});

describe("F5 — seedCorePlugin over-claim fixed", () => {
  it("flashcard/quiz/bookmark/diagrams have their OWN PluginRecords with their noteType contributions", () => {
    expect(record("flashcard")?.contributions).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "flashcard:noteType:flashcard", kind: "noteType" })])
    );
    expect(record("quiz")?.contributions).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "quiz:noteType:quiz" })])
    );
    expect(record("bookmark")?.contributions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "bookmark:noteType:bookmark" }),
        // §8.6 day-one metadata: the bookmark.add command belongs to the plugin.
        expect.objectContaining({ id: "bookmark:command:bookmark.add", kind: "command" })
      ])
    );
    const diagrams = record("diagrams");
    expect(diagrams?.contributions.map((c) => c.key)).toEqual(
      expect.arrayContaining(["mermaid", "markmap", "mindmap"])
    );
    // Catalog names flow onto the seeded records (not the raw ids).
    expect(record("flashcard")?.name).toBe("Flashcard");
  });

  it('the synthetic "core" record no longer claims the reclassified types', () => {
    const core = record("core");
    expect(core).toBeTruthy();
    const coreKeys = core!.contributions.map((c) => c.key);
    for (const claimed of ["flashcard", "quiz", "bookmark", "mermaid", "markmap", "mindmap"]) {
      expect(coreKeys, `core must not claim ${claimed}`).not.toContain(claimed);
    }
    // …but it still lists the true primitives for the read model.
    expect(coreKeys).toEqual(expect.arrayContaining(["markdown", "code-snippet", "image"]));
  });

  it("the table viewer re-homed: contribution on `table-viewer`, viewer id kept for pin-compat", () => {
    expect(record("table-viewer")?.contributions).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "table-viewer:viewer:table", kind: "viewer" })])
    );
    expect(record("core")?.contributions.some((c) => c.kind === "viewer")).toBe(false);
    // The persisted-pin-compatible viewer id survives the re-home.
    expect(getViewer(TABLE_VIEWER_ID)?.pluginId).toBe("table-viewer");
  });
});

describe("F5 — the textbook kit decomposes into member plugins (members[] resolve)", () => {
  it("one PluginRecord per catalog member, grouped under its REGISTRATION kit", () => {
    // FLAT §2: the catalog's ONE Textbook Kit absorbs the subject exemplars as
    // capability groups, but the RUNTIME registration vehicles are unchanged (a
    // presentation + install-state flatten, not a contribution rewrite): the subject
    // members still register under their per-subject kit ids, which now resolve
    // through the legacy group aliases for foregrounding/detection.
    const runtimeKitOf: Record<string, string> = {
      "subject-vocab": "subject-english",
      "subject-formula": "subject-math",
      "subject-timeline": "subject-history-geo"
    };
    for (const memberId of catalogKitMembers("textbook-learning")) {
      const member = record(memberId);
      expect(member, `member ${memberId}`).toBeTruthy();
      expect(member!.kitId).toBe(runtimeKitOf[memberId] ?? "textbook-learning");
    }
    // The member owns its loop: noteType + command + surface land on ONE record.
    expect(record("explanation")?.contributions.map((c) => c.kind)).toEqual(
      expect.arrayContaining(["noteType", "command", "surface"])
    );
    expect(record("practice")?.contributions).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "practice:noteType:textbook.exercise" })])
    );
    // The language pack is its own member plugin.
    expect(record("textbook-language")?.contributions).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "language" })])
    );
  });

  it("the kit record keeps only kit-level config (layout), and stays an activation choice", () => {
    const kit = record("textbook-learning");
    expect(kit?.contributions.map((c) => c.kind)).toEqual(["layout"]);
    expect(installedKits.some((k) => k.id === "textbook-learning")).toBe(true);
  });
});
