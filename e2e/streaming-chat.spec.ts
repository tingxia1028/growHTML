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
  await expect(page.locator(".reader-header h2")).toHaveText(title);
}

test("ask AI: reply streams in progressively over SSE with a deterministic final answer", async ({ page, request }) => {
  const title = `Streaming Chat ${Date.now()}`;
  const body = "<article><section><p>Photosynthesis converts light into chemical energy.</p></section></article>";
  await seedHtmlSource(request, title, body);
  await openSource(page, title);

  // Select the passage → fills the source chip so the mock weaves the quote in.
  const reader = page.frameLocator(READER);
  await reader.getByText("Photosynthesis converts", { exact: false }).click();
  await expect(page.locator(".chat-source")).toContainText("Photosynthesis");

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
