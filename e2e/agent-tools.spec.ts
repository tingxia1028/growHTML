import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
// Canonical zh dict for the W1 chat-session switcher (self-updating selectors).
import { chatSessionMessages } from "../src/client/chat/chatSessionMessages";
import { MOCK_AGENT_FINAL_ANSWER } from "../src/ai";
import { SERVER } from "./harness";

// A4b agent loop (docs/implementation/a4b-build-spec.md): with a tools-capable provider
// (the whole suite is pinned to `mock-agent`), the chat panel shows a capability-gated
// 🛠 用工具 button. Clicking it runs ONE tool-calling turn — the client renders a
// tool-call CARD (search_notes) + its result, then the deterministic final answer
// persists as a normal assistant bubble (the render-only transcript clears). Drives the
// real app in web mode against the offline mock-agent (no SDK, no network): the scripted
// runAgent calls the REAL search_notes tool over the ephemeral vault, so the whole flow
// is deterministic.

async function seedHtmlSource(request: APIRequestContext, title: string, body: string) {
  const res = await request.post(`${SERVER}/api/sources/html`, { data: { title, content: body } });
  expect(res.ok(), `seed source failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).source as { id: string; title: string };
}

async function openSource(page: Page, title: string) {
  await page.goto("/");
  await page.locator(".source-item-open", { hasText: title }).first().click();
  await expect(page.locator(".reader-tab-title").first()).toHaveText(title);
}

// Start a 新对话 so the chat log begins empty (an earlier spec's session could resume).
async function startFreshConversation(page: Page) {
  await page.getByRole("button", { name: chatSessionMessages.menuLabel.zh, exact: true }).click();
  await page.locator(".panel-menu-popover .chat-session-new").click();
  await expect(page.locator(".chat-log .chat-msg.chat-assistant")).toHaveCount(0);
}

test("🛠 用工具: an agent turn renders a search_notes tool card + result, then persists the final answer", async ({
  page,
  request
}) => {
  const title = `Agent Tools ${Date.now()}`;
  await seedHtmlSource(request, title, "<article><p>Mitochondria is the powerhouse of the cell.</p></article>");

  await page.setViewportSize({ width: 1400, height: 900 });
  await openSource(page, title);
  await startFreshConversation(page);

  // The gated button is present because the active provider (mock-agent) advertises tools.
  const agentButton = page.getByRole("button", { name: "用工具", exact: true });
  await expect(agentButton).toBeVisible();

  // Type a question so the button enables, then run the agent turn.
  await page.locator(".composer-input").fill("find my mitochondria note");
  await expect(agentButton).toBeEnabled();

  // The agent turn hits POST /api/agent/stream (text/event-stream), not the chat routes.
  const agentResponse = page.waitForResponse(
    (res) => res.url().includes("/api/agent/stream") && res.status() === 200
  );
  await agentButton.click();
  const response = await agentResponse;
  expect(response.headers()["content-type"]).toContain("text/event-stream");

  // A tool CARD for search_notes appears in the transcript, with a settled result.
  const toolCard = page.locator('.agent-transcript .agent-tool-card[data-tool="search_notes"]');
  await expect(toolCard).toBeVisible({ timeout: 15_000 });
  await expect(toolCard.locator(".agent-tool-name")).toContainText("搜索笔记");
  // Expand it → the args + result JSON are shown (the real tool ran against the vault).
  await toolCard.locator(".agent-tool-head").click();
  await expect(toolCard.locator(".agent-tool-json").first()).toContainText("query");

  // The deterministic final answer PERSISTS as a normal assistant bubble (the transcript
  // clears once done.message is persisted through the session seam).
  await expect(page.locator(".chat-log .chat-msg.chat-assistant")).toContainText(MOCK_AGENT_FINAL_ANSWER, {
    timeout: 15_000
  });
  await expect(page.locator(".agent-transcript")).toHaveCount(0);
});
