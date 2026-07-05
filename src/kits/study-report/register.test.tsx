// @vitest-environment jsdom
// REPORT-1 study-report kit registration + launch + generate (commit 3). Installing the
// client kits + the server prompts wires: the study-report.report note type (render/edit
// through the ONE getNoteType contract); the study-report.generate + study-report.open
// commands; the study-report.generate prompt (resolvable). Plus:
//   • the generate command RE-MERGES the deterministic stats OVER the (stubbed) AI output
//     (delta 3) + emits a SOURCE-LESS onGenerated draft (anchorId undefined)
//   • the report.list view lists study-report.report notes via entityClient.allNotes()
//   • the study-report.open command + the global-search NAV entry navigate to report.list
//   • render/edit don't throw on empty/foreign content

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

const navigateShell = vi.hoisted(() => vi.fn(() => true));
vi.mock("../../client/workspace/shellNav", () => ({ navigateShell }));

// Side effect: install the Product Kits (registers the note type + commands).
import "../clientKits";
import "../../client/notes/builtinNoteTypes";
// The report.list VIEW self-registers here (shell-imported at runtime; imported directly in
// the test, the mistakeBookView.test precedent).
import "./ReportListView";
// Server-side prompt/spec registration (React-free) — the installServerKits path.
import { installServerKits } from "../server";

import { getCommand, type CommandContext, type GeneratedDraft } from "../../client/commands/registry";
import { getNoteType } from "../../client/notes/noteTypeRegistry";
import { getView, type WorkspaceContext } from "../../client/workspace/viewRegistry";
import { getKitPrompt } from "../prompts";
import { getNoteContentSpec } from "../../core/notes/contentTypes";
import { entityClient, type NoteRecord, type WorkspaceNode } from "../../client/data/entityClient";
import { searchCommandEntries } from "../../client/search/commandEntries";
import { generateReportPrompt } from "./prompts/generateReport.prompt";
import { STUDY_REPORT_CONTENT_TYPE } from "./contentTypes";

installServerKits();

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  navigateShell.mockClear();
  document.body.innerHTML = "";
});
afterEach(() => vi.restoreAllMocks());

describe("study-report kit registration", () => {
  it("registers the study-report.report content spec (server validation path)", () => {
    expect(getNoteContentSpec(STUDY_REPORT_CONTENT_TYPE)).toBeTruthy();
  });

  it("getKitPrompt resolves study-report.generate after installServerKits → study-report.report output", () => {
    const prompt = getKitPrompt("study-report.generate");
    expect(prompt).toBeTruthy();
    expect(prompt!.outputType).toBe(STUDY_REPORT_CONTENT_TYPE);
  });

  it("getNoteType('study-report.report') render/edit don't throw on empty/foreign content", () => {
    const plugin = getNoteType(STUDY_REPORT_CONTENT_TYPE);
    expect(plugin).toBeTruthy();
    expect(isValidElement(plugin!.render({ content: {}, mode: "full" }))).toBe(true);
    expect(isValidElement(plugin!.render({ content: { junk: 1 }, mode: "card" }))).toBe(true);
    expect(isValidElement(plugin!.edit!({ content: undefined, onChange: () => {} }))).toBe(true);
  });

  it("registers both study-report commands", () => {
    expect(getCommand("study-report.generate")).toBeTruthy();
    expect(getCommand("study-report.open")).toBeTruthy();
  });
});

describe("study-report.generate command (delta 3 re-merge + source-less draft)", () => {
  it("re-merges DETERMINISTIC stats over the AI output + emits a source-less onGenerated draft", async () => {
    // Seed the two memory reads: 3 reviews (2 pass/1 fail) + 2 note.create in the CURRENT
    // week (so the in-period window catches them), and a weak profile fact.
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    vi.spyOn(entityClient, "memoryDigests").mockResolvedValue({
      digests: [
        {
          period: "day",
          date: day,
          dimension: "overall",
          bucket: "all",
          events: 5,
          counts: { "note.create": 2, "note.review": 3 },
          review: { pass: 2, fail: 1, skip: 0 },
          firstAt: `${day}T09:00:00.000Z`,
          lastAt: `${day}T10:00:00.000Z`
        }
      ]
    } as never);
    vi.spyOn(entityClient, "memoryProfile").mockResolvedValue({
      facts: [{ key: "weak:a", kind: "weak", title: "弱项:A", value: "60%", pinned: false, hidden: false }]
    } as never);

    // A LYING client: returns a schema-valid report whose stats are WRONG (reviewsDone 999).
    // The command must overwrite them with the assembled truth (3) before onGenerated.
    const generateStructured = vi.fn(async () => ({
      content: {
        period: { label: "偽", from: "", to: "" },
        highlights: ["AI 亮点"],
        weakAreas: [],
        stats: {
          reviewsDone: 999,
          reviewPass: 999,
          reviewFail: 999,
          notesCreated: 999,
          mistakesLogged: 999,
          activeDays: 999,
          streakDays: 999
        },
        nextSteps: ["AI 下一步"],
        summary: "AI 小结"
      }
    }));

    let draft: GeneratedDraft | undefined;
    const ctx = {
      client: { generateStructured },
      actions: { onGenerated: (d: GeneratedDraft) => (draft = d) },
      payload: {}
    } as unknown as CommandContext;

    await getCommand("study-report.generate")!.run(ctx);

    expect(generateStructured).toHaveBeenCalledOnce();
    expect(draft).toBeTruthy();
    expect(draft!.contentType).toBe(STUDY_REPORT_CONTENT_TYPE);
    // SOURCE-LESS (vault-level): neither an anchor nor a source.
    expect(draft!.anchorId).toBeUndefined();
    expect(draft!.sourceId).toBeUndefined();

    const content = draft!.content as {
      stats: Record<string, number>;
      highlights: string[];
      summary: string;
    };
    // DELTA 3: deterministic stats WIN over the AI's lie.
    expect(content.stats.reviewsDone).toBe(3); // attempts = 2 pass + 1 fail (NOT 999)
    expect(content.stats.reviewPass).toBe(2);
    expect(content.stats.reviewFail).toBe(1);
    expect(content.stats.notesCreated).toBe(2);
    // The AI's PROSE is kept (it owns summary/highlights/nextSteps).
    expect(content.summary).toBe("AI 小结");
    expect(content.highlights).toEqual(["AI 亮点"]);
  });
});

describe("study-report.open + report.list view (delta 1 — reachability)", () => {
  it("the open command + the global-search entry navigate to report.list", () => {
    getCommand("study-report.open")!.run({} as never);
    expect(navigateShell).toHaveBeenCalledWith({ type: "pane", kind: "report.list" });

    const entry = searchCommandEntries().find((e) => e.id === "open:report.list");
    expect(entry, "study-report command missing from the STATIC palette list").toBeTruthy();
    expect(entry!.target).toEqual({ type: "pane", kind: "report.list" });
    expect(entry!.aliases).toContain("学习报告");
  });

  it("the report.list view lists study-report.report notes via allNotes(), excluding others", async () => {
    const report = (id: string): NoteRecord =>
      ({
        id,
        anchorIds: [],
        conceptIds: [],
        contentType: STUDY_REPORT_CONTENT_TYPE,
        content: generateReportPrompt.mockContent!({}),
        visibility: "private",
        layerIds: [],
        createdAt: `2026-06-1${id}T00:00:00.000Z`
      }) as unknown as NoteRecord;
    const plain = {
      id: "n_md",
      anchorIds: [],
      conceptIds: [],
      contentType: "markdown",
      content: "prose",
      visibility: "private",
      layerIds: []
    } as unknown as NoteRecord;
    vi.spyOn(entityClient, "allNotes").mockResolvedValue({ notes: [report("1"), report("2"), plain] });

    const plugin = getView("report.list");
    expect(plugin).toBeTruthy();
    const ctx = { dispatch: vi.fn(async () => {}) } as unknown as WorkspaceContext;
    const node = { id: "reports", kind: "report.list" } as WorkspaceNode;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    act(() => root.render(<>{plugin!.render(node, ctx) as ReactNode}</> as ReactElement));
    await act(async () => {}); // flush the allNotes load

    const rows = container.querySelectorAll(".study-report-item");
    expect(rows.length).toBe(2);
    const ids = Array.from(rows).map((el) => el.getAttribute("data-note-id"));
    expect(new Set(ids)).toEqual(new Set(["1", "2"]));
    // the report card markup rendered (the note-type render).
    expect(container.querySelector(".sr-report")).toBeTruthy();

    act(() => root.unmount());
    container.remove();
  });

  it("the generate button previews then Save persists a SOURCE-LESS report (ungated path)", async () => {
    // Empty vault + a lying-but-valid AI report (stats overwritten by delta-3 anyway).
    vi.spyOn(entityClient, "allNotes").mockResolvedValue({ notes: [] });
    vi.spyOn(entityClient, "memoryDigests").mockResolvedValue({ digests: [] } as never);
    vi.spyOn(entityClient, "memoryProfile").mockResolvedValue({ facts: [] } as never);
    vi.spyOn(entityClient, "generateStructured").mockResolvedValue({
      content: generateReportPrompt.mockContent!({}),
      contentType: STUDY_REPORT_CONTENT_TYPE,
      provider: "mock"
    } as never);
    const createNote = vi
      .spyOn(entityClient, "createNote")
      .mockResolvedValue({ note: { id: "n_new", contentType: STUDY_REPORT_CONTENT_TYPE } } as never);

    const plugin = getView("report.list")!;
    const ctx = { dispatch: vi.fn(async () => {}) } as unknown as WorkspaceContext;
    const node = { id: "reports", kind: "report.list" } as WorkspaceNode;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<>{plugin.render(node, ctx) as ReactNode}</> as ReactElement));
    await act(async () => {});

    // Generate → the inline preview shows the report card.
    await act(async () => {
      (container.querySelector(".study-report-generate-btn") as HTMLButtonElement).click();
    });
    expect(container.querySelector(".study-report-preview .sr-report")).toBeTruthy();

    // Save → a SOURCE-LESS createNote (anchorIds:[], NO sourceId key) with the report type.
    await act(async () => {
      (container.querySelector(".gen-preview-save") as HTMLButtonElement).click();
    });
    expect(createNote).toHaveBeenCalledOnce();
    const arg = createNote.mock.calls[0][0] as { sourceId?: string; anchorIds: string[]; contentType: string };
    expect(arg.contentType).toBe(STUDY_REPORT_CONTENT_TYPE);
    expect(arg.anchorIds).toEqual([]);
    expect(arg.sourceId).toBeUndefined(); // vault-level: source-less

    act(() => root.unmount());
    container.remove();
  });
});
