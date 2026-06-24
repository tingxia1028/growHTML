import { rm } from "node:fs/promises";
import path from "node:path";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";

// Drives the real Electron app's AI terminal end to end: toggle terminal → start
// a session → output flows main(PTY)→IPC→preload→renderer→xterm and input flows
// back. Uses the in-process FAKE PTY spawner (STUDY_VAULT_PTY_FAKE=1) so it is
// deterministic and needs no native node-pty / no real CLI. Real claude/codex
// run through the same path with the env flag unset (verified on a machine with
// node-pty built for Electron — `npm run electron:rebuild`).

const VAULT = path.resolve(".e2e-electron-vault-pty");

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  await rm(VAULT, { recursive: true, force: true });
  app = await electron.launch({
    args: ["dist-electron/main.cjs"],
    env: { ...process.env, STUDY_VAULT_ROOT: VAULT, STUDY_VAULT_PTY_FAKE: "1" }
  });
  page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
});

test.afterAll(async () => {
  await app?.close();
  await rm(VAULT, { recursive: true, force: true });
});

test("AI terminal: lives below AI chat, opens a session with a chosen cwd, and closes", async () => {
  // The terminal is a section under AI Chat in the study panel, hidden until shown.
  await expect(page.locator(".terminal-command")).toHaveCount(0);
  await page.locator(".terminal-box").getByRole("button", { name: "Show" }).click();

  // Default command is "claude"; pick a known-existing working directory.
  await expect(page.locator(".terminal-command")).toHaveValue("claude");
  const workdir = path.resolve(".");
  await page.getByRole("textbox", { name: "Working directory" }).fill(workdir);
  await page.getByRole("button", { name: "Start" }).click();

  // The fake spawner echoes the resolved cwd in its ready banner, proving the
  // chosen directory flowed renderer → IPC → bridge (resolveCwd) → spawner.
  await expect(page.locator(".pty-raw")).toContainText("[pty-fake] ready: claude");
  await expect(page.locator(".pty-raw")).toContainText(workdir);

  // Typing into the terminal sends input through the PTY, which the fake echoes.
  await page.keyboard.type("hello-pty");
  await expect(page.locator(".pty-raw")).toContainText("hello-pty");

  // It can be closed again (regression: the terminal used to be un-closable).
  await page.locator(".terminal-box").getByRole("button", { name: "Hide" }).click();
  await expect(page.locator(".terminal-command")).toHaveCount(0);
});
