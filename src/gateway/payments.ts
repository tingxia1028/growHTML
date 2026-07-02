// Gateway payments — the top-up order seam (docs/design/managed-ai-credits.md §4.5).
//
// The REAL adapter is WeChat Native支付: server calls Native下单 → `code_url`
// (valid ~2h) → the client renders it as a QR the user scans in WeChat. Success
// is credited ONLY by the async notify webhook (never client-side), which slots
// into the gateway's /topup/mock-notify position with APIv3 signature
// verification + resource decryption. That adapter is license-gated (商户号
// requires a 个体工商户) and lands at deploy time — NOT in this slice.
//
// MockPaymentAdapter is the dev/test stand-in: deterministic order ids and a
// `mockpay://` QR payload, so the create→notify→credit loop is fully testable
// offline. Crediting idempotency does NOT live here — the route layer grants
// through the ledger with idempotencyKey `payment:<paymentId>`, which is what
// makes WeChat's ~15× webhook redeliveries safe (§4.5).

/** One fixed top-up pack (§4.5 recommends a small fixed SKU set, e.g. ¥10/¥30/¥100). */
export interface TopupSku {
  sku: string;
  amountYuan: number;
  credits: number;
}

export interface PaymentOrder {
  /** Gateway-side payment id — the idempotency anchor for webhook crediting. */
  paymentId: string;
  /** What the client renders as a QR (WeChat Native: the 下单 `code_url`). */
  qrPayload: string;
}

export interface PaymentAdapter {
  /** Create a vendor pay-order for the sku; returns the payment id + QR payload. */
  createOrder(userId: string, sku: TopupSku): Promise<PaymentOrder>;
}

/** Dev/test adapter: records every order instead of touching a payment vendor. */
export class MockPaymentAdapter implements PaymentAdapter {
  readonly orders: Array<{ paymentId: string; userId: string; sku: TopupSku }> = [];
  private seq = 0;

  async createOrder(userId: string, sku: TopupSku): Promise<PaymentOrder> {
    const paymentId = `pay_${String(++this.seq).padStart(6, "0")}`;
    this.orders.push({ paymentId, userId, sku });
    return { paymentId, qrPayload: `mockpay://qr/${paymentId}?yuan=${sku.amountYuan}` };
  }
}
