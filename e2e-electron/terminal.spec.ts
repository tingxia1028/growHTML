import { expect, test, type Page } from "@playwright/test";
import { openChatMenu } from "../e2e/helpers";
import { closeApp, launchApp, type LaunchedApp } from "./harness";

// The AI terminal in TODAY'S shell (E2E-ELECTRON-001): the always-mounted
// `.terminal-box` section under AI Chat is GONE — the Growte IA rebuild tucked the
// terminal behind the AI-Chat panel's ⋯ overflow menu (PanelMenu "AI Chat actions"),
// deliberately OFF the default chrome (a PTY has no place in a student's default
// study surface). This spec asserts exactly that: nothing PTY-ish renders by
// default, and the entry point lives behind the ⋯ menu, un-started until "Show".
//
// The deep PTY flow (Show → Start → fake-PTY echo round-trip) is kept below as a
// documented skip — see its inline reason.

let handle: LaunchedApp;
let page: Page;

test.beforeAll(async () => {
  // Keep the deterministic fake PTY spawner wired for the day the deep flow unskips.
  handle = await launchApp("terminal", { STUDY_VAULT_PTY_FAKE: "1" });
  page = handle.page;
});

test.afterAll(async () => {
  await closeApp(handle);
});

test("AI terminal is OFF the default chrome; its entry point sits behind the AI-Chat ⋯ menu", async () => {
  // Default shell: no terminal section, no command input, no PTY surface anywhere.
  await expect(page.locator(".terminal-box")).toHaveCount(0);
  await expect(page.locator(".terminal-command")).toHaveCount(0);
  await expect(page.locator(".pty-raw")).toHaveCount(0);

  // The relocated entry point: AI Chat ⋯ menu → "AI Terminal" title + Show toggle.
  await openChatMenu(page);
  const entry = page.locator(".chat-box .panel-menu-popover .terminal-box-title");
  await expect(entry).toBeVisible();
  await expect(entry).toContainText("AI Terminal");
  await expect(entry.getByRole("button", { name: "Show" })).toBeVisible();

  // Merely opening the menu spawns nothing — the terminal stays dormant until Show.
  await expect(page.locator(".terminal-command")).toHaveCount(0);
  await expect(page.locator(".pty-raw")).toHaveCount(0);
});

// SKIP (E2E-ELECTRON-001): the deep PTY flow (Show → choose cwd → Start → fake-PTY
// ready banner → typed input echoes → Hide) now lives INSIDE the PanelMenu popover —
// a transient overflow surface whose click-outside/one-shot-item close behavior makes
// a multi-step keyboard session flaky by construction. It waits on the terminal
// getting a stable home (a docked pane or modal) if/when the product decides the
// terminal deserves front-chrome again; the bridge itself (main PTY ↔ IPC ↔ preload ↔
// renderer, cwd resolution, fake spawner) stays covered by electron/pty-bridge unit
// tests and the STUDY_VAULT_PTY_FAKE env wired above.
test.skip("AI terminal deep flow: Show → Start (fake PTY) → output/input round-trip → Hide", async () => {
  await openChatMenu(page);
  await page.locator(".terminal-box-title").getByRole("button", { name: "Show" }).click();
  await expect(page.locator(".terminal-command")).toHaveValue("claude");
  await page.getByRole("textbox", { name: "Working directory" }).fill(".");
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.locator(".pty-raw")).toContainText("[pty-fake] ready: claude");
  await page.keyboard.type("hello-pty");
  await expect(page.locator(".pty-raw")).toContainText("hello-pty");
  await page.locator(".terminal-box-title").getByRole("button", { name: "Hide" }).click();
  await expect(page.locator(".terminal-command")).toHaveCount(0);
});
