// @vitest-environment jsdom
// Operation adapter tests (SC-3; docs/design/slash-composer.md §1/§2/§5) — the REAL
// registries → operation SlashEntry derivation. Built-in kit actions whose commandId is
// a KitPrompt surface as kind:"operation" entries (effective-installed gated, foreground
// ordered); custom op_ records arrive as an argument and map by name; the disabled set
// drops rows; and a picked entry's dispatch payload is the shipped operation.run.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  slashEntriesFromOperations,
  slashEntriesFromBuiltinOperations,
  slashEntriesFromCustomOperations,
  operationRunPayload,
  type SlashOperationLike
} from "./operationAdapter";
import { resolveSlashEntries } from "./engine";
import { resetInstallState, syncInstallState } from "../../kits/installState";

// Stub DiagramNote so importing the built-ins doesn't pull mermaid/markmap-view into
// jsdom — same stub the adapters/registry tests use.
vi.mock("../DiagramNote", () => ({
  DiagramNote: () => <div className="mock-diagram" />
}));

// Side effects: register the built-ins + install the Product Kits (textbook prompts +
// surface contributions) so kitSurfaceItems has real operations to enumerate.
import "../notes/builtinNoteTypes";
import "../../kits/clientKits";

afterEach(() => resetInstallState());

const OPS: SlashOperationLike[] = [
  { id: "op_ABC", name: "我的总结", scope: "anchor", aliases: ["总结", "summary"] },
  { id: "op_DEF", name: "复习计划", scope: "source" }
];

const byId = (list: { id: string }[], id: string) => list.find((e) => e.id === id);

describe("slashEntriesFromBuiltinOperations — kit actions as operation entries", () => {
  it("maps the textbook prompt-backed surface items to kind:operation entries with scope", () => {
    const entries = slashEntriesFromBuiltinOperations();
    // Selection-toolbar prompts → anchor scope.
    const explain = byId(entries, "textbook.explain-concept");
    expect(explain).toMatchObject({ kind: "operation", title: "Explain", scope: "anchor" });
    expect(byId(entries, "textbook.generate-practice")).toMatchObject({ kind: "operation", scope: "anchor" });
    // Source-actions prompt → source scope.
    expect(byId(entries, "textbook.generate-review-pack")).toMatchObject({
      kind: "operation",
      title: "Review Pack",
      scope: "source"
    });
    // Every built-in entry is an operation and carries an id that resolvePrompt runs.
    for (const entry of entries) expect(entry.kind).toBe("operation");
  });

  it("excludes non-generative surface actions (only KitPrompt-backed commandIds appear)", () => {
    const entries = slashEntriesFromBuiltinOperations();
    // bookmark.add is a surface action but NOT a KitPrompt → never an operation entry.
    expect(byId(entries, "bookmark.add")).toBeUndefined();
  });

  it("the effective-installed gate drops an uninstalled kit's operations", () => {
    syncInstallState({ catalogState: { installedPlugins: ["flashcard"], installedKits: [] }, userKits: [] });
    const entries = slashEntriesFromBuiltinOperations();
    expect(byId(entries, "textbook.explain-concept")).toBeUndefined();
  });

  it("a disabled commandId is skipped", () => {
    const entries = slashEntriesFromBuiltinOperations({ disabled: ["textbook.explain-concept"] });
    expect(byId(entries, "textbook.explain-concept")).toBeUndefined();
    expect(byId(entries, "textbook.generate-practice")).toBeTruthy();
  });
});

describe("slashEntriesFromCustomOperations — op_ records as entries", () => {
  it("maps a custom operation's name/scope/aliases to an operation entry", () => {
    const entries = slashEntriesFromCustomOperations({ operations: OPS });
    expect(entries).toHaveLength(2);
    expect(byId(entries, "op_ABC")).toMatchObject({
      kind: "operation",
      title: "我的总结",
      scope: "anchor",
      aliases: ["总结", "summary"]
    });
    expect(byId(entries, "op_DEF")).toMatchObject({ kind: "operation", title: "复习计划", scope: "source" });
  });

  it("defaults scope to anchor and aliases to [] when absent", () => {
    const entries = slashEntriesFromCustomOperations({ operations: [{ id: "op_X", name: "X" }] });
    expect(byId(entries, "op_X")).toMatchObject({ scope: "anchor", aliases: [] });
  });

  it("a disabled op id is dropped", () => {
    const entries = slashEntriesFromCustomOperations({ operations: OPS, disabled: ["op_ABC"] });
    expect(byId(entries, "op_ABC")).toBeUndefined();
    expect(byId(entries, "op_DEF")).toBeTruthy();
  });

  it("no operations → []", () => {
    expect(slashEntriesFromCustomOperations()).toEqual([]);
  });
});

describe("slashEntriesFromOperations — built-ins then custom", () => {
  it("built-in kit actions come before custom ops", () => {
    const entries = slashEntriesFromOperations({ operations: OPS });
    const explainIdx = entries.findIndex((e) => e.id === "textbook.explain-concept");
    const customIdx = entries.findIndex((e) => e.id === "op_ABC");
    expect(explainIdx).toBeGreaterThanOrEqual(0);
    expect(customIdx).toBeGreaterThan(explainIdx);
  });

  it("the whole set resolves through the pure engine (pinyin + name match)", () => {
    const entries = slashEntriesFromOperations({ operations: OPS });
    // A custom op's 中文 name matches literally…
    expect(resolveSlashEntries("复习", entries)[0]?.id).toBe("op_DEF");
    // …and by pinyin initials (复习计划 → fxjh).
    expect(resolveSlashEntries("fxjh", entries)[0]?.id).toBe("op_DEF");
  });
});

describe("operationRunPayload — a picked entry dispatches the shipped operation.run", () => {
  it("an anchor-scope entry runs operation.run with its id + scope, no vars, AUTO output", () => {
    const entry = { kind: "operation" as const, id: "textbook.explain-concept", title: "Explain", aliases: [], scope: "anchor" as const };
    expect(operationRunPayload(entry)).toEqual({
      commandId: "operation.run",
      payload: { operationId: "textbook.explain-concept", scope: "anchor", variables: [] }
    });
  });

  it("a source-scope custom op carries scope:source (operation.run materializes the source)", () => {
    const entry = { kind: "operation" as const, id: "op_DEF", title: "复习计划", aliases: [], scope: "source" as const };
    expect(operationRunPayload(entry).payload).toMatchObject({ operationId: "op_DEF", scope: "source" });
  });

  it("defaults an entry with no scope to anchor", () => {
    const entry = { kind: "operation" as const, id: "op_X", title: "X", aliases: [] };
    expect(operationRunPayload(entry).payload.scope).toBe("anchor");
  });
});
