// Gateway credits ledger — storage seam (docs/design/managed-ai-credits.md §4.3, §10.2).
//
// The ledger is APPEND-ONLY: entries are never updated or deleted; all state
// (balances, open holds) is derived from the entry stream. This file defines the
// store interface plus the in-memory implementation used for tests/dev.
//
// PRODUCTION NOTE: the real deployment adapter is a Postgres table (one row per
// entry) written at deploy time — NOT in this slice. It must enforce the exact
// same semantics this in-memory store enforces:
//   - `idempotencyKey` UNIQUE across the whole ledger (a DB unique constraint;
//     duplicate webhook deliveries / client retries must collide, §4.3).
//   - append-only (no UPDATE/DELETE; grant INSERT only).
//   - the read-check-append sequence in `ledger.ts` must run inside a
//     transaction (row locks / SERIALIZABLE) so concurrent holds cannot both
//     pass the balance check. The in-memory store is single-threaded, so plain
//     synchronous-in-async methods are already atomic here.

export type LedgerEntryKind =
  | "signup_bonus"
  | "topup"
  | "subscription_grant" // monthly plan deposit (§10.2); idempotency = userId+period, enforced by key
  | "hold"
  | "settle"
  | "refund"
  | "adjust";

/** Kinds callable through `CreditsLedger.grant` (holds/settles/refunds have dedicated ops). */
export type GrantKind = "signup_bonus" | "topup" | "subscription_grant" | "adjust";

export interface LedgerRef {
  holdId?: string;
  paymentId?: string;
  agentRunId?: string;
  toolCallId?: string;
}

export interface LedgerMeta {
  modality?: string;
  vendor?: string;
  model?: string;
  usage?: unknown;
  priceVersion?: string;
  /** AI Group (plan) the rate came from — recorded on settle rows for auditable rate history (§10.1). */
  groupId?: string;
}

export interface LedgerEntry {
  id: string;
  userId: string;
  /** Epoch ms, from the ledger's injected now(). */
  ts: number;
  kind: LedgerEntryKind;
  /** Signed integer credits: +grant/settle-remainder/refund, −hold, adjust either sign. */
  amount: number;
  /** Denormalized running balance for this user after this entry (balance = plain sum of amounts). */
  balanceAfter: number;
  ref: LedgerRef;
  meta: LedgerMeta;
  /** UNIQUE across the ledger — dedups payment webhooks and client retries. */
  idempotencyKey: string;
}

/** The store rejected an append because the idempotency key already exists. */
export class DuplicateIdempotencyKeyError extends Error {
  constructor(key: string) {
    super(`ledger idempotency key already exists: ${key}`);
    this.name = "DuplicateIdempotencyKeyError";
  }
}

/** The store rejected an append because the entry id already exists (internal invariant). */
export class DuplicateEntryIdError extends Error {
  constructor(id: string) {
    super(`ledger entry id already exists: ${id}`);
    this.name = "DuplicateEntryIdError";
  }
}

export interface LedgerStore {
  /**
   * Append one entry. Enforces idempotencyKey uniqueness (throws
   * DuplicateIdempotencyKeyError) and id uniqueness. Returns the stored,
   * frozen entry. Never updates existing rows.
   */
  append(entry: LedgerEntry): Promise<LedgerEntry>;
  byId(id: string): Promise<LedgerEntry | undefined>;
  byIdempotencyKey(key: string): Promise<LedgerEntry | undefined>;
  /** All entries for a user, in append order. */
  listByUser(userId: string): Promise<readonly LedgerEntry[]>;
  /**
   * All `hold` entries (optionally for one user) that have no closing entry.
   * A hold is CLOSED iff some settle/refund entry carries ref.holdId === hold.id;
   * open/closed is derived from the stream, never stored as a flag.
   */
  listOpenHolds(userId?: string): Promise<readonly LedgerEntry[]>;
  /** The settle/refund entry that closed a hold, if any. */
  closingEntryFor(holdId: string): Promise<LedgerEntry | undefined>;
}

function deepFreezeEntry(entry: LedgerEntry): LedgerEntry {
  Object.freeze(entry.ref);
  Object.freeze(entry.meta);
  return Object.freeze(entry);
}

export class InMemoryLedgerStore implements LedgerStore {
  private readonly entries: LedgerEntry[] = [];
  private readonly byIdIndex = new Map<string, LedgerEntry>();
  private readonly byKeyIndex = new Map<string, LedgerEntry>();
  /** holdId → the settle/refund entry that closed it. */
  private readonly closedHolds = new Map<string, LedgerEntry>();

  async append(entry: LedgerEntry): Promise<LedgerEntry> {
    if (this.byKeyIndex.has(entry.idempotencyKey)) {
      throw new DuplicateIdempotencyKeyError(entry.idempotencyKey);
    }
    if (this.byIdIndex.has(entry.id)) {
      throw new DuplicateEntryIdError(entry.id);
    }
    // Store a frozen copy: append-only means nobody can mutate history later.
    const stored = deepFreezeEntry({
      ...entry,
      ref: { ...entry.ref },
      meta: { ...entry.meta }
    });
    this.entries.push(stored);
    this.byIdIndex.set(stored.id, stored);
    this.byKeyIndex.set(stored.idempotencyKey, stored);
    if ((stored.kind === "settle" || stored.kind === "refund") && stored.ref.holdId) {
      this.closedHolds.set(stored.ref.holdId, stored);
    }
    return stored;
  }

  async byId(id: string): Promise<LedgerEntry | undefined> {
    return this.byIdIndex.get(id);
  }

  async byIdempotencyKey(key: string): Promise<LedgerEntry | undefined> {
    return this.byKeyIndex.get(key);
  }

  async listByUser(userId: string): Promise<readonly LedgerEntry[]> {
    return this.entries.filter((e) => e.userId === userId);
  }

  async listOpenHolds(userId?: string): Promise<readonly LedgerEntry[]> {
    return this.entries.filter(
      (e) =>
        e.kind === "hold" &&
        (userId === undefined || e.userId === userId) &&
        !this.closedHolds.has(e.id)
    );
  }

  async closingEntryFor(holdId: string): Promise<LedgerEntry | undefined> {
    return this.closedHolds.get(holdId);
  }
}
