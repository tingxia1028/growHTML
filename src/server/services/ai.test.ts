// generateKitContent — the REV-2 profileContext privacy gate (learner-memory §5:
// profile facts are default-ON for local provider kinds, HARD OFF for
// `kind:"managed"` until the MEM-3 consent UI exists). The gate lives HERE because
// the server holds the live ModelProvider — the client never learns the active
// provider's kind — and both transports (HTTP route + direct-call adapter) funnel
// through this one service function. Message-capturing fake providers per kind
// prove: local kinds carry the 学生画像 section; managed strips it BEFORE the
// prompt is built (byte-identical to a no-context request). ACTION-2a GENERALIZED
// the gate (absorbing MEM-3): the strip now applies to EVERY operation's runtime
// input, and the auto-context envelope's learner section obeys the same policy at
// compose time — pinned below alongside the envelope-through-the-service wiring
// and the simple-mode run path.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openVault, type StudyVault } from "../../core/vault";
import { installServerKits } from "../../kits/server";
import { operationSchema } from "../../core/schema";
import { MockModelProvider } from "../../ai/mockProvider";
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
    capabilities: { chat: true, agentic: false, streaming: false, structured: false, tools: false, vision: false, kind },
    async complete(request: ChatRequest) {
      // [0] is the engine's JSON-only system message; these tests send text-only content
      // (V-1 union widened the type — assert the string arm).
      prompts.push(request.messages[1].content as string);
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

  it("other prompts run under managed unchanged (the gate strips profile data, never rejects/alters)", async () => {
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

  it("ACTION-2a generalization: managed strips profileContext from EVERY operation, not just review.explain", async () => {
    // A stored TEMPLATE op that references {{profileContext}} directly makes the
    // strip observable at the wire (built-in non-review prompts simply ignore the
    // key, so the template op is the sharpest probe).
    const op = operationSchema.parse({
      id: "op_01ARZ3NDEKTSV4RRFFQ69G5FAX",
      type: "operation",
      schemaVersion: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdBy: "user",
      name: "带画像回答",
      outputContentType: "markdown",
      promptTemplate: "回答:{{anchorText}}\n画像:{{profileContext}}"
    });
    await vault.stores.operations.upsert(op);
    const run = (provider: ModelProvider, withProfile: boolean) =>
      generateKitContent(
        { vault, provider },
        {
          promptId: op.id,
          contentType: "markdown",
          input: { anchorText: "浮力", ...(withProfile ? { profileContext: PROFILE } : {}) }
        }
      );

    // Local kind: default-on — the profile reaches the rendered template.
    const local = capturingProvider("mock", '"ok"');
    await run(local.provider, true);
    expect(local.prompts[0]).toContain("画像:弱项:浮力");

    // Managed kind: stripped BEFORE render — byte-identical to a no-profile run.
    const managed = capturingProvider("managed", '"ok"');
    await run(managed.provider, true);
    expect(managed.prompts[0]).not.toContain("弱项:浮力");
    const bare = capturingProvider("mock", '"ok"');
    await run(bare.provider, false);
    expect(managed.prompts[0]).toBe(bare.prompts[0]);
  });
});

describe("generateKitContent — the auto-context envelope (ACTION-2a)", () => {
  it("a request with selection input gets the [Context] preamble prepended to a built-in prompt", async () => {
    const { provider, prompts } = capturingProvider(
      "mock",
      '{"title":"光合作用","level":"standard","explanation":"把光能转化为化学能。"}'
    );
    await generateKitContent(
      { vault, provider },
      {
        promptId: "textbook.explain-concept",
        contentType: "textbook.explanation",
        input: { anchorText: "光合作用把光能转化为化学能。", sourceTitle: "生物 必修一" }
      }
    );
    expect(prompts[0].startsWith("[Context]\n")).toBe(true);
    expect(prompts[0]).toContain('Selection: "光合作用把光能转化为化学能。"');
    expect(prompts[0]).toContain("Doc: 生物 必修一");
    // The original prompt body follows the preamble untouched.
    expect(prompts[0]).toContain("光合作用把光能转化为化学能。");
  });

  it("an envelope-free request leaves the prompt byte-identical (REV byte-compat stance)", async () => {
    // review.explain input carries no anchor/source signals and the fresh vault
    // has no digests → the envelope is EMPTY → nothing is prepended.
    const { provider, prompts } = capturingProvider("mock");
    await generateKitContent({ vault, provider }, explainInput(false));
    expect(prompts[0].startsWith("A student just got a review item WRONG.")).toBe(true);
    expect(prompts[0]).not.toContain("[Context]");
  });

  it("runs a hand-seeded SIMPLE operation end-to-end (auto output form via the router)", async () => {
    const op = operationSchema.parse({
      id: "op_01ARZ3NDEKTSV4RRFFQ69G5FA1",
      type: "operation",
      schemaVersion: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdBy: "user",
      name: "苏格拉底提问",
      mode: "simple",
      instruction: "用苏格拉底式追问考我选中的内容,一次只问一个问题"
    });
    await vault.stores.operations.upsert(op);

    // The mock provider synthesizes the deterministic first router member.
    const out = await generateKitContent(
      { vault, provider: new MockModelProvider() },
      { promptId: op.id, input: { anchorText: "浮力等于排开液体的重力" } }
    );
    expect(out).toEqual({ contentType: "markdown", content: "", provider: "mock" });

    // The compiled prompt (preamble + instruction + form directive) reaches the wire.
    const capturing = capturingProvider("mock", '{"form":"markdown","markdown":"你先说说,浮力和什么力平衡?"}');
    const routed = await generateKitContent(
      { vault, provider: capturing.provider },
      { promptId: op.id, input: { anchorText: "浮力等于排开液体的重力" } }
    );
    expect(routed).toEqual({ contentType: "markdown", content: "你先说说,浮力和什么力平衡?", provider: "fake-mock" });
    expect(capturing.prompts[0]).toContain('[Context]\nSelection: "浮力等于排开液体的重力"');
    expect(capturing.prompts[0]).toContain("用苏格拉底式追问考我选中的内容,一次只问一个问题");
    expect(capturing.prompts[0]).toContain("note-form router JSON");
  });
});
