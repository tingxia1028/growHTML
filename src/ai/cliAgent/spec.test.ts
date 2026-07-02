import { describe, expect, it } from "vitest";
import type { ChatRequest } from "../provider";
import {
  buildCleanEnv,
  flattenPrompt,
  probeCliVersion,
  shapeTurn,
  turnPrompt,
  type SpawnedProbe,
  type SpawnProbeFn
} from "./spec";

describe("buildCleanEnv (invariant 1 — generalized metered-key strip)", () => {
  it("strips exactly the listed keys and preserves the rest", () => {
    const env = buildCleanEnv(
      { ANTHROPIC_API_KEY: "sk-secret", ANTHROPIC_AUTH_TOKEN: "tok", PATH: "/usr/bin", HOME: "/home/u" },
      ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]
    );
    expect(env).toEqual({ PATH: "/usr/bin", HOME: "/home/u" });
    expect("ANTHROPIC_API_KEY" in env).toBe(false);
    expect("ANTHROPIC_AUTH_TOKEN" in env).toBe(false);
  });

  it("is per-CLI: a different strip list leaves other vendors' keys alone", () => {
    const env = buildCleanEnv({ OPENAI_API_KEY: "sk-oai", ANTHROPIC_API_KEY: "sk-ant" }, ["OPENAI_API_KEY"]);
    expect(env).toEqual({ ANTHROPIC_API_KEY: "sk-ant" });
  });

  it("with no strip keys, copies everything", () => {
    expect(buildCleanEnv({ A: "1", B: "2" }, [])).toEqual({ A: "1", B: "2" });
  });

  it("drops undefined values (both SDK env options require string values)", () => {
    const env = buildCleanEnv({ PATH: "/usr/bin", GONE: undefined }, []);
    expect(env).toEqual({ PATH: "/usr/bin" });
  });

  it("does not mutate the base env", () => {
    const base: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY: "sk-secret", PATH: "/usr/bin" };
    buildCleanEnv(base, ["ANTHROPIC_API_KEY"]);
    expect(base).toEqual({ ANTHROPIC_API_KEY: "sk-secret", PATH: "/usr/bin" });
  });
});

const context = {
  sourceTitle: "Render Thread",
  sourceType: "article",
  location: "https://example.com/render",
  quote: "submits rendering commands",
  contextBefore: "The render thread ",
  contextAfter: " to the GPU."
};

describe("prompt shaping (mirrors the legacy claudeCliProvider context weaving)", () => {
  it("turnPrompt on the first turn carries source block, passage block, and the question", () => {
    const request: ChatRequest = { messages: [{ role: "user", content: "What does it do?" }], context };
    const prompt = turnPrompt(request, true);
    expect(prompt).toBe(
      "Source: Render Thread (article)\nLocation: https://example.com/render" +
        "\n\nSelected passage (between ⟦⟧, with surrounding context):\n…The render thread ⟦submits rendering commands⟧ to the GPU.…" +
        "\n\nWhat does it do?"
    );
  });

  it("turnPrompt on later turns drops the source identity but keeps the (possibly new) passage", () => {
    const request: ChatRequest = {
      messages: [
        { role: "user", content: "What does it do?" },
        { role: "assistant", content: "It submits commands." },
        { role: "user", content: "To what?" }
      ],
      context
    };
    const prompt = turnPrompt(request, false);
    expect(prompt).not.toContain("Source:");
    expect(prompt).toContain("⟦submits rendering commands⟧");
    expect(prompt.endsWith("To what?")).toBe(true);
  });

  it("flattenPrompt replays the full transcript with role labels", () => {
    const request: ChatRequest = {
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "Q1" },
        { role: "assistant", content: "A1" },
        { role: "user", content: "Q2" }
      ],
      context
    };
    const prompt = flattenPrompt(request);
    expect(prompt).toContain("Source: Render Thread (article)");
    expect(prompt).toContain("SYSTEM: Be brief.");
    expect(prompt).toContain("USER: Q1");
    expect(prompt).toContain("ASSISTANT: A1");
    expect(prompt.endsWith("USER: Q2")).toBe(true);
  });

  it("shapeTurn: first turn → fresh session with the single-turn prompt", () => {
    const request: ChatRequest = { messages: [{ role: "user", content: "Q1" }] };
    expect(shapeTurn(request, false)).toEqual({ resuming: false, prompt: "Q1" });
    // Even with a stale live session, a single-user-turn request is a fresh chat.
    expect(shapeTurn(request, true)).toEqual({ resuming: false, prompt: "Q1" });
  });

  it("shapeTurn: later turn with a live session → resume with just the new message", () => {
    const request: ChatRequest = {
      messages: [
        { role: "user", content: "Q1" },
        { role: "assistant", content: "A1" },
        { role: "user", content: "Q2" }
      ]
    };
    expect(shapeTurn(request, true)).toEqual({ resuming: true, prompt: "Q2" });
  });

  it("shapeTurn: later turn but session lost → fresh session seeded with the transcript", () => {
    const request: ChatRequest = {
      messages: [
        { role: "user", content: "Q1" },
        { role: "assistant", content: "A1" },
        { role: "user", content: "Q2" }
      ]
    };
    expect(shapeTurn(request, false)).toEqual({
      resuming: false,
      prompt: "USER: Q1\n\nASSISTANT: A1\n\nUSER: Q2"
    });
  });
});

// A minimal scripted child process — probeCliVersion must never spawn for real.
type Listener = (...args: never[]) => void;
class FakeChild implements SpawnedProbe {
  killed = false;
  private listeners = new Map<string, Listener[]>();
  private stdoutListeners: Array<(chunk: unknown) => void> = [];
  stdout = {
    on: (event: "data", listener: (chunk: unknown) => void) => {
      if (event === "data") this.stdoutListeners.push(listener);
      return this;
    }
  };
  on(event: string, listener: Listener): this {
    const bucket = this.listeners.get(event) ?? [];
    bucket.push(listener);
    this.listeners.set(event, bucket);
    return this;
  }
  kill(): void {
    this.killed = true;
  }
  emitStdout(chunk: string): void {
    for (const listener of this.stdoutListeners) listener(chunk);
  }
  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) (listener as (...a: unknown[]) => void)(...args);
  }
}

function fakeSpawn(script: (child: FakeChild) => void): { spawnFn: SpawnProbeFn; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const spawnFn: SpawnProbeFn = (command, args, options) => {
    calls.push([command, args, options]);
    const child = new FakeChild();
    queueMicrotask(() => script(child));
    return child;
  };
  return { spawnFn, calls };
}

describe("probeCliVersion (injectable detect — no real CLI ever spawned)", () => {
  it("reports ok+version when the binary exits 0", async () => {
    const { spawnFn, calls } = fakeSpawn((child) => {
      child.emitStdout("1.2.3\n");
      child.emit("close", 0);
    });
    await expect(probeCliVersion("claude", { spawnFn })).resolves.toEqual({ ok: true, version: "1.2.3" });
    expect(calls).toEqual([
      ["claude", ["--version"], { shell: process.platform === "win32", windowsHide: true }]
    ]);
  });

  it("reports not-ok on a non-zero exit", async () => {
    const { spawnFn } = fakeSpawn((child) => child.emit("close", 1));
    await expect(probeCliVersion("codex", { spawnFn })).resolves.toEqual({ ok: false });
  });

  it("reports not-ok when spawning errors (binary missing)", async () => {
    const { spawnFn } = fakeSpawn((child) => child.emit("error", new Error("ENOENT")));
    await expect(probeCliVersion("codex", { spawnFn })).resolves.toEqual({ ok: false });
  });

  it("times out (and kills the probe) when the binary hangs", async () => {
    let hung: FakeChild | null = null;
    const { spawnFn } = fakeSpawn((child) => {
      hung = child; // never emits close
    });
    await expect(probeCliVersion("claude", { spawnFn, timeoutMs: 10 })).resolves.toEqual({ ok: false });
    expect(hung!.killed).toBe(true);
  });

  it("omits the version when a zero exit printed nothing", async () => {
    const { spawnFn } = fakeSpawn((child) => child.emit("close", 0));
    await expect(probeCliVersion("claude", { spawnFn })).resolves.toEqual({ ok: true });
  });
});
