import { rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";

// Drives the REAL Electron app's WEBPAGE-SNAPSHOT path through the unified Web viewer:
// import a URL as a snapshot → the source opens in the unified shell's SNAPSHOT tab (a
// DomReader iframe rendering the stored study-id HTML, NOT a webview) → then "Open Live"
// spawns a LIVE tab (an Electron <webview> loading the original URL with the guest
// preload). This is the cross-mode behavior the host-page web config can't exercise
// (the live <webview> only exists in Electron). A local fixture HTTP server keeps it
// deterministic and offline.

const VAULT = path.resolve(".e2e-electron-vault-snapshot");

const PASSAGE = "Snapshot passage about the render thread.";
const PAGE_HTML =
  "<!doctype html><html><head><meta charset='utf-8'><title>Snapshot Lesson</title></head>" +
  `<body><article><section><p>${PASSAGE}</p></section></article></body></html>`;

let fixture: Server;
let fixtureUrl = "";
let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  await rm(VAULT, { recursive: true, force: true });

  fixture = createServer((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(PAGE_HTML);
  });
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", () => resolve()));
  const address = fixture.address();
  const port = typeof address === "object" && address ? address.port : 0;
  fixtureUrl = `http://127.0.0.1:${port}/lesson`;

  app = await electron.launch({
    args: ["dist-electron/main.cjs"],
    env: { ...process.env, STUDY_VAULT_ROOT: VAULT }
  });
  page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await expect(page.locator(".brand-block h1")).toHaveText("Sources");
});

test.afterAll(async () => {
  await app?.close();
  await new Promise<void>((resolve) => fixture.close(() => resolve()));
  await rm(VAULT, { recursive: true, force: true });
});

test("webpage snapshot in the unified Web viewer: snapshot tab renders → Open Live spawns a live webview tab", async () => {
  // Seed a webpage snapshot via the same API the import box uses (the app fetches +
  // snapshots the fixture in-process).
  const sourceId = await page.evaluate(async (url) => {
    const res = await fetch("/api/sources/url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });
    return (await res.json()).source.id as string;
  }, fixtureUrl);

  await page.getByRole("button", { name: "Refresh" }).click();
  await page.locator(".source-item-open").filter({ hasText: sourceId }).click();

  // The unified shell renders in SNAPSHOT sub-mode: one Snapshot tab + the address bar,
  // and the snapshot content comes from a DomReader iframe (no webview yet).
  await expect(page.locator(".webview-tabs .webview-tab")).toHaveCount(1);
  await expect(page.locator(".webview-tab").first()).toContainText("Snapshot");
  await expect(page.locator(".webview-host webview")).toHaveCount(0);
  const reader = page.frameLocator('iframe[title="Source reader"]');
  await expect(reader.getByText("Snapshot passage", { exact: false })).toBeVisible();

  // Going live: the nav-bar "Open Live" opens the original URL as a NEW tab backed by a
  // real Electron <webview> with the selection-capture guest preload.
  await page.locator(".webview-nav .webview-go-live").click();
  await expect(page.locator(".webview-tabs .webview-tab")).toHaveCount(2);
  const webview = page.locator(".webview-host webview");
  await expect(webview).toHaveCount(1);
  await expect(webview).toHaveAttribute("preload", /webview-preload\.cjs$/);
  await expect(webview).toHaveAttribute("src", fixtureUrl);
  // The address bar reflects the live URL once navigation settles.
  await expect(page.getByRole("textbox", { name: "Address" })).toHaveValue(/127\.0\.0\.1/);
});
