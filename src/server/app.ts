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
import {
  createBackupScheduler,
  createDataTrustService,
  defaultBackupsDir,
  registerDataTrustRoutes
} from "./dataTrust";
import { createTrashPurgeScheduler, createTrashService, registerTrashRoutes } from "./trash";
import { createMemoryConsolidationScheduler, registerMemoryRoutes } from "./memory";
import { registerAgentRoutes } from "./agent";
import { registerChatRoutes } from "./chatSessions";
import type { StudyVault } from "../core/vault";
import { deleteSource, listSources } from "../core/store/sources";
import { handleServiceError } from "./services/errors";
import * as sourcesService from "./services/sources";
import * as sourceAuthoringService from "./services/sourceAuthoring";
import * as sourceForkService from "./services/sourceFork";
import * as anchorsService from "./services/anchors";
import * as notesService from "./services/notes";
import * as layersService from "./services/layers";
import * as conceptsService from "./services/concepts";
import * as graphService from "./services/graph";
import * as operationsService from "./services/operations";
import * as patchesService from "./services/patches";
import * as assetsService from "./services/assets";
import * as workspaceService from "./services/workspace";
import * as searchService from "./services/search";
import * as reviewScheduleService from "./services/reviewSchedule";
import * as triggerFiresService from "./services/triggerFires";
import * as aiService from "./services/ai";
import * as synthesisService from "./services/synthesis";
import { SynthesisPathResultError } from "./services/synthesis";
import * as aiProvidersService from "./services/aiProviders";
import * as speechService from "./services/speech";
import { KeyNotPersistableError, type KeyStore } from "./keyStore";
import {
  chatRequestSchema,
  createRegisteredProvider,
  HTTP_PRESET_ENV_KEYS,
  isHttpPresetId,
  listProviderDescriptors,
  type CliAgentDetectResult,
  type ModelProvider,
  type ProviderCapabilities
} from "../ai";
import packageJson from "../../package.json";
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
  /**
   * App-level AI provider config (A3b, docs/design/multi-provider-ai-agent.md §4.2):
   * where ai-providers.json + the safeStorage key blobs live, plus injectable seams
   * for tests. ABSENT → stored config is disabled and provider selection stays the
   * byte-identical A1 env behavior (which is also what keeps every legacy test
   * hermetic — like identityDir, real entry points pass a dir and tests inject temp).
   */
  aiConfig?: {
    dir: string;
    /** Key backend override (tests); default = safeStorage in Electron main, env-only elsewhere. */
    keyStore?: KeyStore;
    /** cli-agent probe override (tests); default spawns `<cli> --version` with a 3s timeout. */
    detectCliAgent?: (specId: aiProvidersService.CliAgentSpecId) => Promise<CliAgentDetectResult>;
  };
  /**
   * Speech lane seams (SPEECH-1/2, docs/design/speech-and-young-learners.md §1–2):
   * `synthesizeEdge` overrides the TTS edge lane's synthesizer; `probeSttHealth` /
   * `transcribeStt` override the STT local lane's sidecar probe/proxy — tests inject
   * mocks (same seam style as the injected modelProvider). Defaults: msedge-tts over
   * wss to Microsoft (keyless but ONLINE) and the faster-whisper sidecar on
   * STUDY_VAULT_STT_URL (default 127.0.0.1:8765). Down lanes degrade to friendly 502s.
   */
  speech?: {
    synthesizeEdge?: speechService.EdgeTtsSynthesizer;
    probeSttHealth?: speechService.SttHealthProbe;
    transcribeStt?: speechService.SttTranscriber;
    sttBaseUrl?: string;
  };
  /**
   * Data trust (TRUST-1/2, docs/design/data-trust.md): where the rotating vault
   * backups live (default: sibling `backups/` of the vault root) + whether to arm
   * the 24h auto-backup scheduler. Like aiConfig, the AUTOMATIC behaviors (the
   * pre-清除记忆 safety backup, the scheduler) activate only when the option is
   * present — bare createApp unit tests stay hermetic; the routes always exist.
   */
  dataTrust?: {
    backupsDir?: string;
    scheduleAuto?: boolean;
  };
};

const ingestUrlRequestSchema = z.object({
  url: z.string().url()
});

export function createApp({ vault, modelProvider, clientDir, identityDir, now, aiConfig, speech, dataTrust }: CreateAppOptions) {
  const app = express();
  // Provider selection (A3b): a small manager replaces the boot-time singleton so
  // the stored config's active pick takes effect per request (memoized by config
  // fingerprint; a switch disposes the old instance, e.g. a live PTY session).
  // Precedence: injected modelProvider → STUDY_VAULT_AI_PROVIDER env → stored
  // config → default (mock) — see services/aiProviders.ts. Without `aiConfig`
  // this constructs the exact legacy provider once, at createApp time, as before.
  const aiManager = aiProvidersService.createAiProviderManager({ injected: modelProvider, aiConfig });
  const getProvider = () => aiManager.getProvider();

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

  // App identity for the 关于 surfaces (user menu / Settings Hub) — the version is
  // the package.json version, resolved at build/require time. 检查更新 stays a
  // disabled stub until the desktop update channel (X1) wires electron-updater.
  app.get("/api/about", (_req, res) => {
    res.json({ app: "ai-study-vault", version: packageJson.version });
  });

  // —— AI providers (A3b, docs/design/multi-provider-ai-agent.md §4.2/§5 Phase 1) ——
  // The A1 read-only readout, EXTENDED (same route, additive fields): which provider
  // is ACTIVE and why (activeSource), every registry descriptor with its capability
  // row, the stored BYOK config (keySet flags — never key material), and the key
  // store's mode so the UI can state env-only builds. Consumed by the Settings Hub
  // AI 提供方 section + onboarding 接入 AI detection.
  app.get("/api/ai/providers", async (_req, res, next) => {
    try {
      const { provider: active, source, configError } = await aiManager.resolveActive();
      const env = process.env;
      const providers = listProviderDescriptors().map((descriptor) => {
        let capabilities: ProviderCapabilities | undefined;
        try {
          capabilities = createRegisteredProvider(descriptor.id, { env }).capabilities;
        } catch {
          capabilities = undefined;
        }
        return { ...descriptor, capabilities };
      });
      const deps = await aiManager.getDeps();
      let config: aiProvidersService.AiProvidersConfigView | null = null;
      if (deps) {
        const { config: stored, error } = await aiProvidersService.readAiProvidersConfig(deps);
        config = await aiProvidersService.configView(deps, stored, configError ?? error, env);
      }
      res.json({
        active: { id: active.id, kind: active.capabilities.kind },
        activeSource: source,
        providers,
        envProviderId: process.env.STUDY_VAULT_AI_PROVIDER ?? null,
        config,
        keyStore: (await aiManager.getKeyStore()).status()
      });
    } catch (error) {
      next(error);
    }
  });

  // Requires the app-level config storage (real entry points always pass aiConfig;
  // a server booted without it answers a typed 409 instead of writing anywhere).
  const requireAiDeps = async (res: express.Response) => {
    const deps = await aiManager.getDeps();
    if (!deps) res.status(409).json({ error: "此服务器未启用应用级 AI 配置存储", code: "ai_config_disabled" });
    return deps;
  };

  // The LIST editor's write seam — owns `providers` ONLY (activeProviderId and each
  // entry's server-owned keyRef are preserved from the stored file; see the
  // field-group notes in services/aiProviders.ts). Returns the merged view.
  app.put("/api/ai/providers/config", async (req, res, next) => {
    try {
      const deps = await requireAiDeps(res);
      if (!deps) return;
      const body = z.object({ providers: z.array(aiProvidersService.aiProviderEntryInputSchema) }).parse(req.body);
      const merged = await aiProvidersService.writeProviderList(deps, body.providers);
      aiManager.invalidate();
      res.json({ config: await aiProvidersService.configView(deps, merged, null, process.env) });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // The PICKER's write seam — owns `activeProviderId` ONLY (config entry id or a
  // plain registry id; null clears back to the env/default chain).
  app.put("/api/ai/providers/active", async (req, res, next) => {
    try {
      const deps = await requireAiDeps(res);
      if (!deps) return;
      const body = z.object({ activeProviderId: z.string().min(1).nullable() }).parse(req.body);
      const merged = await aiProvidersService.writeActiveProvider(deps, body.activeProviderId);
      aiManager.invalidate();
      res.json({ config: await aiProvidersService.configView(deps, merged, null, process.env) });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // BYOK key write — write-only: the key goes INTO the KeyStore (safeStorage
  // ciphertext at rest) and never appears in any response or GET. In env-only
  // builds (web/dev — no safeStorage in reach) this answers a typed 409 naming
  // the preset's env var instead of ever persisting plaintext (§4.2's rule).
  app.put("/api/ai/providers/:id/key", async (req, res, next) => {
    try {
      const deps = await requireAiDeps(res);
      if (!deps) return;
      const body = z.object({ apiKey: z.string().min(1) }).parse(req.body);
      await aiProvidersService.setProviderKey(deps, req.params.id, body.apiKey);
      aiManager.invalidate();
      res.json({ ok: true, keySet: true, storage: deps.keyStore.status().kind });
    } catch (error) {
      if (error instanceof KeyNotPersistableError) {
        const { config } = await aiProvidersService.readAiProvidersConfig((await aiManager.getDeps())!);
        const preset = config.providers.find((entry) => entry.id === req.params.id)?.preset;
        const envVar = preset && isHttpPresetId(preset) ? HTTP_PRESET_ENV_KEYS[preset] : undefined;
        res.status(409).json({
          error: `${error.message}${envVar ? `（${envVar}）` : ""}`,
          code: "key_not_persistable",
          envVar: envVar ?? null
        });
        return;
      }
      if (!handleServiceError(res, error)) next(error);
    }
  });

  app.delete("/api/ai/providers/:id/key", async (req, res, next) => {
    try {
      const deps = await requireAiDeps(res);
      if (!deps) return;
      await aiProvidersService.deleteProviderKey(deps, req.params.id);
      aiManager.invalidate();
      res.json({ ok: true, keySet: false });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // 测试连接 — one minimal complete() against EXACTLY the named provider config
  // (config entry or registry id; freshly constructed, never the cached active),
  // raced against a short timeout. Always 200 with a typed { ok, … } result: an
  // unconfigured BYOK entry reports its HttpProviderNotConfiguredError message as
  // `reason` without touching any vendor SDK or the network.
  app.post("/api/ai/providers/:id/test", async (req, res, next) => {
    try {
      const body = z
        .object({ timeoutMs: z.number().int().min(250).max(30000).optional() })
        .parse(req.body ?? {});
      const candidate = await aiManager.providerForId(req.params.id);
      const result = await aiProvidersService.testProviderConnection(candidate, { timeoutMs: body.timeoutMs });
      res.json({ provider: { id: candidate.id, kind: candidate.capabilities.kind }, ...result });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // cli-agent detection probe (`<cli> --version`) for the settings rows' 已检测✓ /
  // 刷新检测 state. Only meaningful for the claude/codex families; anything else → 400.
  app.get("/api/ai/providers/:id/detect", async (req, res, next) => {
    try {
      const deps = await aiManager.getDeps();
      const config = deps ? (await aiProvidersService.readAiProvidersConfig(deps)).config : aiProvidersService.emptyAiProvidersConfig;
      const specId = aiProvidersService.cliSpecIdFor(req.params.id, config);
      if (!specId) {
        res.status(400).json({ error: `提供方 "${req.params.id}" 不是 cli-agent，无检测可做` });
        return;
      }
      const probe = aiConfig?.detectCliAgent ?? aiProvidersService.detectCliAgent;
      const result = await probe(specId);
      res.json({ id: req.params.id, spec: specId, ...result });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // —— Speech (SPEECH-1 TTS + SPEECH-2 STT, speech-and-young-learners.md §1–2) ——————
  // One service instance per app. TTS: the client's 朗读 action POSTs selected text
  // here and plays back the mp3 — server-side because the edge-tts wss handshake
  // (custom Sec-WebSocket-Version) only works in Node. STT: the mic's recorded blob
  // is proxied to the LOCAL faster-whisper sidecar (scripts/stt-sidecar) — free,
  // offline, no LLM in the loop; the transcript feeds existing flows as plain text.
  const speechSvc = speechService.createSpeechService({
    synthesizeEdge: speech?.synthesizeEdge,
    probeSttHealth: speech?.probeSttHealth,
    transcribeStt: speech?.transcribeStt,
    sttBaseUrl: speech?.sttBaseUrl
  });

  // Which lanes/voices exist — the client fetches this once and caches it to decide
  // whether the 朗读 buttons / the mic are enabled at all. The stt half is a REAL
  // (cached ~30s) sidecar health probe; `setupHint` points at the one-click guide.
  app.get("/api/speech/status", async (_req, res, next) => {
    try {
      res.json(await speechSvc.status());
    } catch (error) {
      next(error);
    }
  });

  // Synthesize one utterance → audio/mpeg bytes. Zod guards shape (empty / too-long
  // text → 400); an unknown voice → 400 (ValidationError via handleServiceError);
  // offline / upstream failure → 502 with the friendly { error, code } body.
  app.post("/api/speech/tts", async (req, res, next) => {
    try {
      const input = speechService.ttsRequestSchema.parse(req.body);
      const { audio, mimeType } = await speechSvc.synthesize(input);
      res.type(mimeType).send(audio);
    } catch (error) {
      if (error instanceof speechService.SpeechSynthesisFailedError) {
        res.status(502).json({ error: error.message, code: "tts_unavailable" });
        return;
      }
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // STT audio body: raw bytes (the MediaRecorder blob POSTed as-is), capped at 15MB.
  // The parser is wrapped so its PayloadTooLargeError becomes an honest 413 instead
  // of falling through to the generic 500 middleware.
  const sttRawParser = express.raw({
    type: ["audio/*", "video/webm", "application/octet-stream"],
    limit: speechService.STT_MAX_AUDIO_BYTES
  });
  const sttAudioBody: express.RequestHandler = (req, res, next) => {
    sttRawParser(req, res, (error?: unknown) => {
      if (!error) {
        next();
        return;
      }
      if ((error as { status?: number }).status === 413) {
        res.status(413).json({
          error: `音频超过 ${Math.floor(speechService.STT_MAX_AUDIO_BYTES / (1024 * 1024))}MB 上限 — 请分段录音`,
          code: "stt_audio_too_large"
        });
        return;
      }
      next(error);
    });
  };

  // Transcribe one recorded utterance via the LOCAL lane → { text, language }. The
  // sidecar missing/down → 502 { error, code: "stt_unavailable" } whose message IS
  // the setup guide pointer (the client renders the same steps as a small panel).
  app.post("/api/speech/stt", sttAudioBody, async (req, res, next) => {
    try {
      const { language } = speechService.sttQuerySchema.parse(req.query);
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        res.status(400).json({
          error: "请求体必须是录音的音频字节（Content-Type: audio/webm 等）",
          code: "stt_bad_audio"
        });
        return;
      }
      const result = await speechSvc.transcribe({
        audio: req.body,
        mimeType: req.get("content-type") ?? "application/octet-stream",
        language
      });
      res.json(result);
    } catch (error) {
      if (error instanceof speechService.SpeechTranscriptionFailedError) {
        res.status(502).json({ error: error.message, code: "stt_unavailable" });
        return;
      }
      if (!handleServiceError(res, error)) next(error);
    }
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

  // SRC-1 (source-authoring.md §4): blank-create an AUTHORED markdown/html document
  // (the Library 新建 group). Authored sources are the only ones with an editable body.
  app.post("/api/sources/authored", async (req, res, next) => {
    try {
      const input = sourceAuthoringService.createAuthoredSourceRequestSchema.parse(req.body);
      res.status(201).json(await sourceAuthoringService.createAuthoredSource({ vault }, input));
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // SRC-2: save an authored source's edited content — re-hash, bump `revision`, and
  // RE-PROJECT all of the source's anchors against the new content by quote+context
  // (import machinery); non-matching anchors surface as `unmatched` in the response.
  app.patch("/api/sources/:sourceId/content", async (req, res, next) => {
    try {
      const input = sourceAuthoringService.updateAuthoredSourceRequestSchema.parse(req.body);
      res.json(
        await sourceAuthoringService.updateAuthoredSource({ vault }, { sourceId: req.params.sourceId, ...input })
      );
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // SRC-2: the shared-source edit warning input — whether this source has publish-ledger
  // entries or shared layers (editing re-hashes → old shared packs stop binding).
  app.get("/api/sources/:sourceId/share-status", async (req, res, next) => {
    try {
      res.json(await sourceAuthoringService.getSourceShareStatus({ vault }, { sourceId: req.params.sourceId }));
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // SRC-3: fork an IMPORTED source into an editable AUTHORED copy — a new source that
  // copies the content; the original's notes/anchors stay on the original (§3).
  app.post("/api/sources/:sourceId/fork", async (req, res, next) => {
    try {
      const input = sourceForkService.forkSourceRequestSchema.parse(req.body ?? {});
      res.status(201).json(await sourceForkService.forkSource({ vault }, { sourceId: req.params.sourceId, ...input }));
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

  // Attachment bundle (ai-workspace.md §W2): a source's bounded body excerpt + its
  // (sealed-filtered) notes → the widened ChatContext.sources[]. A plain SOURCE read
  // (consistent with /rendered, /notes) so it rides the VaultTransport + directTransport
  // parity, not the chat lane. ?includeNotes=false skips the note read.
  app.get("/api/sources/:sourceId/bundle", async (req, res, next) => {
    try {
      const includeNotes = req.query.includeNotes !== "false";
      const bundle = await sourcesService.buildSourceBundle(
        { vault, sealed },
        { sourceId: req.params.sourceId, includeNotes }
      );
      res.json({ bundle });
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

  // Global search (SEARCH-1): ONE linear-scan query across notes (per-spec
  // toSearchText + anchor quotes) and sources (title/type) — ranked + capped per
  // family in the service. The commands family is client-side (the palette owns it).
  app.get("/api/search", async (req, res, next) => {
    try {
      const q = typeof req.query.q === "string" ? req.query.q : "";
      // SEARCH-2 filters (additive; absent params ⇒ SEARCH-1 path). Express already
      // parses repeated/comma params into string|string[]; parseSearchFilters normalizes.
      const filters = searchService.parseSearchFilters((name) => req.query[name] as string | string[] | undefined);
      const hits = await searchService.searchVault({ vault, sealed }, { q, filters });
      res.json({ hits });
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

  // Data trust (docs/design/data-trust.md §1–§2, TRUST-1/2): backup rotation +
  // full-vault export/import — src/server/dataTrust.ts. The service is always
  // routed (routes only act when called), but the AUTOMATIC behaviors follow the
  // aiConfig idiom: the pre-清除记忆 safety backup arms only when the `dataTrust`
  // option is present (real entry points pass it; bare-createApp unit tests stay
  // hermetic), and the 24h auto scheduler only on `scheduleAuto` (start.ts).
  const dataTrustService = createDataTrustService({
    vault,
    backupsDir: dataTrust?.backupsDir ?? defaultBackupsDir(vault.paths.rootDir),
    appVersion: packageJson.version,
    now: clock,
    onVaultReplaced: () => sealed.refresh()
  });
  if (dataTrust) {
    // 自动备份 before DESTRUCTIVE operations (doc §1): 清除记忆 is DELETE /api/memory.
    // Registered BEFORE registerMemoryRoutes so it runs first; best-effort (a failed
    // backup warns but never blocks the user-requested clear).
    app.delete("/api/memory", async (_req, _res, next) => {
      try {
        await dataTrustService.backupNow("pre-clear");
      } catch (error) {
        console.warn("[data-trust] pre-clear backup failed:", error instanceof Error ? error.message : error);
      }
      next();
    });
  }
  if (dataTrust?.scheduleAuto) {
    // App-start due-check + hourly re-check (unref'd; the memory-scheduler idiom).
    void createBackupScheduler(dataTrustService).start();
  }
  registerDataTrustRoutes(app, dataTrustService);

  // 回收站 (docs/design/data-trust.md §3, TRUST-3): the DELETE routes above already
  // SOFT-delete (notes/sources tombstone into the bin behind the same API shape);
  // these are the trash surfaces — list / restore / 永久删除 / 清空回收站 — plus the
  // 30d auto-purge, riding the same real-entry-point arming as the backup scheduler
  // (STUDY_VAULT_AUTO_BACKUP=0 kills both via scheduleAuto; STUDY_VAULT_TRASH_AUTO_PURGE=0
  // kills just the purge — e2e/dev vaults stay hermetic either way).
  const trashService = createTrashService({ vault, now: clock });
  if (dataTrust?.scheduleAuto && process.env.STUDY_VAULT_TRASH_AUTO_PURGE !== "0") {
    void createTrashPurgeScheduler(trashService).start();
  }
  registerTrashRoutes(app, trashService);

  // Learner-memory (docs/design/learner-memory.md): MEM-1 event capture/read/prune +
  // the capture switch, MEM-2 tiers (consolidate/digests/profile/clear-all) — see
  // src/server/memory.ts. Appends arm the idle/threshold consolidation scheduler
  // (unref'd timer; the app-start pass lives in start.ts beside migrateStudyLayers).
  const memoryDeps = { vault, now: clock };
  registerMemoryRoutes(app, { ...memoryDeps, consolidation: createMemoryConsolidationScheduler(memoryDeps) });

  // REV-3 SRS (docs/design/review-loop.md §4): the per-note schedule document —
  // services/reviewSchedule.ts. GET hands the queue policy its dueness input;
  // POST applies one grade through the pure core engine (skip never writes).
  app.get("/api/review/schedule", async (_req, res, next) => {
    try {
      res.json({ schedule: await reviewScheduleService.readReviewSchedule({ vault }) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/review/grade", async (req, res, next) => {
    try {
      res.json(await reviewScheduleService.recordReviewGrade({ vault, now: clock }, req.body));
    } catch (error) {
      next(error);
    }
  });

  // Agent loop A4a (docs/design/multi-provider-ai-agent.md §4.1(2)/§4.3): the
  // /api/agent/stream SSE route + read-only vault tool registration — src/server/agent.ts.
  registerAgentRoutes(app, { vault, getProvider });

  // AI chat sessions W1 (docs/design/ai-workspace.md §2.1): /api/chat/sessions
  // CRUD + append — src/server/chatSessions.ts. The chat transport below is
  // untouched; the client persists turns through these routes.
  registerChatRoutes(app, { vault, now: clock });

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

  app.delete("/api/concepts/:conceptId", async (req, res, next) => {
    try {
      res.json(await conceptsService.deleteConcept({ vault }, { conceptId: req.params.conceptId }));
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  app.post("/api/concepts/:conceptId/merge", async (req, res, next) => {
    try {
      const input = conceptsService.mergeConceptRequestSchema.parse(req.body);
      res.json(await conceptsService.mergeConcept({ vault }, { conceptId: req.params.conceptId, ...input }));
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

  // —— Concept graph (CG-1) — the CORE engine's read model, derived from vault
  // truth on every call (concepts + notes + relations; sealed notes merged like
  // listNotes). ?conceptId&depth = the inspector's neighborhood query; ?sourceId =
  // this-document scope. Plugins get GraphLens (client-side style), never a second
  // graph or a different assembly (user law 2026-07-04). ——
  app.get("/api/graph", async (req, res, next) => {
    try {
      const input = graphService.graphQuerySchema.parse({
        conceptId: typeof req.query.conceptId === "string" ? req.query.conceptId : undefined,
        depth: typeof req.query.depth === "string" ? req.query.depth : undefined,
        sourceId: typeof req.query.sourceId === "string" ? req.query.sourceId : undefined
      });
      res.json(await graphService.getConceptGraph({ vault, sealed }, input));
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
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

  // —— Triggers (PRO-1, proactive-learning §1) — the DEFINITION list. The client tick
  // reads it, unions the CODE-registered built-ins, and evaluates each with the pure
  // core evaluator against the REAL LOCAL clock (build-spec CLIENT-CENTRIC decision).
  // A bare list over the store (the operations-list idiom); no user-authoring routes in
  // PRO-1 (no seeded user triggers — the review-push exemplar is a client built-in). ——
  app.get("/api/triggers", async (_req, res, next) => {
    try {
      res.json({ triggers: await vault.stores.triggers.list() });
    } catch (error) {
      next(error);
    }
  });

  // Trigger FIRE STATE (raw JSON, trigger-fires.json). The client records a fire when it
  // SURFACES a nudge (delta #2), bucketed by its CLIENT-computed localDayKey (delta #1);
  // dismiss/snooze are the nudge-surface controls. The whole document read-back arms the
  // tick's restraint ctx.
  app.get("/api/triggers/fires", async (_req, res, next) => {
    try {
      res.json({ fires: await triggerFiresService.readTriggerFires({ vault }) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/triggers/:triggerId/fire", async (req, res, next) => {
    try {
      const input = triggerFiresService.recordFireSchema.parse(req.body);
      const state = await triggerFiresService.recordTriggerFire({ vault }, { triggerId: req.params.triggerId, ...input });
      res.json({ state });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  app.post("/api/triggers/:triggerId/snooze", async (req, res, next) => {
    try {
      const input = triggerFiresService.snoozeSchema.parse(req.body);
      const state = await triggerFiresService.snoozeTrigger({ vault }, { triggerId: req.params.triggerId, ...input });
      res.json({ state });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  app.post("/api/triggers/:triggerId/dismiss", async (req, res, next) => {
    try {
      const state = await triggerFiresService.dismissTrigger({ vault }, { triggerId: req.params.triggerId });
      res.json({ state });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // —— Plugin prefs (Kit & Plugin: disabled contributions + viewer pins + the M1 market
  // install state). Field-group ownership (see services/workspace.ts): the legacy PUT
  // owns the panel fields and PRESERVES the stored market fields, so a stale full-body
  // PUT from the workspace seams can never clobber an install; the /catalog PUT is the
  // market's single write seam for catalogState (+ userKits). GET returns everything. ——
  app.get("/api/plugin-prefs", async (_req, res, next) => {
    try {
      res.json({ prefs: await workspaceService.readPluginPrefs({ vault }) });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  app.put("/api/plugin-prefs", async (req, res, next) => {
    try {
      const body = workspaceService.pluginPrefsSchema.parse(req.body);
      res.json({ prefs: await workspaceService.writePluginPanelPrefs({ vault }, body) });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  app.put("/api/plugin-prefs/catalog", async (req, res, next) => {
    try {
      const body = z
        .object({
          catalogState: workspaceService.catalogStateSchema,
          userKits: z.array(workspaceService.userKitSchema).optional()
        })
        .parse(req.body);
      res.json({ prefs: await workspaceService.writePluginCatalogPrefs({ vault }, body) });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // —— Workspace layout (UI state) —————————————————————————————————————
  // Field-group ownership (see services/workspace.ts, the M1 plugin-prefs rule):
  // the legacy PUT owns activeLayoutId+layouts and PRESERVES the stored onboarding
  // block, so the WorkspaceContext full-body layout PUT can never clobber checklist
  // progress; /onboarding is the checklist's single write seam. GET returns everything.
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
      res.json({ workspace: await workspaceService.writeWorkspaceLayout({ vault }, state) });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // —— Onboarding checklist state (SHELL-2 first-run block in workspace.json) ——
  app.get("/api/workspace/onboarding", async (_req, res, next) => {
    try {
      res.json({ onboarding: await workspaceService.readWorkspaceOnboarding({ vault }) });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  app.put("/api/workspace/onboarding", async (req, res, next) => {
    try {
      const onboarding = workspaceService.onboardingStateSchema.parse(req.body);
      res.json({ onboarding: await workspaceService.writeWorkspaceOnboarding({ vault }, onboarding) });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // —— App-shell preferences (I18N locale, independent workspace.json field group) ——
  app.get("/api/workspace/ui-prefs", async (_req, res, next) => {
    try {
      res.json({ prefs: await workspaceService.readWorkspaceUiPrefs({ vault }) });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  app.put("/api/workspace/ui-prefs", async (req, res, next) => {
    try {
      const prefs = workspaceService.uiPrefsSchema.parse(req.body);
      res.json({ prefs: await workspaceService.writeWorkspaceUiPrefs({ vault }, prefs) });
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
      res.json(await aiService.chatComplete({ provider: await getProvider() }, input));
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // W3 (ai-workspace §W3): synthesize a chat transcript (+ its W2 attachments) into a
  // NEW markdown source. HTTP-ONLY like every AI route — the direct transport carries
  // no provider and excludes AI (DELTA 2), so there is NO parity route here. A
  // structured-generation failure or a bare-path result → 400 (a client/AI problem).
  app.post("/api/chat/synthesize", async (req, res, next) => {
    try {
      const input = synthesisService.synthesizeRequestSchema.parse(req.body);
      const result = await synthesisService.synthesizeDocument({ provider: await getProvider(), vault }, input);
      res.status(201).json(result);
    } catch (error) {
      if (error instanceof StructuredGenerationError || error instanceof SynthesisPathResultError) {
        res.status(400).json({ error: error.message });
        return;
      }
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
      const provider = await getProvider();
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
      res.json(await aiService.generateKitContent({ vault, provider: await getProvider() }, input));
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
      res.json(await aiService.generateBlock({ provider: await getProvider() }, input));
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // AI-assisted classification — the low-confidence fallback behind the client's
  // resolveFormAsync (heuristic stays primary) — see services/ai.ts.
  app.post("/api/notes/classify", async (req, res, next) => {
    try {
      const input = aiService.generateBlockSchema.parse(req.body);
      res.json(await aiService.classifyText({ provider: await getProvider() }, input));
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


