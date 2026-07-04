import { createServer, type Server } from "node:http";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { openLibraryMenu } from "./helpers";

// WEBPAGE SNAPSHOT flow through the UNIFIED Web viewer (snapshot sub-mode). A saved
// webpage now renders inside the SAME tabbed shell as live web — its first tab is the
// offline study-id snapshot (a DomReader iframe, html_selection anchors), and the
// shell exposes the tab strip + address bar + "Open Live" that live web has.
//
// This asserts BOTH that the unified shell renders for a snapshot AND that the full
// snapshot study flow still works (the html_selection path is unchanged by the merge):
//   1. the unified shell is present (tab strip + Snapshot tab + address bar + Open Live)
//   2. select a passage in the snapshot iframe   → the host "Source" chip fills
//   3. save a Note                                → it appears in the note list
//   4. an html_selection anchor was created       → carrying the quote
//   5. the saved note PAINTS as a highlight       → .sv-annotated in the snapshot iframe
//
// (The LIVE sub-mode needs a real Electron <webview> and is covered by
// e2e-electron/web-snapshot.spec.ts, which also drives snapshot → Open Live → live tab.)

import { SERVER } from "./harness";
const READER = 'iframe[title="Source reader"]';

const SNAPSHOT_TITLE = "Snapshot Lesson";
const PAGE_HTML =
  "<!doctype html><html><head><meta charset='utf-8'><title>" +
  SNAPSHOT_TITLE +
  "</title></head><body><article><section>" +
  "<p>Snapshot paragraph about render threads.</p>" +
  '<a href="/next">next lesson</a>' +
  "</section></article></body></html>";

let fixture: Server;
let fixtureUrl = "";

test.beforeAll(async () => {
  // A local fixture the dev server can fetch+snapshot, so the webpage source is
  // deterministic and offline (never hits the public internet).
  fixture = createServer((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(PAGE_HTML);
  });
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", () => resolve()));
  const address = fixture.address();
  const port = typeof address === "object" && address ? address.port : 0;
  fixtureUrl = `http://127.0.0.1:${port}/lesson`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => fixture.close(() => resolve()));
});

async function seedWebpage(request: APIRequestContext): Promise<{ id: string }> {
  const res = await request.post(`${SERVER}/api/sources/url`, { data: { url: fixtureUrl } });
  expect(res.ok(), `seed webpage failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).source as { id: string };
}

async function saveNote(page: Page, text: string) {
  await page.locator(".composer-mode .mode-tab", { hasText: "Note" }).click();
  await page.locator(".composer-input").fill(text);
  await page.getByRole("button", { name: "Save Note" }).click();
  await expect(page.locator(".note-list")).toContainText(text);
}

// SKIP: manual note-creation composer (select → Save Note) removed in the Growte IA
// rebuild; note-creation UX is a pending product decision.
test.skip("webpage snapshot: unified shell + select → chip → note → html_selection anchor → highlight", async ({ page, request }) => {
  const source = await seedWebpage(request);

  await page.goto("/");
  // Refresh moved into the Library ⋯ menu by the IA rebuild.
  await openLibraryMenu(page);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.locator(".source-item-open", { hasText: SNAPSHOT_TITLE }).first().click();

  // STEP 1 — the UNIFIED Web shell renders for a snapshot: the tab strip with a
  // Snapshot tab, the address bar (reflecting the source url), and the Open Live
  // affordance — the same shell live web uses.
  await expect(page.locator(".webview-tabs .webview-tab")).toHaveCount(1);
  await expect(page.locator(".webview-tab").first()).toContainText("Snapshot");
  await expect(page.getByRole("textbox", { name: "Address" })).toHaveValue(/127\.0\.0\.1/);
  // The nav-bar "Open Live" affordance (scoped — the sidebar import box has one too).
  await expect(page.locator(".webview-nav .webview-go-live")).toBeVisible();

  // The snapshot tab is a DomReader iframe showing the snapshotted content.
  const reader = page.frameLocator(READER);
  await expect(reader.getByText("Snapshot paragraph", { exact: false })).toBeVisible();

  // STEP 2 — selecting in the snapshot iframe fills the host Source chip.
  await reader.getByText("Snapshot paragraph", { exact: false }).click();
  await expect(page.locator(".chat-source")).toContainText("Snapshot paragraph");

  // STEP 3 — save a note.
  await saveNote(page, "Snapshot flow note.");

  // STEP 4 — an html_selection anchor was created carrying the quote (snapshot mode
  // keeps the study-id pipeline; it is NOT a web_text_quote anchor).
  const res = await request.get(`${SERVER}/api/sources/${source.id}/anchors`);
  expect(res.ok()).toBeTruthy();
  const anchors = (await res.json()).anchors as Array<{ anchorKind: string; quote?: string }>;
  const anchor = anchors.find((a) => a.anchorKind === "html_selection");
  expect(anchor, "expected an html_selection anchor for the snapshot").toBeTruthy();
  expect(anchor!.quote).toContain("Snapshot paragraph");

  // STEP 5 — the note paints as an anchored highlight on the snapshot passage.
  const annotated = reader.locator(".sv-annotated").first();
  await expect(annotated).toBeVisible();
  await expect(annotated).toContainText("Snapshot paragraph");
});
