import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { openNotesTab } from "./helpers";
// Canonical zh/en dict for the W1 chat-session switcher (self-updating selectors).
import { chatSessionMessages } from "../src/client/chat/chatSessionMessages";

// AI chat streaming (orchestration base · v1). Drives the real app in web mode
// (deterministic mock provider): open a source, select a passage so the assistant
// has context, ask a question in the composer's "Ask AI" mode. The reply is consumed
// over SSE (`POST /api/chat/stream`) and rendered PROGRESSIVELY. Proves: the stream
// endpoint is used (text/event-stream), the assistant bubble fills in incrementally,
// and the final content is the deterministic mock answer.

import { SERVER } from "./harness";
const READER = 'iframe[title="Source reader"]';
const ASSISTANT = ".chat-log .chat-msg.chat-assistant .note-rendered";

async function seedHtmlSource(request: APIRequestContext, title: string, body: string) {
  const res = await request.post(`${SERVER}/api/sources/html`, { data: { title, content: body } });
  expect(res.ok(), `seed source failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).source as { id: string; title: string };
}

async function openSource(page: Page, title: string) {
  await page.goto("/");
  await page.locator(".source-item-open", { hasText: title }).first().click();
  await expect(page.locator(".reader-tab-title")).toHaveText(title);
}

// W1 chat sessions RESUME on mount (useChatSessions: stored id, else the most recent
// persisted session) — so an EARLIER spec's transcript can legitimately pre-fill this
// page's chat log (loop.spec's "What is this about?" reply did exactly that). Start a
// 新对话 via the session switcher so every bubble-count in the test begins at ZERO.
// (By the time we click, the resume round-trips have long settled — the spec has
// already done several UI interactions since page load.)
async function startFreshConversation(page: Page) {
  await page.getByRole("button", { name: chatSessionMessages.menuLabel.zh, exact: true }).click();
  await page.locator(".panel-menu-popover .chat-session-new").click();
  await expect(page.locator(ASSISTANT)).toHaveCount(0);
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

  // Zero the chat log (a resumed session would offset every count below).
  await startFreshConversation(page);

  // Ask, recording the LAST assistant bubble's text length on EVERY DOM mutation. A
  // MutationObserver fires per React commit regardless of the page's timer budget — the
  // old setTimeout(25)-polling sampler got starved by headless Chromium's background-
  // timer throttling and routinely woke up only AFTER the ~1.8s mock stream had
  // finished, observing a single (final) length. Progressiveness is a REAL-TIME
  // property: when the whole machine stalls mid-suite (event loop frozen while the SSE
  // chunks queue), even the observer sees ONE commit — so the ask is retried a couple
  // of times; at least one attempt must render progressively.
  const question = "What is the key idea here?";
  let positive: number[] = [];
  let observed: number[] = [];
  for (let attempt = 0; attempt < 3 && positive.length < 2; attempt++) {
    await page.evaluate(() => {
      const lengths = new Set<number>();
      (window as unknown as { __svBubbleLengths: Set<number> }).__svBubbleLengths = lengths;
      const record = () => {
        const bubbles = document.querySelectorAll(".chat-log .chat-msg.chat-assistant .note-rendered");
        const el = bubbles[bubbles.length - 1];
        if (el) lengths.add((el.textContent ?? "").length);
      };
      new MutationObserver(record).observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true
      });
    });

    // The streaming endpoint must be the one that answers (not the /api/chat fallback).
    const streamResponse = page.waitForResponse(
      (res) => res.url().includes("/api/chat/stream") && res.status() === 200
    );
    await page.locator(".composer-input").fill(question);
    await page.locator(".composer-input").press("Enter");
    const response = await streamResponse;
    expect(response.headers()["content-type"]).toContain("text/event-stream");

    // THIS attempt's bubble exists (a retry must not be satisfied by the previous
    // attempt's identical completed reply)…
    await expect(page.locator(ASSISTANT)).toHaveCount(attempt + 1, { timeout: 15_000 });
    // …and the final answer is the deterministic mock reply referencing question+quote.
    const assistant = page.locator(ASSISTANT).last();
    await expect(assistant).toContainText("You asked: What is the key idea here?", { timeout: 15_000 });
    await expect(assistant).toContainText("Photosynthesis converts light into chemical energy.");
    // Wait for the request to fully settle (the reply actions re-enable) before
    // reading the observer — and before any retry re-submits the composer.
    await expect(page.locator(".chat-msg.chat-assistant .chat-artifact-add").last()).toBeEnabled({
      timeout: 15_000
    });

    observed = await page.evaluate(() =>
      [...(window as unknown as { __svBubbleLengths: Set<number> }).__svBubbleLengths].sort((a, b) => a - b)
    );
    positive = observed.filter((n) => n > 0);
  }

  // Progressive arrival: some attempt saw at least two distinct (growing) lengths > 0 —
  // the reply filled in across multiple commits rather than landing all at once.
  expect(positive.length, `observed bubble lengths: ${observed.join(",")}`).toBeGreaterThan(1);
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

  // Zero the chat log (run-order independence: `.last()` below must be THIS ask).
  await startFreshConversation(page);

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

  // Activate the Notes tab (selecting the passage focused the anchor, switching the top
  // group to the Anchor tab) and assert a mermaid card (its badge reads "mermaid").
  await openNotesTab(page);
  const mermaidRow = page.locator(".note-list-row", { has: page.locator(".sv-artifact-badge", { hasText: "mermaid" }) });
  await expect(mermaidRow.first()).toBeVisible({ timeout: 15_000 });
});
