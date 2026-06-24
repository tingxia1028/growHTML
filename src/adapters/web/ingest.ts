import { ingestSource } from "../../core/store/sources";
import type { SourceRecord } from "../../core/schema";
import type { StudyVault } from "../../core/vault";
import { injectStudyIds } from "../html/core";
import { normalizeUrl, snapshotWebpage } from "./snapshot";

export type IngestWebpageOptions = {
  // Injectable for tests; defaults to the global fetch.
  fetchImpl?: typeof fetch;
  createdAt?: string;
};

export type IngestWebpageResult = {
  source: SourceRecord;
  injected: { added: number };
};

export async function ingestWebpageFromUrl(
  vault: StudyVault,
  rawUrl: string,
  options: IngestWebpageOptions = {}
): Promise<IngestWebpageResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http/https URLs can be imported.");
  }

  const response = await fetchImpl(url, {
    headers: { "user-agent": "AIStudyVault/0.1 local snapshot" },
    redirect: "follow"
  });
  if (!response.ok) {
    throw new Error(`URL returned ${response.status}`);
  }

  const finalUrl = response.url || url.toString();
  const html = await response.text();
  const snapshot = snapshotWebpage(html, finalUrl);
  const injected = injectStudyIds(snapshot.content, { idPrefix: "web" });

  const source = await ingestSource(vault, {
    title: snapshot.title || new URL(finalUrl).hostname,
    content: injected.content,
    sourceType: "webpage",
    mimeType: "text/html",
    createdBy: "user",
    createdAt: options.createdAt,
    metadata: { sourceUrl: finalUrl, normalizedUrl: normalizeUrl(finalUrl) }
  });

  return { source, injected: { added: injected.added } };
}
