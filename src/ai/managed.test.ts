// ManagedProvider integration tests (G-A3a) — the whole point of this suite is
// that the provider talks to the REAL gateway app (src/gateway/app.ts booted on
// an ephemeral port over real HTTP + Node's global fetch), with the same
// in-memory G-A1 core the gateway's own tests use: MockModelProvider as the
// orchestrator (deterministic replies), MockSmsSender (codes are readable),
// MockPaymentAdapter, a fixed clock. Nothing is stubbed between the provider
// and the wire, so the SSE framing, auth header, and error-status mapping are
// exercised end to end.

import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGatewayApp, type GatewayConfig } from "../gateway/app";
import { AuthService, InMemoryAuthStore, InMemorySessionStore, MockSmsSender } from "../gateway/auth";
import { CreditsLedger } from "../gateway/ledger";
import { InMemoryLedgerStore } from "../gateway/ledgerStore";
import { MockPaymentAdapter } from "../gateway/payments";
import { DEFAULT_PRICING, Pricing } from "../gateway/pricing";
import { createRegisteredProvider, listProviderDescriptors } from "./index";
import {
  InsufficientCreditsError,
  ManagedAuthError,
  ManagedGatewayError,
  ManagedNotConfiguredError,
  ManagedProvider,
  readSseStream,
  type SseEvent
} from "./managed";
import { MockModelProvider } from "./mockProvider";
import type { ChatRequest, ModelProvider } from "./provider";

const PHONE = "+8613800138000";
const OTHER_PHONE = "+8613900139000";

// DEFAULT_PRICING (1 credit / 1k text tokens) + the default 8192-token per-run
// ceiling → every hold pre-authorizes ceil(8.192) = 9 credits (the same
// constant the gateway's own tests pin).
const DEFAULT_HELD = 9;

type Harness = {
  baseUrl: string;
  sms: MockSmsSender;
  ledger: CreditsLedger;
  close: () => Promise<void>;
};

// Every booted gateway registers here; one afterAll tears them all down.
const openGateways: Harness[] = [];
afterAll(async () => {
  await Promise.all(openGateways.map((gateway) => gateway.close()));
});

function bootGateway(
  overrides: { orchestrator?: ModelProvider; config?: Partial<GatewayConfig> } = {}
): Promise<Harness> {
  const now = () => 1_000_000; // fixed clock — nothing in these tests advances time
  const sms = new MockSmsSender();
  const auth = new AuthService({
    now,
    sms,
    authStore: new InMemoryAuthStore(),
    sessionStore: new InMemorySessionStore(),
    accessTokenKey: "managed-provider-test-hmac-key"
  });
  const ledger = new CreditsLedger({ store: new InMemoryLedgerStore(), now });
  const app = createGatewayApp({
    ledger,
    auth,
    pricing: new Pricing(DEFAULT_PRICING),
    orchestrator: overrides.orchestrator ?? new MockModelProvider(),
    payments: new MockPaymentAdapter(),
    now,
    config: {
      signupBonusCredits: 1000, // generous default economy; tests override to drain
      topupSkus: [],
      allowMockPay: true,
      ...overrides.config
    }
  });
  return new Promise((resolve) => {
    const server: Server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      const harness: Harness = {
        baseUrl: `http://127.0.0.1:${port}`,
        sms,
        ledger,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
            // fetch keeps pooled keep-alive sockets open; kill them so close()
            // resolves promptly instead of waiting out undici's idle timeout.
            server.closeAllConnections();
          })
      };
      openGateways.push(harness);
      resolve(harness);
    });
  });
}

type Session = { userId: string; accessToken: string; refreshToken: string; isNewUser: boolean };

// Mint a REAL session over raw HTTP: request-code → read the code from the
// MockSmsSender → verify. Raw fetch (not the provider) keeps auth independent.
async function login(gateway: Harness, phone = PHONE): Promise<Session> {
  const requested = await fetch(`${gateway.baseUrl}/auth/request-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone })
  });
  expect(requested.status).toBe(204);
  const code = gateway.sms.lastCodeFor(phone);
  expect(code).toBeTruthy();
  const verified = await fetch(`${gateway.baseUrl}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, code })
  });
  expect(verified.status).toBe(200);
  return (await verified.json()) as Session;
}

/** Raw balance read (GET /me/balance) — the ledger truth the provider can't fake. */
async function getBalance(gateway: Harness, accessToken: string): Promise<number> {
  const res = await fetch(`${gateway.baseUrl}/me/balance`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { balance: number }).balance;
}

function makeProvider(gateway: Harness, token: string | null): ManagedProvider {
  return new ManagedProvider({ gatewayBaseUrl: gateway.baseUrl, getSessionToken: () => token });
}

function chatRequest(question = "Summarize this passage."): ChatRequest {
  return {
    messages: [{ role: "user", content: question }],
    context: { sourceTitle: "Physics", quote: "F = ma" }
  };
}

// The gateway's orchestrator is the deterministic mock, so the EXACT expected
// reply is computable locally from the same provider class.
async function mockReply(request: ChatRequest): Promise<string> {
  return (await new MockModelProvider().complete(request)).message.content;
}

// The gateway's G-A2 metering approximation: tokens ≈ ceil(chars/4), priced at
// 1 credit / 1k tokens (DEFAULT_PRICING), settle capped at the hold.
function expectedSettle(reply: string, held = DEFAULT_HELD): number {
  return Math.min(Math.ceil(Math.ceil(reply.length / 4) / 1000), held);
}

const MOCK_CAPS = {
  chat: true,
  agentic: false,
  streaming: true,
  structured: false,
  tools: false,
  kind: "mock"
} as const;

describe("ManagedProvider — against the real gateway app", () => {
  let gateway: Harness;
  let session: Session;

  beforeAll(async () => {
    gateway = await bootGateway();
    session = await login(gateway);
  });

  it("mints a real session over raw HTTP (request-code → SMS code → verify)", async () => {
    const fresh = await login(gateway, OTHER_PHONE);
    expect(fresh.userId).toMatch(/^usr_[0-9a-f]{16}$/);
    expect(fresh.accessToken.length).toBeGreaterThan(0);
    expect(fresh.isNewUser).toBe(true);
  });

  it("complete() consumes the SSE stream fully and returns the done message; the settle lands on the balance", async () => {
    const provider = makeProvider(gateway, session.accessToken);
    const request = chatRequest();
    const expected = await mockReply(request);

    const before = await getBalance(gateway, session.accessToken);
    const response = await provider.complete(request);
    expect(response.message).toEqual({ role: "assistant", content: expected });

    const after = await getBalance(gateway, session.accessToken);
    expect(before - after).toBe(expectedSettle(expected)); // dropped by exactly the settled amount
  });

  it("stream() yields deltas whose concatenation equals the complete() text", async () => {
    const provider = makeProvider(gateway, session.accessToken);
    const request = chatRequest("What does the quote mean?");
    const deltas: string[] = [];
    for await (const delta of provider.stream(request)) deltas.push(delta);
    expect(deltas.length).toBeGreaterThan(1); // genuinely streamed, not one blob
    expect(deltas.join("")).toBe(await mockReply(request));
  });

  it("drained balance → InsufficientCreditsError{needed,balance}; nothing is consumed by the rejection", async () => {
    // Tiny economy: 3-credit bonus + 500-token ceiling → 1-credit holds; the
    // short mock reply settles 1 credit per run, so three runs drain to zero.
    const tiny = await bootGateway({ config: { signupBonusCredits: 3, maxTextTokensPerRun: 500 } });
    const drained = await login(tiny);
    const provider = makeProvider(tiny, drained.accessToken);
    for (let run = 0; run < 3; run++) await provider.complete(chatRequest("drain"));
    expect(await getBalance(tiny, drained.accessToken)).toBe(0);
    const entriesBefore = (await tiny.ledger.entries(drained.userId)).length;

    const error = await provider.complete(chatRequest("one more")).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InsufficientCreditsError);
    const insufficient = error as InsufficientCreditsError;
    expect(insufficient.needed).toBe(1); // the 500-token hold estimate
    expect(insufficient.balance).toBe(0);

    // stream() maps the same 402 (the rejection happens before any SSE byte)
    const drainStream = async () => {
      for await (const _ of provider.stream(chatRequest())) {
        // no deltas expected
      }
    };
    await expect(drainStream()).rejects.toBeInstanceOf(InsufficientCreditsError);

    // NO tokens were consumed: balance unchanged, not even a hold appended.
    expect(await getBalance(tiny, drained.accessToken)).toBe(0);
    expect((await tiny.ledger.entries(drained.userId)).length).toBe(entriesBefore);
  });

  it("a bad session token → ManagedAuthError (gateway 401) from both complete() and stream()", async () => {
    const provider = makeProvider(gateway, "not-a-real-token");
    await expect(provider.complete(chatRequest())).rejects.toBeInstanceOf(ManagedAuthError);
    const drainStream = async () => {
      for await (const _ of provider.stream(chatRequest())) {
        // unreachable
      }
    };
    await expect(drainStream()).rejects.toBeInstanceOf(ManagedAuthError);
  });

  it("unconfigured (no token / no baseUrl) → ManagedNotConfiguredError without touching the network", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("an unconfigured ManagedProvider must not touch the network");
    }) as typeof fetch;
    try {
      const noToken = new ManagedProvider({
        gatewayBaseUrl: "http://127.0.0.1:9",
        getSessionToken: () => null
      });
      await expect(noToken.complete(chatRequest())).rejects.toBeInstanceOf(ManagedNotConfiguredError);
      await expect(noToken.complete(chatRequest())).rejects.toThrow(/log in/);
      // stream() checks config synchronously — before iteration, before fetch.
      expect(() => noToken.stream(chatRequest())).toThrow(ManagedNotConfiguredError);

      const noUrl = new ManagedProvider({ gatewayBaseUrl: "   ", getSessionToken: () => "tok" });
      await expect(noUrl.complete(chatRequest())).rejects.toBeInstanceOf(ManagedNotConfiguredError);
      await expect(noUrl.complete(chatRequest())).rejects.toThrow(/gateway URL/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("gateway `event: error` mid-stream → ManagedGatewayError after the partial deltas", async () => {
    const midStreamFailer: ModelProvider = {
      id: "fail-mid-stream",
      capabilities: MOCK_CAPS,
      complete: async () => {
        throw new Error("complete unused");
      },
      stream: async function* () {
        yield "partial ";
        yield "output";
        throw new Error("vendor exploded mid-stream");
      }
    };
    const failing = await bootGateway({ orchestrator: midStreamFailer });
    const failSession = await login(failing);
    const provider = makeProvider(failing, failSession.accessToken);

    const deltas: string[] = [];
    let caught: unknown;
    try {
      for await (const delta of provider.stream(chatRequest())) deltas.push(delta);
    } catch (error) {
      caught = error;
    }
    expect(deltas).toEqual(["partial ", "output"]);
    expect(caught).toBeInstanceOf(ManagedGatewayError);
    expect((caught as ManagedGatewayError).code).toBe("run_failed");
    expect((caught as ManagedGatewayError).message).toContain("vendor exploded");

    // complete() surfaces the same failure instead of fabricating a reply.
    await expect(provider.complete(chatRequest())).rejects.toBeInstanceOf(ManagedGatewayError);
  });

  it("orchestrator down before the first chunk → gateway 5xx JSON → ManagedGatewayError with status/code", async () => {
    const down: ModelProvider = {
      id: "down",
      capabilities: { ...MOCK_CAPS, streaming: false },
      complete: async () => {
        throw new Error("vendor down");
      }
    };
    const broken = await bootGateway({ orchestrator: down });
    const brokenSession = await login(broken);
    const provider = makeProvider(broken, brokenSession.accessToken);
    const error = await provider.complete(chatRequest()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ManagedGatewayError);
    expect((error as ManagedGatewayError).status).toBe(500);
    expect((error as ManagedGatewayError).code).toBe("internal_error");
    expect((error as ManagedGatewayError).message).toContain("vendor down");
  });
});

describe("ManagedProvider — registry (src/ai/index.ts)", () => {
  it("is listed with the agreed id/kind/label", () => {
    const byId = new Map(listProviderDescriptors().map((descriptor) => [descriptor.id, descriptor]));
    expect(byId.get("managed")).toEqual({ id: "managed", kind: "managed", label: "Managed (托管积分)" });
  });

  it("createRegisteredProvider('managed') with both env vars returns a WORKING provider", async () => {
    const gateway = await bootGateway();
    const session = await login(gateway);
    const provider = createRegisteredProvider("managed", {
      env: {
        STUDY_VAULT_MANAGED_GATEWAY_URL: gateway.baseUrl,
        STUDY_VAULT_MANAGED_TOKEN: session.accessToken
      }
    });
    expect(provider).toBeInstanceOf(ManagedProvider);
    expect(provider.capabilities).toEqual({
      chat: true,
      agentic: false,
      streaming: true,
      structured: false,
      tools: false,
      kind: "managed"
    });
    const request = chatRequest("Registry roundtrip?");
    expect((await provider.complete(request)).message.content).toBe(await mockReply(request));
  });

  it("without the env vars it constructs (listable in pickers) but first use throws NotConfigured", async () => {
    const provider = createRegisteredProvider("managed", { env: {} });
    expect(provider).toBeInstanceOf(ManagedProvider);
    await expect(provider.complete(chatRequest())).rejects.toBeInstanceOf(ManagedNotConfiguredError);
  });
});

describe("readSseStream — framing survives arbitrary chunk boundaries", () => {
  function byteStream(text: string, chunkSize: number): ReadableStream<Uint8Array> {
    const bytes = new TextEncoder().encode(text);
    let offset = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= bytes.length) {
          controller.close();
          return;
        }
        controller.enqueue(bytes.slice(offset, offset + chunkSize));
        offset += chunkSize;
      }
    });
  }

  const wire =
    'event: chunk\ndata: {"delta":"你好 "}\n\n' +
    ": keep-alive\n\n" +
    'event: done\ndata: {"message":{"role":"assistant","content":"你好 world"}}\n\n';

  it("1-byte chunks (splitting multi-byte UTF-8 and field lines) parse identically to one blob", async () => {
    for (const chunkSize of [1, 3, 7, wire.length]) {
      const events: SseEvent[] = [];
      for await (const event of readSseStream(byteStream(wire, chunkSize))) events.push(event);
      expect(events).toEqual([
        { event: "chunk", data: '{"delta":"你好 "}' },
        { event: "done", data: '{"message":{"role":"assistant","content":"你好 world"}}' }
      ]);
    }
  });

  it("tolerates CRLF framing and a missing final blank line", async () => {
    const crlf =
      'event: chunk\r\ndata: {"delta":"a"}\r\n\r\nevent: done\r\ndata: {"message":{"content":"a"}}';
    const events: SseEvent[] = [];
    for await (const event of readSseStream(byteStream(crlf, 5))) events.push(event);
    expect(events).toEqual([
      { event: "chunk", data: '{"delta":"a"}' },
      { event: "done", data: '{"message":{"content":"a"}}' }
    ]);
  });
});
