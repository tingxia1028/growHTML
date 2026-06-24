import { afterEach, describe, expect, it, vi } from "vitest";
import { entityClient } from "./entityClient";

type Call = { url: string; method: string; body: unknown };

function mockFetch(responseBody: unknown = {}) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(init.body as string) : undefined
    });
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("entityClient", () => {
  it("creates a note with the new shape", async () => {
    const calls = mockFetch({ note: { id: "note_x" } });
    await entityClient.createNote({
      sourceId: "src_1",
      anchorIds: ["anchor_1"],
      contentType: "markdown",
      content: "hi"
    });
    expect(calls[0].url).toBe("/api/notes");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toEqual({
      sourceId: "src_1",
      anchorIds: ["anchor_1"],
      contentType: "markdown",
      content: "hi"
    });
  });

  it("builds entity-oriented query URLs", async () => {
    const calls = mockFetch({ notes: [] });
    await entityClient.notesByConcept("concept_1");
    await entityClient.notesByAnchor("anchor_1");
    expect(calls[0].url).toBe("/api/notes?conceptId=concept_1");
    expect(calls[1].url).toBe("/api/notes?anchorId=anchor_1");
  });

  it("hits the right method/url for concepts, relations, assets, workspace", async () => {
    const calls = mockFetch({});
    await entityClient.createConcept({ name: "Render Thread" });
    await entityClient.createRelation({
      from: { type: "concept", id: "c1" },
      to: { type: "concept", id: "c2" },
      relationKind: "depends_on"
    });
    await entityClient.deleteRelation("rel_1");
    await entityClient.importAsset("/tmp/x.png");
    await entityClient.saveWorkspace({ activeLayoutId: "", layouts: [] });

    expect(calls[0]).toMatchObject({ url: "/api/concepts", method: "POST" });
    expect(calls[1]).toMatchObject({ url: "/api/relations", method: "POST" });
    expect(calls[2]).toMatchObject({ url: "/api/relations/rel_1", method: "DELETE" });
    expect(calls[3]).toMatchObject({ url: "/api/assets/local-file", method: "POST", body: { path: "/tmp/x.png" } });
    expect(calls[4]).toMatchObject({ url: "/api/workspace", method: "PUT" });
  });

  it("throws the server error message on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "boom" }), { status: 400 }))
    );
    await expect(entityClient.concepts()).rejects.toThrow("boom");
  });

  it("exposes a direct asset url", () => {
    expect(entityClient.assetUrl("asset_1")).toBe("/api/assets/asset_1");
  });
});
