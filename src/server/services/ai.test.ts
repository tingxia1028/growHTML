// generateKitContent — the REV-2 profileContext privacy gate (learner-memory §5:
// profile facts are default-ON for local provider kinds, HARD OFF for
// `kind:"managed"` until the MEM-3 consent UI exists). The gate lives HERE because
// the server holds the live ModelProvider — the client never learns the active
// provider's kind — and both transports (HTTP route + direct-call adapter) funnel
// through this one service function. Message-capturing fake providers per kind
// prove: local kinds carry the 学生画像 section; managed strips it BEFORE the
// prompt is built (byte-identical to a no-context request); the gate is scoped to
// review.explain (the only profileContext consumer until MEM-3 generalizes).

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openVault, type StudyVault } from "../../core/vault";
import { installServerKits } from "../../kits/server";
import type { ChatRequest, ModelProvider, ProviderCapabilities } from "../../ai/provider";
import { generateKitContent } from "./ai";

// Same bootstrap the server entry performs (idempotent): review prompts + specs.
installServerKits();

let tempDir = "";
let vault: StudyVault;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "study-vault-ai-gate-"));
  vault = await openVault({ rootDir: tempDir });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

/** A provider of the given kind that records every built user prompt it is sent. */
function capturingProvider(
  kind: ProviderCapabilities["kind"],
  reply = '"**为什么错了** 讲解正文"'
): { provider: ModelProvider; prompts: string[] } {
  const prompts: string[] = [];
  const provider: ModelProvider = {
    id: `fake-${kind}`,
    capabilities: { chat: true, agentic: false, streaming: false, structured: false, tools: false, kind },
    async complete(request: ChatRequest) {
      prompts.push(request.messages[1].content); // [0] is the engine's JSON-only system message
      return { message: { role: "assistant" as const, content: reply } };
    }
  };
  return { provider, prompts };
}

const PROFILE = "弱项:浮力 — 复习错误率 67%(4/6 次未过,学科)\n连续学习 — 3 天(至 2026-07-01)";
const explainInput = (withProfile: boolean) => ({
  promptId: "review.explain",
  contentType: "markdown",
  input: {
    question: "浮力等于什么?",
    expected: "排开液体的重力",
    userAnswer: "物体的重力",
    ...(withProfile ? { profileContext: PROFILE } : {})
  }
});

describe("generateKitContent — profileContext privacy gate (REV-2)", () => {
  it.each(["mock", "cli-agent", "http"] as const)(
    "local kind %s: profileContext IS woven into the explain prompt (default-on)",
    async (kind) => {
      const { provider, prompts } = capturingProvider(kind);
      const { content } = await generateKitContent({ vault, provider }, explainInput(true));
      expect(content).toContain("为什么错了");
      expect(prompts[0]).toContain("学生画像(供个性化,不要复述):");
      expect(prompts[0]).toContain("弱项:浮力");
      expect(prompts[0]).toContain("连续学习 — 3 天(至 2026-07-01)");
    }
  );

  it("managed kind: profileContext NEVER reaches the prompt — hard off until MEM-3 consent", async () => {
    const managed = capturingProvider("managed");
    await generateKitContent({ vault, provider: managed.provider }, explainInput(true));
    expect(managed.prompts[0]).not.toContain("学生画像");
    expect(managed.prompts[0]).not.toContain("弱项:浮力");
    // Still a fully valid explain prompt (only the profile section is gone)…
    expect(managed.prompts[0]).toContain("Item: 浮力等于什么?");
    // …and BYTE-IDENTICAL to an explain request that never carried a profile.
    const local = capturingProvider("mock");
    await generateKitContent({ vault, provider: local.provider }, explainInput(false));
    expect(managed.prompts[0]).toBe(local.prompts[0]);
  });

  it("managed without a profileContext is untouched (the gate strips, never mutates otherwise)", async () => {
    const managed = capturingProvider("managed");
    const { content } = await generateKitContent({ vault, provider: managed.provider }, explainInput(false));
    expect(content).toContain("为什么错了");
    expect(managed.prompts[0]).toContain("Student's answer: 物体的重力");
  });

  it("the gate is scoped to review.explain: other prompts run under managed unchanged", async () => {
    // The point pinned here: the managed gate never rejects/alters OTHER operations —
    // they still generate normally (the grade prompt's {correct, explanation} shape).
    const managed = capturingProvider("managed", '{"correct":false,"explanation":"再想想"}');
    const { content } = await generateKitContent(
      { vault, provider: managed.provider },
      {
        promptId: "review.grade-answer",
        contentType: "review.grade",
        input: { question: "浮力等于什么?", expected: "排开液体的重力", userAnswer: "物体的重力" }
      }
    );
    expect(content).toEqual({ correct: false, explanation: "再想想" });
    expect(managed.prompts[0]).toContain("浮力等于什么?");
  });
});
