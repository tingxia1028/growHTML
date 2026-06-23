import "dotenv/config";
import express from "express";
import path from "node:path";
import { createProposal } from "./agents";
import { generateDocument } from "./documentAgent";
import { importExternalResource } from "./externalImport";
import {
  ensureStorage,
  getDocumentAssetDir,
  getDocumentWorkspace,
  loadDocument,
  saveDocument
} from "./storage";
import type {
  AiProposalRequest,
  GenerateDocumentRequest,
  ImportExternalRequest,
  SaveDocumentRequest
} from "../shared/types";

const app = express();
const port = Number(process.env.PORT ?? 4177);
const pdfjsDistDir = path.join(process.cwd(), "node_modules", "pdfjs-dist");

app.use(express.json({ limit: "100mb" }));
app.use("/api/assets", express.static(getDocumentAssetDir(), { index: false }));
app.use("/api/pdfjs/cmaps", express.static(path.join(pdfjsDistDir, "cmaps"), { index: false }));
app.use("/api/pdfjs/iccs", express.static(path.join(pdfjsDistDir, "iccs"), { index: false }));
app.use("/api/pdfjs/standard_fonts", express.static(path.join(pdfjsDistDir, "standard_fonts"), { index: false }));
app.use("/api/pdfjs/wasm", express.static(path.join(pdfjsDistDir, "wasm"), { index: false }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/document", async (_req, res, next) => {
  try {
    res.json(await loadDocument());
  } catch (error) {
    next(error);
  }
});

app.post("/api/document/save", async (req, res, next) => {
  try {
    await saveDocument(req.body as SaveDocumentRequest);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/ai/propose", async (req, res, next) => {
  try {
    const response = await createProposal(req.body as AiProposalRequest, getDocumentWorkspace());
    res.json(response);
  } catch (error) {
    next(error);
  }
});

app.post("/api/ai/generate", async (req, res, next) => {
  try {
    const response = await generateDocument(req.body as GenerateDocumentRequest);
    res.json(response);
  } catch (error) {
    next(error);
  }
});

app.post("/api/external/import", async (req, res, next) => {
  try {
    const response = await importExternalResource(req.body as ImportExternalRequest, {
      assetDir: getDocumentAssetDir(),
      assetBaseUrl: "/api/assets"
    });
    res.json(response);
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Unknown server error";
  res.status(500).json({ error: message });
});

await ensureStorage();

app.listen(port, "127.0.0.1", () => {
  console.log(`GrowHTML API listening on http://127.0.0.1:${port}`);
});
