import { describe, expect, it } from "vitest";
import {
  AuthService,
  CodeExpiredError,
  InMemoryAuthStore,
  InMemorySessionStore,
  InvalidCodeError,
  InvalidPhoneError,
  InvalidRefreshTokenError,
  MockSmsSender,
  RateLimitedError,
  TooManyAttemptsError
} from "./auth";

const PHONE = "+8613800138000";
const OTHER_PHONE = "+8613900139000";

// Deterministic harness: manual clock + seeded-sequence randomness.
function makeAuth(overrides: { randomInt?: (max: number) => number } = {}) {
  let nowMs = 1_000_000;
  const sms = new MockSmsSender();
  const authStore = new InMemoryAuthStore();
  const sessionStore = new InMemorySessionStore();
  let byteSeq = 0;
  const auth = new AuthService({
    now: () => nowMs,
    sms,
    authStore,
    sessionStore,
    accessTokenKey: "test-hmac-key-please-inject-in-prod",
    // fixed-sequence bytes: unique per call, deterministic across runs
    randomBytes: (size) => Buffer.alloc(size, ++byteSeq & 0xff),
    ...(overrides.randomInt ? { randomInt: overrides.randomInt } : {})
  });
  return {
    auth,
    sms,
    tick: (ms: number) => {
      nowMs += ms;
    }
  };
}

async function login(harness: ReturnType<typeof makeAuth>, phone = PHONE) {
  await harness.auth.requestCode(phone);
  const code = harness.sms.lastCodeFor(phone)!;
  return harness.auth.verifyCode(phone, code);
}

describe("auth — requestCode", () => {
  it("sends a 6-digit code through the SmsSender and stores no plaintext anywhere reachable", async () => {
    const h = makeAuth();
    await h.auth.requestCode(PHONE);
    expect(h.sms.sent).toHaveLength(1);
    expect(h.sms.sent[0].phone).toBe(PHONE);
    expect(h.sms.sent[0].code).toMatch(/^[0-9]{6}$/);
  });

  it("zero-pads small codes to 6 digits (randomInt returning 7 → \"000007\")", async () => {
    const h = makeAuth({ randomInt: () => 7 });
    await h.auth.requestCode(PHONE);
    expect(h.sms.sent[0].code).toBe("000007");
    // and the padded form is what verifies
    await expect(h.auth.verifyCode(PHONE, "000007")).resolves.toMatchObject({ isNewUser: true });
  });

  it("rate-limits resends: <60s rejected with retryAfterMs, ≥60s allowed; limit is per phone", async () => {
    const h = makeAuth();
    await h.auth.requestCode(PHONE);
    h.tick(30_000);
    const err = await h.auth.requestCode(PHONE).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect((err as RateLimitedError).retryAfterMs).toBe(30_000);
    // a different phone is not throttled by the first one
    await expect(h.auth.requestCode(OTHER_PHONE)).resolves.toBeUndefined();
    h.tick(30_000); // 60s since PHONE's send
    await expect(h.auth.requestCode(PHONE)).resolves.toBeUndefined();
    expect(h.sms.sent.filter((s) => s.phone === PHONE)).toHaveLength(2);
  });

  it("rejects malformed phone numbers", async () => {
    const h = makeAuth();
    await expect(h.auth.requestCode("not-a-phone")).rejects.toBeInstanceOf(InvalidPhoneError);
    await expect(h.auth.requestCode("")).rejects.toBeInstanceOf(InvalidPhoneError);
    await expect(h.auth.verifyCode("abc", "123456")).rejects.toBeInstanceOf(InvalidPhoneError);
  });
});

describe("auth — verifyCode", () => {
  it("correct code → stable usr_ id; isNewUser true exactly once", async () => {
    const h = makeAuth();
    const first = await login(h);
    expect(first.userId).toMatch(/^usr_[0-9a-f]{16}$/);
    expect(first.isNewUser).toBe(true);

    h.tick(120_000); // past the resend window
    const second = await login(h);
    expect(second.userId).toBe(first.userId); // stable across logins
    expect(second.isNewUser).toBe(false); // only the FIRST-ever success

    const other = await login(h, OTHER_PHONE);
    expect(other.userId).not.toBe(first.userId);
  });

  it("rejects a wrong code without consuming the right one", async () => {
    const h = makeAuth();
    await h.auth.requestCode(PHONE);
    await expect(h.auth.verifyCode(PHONE, "999999")).rejects.toBeInstanceOf(InvalidCodeError);
    const code = h.sms.lastCodeFor(PHONE)!;
    await expect(h.auth.verifyCode(PHONE, code)).resolves.toMatchObject({ isNewUser: true });
  });

  it("rejects when no code was ever requested", async () => {
    const h = makeAuth();
    await expect(h.auth.verifyCode(PHONE, "123456")).rejects.toBeInstanceOf(InvalidCodeError);
  });

  it("expires codes after 10 minutes", async () => {
    const h = makeAuth();
    await h.auth.requestCode(PHONE);
    const code = h.sms.lastCodeFor(PHONE)!;
    h.tick(10 * 60_000); // exactly at expiry — already dead
    await expect(h.auth.verifyCode(PHONE, code)).rejects.toBeInstanceOf(CodeExpiredError);
  });

  it("still verifies just before expiry", async () => {
    const h = makeAuth();
    await h.auth.requestCode(PHONE);
    const code = h.sms.lastCodeFor(PHONE)!;
    h.tick(10 * 60_000 - 1);
    await expect(h.auth.verifyCode(PHONE, code)).resolves.toMatchObject({ isNewUser: true });
  });

  it("caps verify attempts at 5: the 5th wrong try locks the code even for the true code", async () => {
    const h = makeAuth();
    await h.auth.requestCode(PHONE);
    const code = h.sms.lastCodeFor(PHONE)!;
    for (let i = 0; i < 5; i++) {
      await expect(h.auth.verifyCode(PHONE, "000000")).rejects.toBeInstanceOf(InvalidCodeError);
    }
    await expect(h.auth.verifyCode(PHONE, code)).rejects.toBeInstanceOf(TooManyAttemptsError);
    await expect(h.auth.verifyCode(PHONE, "000000")).rejects.toBeInstanceOf(TooManyAttemptsError);
  });

  it("allows the true code on the 5th attempt (after 4 failures)", async () => {
    const h = makeAuth();
    await h.auth.requestCode(PHONE);
    const code = h.sms.lastCodeFor(PHONE)!;
    for (let i = 0; i < 4; i++) {
      await expect(h.auth.verifyCode(PHONE, "000000")).rejects.toBeInstanceOf(InvalidCodeError);
    }
    await expect(h.auth.verifyCode(PHONE, code)).resolves.toMatchObject({ isNewUser: true });
  });

  it("codes are single-use: a second verify with the same code fails", async () => {
    const h = makeAuth();
    await h.auth.requestCode(PHONE);
    const code = h.sms.lastCodeFor(PHONE)!;
    await h.auth.verifyCode(PHONE, code);
    await expect(h.auth.verifyCode(PHONE, code)).rejects.toBeInstanceOf(InvalidCodeError);
  });

  it("a new request replaces the old code and resets the attempt count", async () => {
    const h = makeAuth({ randomInt: (() => { let n = 0; return () => (n += 111_111); })() });
    await h.auth.requestCode(PHONE);
    const oldCode = h.sms.lastCodeFor(PHONE)!;
    await expect(h.auth.verifyCode(PHONE, "000000")).rejects.toBeInstanceOf(InvalidCodeError);
    h.tick(60_000);
    await h.auth.requestCode(PHONE);
    const newCode = h.sms.lastCodeFor(PHONE)!;
    expect(newCode).not.toBe(oldCode);
    await expect(h.auth.verifyCode(PHONE, oldCode)).rejects.toBeInstanceOf(InvalidCodeError);
    await expect(h.auth.verifyCode(PHONE, newCode)).resolves.toMatchObject({ isNewUser: true });
  });
});

describe("auth — sessions", () => {
  it("issueSession → verifyAccess roundtrip yields the userId", async () => {
    const h = makeAuth();
    const { userId } = await login(h);
    const { accessToken, refreshToken } = await h.auth.issueSession(userId);
    expect(accessToken.split(".")).toHaveLength(2);
    expect(refreshToken.length).toBeGreaterThanOrEqual(43); // 32 bytes base64url
    expect(h.auth.verifyAccess(accessToken)).toBe(userId);
  });

  it("expired access token → null (1h TTL)", async () => {
    const h = makeAuth();
    const { accessToken } = await h.auth.issueSession("usr_x");
    h.tick(60 * 60_000 - 1);
    expect(h.auth.verifyAccess(accessToken)).toBe("usr_x");
    h.tick(1); // exactly at exp — dead
    expect(h.auth.verifyAccess(accessToken)).toBeNull();
  });

  it("tampered tokens → null: signature flip, payload flip, structure garbage, wrong key", async () => {
    const h = makeAuth();
    const { accessToken } = await h.auth.issueSession("usr_x");
    const [payload, sig] = accessToken.split(".");

    const flip = (s: string, i: number) => s.slice(0, i) + (s[i] === "A" ? "B" : "A") + s.slice(i + 1);
    expect(h.auth.verifyAccess(`${payload}.${flip(sig, 3)}`)).toBeNull(); // flipped sig byte
    expect(h.auth.verifyAccess(`${flip(payload, 3)}.${sig}`)).toBeNull(); // flipped payload byte
    expect(h.auth.verifyAccess(`${payload}.${sig.slice(0, -2)}`)).toBeNull(); // truncated sig
    expect(h.auth.verifyAccess("")).toBeNull();
    expect(h.auth.verifyAccess("garbage")).toBeNull();
    expect(h.auth.verifyAccess("a.b.c")).toBeNull();
    expect(h.auth.verifyAccess(`${payload}.`)).toBeNull();

    // signed with a DIFFERENT key → rejected here
    const other = new AuthService({
      now: () => 1_000_000,
      sms: new MockSmsSender(),
      authStore: new InMemoryAuthStore(),
      sessionStore: new InMemorySessionStore(),
      accessTokenKey: "a-completely-different-key"
    });
    expect(h.auth.verifyAccess((await other.issueSession("usr_x")).accessToken)).toBeNull();
  });

  it("a forged payload with a copied signature does not verify", async () => {
    const h = makeAuth();
    const { accessToken } = await h.auth.issueSession("usr_victim");
    const sig = accessToken.split(".")[1];
    const forged = Buffer.from(
      JSON.stringify({ userId: "usr_attacker", exp: Number.MAX_SAFE_INTEGER }),
      "utf8"
    ).toString("base64url");
    expect(h.auth.verifyAccess(`${forged}.${sig}`)).toBeNull();
  });

  it("rotateRefresh returns a working new pair and revokes the old token", async () => {
    const h = makeAuth();
    const pair1 = await h.auth.issueSession("usr_x");
    const pair2 = await h.auth.rotateRefresh(pair1.refreshToken);
    expect(pair2.refreshToken).not.toBe(pair1.refreshToken);
    expect(h.auth.verifyAccess(pair2.accessToken)).toBe("usr_x");
    // the old refresh token is dead — reuse fails
    await expect(h.auth.rotateRefresh(pair1.refreshToken)).rejects.toBeInstanceOf(InvalidRefreshTokenError);
    // the new one still rotates fine
    await expect(h.auth.rotateRefresh(pair2.refreshToken)).resolves.toBeTruthy();
  });

  it("rotateRefresh rejects unknown tokens", async () => {
    const h = makeAuth();
    await expect(h.auth.rotateRefresh("never-issued")).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });

  it("revokeSession kills the refresh token (idempotently)", async () => {
    const h = makeAuth();
    const pair = await h.auth.issueSession("usr_x");
    await h.auth.revokeSession(pair.refreshToken);
    await h.auth.revokeSession(pair.refreshToken); // no-op, no throw
    await h.auth.revokeSession("unknown-token"); // no-op, no throw
    await expect(h.auth.rotateRefresh(pair.refreshToken)).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });
});
