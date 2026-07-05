// ManagedGatewayClient (G-A3b) — the SERVER-side thin client for the managed
// credits gateway's ACCOUNT + PAYMENT routes (login / balance / top-up), the
// settings-panel sibling of src/ai/managed.ts's chat client. It lives server-side
// for the same boundary reason BYOK keys do: the session token is a bearer secret
// stored ENCRYPTED via the keyStore (safeStorage), and the renderer never receives
// it — the client UI calls /api/ai/providers/managed/* and this module talks to the
// gateway origin on its behalf, so no token ever crosses the contextBridge.
//
// It maps 1:1 onto the shipped gateway routes (src/gateway/app.ts):
//   requestCode  → POST /auth/request-code   (204; RateLimited → 429)
//   verify       → POST /auth/verify         ({userId, accessToken, refreshToken, isNewUser})
//   getBalance   → GET  /me/balance          ({balance, recent}) — refresh-on-401
//   createTopup  → POST /topup/create        ({paymentId, qrPayload, amountYuan, credits})
//   mockNotify   → POST /topup/mock-notify   (dev/test credit simulator, allowMockPay)
//
// SECURITY: the token is sent ONLY to the configured gateway origin (baseUrl —
// stored entry ?? env, never hardcoded) as `Authorization: Bearer`, and is NEVER
// logged. Refresh-on-401 (delta 5): a 401 on an authed read triggers ONE
// POST /auth/refresh with the stored refresh token; the rotated pair is persisted
// and the original request retried once. A refresh failure surfaces as a typed
// re-login prompt (ManagedGatewayNotLoggedInError), never a silent hang.

import type { ManagedSession } from "./aiProviders";

/** Managed is selected but has no stored/valid session — the UI shows 登录 (not a stream error). */
export class ManagedGatewayNotLoggedInError extends Error {
  readonly code = "managed_not_logged_in";
  constructor(message = "未登录托管积分 — 请先登录（登录）") {
    super(message);
    this.name = "ManagedGatewayNotLoggedInError";
  }
}

/** The gateway URL is not configured (no stored baseUrl and no env fallback). */
export class ManagedGatewayNotConfiguredError extends Error {
  readonly code = "managed_gateway_not_configured";
  constructor(message = "托管积分网关地址未配置 — 请在设置中填写网关 URL 或设置 STUDY_VAULT_MANAGED_GATEWAY_URL") {
    super(message);
    this.name = "ManagedGatewayNotConfiguredError";
  }
}

/** Any non-2xx from the gateway that isn't an auth/refresh case (400/429/5xx). */
export class ManagedGatewayRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly gatewayCode?: string
  ) {
    super(message);
    this.name = "ManagedGatewayRequestError";
  }
}

export type VerifyResult = { userId: string; isNewUser: boolean };
export type BalanceResult = {
  balance: number;
  recent: Array<{ id: string; kind: string; amount: number; ts: number }>;
};
export type TopupResult = { paymentId: string; qrPayload: string; amountYuan: number; credits: number };

export type ManagedGatewayClientDeps = {
  /** The gateway origin (trailing slash tolerated). Empty → ManagedGatewayNotConfiguredError. */
  baseUrl: string;
  /** Read the stored session (access + refresh), or null when logged out. */
  getSession: () => Promise<ManagedSession | null>;
  /** Persist a rotated/new session pair (keyStore, encrypted). Called on verify + refresh. */
  saveSession: (session: ManagedSession) => Promise<void>;
  /** Injectable fetch for tests (defaults to global fetch). */
  fetch?: typeof fetch;
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

async function jsonBody(response: Response): Promise<Record<string, unknown>> {
  try {
    return asRecord(await response.json());
  } catch {
    return {};
  }
}

function str(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function num(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" ? value : 0;
}

/**
 * The thin managed-gateway client. Construction is cheap; every method resolves the
 * base URL fresh and never touches the network until called. `getSession`/`saveSession`
 * are keyStore-backed at the route layer — the token is ENCRYPTED at rest.
 */
export class ManagedGatewayClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly deps: ManagedGatewayClientDeps) {
    this.fetchImpl = deps.fetch ?? fetch;
  }

  private base(): string {
    const trimmed = this.deps.baseUrl.trim().replace(/\/+$/, "");
    if (!trimmed) throw new ManagedGatewayNotConfiguredError();
    return trimmed;
  }

  /** Request an SMS login code for a phone (204). RateLimited/invalid → ManagedGatewayRequestError. */
  async requestCode(phone: string): Promise<void> {
    const response = await this.fetchImpl(`${this.base()}/auth/request-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone })
    });
    if (response.status === 204) return;
    await this.throwFromNonOk(response);
  }

  /** Verify a code → mint + PERSIST the session pair; returns the account summary. */
  async verify(phone: string, code: string): Promise<VerifyResult> {
    const response = await this.fetchImpl(`${this.base()}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, code })
    });
    if (!response.ok) await this.throwFromNonOk(response);
    const body = await jsonBody(response);
    const accessToken = str(body, "accessToken");
    if (!accessToken) throw new ManagedGatewayRequestError("网关未返回访问令牌", response.status);
    await this.deps.saveSession({ accessToken, refreshToken: str(body, "refreshToken") });
    return { userId: str(body, "userId") ?? "", isNewUser: body.isNewUser === true };
  }

  /** The current balance + recent ledger rows. Refresh-on-401, then retry once. */
  getBalance(): Promise<BalanceResult> {
    return this.authed(async (token) => {
      const response = await this.fetchImpl(`${this.base()}/me/balance`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return response;
    }).then(async (response) => {
      const body = await jsonBody(response);
      const recentRaw = Array.isArray(body.recent) ? (body.recent as unknown[]) : [];
      return {
        balance: num(body, "balance"),
        recent: recentRaw.map((row) => {
          const r = asRecord(row);
          return { id: str(r, "id") ?? "", kind: str(r, "kind") ?? "", amount: num(r, "amount"), ts: num(r, "ts") };
        })
      };
    });
  }

  /** Create a top-up order for a sku (returns the QR payload the client renders). */
  createTopup(sku: string): Promise<TopupResult> {
    return this.authed(async (token) => {
      const response = await this.fetchImpl(`${this.base()}/topup/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sku })
      });
      return response;
    }).then(async (response) => {
      const body = await jsonBody(response);
      return {
        paymentId: str(body, "paymentId") ?? "",
        qrPayload: str(body, "qrPayload") ?? "",
        amountYuan: num(body, "amountYuan"),
        credits: num(body, "credits")
      };
    });
  }

  /** Dev/test-only: simulate the vendor pay webhook so a top-up actually credits (idempotent). */
  async mockNotify(paymentId: string): Promise<void> {
    const response = await this.fetchImpl(`${this.base()}/topup/mock-notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentId })
    });
    if (!response.ok) await this.throwFromNonOk(response);
  }

  /**
   * Run an authenticated request, refreshing ONCE on a 401: read the stored session
   * (else not-logged-in), call `run(accessToken)`; if it 401s, POST /auth/refresh with
   * the stored refresh token, persist the rotated pair, and retry the request once. A
   * missing session / a failed refresh both surface ManagedGatewayNotLoggedInError.
   */
  private async authed(run: (accessToken: string) => Promise<Response>): Promise<Response> {
    const session = await this.deps.getSession();
    if (!session?.accessToken) throw new ManagedGatewayNotLoggedInError();

    let response = await run(session.accessToken);
    if (response.status === 401) {
      response.body?.cancel().catch(() => undefined);
      const refreshed = await this.tryRefresh(session.refreshToken);
      if (!refreshed) throw new ManagedGatewayNotLoggedInError("会话已过期 — 请重新登录（重新登录）");
      response = await run(refreshed.accessToken);
      if (response.status === 401) throw new ManagedGatewayNotLoggedInError("会话已过期 — 请重新登录（重新登录）");
    }
    if (!response.ok) await this.throwFromNonOk(response);
    return response;
  }

  /** POST /auth/refresh with the stored refresh token; persist + return the rotated pair, or null. */
  private async tryRefresh(refreshToken: string | undefined): Promise<ManagedSession | null> {
    if (!refreshToken) return null;
    const response = await this.fetchImpl(`${this.base()}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken })
    });
    if (!response.ok) {
      response.body?.cancel().catch(() => undefined);
      return null;
    }
    const body = await jsonBody(response);
    const accessToken = str(body, "accessToken");
    if (!accessToken) return null;
    const rotated: ManagedSession = { accessToken, refreshToken: str(body, "refreshToken") ?? refreshToken };
    await this.deps.saveSession(rotated);
    return rotated;
  }

  /** Map a non-2xx gateway response to a typed error (never leaks the token; reads {code, message}). */
  private async throwFromNonOk(response: Response): Promise<never> {
    const body = await jsonBody(response);
    const code = str(body, "code");
    const message = str(body, "message") ?? str(body, "error") ?? code ?? `请求失败（${response.status}）`;
    throw new ManagedGatewayRequestError(message, response.status, code);
  }
}
