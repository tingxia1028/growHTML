import { describe, expect, it } from "vitest";
import { isExportableContentType, isPrivateByDefault, registerKitLayerPolicy } from "./policy";
import { textbookLayerPolicy } from "./textbook-learning/policy";

describe("kit layer policy", () => {
  it("marks textbook.mistake private-by-default (excluded from export) and others exportable", () => {
    registerKitLayerPolicy(textbookLayerPolicy); // idempotent

    expect(isPrivateByDefault("textbook.mistake")).toBe(true);
    expect(isExportableContentType("textbook.mistake")).toBe(false);

    expect(isPrivateByDefault("textbook.explanation")).toBe(false);
    expect(isExportableContentType("textbook.explanation")).toBe(true);
    expect(isExportableContentType("textbook.exercise")).toBe(true);
    expect(isExportableContentType("textbook.review-pack")).toBe(true);
    // Generic (non-kit) note types stay exportable — no policy applies.
    expect(isExportableContentType("markdown")).toBe(true);
  });

  it("re-registering the same kit policy is a no-op (idempotent)", () => {
    registerKitLayerPolicy(textbookLayerPolicy);
    registerKitLayerPolicy(textbookLayerPolicy);
    expect(isPrivateByDefault("textbook.mistake")).toBe(true);
  });
});
