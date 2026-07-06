// Managed-gateway ROUTES (G-A3b) — the end-to-end wiring through createApp: the
// client seams (/api/ai/providers/:id/managed/*) drive a server-side
// ManagedGatewayClient, whose transport is pointed (via aiConfig.managedGatewayFetch)
// at an in-process mock gateway. The session token is stored ENCRYPTED via the
// injected keyStore and NEVER returned to the caller — the routes only ever answer
// booleans + balances. Also pins: activating managed with a stored token makes the
// active provider functional (config source), and the sessionSet view flag flips.

import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { type StudyVault } from "../core/vault";
import { openTestVault } from "../core/testing/openTestVault";
import { createGatewayApp } from "../gateway/app";
import { AuthService, InMemoryAuthStore, InMemorySessionStore, MockSmsSender } from "../gateway/auth";
import { CreditsLedger } from "../gateway/ledger";
import { InMemoryLedgerStore } from "../gateway/ledgerStore";
import { MockPaymentAdapter } from "../gateway/payments";
import { DEFAULT_PRICING, Pricing } from "../gateway/pricing";
import { MockModelProvider } from "../ai/mockProvider";
import type { KeyStore } from "./keyStore";
import { createApp } from "./app";

const PHONE = "+8613800138000";
const SKU = "pack_30";

type Gateway = { baseUrl: string; sms: MockSmsSender; close: () => Promise<void> };
const openGateways: Gateway[] = [];
afterAll(async () => {
  await Promise.all(openGateways.map((g) => g.close()));
});

function bootGateway(): Promise<Gateway> {
  const now = () => 1_000_000;
  const sms = new MockSmsSender();
  const auth = new AuthService({
    now,
    sms,
    authStore: new InMemoryAuthStore(),
    sessionStore: new InMemorySessionStore(),
    accessTokenKey: "managed-routes-test-hmac-key"
  });
  const app = createGatewayApp({
    ledger: new CreditsLedger({ store: new InMemoryLedgerStore(), now }),
    auth,
    pricing: new Pricing(DEFAULT_PRICING),
    orchestrator: new MockModelProvider(),
    payments: new MockPaymentAdapter(),
    now,
    config: { signupBonusCredits: 1000, topupSkus: [{ sku: SKU, amountYuan: 30, credits: 300 }], allowMockPay: true }
  });
  return new Promise((resolve) => {
    const server: Server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      const gw: Gateway = {
        baseUrl: `http://127.0.0.1:${port}`,
        sms,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
            server.closeAllConnections();
          })
      };
      openGateways.push(gw);
      resolve(gw);
    });
  });
}

/** An in-memory persistent KeyStore (safeStorage stand-in). Captures its ref set for assertions. */
function memoryKeyStore(): KeyStore & { snapshot: () => Record<string, string> } {
  const keys = new Map<string, string>();
  return {
    status: () => ({ kind: "safe-storage", persistent: true }),
    getKey: async (ref) => keys.get(ref) ?? null,
    hasKey: async (ref) => keys.has(ref),
    setKey: async (ref, value) => {
      keys.set(ref, value);
    },
    deleteKey: async (ref) => {
      keys.delete(ref);
    },
    snapshot: () => Object.fromEntries(keys)
  };
}

let tempDir = "";
let vault: StudyVault;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "study-vault-managed-routes-"));
  vault = await openTestVault({ rootDir: path.join(tempDir, "vault") });
});

afterEach(async () => {
  // STORE-SQL Stage-3: release the vault's sqlite handles before rm (no-op on jsonl).
  vault?.close();
  await rm(tempDir, { recursive: true, force: true });
});

async function appWithManaged(gateway: Gateway, keyStore: KeyStore) {
  const app = createApp({
    vault,
    aiConfig: {
      dir: path.join(tempDir, "ai"),
      keyStore,
      managedGatewayFetch: fetch // the routes' ManagedGatewayClient talks to the in-process gateway
    }
  });
  // Seed a managed config entry pointing at the in-process gateway.
  await request(app)
    .put("/api/ai/providers/config")
    .send({ providers: [{ id: "managed-1", kind: "managed", preset: "managed", baseUrl: gateway.baseUrl }] })
    .expect(200);
  return app;
}

describe("managed routes — login persists an ENCRYPTED session, never echoing the token", () => {
  it("request-code → verify stores the session under the keyStore blob (not ai-providers.json) and never returns it", async () => {
    const gateway = await bootGateway();
    const keyStore = memoryKeyStore();
    const app = await appWithManaged(gateway, keyStore);

    await request(app).post("/api/ai/providers/managed-1/managed/request-code").send({ phone: PHONE }).expect(200);
    const code = gateway.sms.lastCodeFor(PHONE)!;
    const verify = await request(app)
      .post("/api/ai/providers/managed-1/managed/verify")
      .send({ phone: PHONE, code })
      .expect(200);
    expect(verify.body).toMatchObject({ ok: true, isNewUser: true });
    // The RESPONSE never carries token material.
    expect(JSON.stringify(verify.body)).not.toMatch(/accessToken|refreshToken/);

    // The token IS stored — under the managed session keyRef in the keyStore blob.
    const stored = keyStore.snapshot();
    expect(stored).toHaveProperty("managed_session_managed-1");
    // The stored blob holds the tokens (encrypted at rest by the real SafeStorageKeyStore;
    // this in-memory stand-in holds the plaintext JSON — the point is it's the KEY file, not
    // ai-providers.json).
    expect(stored["managed_session_managed-1"]).toContain("accessToken");
  });

  it("the config view flips sessionSet true after login (登录 → 已登录), token never present", async () => {
    const gateway = await bootGateway();
    const app = await appWithManaged(gateway, memoryKeyStore());

    const before = await request(app).get("/api/ai/providers").expect(200);
    const managedBefore = before.body.config.providers.find((p: { id: string }) => p.id === "managed-1");
    expect(managedBefore.sessionSet).toBe(false);

    await request(app).post("/api/ai/providers/managed-1/managed/request-code").send({ phone: PHONE }).expect(200);
    const code = gateway.sms.lastCodeFor(PHONE)!;
    await request(app).post("/api/ai/providers/managed-1/managed/verify").send({ phone: PHONE, code }).expect(200);

    const after = await request(app).get("/api/ai/providers").expect(200);
    const managedAfter = after.body.config.providers.find((p: { id: string }) => p.id === "managed-1");
    expect(managedAfter.sessionSet).toBe(true);
    expect(JSON.stringify(after.body)).not.toMatch(/accessToken|refreshToken/);
  });
});

describe("managed routes — balance + top-up", () => {
  async function loggedInApp(): Promise<{ app: ReturnType<typeof createApp> }> {
    const gateway = await bootGateway();
    const app = await appWithManaged(gateway, memoryKeyStore());
    await request(app).post("/api/ai/providers/managed-1/managed/request-code").send({ phone: PHONE }).expect(200);
    const code = gateway.sms.lastCodeFor(PHONE)!;
    await request(app).post("/api/ai/providers/managed-1/managed/verify").send({ phone: PHONE, code }).expect(200);
    return { app };
  }

  it("balance reports the signup bonus (1000); top-up with mockNotify credits it", async () => {
    const { app } = await loggedInApp();

    const balance = await request(app).get("/api/ai/providers/managed-1/managed/balance").expect(200);
    expect(balance.body.balance).toBe(1000);

    const order = await request(app)
      .post("/api/ai/providers/managed-1/managed/topup")
      .send({ sku: SKU, mockNotify: true })
      .expect(200);
    expect(order.body.credits).toBe(300);
    expect(order.body.qrPayload).toContain("mockpay://");

    const after = await request(app).get("/api/ai/providers/managed-1/managed/balance").expect(200);
    expect(after.body.balance).toBe(1300);
  });

  it("balance with NO session → 401 {code:managed_not_logged_in} (the 登录 affordance, not a 500)", async () => {
    const gateway = await bootGateway();
    const app = await appWithManaged(gateway, memoryKeyStore());
    const res = await request(app).get("/api/ai/providers/managed-1/managed/balance").expect(401);
    expect(res.body.code).toBe("managed_not_logged_in");
  });

  it("logout clears the session (sessionSet flips back to false)", async () => {
    const { app } = await loggedInApp();
    await request(app).post("/api/ai/providers/managed-1/managed/logout").send({}).expect(200);
    const info = await request(app).get("/api/ai/providers").expect(200);
    const managed = info.body.config.providers.find((p: { id: string }) => p.id === "managed-1");
    expect(managed.sessionSet).toBe(false);
  });
});

describe("managed routes — activation makes the managed provider FUNCTIONAL (blocker 2 through the stack)", () => {
  it("after login + activate('managed'), the active provider streams a reply through the gateway (config source)", async () => {
    const gateway = await bootGateway();
    const app = await appWithManaged(gateway, memoryKeyStore());
    await request(app).post("/api/ai/providers/managed-1/managed/request-code").send({ phone: PHONE }).expect(200);
    const code = gateway.sms.lastCodeFor(PHONE)!;
    await request(app).post("/api/ai/providers/managed-1/managed/verify").send({ phone: PHONE, code }).expect(200);

    await request(app).put("/api/ai/providers/active").send({ activeProviderId: "managed-1" }).expect(200);

    const info = await request(app).get("/api/ai/providers").expect(200);
    expect(info.body.active).toEqual({ id: "managed", kind: "managed" });
    expect(info.body.activeSource).toBe("config");

    // A chat stream now flows through the managed provider → the gateway → the mock
    // orchestrator, ending in a `done` event (no ManagedNotConfiguredError).
    const res = await request(app)
      .post("/api/chat/stream")
      .send({ messages: [{ role: "user", content: "Hello managed" }] })
      .expect(200);
    expect(res.text).toContain("event: done");
    expect(res.text).not.toContain("not configured");
  });

  // G-A3b.3(a): the V-1 vision gate fires for an active managed provider (capabilities
  // .vision:false) BEFORE the SSE headers commit → a clean 400, NOT an in-band error
  // event. No new gate code — assertVisionSupported already runs for every provider.
  it("an image chat under active managed → VisionUnsupportedError → clean 400 (no stream)", async () => {
    const gateway = await bootGateway();
    const app = await appWithManaged(gateway, memoryKeyStore());
    await request(app).post("/api/ai/providers/managed-1/managed/request-code").send({ phone: PHONE }).expect(200);
    const code = gateway.sms.lastCodeFor(PHONE)!;
    await request(app).post("/api/ai/providers/managed-1/managed/verify").send({ phone: PHONE, code }).expect(200);
    await request(app).put("/api/ai/providers/active").send({ activeProviderId: "managed-1" }).expect(200);

    // A well-formed image REF (assetId must match asset_<ULID>); the gate fires on the
    // capability, BEFORE the asset is ever resolved, so a non-existent id is fine here.
    const res = await request(app)
      .post("/api/chat/stream")
      .send({ messages: [{ role: "user", content: [{ type: "image", assetId: "asset_0123456789ABCDEFGHJKMNPQRS" }] }] })
      .expect(400);
    // A clean JSON 400 (the capability message), never a text/event-stream body.
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.body.error).toContain("does not support image input");
  });
});
