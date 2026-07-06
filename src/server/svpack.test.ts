import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { type StudyVault } from "../core/vault";
import { openTestVault } from "../core/testing/openTestVault";
import { extractWatermark, stripWatermark } from "../core/crypto/watermark";
import { createApp } from "./app";

// Batch B: the offline .svpack server — export/ledger, sealed import store, and the
// inspect/open/commit/renew endpoints. Publisher and recipient are SEPARATE createApp
// instances (own vault + own injected identityDir), and the pack file (base64) is the
// only thing that crosses between them — exactly the real offline flow. `now` is
// injected so validity/expiry are deterministic.

type App = ReturnType<typeof createApp>;
type Ctx = { app: App; vault: StudyVault; clock: { ms: number } };

const madeDirs: string[] = [];
const madeVaults: StudyVault[] = [];
async function tmp(tag: string): Promise<string> {
  const d = await mkdtemp(path.join(os.tmpdir(), `svpack-${tag}-`));
  madeDirs.push(d);
  return d;
}
afterAll(async () => {
  // STORE-SQL Stage-3: release each vault's sqlite handles before rm (no-op on jsonl).
  for (const v of madeVaults.splice(0)) v.close();
  await Promise.all(madeDirs.map((d) => rm(d, { recursive: true, force: true })));
});

// July 1 2026, the session's "today"; recipients can override to fake expiry.
const DEFAULT_NOW = Date.UTC(2026, 6, 1);
const FUTURE = "2026-12-31T00:00:00Z";

async function makeApp(tag: string, startMs: number = DEFAULT_NOW): Promise<Ctx> {
  const vault = await openTestVault({ rootDir: await tmp(`${tag}-vault`) });
  madeVaults.push(vault);
  const identityDir = await tmp(`${tag}-id`);
  const clock = { ms: startMs };
  const app = createApp({ vault, identityDir, now: () => clock.ms });
  return { app, vault, clock };
}

// Identical bytes in both vaults ⇒ identical contentHash ⇒ the recipient's copy matches
// the pack's sourceHash (injectStudyIds is a deterministic, order-based transform).
const HTML =
  "<article><h1>Cell Biology</h1><p>Intro to the cell.</p>" +
  "<p>The mitochondrion is the powerhouse of the cell.</p></article>";
const QUOTE = "The mitochondrion is the powerhouse of the cell.";

async function seedSource(ctx: Ctx): Promise<string> {
  const res = await request(ctx.app).post("/api/sources/html").send({ title: "Cell Biology", content: HTML }).expect(201);
  return res.body.source.id;
}

async function seedLayerWithNote(ctx: Ctx): Promise<{ sourceId: string; layerId: string; noteId: string }> {
  const sourceId = await seedSource(ctx);
  const anchor = (
    await request(ctx.app)
      .post("/api/anchors")
      .send({ sourceId, anchorKind: "html_selection", studyId: `seed-${sourceId}`, quote: QUOTE, contextBefore: "", contextAfter: "" })
      .expect(201)
  ).body.anchor;
  const note = (
    await request(ctx.app)
      .post("/api/notes")
      .send({ sourceId, anchorIds: [anchor.id], contentType: "markdown", content: "Mnemonic: powerhouse." })
      .expect(201)
  ).body.note;
  return { sourceId, layerId: anchor.layerId, noteId: note.id };
}

async function exportPack(ctx: Ctx, layerId: string, labels: string[], validUntil = FUTURE) {
  return (
    await request(ctx.app)
      .post(`/api/layers/${layerId}/export-svpack`)
      .send({ recipients: labels.map((label) => ({ label })), validUntil })
      .expect(200)
  ).body as { packId: string; revision: number; fileB64: string; roster: { label: string; code: string; codeId: string }[]; refusedCount: number };
}

describe("svpack offline sharing — full roundtrip", () => {
  it("export → inspect → open → commit → sealed merge → read-only → delete", async () => {
    const pub = await makeApp("pub1");
    const seed = await seedLayerWithNote(pub);
    const exp = await exportPack(pub, seed.layerId, ["Zhang", "Li"]);
    expect(exp.roster).toHaveLength(2);
    expect(exp.fileB64.length).toBeGreaterThan(0);
    const code2 = exp.roster[1].code;

    const rcp = await makeApp("rcp1");
    const rcpSourceId = await seedSource(rcp); // same bytes ⇒ matching contentHash

    // inspect — no code, publisher unknown, local source matched, deps summary present
    const insp = (await request(rcp.app).post("/api/svpack/inspect").send({ fileB64: exp.fileB64 }).expect(200)).body;
    expect(insp.pinStatus).toBe("unknown");
    expect(insp.sourceMatch?.sourceId).toBe(rcpSourceId);
    expect(insp.header.contentTypes).toContain("markdown");

    // open — preview counts, no persistence
    const opened = (await request(rcp.app).post("/api/svpack/open").send({ fileB64: exp.fileB64, code: code2 }).expect(200)).body;
    expect(opened.preview).toBeTruthy();

    // commit — into the sealed store
    const committed = (await request(rcp.app).post("/api/svpack/commit").send({ fileB64: exp.fileB64, code: code2 }).expect(201)).body;
    expect(committed.sealed).toBe(true);
    const packId = committed.packId;

    // TOFU: the publisher is now pinned
    const insp2 = (await request(rcp.app).post("/api/svpack/inspect").send({ fileB64: exp.fileB64 }).expect(200)).body;
    expect(insp2.pinStatus).toBe("pinned-match");

    // read-model merge: the sealed note rides GET /notes flagged sealed:true
    const notes = (await request(rcp.app).get(`/api/sources/${rcpSourceId}/notes`).expect(200)).body.notes;
    const sealedNote = notes.find((n: { sealed?: boolean }) => n.sealed);
    expect(sealedNote).toBeTruthy();

    // sealed content is read-only
    await request(rcp.app).patch(`/api/notes/${sealedNote.id}`).send({ content: "hacked" }).expect(403);
    await request(rcp.app).delete(`/api/notes/${sealedNote.id}`).expect(403);
    await request(rcp.app).patch(`/api/layers/${committed.layerId}`).send({ enabled: false }).expect(403);

    // the sealed layer cannot be re-exported (structural + choke point)
    await request(rcp.app)
      .post(`/api/layers/${committed.layerId}/export-svpack`)
      .send({ recipients: [{ label: "leak" }], validUntil: FUTURE })
      .expect(403);

    // deleting the pack drops the sealed note from the read model
    await request(rcp.app).delete(`/api/svpack/${packId}`).expect(200);
    const after = (await request(rcp.app).get(`/api/sources/${rcpSourceId}/notes`).expect(200)).body.notes;
    expect(after.find((n: { sealed?: boolean }) => n.sealed)).toBeFalsy();
  });

  it("watermarks served sealed-note text with the recipient's codeId (§9)", async () => {
    const pub = await makeApp("pubwm");
    const seed = await seedLayerWithNote(pub);
    const exp = await exportPack(pub, seed.layerId, ["Zhang"]);

    const rcp = await makeApp("rcpwm");
    const rcpSourceId = await seedSource(rcp);
    await request(rcp.app).post("/api/svpack/commit").send({ fileB64: exp.fileB64, code: exp.roster[0].code }).expect(201);

    const notes = (await request(rcp.app).get(`/api/sources/${rcpSourceId}/notes`).expect(200)).body.notes;
    const sealed = notes.find((n: { sealed?: boolean }) => n.sealed);
    expect(typeof sealed.content).toBe("string");
    expect(stripWatermark(sealed.content)).toBe("Mnemonic: powerhouse."); // visible text intact
    expect(extractWatermark(sealed.content)).toBe(exp.roster[0].codeId); // a leaked paste is attributable
  });

  it("commits UNBOUND when the recipient lacks the source (no bytes ever shipped)", async () => {
    const pub = await makeApp("pub2");
    const seed = await seedLayerWithNote(pub);
    const exp = await exportPack(pub, seed.layerId, ["Zhang"]);

    const rcp = await makeApp("rcp2"); // no source seeded
    const insp = (await request(rcp.app).post("/api/svpack/inspect").send({ fileB64: exp.fileB64 }).expect(200)).body;
    expect(insp.sourceMatch).toBeNull();
    const committed = (await request(rcp.app).post("/api/svpack/commit").send({ fileB64: exp.fileB64, code: exp.roster[0].code }).expect(201)).body;
    expect(committed.sealed).toBe(true);
  });
});

describe("svpack — security gates", () => {
  it("rejects a wrong code and a tampered file", async () => {
    const pub = await makeApp("pub3");
    const seed = await seedLayerWithNote(pub);
    const exp = await exportPack(pub, seed.layerId, ["Zhang"]);
    const rcp = await makeApp("rcp3");
    await seedSource(rcp);

    // wrong code (valid FORMAT, unknown codeId) → 4xx
    const wrong = await request(rcp.app).post("/api/svpack/open").send({ fileB64: exp.fileB64, code: "A".repeat(40) });
    expect(wrong.status).toBeGreaterThanOrEqual(400);

    // a single flipped byte breaks the signature → 4xx
    const buf = Buffer.from(exp.fileB64, "base64");
    buf[buf.length - 20] ^= 0xff;
    const tampered = await request(rcp.app).post("/api/svpack/open").send({ fileB64: buf.toString("base64"), code: exp.roster[0].code });
    expect(tampered.status).toBeGreaterThanOrEqual(400);
  });

  it("refuses an expired pack (render-gated validity)", async () => {
    const pub = await makeApp("pub4");
    const seed = await seedLayerWithNote(pub);
    const exp = await exportPack(pub, seed.layerId, ["Zhang"], "2026-07-02T00:00:00Z");

    const rcp = await makeApp("rcp4", Date.UTC(2026, 7, 1)); // Aug 1 — past validUntil
    await seedSource(rcp);
    const r = await request(rcp.app).post("/api/svpack/open").send({ fileB64: exp.fileB64, code: exp.roster[0].code });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("expired");
  });
});

describe("svpack — renewal (offline revocation)", () => {
  it("renewal excludes a revoked recipient and refuses a stale revision", async () => {
    const pub = await makeApp("pub5");
    const seed = await seedLayerWithNote(pub);
    const exp = await exportPack(pub, seed.layerId, ["Zhang", "Li"]);
    const code1 = exp.roster[0].code;
    const code2 = exp.roster[1].code;
    const revokeCodeId = exp.roster[1].codeId;

    const rcp = await makeApp("rcp5");
    await seedSource(rcp);
    await request(rcp.app).post("/api/svpack/commit").send({ fileB64: exp.fileB64, code: code1 }).expect(201);

    // renew: revision 2, fresh CEK, Li's code pruned from the wrap list
    const renew = (await request(pub.app).post(`/api/packs/${exp.packId}/renew`).send({ validUntil: FUTURE, revokeCodeIds: [revokeCodeId] }).expect(200)).body;
    expect(renew.revision).toBe(2);

    // Zhang commits the renewal (replaces revision 1)
    await request(rcp.app).post("/api/svpack/commit").send({ fileB64: renew.fileB64, code: code1 }).expect(201);

    // Li's code can no longer open the renewal
    const liOpen = await request(rcp.app).post("/api/svpack/open").send({ fileB64: renew.fileB64, code: code2 });
    expect(liOpen.status).toBeGreaterThanOrEqual(400);

    // committing the OLD revision after the newer one is installed → 409 stale
    await request(rcp.app).post("/api/svpack/commit").send({ fileB64: exp.fileB64, code: code1 }).expect(409);
  });
});
