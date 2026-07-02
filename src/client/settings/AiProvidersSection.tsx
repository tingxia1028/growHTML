// AI 提供方 settings section (A3b — docs/design/multi-provider-ai-agent.md §4.2
// settings sketch). Replaces the SHELL-1 read-only stub in the Settings Hub via the
// SAME registerSettingsSection id ("ai-providers" — re-registration replaces).
//
// One section, four jobs:
//   1. Provider LIST — every registry built-in + every stored BYOK entry, with kind
//      badges, capability chips (对话/流式/结构化/工具), cli-agent detection status
//      (auto-probed once + 刷新检测), and a per-row 测试连接.
//   2. ACTIVE picker — a radio persisted through the field-group-safe /active seam.
//      The env override (STUDY_VAULT_AI_PROVIDER) is surfaced as a banner: explicit
//      env BEATS config, so the radio edits the stored choice for when it lifts.
//   3. BYOK add/edit — preset picker (DeepSeek / OpenAI-compatible) → label/model/
//      baseUrl/key. The key field is WRITE-ONLY: it is sent once to the key seam,
//      cleared, and never echoed back (rows only ever see the keySet flag).
//   4. Honest storage states — safeStorage (encrypted at rest) vs env-only builds
//      (web/dev: no key persistence; the UI says so and names the env vars).
//
// Managed (托管积分) stays a DISABLED placeholder until G-A3b.
// Data flows through settingsIo only (the hub's swappable seam) — never raw fetch.

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AiProviderCapabilities,
  AiProviderEntryInput,
  AiProviderEntryView,
  AiProvidersInfo
} from "../data/entityClient";
import { getSettingsIo } from "./settingsIo";

export const PROVIDER_KIND_LABEL: Record<string, string> = {
  mock: "离线 Mock",
  "cli-agent": "本地 CLI（订阅）",
  http: "BYOK API",
  managed: "托管积分"
};

const HTTP_PRESETS = [
  { id: "deepseek", label: "DeepSeek", modelPlaceholder: "deepseek-v4-flash（默认）", baseUrlRequired: false },
  {
    id: "openai-compatible",
    label: "OpenAI 兼容端点（OpenRouter / Ollama / …）",
    modelPlaceholder: "例如 deepseek/deepseek-v4 或 llama4:8b",
    baseUrlRequired: true
  }
] as const;

type HttpPresetId = (typeof HTTP_PRESETS)[number]["id"];

const PRESET_ENV_VARS: Record<HttpPresetId, string> = {
  deepseek: "DEEPSEEK_API_KEY",
  "openai-compatible": "OPENAI_COMPATIBLE_API_KEY"
};

/** The claude/codex families are probe-able local binaries. */
function isDetectableCliId(id: string): boolean {
  return ["claude-cli", "claude-pty", "claude-agent", "codex", "claude"].includes(id.toLowerCase());
}

type Row = {
  id: string;
  kind: string;
  label: string;
  source: "builtin" | "config";
  capabilities?: AiProviderCapabilities;
  entry?: AiProviderEntryView;
};

type TestState = { status: "busy" | "ok" | "fail"; text: string };
type DetectState = { status: "busy" | "ok" | "fail"; version?: string };

type FormState = {
  mode: "add" | "edit";
  entryId?: string;
  preset: HttpPresetId;
  label: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  keySet: boolean;
};

const emptyForm = (mode: "add" | "edit"): FormState => ({
  mode,
  preset: "deepseek",
  label: "",
  model: "",
  baseUrl: "",
  apiKey: "",
  keySet: false
});

function makeEntryId(preset: string, taken: Set<string>): string {
  for (let n = 1; ; n += 1) {
    const candidate = `${preset}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Strip view-only fields back into the PUT body shape (keySet/capabilities are server-computed). */
function toEntryInput(view: AiProviderEntryView): AiProviderEntryInput {
  return {
    id: view.id,
    kind: view.kind,
    preset: view.preset,
    label: view.label,
    baseUrl: view.baseUrl,
    model: view.model
  };
}

function CapabilityChips({ capabilities }: { capabilities?: AiProviderCapabilities }) {
  if (!capabilities) return null;
  const chips = [
    capabilities.chat ? "对话" : "",
    capabilities.streaming ? "流式" : "",
    capabilities.structured ? "结构化" : "",
    capabilities.tools ? "工具" : ""
  ].filter(Boolean);
  return (
    <span className="settings-ai-caps">
      {chips.map((chip) => (
        <span key={chip} className="settings-ai-cap">
          {chip}
        </span>
      ))}
    </span>
  );
}

export function AiProvidersSection() {
  const [info, setInfo] = useState<AiProvidersInfo | null>(null);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [detects, setDetects] = useState<Record<string, DetectState>>({});
  const probedRef = useRef(new Set<string>());
  const aliveRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const next = await getSettingsIo().fetchProviders();
      if (aliveRef.current) {
        setInfo(next);
        setLoadError("");
      }
    } catch {
      if (aliveRef.current) setLoadError("无法读取 AI 提供方状态");
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void load();
    return () => {
      aliveRef.current = false;
    };
  }, [load]);

  const detect = useCallback(async (id: string) => {
    setDetects((prev) => ({ ...prev, [id]: { status: "busy" } }));
    try {
      const result = await getSettingsIo().detectProvider(id);
      if (!aliveRef.current) return;
      setDetects((prev) => ({
        ...prev,
        [id]: result.ok ? { status: "ok", version: result.version } : { status: "fail" }
      }));
    } catch {
      if (aliveRef.current) setDetects((prev) => ({ ...prev, [id]: { status: "fail" } }));
    }
  }, []);

  // Auto-probe each detectable cli-agent row ONCE per mount; 刷新检测 re-runs it.
  useEffect(() => {
    if (!info) return;
    for (const descriptor of info.providers) {
      if (descriptor.kind === "cli-agent" && isDetectableCliId(descriptor.id) && !probedRef.current.has(descriptor.id)) {
        probedRef.current.add(descriptor.id);
        void detect(descriptor.id);
      }
    }
  }, [info, detect]);

  if (loadError) return <p className="settings-hub-muted">{loadError}</p>;
  if (!info) return <p className="settings-hub-muted">检测中…</p>;

  const config = info.config ?? null;
  const keyStore = info.keyStore ?? { kind: "env-only" as const, persistent: false };
  const canPersistKeys = keyStore.persistent;
  const configWritable = config !== null;

  const rows: Row[] = [
    ...info.providers.map((descriptor) => ({
      id: descriptor.id,
      kind: descriptor.kind,
      label: descriptor.label,
      source: "builtin" as const,
      capabilities: descriptor.capabilities
    })),
    ...(config?.providers ?? []).map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      label: entry.label || entry.id,
      source: "config" as const,
      capabilities: entry.capabilities,
      entry
    }))
  ];

  const run = async (action: () => Promise<unknown>, failText: string) => {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      await action();
      await load();
    } catch (error) {
      setNotice(error instanceof Error && error.message ? error.message : failText);
    } finally {
      setBusy(false);
    }
  };

  const activate = (id: string) => void run(() => getSettingsIo().saveActiveProvider(id), "切换提供方失败");
  const clearActive = () => void run(() => getSettingsIo().saveActiveProvider(null), "恢复默认失败");

  const testConnection = async (id: string) => {
    setTests((prev) => ({ ...prev, [id]: { status: "busy", text: "测试中…" } }));
    try {
      const result = await getSettingsIo().testProvider(id);
      if (!aliveRef.current) return;
      setTests((prev) => ({
        ...prev,
        [id]: result.ok
          ? { status: "ok", text: `连接成功 · ${result.latencyMs}ms` }
          : { status: "fail", text: `失败：${result.reason ?? "未知原因"}` }
      }));
    } catch (error) {
      if (!aliveRef.current) return;
      const text = error instanceof Error && error.message ? error.message : "测试请求失败";
      setTests((prev) => ({ ...prev, [id]: { status: "fail", text: `失败：${text}` } }));
    }
  };

  const openEdit = (entry: AiProviderEntryView) => {
    setForm({
      mode: "edit",
      entryId: entry.id,
      preset: (entry.preset === "openai-compatible" ? "openai-compatible" : "deepseek") as HttpPresetId,
      label: entry.label ?? "",
      model: entry.model ?? "",
      baseUrl: entry.baseUrl ?? "",
      apiKey: "",
      keySet: entry.keySet
    });
    setNotice("");
  };

  const removeEntry = (id: string) => {
    const remaining = (config?.providers ?? []).filter((entry) => entry.id !== id).map(toEntryInput);
    void run(() => getSettingsIo().saveProviderList(remaining), "删除提供方失败");
  };

  const clearSavedKey = (entryId: string) => {
    void run(() => getSettingsIo().deleteProviderKey(entryId), "清除密钥失败");
    setForm((prev) => (prev && prev.entryId === entryId ? { ...prev, keySet: false } : prev));
  };

  const submitForm = async () => {
    if (!form || !config) return;
    const presetSpec = HTTP_PRESETS.find((preset) => preset.id === form.preset)!;
    if (presetSpec.baseUrlRequired && (!form.baseUrl.trim() || !form.model.trim())) {
      setNotice("OpenAI 兼容端点需要填写 Base URL 和模型");
      return;
    }
    const existing = config.providers.map(toEntryInput);
    const entryId =
      form.mode === "edit" && form.entryId
        ? form.entryId
        : makeEntryId(form.preset, new Set([...existing.map((entry) => entry.id), ...rows.map((row) => row.id)]));
    const entry: AiProviderEntryInput = {
      id: entryId,
      kind: "http",
      preset: form.preset,
      label: form.label.trim() || presetSpec.label,
      baseUrl: form.baseUrl.trim() || undefined,
      model: form.model.trim() || undefined
    };
    const nextList =
      form.mode === "edit"
        ? existing.map((candidate) => (candidate.id === entryId ? entry : candidate))
        : [...existing, entry];
    const apiKey = form.apiKey; // never logged, never rendered — sent once below
    await run(async () => {
      await getSettingsIo().saveProviderList(nextList);
      if (apiKey.trim()) await getSettingsIo().saveProviderKey(entryId, apiKey.trim());
    }, "保存提供方失败");
    setForm(null);
  };

  const active = info.active;
  const activeSource = info.activeSource ?? "default";
  const sourceLabel: Record<string, string> = {
    injected: "测试注入",
    env: "环境变量",
    config: "已保存配置",
    default: "默认"
  };

  return (
    <div className="settings-ai-section">
      <p className="settings-active-provider" data-provider-id={active.id} data-provider-kind={active.kind}>
        当前生效:<strong>{active.id}</strong>
        <span className="settings-provider-kind">{PROVIDER_KIND_LABEL[active.kind] ?? active.kind}</span>
        <span className="settings-ai-source" data-active-source={activeSource}>
          来源:{sourceLabel[activeSource] ?? activeSource}
        </span>
      </p>

      {info.envProviderId ? (
        <p className="settings-ai-banner settings-env-override-note">
          环境变量 STUDY_VAULT_AI_PROVIDER = {info.envProviderId} 已设置——它会覆盖下方选择（显式优先于配置）。
        </p>
      ) : null}
      {!canPersistKeys ? (
        <p className="settings-ai-banner settings-keystore-note">
          当前运行环境无法安全保存 API 密钥{keyStore.reason ? `（${keyStore.reason}）` : ""}
          ——密钥请通过环境变量提供（DEEPSEEK_API_KEY / OPENAI_COMPATIBLE_API_KEY）。桌面版将密钥经系统加密
          （safeStorage）保存。
        </p>
      ) : null}
      {config?.error ? <p className="settings-hub-error-text settings-ai-config-error">{config.error}</p> : null}
      {notice ? <p className="settings-hub-error-text settings-ai-notice">{notice}</p> : null}

      <ul className="settings-provider-list settings-ai-rows">
        {rows.map((row) => {
          const isManaged = row.kind === "managed";
          const checked = config?.activeProviderId === row.id;
          const test = tests[row.id];
          const detectState = detects[row.id];
          const detectable = row.kind === "cli-agent" && isDetectableCliId(row.entry?.preset ?? row.id);
          return (
            <li key={row.id} className="settings-ai-row" data-provider-id={row.id} data-provider-kind={row.kind}>
              <div className="settings-ai-row-main">
                <label className="settings-ai-pick">
                  <input
                    type="radio"
                    name="settings-ai-active"
                    className="settings-ai-radio"
                    checked={checked}
                    disabled={busy || isManaged || !configWritable}
                    onChange={() => activate(row.id)}
                  />
                  <span className="settings-provider-label">{row.label}</span>
                </label>
                <code className="settings-provider-id">{row.id}</code>
                <span className="settings-provider-kind">{PROVIDER_KIND_LABEL[row.kind] ?? row.kind}</span>
                <CapabilityChips capabilities={row.capabilities} />
                {row.entry ? (
                  <span className="settings-ai-key-badge" data-key-set={row.entry.keySet}>
                    {row.entry.keySet ? "密钥已保存 ●" : "未设密钥"}
                  </span>
                ) : null}
              </div>
              <div className="settings-ai-row-actions">
                {detectable ? (
                  <span className="settings-ai-detect" data-detect-status={detectState?.status ?? "idle"}>
                    {detectState?.status === "busy"
                      ? "检测中…"
                      : detectState?.status === "ok"
                        ? `已检测✓${detectState.version ? ` ${detectState.version}` : ""}`
                        : detectState?.status === "fail"
                          ? "未检测到"
                          : "未检测"}
                    <button
                      type="button"
                      className="settings-ai-mini-btn settings-ai-detect-btn"
                      disabled={detectState?.status === "busy"}
                      onClick={() => void detect(row.id)}
                    >
                      刷新检测
                    </button>
                  </span>
                ) : null}
                {isManaged ? (
                  <span className="settings-ai-managed-note">托管积分即将上线（G-A3b），暂不可选</span>
                ) : (
                  <button
                    type="button"
                    className="settings-ai-mini-btn settings-ai-test-btn"
                    disabled={test?.status === "busy"}
                    onClick={() => void testConnection(row.id)}
                  >
                    测试连接
                  </button>
                )}
                {row.entry ? (
                  <>
                    <button
                      type="button"
                      className="settings-ai-mini-btn settings-ai-edit-btn"
                      disabled={busy}
                      onClick={() => openEdit(row.entry!)}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      className="settings-ai-mini-btn settings-ai-delete-btn"
                      disabled={busy}
                      onClick={() => removeEntry(row.id)}
                    >
                      删除
                    </button>
                  </>
                ) : null}
              </div>
              {test ? (
                <p className="settings-ai-test-result" data-test-status={test.status}>
                  {test.text}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="settings-ai-footer">
        {configWritable ? (
          <button
            type="button"
            className="settings-link-btn settings-ai-add-btn"
            disabled={busy}
            onClick={() => {
              setForm(form?.mode === "add" ? null : emptyForm("add"));
              setNotice("");
            }}
          >
            + 添加 BYOK 提供方
          </button>
        ) : (
          <p className="settings-hub-muted">此服务器未启用应用级配置存储——提供方选择仅可通过环境变量。</p>
        )}
        {config?.activeProviderId ? (
          <button
            type="button"
            className="settings-link-btn settings-ai-clear-active-btn"
            disabled={busy}
            onClick={clearActive}
          >
            恢复默认（跟随环境变量 / mock）
          </button>
        ) : null}
      </div>

      {form && configWritable ? (
        <div className="settings-ai-form" data-form-mode={form.mode}>
          <h4 className="settings-ai-form-title">{form.mode === "add" ? "添加 BYOK 提供方" : `编辑 ${form.entryId}`}</h4>
          <label className="settings-ai-field">
            提供方类型
            <select
              className="settings-ai-preset-select"
              value={form.preset}
              disabled={form.mode === "edit"}
              onChange={(event) => setForm({ ...form, preset: event.target.value as HttpPresetId })}
            >
              {HTTP_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-ai-field">
            名称
            <input
              type="text"
              className="settings-ai-label-input"
              value={form.label}
              placeholder={HTTP_PRESETS.find((preset) => preset.id === form.preset)!.label}
              onChange={(event) => setForm({ ...form, label: event.target.value })}
            />
          </label>
          <label className="settings-ai-field">
            模型{form.preset === "openai-compatible" ? "（必填）" : "（可选）"}
            <input
              type="text"
              className="settings-ai-model-input"
              value={form.model}
              placeholder={HTTP_PRESETS.find((preset) => preset.id === form.preset)!.modelPlaceholder}
              onChange={(event) => setForm({ ...form, model: event.target.value })}
            />
          </label>
          <label className="settings-ai-field">
            Base URL{form.preset === "openai-compatible" ? "（必填）" : "（可选，默认官方端点）"}
            <input
              type="text"
              className="settings-ai-baseurl-input"
              value={form.baseUrl}
              placeholder={form.preset === "openai-compatible" ? "https://openrouter.ai/api/v1" : "https://api.deepseek.com"}
              onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
            />
          </label>
          {canPersistKeys ? (
            <label className="settings-ai-field">
              API 密钥{form.keySet ? "（已保存——输入新值以替换，留空保持不变）" : ""}
              <input
                type="password"
                className="settings-ai-key-input"
                value={form.apiKey}
                autoComplete="off"
                placeholder={form.keySet ? "••••••••（已保存）" : "sk-…"}
                onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
              />
            </label>
          ) : (
            <p className="settings-hub-muted settings-ai-key-env-note">
              此环境不保存密钥——请设置环境变量 {PRESET_ENV_VARS[form.preset]}。
            </p>
          )}
          {form.mode === "edit" && form.keySet && canPersistKeys ? (
            <button
              type="button"
              className="settings-ai-mini-btn settings-ai-clear-key-btn"
              disabled={busy}
              onClick={() => form.entryId && clearSavedKey(form.entryId)}
            >
              清除已保存密钥
            </button>
          ) : null}
          <div className="settings-ai-form-actions">
            <button
              type="button"
              className="settings-link-btn settings-ai-save-btn"
              disabled={busy}
              onClick={() => void submitForm()}
            >
              保存
            </button>
            <button
              type="button"
              className="settings-link-btn settings-ai-cancel-btn"
              disabled={busy}
              onClick={() => setForm(null)}
            >
              取消
            </button>
          </div>
        </div>
      ) : null}

      <p className="settings-hub-note">
        BYOK（自带密钥）提供方按用量由供应商计费；本地 CLI 走已订阅的命令行登录，无需密钥。
      </p>
    </div>
  );
}
