import { describe, expect, it } from "vitest";
import { assertSafeRelativePath } from "./paths";

describe("assertSafeRelativePath", () => {
  it("accepts normal stored relative paths", () => {
    expect(() => assertSafeRelativePath("sources/foo.html")).not.toThrow();
    expect(() => assertSafeRelativePath("sources/a-b_c.pdf")).not.toThrow();
  });

  it("rejects traversal and absolute paths", () => {
    expect(() => assertSafeRelativePath("../secret")).toThrow();
    expect(() => assertSafeRelativePath("sources/../../etc/passwd")).toThrow();
    expect(() => assertSafeRelativePath("/etc/passwd")).toThrow();
    expect(() => assertSafeRelativePath("C:\\Windows\\system32")).toThrow();
    expect(() => assertSafeRelativePath("")).toThrow();
  });
});
