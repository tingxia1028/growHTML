import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _electron as electron, expect, type ElectronApplication, type Page } from "@playwright/test";
import { openRightTab } from "../e2e/helpers";

// E2E-ELECTRON-001 harness — the single source of truth for how the Electron e2e
// suite boots the desktop app. Mirrors the web suite's e2e/harness.ts ephemeral-vault
// pattern (E2E-DEBT-001): ONE per-run OS-temp root, pid-stamped, published via env so
// the Playwright main process (config → globalSetup/teardown) and the worker process
// (which re-evaluates this module under a different pid) agree on the same directory.
// Each spec file launches its OWN app instance on its OWN subdirectory vault, so no
// repo-side vault dir ever exists and test seed data can never touch data/vault.
//
// The prefix deliberately differs from the web harness's `growte-e2e-vault-` so the
// two suites' stale-sweep logic (each sweeps only its own prefix) can never delete
// the other suite's live vault when both run side by side.
export const E2E_ELECTRON_VAULT_ROOT =
  process.env.GROWTE_E2E_ELECTRON_VAULT_ROOT ??
  path.join(os.tmpdir(), `growte-e2e-electron-vault-${process.pid}`);
process.env.GROWTE_E2E_ELECTRON_VAULT_ROOT = E2E_ELECTRON_VAULT_ROOT;

export type LaunchedApp = { app: ElectronApplication; page: Page; vaultDir: string };

/**
 * Launch the dev-built desktop app (dist-electron/main.cjs — its in-process server +
 * served client) on a fresh vault at `<run-root>/<specKey>`. The env it gets:
 *   - STUDY_VAULT_ROOT      → the per-spec temp vault (openVault resolves it first;
 *                             see electron/shell.ts resolveVaultRoot).
 *   - ELECTRON_DEV=0        → NEVER the dev-server path: dev mode would point the
 *                             window at the user's live Vite/API session (and its
 *                             REAL vault) instead of booting our own server.
 *   - STUDY_VAULT_AI_PROVIDER=mock → deterministic replies; a local .env may pin a
 *                             real provider for dev, but dotenv never overrides env
 *                             that is already set.
 *   - STUDY_VAULT_AUTO_BACKUP=0 + STUDY_VAULT_TRASH_AUTO_PURGE=0 → the TRUST-1/3
 *                             schedulers stay disarmed on the throwaway vault.
 * Resolves once today's shell has actually booted (the Library panel is the R1 boot
 * gate — the old `.brand-block h1 == "Sources"` gate died with the pre-R1 shell).
 */
export async function launchApp(
  specKey: string,
  extraEnv: Record<string, string> = {}
): Promise<LaunchedApp> {
  const vaultDir = path.join(E2E_ELECTRON_VAULT_ROOT, specKey);
  await rm(vaultDir, { recursive: true, force: true });
  await mkdir(vaultDir, { recursive: true });

  const app = await electron.launch({
    args: ["dist-electron/main.cjs"],
    env: {
      ...(process.env as Record<string, string>),
      ELECTRON_DEV: "0",
      STUDY_VAULT_ROOT: vaultDir,
      STUDY_VAULT_AI_PROVIDER: "mock",
      STUDY_VAULT_MOCK_STREAM_DELAY_MS: "20",
      STUDY_VAULT_AUTO_BACKUP: "0",
      STUDY_VAULT_TRASH_AUTO_PURGE: "0",
      ...extraEnv
    }
  });
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  // The in-process server binds port 0 (a fresh ephemeral port per run), so the
  // window's origin — and therefore localStorage — is empty every launch: no layout/
  // collapse state can leak in from the user's dev session (5173) or a previous run.
  await expect(page.locator(".library-panel")).toBeVisible({ timeout: 20_000 });
  // SHELL-2 first-run onboarding: a FRESH vault (0 sources + pristine onboarding
  // state) always swaps the CENTER slot to the 新手引导 checklist — which is exactly
  // every launch here. Dismiss it the way a user would (跳过引导 persists
  // dismissed:true to the vault) so the reader slot is available to the specs. The
  // web suite never sees this because it seeds sources BEFORE page.goto().
  const skipOnboarding = page.getByRole("button", { name: "跳过引导" });
  await expect(skipOnboarding).toBeVisible({ timeout: 10_000 });
  await skipOnboarding.click();
  await expect(skipOnboarding).toHaveCount(0);
  return { app, page, vaultDir };
}

/** Close the app instance THIS run spawned (never touches the user's dev client). */
export async function closeApp(handle: LaunchedApp | undefined): Promise<void> {
  await handle?.app.close();
}

// —— shared UI/seeding helpers (today's shell — R1 topbar + LIB-2 Library) ————————

/** Seed an imported-HTML source through the in-process API (no paste box in the UI). */
export async function seedHtmlSource(page: Page, title: string, content: string): Promise<string> {
  return page.evaluate(
    async ({ t, c }) => {
      const res = await fetch("/api/sources/html", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: t, content: c })
      });
      if (!res.ok) throw new Error(`seed html failed: ${res.status}`);
      return (await res.json()).source.id as string;
    },
    { t: title, c: content }
  );
}

/** Seed a local-file source (the same API the 文件… picker lands on). */
export async function seedLocalFileSource(
  page: Page,
  filePath: string
): Promise<{ id: string; title: string }> {
  return page.evaluate(async (p) => {
    const res = await fetch("/api/sources/local-file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: p })
    });
    if (!res.ok) throw new Error(`seed local file failed: ${res.status}`);
    const source = (await res.json()).source as { id: string; title: string };
    return { id: source.id, title: source.title };
  }, filePath);
}

/**
 * Refresh the Library (the top-level "Refresh" button became the header's subtle
 * refresh ICON in LIB-2) and open a seeded source by its TITLE — the row's visible
 * text is the title (the id rides only the row's tooltip now), and a source can
 * appear in both the 最近 and 文档 sections, hence `.first()`. Callers keep titles
 * unique per run (Date.now suffixes / distinct fixture file names).
 */
export async function openSourceByTitle(page: Page, title: string): Promise<void> {
  await page.locator(".library-panel .library-icon-btn").click();
  await page.locator(".source-item-open").filter({ hasText: title }).first().click();
}

/** Fetch the stored anchors for a source from the HOST (same API the UI uses). */
export async function fetchAnchors(
  page: Page,
  sourceId: string
): Promise<Array<{ anchorKind: string; normalizedUrl?: string; quote?: string }>> {
  return page.evaluate(async (id) => {
    const res = await fetch(`/api/sources/${id}/anchors`);
    return (await res.json()).anchors as Array<{
      anchorKind: string;
      normalizedUrl?: string;
      quote?: string;
    }>;
  }, sourceId);
}

/**
 * Ask the (mock) AI via today's ONE composer — the right-panel composer is AI-only
 * now ("Type / for commands"; the old Note/Ask mode tabs are gone). Waits for the
 * deterministic mock reply and returns its bubble locator.
 */
export async function askAi(page: Page, question: string) {
  await page.locator(".composer-input").fill(question);
  await page.locator(".composer-input").press("Enter");
  const assistant = page.locator(".chat-log .chat-msg.chat-assistant .note-rendered").last();
  await expect(assistant).toContainText(`You asked: ${question}`, { timeout: 20_000 });
  return assistant;
}

/**
 * Keep the last assistant reply as a note (the §10 chat-artifact "Add as note"
 * action). This is today's UI path that MATERIALIZES the focused selection draft
 * into a real anchor — the old select → "Save Note" composer flow was removed.
 */
export async function addLastReplyAsNote(page: Page): Promise<void> {
  const addBtn = page.locator(".chat-msg.chat-assistant .chat-artifact-add").last();
  await expect(addBtn).toBeEnabled({ timeout: 15_000 });
  await addBtn.click();
}

/**
 * Drive a REAL text selection inside a guest <webview> via executeJavaScript: build a
 * Range over #para, set the selection, and dispatch a bubbling mouseup so the guest
 * preload's reportSelection fires. Returns whether the guest really selected text.
 */
export async function selectInGuest(page: Page, webviewSelector: string): Promise<boolean> {
  return page
    .evaluate(async (sel) => {
      const view = document.querySelector(sel) as
        | (HTMLElement & { executeJavaScript: (code: string) => Promise<unknown> })
        | null;
      if (!view) return false;
      const result = await view.executeJavaScript(
        "(function(){" +
          "var p=document.getElementById('para');" +
          "if(!p) return '';" +
          "var r=document.createRange();r.selectNodeContents(p);" +
          "var s=window.getSelection();s.removeAllRanges();s.addRange(r);" +
          "var picked=s.toString();" +
          "p.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));" +
          "document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));" +
          "return picked;})()"
      );
      return typeof result === "string" && result.length > 0;
    }, webviewSelector)
    .catch(() => false);
}

/**
 * Drive the guest selection repeatedly until the HOST reflects it. The `.chat-source`
 * chip is gone (Growte IA rebuild); the focused passage now surfaces in the right
 * sidebar's Anchor tab as `.anchor-excerpt-quote` (the default-active tab). Retrying
 * absorbs the guest still loading (#para absent) or a dropped mouseup while the guest
 * attaches — the excerpt filling is the authoritative proof that the guest preload →
 * sv:selection → host focus wiring works for this surface.
 */
export async function selectUntilFocused(
  page: Page,
  webviewSelector: string,
  expectText: string
): Promise<void> {
  // Wait out any in-flight source load first: loadSourceData runs focus.clear()
  // when it settles, so a draft set while the load is still resolving gets WIPED a
  // moment later (a real race — the guest can report a selection faster than the
  // host finishes its anchors/notes/patches fetches). The chat title's status dot
  // reflects the shared workspace status; idle = the load (and its clear) is done.
  await expect(page.locator(".workspace-status-dot.status-idle")).toBeVisible({ timeout: 15_000 });
  // The top tab group may sit on Notes (focusing a saved note auto-switches it);
  // make sure the Anchor sub-page is showing before polling its excerpt.
  await openRightTab(page, "Anchor", ".anchor-panel");
  const excerpt = page.locator(".anchor-excerpt-quote");
  // Reset any lingering focus first (⋯ → Clear anchor): a previous test's focused
  // anchor may carry the SAME passage text, and a stale excerpt would satisfy the
  // poll below without the guest selection ever reaching the host.
  if (await excerpt.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "Anchor actions", exact: true }).click();
    await page.locator(".panel-menu-popover").getByRole("button", { name: "Clear anchor" }).click();
    await expect(excerpt).toHaveCount(0);
  }
  await expect
    .poll(
      async () => {
        await selectInGuest(page, webviewSelector);
        return excerpt.textContent({ timeout: 1000 }).catch(() => "");
      },
      { timeout: 20_000, message: "the Anchor excerpt should reflect the guest selection" }
    )
    .toContain(expectText);
}
