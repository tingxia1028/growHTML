import { messageText } from "./buildPrompt";
import type { ChatRequest, ChatResponse, ModelProvider } from "./provider";
import type { PtySession, PtySessionFactory } from "./pty/session";
import { extractAnswer } from "./pty/terminalParse";

export type ClaudePtyOptions = {
  createSession: PtySessionFactory;
  /** Turn is considered complete after this many ms with no new output. */
  idleMs?: number;
  /** Safety cap on how long to wait for a turn. */
  timeoutMs?: number;
};

// PTY-backed provider: keeps ONE persistent interactive `claude` session alive
// across turns, so the CLI reuses its context + prompt cache instead of paying a
// cold start every turn (as `claude -p` does). More token-efficient for
// multi-turn chat under a subscription. Reuses the ModelProvider boundary so it
// drops into the existing chat panel; SDK / `-p` remain as fallbacks.
export class ClaudePtyProvider implements ModelProvider {
  readonly id = "claude-pty";
  readonly capabilities = {
    chat: true,
    // The claude binary runs ITS OWN tools (agentic), but takes no app-defined
    // tools and has no native JSON mode — structured falls back to complete()+extract.
    agentic: true,
    streaming: false,
    structured: false,
    tools: false,
    // PTY writes a text prompt to the interactive session; image parts degrade to
    // `[image]` (no native image-block over the terminal seam).
    vision: false,
    kind: "cli-agent"
  } as const;

  private session: PtySession | null = null;
  private buffer = "";
  private readonly idleMs: number;
  private readonly timeoutMs: number;

  constructor(private readonly options: ClaudePtyOptions) {
    this.idleMs = options.idleMs ?? 400;
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  private async ensureSession(): Promise<PtySession> {
    if (!this.session) {
      const session = await this.options.createSession();
      session.onData((chunk) => {
        this.buffer += chunk;
      });
      this.session = session;
    }
    return this.session;
  }

  async complete(request: ChatRequest): Promise<ChatResponse> {
    const session = await this.ensureSession();
    const lastUser = [...request.messages].reverse().find((message) => message.role === "user");

    this.buffer = "";
    // V-1: write the message TEXT (image parts → `[image]` placeholder) so the PTY
    // never receives `[object Object]` for a multimodal message.
    session.write(`${lastUser ? messageText(lastUser.content) : ""}\n`);
    await this.waitForIdle();

    return { message: { role: "assistant", content: extractAnswer(this.buffer) } };
  }

  dispose(): void {
    this.session?.kill();
    this.session = null;
  }

  // Resolves once output has been quiet for `idleMs` (a turn finished) or the
  // overall timeout elapses.
  private waitForIdle(): Promise<void> {
    return new Promise<void>((resolve) => {
      let lastLength = this.buffer.length;
      const start = Date.now();
      const timer = setInterval(() => {
        const settled = this.buffer.length === lastLength;
        if (settled || Date.now() - start > this.timeoutMs) {
          clearInterval(timer);
          resolve();
          return;
        }
        lastLength = this.buffer.length;
      }, this.idleMs);
    });
  }
}
