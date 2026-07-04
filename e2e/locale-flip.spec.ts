import { expect, test, type Page } from "@playwright/test";
// Canonical dict (pure TS): the Library strings — the spec asserts BOTH sides of the
// flip from the same source the product renders, so it self-updates with copy changes.
import { libraryMessages } from "../src/client/workspace/libraryMessages";
import { closeShellModal, openSettings } from "./helpers";

// E2E-LOCALE-001 — the I18N loop end to end (commit 301a190):
//   boot (zh DEFAULT) → Settings modal (SHELL-4: UserMenu → centered modal host) →
//   语言/Language → English → the SAME chrome labels flip LIVE (no reload) → reload
//   with the localStorage mirror cleared → STILL English (PUT /api/workspace/ui-prefs
//   persistence, re-fetched by LocaleBootstrap on boot) → flip back to 中文.
//
// Load-bearing labels (a handful, per surface):
//   • TopBar reading-mode tab — topBarMessages.notesOverlay (TopBar.tsx, module-
//     private dict): zh 笔记叠层 / en Notes Overlay.
//   • Library header — libraryMessages.title (imported above).
//   • Settings modal title — WorkspaceShell modalTitles["settings.hub"] (module-
//     private): zh 设置 / en Settings.
//   • Language section title — settingsMessages.languageSection (SettingsHub.tsx,
//     module-private): zh 语言 / en Language.

import { SERVER } from "./harness";

const overlayTab = (page: Page) => page.locator(".topbar-center .topbar-tab").first();
const libraryTitle = (page: Page) => page.locator(".library-panel .library-title");
const modalTitle = (page: Page) => page.locator(".shell-modal-title");
const languageSection = (page: Page) => page.locator('.settings-hub-section[data-section-id="language"]');

// Flip the app locale through the Settings 语言 radio group and wait for the PUT
// (the write IS the persistence under test — assert it round-trips).
async function chooseLocale(page: Page, locale: "zh" | "en") {
  const saved = page.waitForResponse(
    (res) => res.url().includes("/api/workspace/ui-prefs") && res.request().method() === "PUT"
  );
  await languageSection(page).locator(`input[name="growte-locale"][value="${locale}"]`).check();
  expect((await saved).ok()).toBeTruthy();
}

test("locale flip: zh default → Settings → English (live, no reload) → ui-prefs persists → back to 中文", async ({
  page,
  request
}) => {
  try {
    await page.goto("/");

    // —— boot state: the zh DEFAULT locale renders the chrome in Chinese ——
    await expect(overlayTab(page)).toContainText("笔记叠层"); // topBarMessages.notesOverlay
    await expect(libraryTitle(page)).toHaveText(libraryMessages.title.zh);

    // —— Settings is a SHELL-4 modal: UserMenu → 设置 → centered .shell-modal host ——
    await openSettings(page);
    await expect(modalTitle(page)).toHaveText("设置"); // modalTitles["settings.hub"]
    await expect(languageSection(page).locator(".settings-hub-section-title")).toHaveText("语言"); // settingsMessages.languageSection

    // —— flip to English: the SAME labels re-render LIVE, without a reload ——
    await chooseLocale(page, "en");
    await expect(modalTitle(page)).toHaveText("Settings");
    await expect(languageSection(page).locator(".settings-hub-section-title")).toHaveText("Language");
    await expect(overlayTab(page)).toContainText("Notes Overlay");
    await expect(libraryTitle(page)).toHaveText(libraryMessages.title.en);

    // Close the modal the product way (Esc — closeShellModal).
    await closeShellModal(page);

    // —— persistence: reload must come back English FROM THE SERVER ——
    // Drop the localStorage mirror first, so the reload can only get "en" from
    // GET /api/workspace/ui-prefs (LocaleBootstrap) — not from the local cache.
    await page.evaluate(() => localStorage.removeItem("growte.locale"));
    await page.reload();
    await expect(overlayTab(page)).toContainText("Notes Overlay");
    await expect(libraryTitle(page)).toHaveText(libraryMessages.title.en);

    // —— flip back to 中文 (leaves the suite in the zh default it booted with) ——
    await openSettings(page);
    await chooseLocale(page, "zh");
    await expect(modalTitle(page)).toHaveText("设置");
    await expect(overlayTab(page)).toContainText("笔记叠层");
    await expect(libraryTitle(page)).toHaveText(libraryMessages.title.zh);

    // Close via the backdrop this time (the modal host's other close path).
    await page.locator(".shell-modal-backdrop").click({ position: { x: 8, y: 8 } });
    await expect(page.locator(".shell-modal-dialog")).toHaveCount(0);
  } finally {
    // Safety net: a mid-test failure must NOT leave the shared e2e server on "en" —
    // every other spec selects chrome by the zh default labels.
    await request.put(`${SERVER}/api/workspace/ui-prefs`, { data: { locale: "zh" } }).catch(() => {});
  }
});
