// G-A2 gateway HTTP service tests — supertest against createGatewayApp with the
// in-memory G-A1 core (ledger/auth/pricing), the offline MockModelProvider as the
// orchestrator, MockSmsSender to read codes, MockPaymentAdapter for top-ups, and
// a fixed injected clock. Everything is deterministic and offline.

import request from "supertest";
import { describe, expect, it } from "vitest";
import { MockModelProvider } from "../ai/mockProvider";
import type { ChatRequest, ModelProvider, ProviderCapabilities } from "../ai/provider";
import { createGatewayApp, type GatewayConfig } from "./app";
import {
  AuthService,
  InMemoryAuthStore,
  InMemorySessionStore,
  MockSmsSender,
  type AuthStore
} from "./auth";
import { CreditsLedger } from "./ledger";
import { InMemoryLedgerStore } from "./ledgerStore";
import { MockPaymentAdapter } from "./payments";
import { DEFAULT_PRICING, Pricing } from "./pricing";

const PHONE = "+8613800138000";

// With DEFAULT_PRICING (text @ 1 credit / 1k tokens) and the default 8192-token
// per-run ceiling, every hold pre-authorizes ceil(8.192) = 9 credits.
const DEFAULT_HELD = 9;

interface MakeGatewayOptions {
  orchestrator?: ModelProvider;
  config?: Partial<GatewayConfig>;
  /** Make every verify report isNewUser: true (simulates a replayed verify). */
  alwaysNewUser?: boolean;
}

// Deterministic harness: manual clock shared by ledger + auth, seeded randomness.
function makeGateway(options: MakeGatewayOptions = {}) {
  let nowMs = 1_000_000;
  const now = () => nowMs;
  const sms = new MockSmsSender();
  const baseAuthStore = new InMemoryAuthStore();
  const authStore: AuthStore = options.alwaysNewUser
    ? {
        getCode: (phone) => baseAuthStore.getCode(phone),
        putCode: (record) => baseAuthStore.putCode(record),
        hasUser: async () => false, // every login looks like the first
        addUser: (userId) => baseAuthStore.addUser(userId)
      }
    : baseAuthStore;
  let byteSeq = 0;
  const auth = new AuthService({
    now,
    sms,
    authStore,
    sessionStore: new InMemorySessionStore(),
    accessTokenKey: "gateway-test-hmac-key",
    randomBytes: (size) => Buffer.alloc(size, ++byteSeq & 0xff)
  });
  const ledger = new CreditsLedger({ store: new InMemoryLedgerStore(), now });
  const payments = new MockPaymentAdapter();
  const config: GatewayConfig = {
    signupBonusCredits: 100,
    topupSkus: [
      { sku: "pack10", amountYuan: 10, credits: 1000 },
      { sku: "pack30", amountYuan: 30, credits: 3300 }
    ],
    allowMockPay: true,
    ...options.config
  };
  const app = createGatewayApp({
    ledger,
    auth,
    pricing: new Pricing(DEFAULT_PRICING),
    orchestrator: options.orchestrator ?? new MockModelProvider(),
    payments,
    now,
    config
  });
  return {
    app,
    sms,
    ledger,
    payments,
    tick: (ms: number) => {
      nowMs += ms;
    }
  };
}

type Gateway = ReturnType<typeof makeGateway>;

async function login(g: Gateway, phone = PHONE) {
  await request(g.app).post("/auth/request-code").send({ phone }).expect(204);
  const code = g.sms.lastCodeFor(phone)!;
  const verified = await request(g.app).post("/auth/verify").send({ phone, code }).expect(200);
  return verified.body as {
    userId: string;
    accessToken: string;
    refreshToken: string;
    isNewUser: boolean;
  };
}

async function getBalance(g: Gateway, accessToken: string) {
  const res = await request(g.app)
    .get("/me/balance")
    .set("Authorization", `Bearer ${accessToken}`)
    .expect(200);
  return res.body as {
    balance: number;
    recent: Array<{ id: string; kind: string; amount: number; ts: number }>;
  };
}

// Parse SSE frames (same shape as the /api/chat/stream precedent test).
function parseSse(text: string): Array<{ event: string; data: any }> {
  const events: Array<{ event: string; data: any }> = [];
  for (const frame of text.split("\n\n")) {
    if (!frame.trim()) continue;
    let event = "message";
    const data: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trim());
    }
    events.push({ event, data: JSON.parse(data.join("\n")) });
  }
  return events;
}

function streamBody(question = "Summarize this passage.") {
  return { messages: [{ role: "user", content: question }] };
}

// Wrap a provider so tests can assert exactly how many vendor calls happened.
function withCallCounter(inner: ModelProvider): { provider: ModelProvider; calls: () => number } {
  let calls = 0;
  const provider: ModelProvider = {
    id: inner.id,
    capabilities: inner.capabilities,
    complete: (req: ChatRequest) => {
      calls += 1;
      return inner.complete(req);
    },
    ...(inner.stream
      ? {
          stream: (req: ChatRequest) => {
            calls += 1;
            return inner.stream!(req);
          }
        }
      : {})
  };
  return { provider, calls: () => calls };
}

const STREAMING_CAPS: ProviderCapabilities = {
  chat: true,
  agentic: false,
  streaming: true,
  structured: false,
  tools: false,
  kind: "mock"
};

/** Non-streaming provider that answers with a fixed text (exact-metering tests). */
function oneShotProvider(text: string): ModelProvider {
  return {
    id: "one-shot",
    capabilities: { ...STREAMING_CAPS, streaming: false },
    complete: async () => ({ message: { role: "assistant", content: text } })
  };
}

describe("gateway — health", () => {
  it("GET /healthz answers without auth", async () => {
    const g = makeGateway();
    await request(g.app).get("/healthz").expect(200).expect({ ok: true });
  });
});

describe("gateway — full happy path", () => {
  it("signup bonus → streamed run settles ≤ hold → topup credits once → refresh rotates", async () => {
    const g = makeGateway();

    // — login: first verify grants the signup bonus exactly once —
    const session = await login(g);
    expect(session.isNewUser).toBe(true);
    expect(session.userId).toMatch(/^usr_[0-9a-f]{16}$/);

    const afterSignup = await getBalance(g, session.accessToken);
    expect(afterSignup.balance).toBe(100);
    expect(afterSignup.recent).toHaveLength(1);
    expect(afterSignup.recent[0]).toMatchObject({ kind: "signup_bonus", amount: 100 });
    expect(Object.keys(afterSignup.recent[0]).sort()).toEqual(["amount", "id", "kind", "ts"]);

    // — agent run over SSE —
    const streamRes = await request(g.app)
      .post("/agent/stream")
      .set("Authorization", `Bearer ${session.accessToken}`)
      .send(streamBody())
      .expect(200);
    expect(streamRes.headers["content-type"]).toContain("text/event-stream");

    const events = parseSse(streamRes.text);
    const chunks = events.filter((e) => e.event === "chunk").map((e) => e.data.delta as string);
    const done = events.find((e) => e.event === "done")?.data;
    expect(events.some((e) => e.event === "error")).toBe(false);
    expect(chunks.length).toBeGreaterThan(1); // genuinely streamed
    expect(chunks.join("")).toBe(done.message.content); // deltas rejoin to the reply
    expect(done.message.role).toBe("assistant");
    expect(done.provider).toBe("mock");
    expect(done.aiGenerated).toBe(true); // §6 implicit-label stand-in

    // credits: settled ≤ held, remainder is the unused hold, balance drops by settled
    expect(done.credits.held).toBe(DEFAULT_HELD);
    expect(done.credits.settled).toBeGreaterThan(0);
    expect(done.credits.settled).toBeLessThanOrEqual(done.credits.held);
    expect(done.credits.remainder).toBe(done.credits.held - done.credits.settled);

    const afterRun = await getBalance(g, session.accessToken);
    expect(afterRun.balance).toBe(100 - done.credits.settled);
    expect(afterRun.recent[0].kind).toBe("settle"); // newest first

    // — top-up: create an order, then the (mock) webhook credits it — once —
    const order = await request(g.app)
      .post("/topup/create")
      .set("Authorization", `Bearer ${session.accessToken}`)
      .send({ sku: "pack10" })
      .expect(200);
    expect(order.body).toMatchObject({ amountYuan: 10, credits: 1000 });
    expect(order.body.paymentId).toMatch(/^pay_/);
    expect(order.body.qrPayload).toContain("mockpay://");

    await request(g.app).post("/topup/mock-notify").send({ paymentId: order.body.paymentId }).expect(200);
    const afterTopup = await getBalance(g, session.accessToken);
    expect(afterTopup.balance).toBe(100 - done.credits.settled + 1000);
    expect(afterTopup.recent[0]).toMatchObject({ kind: "topup", amount: 1000 });

    // double-notify (vendor redelivery) credits NOTHING extra
    await request(g.app).post("/topup/mock-notify").send({ paymentId: order.body.paymentId }).expect(200);
    const afterReplay = await getBalance(g, session.accessToken);
    expect(afterReplay.balance).toBe(afterTopup.balance);

    // — refresh rotation: new pair works, the old refresh token is dead —
    const refreshed = await request(g.app)
      .post("/auth/refresh")
      .send({ refreshToken: session.refreshToken })
      .expect(200);
    expect(refreshed.body.refreshToken).not.toBe(session.refreshToken);
    await getBalance(g, refreshed.body.accessToken); // fresh access token is live
    const reuse = await request(g.app)
      .post("/auth/refresh")
      .send({ refreshToken: session.refreshToken })
      .expect(401);
    expect(reuse.body.code).toBe("invalid_refresh_token");

    // — second login: NOT a new user, no second bonus —
    g.tick(61_000); // past the SMS resend window
    const again = await login(g);
    expect(again.isNewUser).toBe(false);
    const finalBalance = await getBalance(g, again.accessToken);
    expect(finalBalance.balance).toBe(afterReplay.balance);
  });
});

describe("gateway — auth routes", () => {
  it("request-code: malformed phone → 400 invalid_phone, nothing sent", async () => {
    const g = makeGateway();
    const res = await request(g.app).post("/auth/request-code").send({ phone: "not-a-phone" }).expect(400);
    expect(res.body.code).toBe("invalid_phone");
    expect(g.sms.sent).toHaveLength(0);
  });

  it("request-code: resend inside the window → 429 rate_limited with retryAfterMs", async () => {
    const g = makeGateway();
    await request(g.app).post("/auth/request-code").send({ phone: PHONE }).expect(204);
    g.tick(30_000);
    const res = await request(g.app).post("/auth/request-code").send({ phone: PHONE }).expect(429);
    expect(res.body.code).toBe("rate_limited");
    expect(res.body.retryAfterMs).toBe(30_000);
  });

  it("request-code: missing body field → 400 invalid_request (zod, before any side effect)", async () => {
    const g = makeGateway();
    const res = await request(g.app).post("/auth/request-code").send({}).expect(400);
    expect(res.body.code).toBe("invalid_request");
    expect(g.sms.sent).toHaveLength(0);
  });

  it("verify: wrong code → 401 invalid_code and no bonus is granted", async () => {
    const g = makeGateway();
    await request(g.app).post("/auth/request-code").send({ phone: PHONE }).expect(204);
    const res = await request(g.app).post("/auth/verify").send({ phone: PHONE, code: "000000" }).expect(401);
    expect(res.body.code).toBe("invalid_code");
  });

  it("verify: replaying an already-used code → 401 (single-use), bonus stays single", async () => {
    const g = makeGateway();
    const session = await login(g);
    const code = g.sms.lastCodeFor(PHONE)!;
    await request(g.app).post("/auth/verify").send({ phone: PHONE, code }).expect(401);
    const balance = await getBalance(g, session.accessToken);
    expect(balance.balance).toBe(100); // exactly one signup bonus
  });

  it("refresh: unknown token → 401 invalid_refresh_token", async () => {
    const g = makeGateway();
    const res = await request(g.app).post("/auth/refresh").send({ refreshToken: "garbage" }).expect(401);
    expect(res.body.code).toBe("invalid_refresh_token");
  });

  it("signup bonus is idempotent even if verify replays isNewUser (forced-new-user store)", async () => {
    // Simulates a pathological replay where verify reports isNewUser twice: the
    // ledger's `signup:<userId>` idempotency key still grants exactly once.
    const g = makeGateway({ alwaysNewUser: true });
    const first = await login(g);
    expect(first.isNewUser).toBe(true);
    g.tick(61_000);
    const second = await login(g);
    expect(second.isNewUser).toBe(true); // the replayed signal
    const balance = await getBalance(g, second.accessToken);
    expect(balance.balance).toBe(100); // granted ONCE
  });
});

describe("gateway — bearer auth", () => {
  it("rejects missing and malformed tokens with 401 on every authed route", async () => {
    const g = makeGateway();
    for (const hit of [
      request(g.app).get("/me/balance"),
      request(g.app).get("/me/balance").set("Authorization", "Bearer nonsense"),
      request(g.app).get("/me/balance").set("Authorization", "Basic abc"),
      request(g.app).post("/agent/stream").send(streamBody()),
      request(g.app).post("/topup/create").send({ sku: "pack10" })
    ]) {
      const res = await hit.expect(401);
      expect(res.body.code).toBe("unauthorized");
    }
  });

  it("an expired access token is a 401 (clock-driven)", async () => {
    const g = makeGateway();
    const session = await login(g);
    g.tick(60 * 60_000 + 1); // past the 1h access TTL
    await request(g.app)
      .get("/me/balance")
      .set("Authorization", `Bearer ${session.accessToken}`)
      .expect(401);
  });
});

describe("gateway — /agent/stream credits lifecycle", () => {
  it("meters the output-length approximation exactly (9000 chars → ceil(2250/1000) = 3 credits)", async () => {
    const g = makeGateway({ orchestrator: oneShotProvider("x".repeat(9000)) });
    const session = await login(g);
    const res = await request(g.app)
      .post("/agent/stream")
      .set("Authorization", `Bearer ${session.accessToken}`)
      .send(streamBody())
      .expect(200);
    const events = parseSse(res.text);
    const done = events.find((e) => e.event === "done")?.data;
    expect(events.filter((e) => e.event === "chunk")).toHaveLength(1); // complete() fallback: one chunk
    expect(done.credits).toEqual({ held: DEFAULT_HELD, settled: 3, remainder: 6 });
    expect((await getBalance(g, session.accessToken)).balance).toBe(97);
  });

  it("caps the settle at the hold — a run can never cost more than the pre-authorized estimate", async () => {
    // 100k chars ≈ 25k tokens ≈ 25 credits — far past the 9-credit hold ceiling.
    const g = makeGateway({ orchestrator: oneShotProvider("y".repeat(100_000)) });
    const session = await login(g);
    const res = await request(g.app)
      .post("/agent/stream")
      .set("Authorization", `Bearer ${session.accessToken}`)
      .send(streamBody())
      .expect(200);
    const done = parseSse(res.text).find((e) => e.event === "done")?.data;
    expect(done.credits).toEqual({ held: DEFAULT_HELD, settled: DEFAULT_HELD, remainder: 0 });
    expect((await getBalance(g, session.accessToken)).balance).toBe(100 - DEFAULT_HELD);
  });

  it("invalid body → 400 BEFORE any side effect: no hold, no vendor call", async () => {
    const counted = withCallCounter(new MockModelProvider());
    const g = makeGateway({ orchestrator: counted.provider });
    const session = await login(g);
    await request(g.app)
      .post("/agent/stream")
      .set("Authorization", `Bearer ${session.accessToken}`)
      .send({ messages: [] }) // fails chatRequestSchema (min 1 message)
      .expect(400);
    expect(counted.calls()).toBe(0);
    const entries = await g.ledger.entries(session.userId);
    expect(entries.map((e) => e.kind)).toEqual(["signup_bonus"]); // no hold appended
  });

  it("insufficient balance → 402 JSON {code, needed, balance} before any SSE byte or vendor call", async () => {
    const counted = withCallCounter(new MockModelProvider());
    // Small economy: bonus 3, ceiling 500 tokens → 1-credit holds; the short mock
    // reply settles 1 credit per run, so three runs drain the balance to zero.
    const g = makeGateway({
      orchestrator: counted.provider,
      config: { signupBonusCredits: 3, maxTextTokensPerRun: 500 }
    });
    const session = await login(g);
    for (let run = 0; run < 3; run++) {
      const res = await request(g.app)
        .post("/agent/stream")
        .set("Authorization", `Bearer ${session.accessToken}`)
        .send(streamBody("drain"))
        .expect(200);
      expect(parseSse(res.text).find((e) => e.event === "done")?.data.credits.settled).toBe(1);
    }
    expect((await getBalance(g, session.accessToken)).balance).toBe(0);
    expect(counted.calls()).toBe(3);
    const entriesBefore = (await g.ledger.entries(session.userId)).length;

    const rejected = await request(g.app)
      .post("/agent/stream")
      .set("Authorization", `Bearer ${session.accessToken}`)
      .send(streamBody("one more"))
      .expect(402);
    expect(rejected.headers["content-type"]).toContain("application/json"); // not SSE
    expect(rejected.body).toEqual({ code: "insufficient_balance", needed: 1, balance: 0 });
    expect(counted.calls()).toBe(3); // NO vendor call happened
    expect((await g.ledger.entries(session.userId)).length).toBe(entriesBefore); // nothing appended
  });

  it("provider failure mid-stream → hold refunded in FULL + error event (user pays nothing)", async () => {
    const midStreamFailer: ModelProvider = {
      id: "fail-mid-stream",
      capabilities: STREAMING_CAPS,
      complete: async () => {
        throw new Error("complete unused");
      },
      stream: async function* () {
        yield "partial ";
        yield "output";
        throw new Error("vendor exploded mid-stream");
      }
    };
    const g = makeGateway({ orchestrator: midStreamFailer });
    const session = await login(g);

    const res = await request(g.app)
      .post("/agent/stream")
      .set("Authorization", `Bearer ${session.accessToken}`)
      .send(streamBody())
      .expect(200); // headers were already committed by the first chunk
    const events = parseSse(res.text);
    expect(events.filter((e) => e.event === "chunk").map((e) => e.data.delta)).toEqual([
      "partial ",
      "output"
    ]);
    expect(events.some((e) => e.event === "done")).toBe(false);
    const errorEvent = events.at(-1);
    expect(errorEvent?.event).toBe("error");
    expect(errorEvent?.data.code).toBe("run_failed");
    expect(errorEvent?.data.error).toContain("vendor exploded");

    // balance unchanged: hold fully refunded
    expect((await getBalance(g, session.accessToken)).balance).toBe(100);
    const kinds = (await g.ledger.entries(session.userId)).map((e) => e.kind);
    expect(kinds).toEqual(["signup_bonus", "hold", "refund"]);
  });

  it("provider failure BEFORE the first chunk → plain 5xx JSON and the hold refunded", async () => {
    const downProvider: ModelProvider = {
      id: "down",
      capabilities: { ...STREAMING_CAPS, streaming: false },
      complete: async () => {
        throw new Error("vendor down");
      }
    };
    const g = makeGateway({ orchestrator: downProvider });
    const session = await login(g);
    const res = await request(g.app)
      .post("/agent/stream")
      .set("Authorization", `Bearer ${session.accessToken}`)
      .send(streamBody())
      .expect(500);
    expect(res.body.code).toBe("internal_error");
    expect(res.body.message).toContain("vendor down");
    expect((await getBalance(g, session.accessToken)).balance).toBe(100);
    const kinds = (await g.ledger.entries(session.userId)).map((e) => e.kind);
    expect(kinds).toEqual(["signup_bonus", "hold", "refund"]);
  });
});

describe("gateway — top-up", () => {
  it("unknown sku → 400 unknown_sku and no order is created", async () => {
    const g = makeGateway();
    const session = await login(g);
    const res = await request(g.app)
      .post("/topup/create")
      .set("Authorization", `Bearer ${session.accessToken}`)
      .send({ sku: "pack999" })
      .expect(400);
    expect(res.body.code).toBe("unknown_sku");
    expect(g.payments.orders).toHaveLength(0);
  });

  it("mock-notify: unknown paymentId → 404 unknown_payment, nothing credited", async () => {
    const g = makeGateway();
    const session = await login(g);
    const res = await request(g.app).post("/topup/mock-notify").send({ paymentId: "pay_nope" }).expect(404);
    expect(res.body.code).toBe("unknown_payment");
    expect((await getBalance(g, session.accessToken)).balance).toBe(100);
  });

  it("mock-notify is NOT mounted when allowMockPay is false (prod shape)", async () => {
    const g = makeGateway({ config: { allowMockPay: false } });
    await request(g.app).post("/topup/mock-notify").send({ paymentId: "pay_000001" }).expect(404);
  });
});
