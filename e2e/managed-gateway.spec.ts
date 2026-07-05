import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import { createGatewayApp } from "../src/gateway/app";
import { AuthService, InMemoryAuthStore, InMemorySessionStore, MockSmsSender } from "../src/gateway/auth";
import { CreditsLedger } from "../src/gateway/ledger";
import { InMemoryLedgerStore } from "../src/gateway/ledgerStore";
import { MockPaymentAdapter } from "../src/gateway/payments";
import { DEFAULT_PRICING, Pricing } from "../src/gateway/pricing";
import { MockModelProvider } from "../src/ai/mockProvider";
import { InsufficientCreditsError, ManagedProvider } from "../src/ai/managed";
import { resolveForm } from "../src/core/notes/resolveForm";

// Managed gateway (G-A3b) — the verification lock for the CLIENT wiring, run
// IN-PROCESS: a mock gateway (fixed clock, MockSmsSender, MockPaymentAdapter) booted
// inside the spec, with a real ManagedProvider (the G-A3a client, src/ai/managed.ts)
// carrying the stored session token — exactly what providerForEntry constructs for an
// active managed config entry (G-A3b.1). It never touches the shared web-server harness
// (whose STUDY_VAULT_AI_PROVIDER=mock-agent env would override config activation), so it
// stays deterministic. The heavyweight createApp is NOT imported here (its package.json
// json-import trips Playwright's ESM loader); the route-level wiring is locked by the
// vitest suite (src/server/managedRoutes.test.ts) — this e2e locks the provider→gateway
// →adaptive-note behavior the UI ultimately renders.
//
// Proven end to end:
//  1. login (request-code → SMS code → verify) mints a real session.
//  2. the managed provider streams a reply and returns a PLAIN {role:"assistant",
//     content} — the SAME shape the mock chat route emits — which the REAL core
//     resolveForm classifies into a note form exactly like the chat lane (ZERO special
//     managed path; the DOM getNoteType().render proof is already covered, provider-
//     agnostically, by streaming-chat.spec + adaptive-note-forms.spec).
//  3. a drained balance → InsufficientCreditsError (needed/balance) BEFORE any output —
//     the signal the UI turns into the 充值 top-up affordance; nothing is consumed.

const PHONE = "+8613800138000";

type GatewayHarness = { baseUrl: string; sms: MockSmsSender; balanceOf: (t: string) => Promise<number>; close: () => Promise<void> };

function bootGateway(config: { signupBonusCredits: number; maxTextTokensPerRun?: number }): Promise<GatewayHarness> {
  const now = () => 1_000_000;
  const sms = new MockSmsSender();
  const auth = new AuthService({
    now,
    sms,
    authStore: new InMemoryAuthStore(),
    sessionStore: new InMemorySessionStore(),
    accessTokenKey: "managed-e2e-hmac-key"
  });
  const app = createGatewayApp({
    ledger: new CreditsLedger({ store: new InMemoryLedgerStore(), now }),
    auth,
    pricing: new Pricing(DEFAULT_PRICING),
    orchestrator: new MockModelProvider(),
    payments: new MockPaymentAdapter(),
    now,
    config: {
      signupBonusCredits: config.signupBonusCredits,
      topupSkus: [],
      allowMockPay: true,
      maxTextTokensPerRun: config.maxTextTokensPerRun
    }
  });
  return new Promise((resolve) => {
    const server: Server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${port}`;
      resolve({
        baseUrl,
        sms,
        balanceOf: async (token) =>
          ((await (await fetch(`${baseUrl}/me/balance`, { headers: { Authorization: `Bearer ${token}` } })).json()) as {
            balance: number;
          }).balance,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
            server.closeAllConnections();
          })
      });
    });
  });
}

/** Login over the gateway's HTTP routes: request-code → read the mock SMS → verify. */
async function login(gateway: GatewayHarness): Promise<{ accessToken: string }> {
  const requested = await fetch(`${gateway.baseUrl}/auth/request-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: PHONE })
  });
  expect(requested.status).toBe(204);
  const code = gateway.sms.lastCodeFor(PHONE)!;
  expect(code).toBeTruthy();
  const verified = await fetch(`${gateway.baseUrl}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: PHONE, code })
  });
  expect(verified.status).toBe(200);
  return (await verified.json()) as { accessToken: string };
}

test("active managed streams a reply that routes through the adaptive-note pipeline (zero special path)", async () => {
  const gateway = await bootGateway({ signupBonusCredits: 1000 });
  try {
    const session = await login(gateway);
    // The provider the way providerForEntry builds it: the stored session token feeds
    // getSessionToken (the keyStore path in the app; a fixed token here).
    const provider = new ManagedProvider({ gatewayBaseUrl: gateway.baseUrl, getSessionToken: () => session.accessToken });

    // Stream: genuine chunk deltas whose concatenation equals the reply.
    const deltas: string[] = [];
    for await (const delta of provider.stream({ messages: [{ role: "user", content: "flowchart LR; A --> B" }] })) {
      deltas.push(delta);
    }
    expect(deltas.length).toBeGreaterThan(1);

    // complete() returns a PLAIN {role:"assistant", content} — the SAME shape the mock
    // chat route emits (no managed-specific wrapper).
    const { message } = await provider.complete({ messages: [{ role: "user", content: "flowchart LR; A --> B" }] });
    expect(message.role).toBe("assistant");
    const reply = message.content as string;
    expect(deltas.join("")).toBe(reply); // streamed text == completed text
    expect(reply).toContain("flowchart LR; A --> B"); // the deterministic mock echoes the ask

    // The reply routes through the REAL core adaptive-note recognizer — a managed reply
    // is just text, classified into a note form exactly like any chat reply.
    const resolved = resolveForm({ text: reply });
    expect(resolved.contentType).toBeTruthy();
  } finally {
    await gateway.close();
  }
});

test("a drained managed balance surfaces InsufficientCreditsError (the 充值 top-up affordance)", async () => {
  // A tiny economy: a 3-credit bonus + a 500-token ceiling → 1-credit holds; three short
  // runs settle it to zero, then the next run is refused BEFORE any output.
  const gateway = await bootGateway({ signupBonusCredits: 3, maxTextTokensPerRun: 500 });
  try {
    const session = await login(gateway);
    const provider = new ManagedProvider({ gatewayBaseUrl: gateway.baseUrl, getSessionToken: () => session.accessToken });

    for (let run = 0; run < 3; run++) {
      await provider.complete({ messages: [{ role: "user", content: "drain" }] });
    }
    expect(await gateway.balanceOf(session.accessToken)).toBe(0);

    // The next run is refused with InsufficientCreditsError{needed, balance} BEFORE any
    // SSE byte — the signal the settings UI turns into the 充值 top-up affordance.
    const error = await provider
      .complete({ messages: [{ role: "user", content: "one more" }] })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InsufficientCreditsError);
    expect((error as InsufficientCreditsError).balance).toBe(0);
    expect((error as InsufficientCreditsError).needed).toBeGreaterThan(0);

    // Nothing was consumed by the rejection (balance unchanged).
    expect(await gateway.balanceOf(session.accessToken)).toBe(0);
  } finally {
    await gateway.close();
  }
});
