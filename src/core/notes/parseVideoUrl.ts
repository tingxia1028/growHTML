// parseVideoUrl — a PURE function that maps a remote video URL to a provider + id,
// or null when the input is not a recognized provider link. It is the SHARED parser
// behind two consumers (design plan §4 Phase 2):
//   • the classifier (classifyContent): a BARE provider URL → video {kind:"embed"}.
//   • the `video` plugin's embed render: build the provider's <iframe> src from
//     { provider, videoId } (so the stored note never depends on the original URL's
//     query noise).
//
// Contract: pure (no React / fetch / DOM / module state), NEVER throws — junk → null.
// Supported providers and the URL shapes they accept:
//   • youtube  — youtu.be/<id>, youtube.com/watch?v=<id>, /embed/<id>, /shorts/<id>
//                (www. / m. / music. subdomains; extra query params ignored).
//   • bilibili — bilibili.com/video/<BV…> (the videoId is the BVID, incl. the "BV").
//   • vimeo    — vimeo.com/<digits> (and player.vimeo.com/video/<digits>).

export type VideoProvider = "youtube" | "bilibili" | "vimeo";

export type ParsedVideo = {
  provider: VideoProvider;
  /** The provider-native id: a YouTube v-id, a bilibili BVID, or a Vimeo numeric id. */
  videoId: string;
};

// A YouTube video id is 11 chars of [A-Za-z0-9_-]. We validate the shape so a junk
// path segment (e.g. youtu.be/about) doesn't masquerade as a video id.
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
// A bilibili BVID: "BV" followed by 10 alphanumerics (case as-stored).
const BV_ID = /^BV[A-Za-z0-9]{10}$/;
// Vimeo numeric id.
const VIMEO_ID = /^\d+$/;

function normalizeHost(host: string): string {
  // Drop a leading www./m./music. so subdomain variants match the same provider.
  return host.toLowerCase().replace(/^(www\.|m\.|music\.)/, "");
}

/**
 * Parse a URL into { provider, videoId } or null. Pure + total: any non-URL / junk
 * input returns null rather than throwing.
 */
export function parseVideoUrl(url: string): ParsedVideo | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (trimmed === "") return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  const host = normalizeHost(parsed.hostname);
  // Path segments with empty parts removed (so /embed//x doesn't shift indices).
  const segs = parsed.pathname.split("/").filter((s) => s.length > 0);

  // —— YouTube ——————————————————————————————————————————————————————————————
  if (host === "youtu.be") {
    // youtu.be/<id>
    const id = segs[0];
    if (id && YT_ID.test(id)) return { provider: "youtube", videoId: id };
    return null;
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    // watch?v=<id>
    if (segs[0] === "watch") {
      const v = parsed.searchParams.get("v");
      if (v && YT_ID.test(v)) return { provider: "youtube", videoId: v };
      return null;
    }
    // /embed/<id> and /shorts/<id>
    if ((segs[0] === "embed" || segs[0] === "shorts") && segs[1]) {
      const id = segs[1];
      if (YT_ID.test(id)) return { provider: "youtube", videoId: id };
    }
    return null;
  }

  // —— bilibili —————————————————————————————————————————————————————————————
  if (host === "bilibili.com") {
    // bilibili.com/video/<BV…>
    if (segs[0] === "video" && segs[1]) {
      const bvid = segs[1];
      if (BV_ID.test(bvid)) return { provider: "bilibili", videoId: bvid };
    }
    return null;
  }

  // —— Vimeo ————————————————————————————————————————————————————————————————
  if (host === "vimeo.com") {
    // vimeo.com/<digits>  (channel/album paths like /channels/foo are NOT a video)
    const id = segs[0];
    if (id && VIMEO_ID.test(id)) return { provider: "vimeo", videoId: id };
    return null;
  }
  if (host === "player.vimeo.com") {
    // player.vimeo.com/video/<digits>
    if (segs[0] === "video" && segs[1] && VIMEO_ID.test(segs[1])) {
      return { provider: "vimeo", videoId: segs[1] };
    }
    return null;
  }

  return null;
}

/**
 * Build the provider's embeddable player URL from a parsed video — the `src` for the
 * embed <iframe>. Shared so the classifier and the render produce identical srcs.
 *   • youtube  → https://www.youtube.com/embed/<id>
 *   • bilibili → https://player.bilibili.com/player.html?bvid=<id>&page=1
 *   • vimeo    → https://player.vimeo.com/video/<id>
 */
export function videoEmbedSrc(video: ParsedVideo): string {
  switch (video.provider) {
    case "youtube":
      return `https://www.youtube.com/embed/${encodeURIComponent(video.videoId)}`;
    case "bilibili":
      return `https://player.bilibili.com/player.html?bvid=${encodeURIComponent(video.videoId)}&page=1`;
    case "vimeo":
      return `https://player.vimeo.com/video/${encodeURIComponent(video.videoId)}`;
  }
}
