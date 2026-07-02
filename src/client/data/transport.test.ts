// X0b guard (a): the http transport is entityClient's original fetch logic
// extracted VERBATIM — same request shaping, same JSON parsing, same
// ApiError(status + machine code) on failure — plus the 204→undefined rule the
// fire-and-forget memory POST relies on.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, createHttpTransport } from "./transport";
import { ApiError as ReExportedApiError } from "./entityClient";

type Call = { url: string; init: RequestInit | undefined };

function stubFetch(response: Response) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return response;
    })
  );
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("createHttpTransport", () => {
  it("sends a JSON body with Content-Type and resolves the parsed response", async () => {
    const calls = stubFetch(json({ note: { id: "note_x" } }, 201));
    const result = await createHttpTransport().request<{ note: { id: string } }>("POST", "/api/notes", {
      content: "hi"
    });
    expect(result).toEqual({ note: { id: "note_x" } });
    expect(calls[0].url).toBe("/api/notes");
    expect(calls[0].init).toEqual({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "hi" })
    });
  });

  it("omits body and headers entirely when body is undefined (GET/DELETE idiom)", async () => {
    const calls = stubFetch(json({ ok: true }));
    await createHttpTransport().request("DELETE", "/api/notes/note_x");
    expect(calls[0].init).toEqual({ method: "DELETE" });
  });

  it("resolves undefined for a 204 (no body to parse — the capture-off drop)", async () => {
    stubFetch(new Response(null, { status: 204 }));
    await expect(
      createHttpTransport().request("POST", "/api/memory/events", { events: [] })
    ).resolves.toBeUndefined();
  });

  it("throws ApiError carrying the HTTP status + the server's machine code", async () => {
    stubFetch(json({ error: "wrong code for this pack", code: "wrong-code" }, 403));
    const error = await createHttpTransport()
      .request("POST", "/api/svpack/open", { fileB64: "x", code: "BAD" })
      .catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(403);
    expect((error as ApiError).code).toBe("wrong-code");
    expect((error as ApiError).message).toBe("wrong code for this pack");
  });

  it("falls back to `Request failed: <path>` when the error body is not JSON", async () => {
    stubFetch(new Response("gateway exploded", { status: 502 }));
    const error = await createHttpTransport()
      .request("GET", "/api/concepts")
      .catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(502);
    expect((error as ApiError).code).toBeUndefined();
    expect((error as ApiError).message).toBe("Request failed: /api/concepts");
  });

  it("keeps ONE ApiError class identity across the entityClient re-export", () => {
    // instanceof branches (svpackViews' mapSvpackError) must match errors thrown by
    // either transport regardless of which module the caller imported ApiError from.
    expect(ReExportedApiError).toBe(ApiError);
  });
});
