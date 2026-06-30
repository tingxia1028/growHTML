import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// AI chat streaming (orchestration base · v1). Drives the real app in web mode
// (deterministic mock provider): open a source, select a passage so the assistant
// has context, ask a question in the composer's "Ask AI" mode. The reply is consumed
// over SSE (`POST /api/chat/stream`) and rendered PROGRESSIVELY. Proves: the stream
// endpoint is used (text/event-stream), the assistant bubble fills in incrementally,
// and the final content is the deterministic mock answer.

const SERVER = "http://127.0.0.1:4177";
const READER = 'iframe[title="Source reader"]';
const ASSISTANT = ".chat-log .chat-msg.chat-assistant .note-rendered";

async function seedHtmlSource(request: APIRequestContext, title: string, body: string) {
  const res = await request.post(`${SERVER}/api/sources/html`, { data: { title, content: body } });
  expect(res.ok(), `seed source failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).source as { id: string; title: string };
}

async function openSource(page: Page, title: string) {
  await page.goto("/");
  await page.locator(".source-item-open", { hasText: title }).click();
  await expect(page.locator(".reader-tab-title")).toHaveText(title);
}

test("ask AI: reply streams in progressively over SSE with a deterministic final answer", async ({ page, request }) => {
  const title = `Streaming Chat ${Date.now()}`;
  const body = "<article><section><p>Photosynthesis converts light into chemical energy.</p></section></article>";
  await seedHtmlSource(request, title, body);
  await openSource(page, title);

  // Select the passage → focuses it (the Anchor pane shows the quote) so the mock weaves
  // it into the reply. The old `.chat-source` chip was removed in the Growte IA rebuild;
  // the focused passage now surfaces in the Anchor excerpt.
  const reader = page.frameLocator(READER);
  await reader.getByText("Photosynthesis converts", { exact: false }).click();
  await expect(page.locator(".anchor-excerpt-quote")).toContainText("Photosynthesis");

  // The streaming endpoint must be the one that answers (not the /api/chat fallback).
  const streamResponse = page.waitForResponse(
    (res) => res.url().includes("/api/chat/stream") && res.status() === 200
  );

  // Ask a question in the default "Ask AI" composer mode.
  const question = "What is the key idea here?";
  await page.locator(".composer-input").fill(question);

  // Sample the assistant bubble's text length over the streaming window. With the
  // mock's per-chunk delay (set in playwright.config), this captures several growing
  // lengths, proving the reply arrives in pieces rather than all at once.
  const sampler = page.evaluate(async () => {
    const lengths = new Set<number>();
    const start = performance.now();
    while (performance.now() - start < 2500) {
      const el = document.querySelector(".chat-log .chat-msg.chat-assistant .note-rendered");
      if (el) lengths.add((el.textContent ?? "").length);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return [...lengths].sort((a, b) => a - b);
  });

  await page.locator(".composer-input").press("Enter");

  const response = await streamResponse;
  expect(response.headers()["content-type"]).toContain("text/event-stream");

  // Final answer is the deterministic mock reply referencing the question + quote.
  const assistant = page.locator(ASSISTANT).last();
  await expect(assistant).toContainText("You asked: What is the key idea here?", { timeout: 15_000 });
  await expect(assistant).toContainText("Photosynthesis converts light into chemical energy.");

  // Progressive arrival: we observed at least two distinct (growing) lengths > 0.
  const lengths = await sampler;
  const positive = lengths.filter((n) => n > 0);
  expect(positive.length, `observed bubble lengths: ${lengths.join(",")}`).toBeGreaterThan(1);
});

// Adaptive note forms (Phase 1a): the chat reply's "Add as note" action routes the text
// through classifyContent and DETECTS the form — NOT a hardcoded markdown note. Here the
// reply contains a bare mermaid diagram source; selecting it and clicking "Add as note"
// (the §10 chat-artifact action, which respects the window selection) must yield a
// `mermaid` note, not markdown. The mock provider is deterministic (the reply echoes the
// asked question verbatim). Old→new: the removed "Save selection as note" + generation-
// preview path is replaced by the chat card's `.chat-artifact-add`, landing the note in
// the right-sidebar NoteListPanel.
test("save a chat reply: a mermaid block is detected and saved as a `mermaid` note (not markdown)", async ({
  page,
  request
}) => {
  const title = `Classify Save ${Date.now()}`;
  const body = "<article><section><p>Cellular respiration releases energy from glucose.</p></section></article>";
  await seedHtmlSource(request, title, body);
  await openSource(page, title);

  // Select a passage so the assistant has context (and so the saved note can anchor).
  const reader = page.frameLocator(READER);
  await reader.getByText("Cellular respiration", { exact: false }).click();
  await expect(page.locator(".anchor-excerpt-quote")).toContainText("Cellular respiration");

  // Ask a question that IS a bare mermaid source. The mock echoes it verbatim as
  // "You asked: flowchart LR; Start --> End", so that exact diagram text appears in
  // the rendered reply for us to select.
  const diagram = "flowchart LR; Start --> End";
  await page.locator(".composer-input").fill(diagram);
  await page.locator(".composer-input").press("Enter");

  const assistant = page.locator(ASSISTANT).last();
  await expect(assistant).toContainText(`You asked: ${diagram}`, { timeout: 15_000 });

  // Wait for streaming to FINISH so the reply's "Add as note" is enabled (it's disabled
  // while a request is in flight) — otherwise the click is a no-op and nothing saves.
  const addBtn = page.locator(".chat-msg.chat-assistant .chat-artifact-add").last();
  await expect(addBtn).toBeEnabled({ timeout: 15_000 });

  // Select EXACTLY the mermaid source within the rendered reply AND fire "Add as note"
  // in the SAME synchronous step, so the window selection is intact when the click
  // handler reads it (`addReplyAsNote`/`selectedTextOr`). A Playwright .click() between
  // setting and reading the selection can collapse it in headless Chromium.
  await page.evaluate((needle) => {
    const msgs = document.querySelectorAll(".chat-log .chat-msg.chat-assistant");
    const msg = msgs[msgs.length - 1];
    const root = msg?.querySelector(".note-rendered");
    if (!root) throw new Error("assistant reply not found");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    let selected = false;
    while ((node = walker.nextNode())) {
      const text = node.textContent ?? "";
      const idx = text.indexOf(needle);
      if (idx >= 0) {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + needle.length);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);
        selected = true;
        break;
      }
    }
    if (!selected) throw new Error("mermaid source text node not found");
    // Click the reply's "Add as note" synchronously while the selection is live →
    // classifies the SELECTION → creates a `mermaid` note (no preview gate).
    const addBtn = msg.querySelector(".chat-artifact-add") as HTMLButtonElement | null;
    if (!addBtn) throw new Error("Add as note button not found");
    addBtn.click();
  }, diagram);

  // Expand the Notes fold and assert a mermaid card (its type badge reads "mermaid",
  // not "markdown").
  const head = page.locator(".note-list-head");
  await expect(head).toBeVisible();
  if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
  const mermaidRow = page.locator(".note-list-row", { has: page.locator(".sv-artifact-badge", { hasText: "mermaid" }) });
  await expect(mermaidRow.first()).toBeVisible({ timeout: 15_000 });
});
