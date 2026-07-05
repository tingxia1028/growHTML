// W3 synthesis service — a chat transcript (+ W2 attachments) becomes a NEW markdown
// source in the vault. Runs against a REAL vault + the deterministic MockModelProvider
// (its completeStructured echoes the `sample`), so the created source's content equals
// the sample's markdown, the source is `origin: "authored"`, and it renders with
// headings via the same projection the reader uses. A with-sources case asserts the
// prompt carried the attachments (the "Attached: N" marker).

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openVault, type StudyVault } from "../../core/vault";
import { MockModelProvider } from "../../ai/mockProvider";
import type { ChatContext, ChatMessage, ChatRequest, ModelProvider, StructuredRequest } from "../../ai/provider";
import { readSourceContent } from "../../core/store/sources";
import { projectedHtmlForSource } from "./sourceAuthoring";
import { SynthesisPathResultError, synthesizeDocument } from "./synthesis";

let tempDir = "";
let vault: StudyVault;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "study-vault-synthesis-"));
  vault = await openVault({ rootDir: tempDir });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

const transcript: ChatMessage[] = [
  { role: "user", content: "Explain mitochondria." },
  { role: "assistant", content: "Mitochondria are the powerhouse of the cell." },
  { role: "user", content: "Make it a study doc." }
];

const SAMPLE = {
  title: "Cell Biology Study Doc",
  markdown: "# Overview\n\nMitochondria make ATP.\n\n## Details\n\nThe powerhouse of the cell."
};

/** A provider of the given `kind` that records every structured request's messages. */
function capturingStructuredProvider(sample: unknown): {
  provider: ModelProvider;
  requests: StructuredRequest[];
} {
  const requests: StructuredRequest[] = [];
  const provider: ModelProvider = {
    id: "capture",
    capabilities: { chat: true, agentic: false, streaming: false, structured: true, tools: false, vision: false, kind: "mock" },
    async complete(_request: ChatRequest) {
      return { message: { role: "assistant" as const, content: JSON.stringify(sample) } };
    },
    async completeStructured(request: StructuredRequest) {
      requests.push(request);
      return { json: JSON.stringify(request.sample ?? sample) };
    }
  };
  return { provider, requests };
}

describe("synthesizeDocument", () => {
  it("creates an AUTHORED markdown source whose content equals the sample", async () => {
    const { source } = await synthesizeDocument(
      { provider: new MockModelProvider(), vault },
      { messages: transcript, sample: SAMPLE }
    );

    expect(source.sourceType).toBe("markdown");
    expect(source.origin).toBe("authored");
    expect(source.createdBy).toBe("user");
    expect(source.title).toBe(SAMPLE.title);

    // The stored file content is exactly the sample markdown.
    const content = await readSourceContent(vault, source);
    expect(content).toBe(SAMPLE.markdown);

    // It lists via the normal store — a first-class source.
    const listed = await vault.stores.sources.list();
    expect(listed.map((s) => s.id)).toContain(source.id);
  });

  it("renders with HEADINGS through the reader projection (# / ## become <h1>/<h2>)", async () => {
    const { source } = await synthesizeDocument(
      { provider: new MockModelProvider(), vault },
      { messages: transcript, sample: SAMPLE }
    );
    const stored = await readSourceContent(vault, source);
    const html = projectedHtmlForSource(source, stored);
    expect(html).toContain("<h1");
    expect(html).toContain("Overview");
    expect(html).toContain("<h2");
    expect(html).toContain("Details");
  });

  it("carries the transcript AND the attachments into the synthesis prompt", async () => {
    const context: ChatContext = {
      sources: [{ title: "ATP Source", type: "html", excerpt: "ATP synthase produces ATP." }]
    };
    const { provider, requests } = capturingStructuredProvider(SAMPLE);
    const { source } = await synthesizeDocument({ provider, vault }, { messages: transcript, context, sample: SAMPLE });

    expect(source.title).toBe(SAMPLE.title);
    expect(requests).toHaveLength(1);
    // The engine prepends its JSON-only system message; ours follows at index [1].
    const system = requests[0].messages.map((m) => m.content).join("\n");
    const user = requests[0].messages[requests[0].messages.length - 1].content;
    expect(system).toContain("Attached: 1 source(s)");
    expect(system).toContain("ATP synthase produces ATP.");
    expect(user).toContain("Explain mitochondria.");
    expect(user).toContain("Make it a study doc.");
    // DELTA 4: no fabricated contentType is claimed for a document body.
    expect(requests[0].contentType).toBe("");
  });

  it("with NO sample, the mock returns a deterministic default doc WITH headings (button-click path)", async () => {
    // The 生成文档 button dispatches with no payload.content → no sample. The mock detects
    // the synthesis prompt marker and returns a valid {title, markdown} default, so the
    // real click path still creates a source offline (never a 400 on an empty {}).
    const { source } = await synthesizeDocument(
      { provider: new MockModelProvider(), vault },
      { messages: transcript }
    );
    expect(source.sourceType).toBe("markdown");
    const html = projectedHtmlForSource(source, await readSourceContent(vault, source));
    expect(html).toContain("<h1");
    expect(html).toContain("<h2");
  });

  it("rejects a bare file-path markdown result (DELTA 5 cli-agent degrade guard)", async () => {
    await expect(
      synthesizeDocument(
        { provider: new MockModelProvider(), vault },
        { messages: transcript, sample: { title: "Doc", markdown: "C:\\Users\\x\\generated\\doc.md" } }
      )
    ).rejects.toBeInstanceOf(SynthesisPathResultError);
    // Nothing was persisted.
    expect(await vault.stores.sources.list()).toHaveLength(0);
  });
});
