// server-only (node:crypto/node:fs) — never import from src/client.
// Sealed import store (design studypack-sharing §7): content committed from a
// protected `.svpack` NEVER enters the plaintext .study/*.jsonl stores. Each pack
// seals into one `vault/imports/<packId>.svsealed` blob, AES-256-GCM under the
// DEVICE key (which lives outside the vault, src/core/identity/deviceKey.ts) — so a
// copied vault directory is useless ciphertext, and buildStudyPack (which reads the
// stores) is STRUCTURALLY unable to re-export sealed content. Validity (§8.1) is
// re-checked at every unseal, so expired packs genuinely stop rendering.

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { AeadAuthenticationError, aeadDecrypt, aeadEncrypt } from "../core/crypto/primitives";
import { checkValidity } from "../core/identity/clock";
import { anchorSchema, noteSchema, studyLayerSchema } from "../core/schema";

export const SEALED_MAGIC = Buffer.from("SVSL1\n", "utf8");
export const SEALED_FILE_EXT = ".svsealed";
export const SEALED_IMPORTS_DIR = "imports";
// AAD binds a blob to its packId (= its file name), so renaming one sealed file over
// another is detected as tampering rather than silently swapping pack contents.
const SEALED_AAD_PREFIX = "svpack/v2/sealed-import/";

/** The blob exists but cannot be read: tampered, truncated, or a foreign device key. */
export class SealedReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SealedReadError";
  }
}

// —— Shape of the sealed plaintext ————————————————————————————————————————————
// Full REALIZED records (not portable forms): the read-model merge needs exactly what
// the entity stores would have held, so unsealing is a flag-and-append, not a rebuild.

const sealedEchoSchema = z.object({
  packId: z.string().min(1),
  revision: z.number().int().min(1),
  publisher: z.object({
    id: z.string().min(1),
    displayName: z.string(),
    publicKeyB64u: z.string().min(1)
  }),
  validity: z.object({
    notBefore: z.string().nullable(),
    validUntil: z.string().nullable()
  }),
  title: z.string(),
  sourceHash: z.string(),
  sourceType: z.string(),
  codeId: z.string().min(1),
  contentTypes: z.array(z.string()).default([])
});

const sealedImportSchema = z.object({
  v: z.literal(1),
  /** Signed-header echo — enough to re-gate validity and render a manager row. */
  echo: sealedEchoSchema,
  layer: studyLayerSchema,
  anchors: z.array(anchorSchema).default([]),
  notes: z.array(noteSchema).default([]),
  importedAt: z.string().min(1),
  /** Canonical 40-char code, kept (encrypted) so renewal packs import without re-typing. */
  rememberedCode: z.string().optional()
});

export type SealedEcho = z.infer<typeof sealedEchoSchema>;
export type SealedImportData = z.infer<typeof sealedImportSchema>;

export type SealedPackStatus = "active" | "expired" | "not-yet-valid" | "clock-rollback" | "unreadable";

/** Manager-list row: cleartext-safe summary + validity status; never note content. */
export type SealedPackMeta = {
  packId: string;
  status: SealedPackStatus;
  echo?: SealedEcho;
  importedAt?: string;
  counts?: { anchors: number; notes: number };
};

// —— Paths + framing ——————————————————————————————————————————————————————————

export function sealedImportsDir(vaultRootDir: string): string {
  return path.join(vaultRootDir, SEALED_IMPORTS_DIR);
}

function sealedFilePath(importsDir: string, packId: string): string {
  return path.join(importsDir, `${packId}${SEALED_FILE_EXT}`);
}

// Same u32-le length-prefixed framing as svpackFrame, as a small local sibling — a
// sealed blob is NOT a .svpack (different magic, no signature, device-key encrypted).
function writeSealedFrame(sections: Buffer[]): Buffer {
  const total = SEALED_MAGIC.length + sections.reduce((sum, section) => sum + 4 + section.length, 0);
  const file = Buffer.alloc(total);
  let offset = SEALED_MAGIC.copy(file, 0);
  for (const section of sections) {
    file.writeUInt32LE(section.length, offset);
    offset = offset + 4 + section.copy(file, offset + 4);
  }
  return file;
}

function readSealedFrame(file: Buffer, sectionCount: number): Buffer[] {
  if (file.length < SEALED_MAGIC.length || !file.subarray(0, SEALED_MAGIC.length).equals(SEALED_MAGIC)) {
    throw new SealedReadError("not a sealed import blob (bad magic)");
  }
  const sections: Buffer[] = [];
  let offset = SEALED_MAGIC.length;
  for (let index = 0; index < sectionCount; index += 1) {
    if (offset + 4 > file.length) throw new SealedReadError("truncated sealed blob (length prefix)");
    const length = file.readUInt32LE(offset);
    const start = offset + 4;
    if (start + length > file.length) throw new SealedReadError("truncated sealed blob (section)");
    sections.push(file.subarray(start, start + length));
    offset = start + length;
  }
  if (offset !== file.length) throw new SealedReadError("unexpected trailing bytes in sealed blob");
  return sections;
}

// —— Read / write ————————————————————————————————————————————————————————————

export function writeSealed(importsDir: string, deviceKey: Uint8Array, data: SealedImportData): void {
  const parsed = sealedImportSchema.parse(data);
  const aad = Buffer.from(`${SEALED_AAD_PREFIX}${parsed.echo.packId}`, "utf8");
  const { nonce, ciphertext } = aeadEncrypt({
    key: deviceKey,
    plaintext: Buffer.from(JSON.stringify(parsed), "utf8"),
    aad
  });
  mkdirSync(importsDir, { recursive: true });
  writeFileSync(sealedFilePath(importsDir, parsed.echo.packId), writeSealedFrame([nonce, ciphertext]));
}

/**
 * Decrypt one blob. Missing file ⇒ null (not installed); present-but-unreadable
 * (tampered / truncated / foreign device key) ⇒ SealedReadError, so callers can show
 * an honest "unreadable" state instead of silently pretending nothing is installed.
 */
export function readSealed(importsDir: string, deviceKey: Uint8Array, packId: string): SealedImportData | null {
  let raw: Buffer;
  try {
    raw = readFileSync(sealedFilePath(importsDir, packId));
  } catch {
    return null;
  }
  const [nonce, ciphertext] = readSealedFrame(raw, 2);
  let plaintext: Buffer;
  try {
    plaintext = aeadDecrypt({
      key: deviceKey,
      nonce,
      ciphertext,
      aad: Buffer.from(`${SEALED_AAD_PREFIX}${packId}`, "utf8")
    });
  } catch (error) {
    if (error instanceof AeadAuthenticationError || error instanceof RangeError) {
      throw new SealedReadError(`sealed blob for ${packId} does not decrypt under this device key`);
    }
    throw error;
  }
  try {
    return sealedImportSchema.parse(JSON.parse(plaintext.toString("utf8")));
  } catch {
    throw new SealedReadError(`sealed blob for ${packId} decrypted to an invalid record`);
  }
}

export function listSealedPackIds(importsDir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(importsDir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.endsWith(SEALED_FILE_EXT))
    .map((name) => name.slice(0, -SEALED_FILE_EXT.length))
    .sort();
}

export function deleteSealed(importsDir: string, packId: string): boolean {
  const filePath = sealedFilePath(importsDir, packId);
  if (!existsSync(filePath)) return false;
  unlinkSync(filePath);
  return true;
}

/**
 * Renewal replace guard (§8.2): install `data` only when it is strictly newer than the
 * installed blob for the same packId. An unreadable existing blob is replaceable —
 * overwriting corruption with a verified renewal is the self-heal path.
 */
export function replaceIfNewer(
  importsDir: string,
  deviceKey: Uint8Array,
  data: SealedImportData
): { replaced: boolean; existingRevision?: number } {
  let existing: SealedImportData | null = null;
  try {
    existing = readSealed(importsDir, deviceKey, data.echo.packId);
  } catch {
    existing = null;
  }
  if (existing && data.echo.revision <= existing.echo.revision) {
    return { replaced: false, existingRevision: existing.echo.revision };
  }
  writeSealed(importsDir, deviceKey, data);
  return { replaced: true };
}

// —— Unseal (the every-session validity gate, §8.1) ———————————————————————————

export type UnsealResult = {
  /** Blobs whose validity window passed the clock gate — merged into the read model. */
  active: SealedImportData[];
  /** Every installed blob, including expired/rolled-back/unreadable ones, for the manager list. */
  meta: SealedPackMeta[];
};

export function unsealAllValid(
  importsDir: string,
  deviceKey: Uint8Array,
  identityDir: string,
  options: { now?: number } = {}
): UnsealResult {
  const active: SealedImportData[] = [];
  const meta: SealedPackMeta[] = [];

  for (const packId of listSealedPackIds(importsDir)) {
    let data: SealedImportData | null;
    try {
      data = readSealed(importsDir, deviceKey, packId);
    } catch {
      meta.push({ packId, status: "unreadable" });
      continue;
    }
    if (!data) continue; // deleted between listing and reading

    // Every unseal is a clock observation + gate: an expired (or rolled-back-clock)
    // pack stays INSTALLED but is excluded from the read model — render-gated expiry.
    const check = checkValidity(identityDir, deviceKey, data.echo.validity, { now: options.now });
    const status: SealedPackStatus = check.ok ? "active" : check.reason;
    meta.push({
      packId,
      status,
      echo: data.echo,
      importedAt: data.importedAt,
      counts: { anchors: data.anchors.length, notes: data.notes.length }
    });
    if (check.ok) active.push(data);
  }

  return { active, meta };
}

/** Decrypt-and-summarize every installed blob (cheap at note-pack sizes, §11). */
export function listSealedMeta(
  importsDir: string,
  deviceKey: Uint8Array,
  identityDir: string,
  options: { now?: number } = {}
): SealedPackMeta[] {
  return unsealAllValid(importsDir, deviceKey, identityDir, options).meta;
}

export function parseSealedImport(input: unknown): SealedImportData {
  return sealedImportSchema.parse(input);
}
