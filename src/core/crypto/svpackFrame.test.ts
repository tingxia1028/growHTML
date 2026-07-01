import { describe, expect, it } from "vitest";
import { createEntityId, isEntityId } from "../ids";
import { MalformedCodeError, WrongCodeError, formatCodeForDisplay, mintCode, wrapCek } from "./codes";
import { generateSigningKeyPair, publisherIdFromPublicKey, randomBytes, signBytes, toBase64Url } from "./primitives";
import {
  type SvpackHeader,
  type SvpackHeaderInput,
  DuplicateCodeIdError,
  MalformedPackError,
  NotEntitledError,
  PublisherKeyMismatchError,
  SelfCertificationError,
  SignatureVerificationError,
  buildPack,
  inspectPack,
  openPack,
  readFrame,
  writeFrame
} from "./svpackFrame";

function makePublisher() {
  const keys = generateSigningKeyPair();
  return {
    keys,
    id: publisherIdFromPublicKey(keys.publicKey),
    signingPubKey: toBase64Url(keys.publicKey)
  };
}

function makeFixture(codeCount = 2) {
  const publisher = makePublisher();
  const codes = Array.from({ length: codeCount }, () => mintCode());
  const packId = createEntityId("pack");
  const payloadJson = {
    packId,
    layer: { title: "力学错题层" },
    notes: [{ contentType: "markdown", content: "第 3 题:受力分析 ✍️" }],
    anchors: []
  };
  const header: SvpackHeaderInput = {
    packId,
    revision: 1,
    publisher: { id: publisher.id, signingPubKey: publisher.signingPubKey, displayName: "王老师 · 高一物理" },
    createdAt: "2026-07-01T12:00:00Z",
    title: "TAMPER-TARGET-TITLE",
    sourceHash: "sha256:553f7afe553f7afe",
    sourceType: "html",
    validity: { notBefore: null, validUntil: "2026-09-01T00:00:00Z" }
  };
  const built = buildPack({ header, payloadJson, codes: codes.map((c) => c.code), publisherPrivKey: publisher.keys.privateKey });
  return { publisher, codes, packId, payloadJson, header, ...built };
}

/** Section offsets recomputed from the raw frame, for byte-surgery in tamper tests. */
function sectionOffsets(file: Buffer) {
  const headerStart = 6 + 4;
  const headerLen = file.readUInt32LE(6);
  const payloadStart = headerStart + headerLen + 4;
  const payloadLen = file.readUInt32LE(headerStart + headerLen);
  const signatureStart = payloadStart + payloadLen + 4;
  return { headerStart, headerLen, payloadStart, payloadLen, signatureStart };
}

/** Swap one byte at a marker (stays valid JSON/UTF-8 inside header string values). */
function swapByteAtMarker(file: Buffer, marker: string, extraOffset: number): Buffer {
  const index = file.indexOf(Buffer.from(marker, "utf8"));
  expect(index).toBeGreaterThan(-1);
  const copy = Buffer.from(file);
  const target = index + extraOffset;
  copy[target] = copy[target] === 0x41 ? 0x42 : 0x41; // 'A' ↔ 'B'
  return copy;
}

function xorByteAt(file: Buffer, offset: number): Buffer {
  const copy = Buffer.from(file);
  copy[offset] ^= 0xff;
  return copy;
}

/** Re-frame a pack after editing its header JSON, optionally re-signing. */
function reframe(file: Buffer, editHeader: (header: SvpackHeader) => void, resignWith?: Buffer): Buffer {
  const { headerBytes, payload, signature } = readFrame(file);
  const header = JSON.parse(headerBytes.toString("utf8")) as SvpackHeader;
  editHeader(header);
  const newHeaderBytes = Buffer.from(JSON.stringify(header), "utf8");
  const newSignature = resignWith ? signBytes(resignWith, Buffer.concat([newHeaderBytes, payload])) : Buffer.from(signature);
  return writeFrame({ headerBytes: newHeaderBytes, payload, signature: newSignature });
}

describe("frame io", () => {
  it("roundtrips the three sections byte-exactly", () => {
    const sections = { headerBytes: randomBytes(100), payload: randomBytes(333), signature: randomBytes(64) };
    const file = writeFrame(sections);
    const read = readFrame(file);

    expect(file.subarray(0, 6).toString("utf8")).toBe("SVPK2\n");
    expect(read.headerBytes.equals(sections.headerBytes)).toBe(true);
    expect(read.payload.equals(sections.payload)).toBe(true);
    expect(read.signature.equals(sections.signature)).toBe(true);
  });

  it("supports empty sections without losing length accounting", () => {
    const file = writeFrame({ headerBytes: Buffer.alloc(0), payload: Buffer.alloc(0), signature: Buffer.alloc(0) });
    const read = readFrame(file);

    expect(file).toHaveLength(6 + 12);
    expect(read.headerBytes).toHaveLength(0);
  });

  it("rejects wrong magic, plaintext JSON, truncation, trailing bytes, and inflated lengths", () => {
    const { file } = makeFixture(1);

    expect(() => readFrame(Buffer.from("SVPK1\n rest", "utf8"))).toThrow(MalformedPackError);
    expect(() => readFrame(Buffer.from('{"packId":"pack_x"}', "utf8"))).toThrow(MalformedPackError); // legacy .studypack path
    expect(() => readFrame(Buffer.alloc(0))).toThrow(MalformedPackError);
    expect(() => readFrame(file.subarray(0, 8))).toThrow(MalformedPackError); // cut inside the length prefix
    expect(() => readFrame(file.subarray(0, file.length - 3))).toThrow(MalformedPackError);
    expect(() => readFrame(Buffer.concat([file, Buffer.from([0])]))).toThrow(MalformedPackError);

    const inflated = Buffer.from(file);
    inflated.writeUInt32LE(inflated.readUInt32LE(6) + 5, 6); // header claims 5 bytes it does not have
    expect(() => readFrame(inflated)).toThrow(MalformedPackError);
  });
});

describe("buildPack → openPack", () => {
  it("lets every recipient open the pack and read the same payload", () => {
    const { file, codes, payloadJson, packId, publisher } = makeFixture(3);

    expect(isEntityId("pack", packId)).toBe(true); // new "pack" id kind

    for (const minted of codes) {
      const opened = openPack({ file, code: minted.code });
      expect(opened.payloadJson).toEqual(payloadJson); // unicode survives encrypt/decrypt
      expect(opened.codeId).toBe(minted.codeId);
      expect(opened.header.packId).toBe(packId);
      expect(opened.header.publisher.id).toBe(publisher.id);
      expect(opened.header.wraps).toHaveLength(3);
    }
  });

  it("accepts the dashed display form of a code", () => {
    const { file, codes, payloadJson } = makeFixture(1);
    const opened = openPack({ file, code: formatCodeForDisplay(codes[0].code) });

    expect(opened.payloadJson).toEqual(payloadJson);
  });

  it("returns the same wraps it embedded in the signed header", () => {
    const { file, wraps } = makeFixture(2);

    expect(inspectPack(file).wraps).toEqual(wraps);
  });

  it("throws WrongCodeError when the codeId matches but the secret part is wrong", () => {
    const { file, codes } = makeFixture(2);
    const code = codes[0].code;
    const wrongSecret = `${code.slice(0, 20)}${code[20] === "A" ? "B" : "A"}${code.slice(21)}`;

    expect(() => openPack({ file, code: wrongSecret })).toThrow(WrongCodeError);
  });

  it("throws NotEntitledError for a code with no wrap entry", () => {
    const { file } = makeFixture(2);

    expect(() => openPack({ file, code: mintCode().code })).toThrow(NotEntitledError);
  });

  it("propagates MalformedCodeError for unparseable codes", () => {
    const { file } = makeFixture(1);

    expect(() => openPack({ file, code: "too-short" })).toThrow(MalformedCodeError);
  });

  it("rejects duplicate codeIds at build time (same code twice, or a crafted prefix collision)", () => {
    const { publisher, header } = makeFixture(1);
    const code = mintCode().code;
    const prefixCollision = code.slice(0, 8) + mintCode().code.slice(8); // same codeId, different secret

    for (const codes of [
      [code, code],
      [code, prefixCollision]
    ]) {
      expect(() =>
        buildPack({ header, payloadJson: {}, codes, publisherPrivKey: publisher.keys.privateKey })
      ).toThrow(DuplicateCodeIdError);
    }
  });

  it("allows an empty wrap list (a renewal that revokes everyone = tombstone)", () => {
    const { publisher, header } = makeFixture(1);
    const { file, wraps } = buildPack({ header, payloadJson: {}, codes: [], publisherPrivKey: publisher.keys.privateKey });

    expect(wraps).toHaveLength(0);
    expect(inspectPack(file).wraps).toHaveLength(0);
    expect(() => openPack({ file, code: mintCode().code })).toThrow(NotEntitledError);
  });

  it("refuses to author a pack whose publisher block does not match the signing key", () => {
    const { header } = makeFixture(1);
    const stranger = generateSigningKeyPair();

    expect(() =>
      buildPack({ header, payloadJson: {}, codes: [], publisherPrivKey: stranger.privateKey })
    ).toThrow(/signingPubKey does not match/);

    const strangerHeader: SvpackHeaderInput = {
      ...header,
      publisher: { ...header.publisher, signingPubKey: toBase64Url(stranger.publicKey) } // id left stale
    };
    expect(() =>
      buildPack({ header: strangerHeader, payloadJson: {}, codes: [], publisherPrivKey: stranger.privateKey })
    ).toThrow(/fingerprint/);
  });
});

describe("tamper matrix — every flipped byte fails closed", () => {
  it("(a) a byte flipped in the header region ⇒ SignatureVerificationError", () => {
    const { file, codes } = makeFixture(2);
    const tampered = swapByteAtMarker(file, "TAMPER-TARGET-TITLE", 3); // inside the title string value

    expect(() => openPack({ file: tampered, code: codes[0].code })).toThrow(SignatureVerificationError);
    expect(() => inspectPack(tampered)).toThrow(SignatureVerificationError);
  });

  it("(b) a byte flipped in the payload region ⇒ SignatureVerificationError", () => {
    const { file, codes } = makeFixture(2);
    const { payloadStart, payloadLen } = sectionOffsets(file);
    const tampered = xorByteAt(file, payloadStart + Math.floor(payloadLen / 2));

    expect(() => openPack({ file: tampered, code: codes[0].code })).toThrow(SignatureVerificationError);
  });

  it("(c) a byte flipped inside a wrap entry ⇒ SignatureVerificationError", () => {
    const { file, codes } = makeFixture(2);
    const marker = '"wrappedCek":"';
    const tampered = swapByteAtMarker(file, marker, marker.length); // first char of the wrapped CEK value

    expect(() => openPack({ file: tampered, code: codes[0].code })).toThrow(SignatureVerificationError);
    expect(() => openPack({ file: tampered, code: codes[1].code })).toThrow(SignatureVerificationError);
  });

  it("(d) a byte flipped in the signature ⇒ SignatureVerificationError", () => {
    const { file, codes } = makeFixture(2);
    const { signatureStart } = sectionOffsets(file);
    const tampered = xorByteAt(file, signatureStart + 10);

    expect(() => openPack({ file: tampered, code: codes[0].code })).toThrow(SignatureVerificationError);
  });
});

describe("graft attack — the v1-draft hole, proven closed", () => {
  it("appending a wrap entry to the header without re-signing fails signature verification", () => {
    const { file, codes, packId } = makeFixture(2);
    const attacker = mintCode();
    // The attacker cannot know the real CEK (it never appears in cleartext), so they
    // graft a wrap of *something*; the signature over the exact header bytes fails
    // before content is ever touched — for the attacker AND for legitimate codes.
    const grafted = reframe(file, (header) => {
      header.wraps.push(wrapCek(randomBytes(32), attacker.code, packId));
    });

    expect(() => openPack({ file: grafted, code: attacker.code })).toThrow(SignatureVerificationError);
    expect(() => openPack({ file: grafted, code: codes[0].code })).toThrow(SignatureVerificationError);
    expect(() => inspectPack(grafted)).toThrow(SignatureVerificationError);
  });

  it("pruning a wrap entry (fake revocation) without re-signing also fails", () => {
    const { file, codes } = makeFixture(2);
    const pruned = reframe(file, (header) => {
      header.wraps = header.wraps.filter((wrap) => wrap.codeId !== codes[1].codeId);
    });

    expect(() => openPack({ file: pruned, code: codes[0].code })).toThrow(SignatureVerificationError);
  });
});

describe("spoofing — self-certifying publisher id + pinning", () => {
  it("re-signing with a different keypair while keeping the original publisher id ⇒ SelfCertificationError", () => {
    const { file, codes } = makeFixture(2);
    const attacker = generateSigningKeyPair();
    const spoofed = reframe(
      file,
      (header) => {
        header.publisher.signingPubKey = toBase64Url(attacker.publicKey); // id stays the victim's
      },
      attacker.privateKey
    );

    expect(() => openPack({ file: spoofed, code: codes[0].code })).toThrow(SelfCertificationError);
    expect(() => inspectPack(spoofed)).toThrow(SelfCertificationError);
  });

  it("a fully self-consistent identity swap still cannot serve the original content (AAD binds the header)", () => {
    const { file, codes } = makeFixture(1);
    const attacker = generateSigningKeyPair();
    const swapped = reframe(
      file,
      (header) => {
        header.publisher.signingPubKey = toBase64Url(attacker.publicKey);
        header.publisher.id = publisherIdFromPublicKey(attacker.publicKey); // fingerprint made consistent
      },
      attacker.privateKey
    );

    // Signature and self-certification pass (it is a *valid attacker identity*), the
    // untouched wrap still yields the CEK — but the payload was encrypted with
    // aad = the ORIGINAL header bytes, so GCM refuses. Header tamper "fails twice" (§3.1).
    expect(() => openPack({ file: swapped, code: codes[0].code })).toThrow(MalformedPackError);
  });

  it("openPack with a pinned key rejects packs signed by anyone else", () => {
    const { file, codes, publisher } = makeFixture(1);
    const pinnedOther = toBase64Url(generateSigningKeyPair().publicKey);

    expect(() => openPack({ file, code: codes[0].code, expectedPublisherKey: pinnedOther })).toThrow(
      PublisherKeyMismatchError
    );
    // …and accepts the genuine publisher when the pin matches.
    const opened = openPack({ file, code: codes[0].code, expectedPublisherKey: publisher.signingPubKey });
    expect(opened.header.publisher.id).toBe(publisher.id);
  });
});

describe("inspectPack", () => {
  it("surfaces the header with no code and no decryption", () => {
    const { file, publisher, packId } = makeFixture(2);
    const header = inspectPack(file);

    expect(header.packId).toBe(packId);
    expect(header.publisher.id).toBe(publisher.id);
    expect(header.title).toBe("TAMPER-TARGET-TITLE");
    expect(header.validity).toEqual({ notBefore: null, validUntil: "2026-09-01T00:00:00Z" });
    expect(header.aead.alg).toBe("A256GCM");
    expect(header.keywrap.info).toBe("svpack/v2/cek-wrap");
  });

  it("rejects a structurally valid frame whose header violates the schema", () => {
    const { file } = makeFixture(1);
    const { payload } = readFrame(file);
    const badHeaders = [
      Buffer.from("not json at all", "utf8"),
      Buffer.from(JSON.stringify({ v: 3, packId: "pack_x" }), "utf8"), // wrong version, missing fields
      Buffer.from(JSON.stringify({ hello: "world" }), "utf8")
    ];

    for (const headerBytes of badHeaders) {
      const bad = writeFrame({ headerBytes, payload, signature: Buffer.alloc(64) });
      expect(() => inspectPack(bad)).toThrow(MalformedPackError);
    }
  });
});
