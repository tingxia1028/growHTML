import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRICING,
  InvalidPricingConfigError,
  InvalidUsageError,
  priceKey,
  Pricing,
  UnitMismatchError,
  UnknownPriceError,
  type UsageLine
} from "./pricing";

const pricing = new Pricing(DEFAULT_PRICING);

function textUsage(tokens: number): UsageLine {
  return {
    modality: "text",
    vendor: "deepseek",
    model: "deepseek-v4-flash",
    unit: "1k_tokens",
    quantity: tokens / 1000
  };
}

function imageUsage(count: number, model = "ernie-image-turbo"): UsageLine {
  return { modality: "image", vendor: "baidu-qianfan", model, unit: "image", quantity: count };
}

describe("pricing — costFor", () => {
  it("charges per configured unit and rounds UP per line (1234 tokens @1/1k → 2 credits)", () => {
    expect(pricing.costFor([textUsage(1234)])).toBe(2);
    expect(pricing.costFor([textUsage(1000)])).toBe(1); // exact boundary: no over-round
    expect(pricing.costFor([textUsage(1)])).toBe(1); // even a single token costs a whole credit
    expect(pricing.costFor([textUsage(0)])).toBe(0);
  });

  it("ceils EACH line before summing, not the total", () => {
    // two half-credit lines: per-line ceil → 1+1=2 (total-ceil would give 1)
    expect(pricing.costFor([textUsage(500), textUsage(500)])).toBe(2);
  });

  it("prices images per image and mixes modalities in one run", () => {
    expect(pricing.costFor([imageUsage(3)])).toBe(75);
    expect(pricing.costFor([imageUsage(1, "flux-schnell")])).toBe(3);
    expect(pricing.costFor([textUsage(2500), imageUsage(2)])).toBe(3 + 50);
  });

  it("empty usage costs 0", () => {
    expect(pricing.costFor([])).toBe(0);
  });

  it("unknown modality×vendor×model → explicit UnknownPriceError naming the key", () => {
    const line: UsageLine = {
      modality: "text",
      vendor: "deepseek",
      model: "deepseek-v5-does-not-exist",
      unit: "1k_tokens",
      quantity: 1
    };
    expect(() => pricing.costFor([line])).toThrow(UnknownPriceError);
    expect(() => pricing.costFor([line])).toThrow(
      priceKey("text", "deepseek", "deepseek-v5-does-not-exist")
    );
  });

  it("unit mismatch against the configured price is rejected", () => {
    expect(() => pricing.costFor([{ ...textUsage(1000), unit: "image" }])).toThrow(UnitMismatchError);
  });

  it("negative or non-finite quantities are rejected", () => {
    expect(() => pricing.costFor([{ ...imageUsage(1), quantity: -1 }])).toThrow(InvalidUsageError);
    expect(() => pricing.costFor([{ ...imageUsage(1), quantity: NaN }])).toThrow(InvalidUsageError);
    expect(() => pricing.costFor([{ ...imageUsage(1), quantity: Infinity }])).toThrow(InvalidUsageError);
  });

  it("fractional creditsPerUnit still yields integer credits (ceil)", () => {
    const p = new Pricing({
      priceVersion: "v-test",
      prices: { [priceKey("text", "v", "m")]: { unit: "1k_tokens", creditsPerUnit: 0.4 } },
      routing: {}
    });
    // 3k tokens × 0.4 = 1.2 → 2 credits
    expect(p.costFor([{ modality: "text", vendor: "v", model: "m", unit: "1k_tokens", quantity: 3 }])).toBe(2);
  });
});

describe("pricing — estimateRun (conservative hold estimate)", () => {
  it("prices ceilings against the configured routing: text + images", () => {
    // ceil(2.5k tokens × 1) + 2 × 25 = 3 + 50
    expect(pricing.estimateRun({ maxTextTokens: 2500, images: 2 })).toBe(53);
    expect(pricing.estimateRun({ maxTextTokens: 4000 })).toBe(4);
    expect(pricing.estimateRun({ images: 1 })).toBe(25);
  });

  it("an empty shape estimates 0 (caller decides whether to hold at all)", () => {
    expect(pricing.estimateRun({})).toBe(0);
    expect(pricing.estimateRun({ maxTextTokens: 0, images: 0 })).toBe(0);
  });

  it("estimating a modality with no configured route fails loudly", () => {
    const textOnly = new Pricing({
      priceVersion: "v-test",
      prices: DEFAULT_PRICING.prices,
      routing: { text: DEFAULT_PRICING.routing.text }
    });
    expect(textOnly.estimateRun({ maxTextTokens: 1000 })).toBe(1);
    expect(() => textOnly.estimateRun({ images: 1 })).toThrow(InvalidPricingConfigError);
  });

  it("exposes the priceVersion for settle rows", () => {
    expect(pricing.priceVersion).toBe(DEFAULT_PRICING.priceVersion);
  });

  it("exposes the routing entry per modality (undefined when not routed)", () => {
    expect(pricing.routeFor("text")).toEqual({ vendor: "deepseek", model: "deepseek-v4-flash" });
    expect(pricing.routeFor("image")).toEqual({ vendor: "baidu-qianfan", model: "ernie-image-turbo" });
    const textOnly = new Pricing({
      priceVersion: "v-test",
      prices: DEFAULT_PRICING.prices,
      routing: { text: DEFAULT_PRICING.routing.text }
    });
    expect(textOnly.routeFor("image")).toBeUndefined();
  });
});

describe("pricing — config validation", () => {
  it("rejects non-positive or non-finite creditsPerUnit and empty priceVersion", () => {
    const bad = (creditsPerUnit: number) =>
      new Pricing({
        priceVersion: "v",
        prices: { [priceKey("text", "v", "m")]: { unit: "1k_tokens", creditsPerUnit } },
        routing: {}
      });
    expect(() => bad(0)).toThrow(InvalidPricingConfigError);
    expect(() => bad(-1)).toThrow(InvalidPricingConfigError);
    expect(() => bad(NaN)).toThrow(InvalidPricingConfigError);
    expect(() => new Pricing({ priceVersion: "", prices: {}, routing: {} })).toThrow(
      InvalidPricingConfigError
    );
  });
});
