import { ingestSource } from "../../core/store/sources";
import type { SourceRecord } from "../../core/schema";
import type { StudyVault } from "../../core/vault";
import { normalizeUrl } from "./snapshot";

// A "live web" source keeps the URL live (annotated in the Electron webview)
// rather than snapshotting its HTML. It reuses the Source pipeline: the stored
// content is just the URL, and the live URL lives in metadata.
export async function ingestWebLiveSource(
  vault: StudyVault,
  rawUrl: string,
  options: { createdAt?: string; title?: string } = {}
): Promise<SourceRecord> {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http/https URLs can be opened live.");
  }

  const normalizedUrl = normalizeUrl(url.toString());
  return ingestSource(vault, {
    title: options.title || url.hostname + url.pathname.replace(/\/$/, ""),
    content: normalizedUrl,
    sourceType: "web_live",
    mimeType: "text/uri-list",
    createdBy: "user",
    createdAt: options.createdAt,
    metadata: { sourceUrl: url.toString(), normalizedUrl }
  });
}
