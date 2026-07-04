// SEARCH-1 client engine (pure): commands-family ranking (bilingual titles + aliases,
// bare query = full navigation menu), the grouped row model (笔记 → 文档 → 命令 with
// display caps + flat indices), and the SC-0-shaped keyboard mapping (wrap + Enter).
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../i18n";
import { searchCommandEntries } from "./commandEntries";
import {
  buildPaletteGroups,
  COMMAND_DISPLAY_CAP,
  NOTE_DISPLAY_CAP,
  rankCommandEntries,
  searchPaletteKeyDown,
  SOURCE_DISPLAY_CAP,
  type NoteHitDto,
  type PaletteRow,
  type SearchHitDto,
  type SourceHitDto
} from "./searchEngine";

afterEach(() => {
  setLocale("zh");
});

const noteHit = (id: string, extra: Partial<NoteHitDto> = {}): NoteHitDto => ({
  family: "note",
  id,
  contentType: "markdown",
  title: `note ${id}`,
  snippet: "",
  updatedAt: "2026-07-01T00:00:00.000Z",
  ...extra
});

const sourceHit = (id: string): SourceHitDto => ({
  family: "source",
  id,
  title: `source ${id}`,
  sourceType: "html",
  snippet: "",
  updatedAt: "2026-07-01T00:00:00.000Z"
});

describe("rankCommandEntries — the commands family", () => {
  it("empty query → ALL entries up to the cap (the palette doubles as a nav menu)", () => {
    const entries = searchCommandEntries();
    const ranked = rankCommandEntries("", entries);
    expect(ranked.length).toBe(Math.min(entries.length, COMMAND_DISPLAY_CAP));
    expect(ranked[0].id).toBe(entries[0].id); // input order preserved
  });

  it("matches the zh title", () => {
    const ranked = rankCommandEntries("复习", searchCommandEntries());
    expect(ranked.map((entry) => entry.id)).toEqual(["open:review.panel"]);
  });

  it("matches the en title when the locale is en, and en aliases in ANY locale", () => {
    setLocale("en");
    expect(rankCommandEntries("Review", searchCommandEntries()).map((entry) => entry.id)).toEqual([
      "open:review.panel"
    ]);
    setLocale("zh");
    // "settings" is an alias — matches even while titles are zh.
    expect(rankCommandEntries("settings", searchCommandEntries()).map((entry) => entry.id)).toEqual([
      "open:settings.hub"
    ]);
  });

  it("no match → empty", () => {
    expect(rankCommandEntries("量子引力", searchCommandEntries())).toEqual([]);
  });
});

describe("buildPaletteGroups — grouped rows, flat keyboard indices, display caps", () => {
  it("groups in design order (note → source → command) with correct startIndex", () => {
    const hits: SearchHitDto[] = [noteHit("n1"), noteHit("n2"), sourceHit("s1")];
    const commands = rankCommandEntries("复习", searchCommandEntries());
    const { groups, rows } = buildPaletteGroups(hits, commands);
    expect(groups.map((group) => group.family)).toEqual(["note", "source", "command"]);
    expect(groups.map((group) => group.startIndex)).toEqual([0, 2, 3]);
    expect(rows.length).toBe(4);
  });

  it("omits empty groups", () => {
    const { groups } = buildPaletteGroups([noteHit("n1")], []);
    expect(groups.map((group) => group.family)).toEqual(["note"]);
  });

  it("caps each family for display", () => {
    const hits: SearchHitDto[] = [
      ...Array.from({ length: NOTE_DISPLAY_CAP + 3 }, (_, index) => noteHit(`n${index}`)),
      ...Array.from({ length: SOURCE_DISPLAY_CAP + 3 }, (_, index) => sourceHit(`s${index}`))
    ];
    const { groups } = buildPaletteGroups(hits, []);
    expect(groups[0].rows.length).toBe(NOTE_DISPLAY_CAP);
    expect(groups[1].rows.length).toBe(SOURCE_DISPLAY_CAP);
  });
});

describe("searchPaletteKeyDown — the SC-0 keyboard shape", () => {
  const rows: PaletteRow[] = [
    { family: "note", hit: noteHit("n1") },
    { family: "note", hit: noteHit("n2") },
    { family: "source", hit: sourceHit("s1") }
  ];

  it("arrows move with wrap; Enter picks the active row; other keys pass through", () => {
    const onNavigate = vi.fn();
    const onPick = vi.fn();
    expect(searchPaletteKeyDown("ArrowDown", { rows, activeIndex: 2, onNavigate, onPick })).toBe(true);
    expect(onNavigate).toHaveBeenLastCalledWith(0); // wraps
    expect(searchPaletteKeyDown("ArrowUp", { rows, activeIndex: 0, onNavigate, onPick })).toBe(true);
    expect(onNavigate).toHaveBeenLastCalledWith(2); // wraps backward
    expect(searchPaletteKeyDown("Enter", { rows, activeIndex: 1, onNavigate, onPick })).toBe(true);
    expect(onPick).toHaveBeenCalledWith(rows[1]);
    expect(searchPaletteKeyDown("a", { rows, activeIndex: 0, onNavigate, onPick })).toBe(false);
  });

  it("empty row list consumes nothing", () => {
    const onNavigate = vi.fn();
    const onPick = vi.fn();
    expect(searchPaletteKeyDown("Enter", { rows: [], activeIndex: 0, onNavigate, onPick })).toBe(false);
    expect(onPick).not.toHaveBeenCalled();
  });
});
