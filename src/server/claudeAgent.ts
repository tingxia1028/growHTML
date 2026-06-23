import { execFileSync } from "node:child_process";
import type { AiProposal, AiProposalRequest, AiProposalResponse } from "../shared/types";
import { appendHistory, loadThread, setThreadId } from "./storage";
import { buildHtmlProposalPrompt, proposalSchema } from "./proposalPrompt";

function resolveClaudeExecutable() {
  if (process.env.CLAUDE_CODE_EXECUTABLE) {
    return process.env.CLAUDE_CODE_EXECUTABLE;
  }

  const command = process.platform === "win32" ? "where" : "which";
  try {
    const output = execFileSync(command, ["claude"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    return output.split(/\r?\n/).find(Boolean);
  } catch {
    return undefined;
  }
}

export async function createAiProposal(
  request: AiProposalRequest,
  cwd: string
): Promise<AiProposalResponse> {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const thread = await loadThread();
  const prompt = buildHtmlProposalPrompt(request);
  let sessionId = request.startNewSession ? null : thread.claudeThreadId;
  let proposal: AiProposal | null = null;
  const pathToClaudeCodeExecutable = resolveClaudeExecutable();

  const options: Record<string, unknown> = {
    cwd,
    maxTurns: 8,
    allowedTools: ["WebSearch", "WebFetch"],
    disallowedTools: ["Bash", "Edit", "Write", "NotebookEdit"],
    outputFormat: {
      type: "json_schema",
      schema: proposalSchema
    },
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append:
        "You are embedded in GrowHTML. Generate safe, scoped HTML replacement fragments for a visual editor. Never modify files directly."
    },
    title: "GrowHTML main document"
  };

  if (sessionId) {
    options.resume = sessionId;
  }

  if (pathToClaudeCodeExecutable) {
    options.pathToClaudeCodeExecutable = pathToClaudeCodeExecutable;
  }

  for await (const message of query({ prompt, options })) {
    const msg = message as Record<string, unknown>;
    if (msg.type === "system" && typeof msg.session_id === "string") {
      sessionId = msg.session_id;
    }

    if (msg.type === "result") {
      if (typeof msg.session_id === "string") {
        sessionId = msg.session_id;
      }

      if (msg.subtype !== "success") {
        throw new Error(
          typeof msg.result === "string" ? msg.result : `Claude Agent ended with ${String(msg.subtype)}`
        );
      }

      if (msg.structured_output) {
        proposal = msg.structured_output as AiProposal;
      }
    }
  }

  if (!proposal) {
    throw new Error("Claude Agent did not return a structured HTML proposal.");
  }

  await setThreadId("claude", sessionId);
  const history = await appendHistory({
    provider: "claude",
    selectionLabel: request.selection.label,
    selection: request.selection,
    instruction: request.instruction,
    summary: proposal.summary,
    sources: proposal.sources,
    proposal
  });

  return {
    provider: "claude",
    sessionId,
    threads: {
      claude: sessionId,
      codex: thread.codexThreadId
    },
    proposal,
    history
  };
}
