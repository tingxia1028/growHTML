// Source authoring services (SRC-1 create + SRC-2 edit pipeline,
// docs/design/source-authoring.md §3-§4). Transport-agnostic like every X0a service:
// (deps, parsed input) → plain data, typed errors from ./errors; the Express routes in
// app.ts and the direct transport call the same functions.
//
// The SRC-2 save pipeline REUSES the layer-import re-anchoring machinery instead of
// growing a second matcher: `toPortable` (strip a local anchor to quote+context),
// `rematchAnchor` (matched/fuzzy/unmatched tiers), `plainTextForSource` (the text the
// matcher runs against) and `resolveLocalStudyId` (re-bind an html_selection anchor to
// whatever element now carries its quote). Re-projection is ALWAYS by quote+context —
// never by studyId, because `injectStudyIds` is order-based and any edit shifts ids.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { injectStudyIds } from "../../adapters/html/core";
import { renderNoteContent } from "../../adapters/notes/render";
import { anchorSchema, sourceSchema, type AnchorRecord, type SourceRecord } from "../../core/schema";
import {
  computeContentHash,
  ingestSource,
  updateStoredSourceContent
} from "../../core/store/sources";
import { rematchAnchor, type MatchStatus } from "../../core/study-layer/rematch";
import type { StudyVault } from "../../core/vault";
import { plainTextForSource, resolveLocalStudyId, toPortable } from "../studyLayer";
import { PUBLISHES_DIR, publishLedgerSchema } from "../svpack";
import { NotFoundError, ValidationError } from "./errors";

export type SourceAuthoringDeps = { vault: StudyVault };

// —— schemas (zod single-source: routes + direct transport parse with these) ————————

export const createAuthoredSourceRequestSchema = z.object({
  title: z.string().min(1),
  sourceType: z.enum(["markdown", "html"]),
  // Blank-create is the norm (the editor opens straight into 编辑 mode for an empty
  // body), so unlike the import seams `content` may be empty.
  content: z.string().default("")
});
export type CreateAuthoredSourceInput = z.infer<typeof createAuthoredSourceRequestSchema>;

export const updateAuthoredSourceRequestSchema = z.object({
  content: z.string(),
  title: z.string().min(1).optional()
});
export type UpdateAuthoredSourceInput = z.infer<typeof updateAuthoredSourceRequestSchema>;

// —— projection (what the READER sees) ————————————————————————————————————————————

/**
 * The HTML the reader/anchor pipeline sees for a text source. HTML sources store
 * study-id-injected markup already; markdown sources store RAW markdown (the editor
 * edits it back), so their reader HTML is derived here: the existing markdown
 * renderer (adapters/notes/render — the same path notes render through) plus
 * `injectStudyIds`. Both steps are deterministic, so unchanged content always yields
 * the same ids and anchors stay bound between renders; after an EDIT the ids may
 * shift, which is exactly why saves re-project by quote+context (below).
 */
export function projectedHtmlForSource(
  source: Pick<SourceRecord, "sourceType">,
  content: string
): string {
  if (source.sourceType !== "markdown") return content;
  if (!content.trim()) return "";
  const html = renderNoteContent("markdown", content).html;
  return injectStudyIds(html, { idPrefix: "md" }).content;
}

// —— SRC-1: blank-create ————————————————————————————————————————————————————————————

/** Create an AUTHORED markdown/html source (the Library 新建 group entries). */
export async function createAuthoredSource(
  { vault }: SourceAuthoringDeps,
  input: CreateAuthoredSourceInput
): Promise<{ source: SourceRecord }> {
  // HTML follows the ingestHtml idiom: stamp study ids at rest. Markdown stays raw —
  // ids are injected at projection time (projectedHtmlForSource).
  const content =
    input.sourceType === "html" && input.content.trim()
      ? injectStudyIds(input.content, { idPrefix: "html" }).content
      : input.content;

  const source = await ingestSource(vault, {
    title: input.title,
    content,
    sourceType: input.sourceType,
    createdBy: "user",
    origin: "authored"
  });
  return { source };
}

// —— SRC-2: save → re-hash → re-ingest → re-project ————————————————————————————————

export type ReprojectedAnchor = {
  anchorId: string;
  status: MatchStatus;
  /** The anchor's quote — the re-located one when matched/fuzzy, the ORIGINAL one when
      unmatched (so the 受影响的锚点 list can show what the anchor pointed at). */
  quote: string;
};

export type Reprojection = {
  total: number;
  matched: number;
  fuzzy: number;
  unmatched: number;
  anchors: ReprojectedAnchor[];
};

export type UpdateAuthoredSourceResult = {
  source: SourceRecord;
  reprojection: Reprojection;
};

const emptyReprojection = (): Reprojection => ({
  total: 0,
  matched: 0,
  fuzzy: 0,
  unmatched: 0,
  anchors: []
});

/**
 * Save an authored source's edited content: rewrite + re-hash + bump `revision`, then
 * RE-PROJECT every live anchor of the source against the new content by quote+context
 * (the import machinery). Non-matching anchors get `matchStatus: "unmatched"` (state
 * already modeled on the anchor envelope) and surface in the editor's 受影响的锚点 list.
 * Imported sources are rejected — their body is read-only (fork/patch is SRC-3).
 */
export async function updateAuthoredSource(
  { vault }: SourceAuthoringDeps,
  input: { sourceId: string } & UpdateAuthoredSourceInput
): Promise<UpdateAuthoredSourceResult> {
  const existing = await vault.stores.sources.get(input.sourceId);
  if (!existing) throw new NotFoundError("Source not found");
  if (existing.origin !== "authored") {
    throw new ValidationError("Only authored sources can be edited (imported sources are read-only)");
  }
  if (existing.sourceType !== "markdown" && existing.sourceType !== "html") {
    throw new ValidationError("Only markdown/html authored sources support content editing");
  }

  // HTML edits re-stamp study ids over the edited markup. injectStudyIds PRESERVES
  // ids already present, so surviving elements keep their ids and only new elements
  // get fresh ones (re-projection below still never relies on that).
  const stored =
    existing.sourceType === "html" && input.content.trim()
      ? injectStudyIds(input.content, { idPrefix: "html" }).content
      : input.content;

  // No content change: don't bump the revision or churn the anchors. A pure title
  // rename still lands (without a revision bump — the revision tracks CONTENT).
  if (computeContentHash(stored) === existing.contentHash) {
    if (input.title && input.title !== existing.title) {
      const record = sourceSchema.parse({
        ...existing,
        title: input.title,
        updatedAt: new Date().toISOString()
      });
      await vault.stores.sources.upsert(record);
      return { source: record, reprojection: emptyReprojection() };
    }
    return { source: existing, reprojection: emptyReprojection() };
  }

  const source = await updateStoredSourceContent(vault, existing, stored, { title: input.title });

  // Re-project all of this source's live anchors against the NEW projected content.
  const projected = projectedHtmlForSource(source, stored);
  const text = plainTextForSource(projected, "html");
  const now = new Date().toISOString();

  const anchors = (await vault.stores.anchors.list()).filter((a) => a.sourceId === source.id);
  const reprojection = emptyReprojection();

  for (const anchor of anchors) {
    const updated = reprojectAnchor(anchor, projected, text, now);
    await vault.stores.anchors.upsert(updated.record);
    reprojection.total += 1;
    reprojection[updated.status] += 1;
    reprojection.anchors.push({
      anchorId: anchor.id,
      status: updated.status,
      quote: (updated.status === "unmatched" ? anchor.quote : updated.record.quote) ?? ""
    });
  }

  return { source, reprojection };
}

// One anchor through the import rematch tiers. html_selection re-binds its studyId via
// resolveLocalStudyId (a match without a resolvable element degrades to unmatched);
// other kinds keep their locators and just take the refreshed quote/context + status.
function reprojectAnchor(
  anchor: AnchorRecord,
  projectedHtml: string,
  text: string,
  now: string
): { record: AnchorRecord; status: MatchStatus } {
  const result = rematchAnchor(toPortable(anchor), { text, sameBinary: false });

  const markUnmatched = (): { record: AnchorRecord; status: MatchStatus } => ({
    record: anchorSchema.parse({ ...anchor, matchStatus: "unmatched", updatedAt: now }),
    status: "unmatched"
  });

  if (result.status === "unmatched") return markUnmatched();

  const quote = result.text?.quote ?? anchor.quote ?? "";
  const contextBefore = result.text?.contextBefore ?? anchor.contextBefore ?? "";
  const contextAfter = result.text?.contextAfter ?? anchor.contextAfter ?? "";

  if (anchor.anchorKind === "html_selection") {
    const studyId = resolveLocalStudyId(projectedHtml, quote);
    if (!studyId) return markUnmatched();
    return {
      record: anchorSchema.parse({
        ...anchor,
        quote,
        contextBefore,
        contextAfter,
        studyId,
        selector: `[data-study-id="${studyId.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`,
        matchStatus: result.status,
        updatedAt: now
      }),
      status: result.status
    };
  }

  return {
    record: anchorSchema.parse({
      ...anchor,
      quote,
      contextBefore,
      contextAfter,
      matchStatus: result.status,
      updatedAt: now
    }),
    status: result.status
  };
}

// —— SRC-2: the shared-source edit warning input ————————————————————————————————————

export type SourceShareStatus = {
  /** True when editing would break a previously shared pack's binding to this source. */
  shared: boolean;
  /** Publish-ledger entries (exported .svpack packs) hanging off this source's layers. */
  publishedPackCount: number;
  /** Layers on this source that themselves arrived from a shared pack. */
  importedLayerCount: number;
};

/**
 * Whether this source "has publish-ledger entries or shared layers" (source-authoring
 * §2.2): the client warns before the FIRST edit — an edit re-hashes the content, and
 * the contentHash is the first key in the layer↔source fingerprint chain, so old
 * shared packs stop binding to the edited copy.
 */
export async function getSourceShareStatus(
  { vault }: SourceAuthoringDeps,
  input: { sourceId: string }
): Promise<SourceShareStatus> {
  const source = await vault.stores.sources.get(input.sourceId);
  if (!source) throw new NotFoundError("Source not found");

  const layers = (await vault.stores.layers.list()).filter((l) => l.localSourceId === input.sourceId);
  const layerIds = new Set(layers.map((l) => l.id));
  const importedLayerCount = layers.filter((l) => !!l.origin?.packId).length;

  let publishedPackCount = 0;
  const publishesDir = path.join(vault.paths.rootDir, PUBLISHES_DIR);
  let files: string[] = [];
  try {
    files = readdirSync(publishesDir).filter((file) => file.endsWith(".json"));
  } catch {
    files = []; // No publishes dir yet — nothing was ever exported.
  }
  for (const file of files) {
    try {
      const ledger = publishLedgerSchema.parse(JSON.parse(readFileSync(path.join(publishesDir, file), "utf8")));
      if (layerIds.has(ledger.layerId)) publishedPackCount += 1;
    } catch {
      // Unreadable/foreign file in publishes/ — not a ledger we can attribute.
    }
  }

  return {
    shared: publishedPackCount > 0 || importedLayerCount > 0,
    publishedPackCount,
    importedLayerCount
  };
}
