import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { clearToolsForTests, getTool, listTools, type ToolDefinition } from "../ai";
import { openVault, type StudyVault } from "../core/vault";
import {
  AGENT_TOOL_RESULT_CHAR_BUDGET,
  ANCHOR_QUOTE_CHAR_CAP,
  SEARCH_SNIPPET_CHAR_CAP,
  SOURCE_EXCERPT_CHAR_CAP,
  createAgentTools,
  registerAgentTools
} from "./agentTools";
import { createApp } from "./app";

// A4a read-only agent tools, run against a REAL tmp vault seeded through the API
// (the svpack.test.ts idiom) — so the tools read exactly the records the app writes.

type Ctx = { app: ReturnType<typeof createApp>; vault: StudyVault };

const madeDirs: string[] = [];
async function tmp(tag: string): Promise<string> {
  const d = await mkdtemp(path.join(os.tmpdir(), `agent-tools-${tag}-`));
  madeDirs.push(d);
  return d;
}
afterAll(async () => {
  await Promise.all(madeDirs.map((d) => rm(d, { recursive: true, force: true })));
});
afterEach(() => clearToolsForTests());

const HTML =
  "<article><h1>Cell Biology</h1><p>Intro to the cell.</p>" +
  "<p>The mitochondrion is the powerhouse of the cell.</p></article>";
const QUOTE = "The mitochondrion is the powerhouse of the cell.";

async function makeCtx(tag: string): Promise<Ctx> {
  const vault = await openVault({ rootDir: await tmp(tag) });
  return { app: createApp({ vault }), vault };
}

async function seedSource(ctx: Ctx, title = "Cell Biology", content = HTML): Promise<string> {
  const res = await request(ctx.app).post("/api/sources/html").send({ title, content }).expect(201);
  return res.body.source.id;
}

async function seedAnchor(ctx: Ctx, sourceId: string): Promise<string> {
  const res = await request(ctx.app)
    .post("/api/anchors")
    .send({ sourceId, anchorKind: "html_selection", studyId: `seed-${sourceId}`, quote: QUOTE })
    .expect(201);
  return res.body.anchor.id;
}

async function seedNote(ctx: Ctx, sourceId: string, content: string): Promise<string> {
  const res = await request(ctx.app)
    .post("/api/notes")
    .send({ sourceId, contentType: "markdown", content })
    .expect(201);
  return res.body.note.id;
}

function toolByName(tools: ToolDefinition[], name: string): ToolDefinition {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool not created: ${name}`);
  return tool;
}

describe("agent tools — search_notes", () => {
  it("finds a seeded note by content substring and returns compact rows", async () => {
    const ctx = await makeCtx("search");
    const sourceId = await seedSource(ctx);
    const noteId = await seedNote(ctx, sourceId, "Mnemonic: the mitochondrion is the powerhouse.");

    const search = toolByName(createAgentTools({ vault: ctx.vault }), "search_notes");
    const result = (await search.execute({ query: "POWERHOUSE" }, undefined)) as {
      rows: Array<{ id: string; contentType: string; snippet: string; sourceId?: string }>;
      total: number;
      truncated: boolean;
    };

    expect(result.total).toBe(1);
    expect(result.truncated).toBe(false);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].id).toBe(noteId);
    expect(result.rows[0].contentType).toBe("markdown");
    expect(result.rows[0].sourceId).toBe(sourceId);
    expect(result.rows[0].snippet).toContain("powerhouse");
  });

  it("matches on contentType too, and rejects invalid input via the zod schema", async () => {
    const ctx = await makeCtx("search-type");
    const sourceId = await seedSource(ctx);
    await seedNote(ctx, sourceId, "plain text without the query word");

    const search = toolByName(createAgentTools({ vault: ctx.vault }), "search_notes");
    const byType = (await search.execute({ query: "markdown" }, undefined)) as { total: number };
    expect(byType.total).toBe(1);

    await expect(search.execute({}, undefined)).rejects.toThrow(); // query required
    await expect(search.execute({ query: "x", limit: 999 }, undefined)).rejects.toThrow(); // limit capped
  });

  it("caps the snippet on a large note and the row set to the serialized budget", async () => {
    const ctx = await makeCtx("search-caps");
    const sourceId = await seedSource(ctx);
    // One HUGE note: the snippet must stay a small window, not the whole content.
    await seedNote(ctx, sourceId, `${"x".repeat(5000)} BUDGET-NEEDLE ${"y".repeat(5000)}`);
    // Many matching notes: the returned rows must fit the ~2k serialized budget.
    for (let i = 0; i < 14; i += 1) {
      await seedNote(ctx, sourceId, `note ${i}: ${"lorem ipsum ".repeat(30)}BUDGET-NEEDLE${" dolor sit".repeat(20)}`);
    }

    const search = toolByName(createAgentTools({ vault: ctx.vault }), "search_notes");
    const result = (await search.execute({ query: "BUDGET-NEEDLE", limit: 20 }, undefined)) as {
      rows: Array<{ snippet: string }>;
      total: number;
      truncated: boolean;
    };

    expect(result.total).toBe(15);
    for (const row of result.rows) {
      // window + leading/trailing ellipsis at most
      expect(row.snippet.length).toBeLessThanOrEqual(SEARCH_SNIPPET_CHAR_CAP + 2);
      expect(row.snippet).toContain("BUDGET-NEEDLE");
    }
    expect(JSON.stringify(result.rows).length).toBeLessThanOrEqual(AGENT_TOOL_RESULT_CHAR_BUDGET);
    expect(result.rows.length).toBeLessThan(result.total);
    expect(result.truncated).toBe(true);
  });
});

describe("agent tools — get_source", () => {
  it("returns title/type/location plus a text excerpt for an html source", async () => {
    const ctx = await makeCtx("get-source");
    const sourceId = await seedSource(ctx);

    const getSource = toolByName(createAgentTools({ vault: ctx.vault }), "get_source");
    const result = (await getSource.execute({ sourceId }, undefined)) as Record<string, unknown>;

    expect(result.id).toBe(sourceId);
    expect(result.title).toBe("Cell Biology");
    expect(result.sourceType).toBe("html");
    expect(typeof result.location).toBe("string");
    expect(result.excerpt).toContain("mitochondrion");
    expect(result.excerptTruncated).toBe(false);
  });

  it("caps the excerpt on a large source and flags the truncation", async () => {
    const ctx = await makeCtx("get-source-cap");
    const sourceId = await seedSource(ctx, "Long Read", `<article><p>${"mitochondria forever ".repeat(300)}</p></article>`);

    const getSource = toolByName(createAgentTools({ vault: ctx.vault }), "get_source");
    const result = (await getSource.execute({ sourceId }, undefined)) as { excerpt: string; excerptTruncated: boolean };

    expect(result.excerpt.length).toBe(SOURCE_EXCERPT_CHAR_CAP);
    expect(result.excerptTruncated).toBe(true);
  });

  it("answers an unknown id with an in-band { error } row (no throw)", async () => {
    const ctx = await makeCtx("get-source-404");
    const getSource = toolByName(createAgentTools({ vault: ctx.vault }), "get_source");
    await expect(getSource.execute({ sourceId: "nope" }, undefined)).resolves.toEqual({
      error: "Source not found: nope"
    });
  });
});

describe("agent tools — list_anchors", () => {
  it("lists a source's anchors as { id, kind, quote } rows", async () => {
    const ctx = await makeCtx("anchors");
    const sourceId = await seedSource(ctx);
    const anchorId = await seedAnchor(ctx, sourceId);
    const otherSource = await seedSource(ctx, "Other", "<article><p>other</p></article>");

    const listAnchors = toolByName(createAgentTools({ vault: ctx.vault }), "list_anchors");
    const result = (await listAnchors.execute({ sourceId }, undefined)) as {
      rows: Array<{ id: string; kind: string; quote: string }>;
      total: number;
      truncated: boolean;
    };

    expect(result.total).toBe(1);
    expect(result.rows).toEqual([{ id: anchorId, kind: "html_selection", quote: QUOTE }]);
    expect(result.rows[0].quote.length).toBeLessThanOrEqual(ANCHOR_QUOTE_CHAR_CAP);

    const empty = (await listAnchors.execute({ sourceId: otherSource }, undefined)) as { rows: unknown[]; total: number };
    expect(empty).toEqual({ rows: [], total: 0, truncated: false });

    await expect(listAnchors.execute({ sourceId: "nope" }, undefined)).resolves.toEqual({
      error: "Source not found: nope"
    });
  });
});

describe("registerAgentTools — registry wiring", () => {
  it("registers the three read-only tools and re-registration replaces, not duplicates", async () => {
    const ctx = await makeCtx("registry");
    const first = registerAgentTools({ vault: ctx.vault });

    expect(first.map((t) => t.name)).toEqual(["search_notes", "get_source", "list_anchors"]);
    expect(listTools().map((t) => t.name)).toEqual(["search_notes", "get_source", "list_anchors"]);
    expect(getTool("search_notes")).toBe(first[0]);

    // A second app registering over the same names REPLACES the entries.
    const second = registerAgentTools({ vault: ctx.vault });
    expect(listTools()).toHaveLength(3);
    expect(getTool("search_notes")).toBe(second[0]);
  });
});
