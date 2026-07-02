import { ClaudeCliProvider } from "./claudeCliProvider";
import { ClaudePtyProvider } from "./claudePtyProvider";
import { claudeAgentSpec } from "./cliAgent/claude";
import { codexAgentSpec } from "./cliAgent/codex";
import { ManagedProvider } from "./managed";
import { MockModelProvider } from "./mockProvider";
import { createClaudePtySession } from "./pty/nodePtySession";
import type { ModelProvider } from "./provider";
import { createRegisteredProvider, registerProvider } from "./registry";

export * from "./provider";
export {
  generateStructured,
  extractJson,
  StructuredGenerationError,
  type StructuredGenerateRequest
} from "./structured";
export { MockModelProvider, FORM_ROUTER_CONTENT_TYPE } from "./mockProvider";
export { ClaudeCliProvider, buildSubprocessEnv } from "./claudeCliProvider";
export { ClaudePtyProvider } from "./claudePtyProvider";
export type { PtySession, PtySessionFactory } from "./pty/session";
export { FakePtySession } from "./pty/session";
export { stripAnsi, extractAnswer } from "./pty/terminalParse";
export {
  registerProvider,
  listProviderDescriptors,
  createRegisteredProvider,
  type ProviderContext,
  type ProviderFactory,
  type ProviderDescriptor
} from "./registry";

// Built-in providers, registered at module scope (Phase 0 registry refactor —
// docs/design/multi-provider-ai-agent.md §5). Construction args are IDENTICAL
// to the old if-ladder's; only the dispatch moved into the registry.
registerProvider({ id: "mock", kind: "mock", label: "Mock (offline)" }, () => new MockModelProvider());
registerProvider(
  { id: "claude-cli", kind: "cli-agent", label: "Claude CLI (subscription)" },
  ({ env }) => new ClaudeCliProvider({ baseEnv: env, subscriptionMode: true })
);
registerProvider(
  { id: "claude-pty", kind: "cli-agent", label: "Claude PTY (subscription)" },
  () => new ClaudePtyProvider({ createSession: () => createClaudePtySession() })
);

// cli-agent kind, Phase 0.5 (§9.2/§9.5): thin adapters over the two OFFICIAL
// vendor SDKs, with both §9.3 invariants (metered-key strip + pinned
// non-destructive mode) enforced inside the adapters. The hand-spawned
// claude-cli / claude-pty entries above stay registered as legacy fallbacks
// until these prove out in daily use.
registerProvider(
  { id: "claude-agent", kind: "cli-agent", label: "Claude (subscription, Agent SDK)" },
  ({ env }) => claudeAgentSpec.makeProvider({ env })
);
registerProvider(
  { id: "codex", kind: "cli-agent", label: "Codex (ChatGPT subscription)" },
  ({ env }) => codexAgentSpec.makeProvider({ env })
);

// managed kind, G-A3a (docs/design/managed-ai-credits.md §4.1): the thin client
// of the hosted credits gateway (src/gateway). Registered ALWAYS so pickers can
// list it; USE is gated — an unconfigured instance throws
// ManagedNotConfiguredError before any fetch. Config is env-based for now;
// G-A3b replaces the env token with the stored phone-login session
// (getSessionToken then reads live auth state instead of a frozen env value).
registerProvider(
  { id: "managed", kind: "managed", label: "Managed (托管积分)" },
  ({ env }) =>
    new ManagedProvider({
      gatewayBaseUrl: env.STUDY_VAULT_MANAGED_GATEWAY_URL ?? "",
      getSessionToken: () => env.STUDY_VAULT_MANAGED_TOKEN ?? null
    })
);

// Selects the active provider. Defaults to the deterministic mock so the app
// runs offline and tests stay deterministic. On desktop, prefer the PTY-backed
// provider (persistent session → cheaper multi-turn): STUDY_VAULT_AI_PROVIDER=claude-pty.
// claude-cli (`claude -p`, cold each turn) and the Agent SDK remain as fallbacks.
// Delegates to the registry: unknown/absent env values fall back to the mock,
// exactly as before.
export function createModelProvider(env: NodeJS.ProcessEnv = process.env): ModelProvider {
  const choice = (env.STUDY_VAULT_AI_PROVIDER ?? "mock").toLowerCase();
  return createRegisteredProvider(choice, { env });
}
