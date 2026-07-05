// Typed service errors (multi-platform X0 / architecture-review F2): services are
// transport-agnostic, so they signal failures with these error classes instead of
// touching an HTTP response. The Express edge maps them to status codes via
// `handleServiceError`; the future mobile direct-call adapter (X0b) maps them to
// its own result shape. Messages are part of the API contract (they become the
// `{ error } ` body verbatim), so keep them byte-identical when refactoring.

// NOTE: import the concrete module, NOT the "../../ai" barrel — the barrel re-exports
// claudeCliProvider (node:child_process / node-pty), which would leak Node deps into every
// file that imports this errors module (incl 8/12 directTransport services). provider.ts is
// node-clean. This is the PLAT-LAYER §5.1 barrel-leak fix (prerequisite for the mobile guard).
import { VisionUnsupportedError } from "../../ai/provider";

/** Entity lookup failed → HTTP 404. */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

/** Domain-level invalid input (beyond zod shape validation) → HTTP 400. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** The operation is not allowed on this record (e.g. sealed content) → HTTP 403. */
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * State conflict → HTTP 409. When `body` is set the transport sends it verbatim
 * instead of `{ error: message }` (the patch-apply conflict responds with
 * `{ patch, conflict }`, no `error` field — preserved byte-compatibly).
 */
export class ConflictError extends Error {
  readonly body?: unknown;
  constructor(message: string, body?: unknown) {
    super(message);
    this.name = "ConflictError";
    this.body = body;
  }
}

// Structural response type so this module never imports express (it must stay
// loadable in non-HTTP hosts; express Response satisfies it).
type JsonResponder = { status(code: number): { json(body: unknown): unknown } };

/**
 * Map a typed service error onto an HTTP response. Returns true when the error
 * was handled; false means "not a service error" — the route should `next(error)`
 * so ZodErrors keep flowing to the shared 400 middleware and everything else to 500.
 */
export function handleServiceError(res: JsonResponder, error: unknown): boolean {
  if (error instanceof NotFoundError) {
    res.status(404).json({ error: error.message });
    return true;
  }
  if (error instanceof ValidationError) {
    res.status(400).json({ error: error.message });
    return true;
  }
  if (error instanceof ForbiddenError) {
    res.status(403).json({ error: error.message });
    return true;
  }
  if (error instanceof ConflictError) {
    res.status(409).json(error.body ?? { error: error.message });
    return true;
  }
  // V-1 (vision-input.md §2): an image was sent to a non-vision provider (or the
  // attached asset vanished) → 400, a client/capability problem, not a server fault.
  if (error instanceof VisionUnsupportedError) {
    res.status(400).json({ error: error.message });
    return true;
  }
  return false;
}
