// httpRange — a PURE parser for an HTTP `Range` request header (RFC 7233, single
// byte range). It is split out from the asset route so the edge cases (open-ended,
// suffix, out-of-range, malformed) are unit-testable without spinning up a server.
//
// We support the common single-range forms a <video> element sends:
//   • bytes=START-END   — an explicit closed range.
//   • bytes=START-      — open-ended (START to the end of the file).
//   • bytes=-SUFFIX     — the last SUFFIX bytes.
// Multi-range (`bytes=0-1,5-6`) and non-"bytes" units are treated as "ignore" → the
// caller serves the full 200 response (a correct, if non-optimal, fallback).

export type RangeParse =
  | { kind: "none" } // no/empty/ignored header → serve full 200
  | { kind: "satisfiable"; start: number; end: number } // inclusive byte offsets
  | { kind: "unsatisfiable" }; // valid syntax but outside the file → 416

/**
 * Parse a Range header against a known total size. Returns:
 *   • "none"          — absent / malformed / multi-range / non-bytes → caller sends 200.
 *   • "satisfiable"   — { start, end } inclusive, clamped to [0, total-1].
 *   • "unsatisfiable" — syntactically valid but entirely past the file → caller sends 416.
 * `total` is the file size in bytes (>= 0). Never throws.
 */
export function parseRange(header: string | undefined, total: number): RangeParse {
  if (typeof header !== "string" || header.trim() === "") return { kind: "none" };

  const match = /^bytes=(.*)$/.exec(header.trim());
  if (!match) return { kind: "none" }; // not a bytes unit → ignore.

  const spec = match[1].trim();
  // Multi-range (comma) is not supported here → fall back to full response.
  if (spec.includes(",")) return { kind: "none" };

  const dash = spec.indexOf("-");
  if (dash < 0) return { kind: "none" }; // malformed (no dash) → ignore.

  const startStr = spec.slice(0, dash).trim();
  const endStr = spec.slice(dash + 1).trim();

  // An empty file can satisfy no byte range.
  if (total <= 0) return { kind: "unsatisfiable" };

  // Suffix range: bytes=-N → the last N bytes.
  if (startStr === "") {
    if (endStr === "" || !/^\d+$/.test(endStr)) return { kind: "none" }; // "bytes=-" is malformed.
    const suffix = Number(endStr);
    if (suffix === 0) return { kind: "unsatisfiable" }; // last 0 bytes → not satisfiable.
    const start = Math.max(0, total - suffix);
    return { kind: "satisfiable", start, end: total - 1 };
  }

  if (!/^\d+$/.test(startStr)) return { kind: "none" }; // malformed start → ignore.
  const start = Number(startStr);
  // Start beyond the last byte → unsatisfiable (416).
  if (start > total - 1) return { kind: "unsatisfiable" };

  // Open-ended: bytes=N- → N to the end.
  if (endStr === "") return { kind: "satisfiable", start, end: total - 1 };

  if (!/^\d+$/.test(endStr)) return { kind: "none" }; // malformed end → ignore.
  let end = Number(endStr);
  if (end < start) return { kind: "none" }; // inverted range → ignore (serve full).
  // Clamp an over-long end to the last byte.
  if (end > total - 1) end = total - 1;
  return { kind: "satisfiable", start, end };
}
