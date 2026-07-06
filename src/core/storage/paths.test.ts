import { describe, expect, it } from "vitest";
import { assertSafeRelativePath, basename, extname, joinPath } from "./paths";

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

// PLAT-LAYER Part-4b: the pure logical-`/`-path composer that replaces `node:path` in the
// portable store graph. These edge cases are the load-bearing contract (leading-slash preserved,
// internal `//` collapsed, Windows-drive root passed through untouched).
describe("joinPath", () => {
  it("joins segments with a single POSIX slash", () => {
    expect(joinPath("sources", "foo.html")).toBe("sources/foo.html");
    expect(joinPath("a", "b", "c")).toBe("a/b/c");
  });

  it("preserves a leading slash (absolute logical root)", () => {
    expect(joinPath("/study", ".study")).toBe("/study/.study");
    expect(joinPath("/", ".study")).toBe("/.study");
    expect(joinPath("/study", ".study", "manifest.json")).toBe("/study/.study/manifest.json");
  });

  it("collapses internal double slashes without mangling the leading one", () => {
    expect(joinPath("study/", "/foo")).toBe("study/foo");
    expect(joinPath("/study/", "/foo")).toBe("/study/foo");
    expect(joinPath("a//b", "c")).toBe("a/b/c");
  });

  it("drops empty and undefined segments", () => {
    expect(joinPath("", "sources", "", "foo.html")).toBe("sources/foo.html");
    expect(joinPath("sources", undefined, "foo.html")).toBe("sources/foo.html");
    expect(joinPath()).toBe("");
  });

  it("does NOT mangle a Windows-drive backslash root (mixed separators ride through)", () => {
    expect(joinPath("C:\\x\\vault", ".study")).toBe("C:\\x\\vault/.study");
    expect(joinPath("C:\\x\\vault", "assets", "a.png")).toBe("C:\\x\\vault/assets/a.png");
  });
});

describe("basename", () => {
  it("returns the last segment across both separators", () => {
    expect(basename("sources/foo.html")).toBe("foo.html");
    expect(basename("C:\\Users\\me\\photo.jpg")).toBe("photo.jpg");
    expect(basename("/study/.study/manifest.json")).toBe("manifest.json");
    expect(basename("bare")).toBe("bare");
  });

  it("ignores trailing separators and handles empty", () => {
    expect(basename("sources/")).toBe("sources");
    expect(basename("")).toBe("");
  });
});

describe("extname", () => {
  it("returns the dotted extension matching node:path.extname semantics", () => {
    expect(extname("photo.jpg")).toBe(".jpg");
    expect(extname("C:\\Users\\me\\photo.JPG")).toBe(".JPG");
    expect(extname("archive.tar.gz")).toBe(".gz");
    expect(extname("noext")).toBe("");
  });

  it("treats a leading-dot file as having no extension (.env → \"\")", () => {
    expect(extname(".env")).toBe("");
    expect(extname("/study/.study")).toBe("");
    expect(extname("dir/.gitignore")).toBe("");
  });
});
