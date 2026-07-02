// Protected `.svpack` sharing UI (docs/design/studypack-sharing.md §5–§7) — the two
// dialogs the Layers pane (layerViews) opens, plus the sealed-imports manager list:
//
//   • SvpackExportDialog — publisher flow (§5.2): recipient labels + 有效期 →
//     POST /api/layers/:id/export-svpack → the ONE-TIME code roster (per-recipient
//     copy) + the `.svpack` file download. Codes are bearer capabilities shown exactly
//     once (the ledger keeps them only encrypted), so the roster step blocks casual
//     backdrop/Esc dismissal and states the honest soft limits (§1).
//   • SvpackImportDialog — recipient flow (§6.1): pick file → auto-INSPECT (no code:
//     title, publisher fingerprint + TOFU pin status, local source match) → code
//     (paste-tolerant) → OPEN (re-anchor preview counts) → COMMIT (sealed, read-only)
//     → success. Includes the sealed-imports list (GET /api/svpack + delete).
//
// All data access goes through entityClient (views never fetch). Server failures carry
// a machine `code` (ApiError) that maps to an HONEST Chinese message — wrong code,
// expired, stale revision and publisher-key mismatch are never blurred together.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Copy, Download, Plus, Trash2, Upload, X } from "lucide-react";
import {
  ApiError,
  entityClient,
  type SealedPackRow,
  type SealedPackStatus,
  type StudyLayerRecord,
  type SvpackCommitResult,
  type SvpackExportResult,
  type SvpackInspectResult,
  type SvpackOpenResult,
  type SvpackPinStatus,
  type SvpackValidity
} from "../data/entityClient";

// —— Pure helpers (exported for tests) ————————————————————————————————————————

/** Map a server failure to an honest user message, keyed on the machine `code`. */
export function mapSvpackError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "wrong-code":
      case "not-entitled":
      case "malformed-code":
        return "口令不对或不属于此包";
      case "expired":
        return "包已过期，联系分享者续期";
      case "not-yet-valid":
        return "包尚未生效，请在生效日期后再导入";
      case "clock-rollback":
        return "检测到系统时钟被回拨，暂时无法打开此包";
      case "stale-revision":
        return "已导入更新版本，此文件是旧版本";
      case "pinned-mismatch":
      case "publisher-key-changed":
        return "发布者密钥与之前固定的不一致 — 这不是同一个发布者，请先核实来源";
      case "malformed-pack":
        return "文件不是有效的 .svpack";
      case "signature-invalid":
      case "self-certification-failed":
        return "签名校验失败 — 文件可能已被篡改";
      default:
        return error.message;
    }
  }
  return error instanceof Error ? error.message : "操作失败";
}

/** Paste-tolerant code normalization: strip spaces/dashes, uppercase (server re-checks). */
export function normalizeCodeInput(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

/** Roster codes arrive display-formatted (8×5) from the server; group locally if not. */
export function formatCodeGroups(code: string): string {
  if (code.includes("-")) return code;
  return code.replace(/[\s]/g, "").replace(/(.{5})(?=.)/g, "$1-");
}

/** Default 有效期 date (yyyy-mm-dd): today + 30 days, local time. */
export function defaultValidUntilDate(now: Date = new Date()): string {
  const date = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A picked 有效期 date means "usable through that day": local end-of-day → ISO. */
export function validUntilIso(date: string): string {
  return new Date(`${date}T23:59:59`).toISOString();
}

/** Human summary of a pack's validity window. */
export function validityText(validity: SvpackValidity): string {
  return validity.validUntil ? `有效期至 ${validity.validUntil.slice(0, 10)}` : "长期有效";
}

/** File → base64 via FileReader.readAsDataURL (strip the data-URL prefix). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.onload = () => {
      const url = String(reader.result ?? "");
      const comma = url.indexOf(",");
      resolve(comma >= 0 ? url.slice(comma + 1) : url);
    };
    reader.readAsDataURL(file);
  });
}

/** Trigger a browser/Electron-renderer download of the pack bytes. */
export function downloadSvpackFile(fileB64: string, fileName: string): void {
  const bytes = Uint8Array.from(atob(fileB64), (ch) => ch.charCodeAt(0));
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const PIN_STATUS_TEXT: Record<SvpackPinStatus, string> = {
  unknown: "首次见到该发布者 — 请与分享者当面/群内核对上方指纹",
  "pinned-match": "发布者已固定 ✓ 与之前导入的一致",
  "pinned-mismatch": "⚠ 发布者密钥不匹配 — 这不是你之前导入过的那个发布者，请勿输入口令，先核实来源"
};

const SEALED_STATUS_LABEL: Record<SealedPackStatus, string> = {
  active: "有效",
  expired: "已过期",
  "not-yet-valid": "未生效",
  "clock-rollback": "时钟异常",
  unreadable: "无法读取"
};

// —— Shared dialog chrome (reuses the FocusOverlay modal classes) ————————————————

function SvpackDialog({
  title,
  onClose,
  guarded = false,
  children
}: {
  title: string;
  onClose(): void;
  /** Block backdrop/Esc dismissal (the one-time roster must not vanish by accident). */
  guarded?: boolean;
  children: ReactNode;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="sv-focus-overlay svpack-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !guarded) onClose();
      }}
    >
      <div
        className="sv-focus-dialog svpack-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !guarded) {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="sv-focus-head">
          <span className="sv-focus-title">{title}</span>
          <button type="button" className="sv-focus-close" aria-label="关闭" title="关闭" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="sv-focus-body svpack-body">{children}</div>
      </div>
    </div>,
    document.body
  );
}

// —— Export dialog (publisher, §5.2) ————————————————————————————————————————————

export function SvpackExportDialog({ layer, onClose }: { layer: StudyLayerRecord; onClose(): void }) {
  // Step 1 form state: one label input per recipient (≥1 non-empty required).
  const [labels, setLabels] = useState<string[]>([""]);
  const [validDate, setValidDate] = useState(defaultValidUntilDate());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Step 2: the one-time roster (codes never shown again after this dialog closes).
  const [result, setResult] = useState<SvpackExportResult | null>(null);

  const cleanLabels = labels.map((label) => label.trim()).filter(Boolean);
  const canSubmit = !busy && cleanLabels.length >= 1 && validDate.length > 0;

  const submit = useCallback(async () => {
    if (busy || cleanLabels.length < 1 || !validDate) return;
    setBusy(true);
    setError("");
    try {
      const exported = await entityClient.exportSvpack(layer.id, {
        recipients: cleanLabels.map((label) => ({ label })),
        validUntil: validUntilIso(validDate)
      });
      setResult(exported);
    } catch (err) {
      setError(mapSvpackError(err));
    } finally {
      setBusy(false);
    }
  }, [busy, cleanLabels, validDate, layer.id]);

  const copyCode = useCallback((code: string) => {
    void navigator.clipboard?.writeText(code);
  }, []);

  return (
    <SvpackDialog title={`分享「${layer.title}」（受保护 .svpack）`} onClose={onClose} guarded={!!result}>
      {error ? <div className="error-box">{error}</div> : null}

      {!result ? (
        <div className="svpack-step svpack-export-form">
          <div className="svpack-field-label">接收者（每人一个专属口令）</div>
          <div className="svpack-recipients">
            {labels.map((value, index) => (
              <div key={index} className="svpack-recipient-row">
                <input
                  className="svpack-recipient-input"
                  value={value}
                  placeholder={`接收者 ${index + 1}（如：张三）`}
                  onChange={(event) =>
                    setLabels(labels.map((label, i) => (i === index ? event.target.value : label)))
                  }
                />
                <button
                  type="button"
                  className="link-button svpack-recipient-remove"
                  aria-label="移除接收者"
                  title="移除接收者"
                  disabled={labels.length <= 1}
                  onClick={() => setLabels(labels.filter((_, i) => i !== index))}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="link-button svpack-recipient-add"
            onClick={() => setLabels([...labels, ""])}
          >
            <Plus size={13} /> 添加接收者
          </button>

          <label className="svpack-field-label" htmlFor="svpack-valid-until">
            有效期至
          </label>
          <input
            id="svpack-valid-until"
            className="svpack-valid-until"
            type="date"
            value={validDate}
            onChange={(event) => setValidDate(event.target.value)}
          />

          {/* Honest soft limits (§1): publishers must know the offline ceiling. */}
          <div className="svpack-soft-limits">
            口令即访问权：拿到口令的人可在任何设备打开此包；到期后内容停止显示。应用内禁止再导出/复制，
            但截图与手抄无法被阻止（泄露的文本可经水印溯源到对应口令）。
          </div>

          <div className="svpack-actions">
            <button
              type="button"
              className="icon-button primary svpack-export-submit"
              disabled={!canSubmit}
              onClick={() => void submit()}
            >
              {busy ? "生成中…" : "生成分享包"}
            </button>
            <button type="button" className="link-button svpack-export-cancel" onClick={onClose}>
              取消
            </button>
          </div>
        </div>
      ) : (
        <div className="svpack-step svpack-roster-step">
          <div className="svpack-once-warning">
            口令仅显示这一次 — 请立即复制并分别私发给对应接收者，关闭后无法再次查看。
          </div>
          {result.refusedCount > 0 ? (
            <div className="svpack-refused-note">
              {result.refusedCount} 条受保护（不可再导出）的笔记未包含在分享包中。
            </div>
          ) : null}
          <ul className="svpack-roster">
            {result.roster.map((row) => (
              <li key={row.codeId} className="svpack-roster-row">
                <span className="svpack-roster-label">{row.label}</span>
                <code className="svpack-code">{formatCodeGroups(row.code)}</code>
                <button
                  type="button"
                  className="link-button svpack-copy-btn"
                  title={`复制 ${row.label} 的口令`}
                  onClick={() => copyCode(formatCodeGroups(row.code))}
                >
                  <Copy size={13} /> 复制
                </button>
              </li>
            ))}
          </ul>
          <div className="svpack-actions">
            <button
              type="button"
              className="icon-button primary svpack-download-btn"
              onClick={() =>
                downloadSvpackFile(
                  result.fileB64,
                  result.fileName || `pack-${result.packId}-r${result.revision}.svpack`
                )
              }
            >
              <Download size={15} /> 下载 .svpack
            </button>
            <button type="button" className="link-button svpack-roster-close" onClick={onClose}>
              我已保存口令，关闭
            </button>
          </div>
        </div>
      )}
    </SvpackDialog>
  );
}

// —— Import dialog (recipient, §6.1) + sealed-imports list ————————————————————————

export function SvpackImportDialog({ onClose, onCommitted }: { onClose(): void; onCommitted(): void }) {
  const [fileB64, setFileB64] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [inspect, setInspect] = useState<SvpackInspectResult | null>(null);
  const [code, setCode] = useState("");
  const [opened, setOpened] = useState<SvpackOpenResult | null>(null);
  const [committed, setCommitted] = useState<SvpackCommitResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sealedRows, setSealedRows] = useState<SealedPackRow[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const loadSealed = useCallback(async () => {
    try {
      const { packs } = await entityClient.sealedImports();
      setSealedRows(packs);
    } catch {
      // The manager list failing must not block an import; the section just stays empty.
    }
  }, []);

  useEffect(() => {
    void loadSealed();
  }, [loadSealed]);

  // File picked → base64 → auto-inspect (no code needed; §6.1 step 1).
  const onFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setError("");
    setInspect(null);
    setOpened(null);
    setCommitted(null);
    setCode("");
    try {
      const b64 = await fileToBase64(file);
      setFileB64(b64);
      setFileName(file.name);
      setInspect(await entityClient.inspectSvpack(b64));
    } catch (err) {
      setFileB64(null);
      setError(mapSvpackError(err));
    }
  }, []);

  // Code entered → open (decrypt + re-anchor preview; nothing persisted).
  const openPreview = useCallback(async () => {
    if (!fileB64) return;
    setBusy(true);
    setError("");
    setOpened(null);
    try {
      setOpened(await entityClient.openSvpack(fileB64, normalizeCodeInput(code)));
    } catch (err) {
      setError(mapSvpackError(err));
    } finally {
      setBusy(false);
    }
  }, [fileB64, code]);

  // Commit into the sealed store, then refresh the workspace (layers + reader repaint).
  const commit = useCallback(async () => {
    if (!fileB64) return;
    setBusy(true);
    setError("");
    try {
      const result = await entityClient.commitSvpack(fileB64, normalizeCodeInput(code));
      setCommitted(result);
      onCommitted();
      void loadSealed();
    } catch (err) {
      setError(mapSvpackError(err));
    } finally {
      setBusy(false);
    }
  }, [fileB64, code, onCommitted, loadSealed]);

  const removeSealed = useCallback(
    async (packId: string) => {
      if (typeof window !== "undefined" && !window.confirm("删除该导入的分享包？其密封内容将从本机移除。")) {
        return;
      }
      setError("");
      try {
        await entityClient.deleteSealedImport(packId);
        await loadSealed();
        onCommitted(); // the sealed layer/notes just left the read model
      } catch (err) {
        setError(mapSvpackError(err));
      }
    },
    [loadSealed, onCommitted]
  );

  return (
    <SvpackDialog title="导入 .svpack（受保护分享包）" onClose={onClose}>
      {error ? <div className="error-box">{error}</div> : null}

      <section className="svpack-file-pick">
        <button type="button" className="icon-button svpack-pick-btn" onClick={() => fileRef.current?.click()}>
          <Upload size={15} /> 选择 .svpack 文件
        </button>
        {fileName ? <span className="svpack-file-name">{fileName}</span> : null}
        <input
          ref={fileRef}
          className="svpack-import-file"
          type="file"
          accept=".svpack"
          style={{ display: "none" }}
          onChange={(event) => {
            void onFile(event.target.files?.[0]);
            event.target.value = ""; // allow re-picking the same file
          }}
        />
      </section>

      {/* Inspect summary — everything shown here needs NO code (cleartext header). */}
      {inspect ? (
        <section className="svpack-inspect">
          <div className="svpack-inspect-title">
            {inspect.header.title || "（未命名图层）"}
            <span className="svpack-revision">r{inspect.header.revision}</span>
          </div>
          <div className="svpack-publisher">
            发布者：{inspect.header.publisher.displayName}
            <code className="svpack-fingerprint">{inspect.header.publisher.id}</code>
          </div>
          <div className="svpack-pin" data-status={inspect.pinStatus}>
            {PIN_STATUS_TEXT[inspect.pinStatus]}
          </div>
          <div className="svpack-source-match" data-matched={inspect.sourceMatch ? "true" : "false"}>
            {inspect.sourceMatch
              ? `匹配到本地源：《${inspect.sourceMatch.title}》`
              : "未匹配到本地源 — 仍可导入，绑定源后可见"}
          </div>
          <div className="svpack-meta">
            {inspect.header.contentTypes.length > 0 ? (
              <span className="svpack-content-types">内容类型：{inspect.header.contentTypes.join("、")}</span>
            ) : null}
            <span className="svpack-validity">{validityText(inspect.header.validity)}</span>
          </div>
        </section>
      ) : null}

      {/* Code entry → preview → commit (§6.1 steps 2–3). */}
      {fileB64 && inspect && !committed ? (
        <section className="svpack-code-entry">
          <label className="svpack-field-label" htmlFor="svpack-code-input">
            你的口令
          </label>
          <input
            id="svpack-code-input"
            className="svpack-code-input"
            value={code}
            placeholder="粘贴口令（可含空格/短横线，不区分大小写）"
            onChange={(event) => {
              setCode(event.target.value);
              setOpened(null); // a changed code invalidates the previous preview
            }}
          />
          <div className="svpack-actions">
            <button
              type="button"
              className="icon-button svpack-open-btn"
              disabled={busy || normalizeCodeInput(code).length === 0}
              onClick={() => void openPreview()}
            >
              打开预览
            </button>
            <button
              type="button"
              className="icon-button primary svpack-commit-btn"
              disabled={busy || !opened}
              onClick={() => void commit()}
            >
              导入
            </button>
          </div>
        </section>
      ) : null}

      {/* Re-anchor preview counts (reuses the .studypack import stat chips). */}
      {opened && !committed ? (
        <section className="svpack-preview">
          <div className="layer-preview-stats">
            <span className="layer-stat" data-status="matched">
              匹配 {opened.preview.stats.matched}
            </span>
            <span className="layer-stat" data-status="fuzzy">
              模糊 {opened.preview.stats.fuzzy}
            </span>
            <span className="layer-stat" data-status="unmatched">
              未匹配 {opened.preview.stats.unmatched}
            </span>
          </div>
        </section>
      ) : null}

      {committed ? (
        <section className="svpack-success">
          <div className="svpack-success-head">导入成功（密封只读）</div>
          <div className="svpack-success-counts">
            笔记 {committed.counts.notes} 条 · 锚点 {committed.counts.anchors} 个
          </div>
          <div className="svpack-success-note">
            密封内容只读；你可以在其上添加自己的笔记（属于你，可导出）。到期后内容将停止显示。
          </div>
          <div className="svpack-actions">
            <button type="button" className="icon-button svpack-done-btn" onClick={onClose}>
              完成
            </button>
          </div>
        </section>
      ) : null}

      <section className="svpack-sealed-list">
        <div className="svpack-section-title">已导入的分享包</div>
        {sealedRows.length === 0 ? (
          <div className="empty-state">暂无密封导入。</div>
        ) : (
          <ul className="svpack-sealed-rows">
            {sealedRows.map((row) => (
              <li key={row.packId} className="svpack-sealed-row" data-status={row.status}>
                <span className="svpack-sealed-title">{row.echo?.title || row.packId}</span>
                <span className="svpack-status" data-status={row.status}>
                  {SEALED_STATUS_LABEL[row.status]}
                </span>
                {row.counts ? <span className="svpack-sealed-counts">{row.counts.notes} 条笔记</span> : null}
                <button
                  type="button"
                  className="link-button svpack-sealed-delete"
                  aria-label={`删除 ${row.echo?.title || row.packId}`}
                  onClick={() => void removeSealed(row.packId)}
                >
                  <Trash2 size={13} /> 删除
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </SvpackDialog>
  );
}
