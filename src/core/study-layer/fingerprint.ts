import type { SourceFingerprint, SourceRecord } from "../schema";

// Build a content-based identity for a local source. `contentHash` (set at ingest
// for both text and binary sources) is the strongest signal; URL/title are weaker
// fallbacks for matching an imported layer to the right local source.
export function fingerprintForSource(source: SourceRecord): SourceFingerprint {
  const meta = (source.metadata ?? {}) as Record<string, unknown>;
  const fp: SourceFingerprint = {
    contentHash: source.contentHash,
    title: source.title,
    sourceType: source.sourceType
  };
  if (typeof meta.normalizedUrl === "string") fp.canonicalUrl = meta.normalizedUrl;
  if (typeof meta.sourceUrl === "string") fp.url = meta.sourceUrl;
  return fp;
}

export type FingerprintMatch = {
  source: SourceRecord;
  by: "contentHash" | "fileHash" | "canonicalUrl" | "url" | "title";
};

// Match an imported layer's fingerprint to the importer's OWN copy of the source.
// Priority: contentHash > fileHash > canonicalUrl > url > title (case-insensitive).
export function matchSourceByFingerprint(
  sources: readonly SourceRecord[],
  fp: SourceFingerprint
): FingerprintMatch | null {
  const meta = (s: SourceRecord) => (s.metadata ?? {}) as Record<string, unknown>;

  if (fp.contentHash) {
    const hit = sources.find((s) => s.contentHash === fp.contentHash);
    if (hit) return { source: hit, by: "contentHash" };
  }
  if (fp.fileHash) {
    const hit = sources.find((s) => s.contentHash === fp.fileHash);
    if (hit) return { source: hit, by: "fileHash" };
  }
  if (fp.canonicalUrl) {
    const hit = sources.find((s) => meta(s).normalizedUrl === fp.canonicalUrl);
    if (hit) return { source: hit, by: "canonicalUrl" };
  }
  if (fp.url) {
    const hit = sources.find((s) => meta(s).sourceUrl === fp.url);
    if (hit) return { source: hit, by: "url" };
  }
  if (fp.title) {
    const want = fp.title.trim().toLowerCase();
    const hit = sources.find((s) => s.title.trim().toLowerCase() === want);
    if (hit) return { source: hit, by: "title" };
  }
  return null;
}
