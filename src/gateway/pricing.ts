// Gateway pricing map — modality × vendor × model → credits (§4.3 "Pricing map").
//
// The map is SERVER CONFIG passed in (versioned via priceVersion, recorded on
// every settle row), not code — a vendor price change is a config edit. The only
// prices in this file are DEFAULT_PRICING, an illustrative sample used by tests
// and dev; production loads its own config.
//
// Rounding: credits are integers; every usage line rounds UP (Math.ceil) before
// summing — the margin never leaks to fractional credits.

export type PricingUnit = "1k_tokens" | "image" | "second";

export interface PriceEntry {
  unit: PricingUnit;
  /** May be fractional (e.g. 0.5 credits per 1k tokens); per-line ceil keeps totals integer. */
  creditsPerUnit: number;
}

export interface UsageLine {
  modality: string;
  vendor: string;
  model: string;
  unit: PricingUnit;
  /** In price units: 1k_tokens → tokens/1000, image → count, second → seconds. */
  quantity: number;
}

export interface ModelRoute {
  vendor: string;
  model: string;
}

export interface PricingConfig {
  /** Recorded on settle rows (§4.3) for auditable rate history. */
  priceVersion: string;
  /** Keyed by priceKey(modality, vendor, model). */
  prices: Record<string, PriceEntry>;
  /** Which model each modality's estimate prices against (the §4.2 routing table's price view). */
  routing: {
    text?: ModelRoute;
    image?: ModelRoute;
  };
}

/** No price configured for modality×vendor×model — refuse loudly rather than guess. */
export class UnknownPriceError extends Error {
  constructor(key: string) {
    super(`no price configured for ${key}`);
    this.name = "UnknownPriceError";
  }
}

/** The usage line's unit does not match the configured price's unit. */
export class UnitMismatchError extends Error {
  constructor(key: string, expected: PricingUnit, got: PricingUnit) {
    super(`usage unit for ${key} must be "${expected}", got "${got}"`);
    this.name = "UnitMismatchError";
  }
}

export class InvalidUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidUsageError";
  }
}

export class InvalidPricingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPricingConfigError";
  }
}

export function priceKey(modality: string, vendor: string, model: string): string {
  return `${modality}/${vendor}/${model}`;
}

export interface RunEstimateShape {
  /** Ceiling of orchestrator tokens the run may consume (in + out). */
  maxTextTokens?: number;
  /** Number of images the run may generate. */
  images?: number;
}

export class Pricing {
  readonly priceVersion: string;
  private readonly config: PricingConfig;

  constructor(config: PricingConfig) {
    if (!config.priceVersion) {
      throw new InvalidPricingConfigError("priceVersion must be a non-empty string");
    }
    for (const [key, price] of Object.entries(config.prices)) {
      if (!Number.isFinite(price.creditsPerUnit) || price.creditsPerUnit <= 0) {
        throw new InvalidPricingConfigError(
          `creditsPerUnit for ${key} must be a positive finite number, got ${price.creditsPerUnit}`
        );
      }
    }
    this.config = config;
    this.priceVersion = config.priceVersion;
  }

  /** Look up the configured price for a modality×vendor×model; throws UnknownPriceError. */
  priceFor(modality: string, vendor: string, model: string): PriceEntry {
    const key = priceKey(modality, vendor, model);
    const price = this.config.prices[key];
    if (!price) throw new UnknownPriceError(key);
    return price;
  }

  /** Total integer credits for metered usage: ceil per line, then sum. */
  costFor(usage: readonly UsageLine[]): number {
    let total = 0;
    for (const line of usage) {
      const key = priceKey(line.modality, line.vendor, line.model);
      const price = this.config.prices[key];
      if (!price) throw new UnknownPriceError(key);
      if (line.unit !== price.unit) {
        throw new UnitMismatchError(key, price.unit, line.unit);
      }
      if (!Number.isFinite(line.quantity) || line.quantity < 0) {
        throw new InvalidUsageError(`usage quantity for ${key} must be >= 0, got ${line.quantity}`);
      }
      total += Math.ceil(line.quantity * price.creditsPerUnit);
    }
    return total;
  }

  /**
   * A conservative HOLD estimate for an agent run (§4.3 step 1): price the run's
   * ceilings against the configured routing (per-modality primary model). Every
   * line rounds up; the hold is released down to actual cost at settle.
   */
  estimateRun(shape: RunEstimateShape): number {
    const usage: UsageLine[] = [];
    if (shape.maxTextTokens !== undefined && shape.maxTextTokens > 0) {
      const route = this.config.routing.text;
      if (!route) {
        throw new InvalidPricingConfigError("estimateRun needs routing.text to price maxTextTokens");
      }
      const price = this.priceFor("text", route.vendor, route.model);
      usage.push({
        modality: "text",
        vendor: route.vendor,
        model: route.model,
        unit: price.unit,
        quantity: shape.maxTextTokens / 1000
      });
    }
    if (shape.images !== undefined && shape.images > 0) {
      const route = this.config.routing.image;
      if (!route) {
        throw new InvalidPricingConfigError("estimateRun needs routing.image to price images");
      }
      const price = this.priceFor("image", route.vendor, route.model);
      usage.push({
        modality: "image",
        vendor: route.vendor,
        model: route.model,
        unit: price.unit,
        quantity: shape.images
      });
    }
    return this.costFor(usage);
  }
}

/**
 * Illustrative sample config (1 credit ≈ ¥0.01 per §4.3's sketch) for tests/dev
 * ONLY — production passes its own versioned config.
 */
export const DEFAULT_PRICING: PricingConfig = {
  priceVersion: "sample-2026-07.v1",
  prices: {
    [priceKey("text", "deepseek", "deepseek-v4-flash")]: { unit: "1k_tokens", creditsPerUnit: 1 },
    [priceKey("image", "baidu-qianfan", "ernie-image-turbo")]: { unit: "image", creditsPerUnit: 25 },
    [priceKey("image", "baidu-qianfan", "flux-schnell")]: { unit: "image", creditsPerUnit: 3 },
    [priceKey("video", "alibaba-dashscope", "wan2.6-t2v")]: { unit: "second", creditsPerUnit: 10 }
  },
  routing: {
    text: { vendor: "deepseek", model: "deepseek-v4-flash" },
    image: { vendor: "baidu-qianfan", model: "ernie-image-turbo" }
  }
};
