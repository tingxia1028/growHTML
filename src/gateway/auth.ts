// Gateway accounts/auth — phone + SMS-code login and sessions (§4.4).
//
// All external touchpoints are seams with in-memory/mock implementations:
//   - SmsSender      → MockSmsSender (real 阿里云/腾讯云短信 adapter is license-gated,
//                      slots in at deploy time).
//   - AuthStore      → InMemoryAuthStore (codes + seen users; production = Postgres
//                      users table + Redis code cache, same semantics).
//   - SessionStore   → InMemorySessionStore (production = Redis, §4.4).
// All time flows through the injected now(); all randomness is injectable so
// tests are deterministic. Codes are stored ONLY as sha256(code + per-code salt)
// — the plaintext exists solely in the SMS to the user.
//
// NOT in this slice (G-A2): HTTP routes, CAPTCHA, and the signup-bonus grant —
// verifyCode returns isNewUser and the ROUTE layer writes the ledger grant; auth
// is deliberately not coupled to the ledger.

import {
  createHash,
  createHmac,
  randomBytes as nodeRandomBytes,
  randomInt as nodeRandomInt,
  timingSafeEqual
} from "node:crypto";

// --- Errors ---------------------------------------------------------------------

/** A code was requested again within the resend window (§4.4 rate-limit ~1/60s/number). */
export class RateLimitedError extends Error {
  constructor(readonly retryAfterMs: number) {
    super(`SMS code already sent; retry in ${retryAfterMs}ms`);
    this.name = "RateLimitedError";
  }
}

/** No active code / already used / wrong code — deliberately one error, no oracle. */
export class InvalidCodeError extends Error {
  constructor(message = "invalid verification code") {
    super(message);
    this.name = "InvalidCodeError";
  }
}

export class CodeExpiredError extends Error {
  constructor(message = "verification code expired") {
    super(message);
    this.name = "CodeExpiredError";
  }
}

/** The per-code verify-attempt cap was exhausted; the code is locked (request a new one). */
export class TooManyAttemptsError extends Error {
  constructor(message = "too many verification attempts; request a new code") {
    super(message);
    this.name = "TooManyAttemptsError";
  }
}

export class InvalidPhoneError extends Error {
  constructor(phone: string) {
    super(`invalid phone number: ${phone}`);
    this.name = "InvalidPhoneError";
  }
}

/** Refresh token unknown, rotated away, or revoked. */
export class InvalidRefreshTokenError extends Error {
  constructor(message = "refresh token is not valid") {
    super(message);
    this.name = "InvalidRefreshTokenError";
  }
}

// --- Seams (interfaces + in-memory/mock implementations) -------------------------

export interface SmsSender {
  send(phone: string, code: string): Promise<void>;
}

/** Dev/test sender: records every (phone, code) instead of touching a carrier. */
export class MockSmsSender implements SmsSender {
  readonly sent: Array<{ phone: string; code: string }> = [];
  async send(phone: string, code: string): Promise<void> {
    this.sent.push({ phone, code });
  }
  lastCodeFor(phone: string): string | undefined {
    for (let i = this.sent.length - 1; i >= 0; i--) {
      if (this.sent[i].phone === phone) return this.sent[i].code;
    }
    return undefined;
  }
}

export interface SmsCodeRecord {
  phone: string;
  /** sha256(code + salt) — never the plaintext code. */
  codeHash: Buffer;
  salt: Buffer;
  createdAt: number;
  expiresAt: number;
  attempts: number;
  used: boolean;
}

/**
 * Codes + the seen-user set. One active code per phone (a new request replaces
 * the old). Production: Redis (codes, TTL'd) + Postgres (users) — same semantics.
 */
export interface AuthStore {
  getCode(phone: string): Promise<SmsCodeRecord | undefined>;
  putCode(record: SmsCodeRecord): Promise<void>;
  hasUser(userId: string): Promise<boolean>;
  addUser(userId: string): Promise<void>;
}

export class InMemoryAuthStore implements AuthStore {
  private readonly codes = new Map<string, SmsCodeRecord>();
  private readonly users = new Set<string>();

  async getCode(phone: string): Promise<SmsCodeRecord | undefined> {
    return this.codes.get(phone);
  }
  async putCode(record: SmsCodeRecord): Promise<void> {
    this.codes.set(record.phone, record);
  }
  async hasUser(userId: string): Promise<boolean> {
    return this.users.has(userId);
  }
  async addUser(userId: string): Promise<void> {
    this.users.add(userId);
  }
}

export interface SessionRecord {
  userId: string;
  createdAt: number;
  revokedAt?: number;
}

/** Refresh tokens, keyed by token. Production: Redis with rotation (§4.4). */
export interface SessionStore {
  get(refreshToken: string): Promise<SessionRecord | undefined>;
  put(refreshToken: string, record: SessionRecord): Promise<void>;
  /** Mark revoked (kept for reuse detection rather than deleted). */
  revoke(refreshToken: string, at: number): Promise<void>;
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();

  async get(refreshToken: string): Promise<SessionRecord | undefined> {
    return this.sessions.get(refreshToken);
  }
  async put(refreshToken: string, record: SessionRecord): Promise<void> {
    this.sessions.set(refreshToken, { ...record });
  }
  async revoke(refreshToken: string, at: number): Promise<void> {
    const record = this.sessions.get(refreshToken);
    if (record && record.revokedAt === undefined) record.revokedAt = at;
  }
}

// --- Service --------------------------------------------------------------------

export interface AuthServiceDeps {
  now: () => number;
  sms: SmsSender;
  authStore: AuthStore;
  sessionStore: SessionStore;
  /** HMAC key for access tokens — injected (deploy secret), never generated here. */
  accessTokenKey: Buffer | string;
  /** Injectable randomness (defaults: node:crypto). */
  randomInt?: (maxExclusive: number) => number;
  randomBytes?: (size: number) => Buffer;
  /** Tunables (defaults per §4.4). */
  codeTtlMs?: number; // 10 min
  resendIntervalMs?: number; // 60 s
  maxVerifyAttempts?: number; // 5
  accessTtlMs?: number; // 1 h
  /** Domain-separates the phone→userId hash; same salt ⇒ same stable userIds. */
  userIdSalt?: string;
}

export interface VerifyCodeResult {
  userId: string;
  /** True exactly once — the first successful login for this phone (G-A2 grants the signup bonus). */
  isNewUser: boolean;
}

export interface SessionPair {
  accessToken: string;
  refreshToken: string;
}

const DEFAULT_CODE_TTL_MS = 10 * 60_000;
const DEFAULT_RESEND_INTERVAL_MS = 60_000;
const DEFAULT_MAX_VERIFY_ATTEMPTS = 5;
const DEFAULT_ACCESS_TTL_MS = 60 * 60_000;
const DEFAULT_USER_ID_SALT = "growhtml-gateway-user.v1";

// digits only, optional leading +, 5–20 digits (format policy beyond this is a route concern)
const PHONE_RE = /^\+?[0-9]{5,20}$/;

function sha256(...parts: Array<Buffer | string>): Buffer {
  const h = createHash("sha256");
  for (const part of parts) h.update(part);
  return h.digest();
}

function b64url(data: Buffer): string {
  return data.toString("base64url");
}

export class AuthService {
  private readonly now: () => number;
  private readonly sms: SmsSender;
  private readonly authStore: AuthStore;
  private readonly sessionStore: SessionStore;
  private readonly accessTokenKey: Buffer;
  private readonly randomInt: (maxExclusive: number) => number;
  private readonly randomBytes: (size: number) => Buffer;
  private readonly codeTtlMs: number;
  private readonly resendIntervalMs: number;
  private readonly maxVerifyAttempts: number;
  private readonly accessTtlMs: number;
  private readonly userIdSalt: string;

  constructor(deps: AuthServiceDeps) {
    this.now = deps.now;
    this.sms = deps.sms;
    this.authStore = deps.authStore;
    this.sessionStore = deps.sessionStore;
    this.accessTokenKey = Buffer.isBuffer(deps.accessTokenKey)
      ? deps.accessTokenKey
      : Buffer.from(deps.accessTokenKey, "utf8");
    this.randomInt = deps.randomInt ?? ((maxExclusive) => nodeRandomInt(0, maxExclusive));
    this.randomBytes = deps.randomBytes ?? nodeRandomBytes;
    this.codeTtlMs = deps.codeTtlMs ?? DEFAULT_CODE_TTL_MS;
    this.resendIntervalMs = deps.resendIntervalMs ?? DEFAULT_RESEND_INTERVAL_MS;
    this.maxVerifyAttempts = deps.maxVerifyAttempts ?? DEFAULT_MAX_VERIFY_ATTEMPTS;
    this.accessTtlMs = deps.accessTtlMs ?? DEFAULT_ACCESS_TTL_MS;
    this.userIdSalt = deps.userIdSalt ?? DEFAULT_USER_ID_SALT;
  }

  /** Stable userId for a phone: usr_ + hex(sha256(salt ‖ phone))[0..16]. */
  userIdForPhone(phone: string): string {
    return `usr_${sha256(this.userIdSalt, ":", phone).toString("hex").slice(0, 16)}`;
  }

  /**
   * Generate + send a 6-digit code. Rate-limited to one send per phone per
   * resendIntervalMs (measured from the previous send, regardless of whether
   * that code was used). Replaces any previous code for the phone (attempts reset).
   */
  async requestCode(phone: string): Promise<void> {
    if (!PHONE_RE.test(phone)) throw new InvalidPhoneError(phone);
    const now = this.now();
    const previous = await this.authStore.getCode(phone);
    if (previous) {
      const sinceLastSend = now - previous.createdAt;
      if (sinceLastSend < this.resendIntervalMs) {
        throw new RateLimitedError(this.resendIntervalMs - sinceLastSend);
      }
    }
    const code = String(this.randomInt(1_000_000)).padStart(6, "0");
    const salt = this.randomBytes(16);
    await this.authStore.putCode({
      phone,
      codeHash: sha256(code, salt),
      salt,
      createdAt: now,
      expiresAt: now + this.codeTtlMs,
      attempts: 0,
      used: false
    });
    await this.sms.send(phone, code);
  }

  /**
   * Verify a code: single-use, expiring, attempt-capped, constant-time compare.
   * Success yields the stable userId; the FIRST-ever success for a phone also
   * reports isNewUser: true (the caller — G-A2 — grants the signup bonus through
   * the ledger with an idempotent key; auth stays uncoupled from money).
   */
  async verifyCode(phone: string, code: string): Promise<VerifyCodeResult> {
    if (!PHONE_RE.test(phone)) throw new InvalidPhoneError(phone);
    const now = this.now();
    const record = await this.authStore.getCode(phone);
    if (!record || record.used) throw new InvalidCodeError();
    if (now >= record.expiresAt) throw new CodeExpiredError();
    if (record.attempts >= this.maxVerifyAttempts) throw new TooManyAttemptsError();

    const candidateHash = sha256(code, record.salt);
    // Both sides are sha256 digests (32 bytes), so lengths always match.
    const matches = timingSafeEqual(candidateHash, record.codeHash);
    if (!matches) {
      await this.authStore.putCode({ ...record, attempts: record.attempts + 1 });
      throw new InvalidCodeError();
    }

    await this.authStore.putCode({ ...record, used: true });
    const userId = this.userIdForPhone(phone);
    const isNewUser = !(await this.authStore.hasUser(userId));
    if (isNewUser) await this.authStore.addUser(userId);
    return { userId, isNewUser };
  }

  // --- Sessions -----------------------------------------------------------------

  /** New access + refresh pair. Refresh token is 32 random bytes, stored server-side. */
  async issueSession(userId: string): Promise<SessionPair> {
    const refreshToken = b64url(this.randomBytes(32));
    await this.sessionStore.put(refreshToken, { userId, createdAt: this.now() });
    return { accessToken: this.signAccessToken(userId), refreshToken };
  }

  /**
   * Stateless access-token check: signature (timingSafeEqual) + expiry.
   * Returns the userId, or null for ANY defect — never throws.
   */
  verifyAccess(token: string): string | null {
    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const [payloadB64, sigB64] = parts;
    const expected = createHmac("sha256", this.accessTokenKey).update(payloadB64).digest();
    let given: Buffer;
    try {
      given = Buffer.from(sigB64, "base64url");
    } catch {
      return null;
    }
    if (given.length !== expected.length) return null;
    if (!timingSafeEqual(given, expected)) return null;
    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    } catch {
      return null;
    }
    if (typeof payload !== "object" || payload === null) return null;
    const { userId, exp } = payload as { userId?: unknown; exp?: unknown };
    if (typeof userId !== "string" || userId.length === 0) return null;
    if (typeof exp !== "number" || !Number.isFinite(exp)) return null;
    if (this.now() >= exp) return null;
    return userId;
  }

  /**
   * Exchange a live refresh token for a fresh pair; the old token is revoked
   * (kept, marked — presenting it again is a reuse signal and fails).
   */
  async rotateRefresh(refreshToken: string): Promise<SessionPair> {
    const record = await this.sessionStore.get(refreshToken);
    if (!record || record.revokedAt !== undefined) throw new InvalidRefreshTokenError();
    await this.sessionStore.revoke(refreshToken, this.now());
    return this.issueSession(record.userId);
  }

  /** Revoke a refresh token (logout). Idempotent; unknown tokens are a no-op. */
  async revokeSession(refreshToken: string): Promise<void> {
    await this.sessionStore.revoke(refreshToken, this.now());
  }

  /** Compact signed access token: b64url(json{userId,exp}) + "." + b64url(hmac-sha256). */
  private signAccessToken(userId: string): string {
    const payloadB64 = b64url(
      Buffer.from(JSON.stringify({ userId, exp: this.now() + this.accessTtlMs }), "utf8")
    );
    const sig = createHmac("sha256", this.accessTokenKey).update(payloadB64).digest();
    return `${payloadB64}.${b64url(sig)}`;
  }
}
