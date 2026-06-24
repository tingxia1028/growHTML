import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer, type StartedServer } from "./start";

let tempDir = "";
let previousRoot: string | undefined;
let started: StartedServer | null = null;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "study-vault-start-"));
  previousRoot = process.env.STUDY_VAULT_ROOT;
  process.env.STUDY_VAULT_ROOT = tempDir;
});

afterEach(async () => {
  if (started) await started.close();
  started = null;
  if (previousRoot === undefined) delete process.env.STUDY_VAULT_ROOT;
  else process.env.STUDY_VAULT_ROOT = previousRoot;
  await rm(tempDir, { recursive: true, force: true });
});

describe("startServer", () => {
  it("boots the vault + API on a free port and serves over HTTP", async () => {
    started = await startServer({ port: 0 });
    expect(started.port).toBeGreaterThan(0);
    expect(started.url).toContain(`:${started.port}`);

    const response = await fetch(`${started.url}/api/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, app: "ai-study-vault" });
  });
});
