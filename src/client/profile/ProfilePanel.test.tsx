// @vitest-environment jsdom
// 画像页 (MEM-2) — the Profile view against stubbed IO (the profileIo seam): facts
// render with kind/pin/hide affordances, override edits dispatch the MERGED override
// document (pin/hide/correct) and reload, the digest summary renders per-dimension
// bars, the capture switch round-trips (and mirrors the local capture gate), 清除记忆
// is a two-step confirm, and retention info is visible (nothing is a black box).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

// Side effect: registers profile.panel in the view registry.
import "./ProfilePanel";

import { getView, type WorkspaceContext } from "../workspace/viewRegistry";
import { setLocale } from "../i18n";
import type {
  MemoryDigestRow,
  MemoryEventInput,
  MemoryProfileResponse,
  ProfileOverrides
} from "../data/entityClient";
import { digestMemoryEvents } from "../../core/memory/digest";
import { flushNow, recordMemoryEvent, resetMemoryCaptureForTests, setMemoryTransportForTests } from "../memory/capture";
import { setProfileIoForTests, type ProfileIo } from "./profileIo";

const digestRows: MemoryDigestRow[] = digestMemoryEvents([
  { verb: "note.review", createdAt: "2026-06-20T08:00:00.000Z", subject: { contentType: "quiz", sourceId: "src_1" }, payload: { result: "fail" } },
  { verb: "note.review", createdAt: "2026-06-20T09:00:00.000Z", subject: { contentType: "quiz", sourceId: "src_1" }, payload: { result: "fail" } },
  { verb: "note.review", createdAt: "2026-06-21T09:00:00.000Z", subject: { contentType: "quiz", sourceId: "src_1" }, payload: { result: "pass" } },
  { verb: "note.create", createdAt: "2026-06-21T10:00:00.000Z", subject: { contentType: "flashcard" }, payload: { subject: "物理" } }
]) as MemoryDigestRow[];

const FACTS: MemoryProfileResponse["facts"] = [
  {
    key: "weak:contentType:quiz",
    kind: "weak",
    title: "弱项:quiz",
    value: "复习错误率 67%(2/3 次未过,类型)",
    evidence: ["contentType:quiz"],
    confidence: 0.3,
    pinned: false,
    hidden: false
  },
  { key: "activity:streak", kind: "activity", title: "连续学习", value: "2 天(至 2026-06-21)", evidence: [], pinned: false, hidden: false },
  { key: "top:verbs", kind: "top", title: "最常做", value: "note.review ×3 · note.create ×1", evidence: [], pinned: false, hidden: false }
];

function profileWith(overrides: ProfileOverrides, captureEnabled = true): MemoryProfileResponse {
  const byKey = new Map(overrides.facts.map((fact) => [fact.key, fact]));
  const merged = FACTS.map((fact) => ({
    ...fact,
    pinned: byKey.get(fact.key)?.pinned === true,
    hidden: byKey.get(fact.key)?.hidden === true,
    note: byKey.get(fact.key)?.note
  }));
  return {
    facts: [...merged.filter((fact) => fact.pinned), ...merged.filter((fact) => !fact.pinned)],
    overrides,
    digestMeta: {
      frozenThrough: "2026-06-17T00:00:00.000Z",
      consolidatedAt: "2026-07-01T12:00:00.000Z",
      rows: digestRows.length,
      events: 4,
      captureEnabled,
      retention: { rawEventDays: 14, digestDays: 365 }
    }
  };
}

// A stateful IO stub: saves mutate `state` so the panel's reload sees the new truth.
function makeIo(initialOverrides: ProfileOverrides = { facts: [] }, captureEnabled = true) {
  const state = { overrides: initialOverrides, captureEnabled };
  const io = {
    fetchProfile: vi.fn<ProfileIo["fetchProfile"]>(async () => profileWith(state.overrides, state.captureEnabled)),
    fetchDigests: vi.fn<ProfileIo["fetchDigests"]>(async () => ({
      digests: digestRows,
      meta: { frozenThrough: "2026-06-17T00:00:00.000Z", consolidatedAt: "2026-07-01T12:00:00.000Z", rows: digestRows.length }
    })),
    saveOverrides: vi.fn(async (overrides: ProfileOverrides) => {
      state.overrides = overrides;
      return { overrides };
    }),
    saveSettings: vi.fn(async (settings: { captureEnabled: boolean }) => {
      state.captureEnabled = settings.captureEnabled;
      return { settings };
    }),
    consolidate: vi.fn(async () => ({ consolidated: {} })),
    clearAll: vi.fn(async () => {
      state.overrides = { facts: [] };
      return { cleared: { events: 4, digests: true, overrides: true } };
    })
  } satisfies ProfileIo;
  return { io, state };
}

let posted: MemoryEventInput[][];

beforeEach(() => {
  setLocale("zh");
  posted = [];
  resetMemoryCaptureForTests();
  setMemoryTransportForTests(async (events) => {
    posted.push(events);
  });
});

afterEach(() => {
  setProfileIoForTests(null);
  setMemoryTransportForTests(null);
  resetMemoryCaptureForTests();
});

async function renderPanel() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      getView("profile.panel")!.render(
        { id: "profile", kind: "profile.panel" } as never,
        {} as WorkspaceContext
      ) as React.ReactElement
    );
  });
  const cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  const click = async (selector: string) => {
    const btn = container.querySelector(selector) as HTMLButtonElement | null;
    expect(btn, `missing button ${selector}`).toBeTruthy();
    await act(async () => {
      btn!.click();
    });
  };
  return { container, cleanup, click };
}

describe("ProfilePanel — rendering", () => {
  it("renders facts (kind chips), the digest summary with fail bars, and the retention info", async () => {
    const { io } = makeIo();
    setProfileIoForTests(io);
    const { container, cleanup } = await renderPanel();

    // Facts.
    const factKeys = Array.from(container.querySelectorAll(".profile-fact")).map((el) =>
      el.getAttribute("data-fact-key")
    );
    expect(factKeys).toEqual(["weak:contentType:quiz", "activity:streak", "top:verbs"]);
    const weak = container.querySelector('[data-fact-key="weak:contentType:quiz"]')!;
    expect(weak.querySelector(".profile-fact-kind")!.textContent).toBe("弱项");
    expect(weak.querySelector(".profile-fact-value")!.textContent).toContain("67%");

    // Digest summary: activity line + the quiz bucket with a fail-ratio bar.
    expect(container.querySelector(".profile-activity")!.textContent).toContain("4 次行为");
    expect(container.querySelector(".profile-activity")!.textContent).toContain("连续 2 天");
    const quizRow = container.querySelector('.profile-dimension[data-dimension="contentType"] [data-bucket="quiz"]')!;
    expect(quizRow.querySelector(".profile-fail-label")!.textContent).toBe("错误率 67%");
    expect((quizRow.querySelector(".profile-bar-fill") as HTMLElement).style.width).toBe("67%");
    // The payload 学科 bucket renders under 学科.
    expect(container.querySelector('.profile-dimension[data-dimension="subject"] [data-bucket="物理"]')).toBeTruthy();
    // Zero-attempt buckets show no bar.
    const flashcardRow = container.querySelector('[data-bucket="flashcard"]')!;
    expect(flashcardRow.querySelector(".profile-bar")).toBeNull();

    // Retention (doc defaults) + tier meta are stated in the 记忆管理 block.
    const retention = container.querySelector(".profile-retention")!.textContent!;
    expect(retention).toContain("14 天");
    expect(retention).toContain("12 个月");
    expect(retention).toContain("4 条原始事件");
    cleanup();
  });

  it("shows the empty state when no facts derive, and the capture-off banner when the switch is off", async () => {
    const { io } = makeIo();
    io.fetchProfile.mockImplementation(async () => ({ ...profileWith({ facts: [] }, false), facts: [] }));
    io.fetchDigests.mockImplementation(async () => ({
      digests: [],
      meta: { frozenThrough: null, consolidatedAt: null, rows: 0 }
    }));
    setProfileIoForTests(io);
    const { container, cleanup } = await renderPanel();

    expect(container.querySelector(".profile-empty")).toBeTruthy();
    expect(container.querySelector(".profile-capture-off")!.textContent).toContain("行为记录已关闭");
    expect((container.querySelector(".profile-capture-switch input") as HTMLInputElement).checked).toBe(false);
    cleanup();
  });

  it("flips profile chrome and built-in fact labels to English", async () => {
    setLocale("en");
    const { io } = makeIo();
    setProfileIoForTests(io);
    const { container, cleanup } = await renderPanel();

    const weak = container.querySelector('[data-fact-key="weak:contentType:quiz"]')!;
    expect(container.querySelector(".panel-title")!.textContent).toContain("Profile");
    expect(container.querySelector(".profile-head")!.textContent).toContain("Memory Profile");
    expect(weak.querySelector(".profile-fact-kind")!.textContent).toBe("Weak");
    expect(weak.querySelector(".profile-fact-title")!.textContent).toBe("Weak Spot: quiz");
    expect(weak.querySelector(".profile-fact-value")!.textContent).toBe("Review fail rate 67% (2/3 failed, Type)");
    expect(container.querySelector(".profile-activity")!.textContent).toContain("4 events");
    expect(container.querySelector(".profile-activity")!.textContent).toContain("streak 2 days");
    expect(container.querySelector('.profile-dimension[data-dimension="contentType"] .profile-subhead')!.textContent).toBe("Type");
    expect(container.querySelector('.profile-dimension[data-dimension="contentType"] .profile-fail-label')!.textContent).toBe("Fail Rate 67%");
    expect(container.querySelector(".profile-manage-section .profile-head")!.textContent).toBe("Memory Management");
    expect(container.textContent).not.toContain("画像");
    expect(container.textContent).not.toContain("弱项");
    expect(container.textContent).not.toContain("错误率");
    cleanup();
  });
});

describe("ProfilePanel — override edits (pin / hide / correct)", () => {
  it("置顶 dispatches the merged override document and the pinned fact floats first after reload", async () => {
    const { io } = makeIo();
    setProfileIoForTests(io);
    const { container, cleanup, click } = await renderPanel();

    await click('[data-fact-key="top:verbs"] .profile-pin-btn');
    expect(io.saveOverrides).toHaveBeenCalledWith({ facts: [{ key: "top:verbs", pinned: true }] });
    // Reload happened and the pin applied.
    expect(io.fetchProfile.mock.calls.length).toBeGreaterThanOrEqual(2);
    const factKeys = Array.from(container.querySelectorAll(".profile-fact")).map((el) =>
      el.getAttribute("data-fact-key")
    );
    expect(factKeys[0]).toBe("top:verbs");
    expect(container.querySelector('[data-fact-key="top:verbs"] .profile-fact-pin')).toBeTruthy();

    // Un-pin drops the (now all-default) override entirely.
    await click('[data-fact-key="top:verbs"] .profile-pin-btn');
    expect(io.saveOverrides).toHaveBeenLastCalledWith({ facts: [] });
    cleanup();
  });

  it("隐藏 moves the fact into the collapsible hidden group; 恢复 brings it back", async () => {
    const { io } = makeIo();
    setProfileIoForTests(io);
    const { container, cleanup, click } = await renderPanel();

    await click('[data-fact-key="weak:contentType:quiz"] .profile-hide-btn');
    expect(io.saveOverrides).toHaveBeenCalledWith({ facts: [{ key: "weak:contentType:quiz", hidden: true }] });
    // Not in the visible list anymore; the hidden toggle appears.
    expect(container.querySelector('.profile-fact-list:not(.profile-fact-list-hidden) [data-fact-key="weak:contentType:quiz"]')).toBeNull();
    const toggle = container.querySelector(".profile-hidden-toggle")!;
    expect(toggle.textContent).toContain("已隐藏 1 条");

    await click(".profile-hidden-toggle");
    await click('[data-fact-key="weak:contentType:quiz"] .profile-restore-btn');
    expect(io.saveOverrides).toHaveBeenLastCalledWith({ facts: [] });
    expect(container.querySelector('.profile-fact-list [data-fact-key="weak:contentType:quiz"]')).toBeTruthy();
    cleanup();
  });

  it("修正 opens an inline note editor and saves the correction onto the override", async () => {
    const { io } = makeIo();
    setProfileIoForTests(io);
    const { container, cleanup, click } = await renderPanel();

    await click('[data-fact-key="weak:contentType:quiz"] .profile-correct-btn');
    const input = container.querySelector(".profile-note-input") as HTMLInputElement;
    expect(input).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "那周在生病");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(".profile-note-save-btn");
    expect(io.saveOverrides).toHaveBeenCalledWith({
      facts: [{ key: "weak:contentType:quiz", note: "那周在生病" }]
    });
    expect(container.querySelector('[data-fact-key="weak:contentType:quiz"] .profile-fact-note')!.textContent).toContain(
      "那周在生病"
    );
    cleanup();
  });
});

describe("ProfilePanel — 记忆管理", () => {
  it("清除记忆 is a two-step confirm: nothing happens until 确认清除; 取消 backs out", async () => {
    const { io } = makeIo();
    setProfileIoForTests(io);
    const { container, cleanup, click } = await renderPanel();

    await click(".profile-clear-btn");
    expect(io.clearAll).not.toHaveBeenCalled(); // step 1 only reveals the confirm
    expect(container.querySelector(".profile-clear-confirm")).toBeTruthy();

    // 取消 backs out without clearing.
    await click(".profile-clear-confirm .profile-btn:not(.profile-clear-yes-btn)");
    expect(io.clearAll).not.toHaveBeenCalled();
    expect(container.querySelector(".profile-clear-confirm")).toBeNull();

    // Confirm actually clears + reloads.
    await click(".profile-clear-btn");
    await click(".profile-clear-yes-btn");
    expect(io.clearAll).toHaveBeenCalledTimes(1);
    expect(io.fetchProfile.mock.calls.length).toBeGreaterThanOrEqual(2);
    cleanup();
  });

  it("the capture switch saves the vault setting AND mirrors the local capture gate", async () => {
    const { io } = makeIo();
    setProfileIoForTests(io);
    const { container, cleanup } = await renderPanel();

    const checkbox = container.querySelector(".profile-capture-switch input") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    await act(async () => {
      checkbox.click();
    });
    expect(io.saveSettings).toHaveBeenCalledWith({ captureEnabled: false });
    expect(checkbox.checked).toBe(false); // reload reflects the persisted switch

    // The LOCAL capture queue gate mirrored off: recorded events are dropped.
    recordMemoryEvent("open", { sourceId: "src_1" });
    await flushNow();
    expect(posted).toEqual([]);

    await act(async () => {
      checkbox.click();
    });
    expect(io.saveSettings).toHaveBeenLastCalledWith({ captureEnabled: true });
    recordMemoryEvent("open", { sourceId: "src_1" });
    await flushNow();
    expect(posted.flat()).toHaveLength(1);
    cleanup();
  });

  it("立即汇总 runs a consolidation pass and reloads", async () => {
    const { io } = makeIo();
    setProfileIoForTests(io);
    const { cleanup, click } = await renderPanel();

    await click(".profile-consolidate-btn");
    expect(io.consolidate).toHaveBeenCalledTimes(1);
    expect(io.fetchProfile.mock.calls.length).toBeGreaterThanOrEqual(2);
    cleanup();
  });
});
