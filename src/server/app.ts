import path from "node:path";
import express from "express";
import { z } from "zod";
import { ingestWebpageFromUrl } from "../adapters/web/ingest";
import { ingestWebLiveSource } from "../adapters/web/liveSource";
import { importLocalAsset } from "../core/store/assets";
import { parseRange } from "./httpRange";
import { createReadStream } from "node:fs";
import { defaultIdentityDir } from "../core/identity/paths";
import { createSealedRuntime, registerSvpackRoutes, type SealedRuntime } from "./svpack";
import { registerMemoryRoutes } from "./memory";
import { registerAgentRoutes } from "./agent";
import type { StudyVault } from "../core/vault";
import { deleteSource, listSources } from "../core/store/sources";
import { handleServiceError } from "./services/errors";
import * as sourcesService from "./services/sources";
import * as anchorsService from "./services/anchors";
import * as notesService from "./services/notes";
import * as layersService from "./services/layers";
import * as conceptsService from "./services/concepts";
import * as operationsService from "./services/operations";
import * as patchesService from "./services/patches";
import * as assetsService from "./services/assets";
import * as workspaceService from "./services/workspace";
import * as aiService from "./services/ai";
import { chatRequestSchema, createModelProvider, type ModelProvider } from "../ai";
import { installServerKits } from "../kits/server";
import { StructuredGenerationError } from "../kits/structured";
import { readFile } from "node:fs/promises";
import { ingestLocalFile, listDirectory, mimeForPath } from "./localFiles";
import { importXmindToMarkmap } from "./xmindImport";

// Register Product Kit content specs + prompts (React-free) so the API validates
// kit note content and can run kit structured generation. Idempotent.
installServerKits();

export type CreateAppOptions = {
  vault: StudyVault;
  modelProvider?: ModelProvider;
  /** When set, serve the built client (with SPA fallback) from this directory. */
  clientDir?: string;
  /**
   * Directory holding the device/publisher keys, pinned publishers, and the clock
   * high-water-mark (svpack §5.1/§7.1/§8.1). Defaults to ~/.growte/identity; tests
   * MUST inject a temp dir. Only ever created/written when svpack features are used.
   */
  identityDir?: string;
  /** Injectable wall clock for the svpack validity gates (tests fake expiry/rollback). */
  now?: () => number;
};

const ingestUrlRequestSchema = z.object({
  url: z.string().url()
});

export function createApp({ vault, modelProvider, clientDir, identityDir, now }: CreateAppOptions) {
  const app = express();
  const provider = modelProvider ?? createModelProvider();

  // Protected-pack (.svpack) plumbing: unseal any committed packs ONCE at app start
  // (the §8.1 per-session validity gate) into an in-memory cache that the read
  // endpoints below merge, flagged `sealed: true`. Refreshed after commit/delete/renew.
  const svpackIdentityDir = identityDir ?? defaultIdentityDir();
  const clock = now ?? (() => Date.now());
  const sealed: SealedRuntime = createSealedRuntime({ vault, identityDir: svpackIdentityDir, now: clock });

  app.use(express.json({ limit: "50mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, app: "ai-study-vault" });
  });

  app.get("/api/vault", (_req, res) => {
    res.json({
      manifest: vault.manifest,
      paths: {
        rootDir: vault.paths.rootDir
      }
    });
  });

  app.get("/api/sources", async (_req, res, next) => {
    try {
      res.json({ sources: await listSources(vault) });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/sources/:sourceId", async (req, res, next) => {
    try {
      const removed = await deleteSource(vault, req.params.sourceId);
      if (!removed) {
        res.status(404).json({ error: "Source not found" });
        return;
      }
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  // Merge-patch a source's metadata (Product Kit activation writes metadata.activeKitIds).
  app.patch("/api/sources/:sourceId", async (req, res, next) => {
    try {
      const input = sourcesService.updateSourceRequestSchema.parse(req.body);
      const source = await sourcesService.updateSourceMetadata({ vault }, { sourceId: req.params.sourceId, ...input });
      res.json({ source });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  app.post("/api/sources/html", async (req, res, next) => {
    try {
      const input = sourcesService.ingestHtmlRequestSchema.parse(req.body);
      res.status(201).json(await sourcesService.ingestHtml({ vault }, input));
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  app.post("/api/sources/url", async (req, res, next) => {
    try {
      const input = ingestUrlRequestSchema.parse(req.body);
      const { source, injected } = await ingestWebpageFromUrl(vault, input.url);
      res.status(201).json({ source, injected });
    } catch (error) {
      next(error);
    }
  });

  // Open a URL for LIVE annotation (Electron webview), not a frozen snapshot.
  app.post("/api/sources/web-live", async (req, res, next) => {
    try {
      const input = ingestUrlRequestSchema.parse(req.body);
      const source = await ingestWebLiveSource(vault, input.url);
      res.status(201).json({ source });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/sources/pdf", async (req, res, next) => {
    try {
      const input = sourcesService.ingestPdfRequestSchema.parse(req.body);
      const source = await sourcesService.ingestPdf({ vault }, input);
      res.status(201).json({ source });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // Seed an image source from base64 bytes (used by tests / programmatic import).
  // Images render in the host-page ImageReader so a region can be marked on them.
  app.post("/api/sources/image", async (req, res, next) => {
    try {
      const input = sourcesService.ingestImageRequestSchema.parse(req.body);
      const source = await sourcesService.ingestImage({ vault }, input);
      res.status(201).json({ source });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // Desktop: serve any local file straight from disk, mirroring its absolute path
  // in the URL so a local HTML page's relative assets (css/js/images/fonts) resolve
  // against the same directory. Rendered inside a sandboxed iframe on the client, so
  // the page can't reach the host app (this is what stops the recursive nesting that
  // srcDoc rendering caused). CORS is open so sandboxed (null-origin) sub-resources load.
  app.get(/^\/api\/local\/(.+)/, async (req, res, next) => {
    try {
      const absPath = decodeURIComponent((req.params as Record<string, string>)[0]);
      const data = await readFile(absPath);
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.type(mimeForPath(absPath)).send(data);
    } catch (error) {
      next(error);
    }
  });

  // Desktop file browser: list a directory's immediate children (lazy tree expand).
  app.get("/api/fs/list", async (req, res, next) => {
    try {
      const dir = z.string().min(1).parse(req.query.path);
      res.json(await listDirectory(dir));
    } catch (error) {
      next(error);
    }
  });

  // Desktop: ingest a file the user picked (native dialog) or clicked in the tree.
  // The server reads it straight off disk by absolute path.
  app.post("/api/sources/local-file", async (req, res, next) => {
    try {
      const { path: filePath } = z.object({ path: z.string().min(1) }).parse(req.body);
      const source = await ingestLocalFile(vault, filePath);
      res.status(201).json({ source });
    } catch (error) {
      next(error);
    }
  });

  // Serve the raw stored bytes (used by the PDF reader and any binary source).
  app.get("/api/sources/:sourceId/file", async (req, res, next) => {
    try {
      const { source, data } = await sourcesService.readSourceFileById({ vault }, { sourceId: req.params.sourceId });
      res.type(source.mimeType ?? "application/octet-stream").send(data);
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  app.get("/api/sources/:sourceId/content", async (req, res, next) => {
    try {
      const { source, content } = await sourcesService.readSourceContentById({ vault }, { sourceId: req.params.sourceId });
      res.type(source.mimeType ?? "text/plain").send(content);
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  app.get("/api/sources/:sourceId/rendered", async (req, res, next) => {
    try {
      res.json(await sourcesService.renderSource({ vault }, { sourceId: req.params.sourceId }));
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  app.post("/api/anchors", async (req, res, next) => {
    try {
      const input = anchorsService.createAnchorRequestSchema.parse(req.body);
      const anchor = await anchorsService.createAnchor({ vault }, input);
      res.status(201).json({ anchor });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // Derived anchor painting + orphan prune + svpack read-model merge — see the service.
  app.get("/api/sources/:sourceId/anchors", async (req, res, next) => {
    try {
      const anchors = await anchorsService.listSourceAnchors({ vault, sealed }, { sourceId: req.params.sourceId });
      res.json({ anchors });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  app.post("/api/notes", async (req, res, next) => {
    try {
      const input = notesService.createNoteRequestSchema.parse(req.body);
      const note = await notesService.createNote({ vault }, input);
      res.status(201).json({ note });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // .xmind import (adaptive-note-forms Phase 4 item 3): read a local .xmind off disk,
  // unzip + parse it (content.json primary, content.xml fallback), and convert to a
  // `markmap` markdown OUTLINE — NO new contentType, NO new renderer. The client
  // creates a real `markmap` note from `{ contentType, content }`, so it renders via
  // the existing markmap plugin (getNoteType("markmap").render). The model/format
  // resolution stays on the recognized-form side: the returned contentType is the
  // already-registered `markmap`.
  app.post("/api/notes/import-xmind", async (req, res, next) => {
    try {
      const { path: filePath } = z.object({ path: z.string().min(1) }).parse(req.body);
      const { outline } = await importXmindToMarkmap(filePath);
      res.status(200).json({ contentType: "markmap", content: outline });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/sources/:sourceId/notes", async (req, res, next) => {
    try {
      const notes = await notesService.listNotes(
        { vault, sealed },
        {
          sourceId: req.params.sourceId,
          enabledLayerIds: typeof req.query.enabledLayerIds === "string" ? req.query.enabledLayerIds : undefined
        }
      );
      res.json({ notes });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // Entity-oriented note query: filter by concept and/or anchor (a note can hang
  // off several of each). With no filter, returns all notes.
  app.get("/api/notes", async (req, res, next) => {
    try {
      const notes = await notesService.listNotes(
        { vault, sealed },
        {
          conceptId: typeof req.query.conceptId === "string" ? req.query.conceptId : undefined,
          anchorId: typeof req.query.anchorId === "string" ? req.query.anchorId : undefined,
          sourceId: typeof req.query.sourceId === "string" ? req.query.sourceId : undefined,
          enabledLayerIds: typeof req.query.enabledLayerIds === "string" ? req.query.enabledLayerIds : undefined
        }
      );
      res.json({ notes });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // Patch a note's attachments (concept/anchor/layer links) AND/OR its CONTENT. The
  // manual concept UI uses this to link an EXISTING note to a concept (its conceptIds
  // gain the concept id), so the note then back-references in `GET /api/concepts/:id`.
  // The note-edit UI uses `content` to rewrite the note in place — re-validated here
  // against the note's OWN contentType spec (same gate as create), so an invalid shape
  // is rejected 400 and never persisted. The contentType is FIXED on edit. Unknown
  // note id → 404.
  app.patch("/api/notes/:noteId", async (req, res, next) => {
    try {
      // Sealed guard runs BEFORE body validation (403 wins over 400), as before.
      notesService.assertNoteWritable({ sealed }, req.params.noteId);
      const input = notesService.updateNoteRequestSchema.parse(req.body);
      const note = await notesService.updateNote({ vault, sealed }, { noteId: req.params.noteId, ...input });
      res.json({ note });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // Delete a note (200 {ok:true} / 404) with the orphan-anchor cascade — see service.
  app.delete("/api/notes/:noteId", async (req, res, next) => {
    try {
      await notesService.deleteNote({ vault, sealed }, { noteId: req.params.noteId });
      res.json({ ok: true });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // —— Study Layers (a per-source lens axis: owned + preset stages + custom + imported) ——
  // Lazy owned-layer + kit-seeded preset-stage creation (F7a) + sealed merge — see service.
  app.get("/api/sources/:sourceId/layers", async (req, res, next) => {
    try {
      const layers = await layersService.listSourceLayers({ vault, sealed }, { sourceId: req.params.sourceId });
      res.json({ layers });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // Create a user-defined ("custom") layer over a source — backs the layer manager.
  app.post("/api/sources/:sourceId/layers", async (req, res, next) => {
    try {
      const input = layersService.createLayerRequestSchema.parse(req.body);
      const layer = await layersService.createLayer({ vault }, { sourceId: req.params.sourceId, ...input });
      res.status(201).json({ layer });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // Toggle a layer on/off (enabled, reused as the filter include/exclude), rename it,
  // or set its presentation fields (color/order) for the manager.
  app.patch("/api/layers/:layerId", async (req, res, next) => {
    try {
      // Sealed guard runs BEFORE body validation (403 wins over 400), as before.
      layersService.assertLayerWritable({ sealed }, req.params.layerId);
      const input = layersService.updateLayerRequestSchema.parse(req.body);
      const layer = await layersService.updateLayer({ vault, sealed }, { layerId: req.params.layerId, ...input });
      res.json({ layer });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // Delete a CUSTOM layer (409 for structural roles; cascade-strips note memberships).
  app.delete("/api/layers/:layerId", async (req, res, next) => {
    try {
      await layersService.deleteLayer({ vault, sealed }, { layerId: req.params.layerId });
      res.json({ ok: true });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // Export a layer as a portable `.studypack` (local realizations stripped).
  app.post("/api/layers/:layerId/export", async (req, res, next) => {
    try {
      const pack = await layersService.exportLayer({ vault, sealed }, { layerId: req.params.layerId });
      res.json({ pack, refusedCount: pack.refusedCount });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // Protected `.svpack` endpoints (export-svpack / renew / inspect / open / commit /
  // list / delete) — see src/server/svpack.ts and docs/design/studypack-sharing.md.
  registerSvpackRoutes(app, { vault, identityDir: svpackIdentityDir, now: clock, runtime: sealed });

  // Learner-memory MEM-1 (docs/design/learner-memory.md): event capture/read/prune +
  // the vault-level capture switch — see src/server/memory.ts.
  registerMemoryRoutes(app, { vault, now: clock });

  // Agent loop A4a (docs/design/multi-provider-ai-agent.md §4.1(2)/§4.3): the
  // /api/agent/stream SSE route + read-only vault tool registration — src/server/agent.ts.
  registerAgentRoutes(app, { vault, provider });

  // Preview an import: match the pack to a local source + rematch every anchor.
  // Does NOT persist anything.
  app.post("/api/layers/import/preview", async (req, res, next) => {
    try {
      const body = z.object({ pack: z.unknown() }).parse(req.body);
      res.json({ preview: await layersService.previewLayerImport({ vault }, { pack: body.pack }) });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // Commit an import: create an imported layer + re-located anchors + notes.
  app.post("/api/layers/import/commit", async (req, res, next) => {
    try {
      const body = z.object({ pack: z.unknown(), targetSourceId: z.string().min(1).optional() }).parse(req.body);
      const result = await layersService.commitLayerImport({ vault }, body);
      res.status(201).json({ result });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // —— Assets ——————————————————————————————————————————————————————————
  // Desktop: import a local file the user picked, copying it into the vault.
  app.post("/api/assets/local-file", async (req, res, next) => {
    try {
      const { path: filePath } = z.object({ path: z.string().min(1) }).parse(req.body);
      const asset = await importLocalAsset(vault, filePath, { mimeType: mimeForPath(filePath) });
      res.status(201).json({ asset });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/assets/:assetId/meta", async (req, res, next) => {
    try {
      const asset = await vault.stores.assets.get(req.params.assetId);
      if (!asset) {
        res.status(404).json({ error: "Asset not found" });
        return;
      }
      res.json({ asset });
    } catch (error) {
      next(error);
    }
  });

  // Serve asset bytes with HTTP Range support (design plan §4 Phase 2 / §6 #4). We
  // STREAM the file from disk (constant memory) and honor a single-range `Range`
  // header so <video> can seek + progressively load long local files:
  //   • no/malformed/multi/inverted Range → 200 full stream (Accept-Ranges: bytes).
  //   • bytes=START-END / START- / -SUFFIX → 206 with Content-Range + sliced length.
  //   • a syntactically valid range past EOF → 416 with `Content-Range: bytes */total`.
  app.get("/api/assets/:assetId", async (req, res, next) => {
    try {
      const { asset, filePath, size: total } = await assetsService.getAssetFile(
        { vault },
        { assetId: req.params.assetId }
      );

      res.type(asset.mimeType);
      res.setHeader("Accept-Ranges", "bytes");

      const range = parseRange(req.headers.range, total);

      if (range.kind === "unsatisfiable") {
        res.status(416).setHeader("Content-Range", `bytes */${total}`);
        res.end();
        return;
      }

      if (range.kind === "satisfiable") {
        const { start, end } = range;
        res.status(206);
        res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
        res.setHeader("Content-Length", String(end - start + 1));
        const stream = createReadStream(filePath, { start, end });
        stream.on("error", next);
        stream.pipe(res);
        return;
      }

      // No (usable) Range → full 200, streamed (not buffered into memory).
      res.status(200);
      res.setHeader("Content-Length", String(total));
      const stream = createReadStream(filePath);
      stream.on("error", next);
      stream.pipe(res);
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // —— Concepts ————————————————————————————————————————————————————————
  app.get("/api/concepts", async (_req, res, next) => {
    try {
      res.json({ concepts: await vault.stores.concepts.list() });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/concepts", async (req, res, next) => {
    try {
      const input = conceptsService.createConceptRequestSchema.parse(req.body);
      const concept = await conceptsService.createConcept({ vault }, input);
      res.status(201).json({ concept });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // Concept detail with back-references: which notes link it and which relations touch it.
  app.get("/api/concepts/:conceptId", async (req, res, next) => {
    try {
      res.json(await conceptsService.getConceptDetail({ vault }, { conceptId: req.params.conceptId }));
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // —— Relations ———————————————————————————————————————————————————————
  app.get("/api/relations", async (_req, res, next) => {
    try {
      res.json({ relations: await vault.stores.relations.list() });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/relations", async (req, res, next) => {
    try {
      const input = conceptsService.createRelationRequestSchema.parse(req.body);
      const relation = await conceptsService.createRelation({ vault }, input);
      res.status(201).json({ relation });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  app.delete("/api/relations/:relationId", async (req, res, next) => {
    try {
      const removed = await vault.stores.relations.delete(req.params.relationId);
      if (!removed) {
        res.status(404).json({ error: "Relation not found" });
        return;
      }
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  // —— Operations (custom AI actions authored as data) —————————————————
  app.get("/api/operations", async (_req, res, next) => {
    try {
      res.json({ operations: await vault.stores.operations.list() });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/operations", async (req, res, next) => {
    try {
      const input = operationsService.createOperationRequestSchema.parse(req.body);
      const operation = await operationsService.createOperation({ vault }, input);
      res.status(201).json({ operation });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  app.get("/api/operations/:operationId", async (req, res, next) => {
    try {
      const operation = await vault.stores.operations.get(req.params.operationId);
      if (!operation) {
        res.status(404).json({ error: "Operation not found" });
        return;
      }
      res.json({ operation });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/operations/:operationId", async (req, res, next) => {
    try {
      const input = operationsService.updateOperationRequestSchema.parse(req.body);
      const operation = await operationsService.updateOperation(
        { vault },
        { operationId: req.params.operationId, ...input }
      );
      res.json({ operation });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  app.delete("/api/operations/:operationId", async (req, res, next) => {
    try {
      const removed = await vault.stores.operations.delete(req.params.operationId);
      if (!removed) {
        res.status(404).json({ error: "Operation not found" });
        return;
      }
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  // —— Operation prefs (ordering / enable-disable / built-in placeholder params) ——
  app.get("/api/operation-prefs", async (_req, res, next) => {
    try {
      res.json({ prefs: await workspaceService.readOperationPrefs({ vault }) });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  app.put("/api/operation-prefs", async (req, res, next) => {
    try {
      const prefs = workspaceService.operationPrefsSchema.parse(req.body);
      res.json({ prefs: await workspaceService.writeOperationPrefs({ vault }, prefs) });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // —— Plugin prefs (Kit & Plugin: disabled contributions + declared viewer/userKit slots) ——
  app.get("/api/plugin-prefs", async (_req, res, next) => {
    try {
      res.json({ prefs: await workspaceService.readPluginPrefs({ vault }) });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  app.put("/api/plugin-prefs", async (req, res, next) => {
    try {
      const prefs = workspaceService.pluginPrefsSchema.parse(req.body);
      res.json({ prefs: await workspaceService.writePluginPrefs({ vault }, prefs) });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // —— Workspace layout (UI state) —————————————————————————————————————
  app.get("/api/workspace", async (_req, res, next) => {
    try {
      res.json({ workspace: await workspaceService.readWorkspace({ vault }) });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  app.put("/api/workspace", async (req, res, next) => {
    try {
      const state = workspaceService.workspaceStateSchema.parse(req.body);
      res.json({ workspace: await workspaceService.writeWorkspace({ vault }, state) });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  app.post("/api/patches", async (req, res, next) => {
    try {
      const input = patchesService.createPatchRequestSchema.parse(req.body);
      const patch = await patchesService.createPatch({ vault }, input);
      res.status(201).json({ patch });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  app.get("/api/sources/:sourceId/patches", async (req, res, next) => {
    try {
      const patches = (await vault.stores.patches.list()).filter((patch) => patch.sourceId === req.params.sourceId);
      res.json({ patches });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/patches/:patchId", async (req, res, next) => {
    try {
      const input = patchesService.updatePatchRequestSchema.parse(req.body);
      const patch = await patchesService.updatePatchStatus({ vault }, { patchId: req.params.patchId, ...input });
      res.json({ patch });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  app.post("/api/chat", async (req, res, next) => {
    try {
      const input = chatRequestSchema.parse(req.body);
      res.json(await aiService.chatComplete({ provider }, input));
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // Streaming chat over Server-Sent Events. Emits `chunk` events ({delta}) as the
  // reply is produced, then one `done` event ({message, provider}). Providers
  // without `stream()` fall back to a single chunk from `complete()` (inside the
  // service). Validation errors happen before any byte is written, so they still
  // surface as a 400. The SSE framing/accumulation is transport — it stays here.
  app.post("/api/chat/stream", async (req, res, next) => {
    let input: ReturnType<typeof chatRequestSchema.parse>;
    try {
      input = chatRequestSchema.parse(req.body);
    } catch (error) {
      next(error);
      return;
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    const send = (event: string, data: unknown) =>
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    try {
      let full = "";
      for await (const delta of aiService.streamChatDeltas({ provider }, input)) {
        full += delta;
        send("chunk", { delta });
      }
      send("done", { message: { role: "assistant", content: full }, provider: provider.id });
      res.end();
    } catch (error) {
      // Headers are already sent, so report the failure as a stream event.
      send("error", { error: error instanceof Error ? error.message : "stream failed" });
      res.end();
    }
  });

  // Product Kit structured generation: build the kit prompt, generate, validate
  // against the contentType's NoteContentSpec schema, return the parsed content.
  // Unknown prompt/contentType or unsatisfiable output → 400 (a client/AI problem,
  // not a server fault).
  app.post("/api/kits/generate", async (req, res, next) => {
    try {
      const input = aiService.kitGenerateSchema.parse(req.body);
      res.json(await aiService.generateKitContent({ vault, provider }, input));
    } catch (error) {
      if (error instanceof StructuredGenerationError) {
        res.status(400).json({ error: error.message });
        return;
      }
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // —— Adaptive note forms · Phase 4 ——————————————————————————————————————————
  // Form-router generation (model picks the form AND fills it) — see services/ai.ts.
  app.post("/api/notes/generate-block", async (req, res, next) => {
    try {
      const input = aiService.generateBlockSchema.parse(req.body);
      res.json(await aiService.generateBlock({ provider }, input));
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // AI-assisted classification — the low-confidence fallback behind the client's
  // resolveFormAsync (heuristic stays primary) — see services/ai.ts.
  app.post("/api/notes/classify", async (req, res, next) => {
    try {
      const input = aiService.generateBlockSchema.parse(req.body);
      res.json(await aiService.classifyText({ provider }, input));
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // Serve the built client so one origin hosts both API and UI (used by
  // `npm start` and the Electron shell). Registered after the API routes.
  if (clientDir) {
    app.use(express.static(clientDir));
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api/")) {
        next();
        return;
      }
      res.sendFile(path.join(clientDir, "index.html"));
    });
  }

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request", issues: error.issues });
      return;
    }

    const message = error instanceof Error ? error.message : "Unknown server error";
    res.status(500).json({ error: message });
  });

  return app;
}


