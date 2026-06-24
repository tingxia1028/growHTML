import { rm } from "node:fs/promises";
import path from "node:path";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";

// Drives the REAL Electron desktop app (its in-process server + served client),
// not the dev web server. Proves the packaged shell works end to end:
// seed HTML → open → select → anchor → note → on-document overlay → AI chat.
//
// The current UI has no paste-HTML import box, so we seed a source through the
// in-process API (the same shape the web e2e uses) and then drive the UI.
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

test("desktop app: seed → open → select → anchor → note → overlay → AI chat", async () => {
  // The renderer is the same React app, served by the in-process server.
  await expect(page.locator(".brand-block h1")).toHaveText("Sources");

  const title = `Desktop ${Date.now()}`;
  const body = "<article><section><p>Desktop self-test paragraph about render threads.</p></section></article>";

  // Seed via the in-process API (no paste box in the current UI).
  const sourceId = await page.evaluate(
    async ({ t, b }) => {
      const res = await fetch("/api/sources/html", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: t, content: b })
      });
      return (await res.json()).source.id as string;
    },
    { t: title, b: body }
  );

  await page.getByRole("button", { name: "Refresh" }).click();
  await page.locator(".source-item-open").filter({ hasText: sourceId }).click();
  await expect(page.locator(".reader-header h2")).toHaveText(title);

  // Select a passage inside the reader iframe → selection auto-fills the chat source.
  const reader = page.frameLocator('iframe[title="Source reader"]');
  await reader.getByText("render threads", { exact: false }).click();
  await expect(page.locator(".chat-source")).toContainText("render threads");

  // Note — anchor created lazily from the selection on Save (no manual anchor step).
  await page.locator(".composer-mode .mode-tab", { hasText: "Note" }).click();
  await page.locator(".composer-input").fill("Desktop note.");
  await page.getByRole("button", { name: "Save Note" }).click();
  await expect(page.locator(".note-list")).toContainText("Desktop note.");

  // The note paints onto the document as an anchored highlight.
  await expect(reader.locator(".sv-annotated").first()).toBeVisible();

  // AI chat round-trip via the mock provider.
  const chat = page.locator(".chat-box");
  await page.locator(".composer-mode .mode-tab", { hasText: "Ask AI" }).click();
  await page.locator(".composer-input").fill("Summarize this.");
  await chat.getByRole("button", { name: "Send" }).click();
  await expect(chat.locator(".chat-assistant").first()).toContainText("Summarize this.");
});
