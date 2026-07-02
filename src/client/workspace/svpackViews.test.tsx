// @vitest-environment jsdom
// svpack sharing dialogs (batch C, docs/design/studypack-sharing.md §5–§7): the export
// dialog builds the exact POST body and shows the one-time roster; the import dialog
// runs pick-file → auto-inspect (TOFU pin states) → code → open preview → commit, and
// maps the server's machine error codes to honest messages. The entityClient module is
// mocked (views never fetch directly) with the REAL ApiError kept, so error branches
// exercise the same instanceof path production uses.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";

const mocks = vi.hoisted(() => ({
  exportSvpack: vi.fn(),
  inspectSvpack: vi.fn(),
  openSvpack: vi.fn(),
  commitSvpack: vi.fn(),
  sealedImports: vi.fn(),
  deleteSealedImport: vi.fn()
}));

vi.mock("../data/entityClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../data/entityClient")>();
  return { ...actual, entityClient: { ...actual.entityClient, ...mocks } };
});

import { ApiError, type SvpackInspectResult, type SvpackOpenResult, type StudyLayerRecord } from "../data/entityClient";
import {
  SvpackExportDialog,
  SvpackImportDialog,
  defaultValidUntilDate,
  formatCodeGroups,
  mapSvpackError,
  normalizeCodeInput,
  validUntilIso,
  validityText
} from "./svpackViews";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CODE_DISPLAY = "A7K2Q-F3ZTV-9XJ4M-PB6WD-QH2RS-K8YTN-3EFGA-5CVUX";
const CODE_COMPACT = "A7K2QF3ZTV9XJ4MPB6WDQH2RSK8YTN3EFGA5CVUX";

const LAYER = {
  id: "layer_1",
  title: "力学错题层",
  visibility: "private",
  importMode: "owned",
  enabled: true
} as StudyLayerRecord;

const HEADER = {
  packId: "pack_1",
  revision: 1,
  title: "力学错题层",
  publisher: { id: "pubf_a7k2qf3z", displayName: "王老师", signingPubKey: "PUBKEY" },
  createdAt: "2026-07-01T00:00:00Z",
  validity: { notBefore: null, validUntil: "2026-09-01T00:00:00Z" },
  sourceHash: "sha256:553f",
  sourceType: "html",
  contentTypes: ["markdown"]
};

const INSPECT_UNKNOWN: SvpackInspectResult = {
  header: HEADER,
  pinStatus: "unknown",
  sourceMatch: { sourceId: "src_1", title: "Cell Biology" }
};

const OPENED: SvpackOpenResult = {
  header: HEADER,
  codeId: "A7K2QF3Z",
  preview: {
    matchedSourceId: "src_1",
    matchedBy: "contentHash",
    anchors: [{ refId: "a1", anchorKind: "html_selection", status: "matched" }],
    stats: { matched: 1, fuzzy: 0, unmatched: 0 }
  }
};

let root: Root | null = null;

function mount(node: ReactElement): void {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
}

function q<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`missing element: ${selector}`);
  return found;
}

function updateInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Settle pending microtasks + FileReader/event-loop ticks inside act. */
async function flush(times = 3): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function pickFile(bytes: Uint8Array<ArrayBuffer>, name = "pack.svpack"): Promise<void> {
  const input = q<HTMLInputElement>(".svpack-import-file");
  const file = new File([bytes], name, { type: "application/octet-stream" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
}

beforeEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.clearAllMocks();
  mocks.sealedImports.mockResolvedValue({ packs: [] });
});

describe("svpack pure helpers", () => {
  it("normalizes pasted codes (spaces/dashes stripped, case-folded)", () => {
    expect(normalizeCodeInput(" a7k2q-f3ztv 9xj4m\tpb6wd-qh2rs-k8ytn-3efga-5cvux ")).toBe(CODE_COMPACT);
  });

  it("keeps server-formatted codes and groups bare ones 8×5", () => {
    expect(formatCodeGroups(CODE_DISPLAY)).toBe(CODE_DISPLAY);
    expect(formatCodeGroups(CODE_COMPACT)).toBe(CODE_DISPLAY);
  });

  it("maps machine error codes to honest messages", () => {
    expect(mapSvpackError(new ApiError("x", 403, "wrong-code"))).toBe("口令不对或不属于此包");
    expect(mapSvpackError(new ApiError("x", 403, "not-entitled"))).toBe("口令不对或不属于此包");
    expect(mapSvpackError(new ApiError("x", 403, "expired"))).toBe("包已过期，联系分享者续期");
    expect(mapSvpackError(new ApiError("x", 409, "stale-revision"))).toBe("已导入更新版本，此文件是旧版本");
    expect(mapSvpackError(new ApiError("boom", 500))).toBe("boom");
  });

  it("summarizes the validity window", () => {
    expect(validityText({ notBefore: null, validUntil: "2026-09-01T00:00:00Z" })).toBe("有效期至 2026-09-01");
    expect(validityText({ notBefore: null, validUntil: null })).toBe("长期有效");
  });
});

describe("SvpackExportDialog", () => {
  it("posts recipients + validUntil, then shows the one-time roster with copy + refused notice", async () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    mocks.exportSvpack.mockResolvedValue({
      packId: "pack_1",
      revision: 1,
      fileB64: "AAEC",
      fileName: "力学错题层.svpack",
      roster: [
        { label: "张三", code: CODE_DISPLAY, codeId: "A7K2QF3Z" },
        { label: "李四", code: "B7K2Q-F3ZTV-9XJ4M-PB6WD-QH2RS-K8YTN-3EFGA-5CVUX", codeId: "B7K2QF3Z" }
      ],
      refusedCount: 2
    });

    mount(<SvpackExportDialog layer={LAYER} onClose={vi.fn()} />);

    // Step 1: two recipient rows + the default +30d 有效期.
    act(() => q<HTMLButtonElement>(".svpack-recipient-add").click());
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>(".svpack-recipient-input"));
    expect(inputs).toHaveLength(2);
    updateInput(inputs[0], "张三");
    updateInput(inputs[1], "李四");
    const date = q<HTMLInputElement>(".svpack-valid-until");
    expect(date.value).toBe(defaultValidUntilDate());

    await act(async () => q<HTMLButtonElement>(".svpack-export-submit").click());
    await flush();

    expect(mocks.exportSvpack).toHaveBeenCalledWith("layer_1", {
      recipients: [{ label: "张三" }, { label: "李四" }],
      validUntil: validUntilIso(defaultValidUntilDate())
    });

    // Step 2: roster — codes shown ONCE, per-recipient copy, refused notice.
    expect(q(".svpack-once-warning").textContent).toContain("仅显示这一次");
    const rows = Array.from(document.querySelectorAll(".svpack-roster-row"));
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("张三");
    expect(rows[0].querySelector(".svpack-code")?.textContent).toBe(CODE_DISPLAY);
    expect(q(".svpack-refused-note").textContent).toContain("2 条");
    expect(q(".svpack-download-btn").textContent).toContain("下载 .svpack");

    act(() => (rows[0].querySelector(".svpack-copy-btn") as HTMLButtonElement).click());
    expect(writeText).toHaveBeenCalledWith(CODE_DISPLAY);
  });

  it("requires at least one non-empty recipient label", () => {
    mount(<SvpackExportDialog layer={LAYER} onClose={vi.fn()} />);
    const submit = q<HTMLButtonElement>(".svpack-export-submit");
    expect(submit.disabled).toBe(true);
    updateInput(q<HTMLInputElement>(".svpack-recipient-input"), "张三");
    expect(submit.disabled).toBe(false);
  });
});

describe("SvpackImportDialog", () => {
  it("runs pick → auto-inspect → normalized-code open → preview counts → commit success", async () => {
    mocks.inspectSvpack.mockResolvedValue(INSPECT_UNKNOWN);
    mocks.openSvpack.mockResolvedValue(OPENED);
    mocks.commitSvpack.mockResolvedValue({
      packId: "pack_1",
      layerId: "layer_9",
      counts: { anchors: 1, notes: 2, stats: { matched: 1, fuzzy: 0, unmatched: 0 } },
      sealed: true
    });
    const onCommitted = vi.fn();
    mount(<SvpackImportDialog onClose={vi.fn()} onCommitted={onCommitted} />);
    await flush();

    await pickFile(new Uint8Array([1, 2, 3, 4]));
    expect(mocks.inspectSvpack).toHaveBeenCalledWith("AQIDBA=="); // base64 of the picked bytes

    // Inspect summary: publisher fingerprint + first-time pin + local source match.
    expect(q(".svpack-inspect-title").textContent).toContain("力学错题层");
    expect(q(".svpack-fingerprint").textContent).toBe("pubf_a7k2qf3z");
    expect(q(".svpack-pin").getAttribute("data-status")).toBe("unknown");
    expect(q(".svpack-pin").textContent).toContain("首次");
    expect(q(".svpack-source-match").textContent).toContain("Cell Biology");
    expect(q(".svpack-content-types").textContent).toContain("markdown");
    expect(q(".svpack-validity").textContent).toBe("有效期至 2026-09-01");

    // Paste-tolerant code → open preview with the CANONICAL form.
    updateInput(q<HTMLInputElement>(".svpack-code-input"), " a7k2q-f3ztv 9xj4m pb6wd-qh2rs-k8ytn-3efga-5cvux ");
    expect(q<HTMLButtonElement>(".svpack-commit-btn").disabled).toBe(true); // preview first
    await act(async () => q<HTMLButtonElement>(".svpack-open-btn").click());
    await flush();
    expect(mocks.openSvpack).toHaveBeenCalledWith("AQIDBA==", CODE_COMPACT);
    const stats = Array.from(document.querySelectorAll(".svpack-preview .layer-stat"));
    expect(stats.map((el) => el.textContent?.trim())).toEqual(["匹配 1", "模糊 0", "未匹配 0"]);

    // Commit → sealed success + workspace refresh.
    await act(async () => q<HTMLButtonElement>(".svpack-commit-btn").click());
    await flush();
    expect(mocks.commitSvpack).toHaveBeenCalledWith("AQIDBA==", CODE_COMPACT);
    expect(q(".svpack-success").textContent).toContain("导入成功");
    expect(q(".svpack-success-counts").textContent).toContain("笔记 2 条");
    expect(q(".svpack-success-counts").textContent).toContain("锚点 1 个");
    expect(onCommitted).toHaveBeenCalledTimes(1);
  });

  it("shows the unmatched-source hint when no local source matches", async () => {
    mocks.inspectSvpack.mockResolvedValue({ ...INSPECT_UNKNOWN, sourceMatch: null });
    mount(<SvpackImportDialog onClose={vi.fn()} onCommitted={vi.fn()} />);
    await flush();
    await pickFile(new Uint8Array([9]));
    const match = q(".svpack-source-match");
    expect(match.getAttribute("data-matched")).toBe("false");
    expect(match.textContent).toContain("仍可导入，绑定源后可见");
  });

  it("renders the red publisher-key MISMATCH warning", async () => {
    mocks.inspectSvpack.mockResolvedValue({ ...INSPECT_UNKNOWN, pinStatus: "pinned-mismatch" });
    mount(<SvpackImportDialog onClose={vi.fn()} onCommitted={vi.fn()} />);
    await flush();
    await pickFile(new Uint8Array([9]));
    const pin = q(".svpack-pin");
    expect(pin.getAttribute("data-status")).toBe("pinned-mismatch");
    expect(pin.textContent).toContain("发布者密钥不匹配");
  });

  it("maps a wrong code to 口令不对 and an expired pack to 续期", async () => {
    mocks.inspectSvpack.mockResolvedValue(INSPECT_UNKNOWN);
    mocks.openSvpack.mockRejectedValueOnce(new ApiError("wrong code for this pack", 403, "wrong-code"));
    mount(<SvpackImportDialog onClose={vi.fn()} onCommitted={vi.fn()} />);
    await flush();
    await pickFile(new Uint8Array([1, 2, 3, 4]));

    updateInput(q<HTMLInputElement>(".svpack-code-input"), CODE_DISPLAY);
    await act(async () => q<HTMLButtonElement>(".svpack-open-btn").click());
    await flush();
    expect(q(".error-box").textContent).toBe("口令不对或不属于此包");

    mocks.openSvpack.mockRejectedValueOnce(new ApiError("pack is not currently valid (expired)", 403, "expired"));
    await act(async () => q<HTMLButtonElement>(".svpack-open-btn").click());
    await flush();
    expect(q(".error-box").textContent).toBe("包已过期，联系分享者续期");
  });

  it("maps a stale-revision commit to 已导入更新版本", async () => {
    mocks.inspectSvpack.mockResolvedValue(INSPECT_UNKNOWN);
    mocks.openSvpack.mockResolvedValue(OPENED);
    mocks.commitSvpack.mockRejectedValue(new ApiError("revision 1 is not newer", 409, "stale-revision"));
    const onCommitted = vi.fn();
    mount(<SvpackImportDialog onClose={vi.fn()} onCommitted={onCommitted} />);
    await flush();
    await pickFile(new Uint8Array([1, 2, 3, 4]));

    updateInput(q<HTMLInputElement>(".svpack-code-input"), CODE_DISPLAY);
    await act(async () => q<HTMLButtonElement>(".svpack-open-btn").click());
    await flush();
    await act(async () => q<HTMLButtonElement>(".svpack-commit-btn").click());
    await flush();
    expect(q(".error-box").textContent).toBe("已导入更新版本，此文件是旧版本");
    expect(onCommitted).not.toHaveBeenCalled();
  });

  it("lists sealed imports with status and deletes after confirm", async () => {
    mocks.sealedImports.mockResolvedValue({
      packs: [
        {
          packId: "pack_9",
          status: "active",
          echo: { ...HEADER, publisher: { id: "pubf_x", displayName: "王老师", publicKeyB64u: "PK" }, codeId: "A7K2QF3Z" },
          importedAt: "2026-07-01T00:00:00Z",
          counts: { anchors: 1, notes: 2 }
        },
        { packId: "pack_gone", status: "expired" }
      ]
    });
    mocks.deleteSealedImport.mockResolvedValue({ ok: true });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onCommitted = vi.fn();
    mount(<SvpackImportDialog onClose={vi.fn()} onCommitted={onCommitted} />);
    await flush();

    const rows = Array.from(document.querySelectorAll(".svpack-sealed-row"));
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("力学错题层");
    expect(rows[0].querySelector(".svpack-status")?.textContent).toBe("有效");
    expect(rows[1].textContent).toContain("pack_gone"); // no echo → packId fallback
    expect(rows[1].querySelector(".svpack-status")?.textContent).toBe("已过期");

    await act(async () => (rows[0].querySelector(".svpack-sealed-delete") as HTMLButtonElement).click());
    await flush();
    expect(confirmSpy).toHaveBeenCalled();
    expect(mocks.deleteSealedImport).toHaveBeenCalledWith("pack_9");
    expect(onCommitted).toHaveBeenCalledTimes(1); // sealed content left the read model
    confirmSpy.mockRestore();
  });
});
