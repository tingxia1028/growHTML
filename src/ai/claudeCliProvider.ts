import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { ChatRequest, ChatResponse, ModelProvider } from "./provider";

export type ClaudeCliOptions = {
  /** CLI binary to invoke (default `claude`). */
  command?: string;
  /**
   * When true (default), the API key is stripped from the subprocess env so the
   * CLI authenticates with the user's subscription OAuth instead of silently
   * billing the metered API. This is the critical safety invariant.
   */
  subscriptionMode?: boolean;
  /** Injected for tests; defaults to the real `process.env`. */
  baseEnv?: NodeJS.ProcessEnv;
};

// Pure + unit-tested: in subscription mode the metered API key must not leak
// into the subprocess environment.
export function buildSubprocessEnv(
  baseEnv: NodeJS.ProcessEnv,
  subscriptionMode: boolean
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  if (subscriptionMode) {
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
  }
  return env;
}

function lastUserMessage(request: ChatRequest): string {
  return [...request.messages].reverse().find((message) => message.role === "user")?.content ?? "";
}

// Identify the source so the model knows what's being discussed: title, type,
// and where it lives (URL / file path / page).
function sourceBlock(request: ChatRequest): string {
  const ctx = request.context;
  if (!ctx) return "";
  const head = [ctx.sourceTitle, ctx.sourceType ? `(${ctx.sourceType})` : ""].filter(Boolean).join(" ");
  const lines = [head ? `Source: ${head}` : "", ctx.location ? `Location: ${ctx.location}` : ""].filter(Boolean);
  return lines.join("\n");
}

// The selected passage with its surrounding context, so the model can locate the
// exact span the user means even when the quote is short or ambiguous.
function passageBlock(request: ChatRequest): string {
  const ctx = request.context;
  if (!ctx?.quote) return "";
  const before = ctx.contextBefore ? `…${ctx.contextBefore}` : "";
  const after = ctx.contextAfter ? `${ctx.contextAfter}…` : "";
  return `Selected passage (between ⟦⟧, with surrounding context):\n${before}⟦${ctx.quote}⟧${after}`;
}

// Full transcript — used only to seed a fresh session that already has history
// (e.g. the server restarted mid-conversation, so claude can't --resume it).
function flattenPrompt(request: ChatRequest): string {
  const parts = [sourceBlock(request), passageBlock(request)].filter(Boolean);
  for (const message of request.messages) {
    parts.push(`${message.role.toUpperCase()}: ${message.content}`);
  }
  return parts.join("\n\n");
}

// A single turn: just the new user message, plus the source identity (first turn
// only) and the current passage+context (selection can change between turns).
function turnPrompt(request: ChatRequest, firstTurn: boolean): string {
  const parts = [firstTurn ? sourceBlock(request) : "", passageBlock(request), lastUserMessage(request)].filter(
    Boolean
  );
  return parts.join("\n\n");
}

// Local Claude CLI in print mode (`claude -p`) with persistent context: the first
// turn opens a conversation under an explicit `--session-id <uuid>`, later turns
// `--resume <uuid>` so claude keeps the context server-side (prompt-cache reuse →
// cheaper multi-turn). The explicit id isolates this chat from the visible AI
// terminal's claude and from other sources. Switching source clears the client
// history → the next turn looks like a first turn → a fresh session id.
// Safety-critical env handling is unit-tested; the CLI round-trip is verified
// manually against an authenticated CLI.
export class ClaudeCliProvider implements ModelProvider {
  readonly id = "claude-cli";
  readonly capabilities = { chat: true, agentic: true, streaming: false } as const;

  private readonly command: string;
  private readonly subscriptionMode: boolean;
  private readonly baseEnv: NodeJS.ProcessEnv;
  private sessionId: string | null = null;

  constructor(options: ClaudeCliOptions = {}) {
    this.command = options.command ?? "claude";
    this.subscriptionMode = options.subscriptionMode ?? true;
    this.baseEnv = options.baseEnv ?? process.env;
  }

  async complete(request: ChatRequest): Promise<ChatResponse> {
    const env = buildSubprocessEnv(this.baseEnv, this.subscriptionMode);

    const userTurns = request.messages.filter((message) => message.role === "user").length;
    const resuming = userTurns > 1 && this.sessionId !== null;

    let cliArgs: string[];
    let prompt: string;
    if (resuming) {
      cliArgs = ["--print", "--resume", this.sessionId as string];
      prompt = turnPrompt(request, false);
    } else {
      this.sessionId = randomUUID();
      cliArgs = ["--print", "--session-id", this.sessionId];
      // Fresh id but history already exists (server restarted mid-chat) → replay
      // it so the new session has context; otherwise just the single message.
      prompt = userTurns > 1 ? flattenPrompt(request) : turnPrompt(request, true);
    }

    const content = await new Promise<string>((resolve, reject) => {
      // Windows: `claude` is a .cmd shim, so it must be launched through the shell
      // (a bare spawn would ENOENT). Feed the prompt on stdin rather than argv so
      // multi-line / quoted content needs no shell escaping.
      const child = spawn(this.command, cliArgs, { env, shell: process.platform === "win32" });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve(stdout.trim());
        else reject(new Error(`claude CLI exited with code ${code}: ${stderr.trim()}`));
      });
      // Ignore EPIPE if the CLI exits before consuming all input.
      child.stdin.on("error", () => undefined);
      child.stdin.end(prompt);
    });

    return { message: { role: "assistant", content } };
  }
}
