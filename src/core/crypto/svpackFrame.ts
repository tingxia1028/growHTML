// server-only (node:crypto) — never import from src/client.
// The .svpack v2 container (design §3): a length-prefixed binary frame whose header
// bytes are stored VERBATIM and covered by BOTH the Ed25519 signature and the
// payload's GCM AAD — sign-the-bytes, no canonicalization. The wrap list lives INSIDE
// those signed bytes (decision 5), which is what closes the v1-draft graft hole.
// This layer is deliberately pure of clock and fs: `validity` is NOT checked here —
// that is the caller's job via src/core/identity/clock.ts at import and every unseal.

import { z } from "zod";
import {
  type WrapEntry,
  parseCode,
  unwrapCek,
  wrapCek
} from "./codes";
import {
  AeadAuthenticationError,
  AEAD_KEY_LENGTH,
  AEAD_NONCE_LENGTH,
  SIGNATURE_LENGTH,
  SIGNING_KEY_LENGTH,
  aeadDecrypt,
  aeadEncrypt,
  fromBase64Url,
  publisherIdFromPublicKey,
  randomBytes,
  signBytes,
  signingPublicKeyFromPrivate,
  toBase64Url,
  verifyBytes
} from "./primitives";

export const SVPACK_MAGIC = Buffer.from("SVPK2\n", "utf8");

/** Frame/JSON/length problems — the bytes are not a well-formed .svpack. */
export class MalformedPackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedPackError";
  }
}

/** The Ed25519 signature does not verify over headerBytes ‖ payload. */
export class SignatureVerificationError extends Error {
  constructor(message = "pack signature verification failed") {
    super(message);
    this.name = "SignatureVerificationError";
  }
}

/** header.publisher.id is not the fingerprint of the embedded signing key (spoofed id). */
export class SelfCertificationError extends Error {
  constructor(message = "publisher id does not match the embedded signing key") {
    super(message);
    this.name = "SelfCertificationError";
  }
}

/** The embedded signing key differs from the caller's pinned/expected key (§5.1 TOFU). */
export class PublisherKeyMismatchError extends Error {
  constructor(message = "pack is not signed by the expected (pinned) publisher key") {
    super(message);
    this.name = "PublisherKeyMismatchError";
  }
}

/** The pack carries no wrap entry for this code's codeId (never entitled, or pruned by a renewal). */
export class NotEntitledError extends Error {
  constructor(message = "this code has no wrap entry in the pack") {
    super(message);
    this.name = "NotEntitledError";
  }
}

/** buildPack input contains two codes with the same 8-char codeId (re-mint and retry). */
export class DuplicateCodeIdError extends Error {
  constructor(codeId: string) {
    super(`duplicate codeId in recipient codes: ${codeId}`);
    this.name = "DuplicateCodeIdError";
  }
}

// --- Header schema (§3.2) ------------------------------------------------------------
// looseObject everywhere: future header fields are additive (§3.4), and the crypto
// binds the raw bytes anyway — unknown fields must survive parsing, not be rejected.

const wrapEntrySchema = z.looseObject({
  codeId: z.string().min(1),
  nonce: z.string().min(1),
  wrappedCek: z.string().min(1)
});

export const svpackHeaderSchema = z.looseObject({
  v: z.literal(2),
  packId: z.string().min(1),
  revision: z.number().int().min(1),
  publisher: z.looseObject({
    id: z.string().min(1),
    signingPubKey: z.string().min(1),
    displayName: z.string()
  }),
  createdAt: z.string().min(1),
  title: z.string(),
  sourceHash: z.string(),
  sourceType: z.string(),
  validity: z.looseObject({
    notBefore: z.string().nullable(),
    validUntil: z.string().nullable()
  }),
  aead: z.looseObject({ alg: z.literal("A256GCM"), nonce: z.string().min(1) }),
  keywrap: z.looseObject({ alg: z.literal("HKDF-SHA256+A256GCM"), info: z.literal("svpack/v2/cek-wrap") }),
  wraps: z.array(wrapEntrySchema),
  watermark: z.looseObject({ scheme: z.string(), payload: z.string() })
});

export type SvpackHeader = z.infer<typeof svpackHeaderSchema>;

/** Publisher-authored header fields; buildPack fills v/aead/keywrap/wraps itself. */
export type SvpackHeaderInput = {
  packId: string;
  revision: number;
  publisher: { id: string; signingPubKey: string; displayName: string };
  createdAt: string;
  title: string;
  sourceHash: string;
  sourceType: string;
  validity: { notBefore: string | null; validUntil: string | null };
  watermark?: { scheme: string; payload: string };
};

// --- Frame IO (§3.1) -----------------------------------------------------------------

export type FrameSections = {
  headerBytes: Buffer;
  payload: Buffer;
  signature: Buffer;
};

export function writeFrame(sections: FrameSections): Buffer {
  const { headerBytes, payload, signature } = sections;
  const file = Buffer.alloc(SVPACK_MAGIC.length + 12 + headerBytes.length + payload.length + signature.length);
  let offset = SVPACK_MAGIC.copy(file, 0);
  for (const section of [headerBytes, payload, signature]) {
    file.writeUInt32LE(section.length, offset);
    offset = offset + 4 + section.copy(file, offset + 4);
  }
  return file;
}

function readSection(file: Buffer, offset: number, label: string): { bytes: Buffer; next: number } {
  if (offset + 4 > file.length) throw new MalformedPackError(`truncated ${label} length prefix`);
  const length = file.readUInt32LE(offset);
  const start = offset + 4;
  if (start + length > file.length) {
    throw new MalformedPackError(`truncated ${label} section (declares ${length} bytes)`);
  }
  return { bytes: file.subarray(start, start + length), next: start + length };
}

/**
 * Strict frame parse: magic, three length-prefixed sections, and EXACT length
 * accounting (trailing bytes are rejected). Returns views into `file`, not copies.
 */
export function readFrame(file: Buffer): FrameSections {
  if (file.length < SVPACK_MAGIC.length || !file.subarray(0, SVPACK_MAGIC.length).equals(SVPACK_MAGIC)) {
    throw new MalformedPackError("not a .svpack file (bad magic)");
  }
  const header = readSection(file, SVPACK_MAGIC.length, "header");
  const payload = readSection(file, header.next, "payload");
  const signature = readSection(file, payload.next, "signature");
  if (signature.next !== file.length) {
    throw new MalformedPackError(`unexpected ${file.length - signature.next} trailing bytes`);
  }
  return { headerBytes: header.bytes, payload: payload.bytes, signature: signature.bytes };
}

// --- Verification core ----------------------------------------------------------------

function parseHeader(headerBytes: Buffer): SvpackHeader {
  let json: unknown;
  try {
    json = JSON.parse(headerBytes.toString("utf8"));
  } catch {
    throw new MalformedPackError("header is not valid JSON");
  }
  const parsed = svpackHeaderSchema.safeParse(json);
  if (!parsed.success) throw new MalformedPackError(`invalid header: ${parsed.error.message}`);
  return parsed.data;
}

/**
 * Shared verify pipeline (§3.1 order): parse header → signature FIRST (against the
 * expected/pinned key when given, else the embedded key) → self-certification
 * (publisher.id must be the fingerprint of the embedded key). Fail closed, typed.
 */
function verifySignedFrame(frame: FrameSections, expectedPublisherKey?: string): SvpackHeader {
  const header = parseHeader(frame.headerBytes);

  // An expected (pinned) key that differs from the embedded key can never verify —
  // surface that as the dedicated mismatch error before touching the signature.
  if (expectedPublisherKey !== undefined && header.publisher.signingPubKey !== expectedPublisherKey) {
    throw new PublisherKeyMismatchError();
  }

  let publisherKey: Buffer;
  try {
    publisherKey = fromBase64Url(expectedPublisherKey ?? header.publisher.signingPubKey);
  } catch {
    throw new MalformedPackError("publisher signing key is not valid base64url");
  }
  if (publisherKey.length !== SIGNING_KEY_LENGTH) {
    throw new MalformedPackError("publisher signing key must be 32 bytes");
  }
  if (frame.signature.length !== SIGNATURE_LENGTH) {
    throw new SignatureVerificationError("signature must be 64 bytes");
  }

  const signedBytes = Buffer.concat([frame.headerBytes, frame.payload]);
  if (!verifyBytes(publisherKey, signedBytes, frame.signature)) {
    throw new SignatureVerificationError();
  }

  if (publisherIdFromPublicKey(publisherKey) !== header.publisher.id) {
    throw new SelfCertificationError();
  }
  return header;
}

// --- Build / open / inspect -----------------------------------------------------------

export type BuildPackParams = {
  header: SvpackHeaderInput;
  /** The plaintext payload value (today's studyPack JSON); serialized with JSON.stringify. */
  payloadJson: unknown;
  /** One recipient code per entry; display or canonical form. Duplicate codeIds throw. */
  codes: string[];
  /** Raw 32-byte Ed25519 private key matching header.publisher.signingPubKey. */
  publisherPrivKey: Uint8Array;
};

export type BuiltPack = { file: Buffer; wraps: WrapEntry[] };

/**
 * Assemble, encrypt, and sign a pack. Ordering is load-bearing (§3): wraps and the
 * payload nonce go INTO the header, the header is serialized exactly once, that byte
 * string is the GCM AAD, and the signature covers headerBytes ‖ ciphertext.
 * An empty `codes` list is allowed: it yields a pack nobody can open (a renewal that
 * revokes everyone — a tombstone).
 */
export function buildPack(params: BuildPackParams): BuiltPack {
  const { header, payloadJson, codes, publisherPrivKey } = params;

  // Authoring sanity: a header whose publisher block does not match the signing key
  // would produce a pack that fails its own verification on open.
  const publicKey = signingPublicKeyFromPrivate(publisherPrivKey);
  if (toBase64Url(publicKey) !== header.publisher.signingPubKey) {
    throw new Error("header.publisher.signingPubKey does not match publisherPrivKey");
  }
  if (publisherIdFromPublicKey(publicKey) !== header.publisher.id) {
    throw new Error("header.publisher.id is not the fingerprint of the signing key");
  }

  const parsedCodes = codes.map((code) => parseCode(code));
  const seenCodeIds = new Set<string>();
  for (const { codeId } of parsedCodes) {
    if (seenCodeIds.has(codeId)) throw new DuplicateCodeIdError(codeId);
    seenCodeIds.add(codeId);
  }

  const cek = randomBytes(AEAD_KEY_LENGTH);
  const payloadNonce = randomBytes(AEAD_NONCE_LENGTH);
  const wraps = parsedCodes.map(({ code }) => wrapCek(cek, code, header.packId));

  const fullHeader: SvpackHeader = {
    v: 2,
    packId: header.packId,
    revision: header.revision,
    publisher: header.publisher,
    createdAt: header.createdAt,
    title: header.title,
    sourceHash: header.sourceHash,
    sourceType: header.sourceType,
    validity: header.validity,
    aead: { alg: "A256GCM", nonce: toBase64Url(payloadNonce) },
    keywrap: { alg: "HKDF-SHA256+A256GCM", info: "svpack/v2/cek-wrap" },
    wraps,
    watermark: header.watermark ?? { scheme: "svwm/1", payload: "codeId" }
  };

  // Serialized ONCE — these exact bytes are canonical from here on.
  const headerBytes = Buffer.from(JSON.stringify(fullHeader), "utf8");
  const { ciphertext } = aeadEncrypt({
    key: cek,
    nonce: payloadNonce,
    plaintext: Buffer.from(JSON.stringify(payloadJson), "utf8"),
    aad: headerBytes
  });
  const signature = signBytes(publisherPrivKey, Buffer.concat([headerBytes, ciphertext]));

  return { file: writeFrame({ headerBytes, payload: ciphertext, signature }), wraps };
}

export type OpenPackParams = {
  file: Buffer;
  code: string;
  /** The pinned publisher key (base64url raw 32B). When set, the pack MUST be signed by it. */
  expectedPublisherKey?: string;
};

export type OpenedPack = {
  header: SvpackHeader;
  payloadJson: unknown;
  /** The opener's codeId — the ledger/watermark handle for this recipient. */
  codeId: string;
};

/**
 * Full open (§3.1 verify order): magic/frame → header parse → signature → publisher
 * self-certification → locate wrap by codeId (absent ⇒ NotEntitledError) → unwrap CEK
 * (bad secret ⇒ WrongCodeError) → GCM-decrypt with aad = headerBytes → JSON.parse.
 * Validity is NOT checked here — callers gate on identity/clock.checkValidity.
 */
export function openPack(params: OpenPackParams): OpenedPack {
  const frame = readFrame(params.file);
  const header = verifySignedFrame(frame, params.expectedPublisherKey);

  const { code, codeId } = parseCode(params.code);
  const wrap = header.wraps.find((entry) => entry.codeId === codeId);
  if (!wrap) throw new NotEntitledError();
  const cek = unwrapCek(wrap, code, header.packId);

  let payloadNonce: Buffer;
  try {
    payloadNonce = fromBase64Url(header.aead.nonce);
  } catch {
    throw new MalformedPackError("payload nonce is not valid base64url");
  }
  if (payloadNonce.length !== AEAD_NONCE_LENGTH) {
    throw new MalformedPackError("payload nonce must be 12 bytes");
  }

  let plaintext: Buffer;
  try {
    plaintext = aeadDecrypt({ key: cek, nonce: payloadNonce, ciphertext: frame.payload, aad: frame.headerBytes });
  } catch (error) {
    // The signature already authenticated header+payload, so this means the pack was
    // authored inconsistently (CEK/nonce mismatch) — a malformed pack, not a bad code.
    if (error instanceof AeadAuthenticationError) {
      throw new MalformedPackError("payload does not decrypt under the unwrapped CEK");
    }
    throw error;
  }

  let payloadJson: unknown;
  try {
    payloadJson = JSON.parse(plaintext.toString("utf8"));
  } catch {
    throw new MalformedPackError("payload is not valid JSON");
  }

  return { header, payloadJson, codeId };
}

/**
 * Code-free inspection for the import UI's first step (§6.1): frame + header parse +
 * signature + self-certification. No code, no decryption, no validity/pin decisions —
 * the caller renders pin status and validity from the returned header.
 */
export function inspectPack(file: Buffer): SvpackHeader {
  return verifySignedFrame(readFrame(file));
}
