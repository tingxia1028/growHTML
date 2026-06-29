import path from "node:path";
import express from "express";
import { z } from "zod";
import { applyHtmlPatchWithGuard, createHtmlSelectionAnchor } from "../adapters/html/anchor";
import { injectStudyIds, materializeHtml } from "../adapters/html/core";
import { ingestWebpageFromUrl } from "../adapters/web/ingest";
import { ingestWebLiveSource } from "../adapters/web/liveSource";
import { createWebTextQuoteAnchor } from "../adapters/web/anchor";
import { createPdfSelectionAnchor } from "../adapters/pdf/anchor";
import { createImageRegionAnchor } from "../adapters/image/anchor";
import { createEntityId } from "../core/ids";
import {
  conceptSchema,
  nodeRefSchema,
  noteSchema,
  operationSchema,
  operationVariableSchema,
  patchActionSchema,
  patchSchema,
  relationKindSchema,
  relationSchema,
  sourceSchema,
  type AnchorRecord,
  type HtmlSelectionAnchor,
  type OperationRecord,
  type PatchRecord,
  type PatchStatus
} from "../core/schema";
import { extractVariables } from "../ai/template";
import { getNoteContentSpec, parseNoteContent } from "../core/notes/contentTypes";
import { assetBytesPath, importLocalAsset } from "../core/store/assets";
import { parseRange } from "./httpRange";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createCustomLayer, ensureOwnedLayer, ensurePresetLayers } from "../core/study-layer/layers";
import { studyLayerSchema } from "../core/schema";
import { buildStudyPack, commitImport, parseStudyPack, previewImport } from "./studyLayer";
import type { StudyVault } from "../core/vault";
import {
  deleteSource,
  ingestBinarySource,
  ingestHtmlSource,
  listSources,
  readSourceContent,
  readSourceFile
} from "../core/store/sources";
import {
  chatContextSchema,
  chatRequestSchema,
  createModelProvider,
  generateStructured,
  FORM_ROUTER_CONTENT_TYPE,
  type ModelProvider
} from "../ai";
import {
  formRouterSchema,
  routerOutputToNote,
  INLINE_HTML_INSTRUCTION,
  type FormRouterOutput
} from "../core/notes/formRouter";
import { installServerKits } from "../kits/server";
import { generateStructuredContent, StructuredGenerationError } from "../kits/structured";
import { readFile } from "node:fs/promises";
import { ingestLocalFile, listDirectory, mimeForPath } from "./localFiles";
import { importXmindToMarkmap } from "./xmindImport";

// Register Product Kit content specs + prompts (React-free) so the API validates
// kit note content and can run kit structured generation. Idempotent.
installServerKits();

// Body for POST /api/kits/generate — a kit AI command's structured request.
const kitGenerateSchema = z.object({
  promptId: z.string().min(1),
  contentType: z.string().min(1),
  input: z.record(z.string(), z.unknown()).optional()
});

// Body for POST /api/notes/generate-block — the form-router request (adaptive note
// forms §4 Phase 4 item 1). The model is given the user's text + optional study
// context and returns a discriminated-union member (formRouterSchema); the server
// unwraps it into a real { contentType, content }. An optional `sample` lets a caller
// force a deterministic form against the offline mock (the e2e seeds a markmap).
const generateBlockSchema = z.object({
  text: z.string().min(1),
  context: chatContextSchema.optional(),
  sample: z.unknown().optional()
});

export type CreateAppOptions = {
  vault: StudyVault;
  modelProvider?: ModelProvider;
  /** When set, serve the built client (with SPA fallback) from this directory. */
  clientDir?: string;
};

const ingestHtmlRequestSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1)
});

const ingestUrlRequestSchema = z.object({
  url: z.string().url()
});

const ingestPdfRequestSchema = z.object({
  title: z.string().min(1),
  dataBase64: z.string().min(1),
  // Absolute disk path of the picked file (desktop only), so the AI terminal can
  // default its working directory to the folder this file lives in.
  originalPath: z.string().min(1).optional()
});

const ingestImageRequestSchema = z.object({
  title: z.string().min(1),
  dataBase64: z.string().min(1),
  mimeType: z.string().min(1).default("image/png"),
  originalPath: z.string().min(1).optional()
});

const createAnchorRequestSchema = z
  .object({
    sourceId: z.string().min(1),
    anchorKind: z
      .enum(["html_selection", "web_text_quote", "pdf_selection", "image_region"])
      .default("html_selection"),
    studyId: z.string().min(1).optional(),
    selector: z.string().min(1).optional(),
    normalizedUrl: z.string().min(1).optional(),
    page: z.number().int().positive().optional(),
    // Geometric region [x, y, w, h] (0..1) for figures / scanned pages / images.
    rect: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
    // Quote is optional now: a region anchor has no text. Text kinds still require
    // a non-empty quote OR a rect (enforced below).
    quote: z.string().default(""),
    contextBefore: z.string().default(""),
    contextAfter: z.string().default("")
  })
  // An anchor must carry SOMETHING to locate it: a non-empty quote or a rect.
  .refine((input) => input.quote.trim().length > 0 || !!input.rect, {
    message: "anchor requires a non-empty quote or a rect"
  });

const createNoteRequestSchema = z.object({
  sourceId: z.string().min(1).optional(),
  anchorIds: z.array(z.string().min(1)).default([]),
  conceptIds: z.array(z.string().min(1)).default([]),
  // Study Layer membership (multi). When omitted, a source-attached note defaults to
  // that source's owned layer so it is never orphaned to invisibility (spec §5).
  layerIds: z.array(z.string().min(1)).optional(),
  contentType: z.string().min(1).default("markdown"),
  // Shape validated per-type by the NoteContentSpec, not here.
  content: z.unknown()
});

// Partial note update — attach/detach a note to concepts/anchors/layers after
// creation AND (since note-edit-delete V1) edit the note's CONTENT in place. When
// `content` is present it is re-validated against the note's own contentType spec
// (getNoteContentSpec(...).schema) before persisting, exactly like create — an
// unknown/invalid shape never reaches storage. The contentType itself is fixed on
// edit (editing content within the same type; changing type is out of scope).
// At least one field must be present.
const updateNoteRequestSchema = z
  .object({
    conceptIds: z.array(z.string().min(1)).optional(),
    anchorIds: z.array(z.string().min(1)).optional(),
    // Study Layer membership — add/remove/move a note between layers (the full set
    // replaces the note's current layerIds, spec §8).
    layerIds: z.array(z.string().min(1)).optional(),
    // The note's structured content, re-validated per-type at the handler (not here).
    content: z.unknown().optional()
  })
  .refine(
    (input) =>
      input.conceptIds !== undefined ||
      input.anchorIds !== undefined ||
      input.layerIds !== undefined ||
      input.content !== undefined,
    { message: "note update requires conceptIds, anchorIds, layerIds, or content" }
  );

const createPatchRequestSchema = z.object({
  sourceId: z.string().min(1),
  anchorId: z.string().min(1),
  action: patchActionSchema,
  oldText: z.string().default(""),
  newContent: z.string().min(1),
  summary: z.string().optional()
});

const updatePatchRequestSchema = z.object({
  status: z.enum(["pending", "accepted", "rejected", "applied", "reverted"])
});

const createConceptRequestSchema = z.object({
  name: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
  description: z.string().default(""),
  tags: z.array(z.string().min(1)).default([]),
  confidence: z.number().min(0).max(1).optional()
});

const createRelationRequestSchema = z.object({
  from: nodeRefSchema,
  to: nodeRefSchema,
  relationKind: relationKindSchema,
  label: z.string().optional(),
  confidence: z.number().min(0).max(1).optional()
});

// A custom AI Operation authored as DATA. POST creates from scratch (or from a
// "复制为我的插件" fork); PATCH merge-updates an existing one. The envelope fields
// (id/type/timestamps) are server-set, so the request shapes carry only the
// editable body.
const createOperationRequestSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  outputContentType: z.string().min(1),
  promptTemplate: z.string().min(1),
  declaredVariables: z.array(operationVariableSchema).default([]),
  source: z.enum(["custom", "fork"]).default("custom"),
  forkedFrom: z.string().optional(),
  scope: z.enum(["anchor", "source"]).default("anchor")
});
const updateOperationRequestSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    outputContentType: z.string().min(1).optional(),
    promptTemplate: z.string().min(1).optional(),
    declaredVariables: z.array(operationVariableSchema).optional(),
    source: z.enum(["custom", "fork"]).optional(),
    forkedFrom: z.string().optional(),
    scope: z.enum(["anchor", "source"]).optional()
  })
  .refine((input) => Object.keys(input).length > 0, { message: "operation update requires at least one field" });

// operation-prefs.json — a workspace-level small JSON file (same vault.storage
// pattern as workspace.json) holding the action ORDER + DISABLED set (built-in
// command ids + op_ ids) and per-built-in placeholder PARAMS the server merges
// into generate input before build().
const operationPrefsSchema = z.object({
  order: z.array(z.string()).default([]),
  disabled: z.array(z.string()).default([]),
  params: z.record(z.string(), z.record(z.string(), z.string())).default({})
});
const emptyOperationPrefs: z.infer<typeof operationPrefsSchema> = { order: [], disabled: [], params: {} };

// Workspace layout is UI state, not a core entity: stored as a single JSON file
// in the vault and validated only structurally.
const workspaceNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional()
});
const workspaceLayoutSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mode: z.enum(["dock", "canvas"]),
  nodes: z.array(workspaceNodeSchema),
  layout: z.unknown()
});
const workspaceStateSchema = z.object({
  activeLayoutId: z.string(),
  layouts: z.array(workspaceLayoutSchema)
});
const emptyWorkspaceState = { activeLayoutId: "", layouts: [] };

// `conflict` is system-set (never requested); other transitions follow a minimal state machine.
const patchTransitions: Record<PatchStatus, readonly PatchStatus[]> = {
  pending: ["accepted", "rejected", "applied"],
  accepted: ["applied", "rejected"],
  applied: ["reverted"],
  reverted: ["applied"],
  rejected: [],
  conflict: ["applied"]
};

export function createApp({ vault, modelProvider, clientDir }: CreateAppOptions) {
  const app = express();
  const provider = modelProvider ?? createModelProvider();

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

  // Merge-patch a source's metadata. Used by per-source Product Kit activation
  // (metadata.activeKitIds) — a generic metadata merge so the kit seam never needs
  // a core schema change. Only metadata is mutable here; identity fields are fixed.
  const updateSourceRequestSchema = z.object({ metadata: z.record(z.string(), z.unknown()) });
  app.patch("/api/sources/:sourceId", async (req, res, next) => {
    try {
      const input = updateSourceRequestSchema.parse(req.body);
      const existing = await vault.stores.sources.get(req.params.sourceId);
      if (!existing) {
        res.status(404).json({ error: "Source not found" });
        return;
      }
      const source = sourceSchema.parse({
        ...existing,
        metadata: { ...existing.metadata, ...input.metadata },
        updatedAt: new Date().toISOString()
      });
      await vault.stores.sources.upsert(source);
      res.json({ source });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/sources/html", async (req, res, next) => {
    try {
      const input = ingestHtmlRequestSchema.parse(req.body);
      const injected = injectStudyIds(input.content, { idPrefix: "html" });
      const source = await ingestHtmlSource(vault, {
        title: input.title,
        content: injected.content,
        createdBy: "user"
      });

      res.status(201).json({ source, injected: { added: injected.added, ids: injected.ids } });
    } catch (error) {
      next(error);
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
      const input = ingestPdfRequestSchema.parse(req.body);
      const data = Buffer.from(input.dataBase64, "base64");
      if (data.length === 0 || !data.subarray(0, 5).toString("latin1").startsWith("%PDF-")) {
        res.status(400).json({ error: "Provided data is not a valid PDF" });
        return;
      }

      const source = await ingestBinarySource(vault, {
        title: input.title,
        data,
        sourceType: "pdf",
        createdBy: "user",
        metadata: input.originalPath ? { originalPath: input.originalPath } : undefined
      });
      res.status(201).json({ source });
    } catch (error) {
      next(error);
    }
  });

  // Seed an image source from base64 bytes (used by tests / programmatic import).
  // Images render in the host-page ImageReader so a region can be marked on them.
  app.post("/api/sources/image", async (req, res, next) => {
    try {
      const input = ingestImageRequestSchema.parse(req.body);
      const data = Buffer.from(input.dataBase64, "base64");
      if (data.length === 0) {
        res.status(400).json({ error: "Provided image data is empty" });
        return;
      }
      const source = await ingestBinarySource(vault, {
        title: input.title,
        data,
        sourceType: "image",
        mimeType: input.mimeType,
        createdBy: "user",
        metadata: input.originalPath ? { originalPath: input.originalPath } : undefined
      });
      res.status(201).json({ source });
    } catch (error) {
      next(error);
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
      const source = await vault.stores.sources.get(req.params.sourceId);
      if (!source) {
        res.status(404).json({ error: "Source not found" });
        return;
      }

      res.type(source.mimeType ?? "application/octet-stream").send(await readSourceFile(vault, source));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/sources/:sourceId/content", async (req, res, next) => {
    try {
      const source = await vault.stores.sources.get(req.params.sourceId);
      if (!source) {
        res.status(404).json({ error: "Source not found" });
        return;
      }

      res.type(source.mimeType ?? "text/plain").send(await readSourceContent(vault, source));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/sources/:sourceId/rendered", async (req, res, next) => {
    try {
      const source = await vault.stores.sources.get(req.params.sourceId);
      if (!source) {
        res.status(404).json({ error: "Source not found" });
        return;
      }

      const content = await readSourceContent(vault, source);
      const anchors = await getHtmlAnchorsForSource(vault, source.id);
      const patches = (await vault.stores.patches.list()).filter((patch) => patch.sourceId === source.id);
      const anchorsById = Object.fromEntries(anchors.map((anchor) => [anchor.id, anchor]));
      const rendered = materializeHtml(content, anchorsById, patches);

      res.json({ source, content: rendered.content, results: rendered.results });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/anchors", async (req, res, next) => {
    try {
      const input = createAnchorRequestSchema.parse(req.body);
      const source = await vault.stores.sources.get(input.sourceId);
      if (!source) {
        res.status(404).json({ error: "Source not found" });
        return;
      }
      // Every new anchor joins this source's "owned" layer (created on first use).
      const ownedLayer = await ensureOwnedLayer(vault, source);
      const stampLayer = <T extends { id: string }>(anchor: T) => ({ ...anchor, layerId: ownedLayer.id });

      if (input.anchorKind === "web_text_quote") {
        const normalizedUrl =
          input.normalizedUrl ?? (source.metadata?.normalizedUrl as string | undefined);
        if (!normalizedUrl) {
          res.status(400).json({ error: "web_text_quote anchors require a normalizedUrl" });
          return;
        }
        const webAnchor = createWebTextQuoteAnchor({
          sourceId: source.id,
          normalizedUrl,
          quote: input.quote,
          contextBefore: input.contextBefore,
          contextAfter: input.contextAfter,
          createdBy: "user"
        });
        const stamped = stampLayer(webAnchor);
        await vault.stores.anchors.upsert(stamped);
        res.status(201).json({ anchor: stamped });
        return;
      }

      if (input.anchorKind === "pdf_selection") {
        if (!input.page) {
          res.status(400).json({ error: "pdf_selection anchors require a page" });
          return;
        }
        // A pdf anchor is either a text quote or a geometric region (rect, empty
        // quote). The request schema already guarantees one of them is present.
        const pdfAnchor = createPdfSelectionAnchor({
          sourceId: source.id,
          page: input.page,
          rect: input.rect,
          quote: input.quote,
          contextBefore: input.contextBefore,
          contextAfter: input.contextAfter,
          createdBy: "user"
        });
        const stamped = stampLayer(pdfAnchor);
        await vault.stores.anchors.upsert(stamped);
        res.status(201).json({ anchor: stamped });
        return;
      }

      if (input.anchorKind === "image_region") {
        if (!input.rect) {
          res.status(400).json({ error: "image_region anchors require a rect" });
          return;
        }
        const imageAnchor = createImageRegionAnchor({
          sourceId: source.id,
          rect: input.rect,
          quote: input.quote,
          createdBy: "user"
        });
        const stamped = stampLayer(imageAnchor);
        await vault.stores.anchors.upsert(stamped);
        res.status(201).json({ anchor: stamped });
        return;
      }

      // html_selection requires both a studyId and a non-empty quote.
      if (!input.studyId) {
        res.status(400).json({ error: "html_selection anchors require a studyId" });
        return;
      }
      if (!input.quote.trim()) {
        res.status(400).json({ error: "html_selection anchors require a quote" });
        return;
      }
      const anchor = createHtmlSelectionAnchor({
        sourceId: source.id,
        studyId: input.studyId,
        selector: input.selector,
        quote: input.quote,
        contextBefore: input.contextBefore,
        contextAfter: input.contextAfter,
        createdBy: "user"
      });
      const stamped = stampLayer(anchor);
      await vault.stores.anchors.upsert(stamped);
      res.status(201).json({ anchor: stamped });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/sources/:sourceId/anchors", async (req, res, next) => {
    try {
      // Anchor painting is DERIVED, not stored: an anchor paints iff it has a note in
      // an ENABLED layer (OR across that note's layers). One anchor can be shared by
      // several notes with different layers, so we can't read `anchor.layerId` (kept
      // only for backward-compat). Fallback for note-less / legacy anchors: paint iff
      // their own `anchor.layerId` is enabled-or-absent — so a highlight created without
      // a note (and pre-layer data) doesn't silently vanish.
      const sourceId = req.params.sourceId;
      const layers = await vault.stores.layers.list();
      const enabled = new Set(layers.filter((layer) => layer.enabled).map((layer) => layer.id));
      const disabled = new Set(layers.filter((layer) => !layer.enabled).map((layer) => layer.id));
      const sourceNotes = (await vault.stores.notes.list()).filter((note) => note.sourceId === sourceId);

      // Anchor id -> does any note on it sit in an enabled layer? (and is it referenced
      // by a note at all?) A note with EMPTY layerIds is "always visible" (never orphan
      // it), so it paints its anchors regardless of the enabled set.
      const paintedByNote = new Set<string>();
      const noted = new Set<string>();
      for (const note of sourceNotes) {
        const visible = note.layerIds.length === 0 || note.layerIds.some((id) => enabled.has(id));
        for (const anchorId of note.anchorIds) {
          noted.add(anchorId);
          if (visible) paintedByNote.add(anchorId);
        }
      }

      const anchors = (await vault.stores.anchors.list()).filter((anchor) => {
        if (anchor.sourceId !== sourceId) return false;
        if (paintedByNote.has(anchor.id)) return true;
        // Note-less anchor: fall back to its own (deprecated) layerId — paint unless it
        // sits on a disabled layer.
        if (!noted.has(anchor.id)) return !(anchor.layerId && disabled.has(anchor.layerId));
        // Anchor only referenced by notes in disabled layers → not painted.
        return false;
      });
      res.json({ anchors });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/notes", async (req, res, next) => {
    try {
      const input = createNoteRequestSchema.parse(req.body);
      // Unknown content type → 400 (a plain Error here would otherwise be 500).
      if (!getNoteContentSpec(input.contentType)) {
        res.status(400).json({ error: `Unknown note contentType: ${input.contentType}` });
        return;
      }
      // Validate content against its type's spec (ZodError → 400 via handler).
      const content = parseNoteContent(input.contentType, input.content);
      const now = new Date().toISOString();
      // Membership: explicit layerIds win; else a source-attached note defaults to that
      // source's "owned" layer (never orphan it to invisibility, spec §5); else empty.
      let layerIds: string[] = input.layerIds ?? [];
      if (!input.layerIds && input.sourceId) {
        const source = await vault.stores.sources.get(input.sourceId);
        if (source) layerIds = [(await ensureOwnedLayer(vault, source)).id];
      }
      const note = noteSchema.parse({
        id: createEntityId("note"),
        type: "note",
        schemaVersion: 1,
        createdAt: now,
        updatedAt: now,
        createdBy: "user",
        sourceId: input.sourceId,
        anchorIds: input.anchorIds,
        conceptIds: input.conceptIds,
        contentType: input.contentType,
        content,
        visibility: "private",
        layerIds
      });

      await vault.stores.notes.upsert(note);
      res.status(201).json({ note });
    } catch (error) {
      next(error);
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
      const visible = await layerVisibilityFilter(vault, req.query.enabledLayerIds);
      const notes = (await vault.stores.notes.list()).filter(
        (note) => note.sourceId === req.params.sourceId && visible(note)
      );
      res.json({ notes });
    } catch (error) {
      next(error);
    }
  });

  // Entity-oriented note query: filter by concept and/or anchor (a note can hang
  // off several of each). With no filter, returns all notes.
  app.get("/api/notes", async (req, res, next) => {
    try {
      const conceptId = typeof req.query.conceptId === "string" ? req.query.conceptId : undefined;
      const anchorId = typeof req.query.anchorId === "string" ? req.query.anchorId : undefined;
      const sourceId = typeof req.query.sourceId === "string" ? req.query.sourceId : undefined;
      const visible = await layerVisibilityFilter(vault, req.query.enabledLayerIds);
      const notes = (await vault.stores.notes.list()).filter(
        (note) =>
          (!conceptId || note.conceptIds.includes(conceptId)) &&
          (!anchorId || note.anchorIds.includes(anchorId)) &&
          (!sourceId || note.sourceId === sourceId) &&
          visible(note)
      );
      res.json({ notes });
    } catch (error) {
      next(error);
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
      const input = updateNoteRequestSchema.parse(req.body);
      const existing = await vault.stores.notes.get(req.params.noteId);
      if (!existing) {
        res.status(404).json({ error: "Note not found" });
        return;
      }
      // Re-validate edited content against the note's existing contentType (ZodError →
      // 400 via the handler); when absent the stored content is kept unchanged.
      const content =
        input.content !== undefined
          ? parseNoteContent(existing.contentType, input.content)
          : existing.content;
      const note = noteSchema.parse({
        ...existing,
        conceptIds: input.conceptIds ?? existing.conceptIds,
        anchorIds: input.anchorIds ?? existing.anchorIds,
        layerIds: input.layerIds ?? existing.layerIds,
        content,
        updatedAt: new Date().toISOString()
      });
      await vault.stores.notes.upsert(note);
      res.json({ note });
    } catch (error) {
      next(error);
    }
  });

  // Delete a note. Mirrors the operations/relations delete route: 200 {ok:true} on
  // success, 404 if the id is absent. ORPHAN-ANCHOR CASCADE: painting is DERIVED from
  // anchors (the reader maps every anchor in a source to a highlight), so deleting only
  // the note record would leave its anchors behind and the highlight would STAY painted.
  // So after deleting the note we cascade-delete each of its anchors that is now
  // ORPHANED — referenced by NO remaining note (none whose anchorIds includes it) AND NO
  // patch (none whose anchorId === it). Anchors still shared by another note (multi-
  // anchor / shared) or referenced by a patch are KEPT. See docs/design/note-edit-delete.md.
  app.delete("/api/notes/:noteId", async (req, res, next) => {
    try {
      // Capture the note's anchorIds BEFORE deleting it, so we know which anchors to
      // re-check for orphan-hood.
      const note = await vault.stores.notes.get(req.params.noteId);
      const removed = await vault.stores.notes.delete(req.params.noteId);
      if (!removed || !note) {
        res.status(404).json({ error: "Note not found" });
        return;
      }
      // Load the remaining notes + all patches ONCE (efficiency), then drop any of this
      // note's anchors no longer referenced by either. The note is already gone from the
      // store, so `notes.list()` reflects the post-delete set.
      if (note.anchorIds.length > 0) {
        const remainingNotes = await vault.stores.notes.list();
        const patches = await vault.stores.patches.list();
        const referencedByNote = new Set<string>();
        for (const other of remainingNotes) for (const anchorId of other.anchorIds) referencedByNote.add(anchorId);
        const referencedByPatch = new Set(patches.map((patch) => patch.anchorId));
        for (const anchorId of note.anchorIds) {
          if (!referencedByNote.has(anchorId) && !referencedByPatch.has(anchorId)) {
            await vault.stores.anchors.delete(anchorId);
          }
        }
      }
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  // —— Study Layers (a per-source lens axis: owned + preset stages + custom + imported) ——
  // List the layers over a source, for the multi-select filter switcher. The owned layer
  // and the four preset stages (预习/学习/复习/拓展) are created on demand here (lazily, the
  // same way ensureOwnedLayer works) so the switcher always sees them.
  app.get("/api/sources/:sourceId/layers", async (req, res, next) => {
    try {
      const source = await vault.stores.sources.get(req.params.sourceId);
      if (source) {
        await ensureOwnedLayer(vault, source);
        await ensurePresetLayers(vault, source);
      }
      const layers = (await vault.stores.layers.list()).filter(
        (layer) => layer.localSourceId === req.params.sourceId
      );
      res.json({ layers });
    } catch (error) {
      next(error);
    }
  });

  // Create a user-defined ("custom") layer over a source — backs the layer manager.
  const createLayerRequestSchema = z.object({
    title: z.string().min(1),
    color: z.string().min(1).optional(),
    order: z.number().optional()
  });
  app.post("/api/sources/:sourceId/layers", async (req, res, next) => {
    try {
      const input = createLayerRequestSchema.parse(req.body);
      const source = await vault.stores.sources.get(req.params.sourceId);
      if (!source) {
        res.status(404).json({ error: "Source not found" });
        return;
      }
      const layer = await createCustomLayer(vault, source, input);
      res.status(201).json({ layer });
    } catch (error) {
      next(error);
    }
  });

  // Toggle a layer on/off (enabled, reused as the filter include/exclude), rename it,
  // or set its presentation fields (color/order) for the manager.
  const updateLayerRequestSchema = z
    .object({
      enabled: z.boolean().optional(),
      title: z.string().min(1).optional(),
      color: z.string().min(1).optional(),
      order: z.number().optional()
    })
    .refine(
      (input) =>
        input.enabled !== undefined ||
        input.title !== undefined ||
        input.color !== undefined ||
        input.order !== undefined,
      { message: "layer update requires enabled, title, color, or order" }
    );
  app.patch("/api/layers/:layerId", async (req, res, next) => {
    try {
      const input = updateLayerRequestSchema.parse(req.body);
      const existing = await vault.stores.layers.get(req.params.layerId);
      if (!existing) {
        res.status(404).json({ error: "Layer not found" });
        return;
      }
      const layer = studyLayerSchema.parse({
        ...existing,
        enabled: input.enabled ?? existing.enabled,
        title: input.title ?? existing.title,
        color: input.color ?? existing.color,
        order: input.order ?? existing.order,
        updatedAt: new Date().toISOString()
      });
      await vault.stores.layers.upsert(layer);
      res.json({ layer });
    } catch (error) {
      next(error);
    }
  });

  // Delete a CUSTOM layer (manager action). Preset / owned / imported layers are
  // structural and cannot be deleted here (409). The deleted layer id is cascade-stripped
  // from every note's `layerIds` so a note that lived ONLY in this layer collapses to
  // [] — i.e. "always visible", never orphaned to invisibility (spec §5). Notes that
  // also belong to other layers keep those memberships.
  app.delete("/api/layers/:layerId", async (req, res, next) => {
    try {
      const existing = await vault.stores.layers.get(req.params.layerId);
      if (!existing) {
        res.status(404).json({ error: "Layer not found" });
        return;
      }
      if (existing.role !== "custom") {
        res.status(409).json({ error: "Only custom layers can be deleted" });
        return;
      }
      const layerId = req.params.layerId;
      const affected = (await vault.stores.notes.list()).filter((note) => note.layerIds.includes(layerId));
      for (const note of affected) {
        await vault.stores.notes.upsert(
          noteSchema.parse({
            ...note,
            layerIds: note.layerIds.filter((id) => id !== layerId),
            updatedAt: new Date().toISOString()
          })
        );
      }
      await vault.stores.layers.delete(layerId);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  // Export a layer as a portable `.studypack` (local realizations stripped).
  app.post("/api/layers/:layerId/export", async (req, res, next) => {
    try {
      const pack = await buildStudyPack(vault, req.params.layerId);
      if (!pack) {
        res.status(404).json({ error: "Layer not found" });
        return;
      }
      res.json({ pack });
    } catch (error) {
      next(error);
    }
  });

  // Preview an import: match the pack to a local source + rematch every anchor.
  // Does NOT persist anything.
  app.post("/api/layers/import/preview", async (req, res, next) => {
    try {
      const pack = parseStudyPack(z.object({ pack: z.unknown() }).parse(req.body).pack);
      res.json({ preview: await previewImport(vault, pack) });
    } catch (error) {
      next(error);
    }
  });

  // Commit an import: create an imported layer + re-located anchors + notes.
  app.post("/api/layers/import/commit", async (req, res, next) => {
    try {
      const body = z.object({ pack: z.unknown(), targetSourceId: z.string().min(1).optional() }).parse(req.body);
      const pack = parseStudyPack(body.pack);
      res.status(201).json({ result: await commitImport(vault, pack, { targetSourceId: body.targetSourceId }) });
    } catch (error) {
      next(error);
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
      const asset = await vault.stores.assets.get(req.params.assetId);
      if (!asset) {
        res.status(404).json({ error: "Asset not found" });
        return;
      }
      const filePath = assetBytesPath(vault, asset);
      const stats = await stat(filePath);
      const total = stats.size;

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
      next(error);
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
      const input = createConceptRequestSchema.parse(req.body);
      const now = new Date().toISOString();
      const concept = conceptSchema.parse({
        id: createEntityId("concept"),
        type: "concept",
        schemaVersion: 1,
        createdAt: now,
        updatedAt: now,
        createdBy: "user",
        ...input
      });
      await vault.stores.concepts.upsert(concept);
      res.status(201).json({ concept });
    } catch (error) {
      next(error);
    }
  });

  // Concept detail with back-references: which notes link it and which relations touch it.
  app.get("/api/concepts/:conceptId", async (req, res, next) => {
    try {
      const concept = await vault.stores.concepts.get(req.params.conceptId);
      if (!concept) {
        res.status(404).json({ error: "Concept not found" });
        return;
      }
      const notes = (await vault.stores.notes.list()).filter((note) => note.conceptIds.includes(concept.id));
      const relations = (await vault.stores.relations.list()).filter(
        (relation) => relation.from.id === concept.id || relation.to.id === concept.id
      );
      res.json({ concept, notes, relations });
    } catch (error) {
      next(error);
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
      const input = createRelationRequestSchema.parse(req.body);
      const now = new Date().toISOString();
      const relation = relationSchema.parse({
        id: createEntityId("relation"),
        type: "relation",
        schemaVersion: 1,
        createdAt: now,
        updatedAt: now,
        createdBy: "user",
        ...input
      });
      await vault.stores.relations.upsert(relation);
      res.status(201).json({ relation });
    } catch (error) {
      next(error);
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
      const input = createOperationRequestSchema.parse(req.body);
      const consistency = operationConsistencyError(input.promptTemplate, input.declaredVariables);
      if (consistency) {
        res.status(400).json({ error: consistency });
        return;
      }
      const now = new Date().toISOString();
      const operation = operationSchema.parse({
        id: createEntityId("operation"),
        type: "operation",
        schemaVersion: 1,
        createdAt: now,
        updatedAt: now,
        createdBy: "user",
        ...input
      });
      await vault.stores.operations.upsert(operation);
      res.status(201).json({ operation });
    } catch (error) {
      next(error);
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
      const input = updateOperationRequestSchema.parse(req.body);
      const existing = await vault.stores.operations.get(req.params.operationId);
      if (!existing) {
        res.status(404).json({ error: "Operation not found" });
        return;
      }
      const merged = { ...existing, ...input, updatedAt: new Date().toISOString() };
      const consistency = operationConsistencyError(merged.promptTemplate, merged.declaredVariables);
      if (consistency) {
        res.status(400).json({ error: consistency });
        return;
      }
      const operation = operationSchema.parse(merged);
      await vault.stores.operations.upsert(operation);
      res.json({ operation });
    } catch (error) {
      next(error);
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
  const operationPrefsPath = path.join(vault.paths.studyDir, "operation-prefs.json");

  app.get("/api/operation-prefs", async (_req, res, next) => {
    try {
      const text = await vault.storage.readText(operationPrefsPath);
      const prefs = text ? operationPrefsSchema.parse(JSON.parse(text)) : emptyOperationPrefs;
      res.json({ prefs });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/operation-prefs", async (req, res, next) => {
    try {
      const prefs = operationPrefsSchema.parse(req.body);
      await vault.storage.writeTextAtomic(operationPrefsPath, `${JSON.stringify(prefs, null, 2)}\n`);
      res.json({ prefs });
    } catch (error) {
      next(error);
    }
  });

  // —— Workspace layout (UI state) —————————————————————————————————————
  const workspacePath = path.join(vault.paths.studyDir, "workspace.json");

  app.get("/api/workspace", async (_req, res, next) => {
    try {
      const text = await vault.storage.readText(workspacePath);
      const state = text ? workspaceStateSchema.parse(JSON.parse(text)) : emptyWorkspaceState;
      res.json({ workspace: state });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/workspace", async (req, res, next) => {
    try {
      const state = workspaceStateSchema.parse(req.body);
      await vault.storage.writeTextAtomic(workspacePath, `${JSON.stringify(state, null, 2)}\n`);
      res.json({ workspace: state });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/patches", async (req, res, next) => {
    try {
      const input = createPatchRequestSchema.parse(req.body);
      const now = new Date().toISOString();
      const patch = patchSchema.parse({
        id: createEntityId("patch"),
        type: "patch",
        schemaVersion: 1,
        createdAt: now,
        updatedAt: now,
        createdBy: "user",
        sourceId: input.sourceId,
        anchorId: input.anchorId,
        action: input.action,
        status: "pending",
        oldText: input.oldText,
        newContent: input.newContent,
        summary: input.summary
      });

      await vault.stores.patches.upsert(patch);
      res.status(201).json({ patch });
    } catch (error) {
      next(error);
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
      const input = updatePatchRequestSchema.parse(req.body);
      const existing = await vault.stores.patches.get(req.params.patchId);
      if (!existing) {
        res.status(404).json({ error: "Patch not found" });
        return;
      }

      if (input.status !== existing.status && !patchTransitions[existing.status].includes(input.status)) {
        res.status(409).json({ error: `Invalid patch transition: ${existing.status} → ${input.status}` });
        return;
      }

      if (input.status === "applied") {
        const conflict = await detectPatchConflict(vault, existing);
        if (conflict) {
          const patch = {
            ...existing,
            status: "conflict" as const,
            updatedAt: new Date().toISOString()
          };
          await vault.stores.patches.upsert(patch);
          res.status(409).json({ patch, conflict });
          return;
        }
      }

      const now = new Date().toISOString();
      const patch = patchSchema.parse({
        ...existing,
        status: input.status,
        updatedAt: now,
        appliedAt: input.status === "applied" ? now : existing.appliedAt,
        revertedAt: input.status === "reverted" ? now : existing.revertedAt
      });
      await vault.stores.patches.upsert(patch);
      res.json({ patch });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/chat", async (req, res, next) => {
    try {
      const input = chatRequestSchema.parse(req.body);
      const response = await provider.complete(input);
      res.json({ message: response.message, provider: provider.id });
    } catch (error) {
      next(error);
    }
  });

  // Streaming chat over Server-Sent Events. Emits `chunk` events ({delta}) as the
  // reply is produced, then one `done` event ({message, provider}). Providers
  // without `stream()` fall back to a single chunk from `complete()`. Validation
  // errors happen before any byte is written, so they still surface as a 400.
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
      if (provider.stream) {
        for await (const delta of provider.stream(input)) {
          full += delta;
          send("chunk", { delta });
        }
      } else {
        full = (await provider.complete(input)).message.content;
        send("chunk", { delta: full });
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
      const input = kitGenerateSchema.parse(req.body);
      // Server-side built-in placeholder fill: merge the per-vault params for this
      // promptId UNDER the runtime input (so runtime values like anchorText always
      // win) BEFORE the prompt's build() runs. Custom op_ ids simply have no params.
      const prefsText = await vault.storage.readText(operationPrefsPath);
      const prefs = prefsText ? operationPrefsSchema.parse(JSON.parse(prefsText)) : emptyOperationPrefs;
      const params = prefs.params[input.promptId] ?? {};
      const merged = { ...input, input: { ...params, ...(input.input ?? {}) } };
      const content = await generateStructuredContent(provider, merged, 3, vault.stores.operations);
      res.json({ content, provider: provider.id });
    } catch (error) {
      if (error instanceof StructuredGenerationError) {
        res.status(400).json({ error: error.message });
        return;
      }
      next(error);
    }
  });

  // —— Adaptive note forms · Phase 4 ——————————————————————————————————————————
  // Run the FORM ROUTER (item 1): one structured call where the MODEL picks the form
  // AND fills it. We generate against `formRouterSchema` (a discriminated union), then
  // unwrap the chosen member into a real { contentType, content } shaped for that
  // type's NoteContentSpec — so the result flows through the normal preview/save/render
  // path (§0.5: a registered contentType, no bypass). The mock is deterministic for
  // this schema (echoes `sample`, else synthesizes the first union member).
  async function runFormRouter(text: string, context: unknown, sample: unknown): Promise<FormRouterOutput> {
    try {
      const output = (await generateStructured(provider, {
        messages: [
          {
            role: "user",
            content:
              "Choose the BEST note form for the following content and return it as the router " +
              "JSON (pick the single most appropriate `form`).\n" +
              // Inline-HTML guard (FIX 1, best-effort half): if the model picks the html
              // form it must inline the markup, never write a file / return a path. The
              // RELIABLE half is the schema's looksLikeHtml refine + the degrade below.
              INLINE_HTML_INSTRUCTION +
              "\n\n" +
              text
          }
        ],
        schema: formRouterSchema,
        contentType: FORM_ROUTER_CONTENT_TYPE,
        sample,
        context: chatContextSchema.optional().parse(context) ?? undefined
      })) as FormRouterOutput;
      return output;
    } catch (error) {
      // DEGRADE GRACEFULLY (FIX 1, reliable half): generation failed to produce a valid
      // union member after the re-prompt loop. The dominant cause with the agentic
      // claude-cli provider is an html arm whose `html` was a FILE PATH (rejected by the
      // looksLikeHtml refine on every attempt). Rather than surface a hard error — or,
      // worse, persist a path as html — fall back to a MARKDOWN note carrying the original
      // text. The robust long-term fix is a content-returning API provider (DeepSeek), not
      // an agent that writes files; this keeps the offline/path case from corrupting a note.
      if (error instanceof StructuredGenerationError) {
        return { form: "markdown", markdown: text };
      }
      throw error;
    }
  }

  app.post("/api/notes/generate-block", async (req, res, next) => {
    try {
      const input = generateBlockSchema.parse(req.body);
      const output = await runFormRouter(input.text, input.context, input.sample);
      const routed = routerOutputToNote(output);
      // Validate the unwrapped content against the target type's core schema before it
      // leaves the server — the routed form must be a real, persistable note.
      const spec = getNoteContentSpec(routed.contentType);
      const content = spec ? spec.schema.parse(routed.content) : routed.content;
      res.json({ contentType: routed.contentType, content, provider: provider.id });
    } catch (error) {
      next(error);
    }
  });

  // AI-assisted classification (item 2) — the low-confidence FALLBACK behind the
  // client's resolveFormAsync. It reuses the SAME form-router to decide the form for
  // ambiguous prose, returning a ClassifiedForm. The client only calls this when its
  // pure heuristic was low-confidence (heuristic stays primary; this is gated on the
  // client by provider availability), so offline/deterministic flows are unaffected.
  app.post("/api/notes/classify", async (req, res, next) => {
    try {
      const input = generateBlockSchema.parse(req.body);
      const output = await runFormRouter(input.text, input.context, input.sample);
      const routed = routerOutputToNote(output);
      // A MARKDOWN verdict means "this is prose, keep it as-is" — so PRESERVE the
      // original text rather than the router's (possibly regenerated/empty) markdown.
      // This makes the AI pass a no-op on content for the markdown case (it only changes
      // the FORM when it picks a richer one), so the heuristic's safe markdown fallback
      // is honored verbatim and deterministic offline flows keep the original text.
      if (routed.contentType === "markdown") {
        res.json({ contentType: "markdown", content: input.text, confidence: "low", provider: provider.id });
        return;
      }
      const spec = getNoteContentSpec(routed.contentType);
      const content = spec ? spec.schema.parse(routed.content) : routed.content;
      // The model picked a RICHER form → high confidence (an explicit, non-fallback
      // choice). The client only reaches here on a low heuristic, so this never
      // overrides a confident heuristic.
      res.json({ contentType: routed.contentType, content, confidence: "high", provider: provider.id });
    } catch (error) {
      next(error);
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

// Build the OR-over-enabled-layers note-visibility predicate. A note is visible iff
// its layerIds intersects the enabled set (OR across its layers). A note with EMPTY
// layerIds is always visible (never orphan it to invisibility). The enabled set comes
// from an explicit `enabledLayerIds` csv query param when supplied (the client's
// multi-select filter), else from every layer whose `enabled` flag is on (the stored
// toggle — reused as the filter source of truth).
async function layerVisibilityFilter(
  vault: StudyVault,
  enabledLayerIdsParam: unknown
): Promise<(note: { layerIds: string[] }) => boolean> {
  let enabled: Set<string>;
  if (typeof enabledLayerIdsParam === "string") {
    enabled = new Set(enabledLayerIdsParam.split(",").map((id) => id.trim()).filter(Boolean));
  } else {
    enabled = new Set((await vault.stores.layers.list()).filter((layer) => layer.enabled).map((layer) => layer.id));
  }
  return (note) => note.layerIds.length === 0 || note.layerIds.some((id) => enabled.has(id));
}

// Consistency between a custom Operation's template and its declared variables.
// Orphan placeholders (in the template but not declared) are SOFT-allowed — they
// simply render "" at run time, so the engine stays total. The one hard error: a
// `literal` variable marked required with no default can never produce a value
// (literals always use their default), so block it. Returns null when consistent.
function operationConsistencyError(
  promptTemplate: string,
  declaredVariables: z.infer<typeof operationVariableSchema>[]
): string | null {
  // Orphan placeholders (referenced but not declared) are soft-allowed: they render
  // "" at run time. A REQUIRED variable that the template never references, however,
  // can never be injected — flag that as an authoring mistake.
  const referenced = new Set(extractVariables(promptTemplate));
  for (const variable of declaredVariables) {
    if (variable.required && variable.source === "literal" && !(variable.default && variable.default.trim())) {
      return `Required literal variable "${variable.name}" needs a default value`;
    }
    if (variable.required && !referenced.has(variable.name)) {
      return `Required variable "${variable.name}" is not used in the template`;
    }
  }
  return null;
}

async function getHtmlAnchorsForSource(vault: StudyVault, sourceId: string) {
  return (await vault.stores.anchors.list()).filter(
    (anchor): anchor is HtmlSelectionAnchor => anchor.sourceId === sourceId && anchor.anchorKind === "html_selection"
  );
}

async function detectPatchConflict(vault: StudyVault, patch: PatchRecord) {
  const source = await vault.stores.sources.get(patch.sourceId);
  if (!source) return { reason: "source_not_found" };

  const anchor = (await vault.stores.anchors.get(patch.anchorId)) as AnchorRecord | null;
  if (!anchor || anchor.anchorKind !== "html_selection") return { reason: "anchor_not_found" };

  const content = await readSourceContent(vault, source);
  const result = applyHtmlPatchWithGuard(content, anchor, patch);
  if (result.ok) return null;

  return {
    reason: result.reason,
    message: result.message
  };
}

