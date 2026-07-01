// server-only (node:crypto/node:fs) — never import from src/client.
// Clock high-water-mark (design §8.1): the max wall-clock time ever observed, stored
// AES-GCM-encrypted under the device key beside it. If `now` is ever more than `slack`
// BEHIND that mark, the clock was rolled back and time-boxed packs refuse to unseal.
// Stops casual clock rollback; a patched client is out of scope (§1). Every validity
// check is itself a clock observation, so the mark advances as a side effect.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { aeadDecrypt, aeadEncrypt } from "../crypto/primitives";

export const CLOCK_HWM_FILE = "clock.hwm";
export const DEFAULT_CLOCK_SLACK_MS = 5 * 60 * 1000;

const CLOCK_MAGIC = Buffer.from("SVHW1\n", "utf8");
const CLOCK_AAD = Buffer.from("svpack/v2/clock-hwm", "utf8");

export type ValidityWindow = {
  notBefore: string | null;
  validUntil: string | null;
};

export type ValidityCheck =
  | { ok: true }
  | { ok: false; reason: "expired" | "not-yet-valid" | "clock-rollback" };

/**
 * Read the persisted mark. Missing or corrupt (tampered, wrong device key, truncated)
 * ⇒ null: the caller re-seeds from `now` — self-heal, never brick (§8.1). Deleting the
 * file buys an attacker nothing: the fresh mark starts at the current observation.
 */
function readHighWater(dir: string, deviceKey: Uint8Array): number | null {
  let raw: Buffer;
  try {
    raw = readFileSync(path.join(dir, CLOCK_HWM_FILE));
  } catch {
    return null;
  }
  if (raw.length <= CLOCK_MAGIC.length + 12 || !raw.subarray(0, CLOCK_MAGIC.length).equals(CLOCK_MAGIC)) {
    return null;
  }
  try {
    const nonce = raw.subarray(CLOCK_MAGIC.length, CLOCK_MAGIC.length + 12);
    const ciphertext = raw.subarray(CLOCK_MAGIC.length + 12);
    const plaintext = aeadDecrypt({ key: deviceKey, nonce, ciphertext, aad: CLOCK_AAD });
    const parsed: unknown = JSON.parse(plaintext.toString("utf8"));
    const hwmMs = (parsed as { hwmMs?: unknown }).hwmMs;
    return typeof hwmMs === "number" && Number.isFinite(hwmMs) ? hwmMs : null;
  } catch {
    return null;
  }
}

function writeHighWater(dir: string, deviceKey: Uint8Array, hwmMs: number): void {
  const plaintext = Buffer.from(JSON.stringify({ v: 1, hwmMs }), "utf8");
  const { nonce, ciphertext } = aeadEncrypt({ key: deviceKey, plaintext, aad: CLOCK_AAD });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, CLOCK_HWM_FILE), Buffer.concat([CLOCK_MAGIC, nonce, ciphertext]));
}

/** Record a wall-clock observation: persist max(now, stored). Never lowers the mark. */
export function observeNow(dir: string, deviceKey: Uint8Array, now: number = Date.now()): void {
  const stored = readHighWater(dir, deviceKey);
  writeHighWater(dir, deviceKey, Math.max(now, stored ?? now));
}

function parseValidityMs(value: string | null, label: string): number | null {
  if (value === null) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new Error(`invalid validity.${label} timestamp: ${value}`);
  return ms;
}

/**
 * Gate a pack's signed `validity` window against the clock (run at import and at every
 * unseal, §8.1). Order: rollback first (a rolled-back clock makes the other answers
 * meaningless), then notBefore, then validUntil. `now` is injectable for tests;
 * `slackMs` absorbs legitimate small corrections (NTP, timezone fiddling).
 */
export function checkValidity(
  dir: string,
  deviceKey: Uint8Array,
  validity: ValidityWindow,
  options: { slackMs?: number; now?: number } = {}
): ValidityCheck {
  const slackMs = options.slackMs ?? DEFAULT_CLOCK_SLACK_MS;
  const now = options.now ?? Date.now();

  const stored = readHighWater(dir, deviceKey);
  // Every check is an observation: advance (never lower) the mark; a missing/corrupt
  // file self-heals to `now` instead of bricking every sealed pack.
  writeHighWater(dir, deviceKey, Math.max(now, stored ?? now));

  if (stored !== null && now < stored - slackMs) return { ok: false, reason: "clock-rollback" };

  const notBeforeMs = parseValidityMs(validity.notBefore, "notBefore");
  if (notBeforeMs !== null && now < notBeforeMs) return { ok: false, reason: "not-yet-valid" };

  const validUntilMs = parseValidityMs(validity.validUntil, "validUntil");
  if (validUntilMs !== null && now > validUntilMs) return { ok: false, reason: "expired" };

  return { ok: true };
}
