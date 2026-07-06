// composeAutoContext (ACTION-2a) — the I/O composition of the standard envelope:
// selection from the request's existing anchor/selection inputs, doc from the
// source record / title (detectSubject + the shared foreground resolver), learner
// = the generalized profileContext with the REV-2 guarantees preserved (managed
// hard-strip, hidden facts honored, no double weave when the prompt already
// carries a profileContext, degrade-not-block on memory failures).

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModelProvider, ProviderCapabilities } from "../../ai/provider";
import type { ProfileFactView } from "../../core/memory/profile";
import { sourceSchema } from "../../core/schema";
import { type StudyVault } from "../../core/vault";
import { openTestVault } from "../../core/testing/openTestVault";
import { installServerKits } from "../../kits/server";
import { composeAutoContext } from "./autoContext";

// Detection tables (textbook + subject kits) register exactly as the server does.
installServerKits();

let tempDir = "";
let vault: StudyVault;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "study-vault-auto-context-"));
  vault = await openTestVault({ rootDir: tempDir });
});

afterEach(async () => {
  vault?.close(); // STORE-SQL Stage-3: release sqlite handles before rm (no-op on jsonl)
  await rm(tempDir, { recursive: true, force: true });
});

function providerOf(kind: ProviderCapabilities["kind"]): ModelProvider {
  return {
    id: `fake-${kind}`,
    capabilities: { chat: true, agentic: false, streaming: false, structured: false, tools: false, vision: false, kind },
    async complete() {
      return { message: { role: "assistant" as const, content: "" } };
    }
  };
}

const factView = (over: Partial<ProfileFactView> & { key: string; kind: ProfileFactView["kind"] }): ProfileFactView => ({
  title: over.key,
  value: "",
  evidence: [],
  pinned: false,
  hidden: false,
  ...over
});

const FACTS: ProfileFactView[] = [
  factView({ key: "weak:subject:浮力", kind: "weak", title: "弱项:浮力", value: "复习错误率 67%(4/6 次未过,学科)" }),
  factView({ key: "weak:subject:电路", kind: "weak", title: "弱项:电路", value: "隐藏的弱项", hidden: true }),
  factView({ key: "activity:streak", kind: "activity", title: "连续学习", value: "3 天(至 2026-07-01)" })
];

describe("composeAutoContext — selection + doc", () => {
  it("an input with no context signals composes an empty envelope", async () => {
    const context = await composeAutoContext({ vault, provider: providerOf("mock") }, { input: {} });
    expect(context.selection).toBeUndefined();
    expect(context.doc).toBeUndefined();
    // Fresh vault → no digests → no learner either.
    expect(context.learner).toBeUndefined();
  });

  it("selection comes from anchorText, with locator ids only when the request carried them", async () => {
    const bare = await composeAutoContext({ vault, provider: providerOf("mock") }, { input: { anchorText: " 浮力 " } });
    expect(bare.selection).toEqual({ quote: "浮力" });

    const located = await composeAutoContext(
      { vault, provider: providerOf("mock") },
      { input: { anchorText: "浮力", anchorId: "ah_1", sourceId: "src_01ARZ3NDEKTSV4RRFFQ69G5FAX" } }
    );
    expect(located.selection).toEqual({ quote: "浮力", anchorId: "ah_1", sourceId: "src_01ARZ3NDEKTSV4RRFFQ69G5FAX" });
  });

  it("doc derives from sourceTitle: detectSubject winner = subject, foreground resolver = kit", async () => {
    const context = await composeAutoContext(
      { vault, provider: providerOf("mock") },
      { input: { sourceTitle: "高一物理 必修一" } }
    );
    // "物理" is a subject-science title keyword AND "必修" is a textbook keyword — both
    // score 0.6, so the kitId-ASC tie-break names subject-science the RAW detected winner
    // (subject < textbook). But 理化生 is opt-in / uninstalled, so the pin>detected∧installed
    // >default resolver FOREGROUNDS the installed textbook kit. subject = raw winner,
    // kit = resolved foreground (M-C: science detection now fires on 物理 titles).
    expect(context.doc).toEqual({ title: "高一物理 必修一", subject: "subject-science", kit: "textbook-learning" });
  });

  it("doc prefers the stored source record (title + sourceType), looked up by input.sourceId", async () => {
    const source = sourceSchema.parse({
      id: "src_01ARZ3NDEKTSV4RRFFQ69G5FAX",
      type: "source",
      schemaVersion: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdBy: "user",
      sourceType: "pdf",
      title: "高二物理 选修三",
      path: "sources/physics.pdf",
      contentHash: `sha256:${"a".repeat(64)}`
    });
    await vault.stores.sources.upsert(source);
    const context = await composeAutoContext(
      { vault, provider: providerOf("mock") },
      { input: { sourceId: source.id, sourceTitle: "ignored — the record wins" } }
    );
    expect(context.doc).toEqual({
      title: "高二物理 选修三",
      sourceType: "pdf",
      // "物理" fires subject-science (raw winner via kitId-ASC tie); science is uninstalled,
      // so the foreground stays the installed textbook kit (M-C science detection).
      subject: "subject-science",
      kit: "textbook-learning"
    });
  });

  it("an unknown sourceId degrades to the sourceTitle string (never throws)", async () => {
    const context = await composeAutoContext(
      { vault, provider: providerOf("mock") },
      { input: { sourceId: "src_01ARZ3NDEKTSV4RRFFQ69G5FA0", sourceTitle: "周末随笔" } }
    );
    // Unmatched title → no detection winner; the workspace default kit still names
    // the foreground (the server-side fallback, same as the stage-axis seeding).
    expect(context.doc).toMatchObject({ title: "周末随笔", kit: "textbook-learning" });
    expect(context.doc?.subject).toBeUndefined();
  });
});

describe("composeAutoContext — learner (the generalized profileContext)", () => {
  it("composes the compact learner block from the profile facts, hidden facts EXCLUDED", async () => {
    const context = await composeAutoContext(
      { vault, provider: providerOf("mock"), loadProfileFacts: async () => FACTS },
      { input: {} }
    );
    expect(context.learner).toBe("弱项:浮力 — 复习错误率 67%(4/6 次未过,学科)\n连续学习 — 3 天(至 2026-07-01)");
    expect(context.learner).not.toContain("电路");
  });

  it.each(["mock", "cli-agent", "http"] as const)("local kind %s: learner is default-on", async (kind) => {
    const context = await composeAutoContext(
      { vault, provider: providerOf(kind), loadProfileFacts: async () => FACTS },
      { input: {} }
    );
    expect(context.learner).toContain("弱项:浮力");
  });

  it("managed kind: NO learner section — the REV-2 hard strip, applied at compose time", async () => {
    const context = await composeAutoContext(
      { vault, provider: providerOf("managed"), loadProfileFacts: async () => FACTS },
      { input: { anchorText: "浮力" } }
    );
    expect(context.learner).toBeUndefined();
    // The non-private sections still compose (only profile data is gated).
    expect(context.selection).toEqual({ quote: "浮力" });
  });

  it("a runtime input that already carries profileContext gets NO learner section (never weave twice)", async () => {
    const context = await composeAutoContext(
      { vault, provider: providerOf("mock"), loadProfileFacts: async () => FACTS },
      { input: { profileContext: "弱项:浮力 — …" } }
    );
    expect(context.learner).toBeUndefined();
  });

  it("a failing profile read degrades to no learner section (never blocks generation)", async () => {
    const context = await composeAutoContext(
      {
        vault,
        provider: providerOf("mock"),
        loadProfileFacts: async () => {
          throw new Error("boom");
        }
      },
      { input: { anchorText: "浮力" } }
    );
    expect(context.learner).toBeUndefined();
    expect(context.selection).toEqual({ quote: "浮力" });
  });
});
