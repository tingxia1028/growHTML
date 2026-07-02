import { describe, expect, it } from "vitest";
import {
  CreditsLedger,
  HoldAlreadyClosedError,
  HoldNotFoundError,
  holdExpiryKey,
  InsufficientBalanceError,
  InvalidAmountError,
  SettleExceedsEstimateError
} from "./ledger";
import { DuplicateIdempotencyKeyError, InMemoryLedgerStore } from "./ledgerStore";

// Deterministic harness: manual clock, fresh store per ledger.
function makeLedger(startMs = 1_000) {
  let nowMs = startMs;
  const store = new InMemoryLedgerStore();
  const ledger = new CreditsLedger({ store, now: () => nowMs });
  return {
    ledger,
    store,
    tick: (ms: number) => {
      nowMs += ms;
    },
    now: () => nowMs
  };
}

const U1 = "usr_alice";
const U2 = "usr_bob";

describe("ledger — grants", () => {
  it("signup bonus + topup + subscription_grant credit the balance with an exact balanceAfter chain", async () => {
    const { ledger } = makeLedger();
    const bonus = await ledger.grant(U1, "signup_bonus", 100, {}, {}, "signup:usr_alice");
    const topup = await ledger.grant(U1, "topup", 500, { paymentId: "wx_1" }, {}, "wxpay:wx_1");
    const sub = await ledger.grant(U1, "subscription_grant", 300, {}, { groupId: "pro" }, "sub-grant:usr_alice:2026-07");

    expect(bonus.amount).toBe(100);
    expect(bonus.balanceAfter).toBe(100);
    expect(topup.balanceAfter).toBe(600);
    expect(sub.balanceAfter).toBe(900);
    expect(sub.meta.groupId).toBe("pro");
    await expect(ledger.balance(U1)).resolves.toBe(900);

    const entries = await ledger.entries(U1);
    expect(entries.map((e) => e.kind)).toEqual(["signup_bonus", "topup", "subscription_grant"]);
    expect(entries.map((e) => e.balanceAfter)).toEqual([100, 600, 900]);
  });

  it("rejects non-positive / non-integer amounts for bonus/topup/subscription kinds", async () => {
    const { ledger } = makeLedger();
    await expect(ledger.grant(U1, "topup", 0, {}, {}, "k1")).rejects.toBeInstanceOf(InvalidAmountError);
    await expect(ledger.grant(U1, "topup", -5, {}, {}, "k2")).rejects.toBeInstanceOf(InvalidAmountError);
    await expect(ledger.grant(U1, "signup_bonus", 1.5, {}, {}, "k3")).rejects.toBeInstanceOf(InvalidAmountError);
    await expect(ledger.grant(U1, "subscription_grant", NaN, {}, {}, "k4")).rejects.toBeInstanceOf(InvalidAmountError);
    await expect(ledger.balance(U1)).resolves.toBe(0); // nothing applied
  });

  it("adjust may be signed (operator correction), but never zero", async () => {
    const { ledger } = makeLedger();
    await ledger.grant(U1, "topup", 100, {}, {}, "k-top");
    const down = await ledger.grant(U1, "adjust", -30, {}, {}, "k-adj-down");
    expect(down.balanceAfter).toBe(70);
    const up = await ledger.grant(U1, "adjust", 5, {}, {}, "k-adj-up");
    expect(up.balanceAfter).toBe(75);
    await expect(ledger.grant(U1, "adjust", 0, {}, {}, "k-adj-zero")).rejects.toBeInstanceOf(InvalidAmountError);
  });
});

describe("ledger — hold / settle / refund lifecycle", () => {
  it("happy path: hold reserves, settle returns the remainder; net spend = actual cost", async () => {
    const { ledger, tick } = makeLedger();
    await ledger.grant(U1, "topup", 100, {}, {}, "k-top");
    tick(10);
    const hold = await ledger.hold(U1, 30, { agentRunId: "run1" }, { modality: "text" }, "hold:run1");
    expect(hold.kind).toBe("hold");
    expect(hold.amount).toBe(-30);
    expect(hold.balanceAfter).toBe(70); // holds lower the balance immediately
    await expect(ledger.balance(U1)).resolves.toBe(70);

    tick(10);
    const settle = await ledger.settle(hold.id, 22, { usage: { tokens: 21_500 }, priceVersion: "v1", groupId: "pro" }, "settle:run1");
    expect(settle.kind).toBe("settle");
    expect(settle.amount).toBe(8); // estimate 30 − actual 22
    expect(settle.balanceAfter).toBe(78);
    expect(settle.ref.holdId).toBe(hold.id);
    expect(settle.ref.agentRunId).toBe("run1"); // inherits the hold's ref
    expect(settle.meta.priceVersion).toBe("v1");
    expect(settle.meta.groupId).toBe("pro");

    // balance = plain sum of all amounts; exact chain
    const entries = await ledger.entries(U1);
    expect(entries.map((e) => e.amount)).toEqual([100, -30, 8]);
    expect(entries.map((e) => e.balanceAfter)).toEqual([100, 70, 78]);
    await expect(ledger.balance(U1)).resolves.toBe(78); // 100 − 22 actually spent
  });

  it("settle at exactly the estimate appends a zero-amount closure row", async () => {
    const { ledger } = makeLedger();
    await ledger.grant(U1, "topup", 50, {}, {}, "k-top");
    const hold = await ledger.hold(U1, 30, {}, {}, "hold:r");
    const settle = await ledger.settle(hold.id, 30, {}, "settle:r");
    expect(settle.amount).toBe(0);
    await expect(ledger.balance(U1)).resolves.toBe(20);
    // and the closure is real: no second close allowed
    await expect(ledger.refundHold(hold.id, "refund:r")).rejects.toBeInstanceOf(HoldAlreadyClosedError);
  });

  it("settle with actualCost 0 returns the whole estimate", async () => {
    const { ledger } = makeLedger();
    await ledger.grant(U1, "topup", 50, {}, {}, "k-top");
    const hold = await ledger.hold(U1, 30, {}, {}, "hold:r");
    const settle = await ledger.settle(hold.id, 0, {}, "settle:r");
    expect(settle.amount).toBe(30);
    await expect(ledger.balance(U1)).resolves.toBe(50);
  });

  it("refund returns the full estimate — a failed run is free", async () => {
    const { ledger } = makeLedger();
    await ledger.grant(U1, "topup", 100, {}, {}, "k-top");
    const hold = await ledger.hold(U1, 40, { agentRunId: "run2" }, {}, "hold:run2");
    await expect(ledger.balance(U1)).resolves.toBe(60);
    const refund = await ledger.refundHold(hold.id, "refund:run2");
    expect(refund.kind).toBe("refund");
    expect(refund.amount).toBe(40);
    expect(refund.ref.holdId).toBe(hold.id);
    expect(refund.ref.agentRunId).toBe("run2");
    await expect(ledger.balance(U1)).resolves.toBe(100);
  });

  it("rejects a hold when balance < estimate, before anything is written", async () => {
    const { ledger } = makeLedger();
    await ledger.grant(U1, "topup", 20, {}, {}, "k-top");
    await expect(ledger.hold(U1, 30, {}, {}, "hold:r")).rejects.toBeInstanceOf(InsufficientBalanceError);
    await expect(ledger.balance(U1)).resolves.toBe(20);
    expect((await ledger.entries(U1)).length).toBe(1); // no hold entry appended
  });

  it("outstanding holds count against later holds (balance already includes them)", async () => {
    const { ledger } = makeLedger();
    await ledger.grant(U1, "topup", 100, {}, {}, "k-top");
    await ledger.hold(U1, 60, {}, {}, "hold:a"); // balance now 40
    await expect(ledger.hold(U1, 50, {}, {}, "hold:b")).rejects.toBeInstanceOf(InsufficientBalanceError);
    const ok = await ledger.hold(U1, 40, {}, {}, "hold:c");
    expect(ok.balanceAfter).toBe(0);
  });

  it("rejects hold estimates that are zero, negative, or fractional", async () => {
    const { ledger } = makeLedger();
    await ledger.grant(U1, "topup", 100, {}, {}, "k-top");
    await expect(ledger.hold(U1, 0, {}, {}, "h0")).rejects.toBeInstanceOf(InvalidAmountError);
    await expect(ledger.hold(U1, -5, {}, {}, "h1")).rejects.toBeInstanceOf(InvalidAmountError);
    await expect(ledger.hold(U1, 2.5, {}, {}, "h2")).rejects.toBeInstanceOf(InvalidAmountError);
  });

  it("rejects settle above the estimate and invalid actualCost values", async () => {
    const { ledger } = makeLedger();
    await ledger.grant(U1, "topup", 100, {}, {}, "k-top");
    const hold = await ledger.hold(U1, 30, {}, {}, "hold:r");
    await expect(ledger.settle(hold.id, 31, {}, "s1")).rejects.toBeInstanceOf(SettleExceedsEstimateError);
    await expect(ledger.settle(hold.id, -1, {}, "s2")).rejects.toBeInstanceOf(InvalidAmountError);
    await expect(ledger.settle(hold.id, 1.5, {}, "s3")).rejects.toBeInstanceOf(InvalidAmountError);
    // hold still open after the rejections; a valid settle works
    const settle = await ledger.settle(hold.id, 30, {}, "s4");
    expect(settle.amount).toBe(0);
  });

  it("a hold closes exactly once: double-settle, refund-after-settle, double-refund, settle-after-refund all reject", async () => {
    const { ledger } = makeLedger();
    await ledger.grant(U1, "topup", 100, {}, {}, "k-top");

    const h1 = await ledger.hold(U1, 30, {}, {}, "hold:a");
    await ledger.settle(h1.id, 10, {}, "settle:a");
    await expect(ledger.settle(h1.id, 10, {}, "settle:a2")).rejects.toBeInstanceOf(HoldAlreadyClosedError);
    await expect(ledger.refundHold(h1.id, "refund:a")).rejects.toBeInstanceOf(HoldAlreadyClosedError);

    const h2 = await ledger.hold(U1, 30, {}, {}, "hold:b");
    await ledger.refundHold(h2.id, "refund:b");
    await expect(ledger.refundHold(h2.id, "refund:b2")).rejects.toBeInstanceOf(HoldAlreadyClosedError);
    await expect(ledger.settle(h2.id, 5, {}, "settle:b")).rejects.toBeInstanceOf(HoldAlreadyClosedError);

    await expect(ledger.balance(U1)).resolves.toBe(90); // only the settled 10 was spent
  });

  it("settle/refund against an unknown id — or a non-hold entry id — reject", async () => {
    const { ledger } = makeLedger();
    const topup = await ledger.grant(U1, "topup", 100, {}, {}, "k-top");
    await expect(ledger.settle("led_nope", 1, {}, "s1")).rejects.toBeInstanceOf(HoldNotFoundError);
    await expect(ledger.refundHold("led_nope", "r1")).rejects.toBeInstanceOf(HoldNotFoundError);
    await expect(ledger.settle(topup.id, 1, {}, "s2")).rejects.toBeInstanceOf(HoldNotFoundError);
  });
});

describe("ledger — idempotency (every op: duplicate key returns the ORIGINAL, applies nothing)", () => {
  it("grant retries do not double-credit (webhook redelivery)", async () => {
    const { ledger } = makeLedger();
    const first = await ledger.grant(U1, "topup", 500, { paymentId: "wx_1" }, {}, "wxpay:wx_1");
    const retry = await ledger.grant(U1, "topup", 500, { paymentId: "wx_1" }, {}, "wxpay:wx_1");
    expect(retry).toBe(first); // the original entry, not a twin
    await expect(ledger.balance(U1)).resolves.toBe(500);
    expect((await ledger.entries(U1)).length).toBe(1);
  });

  it("subscription grants are once-per-period via key userId+period (§10.2)", async () => {
    const { ledger } = makeLedger();
    const key = `sub-grant:${U1}:2026-07`;
    await ledger.grant(U1, "subscription_grant", 300, {}, { groupId: "pro" }, key);
    await ledger.grant(U1, "subscription_grant", 300, {}, { groupId: "pro" }, key);
    await expect(ledger.balance(U1)).resolves.toBe(300);
    // a NEW period is a new key and does grant
    await ledger.grant(U1, "subscription_grant", 300, {}, { groupId: "pro" }, `sub-grant:${U1}:2026-08`);
    await expect(ledger.balance(U1)).resolves.toBe(600);
  });

  it("hold retries do not double-reserve", async () => {
    const { ledger } = makeLedger();
    await ledger.grant(U1, "topup", 100, {}, {}, "k-top");
    const first = await ledger.hold(U1, 60, {}, {}, "hold:run1");
    const retry = await ledger.hold(U1, 60, {}, {}, "hold:run1");
    expect(retry).toBe(first);
    await expect(ledger.balance(U1)).resolves.toBe(40); // reserved once, not twice
  });

  it("settle retries return the original even though the hold is now closed (replay beats validation)", async () => {
    const { ledger } = makeLedger();
    await ledger.grant(U1, "topup", 100, {}, {}, "k-top");
    const hold = await ledger.hold(U1, 30, {}, {}, "hold:r");
    const first = await ledger.settle(hold.id, 22, {}, "settle:r");
    const retry = await ledger.settle(hold.id, 22, {}, "settle:r");
    expect(retry).toBe(first);
    await expect(ledger.balance(U1)).resolves.toBe(78);
  });

  it("refund retries do not double-refund", async () => {
    const { ledger } = makeLedger();
    await ledger.grant(U1, "topup", 100, {}, {}, "k-top");
    const hold = await ledger.hold(U1, 30, {}, {}, "hold:r");
    const first = await ledger.refundHold(hold.id, "refund:r");
    const retry = await ledger.refundHold(hold.id, "refund:r");
    expect(retry).toBe(first);
    await expect(ledger.balance(U1)).resolves.toBe(100);
  });

  it("the store itself enforces key uniqueness (the Postgres UNIQUE stand-in)", async () => {
    const store = new InMemoryLedgerStore();
    const base = {
      userId: U1,
      ts: 1,
      kind: "topup" as const,
      amount: 10,
      balanceAfter: 10,
      ref: {},
      meta: {},
      idempotencyKey: "dup-key"
    };
    await store.append({ ...base, id: "led_1" });
    await expect(store.append({ ...base, id: "led_2" })).rejects.toBeInstanceOf(DuplicateIdempotencyKeyError);
  });

  it("stored entries are frozen — history cannot be mutated", async () => {
    const { ledger } = makeLedger();
    const entry = await ledger.grant(U1, "topup", 100, {}, {}, "k-top");
    expect(Object.isFrozen(entry)).toBe(true);
    expect(() => {
      (entry as { amount: number }).amount = 999;
    }).toThrow(TypeError);
    expect(() => {
      (entry.meta as { groupId?: string }).groupId = "hax";
    }).toThrow(TypeError);
    await expect(ledger.balance(U1)).resolves.toBe(100);
  });
});

describe("ledger — stale-hold sweep (Redis-TTL stand-in)", () => {
  it("auto-refunds only holds past the TTL, exactly once, with the derived key", async () => {
    const { ledger, now, tick } = makeLedger();
    await ledger.grant(U1, "topup", 100, {}, {}, "k-top");
    const oldHold = await ledger.hold(U1, 30, {}, {}, "hold:old"); // ts = 1000
    tick(5_000);
    const youngHold = await ledger.hold(U1, 20, {}, {}, "hold:young"); // ts = 6000
    tick(5_000); // now = 11000: oldHold age 10s, youngHold age 5s

    const swept = await ledger.expireStaleHolds(now(), 10_000);
    expect(swept.length).toBe(1);
    expect(swept[0].kind).toBe("refund");
    expect(swept[0].ref.holdId).toBe(oldHold.id);
    expect(swept[0].idempotencyKey).toBe(holdExpiryKey(oldHold.id));
    expect(swept[0].idempotencyKey).toBe(`hold-expire:${oldHold.id}`);
    await expect(ledger.balance(U1)).resolves.toBe(80); // 100 − young 20; old 30 returned

    // sweeping again refunds nothing new (the hold is closed now)
    const again = await ledger.expireStaleHolds(now(), 10_000);
    expect(again.length).toBe(0);
    await expect(ledger.balance(U1)).resolves.toBe(80);

    // the young hold can still settle normally afterwards
    await ledger.settle(youngHold.id, 20, {}, "settle:young");
    await expect(ledger.balance(U1)).resolves.toBe(80);
    // …but the swept one is closed for good
    await expect(ledger.settle(oldHold.id, 1, {}, "settle:old")).rejects.toBeInstanceOf(HoldAlreadyClosedError);
  });

  it("does not sweep settled or refunded holds, and sweeps across users", async () => {
    const { ledger, now, tick } = makeLedger();
    await ledger.grant(U1, "topup", 100, {}, {}, "k-top-1");
    await ledger.grant(U2, "topup", 100, {}, {}, "k-top-2");
    const settled = await ledger.hold(U1, 10, {}, {}, "hold:settled");
    const abandoned1 = await ledger.hold(U1, 20, {}, {}, "hold:a1");
    const abandoned2 = await ledger.hold(U2, 30, {}, {}, "hold:a2");
    await ledger.settle(settled.id, 10, {}, "settle:settled");

    tick(60_000);
    const swept = await ledger.expireStaleHolds(now(), 30_000);
    expect(swept.map((e) => e.ref.holdId).sort()).toEqual([abandoned1.id, abandoned2.id].sort());
    await expect(ledger.balance(U1)).resolves.toBe(90); // spent only the settled 10
    await expect(ledger.balance(U2)).resolves.toBe(100);
  });
});

describe("ledger — user isolation", () => {
  it("interleaved users keep independent balances, chains, and entry streams", async () => {
    const { ledger } = makeLedger();
    await ledger.grant(U1, "topup", 100, {}, {}, "t1");
    await ledger.grant(U2, "topup", 50, {}, {}, "t2");
    const h1 = await ledger.hold(U1, 40, {}, {}, "h1");
    const h2 = await ledger.hold(U2, 50, {}, {}, "h2");
    await ledger.settle(h1.id, 40, {}, "s1");
    await ledger.refundHold(h2.id, "r2");

    await expect(ledger.balance(U1)).resolves.toBe(60);
    await expect(ledger.balance(U2)).resolves.toBe(50);

    const e1 = await ledger.entries(U1);
    const e2 = await ledger.entries(U2);
    expect(e1.every((e) => e.userId === U1)).toBe(true);
    expect(e2.every((e) => e.userId === U2)).toBe(true);
    expect(e1.map((e) => e.balanceAfter)).toEqual([100, 60, 60]);
    expect(e2.map((e) => e.balanceAfter)).toEqual([50, 0, 50]);

    // one user's spend can never draw on the other's balance
    await expect(ledger.hold(U2, 51, {}, {}, "h3")).rejects.toBeInstanceOf(InsufficientBalanceError);
  });
});
