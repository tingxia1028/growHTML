import { createServer, type Server } from "node:http";
import { expect, test, type Page } from "@playwright/test";
import { openLibraryMenu } from "../e2e/helpers";
import { closeApp, launchApp, type LaunchedApp } from "./harness";

// Drives the real Electron app's live-web annotation path through TODAY'S entry
// point: the old `section.url-import-box` sidebar block became the LIB-2 Library `+`
// menu's 网页 action (inline URL input + 抓取网页/实时打开). 实时打开 → a web_live
// source → the reader embeds an <webview> loading that live page with the
// selection-capture guest preload attached. A local fixture HTTP server keeps it
// deterministic and offline.

let fixture: Server;
let fixtureUrl = "";
let handle: LaunchedApp;
let page: Page;

test.beforeAll(async () => {
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

  handle = await launchApp("webview");
  page = handle.page;
});

test.afterAll(async () => {
  await closeApp(handle);
  await new Promise<void>((resolve) => fixture.close(() => resolve()));
});

test("webview: Library + → 网页 → 实时打开 → embedded <webview> loads it with the guest preload", async () => {
  await openLibraryMenu(page);
  await page.locator(".library-add-web .panel-menu-input").fill(fixtureUrl);
  await page.locator(".library-add-web").getByRole("button", { name: "实时打开" }).click();

  // The web_live source becomes active and renders a <webview> for live annotation.
  const webview = page.locator(".webview-host webview");
  await expect(webview).toHaveAttribute("src", fixtureUrl);
  await expect(webview).toHaveAttribute("preload", /webview-preload\.cjs$/);
  // PDF links render in-app via Electron's built-in viewer (plugins enabled).
  await expect(webview).toHaveAttribute("plugins", "");

  // A Chrome-ish nav bar wraps the webview: back/forward/reload + address bar.
  // (exact: the right sidebar's "Merge AI Chat back into tabs" also substring-matches "Back")
  await expect(page.getByRole("button", { name: "Back", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Forward", exact: true })).toBeVisible();
  // The address bar reflects the loaded URL once navigation settles.
  await expect(page.getByRole("textbox", { name: "Address" })).toHaveValue(fixtureUrl);

  // In-app tabs: one tab open for the live page (link clicks open more — the guest
  // preload reports sv:open-tab; that guest-internal click is verified manually).
  await expect(page.locator(".webview-tab")).toHaveCount(1);
  await expect(page.locator(".webview-tab").first()).toContainText("127.0.0.1");
});
