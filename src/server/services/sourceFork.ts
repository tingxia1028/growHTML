// Imported-source FORK (SRC-3, docs/design/source-authoring.md §3-§4): "fork to an
// authored copy" — a NEW source with origin "authored" that copies the original's
// content, so its body becomes editable through the SRC-2 pipeline. Per §3 the fork is
// a fresh document: the original's NOTES and ANCHORS STAY on the original (they are not
// copied or moved) — the fork starts annotation-free.
//
// Transport-agnostic like every X0a service: (deps, parsed input) → plain data, typed
// errors from ./errors; the Express route and the direct transport call this same fn.
import { z } from "zod";
import { injectStudyIds } from "../../adapters/html/core";
import { ingestSource, readSourceContent } from "../../core/store/sources";
import type { SourceRecord } from "../../core/schema";
import type { StudyVault } from "../../core/vault";
import { NotFoundError, ValidationError } from "./errors";

export type SourceForkDeps = { vault: StudyVault };

export const forkSourceRequestSchema = z.object({
  // Optional override; defaults to "<original title>（副本）" when absent.
  title: z.string().min(1).optional()
});
export type ForkSourceInput = z.infer<typeof forkSourceRequestSchema>;

/**
 * Fork an imported source into an AUTHORED copy. The copy carries the same content
 * (html re-stamped with study ids at rest like a create, markdown kept raw), origin
 * "authored" and revision 1. The original is untouched — its notes/anchors remain on it.
 */
export async function forkSource(
  { vault }: SourceForkDeps,
  input: { sourceId: string } & ForkSourceInput
): Promise<{ source: SourceRecord }> {
  const original = await vault.stores.sources.get(input.sourceId);
  if (!original) throw new NotFoundError("Source not found");
  if (original.sourceType !== "html" && original.sourceType !== "markdown") {
    throw new ValidationError("Only html/markdown sources can be forked to an editable copy");
  }
  const sourceType = original.sourceType;

  const rawContent = await readSourceContent(vault, original);
  // HTML follows the create/edit idiom: stamp study ids at rest (injectStudyIds
  // preserves any already present). Markdown stays raw — ids inject at projection time.
  const content =
    original.sourceType === "html" && rawContent.trim()
      ? injectStudyIds(rawContent, { idPrefix: "html" }).content
      : rawContent;

  const title = input.title?.trim() || `${original.title}（副本）`;

  const source = await ingestSource(vault, {
    title,
    content,
    sourceType,
    createdBy: "user",
    origin: "authored"
  });
  return { source };
}
