// @vitest-environment jsdom
// ACTION-2b — the 一句话新增 two-field creator: create sends mode:"simple" +
// instruction (nothing else required), the new action appears in the shared passage
// surface list, 试一下 dispatches operation.run WITHOUT an outputType (the server's
// auto-context envelope + form router take over), edit round-trips the two fields,
// empty name/instruction are rejected INLINE with bilingual messages, and the zh/en
// flip never mixes locales in the panel chrome. buildForkTemplate keeps its V1 pins.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { KitPrompt } from "../../kits/types";
import type { OperationRecord, WorkspaceNode } from "../data/entityClient";
import type { WorkspaceContext } from "./viewRegistry";

const mocks = vi.hoisted(() => ({
  createOperation: vi.fn(),
  updateOperation: vi.fn(),
  deleteOperation: vi.fn(),
  saveOperationPrefs: vi.fn()
}));

vi.mock("../data/entityClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../data/entityClient")>();
  return { ...actual, entityClient: { ...actual.entityClient, ...mocks } };
});

import { getView } from "./viewRegistry";
import { memoryPlatform } from "../platform/memoryPlatform";
import { setPlatform } from "../platform/platformSingleton";
import { setLocale, t, type Message } from "../i18n";
import { operationMessages as m } from "./operationMessages";
import { buildForkTemplate } from "./operationViews";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// —— harness (layerViews.test idiom: raw DOM + act, entityClient mocked) ————————————

let root: Root | null = null;

function mountView(ctx: WorkspaceContext): HTMLElement {
  const plugin = getView("operation.manager");
  expect(plugin).toBeTruthy();
  const node = { id: "ops", kind: "operation.manager" } as WorkspaceNode;
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<>{plugin!.render(node, ctx)}</>));
  return container;
}

async function flush(times = 3): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

// React controlled inputs need the native value setter + an input event.
function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof window.HTMLTextAreaElement
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function click(el: Element | null): void {
  expect(el).toBeTruthy();
  act(() => {
    (el as HTMLElement).click();
  });
}

const EMPTY_PREFS = { order: [], disabled: [], params: {}, surfaces: {}, icons: {} };

// A saved simple action (the ACTION-2a shape: instruction, no template, AUTO output).
// English-only strings so the en-locale no-mixing scan sees no CJK data noise.
const SIMPLE_OP: OperationRecord = {
  id: "op_simple",
  name: "OP-A",
  description: "",
  mode: "simple",
  instruction: "quiz me on OP-A",
  declaredVariables: [],
  source: "custom",
  scope: "anchor"
};

function makeCtx(over: Partial<Record<string, unknown>> = {}): WorkspaceContext {
  return {
    operations: [],
    operationPrefs: EMPTY_PREFS,
    refreshOperations: vi.fn(),
    dispatch: vi.fn(async () => {}),
    saveActionPrefs: vi.fn(async () => {}),
    customizeSurface: undefined,
    draftQuote: "",
    activeSource: null,
    ...over
  } as unknown as WorkspaceContext;
}

beforeEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.clearAllMocks();
  // Default: a platform whose dialogs.confirm resolves true, so the convert/delete gates
  // proceed. Gate tests below override with confirm→false (PLAT-LAYER STEP-2 funnel).
  setPlatform(memoryPlatform({ dialogs: { confirm: () => Promise.resolve(true) } }));
  mocks.createOperation.mockResolvedValue({ operation: { ...SIMPLE_OP, id: "op_new" } });
  mocks.updateOperation.mockResolvedValue({ operation: SIMPLE_OP });
  mocks.deleteOperation.mockResolvedValue({ ok: true });
  mocks.saveOperationPrefs.mockResolvedValue({ prefs: EMPTY_PREFS });
});

afterEach(() => {
  setLocale("zh");
});

// —— the two-field creator ————————————————————————————————————————————————————————

describe("operation creator — 一句话新增 (ACTION-2b)", () => {
  it("default view is the TWO-field simple form; the V1 template chrome is absent and 高级 is collapsed", () => {
    const container = mountView(makeCtx());

    expect(container.querySelector(".operation-name-input")).toBeTruthy();
    expect(container.querySelector(".operation-instruction-input")).toBeTruthy();
    // Simple mode renders NO template builder at all (it only exists in template mode,
    // inside 高级) — the default path never shows outputType picker chrome expanded.
    expect(container.querySelector(".operation-template-input")).toBeNull();
    expect(container.querySelector(".operation-prefill-select")).toBeNull();
    const advanced = container.querySelector<HTMLDetailsElement>(".operation-advanced");
    expect(advanced).toBeTruthy();
    expect(advanced!.open).toBe(false);
  });

  it("create: name + instruction → createOperation with mode simple, NO template/outputType; the list refreshes", async () => {
    const ctx = makeCtx();
    const container = mountView(ctx);

    setValue(container.querySelector<HTMLInputElement>(".operation-name-input")!, "OP-A");
    setValue(container.querySelector<HTMLTextAreaElement>(".operation-instruction-input")!, "quiz me on OP-A");
    click(container.querySelector(".operation-save-btn"));
    await flush();

    expect(mocks.createOperation).toHaveBeenCalledTimes(1);
    const body = mocks.createOperation.mock.calls[0][0] as Record<string, unknown>;
    expect(body).toMatchObject({ name: "OP-A", mode: "simple", instruction: "quiz me on OP-A", scope: "anchor" });
    // Nothing else required: no template, no pinned output (AUTO → the form router).
    expect(body.promptTemplate).toBeUndefined();
    expect(body.outputContentType).toBeUndefined();
    expect(ctx.refreshOperations).toHaveBeenCalled();
  });

  it("试一下 on a fresh simple action dispatches operation.run WITHOUT an outputType (auto-context + form router)", async () => {
    const ctx = makeCtx();
    const container = mountView(ctx);

    setValue(container.querySelector<HTMLInputElement>(".operation-name-input")!, "OP-A");
    setValue(container.querySelector<HTMLTextAreaElement>(".operation-instruction-input")!, "quiz me on OP-A");
    click(container.querySelector(".operation-try-btn"));
    await flush();

    expect(ctx.dispatch).toHaveBeenCalledWith("operation.run", {
      operationId: "op_new",
      outputType: undefined,
      scope: "anchor",
      variables: []
    });
  });

  it("a saved simple action appears in the manager AND in the shared passage-surface list (the toolbar/Anchor-bar pool)", () => {
    const container = mountView(makeCtx({ operations: [SIMPLE_OP] }));

    // Manager row (kind custom) with 编辑.
    const row = container.querySelector('.operation-action-row[data-action-id="op_simple"]');
    expect(row).toBeTruthy();
    expect(row!.getAttribute("data-action-kind")).toBe("operation");
    expect(row!.querySelector(".operation-edit-btn")).toBeTruthy();

    // The "Toolbar" tab mirrors WorkspaceContext's passage pool (inline selection
    // toolbar + Anchor bar render this SAME list) — the new action is in it.
    click(container.querySelector('[data-surface-tab="passage"]'));
    expect(container.querySelector('.operation-surface-row[data-surface-action-id="op_simple"]')).toBeTruthy();
  });

  it("edit round-trip: 编辑 prefills the SAME two fields; save PATCHes the instruction", async () => {
    const container = mountView(makeCtx({ operations: [SIMPLE_OP] }));

    click(container.querySelector('.operation-action-row[data-action-id="op_simple"] .operation-edit-btn'));
    const nameInput = container.querySelector<HTMLInputElement>(".operation-name-input")!;
    const instructionInput = container.querySelector<HTMLTextAreaElement>(".operation-instruction-input")!;
    expect(nameInput.value).toBe("OP-A");
    expect(instructionInput.value).toBe("quiz me on OP-A");
    // Still the two-field form: 高级 stays collapsed, no template chrome.
    expect(container.querySelector<HTMLDetailsElement>(".operation-advanced")!.open).toBe(false);
    expect(container.querySelector(".operation-template-input")).toBeNull();

    setValue(instructionInput, "ask harder questions");
    click(container.querySelector(".operation-save-btn"));
    await flush();

    expect(mocks.updateOperation).toHaveBeenCalledTimes(1);
    expect(mocks.updateOperation.mock.calls[0][0]).toBe("op_simple");
    expect(mocks.updateOperation.mock.calls[0][1]).toMatchObject({ mode: "simple", instruction: "ask harder questions" });
    expect(mocks.createOperation).not.toHaveBeenCalled();
  });

  it("编辑为完整模板 (高级) converts one-way after confirm and seeds the template from the instruction", async () => {
    // convertToTemplate now awaits platformDialogs().confirm (→true via the beforeEach
    // platform); flush the microtask so the state update lands before asserting.
    const container = mountView(makeCtx({ operations: [SIMPLE_OP] }));

    click(container.querySelector('.operation-action-row[data-action-id="op_simple"] .operation-edit-btn'));
    click(container.querySelector(".operation-convert-btn"));
    await flush();

    const template = container.querySelector<HTMLTextAreaElement>(".operation-template-input");
    expect(template).toBeTruthy();
    expect(template!.value).toContain("quiz me on OP-A");
    expect(template!.value).toContain("{{anchorText}}");
    // The simple field is gone; the V1 chrome (inside 高级) is now the editor.
    expect(container.querySelector(".operation-instruction-input")).toBeNull();
    expect(container.querySelector<HTMLDetailsElement>(".operation-advanced")!.open).toBe(true);
  });

  // PLAT-LAYER STEP-2 gate-preservation: the convert gate is now async. With confirm→false
  // the one-way conversion must NOT happen (mode stays simple; no template input appears).
  it("does NOT convert to a template when the platform's confirm resolves false", async () => {
    setPlatform(memoryPlatform({ dialogs: { confirm: () => Promise.resolve(false) } }));
    const container = mountView(makeCtx({ operations: [SIMPLE_OP] }));

    click(container.querySelector('.operation-action-row[data-action-id="op_simple"] .operation-edit-btn'));
    click(container.querySelector(".operation-convert-btn"));
    await flush();

    // Still in simple mode: the instruction field is present, no template editor was seeded.
    expect(container.querySelector(".operation-template-input")).toBeNull();
    expect(container.querySelector(".operation-instruction-input")).toBeTruthy();
  });
});

// —— destructive-gate preservation (PLAT-LAYER STEP-2 dialogs funnel) ————————————————

describe("operation delete — async confirm gate", () => {
  it("deletes the operation when the platform's confirm resolves true", async () => {
    const container = mountView(makeCtx({ operations: [SIMPLE_OP] }));

    click(container.querySelector('.operation-action-row[data-action-id="op_simple"] .operation-delete-btn'));
    await flush();

    expect(mocks.deleteOperation).toHaveBeenCalledWith("op_simple");
  });

  it("does NOT delete the operation when the platform's confirm resolves false", async () => {
    setPlatform(memoryPlatform({ dialogs: { confirm: () => Promise.resolve(false) } }));
    const container = mountView(makeCtx({ operations: [SIMPLE_OP] }));

    click(container.querySelector('.operation-action-row[data-action-id="op_simple"] .operation-delete-btn'));
    await flush();

    // A forgotten `await` would fire the delete against a truthy Promise — assert it did not.
    expect(mocks.deleteOperation).not.toHaveBeenCalled();
  });
});

// —— inline validation (bilingual) ————————————————————————————————————————————————

describe("operation creator validation", () => {
  it("empty name + instruction are rejected INLINE (zh), nothing is sent, and typing clears the error", async () => {
    const container = mountView(makeCtx());

    click(container.querySelector(".operation-save-btn"));
    await flush();

    expect(mocks.createOperation).not.toHaveBeenCalled();
    const nameError = container.querySelector('.operation-field-error[data-field="name"]');
    const instructionError = container.querySelector('.operation-field-error[data-field="instruction"]');
    expect(nameError?.textContent).toBe(m.nameRequired.zh);
    expect(instructionError?.textContent).toBe(m.instructionRequired.zh);

    setValue(container.querySelector<HTMLInputElement>(".operation-name-input")!, "OP-A");
    expect(container.querySelector('.operation-field-error[data-field="name"]')).toBeNull();
    // The untouched field keeps its error until the next attempt/edit.
    expect(container.querySelector('.operation-field-error[data-field="instruction"]')).toBeTruthy();
  });

  it("the inline messages follow the locale (en)", async () => {
    const container = mountView(makeCtx());

    click(container.querySelector(".operation-save-btn"));
    act(() => setLocale("en"));
    await flush();

    expect(container.querySelector('.operation-field-error[data-field="name"]')?.textContent).toBe(m.nameRequired.en);
    expect(container.querySelector('.operation-field-error[data-field="instruction"]')?.textContent).toBe(
      m.instructionRequired.en
    );
  });
});

// —— zh/en flip: no locale mixing in the panel chrome ————————————————————————————

// The load-bearing chrome strings (kit action TITLES are data — plain strings that
// legitimately stay put — so the scan covers the strings this panel owns).
const CHROME_KEYS: Message[] = [
  m.panelTitle,
  m.tabToolbar,
  m.tabManage,
  m.newAction,
  m.nameLabel,
  m.instructionLabel,
  m.simpleHint,
  m.advanced,
  m.save,
  m.tryIt,
  m.managerTitle,
  m.editButton,
  m.customizeBuiltin,
  m.tagBuiltin,
  m.tagCustom,
  m.passageSurfaceTitle,
  m.resetSurface
];

describe("operation panel locale flip (no mixing)", () => {
  it("zh renders zh chrome with no en chrome strings; flipping to en swaps ALL of it", () => {
    const container = mountView(makeCtx({ operations: [SIMPLE_OP] }));

    const scan = (locale: "zh" | "en") => {
      const text = container.textContent ?? "";
      const other = locale === "zh" ? "en" : "zh";
      for (const message of CHROME_KEYS) {
        if (message.zh === message.en) continue;
        expect(text).not.toContain(message[other]);
      }
    };

    // zh (default): key chrome present, no English chrome.
    expect(container.textContent).toContain(m.newAction.zh);
    expect(container.textContent).toContain(m.instructionLabel.zh);
    expect(container.textContent).toContain(m.save.zh);
    scan("zh");

    // Surface tab too (its strings mount only when the tab is active).
    click(container.querySelector('[data-surface-tab="passage"]'));
    scan("zh");
    click(container.querySelector('[data-surface-tab="manage"]'));

    // Flip → everything swaps, nothing zh remains in the chrome.
    act(() => setLocale("en"));
    expect(container.textContent).toContain(m.newAction.en);
    expect(container.textContent).toContain(m.instructionLabel.en);
    expect(container.textContent).toContain(m.save.en);
    scan("en");
    click(container.querySelector('[data-surface-tab="passage"]'));
    scan("en");
  });

  it("every operation message resolves non-empty in both locales", () => {
    for (const message of Object.values(m)) {
      setLocale("zh");
      expect(t(message)).toBeTruthy();
      setLocale("en");
      expect(t(message)).toBeTruthy();
    }
  });
});

// —— buildForkTemplate (V1 pins, unchanged) ———————————————————————————————————————
// Approximates a固化 built-in prompt's body as an EDITABLE template by running its
// build() with every known input replaced by its {{token}} — including the catch→""
// fallback for a built-in whose build() throws.
describe("buildForkTemplate", () => {
  it("substitutes the well-known variables as {{tokens}} (normal fork)", () => {
    const prompt: KitPrompt = {
      id: "test.explain",
      outputType: "markdown",
      build: (input) => {
        const i = input as { anchorText?: string; sourceTitle?: string };
        return `Explain "${i.anchorText}" from ${i.sourceTitle}.`;
      }
    };
    expect(buildForkTemplate(prompt)).toBe('Explain "{{anchorText}}" from {{sourceTitle}}.');
  });

  it("substitutes declared params as {{tokens}} alongside the well-known ones", () => {
    const prompt: KitPrompt = {
      id: "test.explain-grade",
      outputType: "markdown",
      build: (input) => {
        const i = input as { anchorText?: string; grade?: string };
        return `For grade ${i.grade}: ${i.anchorText}`;
      },
      params: [{ name: "grade", label: "Grade", kind: "grade" }]
    };
    expect(buildForkTemplate(prompt)).toBe("For grade {{grade}}: {{anchorText}}");
  });

  it("produces only the well-known tokens when params is empty", () => {
    const prompt: KitPrompt = {
      id: "test.no-params",
      outputType: "markdown",
      build: (input) => `Notes: ${(input as { existingNotes?: string }).existingNotes}`,
      params: []
    };
    expect(buildForkTemplate(prompt)).toBe("Notes: {{existingNotes}}");
  });

  it("returns an empty string when build() throws (fallback path)", () => {
    const prompt: KitPrompt = {
      id: "test.broken",
      outputType: "markdown",
      build: () => {
        throw new Error("boom");
      }
    };
    expect(buildForkTemplate(prompt)).toBe("");
  });
});
