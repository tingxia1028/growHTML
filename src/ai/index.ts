import { ClaudeCliProvider } from "./claudeCliProvider";
import { ClaudePtyProvider } from "./claudePtyProvider";
import { MockModelProvider } from "./mockProvider";
import { createClaudePtySession } from "./pty/nodePtySession";
import type { ModelProvider } from "./provider";

export * from "./provider";
export {
  generateStructured,
  extractJson,
  StructuredGenerationError,
  type StructuredGenerateRequest
} from "./structured";
export { MockModelProvider } from "./mockProvider";
export { ClaudeCliProvider, buildSubprocessEnv } from "./claudeCliProvider";
export { ClaudePtyProvider } from "./claudePtyProvider";
export type { PtySession, PtySessionFactory } from "./pty/session";
export { FakePtySession } from "./pty/session";
export { stripAnsi, extractAnswer } from "./pty/terminalParse";

// Selects the active provider. Defaults to the deterministic mock so the app
// runs offline and tests stay deterministic. On desktop, prefer the PTY-backed
// provider (persistent session → cheaper multi-turn): STUDY_VAULT_AI_PROVIDER=claude-pty.
// claude-cli (`claude -p`, cold each turn) and the Agent SDK remain as fallbacks.
export function createModelProvider(env: NodeJS.ProcessEnv = process.env): ModelProvider {
  const choice = (env.STUDY_VAULT_AI_PROVIDER ?? "mock").toLowerCase();
  if (choice === "claude-pty") {
    return new ClaudePtyProvider({ createSession: () => createClaudePtySession() });
  }
  if (choice === "claude-cli") {
    return new ClaudeCliProvider({ baseEnv: env, subscriptionMode: true });
  }
  return new MockModelProvider();
}
