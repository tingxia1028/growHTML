import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixtureHtmlBody, fixtureTimestamp } from "../fixtures/golden";
import { openVault, sourcesDirName } from "../vault";
import { computeContentHash, ingestHtmlSource, listSources, readSourceContent, slugifySourceTitle } from "./sources";

let tempDir = "";

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "study-vault-ingest-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("source ingest", () => {
  it("writes an HTML source file and records it in sources.jsonl", async () => {
    const vault = await openVault({ rootDir: tempDir });
    const source = await ingestHtmlSource(vault, {
      title: "Render Thread Study Note",
      content: fixtureHtmlBody,
      createdAt: fixtureTimestamp,
      createdBy: "system"
    });

    const sources = await listSources(vault);

    expect(sources).toEqual([source]);
    expect(source.sourceType).toBe("html");
    expect(source.mimeType).toBe("text/html");
    expect(source.contentHash).toBe(computeContentHash(fixtureHtmlBody));
    expect(source.path.startsWith(`${sourcesDirName}/render-thread-study-note-`)).toBe(true);
    await expect(access(path.join(tempDir, source.path))).resolves.toBeUndefined();
    await expect(readSourceContent(vault, source)).resolves.toBe(fixtureHtmlBody);
  });

  it("creates unique files for repeated imports", async () => {
    const vault = await openVault({ rootDir: tempDir });
    const first = await ingestHtmlSource(vault, { title: "Same", content: "<p>one</p>" });
    const second = await ingestHtmlSource(vault, { title: "Same", content: "<p>two</p>" });

    expect(first.path).not.toBe(second.path);
    expect(await listSources(vault)).toHaveLength(2);
  });

  it("slugifies source titles defensively", () => {
    expect(slugifySourceTitle("UE Render Thread 学习笔记")).toBe("ue-render-thread-学习笔记");
    expect(slugifySourceTitle("你好")).toBe("你好");
    expect(slugifySourceTitle("!!!", "fallback")).toBe("fallback");
  });
});
