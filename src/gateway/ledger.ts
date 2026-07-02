// Gateway credits ledger — money core (docs/design/managed-ai-credits.md §4.3, §10).
//
// MODEL (as implemented):
//   - balance(user) = plain SUM of all entry amounts. No shadow "reserved" pool:
//     a `hold` IS a negative entry, so outstanding holds already lower the balance
//     ("balance − outstanding holds" from §4.3 falls out of the sum for free).
//   - hold   = −estimate            (pre-authorize; reject `insufficient_balance`
//                                    before any vendor call when balance < estimate)
//   - settle = +(estimate − actual) (returns the UNUSED remainder; net spend across
//                                    hold+settle = −actual; requires actual ≤ estimate)
//   - refund = +estimate            (full return — failed runs are free, §4.3 step 3)
//   - a hold is closed (settled or refunded) EXACTLY once; open/closed is DERIVED
//     from the entry stream (a closing entry carries ref.holdId), never a flag.
//   - every mutating op takes an explicit idempotencyKey; a DUPLICATE key returns
//     the ORIGINAL entry and applies NOTHING — payment-webhook redeliveries and
//     client retries are safe (§4.3 "Idempotency everywhere"). The replay wins over
//     validation: a retried settle returns the original row even though the hold
//     is now closed.
//   - `subscription_grant` (§10.2) is just another positive grant kind; monthly
//     once-only is enforced by the caller passing key = `sub-grant:<userId>:<period>`.
//
// Amounts are INTEGER credits (Number.isSafeInteger), signed.

import type {
  GrantKind,
  LedgerEntry,
  LedgerMeta,
  LedgerRef,
  LedgerStore
} from "./ledgerStore";

export class InsufficientBalanceError extends Error {
  readonly code = "insufficient_balance";
  constructor(userId: string, balance: number, estimate: number) {
    super(`insufficient_balance: user ${userId} has ${balance} credits, hold needs ${estimate}`);
    this.name = "InsufficientBalanceError";
  }
}

export class HoldNotFoundError extends Error {
  constructor(holdId: string) {
    super(`no hold entry with id: ${holdId}`);
    this.name = "HoldNotFoundError";
  }
}

/** The hold was already settled or refunded — a hold closes exactly once. */
export class HoldAlreadyClosedError extends Error {
  constructor(holdId: string, closedBy: LedgerEntry) {
    super(`hold ${holdId} already closed by ${closedBy.kind} entry ${closedBy.id}`);
    this.name = "HoldAlreadyClosedError";
  }
}

export class SettleExceedsEstimateError extends Error {
  constructor(holdId: string, estimate: number, actualCost: number) {
    super(`settle of ${actualCost} exceeds hold ${holdId} estimate ${estimate}`);
    this.name = "SettleExceedsEstimateError";
  }
}

/** Amount/estimate/actualCost failed validation (sign, zero, non-integer). */
export class InvalidAmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAmountError";
  }
}

export interface CreditsLedgerDeps {
  store: LedgerStore;
  /** Injected clock (epoch ms) — every entry ts comes from here; tests drive it. */
  now: () => number;
  /** Injected id source; defaults to a per-instance monotonic `led_...` counter. */
  newId?: () => string;
}

/** Idempotency key used by the stale-hold sweep for a given hold. */
export function holdExpiryKey(holdId: string): string {
  return `hold-expire:${holdId}`;
}

function assertPositiveInteger(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new InvalidAmountError(`${what} must be a positive integer, got ${value}`);
  }
}

export class CreditsLedger {
  private readonly store: LedgerStore;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(deps: CreditsLedgerDeps) {
    this.store = deps.store;
    this.now = deps.now;
    if (deps.newId) {
      this.newId = deps.newId;
    } else {
      // In-memory default: deterministic per-instance counter. The production
      // Postgres adapter generates ids DB-side (bigserial/uuid) instead.
      let seq = 0;
      this.newId = () => `led_${String(++seq).padStart(6, "0")}`;
    }
  }

  /** Sum of all amounts for the user (holds already counted — they are entries). */
  async balance(userId: string): Promise<number> {
    const entries = await this.store.listByUser(userId);
    return entries.reduce((sum, e) => sum + e.amount, 0);
  }

  /** Full entry stream for a user, in append order. */
  async entries(userId: string): Promise<readonly LedgerEntry[]> {
    return this.store.listByUser(userId);
  }

  /**
   * Credit (or, for `adjust`, correct) a user's balance.
   * signup_bonus / topup / subscription_grant require amount > 0;
   * adjust is an operator correction and may be signed (never 0) — it does NOT
   * check balance, so an operator claw-back may drive a balance negative.
   */
  async grant(
    userId: string,
    kind: GrantKind,
    amount: number,
    ref: LedgerRef,
    meta: LedgerMeta,
    idempotencyKey: string
  ): Promise<LedgerEntry> {
    const existing = await this.store.byIdempotencyKey(idempotencyKey);
    if (existing) return existing;
    if (kind === "adjust") {
      if (!Number.isSafeInteger(amount) || amount === 0) {
        throw new InvalidAmountError(`adjust amount must be a non-zero integer, got ${amount}`);
      }
    } else {
      assertPositiveInteger(amount, `${kind} amount`);
    }
    return this.append(userId, kind, amount, ref, meta, idempotencyKey);
  }

  /**
   * Pre-authorize an agent run: reserve `estimate` credits by appending −estimate.
   * Rejects `insufficient_balance` when balance < estimate — BEFORE any vendor call.
   * Returns the hold entry; its id is the holdId for settle/refund.
   */
  async hold(
    userId: string,
    estimate: number,
    ref: LedgerRef,
    meta: LedgerMeta,
    idempotencyKey: string
  ): Promise<LedgerEntry> {
    const existing = await this.store.byIdempotencyKey(idempotencyKey);
    if (existing) return existing;
    assertPositiveInteger(estimate, "hold estimate");
    const balance = await this.balance(userId);
    if (balance < estimate) {
      throw new InsufficientBalanceError(userId, balance, estimate);
    }
    return this.append(userId, "hold", -estimate, ref, meta, idempotencyKey);
  }

  /**
   * Close a hold with the metered actual cost: appends +(estimate − actualCost)
   * (the unused remainder; 0 remainder still appends so the closure is recorded).
   * actualCost must be an integer in [0, estimate]. The settle row inherits the
   * hold's ref (agentRunId…) plus ref.holdId, and records the caller's meta
   * (usage, priceVersion, groupId — §10.1 auditable rate history).
   */
  async settle(
    holdId: string,
    actualCost: number,
    meta: LedgerMeta,
    idempotencyKey: string
  ): Promise<LedgerEntry> {
    const existing = await this.store.byIdempotencyKey(idempotencyKey);
    if (existing) return existing;
    const holdEntry = await this.requireOpenHold(holdId);
    if (!Number.isSafeInteger(actualCost) || actualCost < 0) {
      throw new InvalidAmountError(`settle actualCost must be an integer >= 0, got ${actualCost}`);
    }
    const estimate = -holdEntry.amount;
    if (actualCost > estimate) {
      throw new SettleExceedsEstimateError(holdId, estimate, actualCost);
    }
    return this.append(
      holdEntry.userId,
      "settle",
      estimate - actualCost,
      { ...holdEntry.ref, holdId },
      meta,
      idempotencyKey
    );
  }

  /** Return a hold in FULL (+estimate) — the user is never charged for a failed run. */
  async refundHold(holdId: string, idempotencyKey: string): Promise<LedgerEntry> {
    const existing = await this.store.byIdempotencyKey(idempotencyKey);
    if (existing) return existing;
    const holdEntry = await this.requireOpenHold(holdId);
    return this.append(
      holdEntry.userId,
      "refund",
      -holdEntry.amount,
      { ...holdEntry.ref, holdId },
      { ...holdEntry.meta },
      idempotencyKey
    );
  }

  /**
   * Auto-refund holds still open past their TTL — the stand-in for the §4.2
   * Redis hold-TTL (a run that never settled nor refunded, e.g. gateway crash).
   * Sweeps holds with now − ts >= ttlMs; idempotency key is derived
   * (`hold-expire:<holdId>`) so repeated sweeps refund each hold exactly once.
   * Returns the refund entries this sweep appended.
   */
  async expireStaleHolds(now: number, ttlMs: number): Promise<LedgerEntry[]> {
    const openHolds = await this.store.listOpenHolds();
    const refunds: LedgerEntry[] = [];
    for (const holdEntry of openHolds) {
      if (now - holdEntry.ts < ttlMs) continue;
      refunds.push(await this.refundHold(holdEntry.id, holdExpiryKey(holdEntry.id)));
    }
    return refunds;
  }

  private async requireOpenHold(holdId: string): Promise<LedgerEntry> {
    const holdEntry = await this.store.byId(holdId);
    if (!holdEntry || holdEntry.kind !== "hold") {
      throw new HoldNotFoundError(holdId);
    }
    const closedBy = await this.store.closingEntryFor(holdId);
    if (closedBy) {
      throw new HoldAlreadyClosedError(holdId, closedBy);
    }
    return holdEntry;
  }

  private async append(
    userId: string,
    kind: LedgerEntry["kind"],
    amount: number,
    ref: LedgerRef,
    meta: LedgerMeta,
    idempotencyKey: string
  ): Promise<LedgerEntry> {
    const balanceAfter = (await this.balance(userId)) + amount;
    return this.store.append({
      id: this.newId(),
      userId,
      ts: this.now(),
      kind,
      amount,
      balanceAfter,
      ref,
      meta,
      idempotencyKey
    });
  }
}
