import { rm } from "node:fs/promises";
import path from "node:path";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";

// Drives the REAL Electron desktop app (its in-process server + served client),
// not the dev web server. Proves the packaged shell works end to end:
// import → select → anchor → note → on-document overlay → AI chat.
//
// Run: npm run e2e:electron   (builds client + bundles main/preload first).

const VAULT = path.resolve(".e2e-electron-vault");

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  await rm(VAULT, { recursive: true, force: true });
  app = await electron.launch({
    args: ["dist-electron/main.cjs"],
    env: { ...process.env, STUDY_VAULT_ROOT: VAULT }
  });
  page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
});

test.afterAll(async () => {
  await app?.close();
  await rm(VAULT, { recursive: true, force: true });
});

test("desktop app: import → select → anchor → note → overlay → AI chat", async () => {
  // The renderer is the same React app, served by the in-process server.
  await expect(page.locator(".brand-block h1")).toHaveText("Sources");

  const title = `Desktop ${Date.now()}`;
  const html = [
    '<article data-study-id="d-root">',
    '  <p data-study-id="d-p">Desktop self-test paragraph about render threads.</p>',
    "</article>"
  ].join("\n");

  await page.locator("section.import-box input").fill(title);
  await page.locator("section.import-box textarea").fill(html);
  await page.locator("section.import-box").getByRole("button", { name: "Import" }).click();
  await expect(page.locator(".reader-header h2")).toHaveText(title);

  // Click a paragraph inside the reader iframe → selection auto-fills the chat source.
  const reader = page.frameLocator('iframe[title="Source reader"]');
  await reader.locator('[data-study-id="d-p"]').click();
  await expect(page.locator(".chat-source")).toContainText("render threads");

  // Note — anchor created lazily from the selection on Save (no manual anchor step).
  await page.locator(".composer-input").fill("Desktop note.");
  await page.getByRole("button", { name: "Save Note" }).click();
  await expect(page.locator(".note-list")).toContainText("Desktop note.");

  // The note paints onto the document as an anchored highlight.
  await expect(reader.locator('[data-study-id="d-p"]')).toHaveClass(/sv-annotated/);

  // AI chat round-trip via the mock provider.
  const chat = page.locator(".chat-box");
  await page.locator(".composer-input").fill("Summarize this.");
  await chat.getByRole("button", { name: "Send" }).click();
  await expect(chat.locator(".chat-assistant").first()).toContainText("Summarize this.");
});
