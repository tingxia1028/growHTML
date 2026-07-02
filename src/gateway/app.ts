// Managed-gateway HTTP service (G-A2) — docs/design/managed-ai-credits.md §4.2.
//
// An express app FACTORY in the same style as src/server/app.ts's createApp: all
// dependencies are injected (ledger, auth, pricing, orchestrator, payments,
// clock) so tests run fully in-memory and deterministic. This service is the
// multi-user backend seam — it never touches the local JSONL vault.
//
// Conventions:
//   - every body is zod-validated BEFORE any side effect (a 400 never mutates);
//   - authenticated routes take `Authorization: Bearer <accessToken>` and 401
//     as JSON {code:"unauthorized"} on any defect (verifyAccess never throws);
//   - domain errors map to JSON {code, ...} via the tail error handler
//     (rate limits → 429, bad codes/tokens → 401, invalid input → 400);
//   - /agent/stream copies the SSE shape of src/server's /api/chat/stream
//     (event: chunk {delta} … event: done {…} / event: error {…}), wrapped in
//     the §4.3 hold → settle/refund credits lifecycle (see the route comment).
//
// METERING APPROXIMATION (honest disclosure): this slice cannot see real vendor
// usage — the ModelProvider seam yields plain text, no token counts. Until the
// AI SDK path lands in G-B (real DeepSeek prompt/completion usage), actual cost
// is approximated from OUTPUT length only: tokens ≈ ceil(chars / 4) (the common
// ~4-chars-per-token heuristic), priced through the pricing map's text route.
// Input tokens are deliberately NOT charged yet, and the settle is capped at the
// hold estimate — the user can never pay more than the pre-authorized ceiling
// even if the approximation overshoots. Real usage replaces this in G-B.

import express from "express";
import { z } from "zod";
import { chatRequestSchema, type ChatRequest, type ModelProvider } from "../ai/provider";
import type { AuthService } from "./auth";
import {
  CodeExpiredError,
  InvalidCodeError,
  InvalidPhoneError,
  InvalidRefreshTokenError,
  RateLimitedError,
  TooManyAttemptsError
} from "./auth";
import type { CreditsLedger } from "./ledger";
import { HoldAlreadyClosedError, InsufficientBalanceError } from "./ledger";
import type { LedgerEntry, LedgerMeta } from "./ledgerStore";
import type { PaymentAdapter, TopupSku } from "./payments";
import type { Pricing } from "./pricing";

// --- Config / deps ----------------------------------------------------------------

export interface GatewayConfig {
  /** Credits granted on the FIRST-ever login for a phone (0 disables the bonus). */
  signupBonusCredits: number;
  /** Fixed top-up packs (§4.5); /topup/create rejects skus not listed here. */
  topupSkus: TopupSku[];
  /** Mount POST /topup/mock-notify (dev/test webhook simulator). NEVER true in prod. */
  allowMockPay: boolean;
  /**
   * Per-run TOTAL text-token ceiling (in + out) priced into the hold
   * (§4.3 step 1 "estimate the run's max cost"). Default 8192.
   */
  maxTextTokensPerRun?: number;
}

export interface GatewayAppDeps {
  ledger: CreditsLedger;
  auth: AuthService;
  pricing: Pricing;
  /** The managed orchestrator behind the shared ModelProvider seam (§4.1). */
  orchestrator: ModelProvider;
  payments: PaymentAdapter;
  /** Injected clock (epoch ms) — used for run ids; ledger/auth carry their own. */
  now: () => number;
  config: GatewayConfig;
  /** Injectable run-id source (defaults to now+counter; production uses DB/uuid ids). */
  newRunId?: () => string;
}

const DEFAULT_MAX_TEXT_TOKENS_PER_RUN = 8192;
/** How many ledger entries GET /me/balance returns as `recent`. */
const BALANCE_RECENT_LIMIT = 20;

// ~4 chars per token — the G-A2 stand-in approximation (see file header).
const APPROX_CHARS_PER_TOKEN = 4;
function approxTokensFromText(text: string): number {
  return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN);
}

// --- Request bodies (validated BEFORE any side effect) ----------------------------

const requestCodeSchema = z.object({ phone: z.string().min(1) });
const verifySchema = z.object({ phone: z.string().min(1), code: z.string().min(1) });
const refreshSchema = z.object({ refreshToken: z.string().min(1) });
const topupCreateSchema = z.object({ sku: z.string().min(1) });
const mockNotifySchema = z.object({ paymentId: z.string().min(1) });
// /agent/stream reuses chatRequestSchema from src/ai — {messages, context?}.

export function createGatewayApp(deps: GatewayAppDeps): express.Express {
  const { ledger, auth, pricing, orchestrator, payments, now, config } = deps;
  if (!Number.isSafeInteger(config.signupBonusCredits) || config.signupBonusCredits < 0) {
    throw new Error(`signupBonusCredits must be an integer >= 0, got ${config.signupBonusCredits}`);
  }
  const maxTextTokensPerRun = config.maxTextTokensPerRun ?? DEFAULT_MAX_TEXT_TOKENS_PER_RUN;
  if (!Number.isSafeInteger(maxTextTokensPerRun) || maxTextTokensPerRun <= 0) {
    throw new Error(`maxTextTokensPerRun must be a positive integer, got ${maxTextTokensPerRun}`);
  }

  // Run ids anchor the per-run ledger idempotency keys (hold:/settle:/refund:<runId>).
  // In-memory default: clock + per-app counter. Production generates them DB-side so
  // a gateway restart against a persistent ledger can never reuse a run id (a reused
  // id would REPLAY the old hold instead of creating a new one).
  let runSeq = 0;
  const newRunId = deps.newRunId ?? (() => `run_${now()}_${String(++runSeq).padStart(4, "0")}`);

  // Pending top-up orders (paymentId → owner + pack). Production persists these in
  // Postgres BEFORE calling the payment vendor; this in-memory map is the dev/test
  // stand-in and lives only as long as the app instance.
  const pendingOrders = new Map<string, { userId: string; sku: TopupSku }>();

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  // Bearer auth → res.locals.userId. verifyAccess is stateless and never throws;
  // ANY defect (missing header, bad signature, expired) is the same 401.
  const requireAuth: express.RequestHandler = (req, res, next) => {
    const header = req.header("authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header);
    const userId = match ? auth.verifyAccess(match[1]) : null;
    if (!userId) {
      res.status(401).json({ code: "unauthorized", message: "missing or invalid access token" });
      return;
    }
    res.locals.userId = userId;
    next();
  };

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  // --- Auth (§4.4) ----------------------------------------------------------------

  app.post("/auth/request-code", async (req, res, next) => {
    try {
      const { phone } = requestCodeSchema.parse(req.body);
      await auth.requestCode(phone); // RateLimitedError → 429 via the tail handler
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.post("/auth/verify", async (req, res, next) => {
    try {
      const { phone, code } = verifySchema.parse(req.body);
      const { userId, isNewUser } = await auth.verifyCode(phone, code);
      // Signup bonus (§4.3 "Free tier"): granted by the ROUTE layer so auth stays
      // uncoupled from money. The fixed key `signup:<userId>` makes the grant
      // once-per-user even if verify somehow replays isNewUser: true — the ledger
      // returns the original entry and applies nothing.
      if (isNewUser && config.signupBonusCredits > 0) {
        await ledger.grant(
          userId,
          "signup_bonus",
          config.signupBonusCredits,
          {},
          {},
          `signup:${userId}`
        );
      }
      const pair = await auth.issueSession(userId);
      res.json({ userId, accessToken: pair.accessToken, refreshToken: pair.refreshToken, isNewUser });
    } catch (error) {
      next(error);
    }
  });

  app.post("/auth/refresh", async (req, res, next) => {
    try {
      const { refreshToken } = refreshSchema.parse(req.body);
      const pair = await auth.rotateRefresh(refreshToken); // invalid/reused → 401 via handler
      res.json({ accessToken: pair.accessToken, refreshToken: pair.refreshToken });
    } catch (error) {
      next(error);
    }
  });

  // --- Account --------------------------------------------------------------------

  app.get("/me/balance", requireAuth, async (_req, res, next) => {
    try {
      const userId = res.locals.userId as string;
      const entries = await ledger.entries(userId);
      const balance = await ledger.balance(userId);
      // Newest first — the last N of the append-ordered stream, reversed.
      const recent = entries
        .slice(-BALANCE_RECENT_LIMIT)
        .reverse()
        .map(({ id, kind, amount, ts }) => ({ id, kind, amount, ts }));
      res.json({ balance, recent });
    } catch (error) {
      next(error);
    }
  });

  // --- Agent run over SSE (§4.2/§4.3) -----------------------------------------------
  //
  // Credits lifecycle around the stream:
  //   1. validate + auth + HOLD, all while the response is still plain JSON —
  //      insufficient_balance is a 402 with {needed, balance} BEFORE any SSE byte
  //      and BEFORE any vendor call (§4.3 step 1).
  //   2. only after the hold sticks do we switch the response to text/event-stream
  //      and run the orchestrator, emitting `chunk` deltas.
  //   3. success → meter (output-length approximation, see file header) → settle
  //      actual ≤ estimate → `done` carrying {held, settled, remainder}.
  //   4. ANY failure after the hold → refund the hold IN FULL (failed runs are
  //      free, §4.3 step 3), then: headers already sent → `event: error` on the
  //      stream; not yet sent → normal 5xx JSON. If the settle already landed and
  //      only the final write failed, the refund is skipped (HoldAlreadyClosed) —
  //      the user paid for a run whose output they received.
  app.post("/agent/stream", requireAuth, async (req, res, next) => {
    const userId = res.locals.userId as string;

    // (1) Validate before ANY side effect — a 400 must not create a hold.
    let input: ChatRequest;
    try {
      input = chatRequestSchema.parse(req.body);
    } catch (error) {
      next(error);
      return;
    }

    const runId = newRunId();
    const route = pricing.routeFor("text");
    const runMeta: LedgerMeta = {
      modality: "text",
      vendor: route?.vendor,
      model: route?.model,
      priceVersion: pricing.priceVersion
    };

    // Price the run ceiling and pre-authorize. estimateRun throws only on config
    // defects (no text route) — that is a 500, not the user's fault.
    let holdEntry: LedgerEntry;
    let estimate = 0; // assigned before hold; only read in the 402 branch (hold threw)
    try {
      estimate = pricing.estimateRun({ maxTextTokens: maxTextTokensPerRun });
      holdEntry = await ledger.hold(userId, estimate, { agentRunId: runId }, runMeta, `hold:${runId}`);
    } catch (error) {
      if (error instanceof InsufficientBalanceError) {
        res.status(402).json({
          code: "insufficient_balance",
          needed: estimate,
          balance: await ledger.balance(userId)
        });
        return;
      }
      next(error);
      return;
    }
    const held = -holdEntry.amount;

    // (2) The hold stuck — open the stream (same header set as /api/chat/stream).
    // Headers are only QUEUED here; they hit the wire with the first write, so a
    // failure before the first chunk can still fall back to a plain 5xx JSON.
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    const send = (event: string, data: unknown) =>
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    try {
      let full = "";
      if (orchestrator.capabilities.streaming && orchestrator.stream) {
        for await (const delta of orchestrator.stream(input)) {
          full += delta;
          send("chunk", { delta });
        }
      } else {
        full = (await orchestrator.complete(input)).message.content;
        send("chunk", { delta: full });
      }

      // (3) Meter + settle. Output-length approximation (file header); capped at
      // the hold so settle can never exceed the pre-authorized estimate.
      const approxOutputTokens = approxTokensFromText(full);
      const metered = pricing.estimateRun({ maxTextTokens: approxOutputTokens });
      const settledCost = Math.min(metered, held);
      const settleEntry = await ledger.settle(
        holdEntry.id,
        settledCost,
        {
          ...runMeta,
          usage: {
            approxOutputChars: full.length,
            approxOutputTokens,
            approximation: "output-chars/4 (real vendor usage lands in G-B)"
          }
        },
        `settle:${runId}`
      );

      // `aiGenerated: true` is the IMPLICIT-label stand-in (§6 隐式标识): the
      // machine-readable generation attribute travels with the payload until the
      // full metadata stamping (provider code, content id) lands with real assets.
      send("done", {
        message: { role: "assistant", content: full },
        provider: orchestrator.id,
        aiGenerated: true,
        credits: { held, settled: settledCost, remainder: settleEntry.amount }
      });
      res.end();
    } catch (error) {
      // (4) Failed run → the user pays NOTHING: refund the hold in full. If the
      // settle already closed the hold (failure was after settling), skip — that
      // run succeeded from the ledger's point of view.
      try {
        await ledger.refundHold(holdEntry.id, `refund:${runId}`);
      } catch (refundError) {
        if (!(refundError instanceof HoldAlreadyClosedError)) {
          next(refundError);
          return;
        }
      }
      if (!res.headersSent) {
        // No SSE byte hit the wire yet (provider failed before the first chunk)
        // → surface a normal 5xx JSON. The SSE headers were only QUEUED, so drop
        // them (res.json keeps a pre-set Content-Type — it must not leak here).
        res.removeHeader("Content-Type");
        res.removeHeader("Cache-Control");
        res.removeHeader("Connection");
        next(error);
        return;
      }
      send("error", {
        code: "run_failed",
        error: error instanceof Error ? error.message : "stream failed"
      });
      res.end();
    }
  });

  // --- Top-up (§4.5) ----------------------------------------------------------------

  app.post("/topup/create", requireAuth, async (req, res, next) => {
    try {
      const { sku } = topupCreateSchema.parse(req.body);
      const pack = config.topupSkus.find((entry) => entry.sku === sku);
      if (!pack) {
        res.status(400).json({ code: "unknown_sku", message: `unknown top-up sku: ${sku}` });
        return;
      }
      const userId = res.locals.userId as string;
      const order = await payments.createOrder(userId, pack);
      pendingOrders.set(order.paymentId, { userId, sku: pack });
      res.json({
        paymentId: order.paymentId,
        qrPayload: order.qrPayload,
        amountYuan: pack.amountYuan,
        credits: pack.credits
      });
    } catch (error) {
      next(error);
    }
  });

  // Dev/test webhook simulator — mounted ONLY when allowMockPay. The real WeChat
  // notify handler slots in at this position with APIv3 signature verification +
  // resource decryption; crediting stays EXACTLY this call: an idempotent ledger
  // grant keyed `payment:<paymentId>`, so vendor redeliveries credit once (§4.5).
  if (config.allowMockPay) {
    app.post("/topup/mock-notify", async (req, res, next) => {
      try {
        const { paymentId } = mockNotifySchema.parse(req.body);
        const order = pendingOrders.get(paymentId);
        if (!order) {
          res.status(404).json({ code: "unknown_payment", message: `unknown paymentId: ${paymentId}` });
          return;
        }
        await ledger.grant(
          order.userId,
          "topup",
          order.sku.credits,
          { paymentId },
          {},
          `payment:${paymentId}`
        );
        res.json({ ok: true });
      } catch (error) {
        next(error);
      }
    });
  }

  // --- Tail error handler: domain errors → JSON {code, …} ---------------------------

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({ code: "invalid_request", issues: error.issues });
      return;
    }
    if (error instanceof InvalidPhoneError) {
      res.status(400).json({ code: "invalid_phone", message: error.message });
      return;
    }
    if (error instanceof RateLimitedError) {
      res.status(429).json({ code: "rate_limited", retryAfterMs: error.retryAfterMs, message: error.message });
      return;
    }
    if (error instanceof TooManyAttemptsError) {
      res.status(429).json({ code: "too_many_attempts", message: error.message });
      return;
    }
    if (error instanceof InvalidCodeError) {
      res.status(401).json({ code: "invalid_code", message: error.message });
      return;
    }
    if (error instanceof CodeExpiredError) {
      res.status(401).json({ code: "code_expired", message: error.message });
      return;
    }
    if (error instanceof InvalidRefreshTokenError) {
      res.status(401).json({ code: "invalid_refresh_token", message: error.message });
      return;
    }
    res.status(500).json({
      code: "internal_error",
      message: error instanceof Error ? error.message : "unknown gateway error"
    });
  });

  return app;
}
