// server-only — protected `.svpack` orchestration (design docs/design/studypack-sharing.md).
// Publisher side (§5): export-svpack (buildStudyPack → provenance stamp → per-recipient
// codes → signed+encrypted frame) + the code LEDGER in vault/publishes (encrypted code
// secrets — required for renewals), + renew (same packId, revision+1, rotated CEK,
// pruned wrap list). Recipient side (§6/§7): inspect (no code) → open (code, preview)
// → commit (TOFU pin + re-anchor via the shared realizeImportRecords, written into the
// SEALED store, never the plaintext jsonl stores). The SealedRuntime is the in-memory
// unseal cache that app.ts merges into the read model, flagged `sealed: true`.

import path from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Express } from "express";
import { z } from "zod";
import {
  MalformedCodeError,
  WrongCodeError,
  formatCodeForDisplay,
  mintCode,
  parseCode,
  type ParsedCode
} from "../core/crypto/codes";
import { aeadDecrypt, aeadEncrypt, fromBase64Url, toBase64Url } from "../core/crypto/primitives";
import { embedWatermark } from "../core/crypto/watermark";
import {
  MalformedPackError,
  NotEntitledError,
  PublisherKeyMismatchError,
  SelfCertificationError,
  SignatureVerificationError,
  buildPack,
  inspectPack,
  openPack,
  type SvpackHeader,
  type SvpackHeaderInput
} from "../core/crypto/svpackFrame";
import { checkValidity } from "../core/identity/clock";
import { loadOrCreateDeviceKey } from "../core/identity/deviceKey";
import { PUBLISHER_KEY_FILE, loadOrCreatePublisher, type PublisherIdentity } from "../core/identity/publisher";
import { pinPublisher, pinStatus } from "../core/identity/pins";
import { createEntityId } from "../core/ids";
import { noteSchema, type AnchorRecord, type NoteRecord, type StudyLayerRecord } from "../core/schema";
import { matchSourceByFingerprint } from "../core/study-layer/fingerprint";
import { studyPackSchema } from "../core/study-layer/pack";
import type { StudyVault } from "../core/vault";
import {
  deleteSealed,
  listSealedPackIds,
  readSealed,
  sealedImportsDir,
  unsealAllValid,
  writeSealed,
  parseSealedImport,
  type SealedPackMeta
} from "./sealedImports";
import { buildStudyPack, parseStudyPack, previewImport, realizeImportRecords } from "./studyLayer";

// —— Sealed runtime (the unseal cache behind the read-model merge, §7.1) ————————————

export type SealedSnapshot = {
  /** Manager rows for every installed blob (active + expired + unreadable). */
  meta: SealedPackMeta[];
  /** Records of ACTIVE (validity-passing) packs, pre-flagged for the read model. */
  notes: Array<NoteRecord & { sealed: true }>;
  anchors: Array<AnchorRecord & { sealed: true }>;
  layers: Array<StudyLayerRecord & { sealed: true }>;
  /** Id sets for the mutation guards (sealed content is read-only). */
  noteIds: Set<string>;
  anchorIds: Set<string>;
  layerIds: Set<string>;
  /** Sealed layers that count as "on" for the default visibility filter. */
  enabledLayerIds: Set<string>;
};

export type SealedRuntime = {
  snapshot(): SealedSnapshot;
  /** Re-unseal from disk — call at start and after commit/delete/renew (§8.1). */
  refresh(): void;
};

function emptySnapshot(): SealedSnapshot {
  return {
    meta: [],
    notes: [],
    anchors: [],
    layers: [],
    noteIds: new Set(),
    anchorIds: new Set(),
    layerIds: new Set(),
    enabledLayerIds: new Set()
  };
}

export type SvpackDeps = {
  vault: StudyVault;
  /** Where device/publisher keys, pins, and the clock high-water live. Tests inject a tmp dir. */
  identityDir: string;
  /** Injectable clock for the §8 validity gates (tests fake expiry / rollback). */
  now: () => number;
};

export function createSealedRuntime(deps: SvpackDeps): SealedRuntime {
  let snap = emptySnapshot();

  const refresh = () => {
    const importsDir = sealedImportsDir(deps.vault.paths.rootDir);
    // No sealed blobs ⇒ never touch (or create) the device key: vaults that have never
    // imported a protected pack must not grow an identity dir as a side effect.
    if (listSealedPackIds(importsDir).length === 0) {
      snap = emptySnapshot();
      return;
    }
    try {
      const deviceKey = loadOrCreateDeviceKey(deps.identityDir);
      const { active, meta } = unsealAllValid(importsDir, deviceKey, deps.identityDir, { now: deps.now() });
      const next = emptySnapshot();
      next.meta = meta;
      for (const pack of active) {
        next.layers.push({ ...pack.layer, sealed: true });
        next.layerIds.add(pack.layer.id);
        if (pack.layer.enabled) next.enabledLayerIds.add(pack.layer.id);
        for (const anchor of pack.anchors) {
          next.anchors.push({ ...anchor, sealed: true });
          next.anchorIds.add(anchor.id);
        }
        for (const note of pack.notes) {
          // Forensic watermark (§9) is applied at PROJECTION time — the sealed blob on
          // disk stays clean; every served copy carries THIS recipient's codeId. Only
          // plain-string content carries it in V1 (structured quiz/flashcard objects are
          // left as-is — low-bit-rate, out of scope). Visible text is unchanged.
          const content = typeof note.content === "string" ? embedWatermark(note.content, pack.echo.codeId) : note.content;
          next.notes.push({ ...note, content, sealed: true });
          next.noteIds.add(note.id);
        }
      }
      snap = next;
    } catch (error) {
      // A broken device key must not brick the whole server — the sealed packs just
      // stay dark (listed unreadable) until the key situation is resolved.
      console.warn("[svpack] unseal failed:", error instanceof Error ? error.message : error);
      const next = emptySnapshot();
      next.meta = listSealedPackIds(importsDir).map((packId) => ({ packId, status: "unreadable" as const }));
      snap = next;
    }
  };

  refresh();
  return { snapshot: () => snap, refresh };
}

// —— Publish ledger (vault/publishes/<packId>.json, §5.2) ————————————————————————

export const PUBLISHES_DIR = "publishes";
const LEDGER_SECRETS_AAD_PREFIX = "svpack/v2/ledger-codes/";

const ledgerValiditySchema = z.object({
  notBefore: z.string().nullable(),
  validUntil: z.string().nullable()
});

const publishLedgerSchema = z.object({
  v: z.literal(1),
  packId: z.string().min(1),
  layerId: z.string().min(1),
  title: z.string(),
  revision: z.number().int().min(1),
  validity: ledgerValiditySchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  recipients: z.array(
    z.object({
      codeId: z.string().min(1),
      label: z.string(),
      issuedAt: z.string().min(1),
      revokedAt: z.string().optional()
    })
  ),
  /** base64url(nonce ‖ AES-256-GCM(deviceKey, JSON codeId→full code)) — never plaintext. */
  codeSecretsEnc: z.string().min(1)
});

export type PublishLedger = z.infer<typeof publishLedgerSchema>;

function publishesDirFor(vault: StudyVault): string {
  return path.join(vault.paths.rootDir, PUBLISHES_DIR);
}

function ledgerPath(vault: StudyVault, packId: string): string {
  return path.join(publishesDirFor(vault), `${packId}.json`);
}

function readLedger(vault: StudyVault, packId: string): PublishLedger | null {
  let raw: string;
  try {
    raw = readFileSync(ledgerPath(vault, packId), "utf8");
  } catch {
    return null;
  }
  try {
    return publishLedgerSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeLedger(vault: StudyVault, ledger: PublishLedger): void {
  mkdirSync(publishesDirFor(vault), { recursive: true });
  writeFileSync(ledgerPath(vault, ledger.packId), `${JSON.stringify(publishLedgerSchema.parse(ledger), null, 2)}\n`, "utf8");
}

function encryptCodeSecrets(deviceKey: Uint8Array, packId: string, secrets: Record<string, string>): string {
  const { nonce, ciphertext } = aeadEncrypt({
    key: deviceKey,
    plaintext: Buffer.from(JSON.stringify(secrets), "utf8"),
    aad: Buffer.from(`${LEDGER_SECRETS_AAD_PREFIX}${packId}`, "utf8")
  });
  return toBase64Url(Buffer.concat([nonce, ciphertext]));
}

function decryptCodeSecrets(deviceKey: Uint8Array, packId: string, encoded: string): Record<string, string> {
  const blob = fromBase64Url(encoded);
  const plaintext = aeadDecrypt({
    key: deviceKey,
    nonce: blob.subarray(0, 12),
    ciphertext: blob.subarray(12),
    aad: Buffer.from(`${LEDGER_SECRETS_AAD_PREFIX}${packId}`, "utf8")
  });
  return z.record(z.string(), z.string()).parse(JSON.parse(plaintext.toString("utf8")));
}

// —— Shared helpers ————————————————————————————————————————————————————————————

const isoDateTimeStringSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: "Expected an ISO date-time string" });

const exportSvpackRequestSchema = z.object({
  recipients: z.array(z.object({ label: z.string().min(1) })).min(1),
  validUntil: isoDateTimeStringSchema,
  notBefore: isoDateTimeStringSchema.optional()
});

const renewRequestSchema = z.object({
  validUntil: isoDateTimeStringSchema,
  revokeCodeIds: z.array(z.string().min(1)).default([])
});

const inspectRequestSchema = z.object({ fileB64: z.string().min(1) });
const openRequestSchema = inspectRequestSchema.extend({ code: z.string().min(1) });
const commitRequestSchema = openRequestSchema.extend({ rememberCode: z.boolean().default(false) });

/** Map the crypto leaf's typed failures onto HTTP; null ⇒ not an svpack error. */
function svpackHttpError(error: unknown): { status: number; body: { error: string; code: string } } | null {
  if (error instanceof MalformedCodeError) return { status: 400, body: { error: error.message, code: "malformed-code" } };
  if (error instanceof MalformedPackError) return { status: 400, body: { error: error.message, code: "malformed-pack" } };
  if (error instanceof SignatureVerificationError) {
    return { status: 400, body: { error: error.message, code: "signature-invalid" } };
  }
  if (error instanceof SelfCertificationError) {
    return { status: 400, body: { error: error.message, code: "self-certification-failed" } };
  }
  if (error instanceof PublisherKeyMismatchError) {
    return { status: 409, body: { error: error.message, code: "pinned-mismatch" } };
  }
  if (error instanceof NotEntitledError) return { status: 403, body: { error: error.message, code: "not-entitled" } };
  if (error instanceof WrongCodeError) return { status: 403, body: { error: error.message, code: "wrong-code" } };
  return null;
}

/** Cleartext header summary echoed by inspect/open — safe to show before any code. */
function headerEcho(header: SvpackHeader) {
  return {
    packId: header.packId,
    revision: header.revision,
    title: header.title,
    publisher: {
      id: header.publisher.id,
      displayName: header.publisher.displayName,
      signingPubKey: header.publisher.signingPubKey
    },
    createdAt: header.createdAt,
    validity: header.validity,
    sourceHash: header.sourceHash,
    sourceType: header.sourceType,
    contentTypes: header.contentTypes ?? []
  };
}

function safeFileName(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|]/g, "_").trim();
  return cleaned.length > 0 ? cleaned : "layer";
}

/** Mint n codes with pairwise-distinct codeIds (buildPack would reject a collision). */
function mintUniqueCodes(count: number): ParsedCode[] {
  const minted: ParsedCode[] = [];
  const seen = new Set<string>();
  while (minted.length < count) {
    const code = mintCode();
    if (seen.has(code.codeId)) continue;
    seen.add(code.codeId);
    minted.push(code);
  }
  return minted;
}

type ComposedPack = {
  file: Buffer;
  title: string;
  contentTypes: string[];
  publisher: PublisherIdentity;
  refusedCount: number;
};

/**
 * Shared by export and renew: rebuild the payload from the CURRENT layer state
 * (buildStudyPack — the §7.1 refusal and kit privacy prune both run), stamp
 * `provenance` (§3.3), and assemble+sign the frame. buildPack mints a fresh random
 * CEK every call, which is exactly what makes a renewal's recipient-pruning real
 * (§8.2: an old cached CEK is useless against the re-encrypted payload).
 */
async function composeProtectedPack(opts: {
  vault: StudyVault;
  identityDir: string;
  layerId: string;
  packId: string;
  revision: number;
  validity: { notBefore: string | null; validUntil: string | null };
  codes: string[];
}): Promise<ComposedPack | null> {
  const built = await buildStudyPack(opts.vault, opts.layerId);
  if (!built) return null;

  const publisher = loadOrCreatePublisher(opts.identityDir);
  // Re-parse strips the out-of-band refusedCount and stamps packId + provenance so the
  // encrypted payload carries the SAME pack identity as the signed header.
  const payload = studyPackSchema.parse({
    ...built,
    packId: opts.packId,
    provenance: { publisherId: publisher.id, packId: opts.packId, exportable: false }
  });
  const contentTypes = [...new Set(payload.notes.map((note) => note.contentType))].sort();

  const header: SvpackHeaderInput = {
    packId: opts.packId,
    revision: opts.revision,
    publisher: {
      id: publisher.id,
      signingPubKey: publisher.publicKeyB64u,
      displayName: opts.vault.manifest.name || "Growte Publisher"
    },
    createdAt: new Date().toISOString(),
    title: payload.layer.title,
    sourceHash: payload.sourceFingerprint.contentHash ?? "",
    sourceType: payload.sourceFingerprint.sourceType ?? "",
    contentTypes,
    validity: opts.validity
  };

  const { file } = buildPack({
    header,
    payloadJson: payload,
    codes: opts.codes,
    publisherPrivKey: publisher.privateKey
  });
  return { file, title: payload.layer.title, contentTypes, publisher, refusedCount: built.refusedCount };
}

// —— Routes ————————————————————————————————————————————————————————————————————

export function registerSvpackRoutes(app: Express, deps: SvpackDeps & { runtime: SealedRuntime }): void {
  const { vault, identityDir, now, runtime } = deps;

  // Publisher: export a layer as a protected pack + write the code ledger (§5.2).
  // Codes are returned ONCE here (the roster); the ledger keeps them only encrypted.
  app.post("/api/layers/:layerId/export-svpack", async (req, res, next) => {
    try {
      const input = exportSvpackRequestSchema.parse(req.body);
      const layerId = req.params.layerId;
      if (runtime.snapshot().layerIds.has(layerId)) {
        res.status(403).json({ error: "sealed content is read-only" });
        return;
      }

      const packId = createEntityId("pack");
      const minted = mintUniqueCodes(input.recipients.length);
      const composed = await composeProtectedPack({
        vault,
        identityDir,
        layerId,
        packId,
        revision: 1,
        validity: { notBefore: input.notBefore ?? null, validUntil: input.validUntil },
        codes: minted.map((code) => code.code)
      });
      if (!composed) {
        res.status(404).json({ error: "Layer not found" });
        return;
      }

      const nowIso = new Date().toISOString();
      const deviceKey = loadOrCreateDeviceKey(identityDir);
      writeLedger(vault, {
        v: 1,
        packId,
        layerId,
        title: composed.title,
        revision: 1,
        validity: { notBefore: input.notBefore ?? null, validUntil: input.validUntil },
        createdAt: nowIso,
        updatedAt: nowIso,
        recipients: input.recipients.map((recipient, index) => ({
          codeId: minted[index].codeId,
          label: recipient.label,
          issuedAt: nowIso
        })),
        codeSecretsEnc: encryptCodeSecrets(
          deviceKey,
          packId,
          Object.fromEntries(minted.map((code) => [code.codeId, code.code]))
        )
      });

      res.json({
        packId,
        revision: 1,
        fileB64: composed.file.toString("base64"),
        fileName: `${safeFileName(composed.title)}.svpack`,
        roster: input.recipients.map((recipient, index) => ({
          label: recipient.label,
          code: formatCodeForDisplay(minted[index].code),
          codeId: minted[index].codeId
        })),
        refusedCount: composed.refusedCount
      });
    } catch (error) {
      next(error);
    }
  });

  // Publisher: renewal pack (§8.2) — same packId, revision+1, fresh CEK, wrap list
  // pruned to the still-entitled codes (same code STRINGS — recipients keep theirs,
  // so codes are never re-shown here, only the still-active labels).
  app.post("/api/packs/:packId/renew", async (req, res, next) => {
    try {
      const input = renewRequestSchema.parse(req.body);
      const ledger = readLedger(vault, req.params.packId);
      if (!ledger) {
        res.status(404).json({ error: "Publish ledger not found" });
        return;
      }

      const deviceKey = loadOrCreateDeviceKey(identityDir);
      const secrets = decryptCodeSecrets(deviceKey, ledger.packId, ledger.codeSecretsEnc);
      const nowIso = new Date().toISOString();
      const revokeIds = new Set(input.revokeCodeIds);
      const recipients = ledger.recipients.map((recipient) =>
        revokeIds.has(recipient.codeId) && !recipient.revokedAt ? { ...recipient, revokedAt: nowIso } : recipient
      );
      const active = recipients.filter((recipient) => !recipient.revokedAt);
      const activeCodes = active
        .map((recipient) => secrets[recipient.codeId])
        .filter((code): code is string => typeof code === "string");

      const revision = ledger.revision + 1;
      const validity = { notBefore: null, validUntil: input.validUntil };
      const composed = await composeProtectedPack({
        vault,
        identityDir,
        layerId: ledger.layerId,
        packId: ledger.packId,
        revision,
        validity,
        codes: activeCodes
      });
      if (!composed) {
        res.status(409).json({ error: "the published layer no longer exists" });
        return;
      }

      writeLedger(vault, { ...ledger, revision, validity, title: composed.title, updatedAt: nowIso, recipients });
      runtime.refresh();

      res.json({
        packId: ledger.packId,
        revision,
        fileB64: composed.file.toString("base64"),
        fileName: `${safeFileName(composed.title)}.svpack`,
        roster: active.map((recipient) => ({ label: recipient.label, codeId: recipient.codeId })),
        refusedCount: composed.refusedCount
      });
    } catch (error) {
      next(error);
    }
  });

  // Recipient step 1 (§6.1): code-free inspection — frame + signature + self-cert,
  // pin status, local source match by content hash, cleartext header echo. NO decryption.
  app.post("/api/svpack/inspect", async (req, res, next) => {
    try {
      const input = inspectRequestSchema.parse(req.body);
      const header = inspectPack(Buffer.from(input.fileB64, "base64"));
      const pin = pinStatus(identityDir, header.publisher.id, header.publisher.signingPubKey);
      const sources = await vault.stores.sources.list();
      const match = header.sourceHash ? matchSourceByFingerprint(sources, { contentHash: header.sourceHash }) : null;
      res.json({
        header: headerEcho(header),
        pinStatus: pin,
        sourceMatch: match ? { sourceId: match.source.id, title: match.source.title } : null
      });
    } catch (error) {
      const mapped = svpackHttpError(error);
      if (mapped) {
        res.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  });

  // Recipient step 2 (§6.1): validity gate FIRST (§8.1 — expired packs never even
  // decrypt), then open with the code and preview the re-anchor outcome. No persistence.
  app.post("/api/svpack/open", async (req, res, next) => {
    try {
      const input = openRequestSchema.parse(req.body);
      const file = Buffer.from(input.fileB64, "base64");
      const header = inspectPack(file);

      const deviceKey = loadOrCreateDeviceKey(identityDir);
      const check = checkValidity(identityDir, deviceKey, header.validity, { now: now() });
      if (!check.ok) {
        res.status(403).json({ error: `pack is not currently valid (${check.reason})`, code: check.reason });
        return;
      }

      const opened = openPack({ file, code: input.code });
      const pack = parseStudyPack(opened.payloadJson);
      const preview = await previewImport(vault, pack);
      res.json({ header: headerEcho(header), codeId: opened.codeId, preview });
    } catch (error) {
      const mapped = svpackHttpError(error);
      if (mapped) {
        res.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  });

  // Recipient step 3 (§6.1/§7): TOFU-gated commit into the SEALED store. The umbrella
  // "导入图层" parent (inside realizeImportRecords) is the one plaintext record; the
  // imported layer/anchors/notes only ever exist in vault/imports/<packId>.svsealed.
  app.post("/api/svpack/commit", async (req, res, next) => {
    try {
      const input = commitRequestSchema.parse(req.body);
      const file = Buffer.from(input.fileB64, "base64");
      const header = inspectPack(file);

      const deviceKey = loadOrCreateDeviceKey(identityDir);
      const check = checkValidity(identityDir, deviceKey, header.validity, { now: now() });
      if (!check.ok) {
        res.status(403).json({ error: `pack is not currently valid (${check.reason})`, code: check.reason });
        return;
      }

      // TOFU (§5.1): a pack claiming an already-pinned publisher id MUST carry the
      // pinned key — mismatch is the hard "NOT the same publisher" failure, no import.
      const pin = pinStatus(identityDir, header.publisher.id, header.publisher.signingPubKey);
      if (pin === "pinned-mismatch") {
        res.status(409).json({
          error: "publisher key does not match the key pinned for this publisher id",
          code: "pinned-mismatch"
        });
        return;
      }

      // Renewal guard (§8.2): only a strictly newer revision of an installed pack may
      // replace it, and only when signed by the SAME publisher key as the installed one.
      const importsDir = sealedImportsDir(vault.paths.rootDir);
      let existing = null;
      try {
        existing = readSealed(importsDir, deviceKey, header.packId);
      } catch {
        existing = null; // unreadable blob — a verified commit may overwrite it
      }
      if (existing) {
        if (existing.echo.publisher.publicKeyB64u !== header.publisher.signingPubKey) {
          res.status(409).json({
            error: "pack is not signed by the same publisher key as the installed revision",
            code: "publisher-key-changed"
          });
          return;
        }
        if (header.revision <= existing.echo.revision) {
          res.status(409).json({
            error: `revision ${header.revision} is not newer than the installed revision ${existing.echo.revision}`,
            code: "stale-revision"
          });
          return;
        }
      }

      const opened = openPack({ file, code: input.code });
      const pack = parseStudyPack(opened.payloadJson);

      if (pin === "unknown") {
        pinPublisher(identityDir, {
          id: header.publisher.id,
          publicKeyB64u: header.publisher.signingPubKey,
          displayName: header.publisher.displayName
        });
      }

      const realized = await realizeImportRecords(vault, pack);
      // Stamp the sealed provenance onto every note: publisher + pack + the §7.1
      // refusal flag the export choke point keys on.
      const notes = realized.notes.map((note) =>
        noteSchema.parse({
          ...note,
          origin: {
            copiedFrom: pack.packId,
            packId: header.packId,
            publisherId: header.publisher.id,
            exportable: false
          }
        })
      );

      writeSealed(
        importsDir,
        deviceKey,
        parseSealedImport({
          v: 1,
          echo: {
            packId: header.packId,
            revision: header.revision,
            publisher: {
              id: header.publisher.id,
              displayName: header.publisher.displayName,
              publicKeyB64u: header.publisher.signingPubKey
            },
            validity: header.validity,
            title: header.title,
            sourceHash: header.sourceHash,
            sourceType: header.sourceType,
            codeId: opened.codeId,
            contentTypes: header.contentTypes ?? []
          },
          layer: realized.layer,
          anchors: realized.anchors,
          notes,
          importedAt: new Date().toISOString(),
          rememberedCode: input.rememberCode ? parseCode(input.code).code : undefined
        })
      );
      runtime.refresh();

      res.status(201).json({
        packId: header.packId,
        layerId: realized.layer.id,
        counts: { anchors: realized.createdAnchors, notes: realized.importedNotes, stats: realized.stats },
        sealed: true
      });
    } catch (error) {
      const mapped = svpackHttpError(error);
      if (mapped) {
        res.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  });

  // The LOCAL Tier-A identity readout (SHELL-1 user menu): whether this device has
  // a publisher keypair in ~/.growte/identity and, if so, its self-certifying id +
  // the display name packs would carry (the same vault.manifest.name expression
  // composeProtectedPack stamps into headers). STRICTLY read-only: a device that
  // never published must NOT grow an identity as a side effect of opening the menu,
  // so a missing key file answers { identity: null } without loadOrCreate.
  app.get("/api/svpack/identity", (_req, res, next) => {
    try {
      if (!existsSync(path.join(identityDir, PUBLISHER_KEY_FILE))) {
        res.json({ identity: null });
        return;
      }
      const publisher = loadOrCreatePublisher(identityDir); // key exists ⇒ pure load
      res.json({
        identity: { id: publisher.id, displayName: vault.manifest.name || "Growte Publisher" }
      });
    } catch (error) {
      next(error);
    }
  });

  // Manager list: refresh first so validity statuses are current-as-of-now (§8.1 —
  // an expired pack drops out of the read model the next time anyone looks).
  app.get("/api/svpack", (_req, res, next) => {
    try {
      runtime.refresh();
      res.json({ packs: runtime.snapshot().meta });
    } catch (error) {
      next(error);
    }
  });

  // Deleting the imported pack = deleting the blob (§7.1).
  app.delete("/api/svpack/:packId", (req, res, next) => {
    try {
      const removed = deleteSealed(sealedImportsDir(vault.paths.rootDir), req.params.packId);
      if (!removed) {
        res.status(404).json({ error: "Sealed pack not found" });
        return;
      }
      runtime.refresh();
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
}
