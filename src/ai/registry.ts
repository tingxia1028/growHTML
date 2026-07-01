// Provider registry — Phase 0 of the multi-provider AI agent design
// (docs/design/multi-provider-ai-agent.md §4.1/§5). Same registry idiom as the
// kit policy / NoteType / theme registries: a module-scope Map behind plain
// functions, dependency-light and pure (imports nothing but the provider seam —
// the iron rule). Built-ins (mock / claude-cli / claude-pty) are registered by
// src/ai/index.ts; future kinds (cli-agent SDK adapters, http/BYOK, managed)
// become new entries here instead of new branches in an if-ladder.

import type { ModelProvider, ProviderCapabilities } from "./provider";

/** Everything a factory may need to construct a provider. Phase 0: just env. */
export type ProviderContext = { env: NodeJS.ProcessEnv };

export type ProviderFactory = (ctx: ProviderContext) => ModelProvider;

/** Registry metadata (for listing / a future settings UI) — not the provider itself. */
export type ProviderDescriptor = {
  id: string;
  kind: ProviderCapabilities["kind"];
  label: string;
};

type RegistryEntry = { descriptor: ProviderDescriptor; make: ProviderFactory };

// Keyed by LOWERCASED id so lookup is case-insensitive (env values arrive in
// arbitrary case; the old if-ladder lowercased before comparing).
const providers = new Map<string, RegistryEntry>();

/**
 * Register (or re-register) a provider factory. Idempotent: registering the
 * same id again REPLACES the previous entry (re-install / test re-import must
 * not duplicate — same motivation as registerKitLayerPolicy).
 */
export function registerProvider(desc: ProviderDescriptor, make: ProviderFactory): void {
  providers.set(desc.id.toLowerCase(), { descriptor: desc, make });
}

/** All registered providers, in registration order (for pickers / diagnostics). */
export function listProviderDescriptors(): readonly ProviderDescriptor[] {
  return [...providers.values()].map((entry) => entry.descriptor);
}

/**
 * Construct the provider registered under `id` (case-insensitive). An unknown
 * id falls back to the "mock" entry — exactly the old if-ladder's default — so
 * a typo'd env value still yields the safe offline provider.
 */
export function createRegisteredProvider(id: string, ctx: ProviderContext): ModelProvider {
  const entry = providers.get(id.toLowerCase()) ?? providers.get("mock");
  if (!entry) {
    // Only reachable when the built-ins were never registered (registry used
    // without importing src/ai/index) — a wiring bug, so fail loudly.
    throw new Error(`Unknown AI provider "${id}" and no "mock" fallback is registered`);
  }
  return entry.make(ctx);
}
