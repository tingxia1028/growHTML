import { expect, test } from "@playwright/test";
import { makeTextPdf } from "./fixtures/pdf";

// Click-driven self-test of the full no-AI loop, driving the real running app:
// import → click selection → create anchor → save note → create patch → apply
// → verify rendered change → revert → reload → verify persistence.
//
// Run: npm run e2e   (Playwright boots the real server + client automatically.)

const READER = 'iframe[title="Source reader"]';

test("no-AI study loop: select → anchor → note → patch → apply → revert → persist", async ({ page }) => {
  // Unique per run so the test is independent of any existing vault contents.
  const title = `E2E Loop ${Date.now()}`;
  const sourceHtml = [
    '<article data-study-id="e2e-root">',
    '  <section data-study-id="e2e-section">',
    '    <h1 data-study-id="e2e-title">E2E Source</h1>',
    '    <p data-study-id="e2e-p">Original paragraph for the click self-test.</p>',
    "  </section>",
    "</article>"
  ].join("\n");
  const patchedText = "Patched by the click self-test.";

  await page.goto("/");

  // 1. Import a fresh HTML source via the UI.
  await page.locator("section.import-box input").fill(title);
  await page.locator("section.import-box textarea").fill(sourceHtml);
  await page.locator("section.import-box").getByRole("button", { name: "Import" }).click();

  // Active source header reflects the new source.
  await expect(page.locator(".reader-header h2")).toHaveText(title);

  // 2. Click the paragraph inside the reader iframe → a selection draft that
  // auto-fills the AI Chat "source" chip (no manual anchor step).
  const reader = page.frameLocator(READER);
  await reader.locator('[data-study-id="e2e-p"]').click();
  await expect(page.locator(".chat-source")).toContainText("Original paragraph");

  // 3. Save a manual Note via the merged composer — anchor created lazily.
  const noteText = "Self-test note.";
  const noteList = page.locator(".note-list");
  const patchList = page.locator(".patch-list");
  await page.locator(".composer-input").fill(noteText);
  await page.getByRole("button", { name: "Save Note" }).click();
  await expect(noteList).toContainText(noteText);

  // 4b. NoteLayer overlay: the note paints onto the document as an anchored
  // highlight; hovering it floats a note card (above the content) with the text.
  const annotated = reader.locator('[data-study-id="e2e-p"]');
  await expect(annotated).toHaveClass(/sv-annotated/);
  await annotated.hover();
  const noteCard = reader.locator("#sv-note-card.sv-note-card-show");
  await expect(noteCard).toBeVisible();
  await expect(noteCard).toContainText(noteText);

  // 4c. Rich-form rendering: the note renders to HTML (a <p>), not raw text,
  // and the card is labelled with its content type.
  await expect(noteList.locator(".note-rendered p").first()).toContainText(noteText);
  await expect(noteList.locator(".record-card strong").first()).toContainText("markdown");

  // 5. Create a Patch (replace_selection) — folded under "Edit source (patch)".
  await page.locator(".patch-fold summary").click();
  await page.locator(".patch-input").fill(`<p data-study-id="e2e-p">${patchedText}</p>`);
  await page.getByRole("button", { name: "Create Patch" }).click();
  await expect(patchList).toContainText("pending");

  // 6. Apply → rendered content changes.
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(reader.locator('[data-study-id="e2e-p"]')).toHaveText(patchedText);

  // 7. Revert → original content returns.
  await page.getByRole("button", { name: "Revert" }).click();
  await expect(reader.locator('[data-study-id="e2e-p"]')).toContainText("Original paragraph");

  // 8. Reload → re-open the same source → Note persisted, Patch reverted (not applied).
  await page.reload();
  await page.getByRole("button", { name: title }).click();
  await expect(page.locator(".note-list")).toContainText(noteText);
  await expect(reader.locator('[data-study-id="e2e-p"]')).toContainText("Original paragraph");
  // NoteLayer overlay survives reload.
  await expect(reader.locator('[data-study-id="e2e-p"]')).toHaveClass(/sv-annotated/);
});

test("rich note form: a flashcard note renders as a flip card", async ({ page }) => {
  const title = `E2E Rich ${Date.now()}`;
  const sourceHtml = [
    '<article data-study-id="rich-root">',
    '  <p data-study-id="rich-p">Anchor target for a rich-form note.</p>',
    "</article>"
  ].join("\n");

  await page.goto("/");
  await page.locator("section.import-box input").fill(title);
  await page.locator("section.import-box textarea").fill(sourceHtml);
  await page.locator("section.import-box").getByRole("button", { name: "Import" }).click();
  await expect(page.locator(".reader-header h2")).toHaveText(title);

  await page.frameLocator('iframe[title="Source reader"]').locator('[data-study-id="rich-p"]').click();

  // Compose a flashcard note in the merged composer: pick the type, enter JSON.
  // The anchor is created lazily on Save (no manual anchor step).
  await page.locator("select.note-type-select").selectOption("flashcard");
  await page.locator(".composer-input").fill(JSON.stringify({ front: "What is a Patch?", back: "A reviewable edit." }));
  await page.getByRole("button", { name: "Save Note" }).click();

  // It renders as a flip card (front in <summary>, content type label shown).
  const card = page.locator(".note-list .record-card").first();
  await expect(card.locator("strong")).toContainText("flashcard");
  await expect(card.locator(".sv-flashcard summary")).toHaveText("What is a Patch?");
});

test("AI chat: ask about a passage → reply → save reply as a note", async ({ page }) => {
  const title = `E2E AI ${Date.now()}`;
  const sourceHtml = [
    '<article data-study-id="ai-root">',
    '  <p data-study-id="ai-p">A passage about render threads and study notes.</p>',
    "</article>"
  ].join("\n");

  await page.goto("/");
  await page.locator("section.import-box input").fill(title);
  await page.locator("section.import-box textarea").fill(sourceHtml);
  await page.locator("section.import-box").getByRole("button", { name: "Import" }).click();
  await expect(page.locator(".reader-header h2")).toHaveText(title);

  // Select a passage → it auto-fills the AI Chat "source" chip.
  await page.frameLocator('iframe[title="Source reader"]').locator('[data-study-id="ai-p"]').click();
  await expect(page.locator(".chat-source")).toContainText("render threads");

  // Ask the assistant (deterministic mock provider in the e2e server).
  const chat = page.locator(".chat-box");
  await page.locator(".composer-input").fill("What is this about?");
  await chat.getByRole("button", { name: "Send" }).click();

  // The reply renders and echoes the question + the selected passage.
  const assistant = chat.locator(".chat-assistant").first();
  await expect(assistant).toContainText("What is this about?");
  await expect(assistant).toContainText("render threads");

  // Save the reply as a note → it appears in the note list, rendered as HTML.
  await assistant.getByRole("button", { name: "Save full reply" }).click();
  await expect(page.locator(".note-list")).toContainText("Study assistant");
});

test("rich note form: a mermaid note renders an SVG diagram", async ({ page }) => {
  const title = `E2E Mermaid ${Date.now()}`;
  const sourceHtml = '<article data-study-id="mm-root"><p data-study-id="mm-p">Anchor for a mermaid note.</p></article>';

  await page.goto("/");
  await page.locator("section.import-box input").fill(title);
  await page.locator("section.import-box textarea").fill(sourceHtml);
  await page.locator("section.import-box").getByRole("button", { name: "Import" }).click();
  await expect(page.locator(".reader-header h2")).toHaveText(title);

  await page.frameLocator('iframe[title="Source reader"]').locator('[data-study-id="mm-p"]').click();

  await page.locator("select.note-type-select").selectOption("mermaid");
  await page.locator(".composer-input").fill("graph TD; A[Start] --> B[Done]");
  await page.getByRole("button", { name: "Save Note" }).click();

  // mermaid renders an <svg> into the diagram container.
  const card = page.locator(".note-list .record-card").first();
  await expect(card.locator("strong")).toContainText("mermaid");
  await expect(card.locator(".note-diagram-mermaid svg")).toBeVisible({ timeout: 15_000 });
});

test("open a local PDF: PDF.js text layer → select → anchor → note → highlight", async ({ page }) => {
  await page.goto("/");

  const pdfText = "Render thread submits commands.";
  await page.locator('.pdf-import-box input[type="file"]').setInputFiles({
    name: "sample.pdf",
    mimeType: "application/pdf",
    buffer: makeTextPdf(pdfText)
  });

  // The PDF source becomes active and PDF.js renders a selectable text layer.
  await expect(page.locator(".reader-header h2")).toHaveText("sample");
  const textLayer = page.locator(".pdf-reader-canvas .pdf-page .textLayer");
  await expect(textLayer.first()).toContainText("Render thread", { timeout: 15_000 });

  // Select the rendered text → a pdf selection draft appears.
  const span = page.locator(".pdf-reader-canvas .textLayer span", { hasText: "Render thread" }).first();
  await span.selectText();
  await page.locator(".pdf-reader-canvas").dispatchEvent("mouseup");
  await expect(page.locator(".chat-source")).toContainText("Render thread");

  // Note bound to the PDF passage — anchor created lazily on Save.
  await page.locator(".composer-input").fill("PDF note.");
  await page.getByRole("button", { name: "Save Note" }).click();
  await expect(page.locator(".note-list")).toContainText("PDF note.");

  // The anchored passage is highlighted in the text layer, and hovering it floats
  // the SAME shared note card the HTML reader uses (decoupled presentation layer).
  const pdfHit = page.locator(".pdf-reader-canvas .textLayer .pdf-anchor-hit").first();
  await expect(pdfHit).toBeVisible();
  await pdfHit.hover();
  const pdfCard = page.locator("#sv-note-card.sv-note-card-show");
  await expect(pdfCard).toBeVisible();
  await expect(pdfCard).toContainText("PDF note.");
});
