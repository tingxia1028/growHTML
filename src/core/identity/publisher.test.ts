import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fromBase64Url, verifyBytes } from "../crypto/primitives";
import { buildPack, openPack } from "../crypto/svpackFrame";
import { mintCode } from "../crypto/codes";
import { createEntityId } from "../ids";
import {
  MalformedBackupError,
  PUBLISHER_KEY_FILE,
  WrongPassphraseError,
  backupPublisherKey,
  loadOrCreatePublisher,
  publisherIdFromPublicKey,
  restorePublisherKey
} from "./publisher";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "growte-publisher-"));
  tempDirs.push(dir);
  return dir;
}

let tempDir = "";

beforeEach(() => {
  tempDir = makeTempDir();
});

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe("loadOrCreatePublisher", () => {
  it("creates a self-certifying identity: id = fingerprint of the public key", () => {
    const identity = loadOrCreatePublisher(tempDir);

    expect(identity.id).toMatch(/^pubf_[0-9a-hjkmnp-tv-z]{16}$/);
    expect(identity.id).toBe(publisherIdFromPublicKey(fromBase64Url(identity.publicKeyB64u)));
    expect(existsSync(path.join(tempDir, PUBLISHER_KEY_FILE))).toBe(true);
  });

  it("is stable across reloads and produces working signatures", () => {
    const first = loadOrCreatePublisher(tempDir);
    const second = loadOrCreatePublisher(tempDir);
    const bytes = Buffer.from("headerBytes || payload", "utf8");

    expect(second.id).toBe(first.id);
    expect(second.publicKeyB64u).toBe(first.publicKeyB64u);
    expect(verifyBytes(fromBase64Url(first.publicKeyB64u), bytes, first.sign(bytes))).toBe(true);
  });

  it("plugs directly into buildPack/openPack as the pack publisher", () => {
    const identity = loadOrCreatePublisher(tempDir);
    const code = mintCode();
    const { file } = buildPack({
      header: {
        packId: createEntityId("pack"),
        revision: 1,
        publisher: { id: identity.id, signingPubKey: identity.publicKeyB64u, displayName: "王老师" },
        createdAt: "2026-07-01T12:00:00Z",
        title: "力学错题层",
        sourceHash: "sha256:abc",
        sourceType: "html",
        validity: { notBefore: null, validUntil: null }
      },
      payloadJson: { hello: "世界" },
      codes: [code.code],
      publisherPrivKey: identity.privateKey
    });

    const opened = openPack({ file, code: code.code, expectedPublisherKey: identity.publicKeyB64u });
    expect(opened.payloadJson).toEqual({ hello: "世界" });
    expect(opened.header.publisher.id).toBe(identity.id);
  });
});

describe("backup / restore", () => {
  it("roundtrips the identity into a fresh dir through a passphrase-protected blob", () => {
    const original = loadOrCreatePublisher(tempDir);
    const blob = backupPublisherKey("correct horse battery staple", tempDir);

    expect(blob.subarray(0, 6).toString("utf8")).toBe("SVKB1\n");

    const restoreDir = makeTempDir();
    const restored = restorePublisherKey(blob, "correct horse battery staple", restoreDir);

    expect(restored.id).toBe(original.id);
    expect(restored.publicKeyB64u).toBe(original.publicKeyB64u);
    expect(loadOrCreatePublisher(restoreDir).id).toBe(original.id); // persisted, not just returned
  });

  it("rejects a wrong passphrase with a typed error", () => {
    loadOrCreatePublisher(tempDir);
    const blob = backupPublisherKey("right", tempDir);

    expect(() => restorePublisherKey(blob, "wrong", makeTempDir())).toThrow(WrongPassphraseError);
  });

  it("rejects garbage and truncated blobs as malformed", () => {
    loadOrCreatePublisher(tempDir);
    const blob = backupPublisherKey("pass", tempDir);

    expect(() => restorePublisherKey(Buffer.from("not a backup"), "pass", makeTempDir())).toThrow(MalformedBackupError);
    expect(() => restorePublisherKey(blob.subarray(0, blob.length - 1), "pass", makeTempDir())).toThrow(
      MalformedBackupError
    );
  });

  it("restore overwrites an existing identity (the explicit take-over action)", () => {
    const original = loadOrCreatePublisher(tempDir);
    const blob = backupPublisherKey("pass", tempDir);

    const otherDir = makeTempDir();
    const preexisting = loadOrCreatePublisher(otherDir);
    expect(preexisting.id).not.toBe(original.id);

    restorePublisherKey(blob, "pass", otherDir);
    expect(loadOrCreatePublisher(otherDir).id).toBe(original.id);
  });
});
