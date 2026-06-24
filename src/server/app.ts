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
  noteKindSchema,
  noteSchema,
  patchActionSchema,
  patchSchema,
  type AnchorRecord,
  type HtmlSelectionAnchor,
  type PatchRecord,
  type PatchStatus
} from "../core/schema";
import type { StudyVault } from "../core/vault";
import {
  ingestBinarySource,
  ingestHtmlSource,
  listSources,
  readSourceContent,
  readSourceFile
} from "../core/store/sources";
import { chatRequestSchema, createModelProvider, type ModelProvider } from "../ai";

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

const rectSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);

const createAnchorRequestSchema = z.object({
  sourceId: z.string().min(1),
  anchorKind: z
    .enum(["html_selection", "web_text_quote", "pdf_selection", "image_region"])
    .default("html_selection"),
  studyId: z.string().min(1).optional(),
  selector: z.string().min(1).optional(),
  normalizedUrl: z.string().min(1).optional(),
  page: z.number().int().positive().optional(),
  // Normalized region [x, y, w, h] for geometric anchors (image regions, PDF
  // figures). Optional for pdf_selection (hybrid hint), required for image_region.
  rect: rectSchema.optional(),
  // Empty allowed: geometric anchors locate by rect, not text.
  quote: z.string().default(""),
  contextBefore: z.string().default(""),
  contextAfter: z.string().default("")
});

const createNoteRequestSchema = z.object({
  sourceId: z.string().min(1),
  anchorId: z.string().min(1).optional(),
  noteKind: noteKindSchema.default("annotation"),
  contentType: z.string().min(1).optional(),
  title: z.string().optional(),
  question: z.string().optional(),
  content: z.string().min(1)
});

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

      if (input.anchorKind === "image_region") {
        if (!input.rect) {
          res.status(400).json({ error: "image_region anchors require a rect" });
          return;
        }
        const imageAnchor = createImageRegionAnchor({
          sourceId: source.id,
          rect: input.rect,
          quote: input.quote,
          contextBefore: input.contextBefore,
          contextAfter: input.contextAfter,
          createdBy: "user"
        });
        await vault.stores.anchors.upsert(imageAnchor);
        res.status(201).json({ anchor: imageAnchor });
        return;
      }

      if (input.anchorKind === "web_text_quote") {
        const normalizedUrl =
          input.normalizedUrl ?? (source.metadata?.normalizedUrl as string | undefined);
        if (!normalizedUrl) {
          res.status(400).json({ error: "web_text_quote anchors require a normalizedUrl" });
          return;
        }
        if (!input.quote) {
          res.status(400).json({ error: "web_text_quote anchors require a quote" });
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
        await vault.stores.anchors.upsert(webAnchor);
        res.status(201).json({ anchor: webAnchor });
        return;
      }

      if (input.anchorKind === "pdf_selection") {
        if (!input.page) {
          res.status(400).json({ error: "pdf_selection anchors require a page" });
          return;
        }
        // Hybrid: text quote (if any) + an optional geometric rect, so a passage
        // can be re-found by text and a figure by its box.
        if (!input.quote && !input.rect) {
          res.status(400).json({ error: "pdf_selection anchors require a quote or a rect" });
          return;
        }
        const pdfAnchor = createPdfSelectionAnchor({
          sourceId: source.id,
          page: input.page,
          quote: input.quote,
          rect: input.rect,
          contextBefore: input.contextBefore,
          contextAfter: input.contextAfter,
          createdBy: "user"
        });
        await vault.stores.anchors.upsert(pdfAnchor);
        res.status(201).json({ anchor: pdfAnchor });
        return;
      }

      if (!input.studyId) {
        res.status(400).json({ error: "html_selection anchors require a studyId" });
        return;
      }
      if (!input.quote) {
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
      await vault.stores.anchors.upsert(anchor);
      res.status(201).json({ anchor });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/sources/:sourceId/anchors", async (req, res, next) => {
    try {
      const anchors = (await vault.stores.anchors.list()).filter((anchor) => anchor.sourceId === req.params.sourceId);
      res.json({ anchors });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/notes", async (req, res, next) => {
    try {
      const input = createNoteRequestSchema.parse(req.body);
      const now = new Date().toISOString();
      const note = noteSchema.parse({
        id: createEntityId("note"),
        type: "note",
        schemaVersion: 1,
        createdAt: now,
        updatedAt: now,
        createdBy: "user",
        sourceId: input.sourceId,
        anchorId: input.anchorId,
        noteKind: input.noteKind,
        contentType: input.contentType,
        title: input.title,
        question: input.question,
        content: input.content,
        linkedConceptIds: [],
        visibility: "private"
      });

      await vault.stores.notes.upsert(note);
      res.status(201).json({ note });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/sources/:sourceId/notes", async (req, res, next) => {
    try {
      const notes = (await vault.stores.notes.list()).filter((note) => note.sourceId === req.params.sourceId);
      res.json({ notes });
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

