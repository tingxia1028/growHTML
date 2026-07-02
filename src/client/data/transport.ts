// VaultTransport — the pluggable backend seam under entityClient (X0b,
// docs/design/multi-platform.md §1-X0): every JSON api call flows through ONE
// `request(method, path, body?)` so the SAME client code can run over HTTP
// (dev/desktop today, `createHttpTransport`) or over an in-process direct adapter
// that calls the extracted services with no HTTP at all (mobile X2,
// src/server/services/directTransport.ts). JSON in / JSON out; a 204 resolves to
// `undefined` (there is no body to parse); failures throw `ApiError` carrying the
// HTTP status + the server's machine `code`.
//
// Deliberately NOT routed through the transport (HTTP-only for now):
//   • POST /api/chat/stream — SSE needs an incremental byte stream, not JSON
//     in/out; entityClient.chatStream keeps its own fetch (and degrades to the
//     transport-routed chat() when the stream endpoint is unavailable).
//   • GET /api/assets/:assetId — binary bytes consumed by the platform URL loader
//     (<img>/<audio>/<video> src with Range support); entityClient.assetUrl hands
//     out the URL verbatim instead of fetching.
//   • The other byte-stream endpoints (source file/content, /api/local/*) never
//     went through entityClient's JSON helpers in the first place.

export interface VaultTransport {
  /**
   * One JSON request. `body === undefined` ⇒ the request carries no body (the
   * DELETE/GET idiom); a 204 response resolves to `undefined`; a non-2xx response
   * rejects with `ApiError(message, status, code?)`.
   */
  request<T>(method: string, path: string, body?: unknown): Promise<T>;
}

/**
 * Failure carrying the HTTP status + the server's machine error `code`. The svpack
 * flows branch on these ("wrong-code" vs "expired" vs "stale-revision" need different
 * honest messages), so a bare message string is not enough.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * The default transport: fetch against the same-origin HTTP API. This is
 * entityClient's original fetch logic extracted verbatim (one parse path — the
 * error body is best-effort JSON, `body.error` is the message, `body.code` the
 * machine code) plus the 204→undefined rule that postMemoryEvents relied on.
 */
export function createHttpTransport(): VaultTransport {
  return {
    async request<T>(method: string, path: string, body?: unknown): Promise<T> {
      const response = await fetch(
        path,
        body === undefined
          ? { method }
          : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      );
      if (response.status === 204) return undefined as T;
      const parsed = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
      if (!response.ok) {
        throw new ApiError(
          parsed.error ?? `Request failed: ${path}`,
          response.status,
          typeof parsed.code === "string" ? parsed.code : undefined
        );
      }
      return parsed as T;
    }
  };
}
