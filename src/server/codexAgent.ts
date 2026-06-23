import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AiProposal, AiProposalRequest, AiProposalResponse } from "../shared/types";
import { buildHtmlProposalPrompt, proposalSchema } from "./proposalPrompt";
import { appendHistory, loadThread, setThreadId } from "./storage";
import { cleanCodexStderr, formatCodexFailure } from "./codexWarnings";

type CodexRunResult = {
  finalMessage: string;
  threadId: string | null;
  stderr: string;
};

function resolveCodexExecutable() {
  if (process.env.CODEX_EXECUTABLE) {
    return process.env.CODEX_EXECUTABLE;
  }

  const command = process.platform === "win32" ? "where" : "which";
  try {
    const output = execFileSync(command, ["codex"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    return output.split(/\r?\n/).find(Boolean) ?? "codex";
  } catch {
    return "codex";
  }
}

function getCodexServiceTier() {
  return process.env.GROWHTML_CODEX_SERVICE_TIER === "flex" ? "flex" : "fast";
}

function shouldEnableSearch(instruction: string) {
  return /搜索|搜一下|查找|调研|资料|来源|引用|论文|标注|注释|悬浮|解释|hover|paper|github|链接|url|最新|recent|source|citation/i.test(
    instruction
  );
}

function extractThreadIdFromJsonl(stdout: string) {
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const event = JSON.parse(trimmed) as Record<string, unknown>;
      if (event.type === "thread.started" && typeof event.thread_id === "string") {
        return event.thread_id;
      }
    } catch {
      // Non-JSON progress lines are ignored defensively.
    }
  }

  return null;
}

function parseProposal(text: string): AiProposal {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1].trim() : trimmed;
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  const jsonText = firstBrace >= 0 && lastBrace >= firstBrace ? raw.slice(firstBrace, lastBrace + 1) : raw;
  const parsed = JSON.parse(jsonText) as Partial<AiProposal>;

  if (
    typeof parsed.summary !== "string" ||
    typeof parsed.replacementHtml !== "string" ||
    !Array.isArray(parsed.sources) ||
    !["low", "medium", "high"].includes(String(parsed.confidence))
  ) {
    throw new Error("Codex returned JSON, but it did not match the proposal shape.");
  }

  return {
    summary: parsed.summary,
    replacementHtml: parsed.replacementHtml,
    sources: parsed.sources
      .filter((source) => source && typeof source.title === "string" && typeof source.url === "string")
      .map((source) => ({ title: source.title, url: source.url })),
    confidence: parsed.confidence as AiProposal["confidence"]
  };
}

async function runCodex(input: {
  prompt: string;
  cwd: string;
  sessionId: string | null;
  enableSearch: boolean;
}): Promise<CodexRunResult> {
  const codexExecutable = resolveCodexExecutable();
  const tempDir = path.join(os.tmpdir(), "growhtml-codex");
  await mkdir(tempDir, { recursive: true });

  const runId = randomUUID();
  const schemaPath = path.join(tempDir, `${runId}.schema.json`);
  const outputPath = path.join(tempDir, `${runId}.proposal.json`);
  await writeFile(schemaPath, JSON.stringify(proposalSchema, null, 2), "utf8");

  const args = ["-c", `service_tier="${getCodexServiceTier()}"`, "--sandbox", "read-only", "exec"];

  if (input.enableSearch) {
    args.splice(2, 0, "--search");
  }

  if (input.sessionId) {
    args.push(
      "resume",
      "--skip-git-repo-check",
      "--json",
      "-o",
      outputPath,
      input.sessionId,
      "-"
    );
  } else {
    args.push(
      "--skip-git-repo-check",
      "--json",
      "--output-schema",
      schemaPath,
      "-o",
      outputPath,
      "-"
    );
  }

  const resumeNote = input.sessionId
    ? "\n\n重要：你正在通过 codex exec resume 续接同一个 GrowHTML 文档线程。最终回复必须是严格 JSON，不要 Markdown，不要代码块。"
    : "\n\n最终回复必须符合提供的 JSON Schema。";

  const child = spawn(codexExecutable, args, {
    cwd: input.cwd,
    env: process.env,
    shell: process.platform === "win32",
    stdio: ["pipe", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  const timeout = setTimeout(() => child.kill(), 10 * 60 * 1000);

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  child.stdin.write(`${input.prompt}${resumeNote}`);
  child.stdin.end();

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });

  clearTimeout(timeout);

  try {
    if (exitCode !== 0) {
      throw new Error(formatCodexFailure({ stderr, stdout, exitCode }));
    }

    const finalMessage = await readFile(outputPath, "utf8");
    return {
      finalMessage,
      threadId: extractThreadIdFromJsonl(stdout) ?? input.sessionId,
      stderr: cleanCodexStderr(stderr)
    };
  } finally {
    await rm(schemaPath, { force: true });
    await rm(outputPath, { force: true });
  }
}

export async function createCodexProposal(
  request: AiProposalRequest,
  cwd: string
): Promise<AiProposalResponse> {
  const thread = await loadThread();
  const sessionId = request.startNewSession ? null : thread.codexThreadId;
  const prompt = buildHtmlProposalPrompt(request);
  const result = await runCodex({ prompt, cwd, sessionId, enableSearch: shouldEnableSearch(request.instruction) });
  const proposal = parseProposal(result.finalMessage);
  const nextSessionId = result.threadId;

  await setThreadId("codex", nextSessionId);
  const history = await appendHistory({
    provider: "codex",
    selectionLabel: request.selection.label,
    selection: request.selection,
    instruction: request.instruction,
    summary: proposal.summary,
    sources: proposal.sources,
    proposal
  });

  return {
    provider: "codex",
    sessionId: nextSessionId,
    threads: {
      claude: thread.claudeThreadId,
      codex: nextSessionId
    },
    proposal,
    history
  };
}
