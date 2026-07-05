// ManagedGatewayClient (G-A3b) integration tests — the settings-panel client for the
// managed gateway's ACCOUNT + PAYMENT routes, exercised against the REAL mock gateway
// app (src/gateway/app.ts) booted on an ephemeral port over real HTTP + global fetch,
// the same in-memory G-A2 core the provider tests use (MockSmsSender, MockPaymentAdapter,
// a fixed clock). Nothing is stubbed between the client and the wire.
//
// Pinned: signup bonus balance = 1000 on first login; code login via MockSmsSender;
// top-up via MockPaymentAdapter + /topup/mock-notify credits (idempotent); refresh-on-401
// rotates the token and retries; a missing/failed session surfaces the typed
// not-logged-in error (the UI's 登录 affordance, never a hang).

import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { createGatewayApp, type GatewayConfig } from "../../gateway/app";
import { AuthService, InMemoryAuthStore, InMemorySessionStore, MockSmsSender } from "../../gateway/auth";
import { CreditsLedger } from "../../gateway/ledger";
import { InMemoryLedgerStore } from "../../gateway/ledgerStore";
import { MockPaymentAdapter } from "../../gateway/payments";
import { DEFAULT_PRICING, Pricing } from "../../gateway/pricing";
import { MockModelProvider } from "../../ai/mockProvider";
import type { ManagedSession } from "./aiProviders";
import {
  ManagedGatewayClient,
  ManagedGatewayNotConfiguredError,
  ManagedGatewayNotLoggedInError,
  ManagedGatewayRequestError
} from "./managedGateway";

const PHONE = "+8613800138000";
const TOPUP_SKU = "pack_30";

type Harness = { baseUrl: string; sms: MockSmsSender; ledger: CreditsLedger; close: () => Promise<void> };

const openGateways: Harness[] = [];
afterAll(async () => {
  await Promise.all(openGateways.map((gateway) => gateway.close()));
});

function bootGateway(overrides: { config?: Partial<GatewayConfig> } = {}): Promise<Harness> {
  const now = () => 1_000_000;
  const sms = new MockSmsSender();
  const auth = new AuthService({
    now,
    sms,
    authStore: new InMemoryAuthStore(),
    sessionStore: new InMemorySessionStore(),
    accessTokenKey: "managed-gateway-client-test-hmac-key"
  });
  const ledger = new CreditsLedger({ store: new InMemoryLedgerStore(), now });
  const app = createGatewayApp({
    ledger,
    auth,
    pricing: new Pricing(DEFAULT_PRICING),
    orchestrator: new MockModelProvider(),
    payments: new MockPaymentAdapter(),
    now,
    config: {
      signupBonusCredits: 1000,
      topupSkus: [{ sku: TOPUP_SKU, amountYuan: 30, credits: 300 }],
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
            server.closeAllConnections();
          })
      };
      openGateways.push(harness);
      resolve(harness);
    });
  });
}

/** A keyStore-backed session slot the client reads/persists through (in-memory here). */
function sessionSlot(initial: ManagedSession | null = null) {
  let session = initial;
  return {
    get: () => session,
    getSession: async () => session,
    saveSession: async (next: ManagedSession) => {
      session = next;
    }
  };
}

function makeClient(gateway: Harness, slot: ReturnType<typeof sessionSlot>): ManagedGatewayClient {
  return new ManagedGatewayClient({
    baseUrl: gateway.baseUrl,
    getSession: slot.getSession,
    saveSession: slot.saveSession
  });
}

/** Full login through the client: request-code → read the mock SMS → verify (persists the session). */
async function loginViaClient(gateway: Harness, slot: ReturnType<typeof sessionSlot>): Promise<void> {
  const client = makeClient(gateway, slot);
  await client.requestCode(PHONE);
  const code = gateway.sms.lastCodeFor(PHONE)!;
  expect(code).toBeTruthy();
  await client.verify(PHONE, code);
}

describe("ManagedGatewayClient — login + balance against the real gateway", () => {
  it("request-code → verify persists the session and the signup bonus lands (balance = 1000)", async () => {
    const gateway = await bootGateway();
    const slot = sessionSlot();
    const client = makeClient(gateway, slot);

    await client.requestCode(PHONE);
    const code = gateway.sms.lastCodeFor(PHONE)!;
    const verify = await client.verify(PHONE, code);
    expect(verify.userId).toMatch(/^usr_[0-9a-f]{16}$/);
    expect(verify.isNewUser).toBe(true);
    // The session (access + refresh) was PERSISTED through saveSession.
    expect(slot.get()?.accessToken.length).toBeGreaterThan(0);
    expect(slot.get()?.refreshToken?.length).toBeGreaterThan(0);

    const balance = await client.getBalance();
    expect(balance.balance).toBe(1000);
    expect(balance.recent[0]).toMatchObject({ kind: "signup_bonus", amount: 1000 });
  });

  it("getBalance with no stored session → ManagedGatewayNotLoggedInError (the 登录 affordance)", async () => {
    const gateway = await bootGateway();
    const client = makeClient(gateway, sessionSlot());
    await expect(client.getBalance()).rejects.toBeInstanceOf(ManagedGatewayNotLoggedInError);
  });

  it("an empty baseUrl → ManagedGatewayNotConfiguredError before any fetch", async () => {
    const client = new ManagedGatewayClient({
      baseUrl: "   ",
      getSession: async () => ({ accessToken: "t" }),
      saveSession: async () => undefined
    });
    await expect(client.getBalance()).rejects.toBeInstanceOf(ManagedGatewayNotConfiguredError);
  });
});

describe("ManagedGatewayClient — top-up (MockPaymentAdapter + /topup/mock-notify, idempotent)", () => {
  it("createTopup returns a QR order; mockNotify credits it once; a replay credits nothing extra", async () => {
    const gateway = await bootGateway();
    const slot = sessionSlot();
    await loginViaClient(gateway, slot);
    const client = makeClient(gateway, slot);

    const order = await client.createTopup(TOPUP_SKU);
    expect(order.paymentId).toMatch(/^pay_/);
    expect(order.qrPayload).toContain("mockpay://");
    expect(order.credits).toBe(300);

    expect((await client.getBalance()).balance).toBe(1000); // not yet credited
    await client.mockNotify(order.paymentId);
    expect((await client.getBalance()).balance).toBe(1300); // credited once

    // Idempotency: the webhook redelivery grants nothing extra (payment:<id> key).
    await client.mockNotify(order.paymentId);
    expect((await client.getBalance()).balance).toBe(1300);
  });

  it("an unknown sku → ManagedGatewayRequestError (mapped from the gateway 400)", async () => {
    const gateway = await bootGateway();
    const slot = sessionSlot();
    await loginViaClient(gateway, slot);
    const error = await makeClient(gateway, slot)
      .createTopup("does-not-exist")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ManagedGatewayRequestError);
    expect((error as ManagedGatewayRequestError).status).toBe(400);
  });
});

describe("ManagedGatewayClient — refresh-on-401 (delta 5)", () => {
  it("a stale access token + a valid refresh token → refresh rotates + persists, the read retries and succeeds", async () => {
    const gateway = await bootGateway();
    const good = sessionSlot();
    await loginViaClient(gateway, good);
    const real = good.get()!;

    // Simulate an EXPIRED access token: keep the valid refresh token so the client's
    // refresh-on-401 can rotate. The stale access is rejected 401 by the gateway.
    const slot = sessionSlot({ accessToken: "stale-access-token", refreshToken: real.refreshToken });
    const client = makeClient(gateway, slot);

    const balance = await client.getBalance();
    expect(balance.balance).toBe(1000); // the retried request succeeded
    // The rotated pair was PERSISTED (the stale access token is gone).
    expect(slot.get()?.accessToken).not.toBe("stale-access-token");
    expect(slot.get()?.accessToken.length).toBeGreaterThan(0);
  });

  it("a stale access token AND an invalid refresh token → ManagedGatewayNotLoggedInError (re-login)", async () => {
    const gateway = await bootGateway();
    const slot = sessionSlot({ accessToken: "stale", refreshToken: "not-a-real-refresh-token" });
    await expect(makeClient(gateway, slot).getBalance()).rejects.toBeInstanceOf(ManagedGatewayNotLoggedInError);
  });
});
