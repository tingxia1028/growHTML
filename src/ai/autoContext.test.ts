import { describe, expect, it } from "vitest";
import {
  AUTO_CONTEXT_MAX_CHARS,
  autoContextTemplateValues,
  formatAutoContext,
  referencesAutoContext,
  withAutoContextPreamble,
  type AutoContext
} from "./autoContext";

// The envelope's FORMAT is a contract (prompts embed it verbatim), so these tests
// pin exact strings; the cap/truncation tests pin the documented priority
// (selection first, doc second, learner last).

const full: AutoContext = {
  selection: { quote: "浮力等于排开液体的重力", anchorId: "ah_1", sourceId: "src_1" },
  doc: { title: "高一物理 必修一", sourceType: "pdf", subject: "textbook-learning", kit: "textbook-learning" },
  learner: "弱项:浮力 — 复习错误率 67%(4/6 次未过,学科)\n连续学习 — 3 天(至 2026-07-01)"
};

describe("formatAutoContext — sections present or omitted", () => {
  it("formats all three sections under the [Context] header", () => {
    expect(formatAutoContext(full)).toBe(
      [
        "[Context]",
        'Selection: "浮力等于排开液体的重力" (anchor: ah_1 · source: src_1)',
        "Doc: 高一物理 必修一 · type: pdf · subject: textbook-learning · kit: textbook-learning",
        "Learner:",
        "弱项:浮力 — 复习错误率 67%(4/6 次未过,学科)",
        "连续学习 — 3 天(至 2026-07-01)"
      ].join("\n")
    );
  });

  it("omits empty sections entirely (no stub labels)", () => {
    expect(formatAutoContext({ selection: { quote: "只有选中" } })).toBe('[Context]\nSelection: "只有选中"');
    expect(formatAutoContext({ doc: { title: "只有标题" } })).toBe("[Context]\nDoc: 只有标题");
    expect(formatAutoContext({ learner: "弱项:x — y" })).toBe("[Context]\nLearner:\n弱项:x — y");
  });

  it("an empty / absent envelope formats to the empty string (nothing to prepend)", () => {
    expect(formatAutoContext(undefined)).toBe("");
    expect(formatAutoContext({})).toBe("");
    expect(formatAutoContext({ selection: { quote: "  " }, doc: {}, learner: " \n " })).toBe("");
  });

  it("selection locator parts appear only when present", () => {
    expect(formatAutoContext({ selection: { quote: "q", anchorId: "ah_9" } })).toBe(
      '[Context]\nSelection: "q" (anchor: ah_9)'
    );
    expect(formatAutoContext({ selection: { quote: "q" } })).toBe('[Context]\nSelection: "q"');
  });
});

describe("formatAutoContext — cap + truncation priority", () => {
  it("caps the whole envelope at AUTO_CONTEXT_MAX_CHARS", () => {
    const context: AutoContext = { selection: { quote: "甲".repeat(5000) }, doc: { title: "T" }, learner: "弱项:x — y" };
    const text = formatAutoContext(context);
    expect(text.length).toBeLessThanOrEqual(AUTO_CONTEXT_MAX_CHARS);
  });

  it("truncates selection FIRST — doc and learner survive intact", () => {
    const context: AutoContext = {
      selection: { quote: "甲".repeat(3000) },
      doc: { title: "高一物理 必修一", sourceType: "pdf" },
      learner: "弱项:浮力 — 复习错误率 67%\n连续学习 — 3 天"
    };
    const text = formatAutoContext(context);
    expect(text.length).toBeLessThanOrEqual(AUTO_CONTEXT_MAX_CHARS);
    // The un-truncated sections are still whole…
    expect(text).toContain("Doc: 高一物理 必修一 · type: pdf");
    expect(text).toContain("Learner:\n弱项:浮力 — 复习错误率 67%\n连续学习 — 3 天");
    // …and the selection carries the truncation mark.
    expect(text).toContain('Selection: "甲');
    expect(text).toContain("…");
  });

  it("truncates learner LAST — only after selection and doc are exhausted", () => {
    const context: AutoContext = {
      selection: { quote: "s".repeat(40) },
      doc: { title: "d".repeat(40) },
      learner: "L".repeat(5000)
    };
    const text = formatAutoContext(context);
    expect(text.length).toBeLessThanOrEqual(AUTO_CONTEXT_MAX_CHARS);
    // Selection + doc are small: they were dropped/shrunk BEFORE learner was cut,
    // and the learner keeps by far the largest share.
    expect(text).toContain("Learner:");
    expect(text.indexOf("L".repeat(100))).toBeGreaterThan(-1);
  });

  it("a section squeezed below the useful minimum is dropped entirely", () => {
    // learner (last priority) fills nearly the whole budget → the earlier sections
    // cannot keep a useful share and vanish rather than degrade to stubs.
    const context: AutoContext = {
      selection: { quote: "短引文" },
      doc: { title: "标题" },
      learner: "L".repeat(AUTO_CONTEXT_MAX_CHARS)
    };
    const text = formatAutoContext(context);
    expect(text.length).toBeLessThanOrEqual(AUTO_CONTEXT_MAX_CHARS);
    expect(text).not.toContain("Selection:");
    expect(text).not.toContain("Doc:");
    expect(text).toContain("Learner:");
  });

  it("small envelopes are returned verbatim (no truncation side effects)", () => {
    expect(formatAutoContext(full).includes("…")).toBe(false);
  });
});

describe("autoContextTemplateValues — the {{…}} namespace", () => {
  it("exposes whole-section aliases and flat dotted keys, non-empty pieces only", () => {
    expect(autoContextTemplateValues(full)).toEqual({
      selection: "浮力等于排开液体的重力",
      "selection.quote": "浮力等于排开液体的重力",
      "selection.anchorId": "ah_1",
      "selection.sourceId": "src_1",
      doc: "高一物理 必修一 · type: pdf · subject: textbook-learning · kit: textbook-learning",
      "doc.title": "高一物理 必修一",
      "doc.sourceType": "pdf",
      "doc.subject": "textbook-learning",
      "doc.kit": "textbook-learning",
      learner: "弱项:浮力 — 复习错误率 67%(4/6 次未过,学科)\n连续学习 — 3 天(至 2026-07-01)"
    });
  });

  it("an empty envelope yields no values (references then render '')", () => {
    expect(autoContextTemplateValues(undefined)).toEqual({});
    expect(autoContextTemplateValues({})).toEqual({});
  });

  it("caps the unbounded pieces (quote / learner) at the envelope budget", () => {
    const values = autoContextTemplateValues({
      selection: { quote: "q".repeat(5000) },
      learner: "l".repeat(5000)
    });
    expect(values["selection"]!.length).toBeLessThanOrEqual(AUTO_CONTEXT_MAX_CHARS);
    expect(values["learner"]!.length).toBeLessThanOrEqual(AUTO_CONTEXT_MAX_CHARS);
  });
});

describe("referencesAutoContext", () => {
  it("recognizes section names and dotted members", () => {
    expect(referencesAutoContext(["selection"])).toBe(true);
    expect(referencesAutoContext(["doc"])).toBe(true);
    expect(referencesAutoContext(["learner"])).toBe(true);
    expect(referencesAutoContext(["doc.title"])).toBe(true);
    expect(referencesAutoContext(["selection.anchorId"])).toBe(true);
    expect(referencesAutoContext(["anchorText", "doc.title"])).toBe(true);
  });

  it("ignores ordinary variables (including near-misses)", () => {
    expect(referencesAutoContext([])).toBe(false);
    expect(referencesAutoContext(["anchorText", "sourceTitle", "docs", "selections", "learnerName"])).toBe(false);
  });
});

describe("withAutoContextPreamble", () => {
  it("prepends with a blank line; an empty preamble is a no-op (byte-compat)", () => {
    expect(withAutoContextPreamble("[Context]\nDoc: T", "prompt body")).toBe("[Context]\nDoc: T\n\nprompt body");
    expect(withAutoContextPreamble("", "prompt body")).toBe("prompt body");
  });
});
