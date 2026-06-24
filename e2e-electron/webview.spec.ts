import { rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";

// Drives the REAL Electron app's live-web annotation path: "Open Live" a URL →
// a web_live source → the reader embeds an <webview> loading that live page with
// the selection-capture guest preload attached. A local fixture HTTP server
// keeps it deterministic and offline.

const VAULT = path.resolve(".e2e-electron-vault-web");

let fixture: Server;
let fixtureUrl = "";
let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  await rm(VAULT, { recursive: true, force: true });

  fixture = createServer((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(
      "<!doctype html><html><body><h1>Fixture</h1><p>The render thread submits commands.</p></body></html>"
    );
  });
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", () => resolve()));
  const address = fixture.address();
  const port = typeof address === "object" && address ? address.port : 0;
  fixtureUrl = `http://127.0.0.1:${port}/`;

  app = await electron.launch({
    args: ["dist-electron/main.cjs"],
    env: { ...process.env, STUDY_VAULT_ROOT: VAULT }
  });
  page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
});

test.afterAll(async () => {
  await app?.close();
  await new Promise<void>((resolve) => fixture.close(() => resolve()));
  await rm(VAULT, { recursive: true, force: true });
});

test("webview: Open Live a URL → embedded <webview> loads it with the guest preload", async () => {
  await page.locator("section.url-import-box input").fill(fixtureUrl);
  await page.locator("section.url-import-box").getByRole("button", { name: "Open Live" }).click();

  // The web_live source becomes active and renders a <webview> for live annotation.
  const webview = page.locator(".webview-host webview");
  await expect(webview).toHaveAttribute("src", fixtureUrl);
  await expect(webview).toHaveAttribute("preload", /webview-preload\.cjs$/);
  // PDF links render in-app via Electron's built-in viewer (plugins enabled).
  await expect(webview).toHaveAttribute("plugins", "");

  // A Chrome-ish nav bar wraps the webview: back/forward/reload + address bar.
  await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Forward" })).toBeVisible();
  // The address bar reflects the loaded URL once navigation settles.
  await expect(page.getByRole("textbox", { name: "Address" })).toHaveValue(fixtureUrl);

  // In-app tabs: one tab open for the live page (link clicks open more — the guest
  // preload reports sv:open-tab; that guest-internal click is verified manually).
  await expect(page.locator(".webview-tab")).toHaveCount(1);
  await expect(page.locator(".webview-tab").first()).toContainText("127.0.0.1");
});
