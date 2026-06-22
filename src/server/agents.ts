import type { AiProposalRequest, AiProposalResponse } from "../shared/types";
import { createAiProposal } from "./claudeAgent";
import { createCodexProposal } from "./codexAgent";

export async function createProposal(
  request: AiProposalRequest,
  cwd: string
): Promise<AiProposalResponse> {
  if (request.provider === "codex") {
    return createCodexProposal(request, cwd);
  }

  return createAiProposal(request, cwd);
}
