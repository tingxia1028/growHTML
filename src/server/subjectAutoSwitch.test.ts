import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openVault, type StudyVault } from "../core/vault";
import { createApp } from "./app";
import { foregroundForSource } from "../kits/activation";

// M-A persistence roundtrip (subject-kits.md §3.7, post-F4): the per-source USER PIN is
// the existing `metadata.activeKitIds` array, written through the SAME merge-patch
// endpoint per-source kit activation already uses. Detection is never stored — it
// recomputes from the server-persisted record on every open — so the whole roundtrip
// is: pin via PATCH → survives a re-fetch and beats detection → clear via
// `activeKitIds: null` (non-array = "inherit") → detection takes over again.
//
// createApp's module import runs installServerKits, which registers the textbook kit's
// detection table (the M-A seed) — the same table installClientKits registers, so this
// exercises the real registration seam end to end.

let tempDir = "";
let vault: StudyVault;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "study-vault-subject-switch-"));
  vault = await openVault({ rootDir: tempDir });
  app = createApp({ vault });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function fetchSource(sourceId: string) {
  const listed = await request(app).get("/api/sources").expect(200);
  const source = listed.body.sources.find((s: { id: string }) => s.id === sourceId);
  expect(source).toBeTruthy();
  return source;
}

describe("subject auto-switch — pin persistence roundtrip over the real API", () => {
  it("detects on open, pin beats detection across a re-fetch, clearing re-detects", async () => {
    const created = await request(app)
      .post("/api/sources/html")
      .send({ title: "人教版数学教材 第一章 集合", content: "<article><p>集合的概念。</p></article>" })
      .expect(201);
    const sourceId: string = created.body.source.id;

    // 1. Fresh source, no pin → the registered textbook table wins (title keyword 教材).
    const detected = foregroundForSource(await fetchSource(sourceId));
    expect(detected.mode).toBe("detected");
    expect(detected.kitIds).toEqual(["textbook-learning"]);
    expect(detected.detection?.signals[0]).toEqual({ kind: "title-keyword", value: "教材", points: 0.6 });

    // 2. USER PIN (Core) through the existing activation write — beats the detection.
    await request(app).patch(`/api/sources/${sourceId}`).send({ metadata: { activeKitIds: [] } }).expect(200);
    const pinned = foregroundForSource(await fetchSource(sourceId));
    expect(pinned).toEqual({ kitIds: [], mode: "pin", detection: null });

    // 3. The pin persists as plain source metadata (no parallel store).
    const record = await fetchSource(sourceId);
    expect(record.metadata.activeKitIds).toEqual([]);

    // 4. Clear the pin: activeKitIds → null (non-array = inherit) → detection returns.
    await request(app).patch(`/api/sources/${sourceId}`).send({ metadata: { activeKitIds: null } }).expect(200);
    const cleared = foregroundForSource(await fetchSource(sourceId));
    expect(cleared.mode).toBe("detected");
    expect(cleared.kitIds).toEqual(["textbook-learning"]);
  });

  it("an unmatched title never auto-switches — the workspace default holds", async () => {
    const created = await request(app)
      .post("/api/sources/html")
      .send({ title: "暑假旅行随笔", content: "<article><p>七月的海边。</p></article>" })
      .expect(201);
    const resolution = foregroundForSource(await fetchSource(created.body.source.id));
    expect(resolution.mode).toBe("default");
    expect(resolution.kitIds).toEqual(["textbook-learning"]); // the server-side fallback default
  });
});
