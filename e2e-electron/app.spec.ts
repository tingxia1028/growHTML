import { expect, test, type Page } from "@playwright/test";
import { openNotesTab, RIGHT_TAB_LABELS } from "../e2e/helpers";
import {
  addLastReplyAsNote,
  askAi,
  closeApp,
  fetchAnchors,
  launchApp,
  openSourceByTitle,
  seedHtmlSource,
  type LaunchedApp
} from "./harness";

// Drives the REAL Electron desktop app (its in-process server + served client), not
// the dev web server. Proves the desktop shell works end to end against TODAY'S UI
// (E2E-ELECTRON-001 modernization — the pre-R1 flow this spec used to drive is gone:
// no `.brand-block` boot gate, no top-level Refresh, no `.chat-source` chip, no
// Note-mode composer):
//   boot → R1 chrome → seed HTML → open → select → Anchor excerpt → ask AI (mock,
//   streamed) → "Add as note" (materializes the anchor) → note in Notes tab →
//   html_selection anchor stored → on-document `.sv-annotated` highlight.
//
// Run: npm run e2e:electron   (builds client + bundles main/preload first).

let handle: LaunchedApp;
let page: Page;

test.beforeAll(async () => {
  handle = await launchApp("app");
  page = handle.page;
});

test.afterAll(async () => {
  await closeApp(handle);
});

test("desktop shell boots today's chrome: R1 topbar (2 tabs) + LIB-2 Library + right tabs + AI chat", async () => {
  // TopBar — the center segmented control is exactly 笔记叠层 (Notes Overlay) +
  // 锚点聚焦 (Anchor Focus). zh default locale (I18N); TopBar.tsx topBarMessages is
  // module-private, hence the zh literals.
  const tabs = page.locator(".topbar-center .topbar-tab");
  await expect(tabs).toHaveCount(2);
  await expect(tabs.nth(0)).toContainText("笔记叠层");
  await expect(tabs.nth(1)).toContainText("锚点聚焦");

  // LIB-2 Library — the three core sections render; the old kebab never resurfaces.
  for (const id of ["core.recent", "core.documents", "core.folders"]) {
    await expect(page.locator(`.library-section[data-section-id="${id}"]`)).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Library actions" })).toHaveCount(0);

  // Right sidebar — the tabbed panel (锚点/Anchor default) + AI Chat in the bottom split.
  await expect(page.locator(".right-tabs-tab", { hasText: RIGHT_TAB_LABELS.anchor })).toBeVisible();
  await expect(page.locator(".chat-box")).toBeVisible();
});

test("desktop study loop: seed → open → select → ask AI → add reply as note → anchored highlight", async () => {
  const title = `Desktop ${Date.now()}`;
  const body = "<article><section><p>Desktop self-test paragraph about render threads.</p></section></article>";

  // Seed via the in-process API (no paste box in the current UI), then open it from
  // the Library (refresh icon — the top-level "Refresh" button is gone).
  const sourceId = await seedHtmlSource(page, title, body);
  await openSourceByTitle(page, title);
  await expect(page.locator(".reader-tab-title")).toHaveText(title);

  // Select a passage inside the reader iframe → the focused draft surfaces in the
  // right sidebar's Anchor tab (the `.chat-source` chip died with the IA rebuild).
  const reader = page.frameLocator('iframe[title="Source reader"]');
  await reader.getByText("render threads", { exact: false }).click();
  await expect(page.locator(".anchor-excerpt-quote")).toContainText("render threads");

  // AI chat round-trip via the mock provider (streamed over SSE): the deterministic
  // reply echoes the question and weaves in the focused passage.
  const assistant = await askAi(page, "Summarize this.");
  await expect(assistant).toContainText("render threads");

  // Keep the reply as a note — today's UI path that lazily MATERIALIZES the focused
  // selection into a real anchor (the old select → "Save Note" composer is gone).
  await addLastReplyAsNote(page);

  // The note lands in the right sidebar's Notes tab (the preview card clamps long
  // content, so assert the reply's HEAD line rather than the mid-reply echo).
  await openNotesTab(page);
  await expect(page.locator(".note-list-panel-tab .note-list-row").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".note-list-panel-tab")).toContainText("Study assistant (mock)");

  // The anchor was actually created (html_selection carrying the quote)…
  const anchors = await fetchAnchors(page, sourceId);
  const anchor = anchors.find((a) => a.anchorKind === "html_selection");
  expect(anchor, "expected an html_selection anchor from the materialized draft").toBeTruthy();
  expect(anchor!.quote).toContain("render threads");

  // …and paints onto the document as an anchored highlight.
  await expect(reader.locator(".sv-annotated").first()).toBeVisible();
});
