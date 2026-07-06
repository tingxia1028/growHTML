// @vitest-environment jsdom
// PLAT-LAYER Part-2 Slice 7b — CHARACTERIZATION tests for the composer-domain back-edges
// that the slash/composer CONSUMER tests (slashComposer / composerTypePicker, which run over
// makeCtx() FAKES) do NOT cover: the two entityClient.importImageBase64 wirings.
//
// TEST-ONLY: ZERO production changes. These pin the CURRENT observable behavior of
// `attachImage` and `captureMistakePhoto` (and, THROUGH captureMistakePhoto, the
// mistake-photo.capture dispatch → generateStructured → onGenerated park) so the
// `useComposerDomain` extraction can prove it preserved behavior. Harness mirrors
// generationDomain.characterization.test.tsx: mount the REAL WorkspaceProvider under a
// FocusProvider, stub the reader modules + entityClient IO, opt into React's act() env, and
// drive the action through the live context surface.
//
// The behaviors pinned (cited against WorkspaceContext.tsx / useComposerDomain.ts):
//   (a) attachImage(file) → fileToBase64 reads the File → entityClient.importImageBase64 is
//       called with the base64 + the File's mimeType/name; the RETURNED assetId is pushed
//       onto pendingImages as a { assetId, mimeType } REF. This is the black-box path that
//       exercises attachImage's importImageBase64 back-edge end to end.
//   (b) captureMistakePhoto(file) → fileToBase64 → importImageBase64 → dispatch
//       "mistake-photo.capture" with the image REF as a SIBLING payload → the command's run
//       calls generateStructured (the photo rides `images`) → onGenerated parks the extracted
//       MISTAKE draft in the generation preview (pendingDraft). The mistake-photo.capture
//       command is a KIT command, so the test registers it directly (registerCommand) — the
//       minimal registration that makes the dispatch reachable without the heavy clientKits
//       import graph.
//
// Black-box reachability note: attachImage AND captureMistakePhoto are BOTH public value
// fields, so each is driven directly off the live context surface. fileToBase64 (the module
// helper that moved into useComposerDomain) is exercised THROUGH both — it is not a public
// field and both callers await it, so its base64-strip behavior is pinned via the assertion
// on importImageBase64's dataBase64 argument (a real FileReader.readAsDataURL round-trip).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// Opt into React's act() environment so state updates + effects flush deterministically.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Reader-module stubs — keep the import graph jsdom-safe (pdf.js / webview native bits).
vi.mock("../PdfReader", () => ({ PdfReader: () => null }));
vi.mock("../ImageReader", () => ({ ImageReader: () => null }));
vi.mock("../WebviewReader", () => ({ WebviewReader: () => null }));
vi.mock("../LocalHtmlReader", () => ({ LocalHtmlReader: () => null }));

// importImageBase64 returns a DISTINGUISHABLE assetId so a pending image / a dispatched
// mistake carrying it proves the import back-edge fired end to end. generateStructured returns
// a MISTAKE draft (the mistake-photo.capture command hands its content to onGenerated → park).
vi.mock("../data/entityClient", () => ({
  entityClient: {
    sources: vi.fn(() => Promise.resolve({ sources: [] })),
    operations: vi.fn(() => Promise.resolve({ operations: [] })),
    operationPrefs: vi.fn(() => Promise.resolve({ prefs: { order: [], disabled: [], params: {} } })),
    importImageBase64: vi.fn(() =>
      Promise.resolve({ assetId: "asset_TESTIMG01", asset: { id: "asset_TESTIMG01" } })
    ),
    generateStructured: vi.fn(() =>
      Promise.resolve({ content: { question: "1/2+1/3=?", wrongAnswer: "2/5", correctAnswer: "5/6" }, concepts: [] })
    )
  }
}));

import { entityClient } from "../data/entityClient";
import { FocusProvider } from "../focus/FocusContext";
import { registerCommand } from "../commands/registry";
import { captureMistakePhotoCommand } from "../../kits/mistake-photo/commands";
import { MISTAKE_CONTENT_TYPE } from "../../core/notes/contentTypes";
import { WorkspaceProvider, useWorkspace, type WorkspaceContextValue } from "./WorkspaceContext";

let container: HTMLDivElement;
let root: Root;
let ctx: WorkspaceContextValue;

function Capture() {
  ctx = useWorkspace();
  return null;
}

async function mount() {
  await act(async () => {
    root.render(
      <FocusProvider>
        <WorkspaceProvider>
          <Capture />
        </WorkspaceProvider>
      </FocusProvider>
    );
  });
  // Flush the mount fetch chain so the provider settles before a test drives anything.
  await flush();
}

async function flush() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

// A tiny PNG-ish File. jsdom's FileReader.readAsDataURL produces a real data URL whose
// base64 body fileToBase64 strips — so the importImageBase64 dataBase64 assertion is a
// genuine round-trip through the moved helper.
function makeFile(): File {
  return new File([new Uint8Array([1, 2, 3, 4])], "wrong.png", { type: "image/png" });
}

beforeEach(() => {
  // The mistake-photo.capture command is a KIT command — register it directly so the
  // captureMistakePhoto dispatch is reachable (minimal registration, no clientKits graph).
  registerCommand(captureMistakePhotoCommand);
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1400 });
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("composer domain — the importImageBase64 back-edges", () => {
  it("(a) attachImage → importImageBase64 → pendingImages gains the returned assetId REF", async () => {
    await mount();
    expect(ctx.pendingImages).toEqual([]);

    await act(async () => {
      await ctx.attachImage(makeFile());
    });
    await flush();

    // The vault import ran with the stripped base64 + the File's mimeType/name.
    expect(entityClient.importImageBase64).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(entityClient.importImageBase64).mock.calls[0][0];
    expect(arg.mimeType).toBe("image/png");
    expect(arg.fileName).toBe("wrong.png");
    // fileToBase64 stripped the data-URL prefix → a bare base64 body (no "data:" scheme).
    expect(typeof arg.dataBase64).toBe("string");
    expect(arg.dataBase64).not.toContain("data:");
    expect(arg.dataBase64.length).toBeGreaterThan(0);
    // The returned assetId parked as a pending attachment REF (never base64).
    expect(ctx.pendingImages).toEqual([{ assetId: "asset_TESTIMG01", mimeType: "image/png" }]);
  });

  it("(b) captureMistakePhoto → importImageBase64 + dispatch mistake-photo.capture → the MISTAKE draft parks", async () => {
    await mount();
    expect(ctx.pendingDraft).toBeNull();

    await act(async () => {
      await ctx.captureMistakePhoto(makeFile(), "分数加法");
    });
    await flush();

    // Same import path as attachImage (the photo is imported to an assetId REF first).
    expect(entityClient.importImageBase64).toHaveBeenCalledTimes(1);
    // The dispatched command ran the VLM extract with the image riding the SIBLING `images`.
    expect(entityClient.generateStructured).toHaveBeenCalledTimes(1);
    const genArg = vi.mocked(entityClient.generateStructured).mock.calls[0][0] as {
      images?: Array<{ assetId: string }>;
      input?: { hint?: string };
    };
    expect(genArg.images?.[0]?.assetId).toBe("asset_TESTIMG01");
    // The optional hint folded into the prompt input.
    expect(genArg.input?.hint).toBe("分数加法");
    // onGenerated parked the anchor-less MISTAKE draft in the generation preview (not
    // auto-materialized — a photo mistake has no passage).
    expect(ctx.pendingDraft).not.toBeNull();
    expect(ctx.pendingDraft?.contentType).toBe(MISTAKE_CONTENT_TYPE);
    expect(ctx.pendingDraft?.content).toEqual({ question: "1/2+1/3=?", wrongAnswer: "2/5", correctAnswer: "5/6" });
    // pendingImages is UNTOUCHED — captureMistakePhoto dispatches, it does not stage a chip.
    expect(ctx.pendingImages).toEqual([]);
  });

  it("(c) attachImage import FAILURE surfaces via error and leaves pendingImages empty", async () => {
    vi.mocked(entityClient.importImageBase64).mockRejectedValueOnce(new Error("图片太大"));
    await mount();

    await act(async () => {
      await ctx.attachImage(makeFile());
    });
    await flush();

    // Degrade-not-disappear: the error surfaced (docs.setError sink) and nothing staged.
    expect(ctx.error).toBe("图片太大");
    expect(ctx.pendingImages).toEqual([]);
  });
});
