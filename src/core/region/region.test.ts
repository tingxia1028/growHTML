import { describe, expect, it } from "vitest";
import { rematchAnchor } from "../study-layer/rematch";
import { rematchRegion, type RegionTarget } from "./region";

// V1 gate: both region kinds must re-locate through the ONE rematchRegion resolver,
// producing results identical to the pre-extraction inline rect branches.
describe("region rematch routes through the single rematchRegion", () => {
  const rect: [number, number, number, number] = [0.1, 0.1, 0.3, 0.2];

  it("pdf_selection region delegates its rect fallback to rematchRegion", () => {
    const target: RegionTarget = { rect, space: { kind: "page", page: 1 } };
    for (const sameBinary of [true, false]) {
      const viaAnchor = rematchAnchor({ anchorKind: "pdf_selection", page: 1, quote: "", rect }, { sameBinary });
      expect(viaAnchor).toEqual(rematchRegion(target, { sameBinary }));
    }
  });

  it("image_region delegates to rematchRegion", () => {
    const target: RegionTarget = { rect, space: { kind: "whole" } };
    for (const sameBinary of [true, false]) {
      const viaAnchor = rematchAnchor({ anchorKind: "image_region", quote: "", rect }, { sameBinary });
      expect(viaAnchor).toEqual(rematchRegion(target, { sameBinary }));
    }
  });

  it("both region kinds resolve identically for the same rect + binary state", () => {
    const ctx = { sameBinary: true } as const;
    expect(rematchAnchor({ anchorKind: "pdf_selection", page: 1, quote: "", rect }, ctx)).toEqual(
      rematchAnchor({ anchorKind: "image_region", quote: "", rect }, ctx)
    );
  });
});
