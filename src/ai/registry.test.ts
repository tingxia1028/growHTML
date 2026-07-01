import { describe, expect, it } from "vitest";
import {
  ClaudeCliProvider,
  ClaudePtyProvider,
  createRegisteredProvider,
  listProviderDescriptors,
  MockModelProvider,
  registerProvider,
  type ModelProvider,
  type ProviderContext
} from "./index";

// Importing ./index above registers the three built-ins at module scope — the
// registry itself (./registry) stays pure and empty until someone registers.
const ctx: ProviderContext = { env: {} };

describe("provider registry — built-ins (Phase 0, zero behavior change)", () => {
  it("lists the three built-in descriptors with honest kinds", () => {
    const byId = new Map(listProviderDescriptors().map((d) => [d.id, d]));
    expect(byId.get("mock")).toEqual({ id: "mock", kind: "mock", label: "Mock (offline)" });
    expect(byId.get("claude-cli")).toEqual({
      id: "claude-cli",
      kind: "cli-agent",
      label: "Claude CLI (subscription)"
    });
    expect(byId.get("claude-pty")).toEqual({
      id: "claude-pty",
      kind: "cli-agent",
      label: "Claude PTY (subscription)"
    });
  });

  it("creates the right provider per id", () => {
    expect(createRegisteredProvider("mock", ctx)).toBeInstanceOf(MockModelProvider);
    expect(createRegisteredProvider("claude-cli", ctx)).toBeInstanceOf(ClaudeCliProvider);
    // PTY construction is lazy (createSession not called) → node-pty is NOT loaded.
    expect(createRegisteredProvider("claude-pty", ctx)).toBeInstanceOf(ClaudePtyProvider);
  });

  it("falls back to the mock for an unknown id (the old if-ladder default)", () => {
    expect(createRegisteredProvider("no-such-provider", ctx)).toBeInstanceOf(MockModelProvider);
    expect(createRegisteredProvider("", ctx)).toBeInstanceOf(MockModelProvider);
  });

  it("looks ids up case-insensitively", () => {
    expect(createRegisteredProvider("CLAUDE-CLI", ctx)).toBeInstanceOf(ClaudeCliProvider);
    expect(createRegisteredProvider("Mock", ctx)).toBeInstanceOf(MockModelProvider);
  });
});

// A minimal fake for registration tests — never invoked, only constructed.
function fakeProvider(id: string): ModelProvider {
  return {
    id,
    capabilities: { chat: true, agentic: false, streaming: false, structured: false, tools: false, kind: "mock" },
    async complete() {
      return { message: { role: "assistant" as const, content: id } };
    }
  };
}

describe("provider registry — registration semantics", () => {
  it("registers a new provider, lists it, and constructs it with the given context", () => {
    let seen: ProviderContext | null = null;
    registerProvider({ id: "scratch-a", kind: "http", label: "Scratch A" }, (c) => {
      seen = c;
      return fakeProvider("scratch-a");
    });

    expect(listProviderDescriptors()).toContainEqual({ id: "scratch-a", kind: "http", label: "Scratch A" });
    const env = { STUDY_VAULT_AI_PROVIDER: "scratch-a" };
    const provider = createRegisteredProvider("scratch-a", { env });
    expect(provider.id).toBe("scratch-a");
    expect(seen).toEqual({ env });
  });

  it("re-registering the same id REPLACES the entry (no duplicates)", () => {
    registerProvider({ id: "scratch-b", kind: "http", label: "First" }, () => fakeProvider("first"));
    registerProvider({ id: "scratch-b", kind: "managed", label: "Second" }, () => fakeProvider("second"));

    const entries = listProviderDescriptors().filter((d) => d.id === "scratch-b");
    expect(entries).toEqual([{ id: "scratch-b", kind: "managed", label: "Second" }]);
    expect(createRegisteredProvider("scratch-b", ctx).id).toBe("second");
  });

  it("registration is case-insensitive too: a mixed-case id replaces / resolves the same key", () => {
    registerProvider({ id: "Scratch-C", kind: "http", label: "Mixed" }, () => fakeProvider("mixed"));
    expect(createRegisteredProvider("scratch-c", ctx).id).toBe("mixed");

    registerProvider({ id: "scratch-c", kind: "http", label: "Lower" }, () => fakeProvider("lower"));
    const entries = listProviderDescriptors().filter((d) => d.id.toLowerCase() === "scratch-c");
    expect(entries).toEqual([{ id: "scratch-c", kind: "http", label: "Lower" }]);
    expect(createRegisteredProvider("SCRATCH-C", ctx).id).toBe("lower");
  });
});
