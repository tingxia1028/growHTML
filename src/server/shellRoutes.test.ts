// App-shell routes (SHELL-1/2) — the tiny readout endpoints + the workspace.json
// single-writer split: onboarding block roundtrip through its OWN seam, the layout
// PUT preserving it (the M1 plugin-prefs no-clobber rule applied to workspace.json),
// /api/about version, /api/ai/providers env detection, and the STRICTLY read-only
// /api/svpack/identity (never creates an identity as a side effect).

import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import packageJson from "../../package.json";
import { PUBLISHER_KEY_FILE, loadOrCreatePublisher } from "../core/identity/publisher";
import { type StudyVault } from "../core/vault";
import { openTestVault } from "../core/testing/openTestVault";
import { createApp } from "./app";

let tempDir = "";
let identityDir = "";
let vault: StudyVault;
let app: ReturnType<typeof createApp>;

const PRISTINE = { dismissed: false, completedAt: null, doneSteps: [], sampleSourceId: null };

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "study-vault-shell-"));
  identityDir = path.join(tempDir, "identity");
  vault = await openTestVault({ rootDir: path.join(tempDir, "vault") });
  app = createApp({ vault, identityDir });
});

afterEach(async () => {
  vault?.close(); // STORE-SQL Stage-3: release sqlite .db handles before rm (Windows EBUSY). no-op on jsonl.
  await rm(tempDir, { recursive: true, force: true });
});

describe("workspace onboarding block (single-writer field groups)", () => {
  it("answers the pristine default when no block was ever written", async () => {
    const res = await request(app).get("/api/workspace/onboarding").expect(200);
    expect(res.body.onboarding).toEqual(PRISTINE);
  });

  it("roundtrips a PUT block (defaults fill omitted fields)", async () => {
    const put = await request(app)
      .put("/api/workspace/onboarding")
      .send({ dismissed: true, doneSteps: ["import-doc"] })
      .expect(200);
    expect(put.body.onboarding).toEqual({
      dismissed: true,
      completedAt: null,
      doneSteps: ["import-doc"],
      sampleSourceId: null
    });

    const got = await request(app).get("/api/workspace/onboarding").expect(200);
    expect(got.body.onboarding.dismissed).toBe(true);
    expect(got.body.onboarding.doneSteps).toEqual(["import-doc"]);
  });

  it("the layout PUT (WorkspaceContext's full-body write) can NEVER clobber the block", async () => {
    await request(app)
      .put("/api/workspace/onboarding")
      .send({ dismissed: false, completedAt: null, doneSteps: ["import-doc", "first-note"], sampleSourceId: "src_1" })
      .expect(200);

    // The contended writer PUTs layout state only — exactly what the client sends.
    await request(app).put("/api/workspace").send({ activeLayoutId: "study-vault", layouts: [] }).expect(200);

    const after = await request(app).get("/api/workspace/onboarding").expect(200);
    expect(after.body.onboarding.doneSteps).toEqual(["import-doc", "first-note"]);
    expect(after.body.onboarding.sampleSourceId).toBe("src_1");

    // Even a layout body that SMUGGLES an onboarding field is ignored — the route
    // owns only its field group (single-writer ownership, not trust in callers).
    await request(app)
      .put("/api/workspace")
      .send({ activeLayoutId: "three-pane", layouts: [], onboarding: PRISTINE })
      .expect(200);
    const still = await request(app).get("/api/workspace/onboarding").expect(200);
    expect(still.body.onboarding.doneSteps).toEqual(["import-doc", "first-note"]);
  });

  it("the onboarding PUT preserves the stored layout fields (the mirror direction)", async () => {
    await request(app).put("/api/workspace").send({ activeLayoutId: "study-vault", layouts: [] }).expect(200);
    await request(app).put("/api/workspace/onboarding").send({ dismissed: true }).expect(200);

    const workspace = await request(app).get("/api/workspace").expect(200);
    expect(workspace.body.workspace.activeLayoutId).toBe("study-vault");
    expect(workspace.body.workspace.onboarding.dismissed).toBe(true);
  });

  it("rejects a malformed block with 400", async () => {
    await request(app).put("/api/workspace/onboarding").send({ doneSteps: "not-an-array" }).expect(400);
  });
});

describe("about + provider readouts", () => {
  it("GET /api/about reports the package.json version + isPackaged:false by default (dev/CLI/web)", async () => {
    const res = await request(app).get("/api/about").expect(200);
    expect(res.body).toEqual({ app: "ai-study-vault", version: packageJson.version, isPackaged: false });
  });

  it("GET /api/about reports isPackaged:true when the app runs packaged (Electron main threads it)", async () => {
    const packagedApp = createApp({ vault, identityDir, isPackaged: true });
    const res = await request(packagedApp).get("/api/about").expect(200);
    expect(res.body).toEqual({ app: "ai-study-vault", version: packageJson.version, isPackaged: true });
  });

  it("GET /api/ai/providers reports the ACTIVE provider (mock default) + the registry", async () => {
    const res = await request(app).get("/api/ai/providers").expect(200);
    expect(res.body.active).toEqual({ id: "mock", kind: "mock" });
    const ids = (res.body.providers as Array<{ id: string }>).map((p) => p.id);
    expect(ids).toContain("mock");
    expect(ids).toContain("deepseek");
    expect(ids).toContain("managed");
  });
});

describe("svpack identity readout (Tier-A, strictly read-only)", () => {
  it("answers null on a device that never published — and creates NOTHING", async () => {
    const res = await request(app).get("/api/svpack/identity").expect(200);
    expect(res.body).toEqual({ identity: null });
    expect(existsSync(path.join(identityDir, PUBLISHER_KEY_FILE))).toBe(false);
  });

  it("reports the publisher id + the manifest-derived display name once a key exists", async () => {
    const publisher = loadOrCreatePublisher(identityDir);
    const res = await request(app).get("/api/svpack/identity").expect(200);
    expect(res.body.identity.id).toBe(publisher.id);
    // A fresh temp vault's manifest name — the same expression export headers use.
    expect(res.body.identity.displayName).toBe(vault.manifest.name || "Growte Publisher");
  });
});
