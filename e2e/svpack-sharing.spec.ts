import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { openLayers, openNotesTab } from "./helpers";

// Protected `.svpack` sharing, end-to-end over the REAL UI (svpackViews dialogs opened
// from the Layers pane, layerViews):
//
//   1. EXPORT (publisher = the shared e2e server): layer row 分享… → recipient labels →
//      one-time roster (2 formatted codes + the 仅显示这一次 warning) → 下载 .svpack
//      (Playwright download event; filename + non-empty bytes).
//   2. CROSS-VAULT IMPORT (recipient = the shared e2e server): the pack is built by a
//      SECOND app instance (createApp over its own mkdtemp vault + identityDir — the
//      construction svpack.test.ts uses) booted in a tsx CHILD PROCESS on an ephemeral
//      port, and crosses between vaults as BYTES ONLY, exactly the real offline flow.
//      (A child process, not an in-worker import: statically importing src/server/app
//      inside a spec trips a Node "Unexpected module status 3" crash in linkedom's
//      cssom dependency under Playwright's ESM loader; tsx — the dev server's own
//      loader — handles the chain fine.)
//      UI: 导入 .svpack → setInputFiles → inspect (publisher unknown
//      + 匹配到本地源) → code → 打开预览 (counts) → 导入 → sealed layer in the Lens +
//      the sealed note in the notes list (watermarked: CONTAINS the visible text, never
//      equals it) → DELETE /api/svpack/:packId drops it after reload.
//
// DATA HYGIENE — the shared server's vault (the run's ephemeral temp vault, see
// e2e/harness.ts) is left exactly as found:
//   • every seeded source is deleted (deleteSource cascades anchors/notes/patches —
//     verified via API in spec 1); layer records for a deleted source are the one
//     API-undeletable residue every existing spec shares (only custom layers have a
//     delete route), and the temp vault is deleted by global-teardown anyway.
//   • the export's publish ledger (<vault>/publishes/<packId>.json) has no delete
//     API, so it is removed from disk in the finally.
//   • the sealed import blob is deleted via DELETE /api/svpack/:packId.
//   • IDENTITY: the shared dev server uses the REAL ~/.growte/identity (createApp
//     default). The export/commit create device+publisher keys, pin the spec publisher,
//     and ratchet clock.hwm there. beforeAll records whether ~/.growte(/identity)
//     existed; afterAll removes the dir when THIS RUN created it, else surgically
//     removes only the publisher ids this run pinned. device.key is never deleted when
//     the dir pre-existed (real sealed content may be keyed under it).
//
// Run: npx playwright test e2e/svpack-sharing.spec.ts
// (Dedicated e2e ports + ephemeral temp vault — see e2e/harness.ts; reuseExistingServer is false by design.)

import { E2E_VAULT_ROOT, SERVER } from "./harness";
const GROWTE_ROOT = path.join(os.homedir(), ".growte");
const IDENTITY_DIR = path.join(GROWTE_ROOT, "identity");
const PINS_FILE = path.join(IDENTITY_DIR, "pinned-publishers.json");

// Identical bytes seeded in BOTH vaults ⇒ identical contentHash (injectStudyIds is a
// deterministic transform) ⇒ inspect matches the recipient's local source (mirrors
// svpack.test.ts's HTML constant approach).
const HTML =
  "<article><h1>Cell Biology</h1><p>Intro to the cell.</p>" +
  "<p>The mitochondrion is the powerhouse of the cell.</p></article>";
const QUOTE = "The mitochondrion is the powerhouse of the cell.";
// Under 48 visible chars: the forensic watermark (zero-width chars) then only APPENDS a
// frame at the end, so this stays a contiguous substring of the served sealed text and
// substring locators (hasText / toContainText) keep working.
const NOTE_TEXT = "Powerhouse mnemonic (svpack e2e).";
// A roster code as displayed: 8 dash-separated groups of 5 Crockford base32 chars.
const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{5}(?:-[0-9A-HJKMNP-TV-Z]{5}){7}$/;

// —— Identity-dir restore bookkeeping (see DATA HYGIENE above) ————————————————————
let growteExistedBefore = true;
let identityExistedBefore = true;
const pinnedPublisherIds: string[] = [];

test.beforeAll(() => {
  // The e2e server boot does NOT create the identity dir (createSealedRuntime early-
  // returns with no sealed blobs), so this still observes the true pre-suite state.
  growteExistedBefore = existsSync(GROWTE_ROOT);
  identityExistedBefore = existsSync(IDENTITY_DIR);
});

test.afterAll(async () => {
  if (!growteExistedBefore) {
    await rm(GROWTE_ROOT, { recursive: true, force: true });
    return;
  }
  if (!identityExistedBefore) {
    await rm(IDENTITY_DIR, { recursive: true, force: true });
    return;
  }
  // Pre-existing identity: only remove the pins THIS run added; never touch keys.
  if (pinnedPublisherIds.length === 0) return;
  try {
    const parsed = JSON.parse(await readFile(PINS_FILE, "utf8")) as {
      v: number;
      publishers: Array<{ id: string }>;
    };
    parsed.publishers = parsed.publishers.filter((pin) => !pinnedPublisherIds.includes(pin.id));
    await writeFile(PINS_FILE, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  } catch {
    // Pins file absent or unreadable — nothing of ours to remove / don't guess.
  }
});

// —— Seeding (the note-card spec's idiom, parameterized by base URL so the same
//    helpers drive the shared server AND the in-spec publisher app) ————————————————

async function seedHtmlSource(request: APIRequestContext, base: string, title: string) {
  const res = await request.post(`${base}/api/sources/html`, { data: { title, content: HTML } });
  expect(res.ok(), `seed source failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).source as { id: string; title: string };
}

async function seedAnchoredNote(request: APIRequestContext, base: string, sourceId: string) {
  const aRes = await request.post(`${base}/api/anchors`, {
    data: {
      sourceId,
      anchorKind: "html_selection",
      studyId: `seed-${Date.now()}`,
      quote: QUOTE,
      contextBefore: "",
      contextAfter: ""
    }
  });
  expect(aRes.ok(), `seed anchor failed: ${aRes.status()}`).toBeTruthy();
  const anchor = (await aRes.json()).anchor as { id: string; layerId: string };
  const nRes = await request.post(`${base}/api/notes`, {
    data: { sourceId, anchorIds: [anchor.id], contentType: "markdown", content: NOTE_TEXT }
  });
  expect(nRes.ok(), `seed note failed: ${nRes.status()}`).toBeTruthy();
  const note = (await nRes.json()).note as { id: string };
  return { anchorId: anchor.id, layerId: anchor.layerId, noteId: note.id };
}

// Boot the PUBLISHER app — createApp over its own vault + identityDir (exactly how
// svpack.test.ts constructs it, `now` injected) — in a tsx child process on an
// ephemeral port. The boot script is generated into the test's temp output dir; the
// child prints the port once listening.
async function startPublisherApp(opts: {
  bootPath: string;
  vaultDir: string;
  identityDir: string;
}): Promise<{ child: ChildProcess; base: string }> {
  const repoRoot = process.cwd();
  const vaultUrl = pathToFileURL(path.join(repoRoot, "src", "core", "vault.ts")).href;
  const appUrl = pathToFileURL(path.join(repoRoot, "src", "server", "app.ts")).href;
  const nodeStorageUrl = pathToFileURL(path.join(repoRoot, "src", "core", "storage", "nodeStorage.ts")).href;
  await writeFile(
    opts.bootPath,
    [
      `import { openVault } from ${JSON.stringify(vaultUrl)};`,
      `import { createApp } from ${JSON.stringify(appUrl)};`,
      `import { nodeStorage } from ${JSON.stringify(nodeStorageUrl)};`,
      `const vault = await openVault({ rootDir: process.env.SVPACK_PUB_VAULT, storage: nodeStorage });`,
      `const app = createApp({ vault, identityDir: process.env.SVPACK_PUB_IDENTITY, now: () => Date.now() });`,
      `const server = app.listen(0, "127.0.0.1", () => {`,
      `  console.log("SVPACK_PUB_PORT=" + server.address().port);`,
      `});`,
      ``
    ].join("\n"),
    "utf8"
  );
  const child = spawn(process.execPath, ["--import", "tsx", opts.bootPath], {
    cwd: repoRoot,
    env: { ...process.env, SVPACK_PUB_VAULT: opts.vaultDir, SVPACK_PUB_IDENTITY: opts.identityDir },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const base = await new Promise<string>((resolve, reject) => {
    let out = "";
    let err = "";
    const timer = setTimeout(
      () => reject(new Error(`publisher app did not boot in time.\nstdout: ${out}\nstderr: ${err}`)),
      45_000
    );
    child.stdout!.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      const match = out.match(/SVPACK_PUB_PORT=(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(`http://127.0.0.1:${match[1]}`);
      }
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      err += chunk.toString();
    });
    child.once("exit", (exitCode) => {
      clearTimeout(timer);
      reject(new Error(`publisher app exited early (code ${exitCode}).\nstdout: ${out}\nstderr: ${err}`));
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return { child, base };
}

async function selectSource(page: Page, title: string) {
  await page.locator(".source-item-open", { hasText: title }).first().click();
  await expect(page.locator(".reader-tab-title")).toHaveText(title);
}

async function openApp(page: Page, title: string) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await selectSource(page, title);
}

// —— 1. Publisher export UI ————————————————————————————————————————————————————————

test("svpack export UI: 分享… → one-time roster (2 codes) → download the .svpack", async ({
  page,
  request
}) => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const title = `Svpack Export ${stamp}`;
  const cleanup = { sourceId: "", packId: "" };

  try {
    const source = await seedHtmlSource(request, SERVER, title);
    cleanup.sourceId = source.id;
    await seedAnchoredNote(request, SERVER, source.id);

    await openApp(page, title);
    await openLayers(page);

    // The seeded note lives in the OWNED root layer (titled after the source; the tree
    // pane displays it as "Mine" with the source title as subtitle). The old
    // .layer-group wrappers are gone — the pane is a TREE now; target by data-role.
    const ownedRow = page.locator('.layer-panel .layer-item[data-role="owned"]', {
      hasText: title
    });
    await expect(ownedRow).toBeVisible();
    await ownedRow.locator(".layer-share-btn").click();

    const dialog = page.locator(".svpack-dialog");
    await expect(dialog).toBeVisible();

    // Recipients: Zhang + Li (one label row exists; 添加接收者 adds the second).
    await dialog.locator(".svpack-recipient-input").first().fill("Zhang");
    await dialog.locator(".svpack-recipient-add").click();
    await dialog.locator(".svpack-recipient-input").nth(1).fill("Li");

    // Capture the export response for the packId (the ledger file cleanup below —
    // the UI never surfaces it).
    const exportResponsePromise = page.waitForResponse(
      (res) => res.url().includes("/export-svpack") && res.request().method() === "POST"
    );
    await dialog.locator(".svpack-export-submit").click();
    const exported = (await (await exportResponsePromise).json()) as { packId: string };
    cleanup.packId = exported.packId;

    // One-time roster: warning + 2 rows, each label with a display-formatted code.
    await expect(dialog.locator(".svpack-once-warning")).toContainText("仅显示这一次");
    const rosterRows = dialog.locator(".svpack-roster-row");
    await expect(rosterRows).toHaveCount(2);
    await expect(rosterRows.nth(0).locator(".svpack-roster-label")).toHaveText("Zhang");
    await expect(rosterRows.nth(1).locator(".svpack-roster-label")).toHaveText("Li");
    await expect(rosterRows.nth(0).locator(".svpack-code")).toHaveText(CODE_RE);
    await expect(rosterRows.nth(1).locator(".svpack-code")).toHaveText(CODE_RE);
    const codeZhang = await rosterRows.nth(0).locator(".svpack-code").textContent();
    const codeLi = await rosterRows.nth(1).locator(".svpack-code").textContent();
    expect(codeZhang).not.toBe(codeLi); // per-recipient codes are distinct
    // Nothing in this layer is a protected re-import, so nothing was refused.
    await expect(dialog.locator(".svpack-refused-note")).toHaveCount(0);

    // 下载 .svpack → a real browser download with the layer-title filename + bytes.
    const downloadPromise = page.waitForEvent("download");
    await dialog.locator(".svpack-download-btn").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`${title}.svpack`);
    const downloadPath = await download.path();
    expect((await stat(downloadPath)).size).toBeGreaterThan(0);

    await dialog.locator(".svpack-roster-close").click();
    await expect(page.locator(".svpack-dialog")).toHaveCount(0);

    // Cleanup + cascade verification: deleting the source removes its anchors/notes
    // (deleteSource cascades anchors/notes/patches) — verified via the API.
    const del = await request.delete(`${SERVER}/api/sources/${source.id}`);
    expect(del.ok(), `delete source failed: ${del.status()}`).toBeTruthy();
    cleanup.sourceId = "";
    const notesAfter = await request.get(`${SERVER}/api/notes?sourceId=${source.id}`);
    expect(((await notesAfter.json()) as { notes: unknown[] }).notes).toHaveLength(0);
    const anchorsAfter = await request.get(`${SERVER}/api/sources/${source.id}/anchors`);
    expect(((await anchorsAfter.json()) as { anchors: unknown[] }).anchors).toHaveLength(0);
  } finally {
    // Idempotent re-delete on failure paths; assertions live in the body, not here.
    if (cleanup.sourceId) {
      await request.delete(`${SERVER}/api/sources/${cleanup.sourceId}`).catch(() => {});
    }
    if (cleanup.packId) {
      // The publish ledger has no delete API — remove the file so the shared vault is
      // left exactly as found.
      await rm(path.join(E2E_VAULT_ROOT, "publishes", `${cleanup.packId}.json`), { force: true });
    }
  }
});

// —— 2. Cross-vault import UI ————————————————————————————————————————————————————————

test("svpack cross-vault import UI: inspect → code → preview → commit (sealed) → pack delete drops it", async ({
  page,
  request
}, testInfo) => {
  test.setTimeout(120_000); // first tsx boot of the publisher child compiles the app chain

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const pubTitle = `Svpack Pub ${stamp}`; // becomes the sealed layer's title on the recipient
  const rcpTitle = `Svpack Rcp ${stamp}`;
  const cleanup = { sourceId: "", packId: "" };

  // The PUBLISHER is a second app over its own mkdtemp vault + identityDir (never the
  // shared server) — the .svpack crosses between vaults as bytes only.
  const pubVaultDir = await mkdtemp(path.join(os.tmpdir(), "svpack-e2e-pub-vault-"));
  const pubIdentityDir = await mkdtemp(path.join(os.tmpdir(), "svpack-e2e-pub-id-"));
  let pubChild: ChildProcess | null = null;

  try {
    const publisher = await startPublisherApp({
      bootPath: testInfo.outputPath("pub-server.mjs"),
      vaultDir: pubVaultDir,
      identityDir: pubIdentityDir
    });
    pubChild = publisher.child;
    const pubBase = publisher.base;

    // Publisher side (API): seed the source+note, export a 1-recipient protected pack.
    const pubSource = await seedHtmlSource(request, pubBase, pubTitle);
    const pubSeed = await seedAnchoredNote(request, pubBase, pubSource.id);
    const exportRes = await request.post(`${pubBase}/api/layers/${pubSeed.layerId}/export-svpack`, {
      data: {
        recipients: [{ label: "Zhang" }],
        validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      }
    });
    expect(exportRes.ok(), `publisher export failed: ${exportRes.status()}`).toBeTruthy();
    const exported = (await exportRes.json()) as {
      packId: string;
      fileB64: string;
      roster: Array<{ label: string; code: string; codeId: string }>;
    };
    const code = exported.roster[0].code;

    // Record the publisher id so afterAll can unpin it from the REAL identity dir the
    // shared server pins into on commit (inspect is read-only — it never pins).
    const pubInspect = await request.post(`${pubBase}/api/svpack/inspect`, {
      data: { fileB64: exported.fileB64 }
    });
    expect(pubInspect.ok()).toBeTruthy();
    const publisherId = ((await pubInspect.json()) as { header: { publisher: { id: string } } }).header
      .publisher.id;
    pinnedPublisherIds.push(publisherId);

    // The pack file — written to a Playwright-managed temp path (auto-cleaned).
    const packPath = testInfo.outputPath(`export-${stamp}.svpack`);
    await writeFile(packPath, Buffer.from(exported.fileB64, "base64"));

    // Recipient side: the IDENTICAL source bytes, so contentHash matches the pack.
    const rcpSource = await seedHtmlSource(request, SERVER, rcpTitle);
    cleanup.sourceId = rcpSource.id;

    await openApp(page, rcpTitle);
    await openLayers(page);
    await page.locator(".svpack-import-open-btn").click();
    const dialog = page.locator(".svpack-dialog");
    await expect(dialog).toBeVisible();

    // Pick the file → auto-inspect (no code): first-sight publisher + local source match.
    await dialog.locator(".svpack-import-file").setInputFiles(packPath);
    const inspect = dialog.locator(".svpack-inspect");
    await expect(inspect).toBeVisible();
    await expect(inspect.locator(".svpack-inspect-title")).toContainText(pubTitle);
    await expect(inspect.locator(".svpack-pin")).toHaveAttribute("data-status", "unknown");
    await expect(inspect.locator(".svpack-pin")).toContainText("首次见到该发布者");
    await expect(inspect.locator(".svpack-source-match")).toHaveAttribute("data-matched", "true");
    await expect(inspect.locator(".svpack-source-match")).toContainText("匹配到本地源");
    await expect(inspect.locator(".svpack-source-match")).toContainText(rcpTitle);

    // Code → 打开预览: the one anchor re-anchors cleanly against the identical source.
    await dialog.locator(".svpack-code-input").fill(code);
    await dialog.locator(".svpack-open-btn").click();
    const previewStats = dialog.locator(".svpack-preview .layer-preview-stats");
    await expect(previewStats.locator('[data-status="matched"]')).toHaveText("匹配 1");
    await expect(previewStats.locator('[data-status="fuzzy"]')).toHaveText("模糊 0");
    await expect(previewStats.locator('[data-status="unmatched"]')).toHaveText("未匹配 0");

    // 导入 (commit) — capture the packId for the delete step + cleanup.
    const commitResponsePromise = page.waitForResponse(
      (res) => res.url().includes("/api/svpack/commit") && res.request().method() === "POST"
    );
    await dialog.locator(".svpack-commit-btn").click();
    const committed = (await (await commitResponsePromise).json()) as { packId: string };
    cleanup.packId = committed.packId;

    await expect(dialog.locator(".svpack-success-head")).toContainText("导入成功");
    await expect(dialog.locator(".svpack-success-counts")).toContainText("笔记 1 条");
    await expect(dialog.locator(".svpack-success-counts")).toContainText("锚点 1 个");

    // The sealed-imports manager list shows the pack as 有效.
    const sealedRow = dialog.locator(".svpack-sealed-row", { hasText: pubTitle });
    await expect(sealedRow).toHaveAttribute("data-status", "active");
    await expect(sealedRow.locator(".svpack-status")).toHaveText("有效");

    await dialog.locator(".svpack-done-btn").click();
    await expect(page.locator(".svpack-dialog")).toHaveCount(0);

    // Sealed layer marker in the Lens: it rides the imported rows (the tree pane has no
    // group wrappers anymore — target by import mode), and (sealed) its row must NOT
    // offer 分享… (re-export is refused; the entry point is suppressed).
    const sealedLayerRow = page.locator(
      '.layer-panel .layer-item[data-import-mode="imported"]',
      { hasText: pubTitle }
    );
    await expect(sealedLayerRow).toBeVisible();
    await expect(sealedLayerRow.locator(".layer-share-btn")).toHaveCount(0);

    // Fresh boot of the read model (reload) — the sealed layer + note persist.
    await page.reload();
    await selectSource(page, rcpTitle);
    await openLayers(page);
    await expect(sealedLayerRow).toBeVisible();
    await openNotesTab(page);
    // Served sealed text is watermarked with zero-width chars → CONTAINS, never equals.
    await expect(page.locator(".note-list-row", { hasText: NOTE_TEXT })).toBeVisible();
    const served = await request.get(`${SERVER}/api/sources/${rcpSource.id}/notes`);
    const sealedNote = ((await served.json()) as {
      notes: Array<{ sealed?: boolean; content: unknown }>;
    }).notes.find((note) => note.sealed);
    expect(sealedNote).toBeTruthy();
    expect(typeof sealedNote!.content).toBe("string");
    expect(sealedNote!.content as string).toContain(NOTE_TEXT);
    expect(sealedNote!.content).not.toBe(NOTE_TEXT); // the invisible watermark is present

    // Deleting the imported pack (the sealed blob) drops the layer + note after reload.
    const del = await request.delete(`${SERVER}/api/svpack/${cleanup.packId}`);
    expect(del.ok(), `delete svpack failed: ${del.status()}`).toBeTruthy();
    cleanup.packId = "";
    await page.reload();
    await selectSource(page, rcpTitle);
    await openLayers(page);
    await expect(page.locator(".layer-panel .layer-item", { hasText: pubTitle })).toHaveCount(0);
    await openNotesTab(page);
    await expect(page.locator(".note-list-row", { hasText: NOTE_TEXT })).toHaveCount(0);
  } finally {
    if (cleanup.packId) {
      await request.delete(`${SERVER}/api/svpack/${cleanup.packId}`).catch(() => {});
    }
    if (cleanup.sourceId) {
      await request.delete(`${SERVER}/api/sources/${cleanup.sourceId}`).catch(() => {});
    }
    if (pubChild && pubChild.exitCode === null) {
      const exited = new Promise<void>((resolve) => pubChild!.once("exit", () => resolve()));
      pubChild.kill();
      await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 3000))]);
    }
    await rm(pubVaultDir, { recursive: true, force: true }).catch(() => {});
    await rm(pubIdentityDir, { recursive: true, force: true }).catch(() => {});
  }
});
