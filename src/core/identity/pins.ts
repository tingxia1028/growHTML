// server-only (node:fs) — never import from src/client.
// TOFU pin store (design §5.1): on first import the recipient pins
// (publisherId, signingPubKey, displayName); later packs claiming the same id must
// carry the pinned key — "pinned-mismatch" is the hard-fail "NOT the same 王老师"
// warning. Plain JSON: pins are not secrets (they hold public keys); what matters is
// the 3-state answer, and self-certifying ids make a forged pin useless anyway.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

export const PINNED_PUBLISHERS_FILE = "pinned-publishers.json";

const pinnedPublisherSchema = z.object({
  id: z.string().min(1),
  publicKeyB64u: z.string().min(1),
  displayName: z.string(),
  pinnedAt: z.string().min(1)
});

const pinFileSchema = z.object({
  v: z.literal(1),
  publishers: z.array(pinnedPublisherSchema)
});

export type PinnedPublisher = z.infer<typeof pinnedPublisherSchema>;

export type PinStatus = "unknown" | "pinned-match" | "pinned-mismatch";

function readPins(dir: string): PinnedPublisher[] {
  let raw: string;
  try {
    raw = readFileSync(path.join(dir, PINNED_PUBLISHERS_FILE), "utf8");
  } catch {
    return []; // no pins yet
  }
  try {
    return pinFileSchema.parse(JSON.parse(raw)).publishers;
  } catch {
    // Corrupt store ⇒ treated as empty (fresh TOFU) rather than bricking every import;
    // the import UI then shows "first time — fingerprint …" instead of a false match.
    return [];
  }
}

function writePins(dir: string, publishers: PinnedPublisher[]): void {
  mkdirSync(dir, { recursive: true });
  const body = JSON.stringify({ v: 1, publishers }, null, 2);
  writeFileSync(path.join(dir, PINNED_PUBLISHERS_FILE), `${body}\n`, "utf8");
}

export function listPinnedPublishers(dir: string): PinnedPublisher[] {
  return readPins(dir);
}

export function pinStatus(dir: string, publisherId: string, publicKeyB64u: string): PinStatus {
  const pin = readPins(dir).find((entry) => entry.id === publisherId);
  if (!pin) return "unknown";
  return pin.publicKeyB64u === publicKeyB64u ? "pinned-match" : "pinned-mismatch";
}

/**
 * Upsert a pin. Re-pinning an id with a NEW key is allowed on purpose — it is the
 * explicit "I verified out-of-band, trust the new key" user action after a mismatch.
 */
export function pinPublisher(
  dir: string,
  entry: { id: string; publicKeyB64u: string; displayName: string }
): PinnedPublisher {
  const pinned: PinnedPublisher = { ...entry, pinnedAt: new Date().toISOString() };
  const others = readPins(dir).filter((existing) => existing.id !== entry.id);
  writePins(dir, [...others, pinned]);
  return pinned;
}
