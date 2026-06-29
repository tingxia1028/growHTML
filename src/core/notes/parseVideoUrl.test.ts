import { describe, it, expect } from "vitest";
import { parseVideoUrl, videoEmbedSrc } from "./parseVideoUrl";

// parseVideoUrl (adaptive note forms · Phase 2). PURE, total (junk → null). Covers
// every accepted URL shape per provider, plus negatives, plus the embed-src builder.

describe("parseVideoUrl — YouTube", () => {
  it("youtu.be/<id>", () => {
    expect(parseVideoUrl("https://youtu.be/dQw4w9WgXcQ")).toEqual({ provider: "youtube", videoId: "dQw4w9WgXcQ" });
  });
  it("youtube.com/watch?v=<id> (with extra params)", () => {
    expect(parseVideoUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PL")).toEqual({
      provider: "youtube",
      videoId: "dQw4w9WgXcQ"
    });
  });
  it("youtube.com/embed/<id>", () => {
    expect(parseVideoUrl("https://www.youtube.com/embed/dQw4w9WgXcQ")).toEqual({
      provider: "youtube",
      videoId: "dQw4w9WgXcQ"
    });
  });
  it("youtube.com/shorts/<id>", () => {
    expect(parseVideoUrl("https://youtube.com/shorts/dQw4w9WgXcQ")).toEqual({
      provider: "youtube",
      videoId: "dQw4w9WgXcQ"
    });
  });
  it("m. / music. subdomains normalize", () => {
    expect(parseVideoUrl("https://m.youtube.com/watch?v=dQw4w9WgXcQ")?.provider).toBe("youtube");
    expect(parseVideoUrl("https://music.youtube.com/watch?v=dQw4w9WgXcQ")?.videoId).toBe("dQw4w9WgXcQ");
  });
  it("rejects a non-video path (youtu.be/about) and a malformed id", () => {
    expect(parseVideoUrl("https://youtu.be/about")).toBeNull();
    expect(parseVideoUrl("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(parseVideoUrl("https://www.youtube.com/feed/subscriptions")).toBeNull();
  });
});

describe("parseVideoUrl — bilibili", () => {
  it("bilibili.com/video/<BV…> → bvid", () => {
    expect(parseVideoUrl("https://www.bilibili.com/video/BV1xx411c7mu")).toEqual({
      provider: "bilibili",
      videoId: "BV1xx411c7mu"
    });
  });
  it("tolerates a trailing path/query", () => {
    expect(parseVideoUrl("https://www.bilibili.com/video/BV1xx411c7mu/?spm_id_from=333")?.videoId).toBe(
      "BV1xx411c7mu"
    );
  });
  it("rejects a non-BV id", () => {
    expect(parseVideoUrl("https://www.bilibili.com/video/av12345")).toBeNull();
  });
});

describe("parseVideoUrl — Vimeo", () => {
  it("vimeo.com/<digits>", () => {
    expect(parseVideoUrl("https://vimeo.com/123456789")).toEqual({ provider: "vimeo", videoId: "123456789" });
  });
  it("player.vimeo.com/video/<digits>", () => {
    expect(parseVideoUrl("https://player.vimeo.com/video/123456789")).toEqual({
      provider: "vimeo",
      videoId: "123456789"
    });
  });
  it("rejects a non-numeric path (vimeo.com/channels/foo)", () => {
    expect(parseVideoUrl("https://vimeo.com/channels/staffpicks")).toBeNull();
  });
});

describe("parseVideoUrl — junk / negatives", () => {
  it("returns null for non-URLs, empty, and non-strings", () => {
    expect(parseVideoUrl("not a url")).toBeNull();
    expect(parseVideoUrl("")).toBeNull();
    expect(parseVideoUrl("   ")).toBeNull();
    // @ts-expect-error — totality on bad input.
    expect(parseVideoUrl(undefined)).toBeNull();
    // @ts-expect-error
    expect(parseVideoUrl(42)).toBeNull();
  });
  it("returns null for an unrelated http(s) URL and non-http schemes", () => {
    expect(parseVideoUrl("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseVideoUrl("ftp://youtu.be/dQw4w9WgXcQ")).toBeNull();
    expect(parseVideoUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("videoEmbedSrc", () => {
  it("builds the provider player URL from { provider, videoId }", () => {
    expect(videoEmbedSrc({ provider: "youtube", videoId: "dQw4w9WgXcQ" })).toBe(
      "https://www.youtube.com/embed/dQw4w9WgXcQ"
    );
    expect(videoEmbedSrc({ provider: "bilibili", videoId: "BV1xx411c7mu" })).toBe(
      "https://player.bilibili.com/player.html?bvid=BV1xx411c7mu&page=1"
    );
    expect(videoEmbedSrc({ provider: "vimeo", videoId: "123456789" })).toBe(
      "https://player.vimeo.com/video/123456789"
    );
  });
});
