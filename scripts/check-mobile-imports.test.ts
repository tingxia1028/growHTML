import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import ts from "typescript";
import { checkBoundary, createResolver } from "./check-mobile-imports";

// ---------------------------------------------------------------------------
// Tiny on-the-fly fixture graph. Each test writes a mini .ts tree + a matching
// tsconfig (moduleResolution:"Bundler", so barrels + extensionless imports resolve
// exactly like the real repo) into an OS temp dir, then runs the SAME checkBoundary
// resolver the guard uses. No real repo files are touched.
// ---------------------------------------------------------------------------

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "mobile-import-guard-"));
  await writeFile(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        noEmit: true,
        jsx: "react-jsx"
      },
      include: ["**/*.ts", "**/*.tsx"]
    })
  );
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function write(relPath: string, contents: string): Promise<string> {
  const abs = path.join(dir, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, contents);
  return path.normalize(abs);
}

function resolverFor(): ReturnType<typeof createResolver> {
  return createResolver(path.join(dir, "tsconfig.json"));
}

// forbid any node builtin (bare or node:-prefixed) — mirrors the real Rule-A shape.
const forbidNode = ({ specifier }: { specifier: string; resolvedPath: string | undefined }) => {
  const bare = specifier.startsWith("node:") ? specifier.slice(5) : specifier;
  return ["fs", "path", "os", "crypto"].includes(bare);
};
const allowNone = () => false;

describe("checkBoundary resolver", () => {
  it("(a) catches a planted transitive violation a → b → node:fs with the full chain", async () => {
    const a = await write("a.ts", `import { b } from "./b";\nexport const a = b;\n`);
    await write("b.ts", `import { readFileSync } from "node:fs";\nexport const b = readFileSync;\n`);

    const { program, resolve } = resolverFor();
    const result = checkBoundary(program, resolve, {
      entries: [a],
      forbid: forbidNode,
      allow: allowNone,
      label: "test"
    });

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].offender).toBe("node:fs");
    // chain is entry → … → offending specifier (relative-to-fixture strings)
    const chain = result.violations[0].chain;
    expect(chain[0]).toContain("a.ts");
    expect(chain[chain.length - 2]).toContain("b.ts");
    expect(chain[chain.length - 1]).toBe("node:fs");
  });

  it("(b) a clean graph passes with zero violations", async () => {
    const a = await write("a.ts", `import { b } from "./b";\nexport const a = b;\n`);
    await write("b.ts", `import { c } from "./c";\nexport const b = c;\n`);
    await write("c.ts", `export const c = 42;\n`);

    const { program, resolve } = resolverFor();
    const result = checkBoundary(program, resolve, {
      entries: [a],
      forbid: forbidNode,
      allow: allowNone,
      label: "test"
    });

    expect(result.violations).toHaveLength(0);
    // a, b, c all walked
    expect(result.visitedCount).toBe(3);
  });

  it("(c) an allowlisted leaf STOPS traversal: a → b(allowed) → node:fs is NOT a violation", async () => {
    const a = await write("a.ts", `import { b } from "./b";\nexport const a = b;\n`);
    const b = await write("b.ts", `import { readFileSync } from "node:fs";\nexport const b = readFileSync;\n`);

    const { program, resolve } = resolverFor();
    const result = checkBoundary(program, resolve, {
      entries: [a],
      forbid: forbidNode,
      allow: (resolvedPath) => path.normalize(resolvedPath) === b,
      label: "test"
    });

    expect(result.violations).toHaveLength(0);
    // b is recorded as a sanctioned leaf and not traversed into
    expect(result.sanctionedLeaves.some((leaf) => leaf.includes("b.ts"))).toBe(true);
  });

  it("(d) resolves barrel/index re-exports: a → index → c", async () => {
    const a = await write("a.ts", `import { c } from "./sub";\nexport const a = c;\n`);
    // extensionless directory import → sub/index.ts (Bundler resolution)
    await write("sub/index.ts", `export { c } from "./c";\n`);
    await write("sub/c.ts", `import { readFileSync } from "node:fs";\nexport const c = readFileSync;\n`);

    const { program, resolve } = resolverFor();
    const result = checkBoundary(program, resolve, {
      entries: [a],
      forbid: forbidNode,
      allow: allowNone,
      label: "test"
    });

    // The barrel re-export edge must be followed through to sub/c.ts's node:fs.
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].offender).toBe("node:fs");
    const chain = result.violations[0].chain;
    expect(chain.some((s) => s.includes("index.ts"))).toBe(true);
    expect(chain.some((s) => s.includes("c.ts"))).toBe(true);
  });

  it("(e) type-only edges are NOT flagged (import type / export type / type-only specifier)", async () => {
    const a = await write(
      "a.ts",
      `import type { FsLike } from "./b";\nexport type A = FsLike;\n`
    );
    await write(
      "b.ts",
      `import type { Stats } from "node:fs";\nexport type FsLike = Stats;\n`
    );
    // also a value file that only type-imports node
    const t = await write(
      "t.ts",
      `import { type PathLike } from "node:fs";\nexport const t: () => void = () => {};\nexport type P = PathLike;\n`
    );

    const { program, resolve } = resolverFor();

    // a → b is a type-only edge; b's node:fs reach is also type-only → 0 violations.
    const rA = checkBoundary(program, resolve, {
      entries: [a],
      forbid: forbidNode,
      allow: allowNone,
      label: "test"
    });
    expect(rA.violations).toHaveLength(0);

    // t's `import { type PathLike } from "node:fs"` is a type-only named specifier
    // in a value file → still 0 violations.
    const rT = checkBoundary(program, resolve, {
      entries: [t],
      forbid: forbidNode,
      allow: allowNone,
      label: "test"
    });
    expect(rT.violations).toHaveLength(0);
  });

  it("(f) a side-effect import of a forbidden module IS flagged (no clause, not erased)", async () => {
    const a = await write("a.ts", `import "node:fs";\nexport const a = 1;\n`);

    const { program, resolve } = resolverFor();
    const result = checkBoundary(program, resolve, {
      entries: [a],
      forbid: forbidNode,
      allow: allowNone,
      label: "test"
    });

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].offender).toBe("node:fs");
  });

  it("(g) follows statically-analyzable dynamic import() edges", async () => {
    const a = await write(
      "a.ts",
      `export async function load() { const m = await import("./b"); return m; }\n`
    );
    await write("b.ts", `import { readFileSync } from "node:fs";\nexport const b = readFileSync;\n`);

    const { program, resolve } = resolverFor();
    const result = checkBoundary(program, resolve, {
      entries: [a],
      forbid: forbidNode,
      allow: allowNone,
      label: "test"
    });

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].offender).toBe("node:fs");
  });

  it("(h) a MIXED import { type X, valueY } keeps the value edge and IS flagged", async () => {
    const a = await write(
      "a.ts",
      `import { type Stats, readFileSync } from "node:fs";\nexport const a: () => void = () => { void readFileSync; };\nexport type S = Stats;\n`
    );

    const { program, resolve } = resolverFor();
    const result = checkBoundary(program, resolve, {
      entries: [a],
      forbid: forbidNode,
      allow: allowNone,
      label: "test"
    });

    // `type Stats` is erased, but `readFileSync` is a VALUE binding → the node:fs edge survives.
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].offender).toBe("node:fs");
  });
});

// Guard against ts import being tree-shaken to a type-only import above.
void ts.version;
