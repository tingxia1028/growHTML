// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { getNoteType } from "./noteTypeRegistry";

// video plugin (adaptive note forms · Phase 2). ONE `video` render switches on the
// content's `kind`: embed → a provider <iframe> with the correct src + sandbox; asset
// → <video src=/api/assets/:id>; an ABSENT kind (legacy note) still renders as asset.

vi.mock("../DiagramNote", () => ({ DiagramNote: () => <div /> }));
vi.mock("../data/entityClient", () => ({
  entityClient: { assetUrl: (id: string) => `/api/assets/${id}` }
}));

import "./builtinNoteTypes";

function render(node: React.ReactNode): HTMLDivElement {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(node as React.ReactElement));
  // Caller reads the DOM, then we leave it mounted (test unmounts implicitly at GC);
  // jsdom doesn't need explicit unmount for these synchronous reads.
  return container;
}

describe("video render — embed variant", () => {
  it("builds the YouTube embed src and a media-restricted sandbox iframe", () => {
    const content = { kind: "embed", provider: "youtube", videoId: "dQw4w9WgXcQ", url: "https://youtu.be/dQw4w9WgXcQ" };
    const el = render(getNoteType("video")!.render({ content }));
    const iframe = el.querySelector("iframe.sv-video-embed-frame") as HTMLIFrameElement;
    expect(iframe).toBeTruthy();
    expect(iframe.getAttribute("src")).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
    // allow-same-origin is present (remote provider origin only) but NOT allow-forms/popups.
    const sandbox = iframe.getAttribute("sandbox") ?? "";
    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).toContain("allow-same-origin");
    expect(sandbox).not.toContain("allow-forms");
    expect(sandbox).not.toContain("allow-popups");
    expect(iframe.getAttribute("allow")).toBe("fullscreen; picture-in-picture");
    expect(iframe.getAttribute("referrerpolicy")).toBe("strict-origin-when-cross-origin");
  });

  it("builds bilibili and vimeo player srcs", () => {
    const bili = render(
      getNoteType("video")!.render({
        content: { kind: "embed", provider: "bilibili", videoId: "BV1xx411c7mu", url: "u" }
      })
    );
    expect((bili.querySelector("iframe") as HTMLIFrameElement).src).toContain(
      "player.bilibili.com/player.html?bvid=BV1xx411c7mu&page=1"
    );
    const vimeo = render(
      getNoteType("video")!.render({ content: { kind: "embed", provider: "vimeo", videoId: "123", url: "u" } })
    );
    expect((vimeo.querySelector("iframe") as HTMLIFrameElement).src).toContain("player.vimeo.com/video/123");
  });
});

describe("video render — asset variant + backward-compat", () => {
  it("a LEGACY { assetId } note (no kind) renders a <video> pointing at the asset route", () => {
    const el = render(getNoteType("video")!.render({ content: { assetId: "asset_abc" } }));
    const video = el.querySelector("video.sv-media-video") as HTMLVideoElement;
    expect(video).toBeTruthy();
    expect(video.getAttribute("src")).toBe("/api/assets/asset_abc");
    expect(el.querySelector("iframe")).toBeNull();
  });

  it("an explicit { kind:'asset' } note renders the same <video>", () => {
    const el = render(getNoteType("video")!.render({ content: { kind: "asset", assetId: "asset_xyz" } }));
    expect((el.querySelector("video") as HTMLVideoElement).getAttribute("src")).toBe("/api/assets/asset_xyz");
  });

  it("does not crash on an empty/mis-shaped asset note", () => {
    expect(() => render(getNoteType("video")!.render({ content: { assetId: "" } }))).not.toThrow();
    expect(() => render(getNoteType("video")!.render({ content: 123 }))).not.toThrow();
  });
});
