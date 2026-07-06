// Direct VaultTransport (X0b, docs/design/multi-platform.md §1-X0): the backend
// adapter that lets entityClient call the extracted services IN-PROCESS — no
// express, no HTTP, no sockets. The mobile shell (X2) will run
// `configureVaultTransport(createDirectTransport(deps))` at startup and the whole
// client works unchanged over a local vault.
//
// Contract parity with the HTTP edge, on purpose:
//   • Paths/methods are the SAME strings entityClient already produces; a tiny
//     route table maps them to service calls (path params + query parsed here).
//   • Request bodies are validated with the SAME exported zod schemas app.ts
//     parses — one validation source of truth.
//   • Failures become the SAME `ApiError(message, status, code?)` the http
//     transport builds from a response, mirroring handleServiceError + app.ts's
//     error middleware: NotFound→404, Validation→400, Forbidden→403, Conflict→409
//     (body-aware), ZodError→400 "Invalid request", anything else→500.
//   • Sealed (read-only) guards run BEFORE body validation, exactly like the
//     routes where a 403 must win over a 400.
//
// DOCUMENTED SUBSET (V1) — exactly these endpoints are routable:
//   sources   GET  /api/sources                       · list
//             POST /api/sources/html                  · ingest pasted/imported HTML
//             GET  /api/sources/:sourceId/rendered    · materialized read model
//             GET  /api/sources/:sourceId/bundle      · W2 chat-context bundle (excerpt+notes)
//             DELETE /api/sources/:sourceId           · delete
//   anchors   POST /api/anchors                       · create (any kind)
//             GET  /api/sources/:sourceId/anchors     · derived painting list
//             (no anchor DELETE anywhere — the HTTP API has none either; anchor
//              lifecycle is the notes-side orphan cascade)
//   notes     POST  /api/notes                        · create
//             GET   /api/notes                        · entity query (concept/anchor/source/layers)
//             GET   /api/sources/:sourceId/notes      · per-source list
//             PATCH /api/notes/:noteId                · attachments/layers/content
//             DELETE /api/notes/:noteId               · delete + orphan-anchor cascade
//   layers    GET   /api/sources/:sourceId/layers     · per-source list (lazy owned/presets)
//             PATCH /api/layers/:layerId              · enabled/title/color/order
//   search    GET  /api/search                        · SEARCH-1 cross-vault query (notes+sources)
//   memory    POST /api/memory/events                 · batch append (capture-off ⇒ 204/undefined)
//             GET  /api/memory/events                 · since/limit read-back
//             GET  /api/memory/settings               · capture switch
//             PUT  /api/memory/settings               · capture switch
//             POST /api/memory/consolidate            · MEM-2 pass (events→digests + compaction)
//             GET  /api/memory/digests                · day digests (?dimension=) + tier meta
//             GET  /api/memory/profile                · facts + overrides + digestMeta
//             PUT  /api/memory/profile                · replace the override document
//             DELETE /api/memory                      · clear every tier (events/digests/overrides)
//   review    GET  /api/review/schedule               · REV-3 per-note SRS records (absent ⇒ {})
//             POST /api/review/grade                  · apply one grade outcome (skip never writes)
//   graph     GET  /api/graph                         · CG-1 derived concept graph
//                                                       (?conceptId&depth neighborhood, ?sourceId scope)
//   concepts  GET/POST /api/concepts · GET/DELETE /api/concepts/:id · POST /api/concepts/:id/merge
//   relations GET/POST /api/relations · DELETE /api/relations/:id
//   operations GET/POST /api/operations · GET/PATCH/DELETE /api/operations/:id
//   op-prefs  GET/PUT /api/operation-prefs
//   plugin    GET/PUT /api/plugin-prefs · PUT /api/plugin-prefs/catalog
//   workspace GET/PUT /api/workspace · GET/PUT /api/workspace/onboarding · GET/PUT /api/workspace/ui-prefs
//   layers    POST /api/sources/:id/layers · DELETE /api/layers/:id · POST /api/layers/:id/export
//             · POST /api/layers/import/preview|commit
//   sources   PATCH /api/sources/:id (updateSourceMetadata — LOAD-BEARING, setActiveKit)
//   assets    POST /api/assets (base64 import, MAX_INLINE_IMAGE_BYTES cap) · GET /api/assets/:id/meta
//   svpack    GET /api/svpack (installed sealed rows) · DELETE /api/svpack/:packId (delete blob)
//   about     GET /api/about · GET /api/vault
// Anything else — including the HTTP-only streams (SSE chat, binary assets/files),
// the ingestion routes (URL/web-live/local-file/xmind — server-side file/network/unzip),
// and the svpack crypto family (export/inspect/open/commit/identity — need identityDir +
// device-key/ledger internals) — throws DirectTransportUnsupportedError naming the method+path.

import { z } from "zod";
import { ApiError, type VaultTransport } from "../../client/data/transport";
import { deleteSource, listSources } from "../../core/store/sources";
import { importAssetBytes, MAX_INLINE_IMAGE_BYTES } from "../../core/store/assets";
import packageJson from "../../../package.json";
import { deleteSealed, sealedImportsDir } from "../sealedImports";
import type { StudyVault } from "../../core/vault";
import {
  appendMemoryEvents,
  clearMemory,
  consolidateMemory,
  getMemoryProfile,
  listMemoryDigests,
  listMemoryDigestsQuerySchema,
  listMemoryEvents,
  listMemoryEventsQuerySchema,
  putMemorySettingsSchema,
  readMemorySettings,
  writeMemoryProfileOverrides,
  writeMemorySettings
} from "../memory";
import type { SealedRuntime } from "../svpack";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors";
import * as anchorsService from "./anchors";
import * as conceptsService from "./concepts";
import * as graphService from "./graph";
import * as layersService from "./layers";
import * as notesService from "./notes";
import * as operationsService from "./operations";
import * as patchesService from "./patches";
import * as reviewScheduleService from "./reviewSchedule";
import * as searchService from "./search";
import * as triggerFiresService from "./triggerFires";
import * as sourceAuthoringService from "./sourceAuthoring";
import * as sourceForkService from "./sourceFork";
import * as sourcesService from "./sources";
import * as workspaceService from "./workspace";

export type DirectTransportDeps = {
  vault: StudyVault;
  /** The svpack sealed read-model/guard runtime (createSealedRuntime). */
  sealed: SealedRuntime;
  /** Injectable wall clock for memory-event envelopes (tests pin arrival times). */
  now?: () => number;
};

/** A path outside the documented subset — nothing was called, nothing swallowed. */
export class DirectTransportUnsupportedError extends Error {
  constructor(method: string, path: string) {
    super(
      `direct transport does not support ${method} ${path} ` +
        `(not in the documented route subset — HTTP-only or unrouted endpoint)`
    );
    this.name = "DirectTransportUnsupportedError";
  }
}

type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

type BaseCtx = {
  deps: DirectTransportDeps;
  /** Decoded path params, keyed by the pattern's `:name` segments. */
  params: Record<string, string>;
  query: URLSearchParams;
  /** The raw request body — for routes that must gate BEFORE validating (memory POST). */
  body: unknown;
};

type DirectRoute = {
  method: HttpMethod;
  pattern: string;
  /** Body schema — the SAME exported zod app.ts parses. Absent ⇒ `input` is undefined. */
  schema?: { parse(input: unknown): unknown };
  /** Runs BEFORE body validation (sealed guards: 403 wins over 400, like the routes). */
  guard?: (ctx: BaseCtx) => void;
  call: (ctx: BaseCtx & { input: unknown }) => Promise<unknown>;
};

/** Type-binder: ties a route's schema output to its handler's `input` (table erases it). */
function route<T = undefined>(def: {
  method: HttpMethod;
  pattern: string;
  schema?: { parse(input: unknown): T };
  guard?: (ctx: BaseCtx) => void;
  call: (ctx: BaseCtx & { input: T }) => Promise<unknown>;
}): DirectRoute {
  // Sound by construction: the dispatcher only ever passes `call` the output of THIS
  // route's own `schema.parse` (or undefined when there is no schema).
  return def as unknown as DirectRoute;
}

/** `/api/notes/:noteId` vs `/api/notes/note_1` → `{ noteId: "note_1" }`, else null. */
function matchPattern(pattern: string, pathname: string): Record<string, string> | null {
  const patternParts = pattern.split("/");
  const pathParts = pathname.split("/");
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const part = patternParts[index];
    if (part.startsWith(":")) {
      if (!pathParts[index]) return null;
      params[part.slice(1)] = decodeURIComponent(pathParts[index]);
    } else if (part !== pathParts[index]) {
      return null;
    }
  }
  return params;
}

/**
 * Typed service failure → the SAME ApiError the http transport parses out of a
 * response. Status mapping mirrors handleServiceError; message mapping mirrors the
 * http transport's `body.error ?? "Request failed: <path>"` (the ConflictError
 * `body` case sends a custom body that may carry `code` — or no `error` at all).
 */
function toApiError(error: unknown, path: string): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof NotFoundError) return new ApiError(error.message, 404);
  if (error instanceof ValidationError) return new ApiError(error.message, 400);
  if (error instanceof ForbiddenError) return new ApiError(error.message, 403);
  if (error instanceof ConflictError) {
    if (error.body !== undefined) {
      const body = error.body as { error?: string; code?: string };
      return new ApiError(
        typeof body.error === "string" ? body.error : `Request failed: ${path}`,
        409,
        typeof body.code === "string" ? body.code : undefined
      );
    }
    return new ApiError(error.message, 409);
  }
  // app.ts error middleware parity: ZodError → 400 {error:"Invalid request"}, rest → 500.
  if (error instanceof z.ZodError) return new ApiError("Invalid request", 400);
  return new ApiError(error instanceof Error ? error.message : "Unknown server error", 500);
}

// —— The route table — each `call` returns exactly the JSON body the express route
// sends (the transport consumer never sees 200-vs-201; `undefined` ≙ 204 no-body). ——
const routes: DirectRoute[] = [
  // —— Sources ——
  route({
    method: "GET",
    pattern: "/api/sources",
    call: async ({ deps }) => ({ sources: await listSources(deps.vault) })
  }),
  route({
    method: "POST",
    pattern: "/api/sources/html",
    schema: sourcesService.ingestHtmlRequestSchema,
    call: ({ deps, input }) => sourcesService.ingestHtml({ vault: deps.vault }, input)
  }),
  route({
    method: "GET",
    pattern: "/api/sources/:sourceId/rendered",
    call: ({ deps, params }) => sourcesService.renderSource({ vault: deps.vault }, { sourceId: params.sourceId })
  }),
  // Attachment bundle (ai-workspace.md §W2) — parity with GET /api/sources/:id/bundle so
  // mobile assembles the SAME chat context (sealed notes filtered in the service).
  route({
    method: "GET",
    pattern: "/api/sources/:sourceId/bundle",
    call: async ({ deps, params, query }) => ({
      bundle: await sourcesService.buildSourceBundle(
        { vault: deps.vault, sealed: deps.sealed },
        { sourceId: params.sourceId, includeNotes: query.get("includeNotes") !== "false" }
      )
    })
  }),
  // —— Source authoring (SRC-1 create / SRC-2 edit pipeline) ——
  route({
    method: "POST",
    pattern: "/api/sources/authored",
    schema: sourceAuthoringService.createAuthoredSourceRequestSchema,
    call: ({ deps, input }) => sourceAuthoringService.createAuthoredSource({ vault: deps.vault }, input)
  }),
  route({
    method: "PATCH",
    pattern: "/api/sources/:sourceId/content",
    schema: sourceAuthoringService.updateAuthoredSourceRequestSchema,
    call: ({ deps, params, input }) =>
      sourceAuthoringService.updateAuthoredSource({ vault: deps.vault }, { sourceId: params.sourceId, ...input })
  }),
  route({
    method: "GET",
    pattern: "/api/sources/:sourceId/share-status",
    call: ({ deps, params }) =>
      sourceAuthoringService.getSourceShareStatus({ vault: deps.vault }, { sourceId: params.sourceId })
  }),
  // SRC-3: fork an imported source into an editable authored copy (parity with the route).
  route({
    method: "POST",
    pattern: "/api/sources/:sourceId/fork",
    schema: sourceForkService.forkSourceRequestSchema,
    call: ({ deps, params, input }) =>
      sourceForkService.forkSource({ vault: deps.vault }, { sourceId: params.sourceId, ...input })
  }),
  route({
    method: "DELETE",
    pattern: "/api/sources/:sourceId",
    call: async ({ deps, params }) => {
      const removed = await deleteSource(deps.vault, params.sourceId);
      if (!removed) throw new NotFoundError("Source not found");
      return { ok: true };
    }
  }),
  // Merge-patch a source's metadata (Product Kit activation writes metadata.activeKitIds).
  // LOAD-BEARING: setActiveKit drives kit activation through this; a missing route silently
  // broke per-source kit switching on the direct (mobile) host. Mirrors PATCH /api/sources/:id.
  route({
    method: "PATCH",
    pattern: "/api/sources/:sourceId",
    schema: sourcesService.updateSourceRequestSchema,
    call: async ({ deps, params, input }) => ({
      source: await sourcesService.updateSourceMetadata({ vault: deps.vault }, { sourceId: params.sourceId, ...input })
    })
  }),

  // —— Anchors ——
  route({
    method: "POST",
    pattern: "/api/anchors",
    schema: anchorsService.createAnchorRequestSchema,
    call: async ({ deps, input }) => ({ anchor: await anchorsService.createAnchor({ vault: deps.vault }, input) })
  }),
  route({
    method: "GET",
    pattern: "/api/sources/:sourceId/anchors",
    call: async ({ deps, params }) => ({
      anchors: await anchorsService.listSourceAnchors(deps, { sourceId: params.sourceId })
    })
  }),

  // —— Notes ——
  route({
    method: "POST",
    pattern: "/api/notes",
    schema: notesService.createNoteRequestSchema,
    call: async ({ deps, input }) => ({ note: await notesService.createNote({ vault: deps.vault }, input) })
  }),
  route({
    method: "GET",
    pattern: "/api/notes",
    call: async ({ deps, query }) => ({
      notes: await notesService.listNotes(deps, {
        conceptId: query.get("conceptId") ?? undefined,
        anchorId: query.get("anchorId") ?? undefined,
        sourceId: query.get("sourceId") ?? undefined,
        enabledLayerIds: query.get("enabledLayerIds") ?? undefined
      })
    })
  }),
  route({
    method: "GET",
    pattern: "/api/sources/:sourceId/notes",
    call: async ({ deps, params, query }) => ({
      notes: await notesService.listNotes(deps, {
        sourceId: params.sourceId,
        enabledLayerIds: query.get("enabledLayerIds") ?? undefined
      })
    })
  }),
  route({
    method: "PATCH",
    pattern: "/api/notes/:noteId",
    guard: ({ deps, params }) => notesService.assertNoteWritable({ sealed: deps.sealed }, params.noteId),
    schema: notesService.updateNoteRequestSchema,
    call: async ({ deps, params, input }) => ({
      note: await notesService.updateNote(deps, { noteId: params.noteId, ...input })
    })
  }),
  route({
    method: "DELETE",
    pattern: "/api/notes/:noteId",
    call: async ({ deps, params }) => {
      await notesService.deleteNote(deps, { noteId: params.noteId });
      return { ok: true };
    }
  }),

  // —— Patches (SRC-3 apply engine) — parity with the routes so mobile drives the
  // same accept→apply/conflict/revert lifecycle. ——
  route({
    method: "POST",
    pattern: "/api/patches",
    schema: patchesService.createPatchRequestSchema,
    call: async ({ deps, input }) => ({ patch: await patchesService.createPatch({ vault: deps.vault }, input) })
  }),
  route({
    method: "GET",
    pattern: "/api/sources/:sourceId/patches",
    call: async ({ deps, params }) => ({
      patches: (await deps.vault.stores.patches.list()).filter((patch) => patch.sourceId === params.sourceId)
    })
  }),
  route({
    method: "PATCH",
    pattern: "/api/patches/:patchId",
    schema: patchesService.updatePatchRequestSchema,
    call: async ({ deps, params, input }) => ({
      patch: await patchesService.updatePatchStatus({ vault: deps.vault }, { patchId: params.patchId, ...input })
    })
  }),

  // —— Study Layers ——
  route({
    method: "GET",
    pattern: "/api/sources/:sourceId/layers",
    call: async ({ deps, params }) => ({
      layers: await layersService.listSourceLayers(deps, { sourceId: params.sourceId })
    })
  }),
  route({
    method: "PATCH",
    pattern: "/api/layers/:layerId",
    guard: ({ deps, params }) => layersService.assertLayerWritable({ sealed: deps.sealed }, params.layerId),
    schema: layersService.updateLayerRequestSchema,
    call: async ({ deps, params, input }) => ({
      layer: await layersService.updateLayer(deps, { layerId: params.layerId, ...input })
    })
  }),

  // —— Global search (SEARCH-1) — parity with GET /api/search so mobile searches
  // identically (design §2's direct-transport requirement). ——
  route({
    method: "GET",
    pattern: "/api/search",
    // SEARCH-2 filters travel over the SAME query params (parity with GET /api/search):
    // getAll → the shared parser, so a repeated `family` / comma `type` behaves identically.
    call: async ({ deps, query }) => ({
      hits: await searchService.searchVault(deps, {
        q: query.get("q") ?? "",
        filters: searchService.parseSearchFilters((name) => query.getAll(name))
      })
    })
  }),

  // —— Learner memory (MEM-1) ——
  route({
    method: "POST",
    pattern: "/api/memory/events",
    // No `schema` here ON PURPOSE: the capture switch gates BEFORE validation (off ⇒
    // 204/undefined even for a malformed batch). appendMemoryEvents parses the SAME
    // exported postMemoryEventsSchema internally — still one validation source of truth.
    call: async ({ deps, body }) => (await appendMemoryEvents(deps, body)) ?? undefined
  }),
  route({
    method: "GET",
    pattern: "/api/memory/events",
    call: ({ deps, query }) =>
      listMemoryEvents(
        deps,
        listMemoryEventsQuerySchema.parse({
          since: query.get("since") ?? undefined,
          limit: query.get("limit") ?? undefined
        })
      )
  }),
  route({
    method: "GET",
    pattern: "/api/memory/settings",
    call: async ({ deps }) => ({ settings: await readMemorySettings(deps) })
  }),
  route({
    method: "PUT",
    pattern: "/api/memory/settings",
    schema: putMemorySettingsSchema,
    call: async ({ deps, input }) => ({ settings: await writeMemorySettings(deps, input) })
  }),

  // —— Learner memory (MEM-2 tiers) — the SAME service fns + schemas the routes wrap ——
  route({
    method: "POST",
    pattern: "/api/memory/consolidate",
    call: async ({ deps }) => ({ consolidated: await consolidateMemory(deps) })
  }),
  route({
    method: "GET",
    pattern: "/api/memory/digests",
    call: ({ deps, query }) =>
      listMemoryDigests(
        deps,
        listMemoryDigestsQuerySchema.parse({ dimension: query.get("dimension") ?? undefined })
      )
  }),
  route({
    method: "GET",
    pattern: "/api/memory/profile",
    call: ({ deps }) => getMemoryProfile(deps)
  }),
  route({
    method: "PUT",
    pattern: "/api/memory/profile",
    // No `schema` here ON PURPOSE (the events-POST idiom): writeMemoryProfileOverrides
    // parses the SAME exported putMemoryProfileSchema internally — one source of truth.
    call: async ({ deps, body }) => ({ overrides: await writeMemoryProfileOverrides(deps, body) })
  }),
  route({
    method: "DELETE",
    pattern: "/api/memory",
    call: ({ deps }) => clearMemory(deps)
  }),

  // —— Review schedule (REV-3 SRS) — the same service fns + schema the routes wrap ——
  route({
    method: "GET",
    pattern: "/api/review/schedule",
    call: async ({ deps }) => ({ schedule: await reviewScheduleService.readReviewSchedule(deps) })
  }),
  route({
    method: "POST",
    pattern: "/api/review/grade",
    // No `schema` here ON PURPOSE (the events-POST idiom): recordReviewGrade parses
    // the SAME exported recordReviewGradeSchema internally — one source of truth.
    call: ({ deps, body }) => reviewScheduleService.recordReviewGrade(deps, body)
  }),

  // —— Triggers (PRO-1) — parity with GET /api/triggers so a direct-transport host
  // (mobile) reads the SAME proactive-learning definition list the client tick evaluates. ——
  route({
    method: "GET",
    pattern: "/api/triggers",
    call: async ({ deps }) => ({ triggers: await deps.vault.stores.triggers.list() })
  }),
  // Trigger FIRE STATE (raw JSON) — parity with the fire/snooze/dismiss + read-back
  // routes so mobile records surfaces + restraint identically (delta #2/#1).
  route({
    method: "GET",
    pattern: "/api/triggers/fires",
    call: async ({ deps }) => ({ fires: await triggerFiresService.readTriggerFires(deps) })
  }),
  route({
    method: "POST",
    pattern: "/api/triggers/:triggerId/fire",
    schema: triggerFiresService.recordFireSchema,
    call: async ({ deps, params, input }) => ({
      state: await triggerFiresService.recordTriggerFire(deps, { triggerId: params.triggerId, ...input })
    })
  }),
  route({
    method: "POST",
    pattern: "/api/triggers/:triggerId/snooze",
    schema: triggerFiresService.snoozeSchema,
    call: async ({ deps, params, input }) => ({
      state: await triggerFiresService.snoozeTrigger(deps, { triggerId: params.triggerId, ...input })
    })
  }),
  route({
    method: "POST",
    pattern: "/api/triggers/:triggerId/dismiss",
    call: async ({ deps, params }) => ({
      state: await triggerFiresService.dismissTrigger(deps, { triggerId: params.triggerId })
    })
  }),

  // —— Concept graph (CG-1) — parity with GET /api/graph so mobile assembles the
  // SAME derived graph (same query schema, same service). ——
  route({
    method: "GET",
    pattern: "/api/graph",
    call: ({ deps, query }) =>
      graphService.getConceptGraph(deps, {
        ...graphService.graphQuerySchema.parse({
          conceptId: query.get("conceptId") ?? undefined,
          depth: query.get("depth") ?? undefined,
          sourceId: query.get("sourceId") ?? undefined
        })
      })
  }),

  // —— Concepts — parity with the /api/concepts routes so mobile authors + inspects
  // concepts identically (same schemas, same detail/delete/merge bodies). ——
  route({
    method: "GET",
    pattern: "/api/concepts",
    call: async ({ deps }) => ({ concepts: await deps.vault.stores.concepts.list() })
  }),
  route({
    method: "POST",
    pattern: "/api/concepts",
    schema: conceptsService.createConceptRequestSchema,
    call: async ({ deps, input }) => ({ concept: await conceptsService.createConcept({ vault: deps.vault }, input) })
  }),
  route({
    method: "GET",
    pattern: "/api/concepts/:conceptId",
    call: ({ deps, params }) => conceptsService.getConceptDetail({ vault: deps.vault }, { conceptId: params.conceptId })
  }),
  route({
    method: "DELETE",
    pattern: "/api/concepts/:conceptId",
    call: ({ deps, params }) => conceptsService.deleteConcept({ vault: deps.vault }, { conceptId: params.conceptId })
  }),
  route({
    method: "POST",
    pattern: "/api/concepts/:conceptId/merge",
    schema: conceptsService.mergeConceptRequestSchema,
    call: ({ deps, params, input }) =>
      conceptsService.mergeConcept({ vault: deps.vault }, { conceptId: params.conceptId, ...input })
  }),

  // —— Relations — parity with the /api/relations routes (same schema, same 404 on
  // an unknown delete). ——
  route({
    method: "GET",
    pattern: "/api/relations",
    call: async ({ deps }) => ({ relations: await deps.vault.stores.relations.list() })
  }),
  route({
    method: "POST",
    pattern: "/api/relations",
    schema: conceptsService.createRelationRequestSchema,
    call: async ({ deps, input }) => ({ relation: await conceptsService.createRelation({ vault: deps.vault }, input) })
  }),
  route({
    method: "DELETE",
    pattern: "/api/relations/:relationId",
    call: async ({ deps, params }) => {
      const removed = await deps.vault.stores.relations.delete(params.relationId);
      if (!removed) throw new NotFoundError("Relation not found");
      return { ok: true };
    }
  }),

  // —— Operations (custom AI actions as data) — the DATA lifecycle (not the AI run
  // lane) rides the transport; parity with the /api/operations routes. ——
  route({
    method: "GET",
    pattern: "/api/operations",
    call: async ({ deps }) => ({ operations: await deps.vault.stores.operations.list() })
  }),
  route({
    method: "POST",
    pattern: "/api/operations",
    schema: operationsService.createOperationRequestSchema,
    call: async ({ deps, input }) => ({
      operation: await operationsService.createOperation({ vault: deps.vault }, input)
    })
  }),
  route({
    method: "GET",
    pattern: "/api/operations/:operationId",
    call: async ({ deps, params }) => {
      const operation = await deps.vault.stores.operations.get(params.operationId);
      if (!operation) throw new NotFoundError("Operation not found");
      return { operation };
    }
  }),
  route({
    method: "PATCH",
    pattern: "/api/operations/:operationId",
    schema: operationsService.updateOperationRequestSchema,
    call: async ({ deps, params, input }) => ({
      operation: await operationsService.updateOperation(
        { vault: deps.vault },
        { operationId: params.operationId, ...input }
      )
    })
  }),
  route({
    method: "DELETE",
    pattern: "/api/operations/:operationId",
    call: async ({ deps, params }) => {
      const removed = await deps.vault.stores.operations.delete(params.operationId);
      if (!removed) throw new NotFoundError("Operation not found");
      return { ok: true };
    }
  }),

  // —— Operation prefs (ordering / enable-disable / built-in placeholder params) ——
  route({
    method: "GET",
    pattern: "/api/operation-prefs",
    call: async ({ deps }) => ({ prefs: await workspaceService.readOperationPrefs({ vault: deps.vault }) })
  }),
  route({
    method: "PUT",
    pattern: "/api/operation-prefs",
    schema: workspaceService.operationPrefsSchema,
    call: async ({ deps, input }) => ({
      prefs: await workspaceService.writeOperationPrefs({ vault: deps.vault }, input)
    })
  }),

  // —— Plugin prefs (Kit & Plugin: disabled contributions + viewer pins + M1 market
  // install state). Field-group ownership preserved by the SAME service writers. ——
  route({
    method: "GET",
    pattern: "/api/plugin-prefs",
    call: async ({ deps }) => ({ prefs: await workspaceService.readPluginPrefs({ vault: deps.vault }) })
  }),
  route({
    method: "PUT",
    pattern: "/api/plugin-prefs",
    schema: workspaceService.pluginPrefsSchema,
    call: async ({ deps, input }) => ({
      prefs: await workspaceService.writePluginPanelPrefs({ vault: deps.vault }, input)
    })
  }),
  route({
    method: "PUT",
    pattern: "/api/plugin-prefs/catalog",
    schema: z.object({
      catalogState: workspaceService.catalogStateSchema,
      userKits: z.array(workspaceService.userKitSchema).optional()
    }),
    call: async ({ deps, input }) => ({
      prefs: await workspaceService.writePluginCatalogPrefs({ vault: deps.vault }, input)
    })
  }),

  // —— Workspace layout + onboarding + ui-prefs (three field groups, three seams). ——
  route({
    method: "GET",
    pattern: "/api/workspace",
    call: async ({ deps }) => ({ workspace: await workspaceService.readWorkspace({ vault: deps.vault }) })
  }),
  route({
    method: "PUT",
    pattern: "/api/workspace",
    schema: workspaceService.workspaceStateSchema,
    call: async ({ deps, input }) => ({
      workspace: await workspaceService.writeWorkspaceLayout({ vault: deps.vault }, input)
    })
  }),
  route({
    method: "GET",
    pattern: "/api/workspace/onboarding",
    call: async ({ deps }) => ({ onboarding: await workspaceService.readWorkspaceOnboarding({ vault: deps.vault }) })
  }),
  route({
    method: "PUT",
    pattern: "/api/workspace/onboarding",
    schema: workspaceService.onboardingStateSchema,
    call: async ({ deps, input }) => ({
      onboarding: await workspaceService.writeWorkspaceOnboarding({ vault: deps.vault }, input)
    })
  }),
  route({
    method: "GET",
    pattern: "/api/workspace/ui-prefs",
    call: async ({ deps }) => ({ prefs: await workspaceService.readWorkspaceUiPrefs({ vault: deps.vault }) })
  }),
  route({
    method: "PUT",
    pattern: "/api/workspace/ui-prefs",
    schema: workspaceService.uiPrefsSchema,
    call: async ({ deps, input }) => ({
      prefs: await workspaceService.writeWorkspaceUiPrefs({ vault: deps.vault }, input)
    })
  }),

  // —— Study Layers (create custom / delete / export studypack / import preview+commit).
  // The GET list + PATCH already ride the transport above; these round out the CRUD. ——
  route({
    method: "POST",
    pattern: "/api/sources/:sourceId/layers",
    schema: layersService.createLayerRequestSchema,
    call: async ({ deps, params, input }) => ({
      layer: await layersService.createLayer({ vault: deps.vault }, { sourceId: params.sourceId, ...input })
    })
  }),
  route({
    method: "DELETE",
    pattern: "/api/layers/:layerId",
    call: async ({ deps, params }) => {
      await layersService.deleteLayer(deps, { layerId: params.layerId });
      return { ok: true };
    }
  }),
  // Mirrors app.ts exactly: the body is { pack, refusedCount: pack.refusedCount }.
  route({
    method: "POST",
    pattern: "/api/layers/:layerId/export",
    call: async ({ deps, params }) => {
      const pack = await layersService.exportLayer(deps, { layerId: params.layerId });
      return { pack, refusedCount: pack.refusedCount };
    }
  }),
  route({
    method: "POST",
    pattern: "/api/layers/import/preview",
    schema: z.object({ pack: z.unknown() }),
    call: async ({ deps, input }) => ({
      preview: await layersService.previewLayerImport({ vault: deps.vault }, { pack: input.pack })
    })
  }),
  route({
    method: "POST",
    pattern: "/api/layers/import/commit",
    schema: z.object({ pack: z.unknown(), targetSourceId: z.string().min(1).optional() }),
    call: async ({ deps, input }) => ({
      result: await layersService.commitLayerImport({ vault: deps.vault }, input)
    })
  }),

  // —— Assets (chat-image lane) — base64 import (with the MAX_INLINE_IMAGE_BYTES cap,
  // mirrored byte-for-byte from POST /api/assets) + the meta read. The raw BYTE route
  // (GET /api/assets/:id) stays HTTP-only (streaming/Range) — see the unrouted note. ——
  route({
    method: "POST",
    pattern: "/api/assets",
    schema: z.object({
      dataBase64: z.string().min(1),
      mimeType: z.string().min(1),
      fileName: z.string().min(1).optional()
    }),
    // The size cap runs on the DECODED byte length BEFORE writing, exactly like app.ts
    // (an oversize paste 400s via the SAME ValidationError → ApiError(400) mapping).
    call: async ({ deps, input }) => {
      const byteLength = Buffer.byteLength(input.dataBase64, "base64");
      if (byteLength > MAX_INLINE_IMAGE_BYTES) {
        throw new ValidationError(`Image too large (max ${MAX_INLINE_IMAGE_BYTES} bytes).`);
      }
      const asset = await importAssetBytes(deps.vault, input);
      return { assetId: asset.id, asset };
    }
  }),
  route({
    method: "GET",
    pattern: "/api/assets/:assetId/meta",
    call: async ({ deps, params }) => {
      const asset = await deps.vault.stores.assets.get(params.assetId);
      if (!asset) throw new NotFoundError("Asset not found");
      return { asset };
    }
  }),

  // —— Protected sharing (.svpack) — the two routes that need NO identityDir/crypto:
  // the installed-pack manager list (over the sealed runtime) + delete-the-blob. The
  // export/inspect/open/commit/identity crypto family stays unrouted (see the note). ——
  route({
    method: "GET",
    pattern: "/api/svpack",
    call: async ({ deps }) => {
      deps.sealed.refresh();
      return { packs: deps.sealed.snapshot().meta };
    }
  }),
  route({
    method: "DELETE",
    pattern: "/api/svpack/:packId",
    call: async ({ deps, params }) => {
      const removed = deleteSealed(sealedImportsDir(deps.vault.paths.rootDir), params.packId);
      if (!removed) throw new NotFoundError("Sealed pack not found");
      deps.sealed.refresh();
      return { ok: true };
    }
  }),

  // —— App-shell readouts (SHELL-1) — GET /api/about (id + version + packaged flag)
  // and GET /api/vault (manifest + root path). isPackaged is NOT reachable in-process
  // (no aiConfig/isPackaged option on the direct host) → mirror the createApp default
  // `isPackaged === true` ⇒ false, which is also the web/dev/CLI value. ——
  route({
    method: "GET",
    pattern: "/api/about",
    call: async () => ({ app: "ai-study-vault", version: packageJson.version, isPackaged: false })
  }),
  route({
    method: "GET",
    pattern: "/api/vault",
    call: async ({ deps }) => ({
      manifest: deps.vault.manifest,
      paths: { rootDir: deps.vault.paths.rootDir }
    })
  })
];

/** Build the in-process transport over an open vault + sealed runtime. */
export function createDirectTransport(deps: DirectTransportDeps): VaultTransport {
  return {
    async request<T>(method: string, path: string, body?: unknown): Promise<T> {
      const verb = method.toUpperCase();
      // Dummy base: entityClient paths are origin-relative ("/api/…?query").
      const url = new URL(path, "http://direct.local");
      for (const entry of routes) {
        if (entry.method !== verb) continue;
        const params = matchPattern(entry.pattern, url.pathname);
        if (params === null) continue;
        const ctx: BaseCtx = { deps, params, query: url.searchParams, body };
        try {
          entry.guard?.(ctx);
          const input = entry.schema ? entry.schema.parse(body) : undefined;
          return (await entry.call({ ...ctx, input })) as T;
        } catch (error) {
          throw toApiError(error, path);
        }
      }
      throw new DirectTransportUnsupportedError(verb, path);
    }
  };
}
