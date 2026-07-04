import { describe, expect, it } from "vitest";
import { extractVariables, renderTemplate } from "./template";

// These tests pin EXACT rendered strings; the engine is pure and total, so the
// substitution rules are the contract every caller relies on.

describe("extractVariables", () => {
  it("returns distinct names in first-seen order", () => {
    expect(extractVariables("{{a}} {{b}} {{a}} {{c}}")).toEqual(["a", "b", "c"]);
  });

  it("trims surrounding whitespace so {{ x }} === {{x}}", () => {
    expect(extractVariables("{{ x }} and {{x}}")).toEqual(["x"]);
  });

  it("ignores non-identifier brace groups (left as literal)", () => {
    expect(extractVariables("{{1bad}} {{a-b}} {{ }} {{good}}")).toEqual(["good"]);
  });

  it("returns an empty list when there are no placeholders", () => {
    expect(extractVariables("plain text {single} braces")).toEqual([]);
  });

  it("accepts underscores and digits after the first char", () => {
    expect(extractVariables("{{_x}} {{x1}} {{x_1y}}")).toEqual(["_x", "x1", "x_1y"]);
  });
});

describe("renderTemplate", () => {
  it("substitutes a string value as-is", () => {
    expect(renderTemplate("Hello {{name}}!", { name: "World" })).toBe("Hello World!");
  });

  it("stringifies numbers and booleans", () => {
    expect(renderTemplate("{{n}}/{{flag}}", { n: 42, flag: true })).toBe("42/true");
    expect(renderTemplate("{{z}}", { z: 0 })).toBe("0");
    expect(renderTemplate("{{b}}", { b: false })).toBe("false");
  });

  it("joins arrays with \\n by default", () => {
    expect(renderTemplate("{{items}}", { items: ["a", "b", "c"] })).toBe("a\nb\nc");
  });

  it("joins arrays with a custom arrayJoin", () => {
    expect(renderTemplate("{{items}}", { items: [1, 2, 3] }, { arrayJoin: ", " })).toBe("1, 2, 3");
  });

  it("renders missing / null / undefined as empty string by default", () => {
    expect(renderTemplate("[{{a}}]", {})).toBe("[]");
    expect(renderTemplate("[{{a}}]", { a: null })).toBe("[]");
    expect(renderTemplate("[{{a}}]", { a: undefined })).toBe("[]");
  });

  it("uses opts.missing for missing / null / undefined", () => {
    expect(renderTemplate("[{{a}}]", {}, { missing: (n) => `<${n}>` })).toBe("[<a>]");
  });

  it("JSON-stringifies plain objects", () => {
    expect(renderTemplate("{{obj}}", { obj: { x: 1 } })).toBe('{"x":1}');
  });

  it("passes literal text and stray single braces through unchanged", () => {
    expect(renderTemplate("a {single} {{x}} b", { x: "Y" })).toBe("a {single} Y b");
    expect(renderTemplate("no vars here {nope}", {})).toBe("no vars here {nope}");
  });

  it("leaves non-identifier brace groups as literal", () => {
    expect(renderTemplate("{{1bad}} {{good}}", { good: "ok", "1bad": "x" })).toBe("{{1bad}} ok");
  });

  it("substitutes every occurrence of a repeated variable", () => {
    expect(renderTemplate("{{x}}-{{x}}", { x: "v" })).toBe("v-v");
  });

  it("is idempotent when the rendered output contains no placeholders", () => {
    const once = renderTemplate("Hi {{name}}", { name: "Bo" });
    expect(renderTemplate(once, { name: "OTHER" })).toBe("Hi Bo");
  });

  it("tolerates whitespace inside the braces", () => {
    expect(renderTemplate("{{  name  }}", { name: "Z" })).toBe("Z");
  });
});

// ACTION-2a: dotted names ({{doc.title}}) join the grammar as FLAT keys into the
// values record — the auto-context namespace. Plain-identifier semantics above are
// untouched (these tests are ADDITIVE).
describe("dotted auto-context names", () => {
  it("extracts dotted names (distinct, first-seen order, whitespace-trimmed)", () => {
    expect(extractVariables("{{doc.title}} by {{ selection.anchorId }} in {{doc.title}}")).toEqual([
      "doc.title",
      "selection.anchorId"
    ]);
  });

  it("substitutes a dotted name from its FLAT key (no nested-object walking)", () => {
    expect(renderTemplate("《{{doc.title}}》· {{selection}}", { "doc.title": "高一物理", selection: "浮力" })).toBe(
      "《高一物理》· 浮力"
    );
    // A nested object under `doc` is NOT walked — the flat key is the contract.
    expect(renderTemplate("[{{doc.title}}]", { doc: { title: "nope" } })).toBe("[]");
  });

  it("missing dotted names follow the normal missing rule (render '')", () => {
    expect(renderTemplate("[{{doc.title}}]", {})).toBe("[]");
  });

  it("malformed dotted groups stay literal (trailing/leading/double dots)", () => {
    expect(extractVariables("{{doc.}} {{.title}} {{doc..title}} {{a.b}}")).toEqual(["a.b"]);
    expect(renderTemplate("{{doc.}} {{.title}} {{doc..title}}", { "doc.": "x", ".title": "y" })).toBe(
      "{{doc.}} {{.title}} {{doc..title}}"
    );
  });
});
