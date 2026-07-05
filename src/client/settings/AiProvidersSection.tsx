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
// Managed (托管积分, G-A3b) is now SELECTABLE: the built-in managed row hosts a
// login (phone→code→verify) + balance + top-up (mock) sub-panel, backed by a single
// auto-provisioned managed config entry (MANAGED_ENTRY_ID) whose session token lives
// server-side (encrypted keyStore). No token → a 登录 affordance, never a stream error.
// Data flows through settingsIo only (the hub's swappable seam) — never raw fetch.

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AiProviderCapabilities,
  AiProviderEntryInput,
  AiProviderEntryView,
  AiProvidersInfo,
  ManagedBalance
} from "../data/entityClient";
import { getSettingsIo } from "./settingsIo";

// G-A3b: managed (托管积分) is backed by a single, FIXED config entry (kind managed)
// distinct from the built-in `managed` registry id (a config entry may not shadow a
// registry id). The built-in managed ROW hosts the login/balance/top-up sub-panel and
// its radio activates THIS entry; the entry is auto-provisioned on first login/activate
// and hidden from the row list (it backs the built-in row, not a separate provider).
export const MANAGED_ENTRY_ID = "managed-account";
// Fixed top-up SKUs the mock gateway serves (the real pack list lands with the hosted
// endpoint, G-B). Mirrors a small ¥ set; credits are the gateway's to define.
const MANAGED_TOPUP_SKUS = [
  { sku: "pack_10", label: "¥10 · 100 积分" },
  { sku: "pack_30", label: "¥30 · 300 积分" },
  { sku: "pack_100", label: "¥100 · 1100 积分" }
] as const;

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
    capabilities.tools ? "工具" : "",
    // V-1 (vision-input.md §2): surface which providers accept image input.
    capabilities.vision ? "视觉" : ""
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

/**
 * Providers whose native deps are NOT shipped in packaged builds → disabled-not-hidden
 * there (degrade-not-disappear). Today only codex (`@openai/codex-sdk` is a dev/source
 * dependency; its lazy import fails packaged). The note explains the disable.
 */
const PACKAGED_UNAVAILABLE: Record<string, string> = {
  codex: "需从源码运行（打包版未内置 codex SDK）"
};

export function AiProvidersSection() {
  const [info, setInfo] = useState<AiProvidersInfo | null>(null);
  const [isPackaged, setIsPackaged] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [detects, setDetects] = useState<Record<string, DetectState>>({});
  // Managed (托管积分) sub-panel state: the login step (phone→code), form fields, the
  // fetched balance, and the last-created top-up order (its QR payload is rendered).
  const [managed, setManaged] = useState<{
    step: "phone" | "code";
    phone: string;
    code: string;
    balance: ManagedBalance | null;
    order: { qrPayload: string; credits: number } | null;
  }>({ step: "phone", phone: "", code: "", balance: null, order: null });
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

  // A packaged desktop build doesn't ship some providers' native deps (codex). Read
  // the flag ONCE and disable-not-hide those rows. A read failure degrades to the dev
  // default (nothing disabled) — never blocks the section.
  useEffect(() => {
    void getSettingsIo()
      .fetchAbout()
      .then((about) => {
        if (aliveRef.current) setIsPackaged(about.isPackaged === true);
      })
      .catch(() => null);
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

  // Fetch the managed balance whenever a stored session appears (login) and no balance
  // is held yet. Logout clears the balance (managedLogout) so the next login re-fetches.
  const managedSessionSet =
    info?.config?.providers.find((entry) => entry.id === MANAGED_ENTRY_ID)?.sessionSet === true;
  useEffect(() => {
    if (managedSessionSet) void refreshBalance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [managedSessionSet]);

  if (loadError) return <p className="settings-hub-muted">{loadError}</p>;
  if (!info) return <p className="settings-hub-muted">检测中…</p>;

  const config = info.config ?? null;
  const keyStore = info.keyStore ?? { kind: "env-only" as const, persistent: false };
  const canPersistKeys = keyStore.persistent;
  const configWritable = config !== null;

  // The managed backing entry (MANAGED_ENTRY_ID) is internal — it backs the built-in
  // managed ROW's sub-panel, so it's hidden from the visible row list.
  const managedEntry = (config?.providers ?? []).find((entry) => entry.id === MANAGED_ENTRY_ID) ?? null;
  const managedActive = config?.activeProviderId === MANAGED_ENTRY_ID;
  const managedLoggedIn = managedEntry?.sessionSet === true;

  const rows: Row[] = [
    ...info.providers.map((descriptor) => ({
      id: descriptor.id,
      kind: descriptor.kind,
      label: descriptor.label,
      source: "builtin" as const,
      capabilities: descriptor.capabilities
    })),
    ...(config?.providers ?? [])
      .filter((entry) => entry.id !== MANAGED_ENTRY_ID)
      .map((entry) => ({
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

  // —— Managed (托管积分, G-A3b) — login / balance / top-up / activation ——————————
  // Ensure the backing managed config entry exists (auto-provisioned, kind managed,
  // preset "managed"). Preserves every BYOK entry — the list write re-attaches stored
  // keys by id (server-owned keyRef). Returns after the reload so callers see it.
  const ensureManagedEntry = async (): Promise<void> => {
    if (!config) return;
    if (config.providers.some((entry) => entry.id === MANAGED_ENTRY_ID)) return;
    const next: AiProviderEntryInput[] = [
      ...config.providers.map(toEntryInput),
      { id: MANAGED_ENTRY_ID, kind: "managed", preset: "managed", label: "托管积分" }
    ];
    await getSettingsIo().saveProviderList(next);
  };

  // Select managed: provision the entry (if needed), then activate it. active.id
  // resolves to "managed" (the ManagedProvider's id), so the readout stays coherent.
  const activateManaged = () =>
    void run(async () => {
      await ensureManagedEntry();
      await getSettingsIo().saveActiveProvider(MANAGED_ENTRY_ID);
    }, "切换托管积分失败");

  const managedRequestCode = () =>
    void run(async () => {
      await ensureManagedEntry();
      await getSettingsIo().managedRequestCode(MANAGED_ENTRY_ID, managed.phone.trim());
      if (aliveRef.current) setManaged((prev) => ({ ...prev, step: "code" }));
    }, "发送验证码失败");

  const managedVerify = () =>
    void run(async () => {
      await getSettingsIo().managedVerify(MANAGED_ENTRY_ID, managed.phone.trim(), managed.code.trim());
      if (aliveRef.current) setManaged((prev) => ({ ...prev, step: "phone", code: "" }));
    }, "登录失败");

  const managedLogout = () =>
    void run(async () => {
      await getSettingsIo().managedLogout(MANAGED_ENTRY_ID);
      if (aliveRef.current) setManaged((prev) => ({ ...prev, balance: null, order: null }));
    }, "登出失败");

  const refreshBalance = async () => {
    try {
      const balance = await getSettingsIo().managedBalance(MANAGED_ENTRY_ID);
      if (aliveRef.current) setManaged((prev) => ({ ...prev, balance }));
    } catch (error) {
      if (aliveRef.current) setNotice(error instanceof Error && error.message ? error.message : "读取余额失败");
    }
  };

  const managedTopup = (sku: string) =>
    void run(async () => {
      // Mock pay: create the order AND immediately simulate the vendor webhook so the
      // credit lands (real WeChat QR + notify lands with the hosted endpoint, G-B).
      const order = await getSettingsIo().managedTopup(MANAGED_ENTRY_ID, sku, true);
      if (aliveRef.current) setManaged((prev) => ({ ...prev, order: { qrPayload: order.qrPayload, credits: order.credits } }));
      await refreshBalance();
    }, "充值失败");

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
          // The built-in managed row (id "managed") is now SELECTABLE (G-A3b): its
          // radio activates the backing managed config entry (MANAGED_ENTRY_ID), and it
          // hosts the login/balance/top-up sub-panel below.
          const isManaged = row.kind === "managed" && row.source === "builtin";
          // A provider whose native dep isn't shipped in THIS (packaged) build →
          // disabled-not-hidden with a short note (degrade-not-disappear). Dev builds
          // (isPackaged=false) leave it fully enabled.
          const unavailableNote = isPackaged ? PACKAGED_UNAVAILABLE[row.id] : undefined;
          const pickDisabled = unavailableNote !== undefined;
          const checked = isManaged ? managedActive : config?.activeProviderId === row.id;
          const effective = active.id === row.id;
          const test = tests[row.id];
          const detectState = detects[row.id];
          const detectable = row.kind === "cli-agent" && isDetectableCliId(row.entry?.preset ?? row.id);
          return (
            <li
              key={row.id}
              className="settings-ai-row"
              data-provider-id={row.id}
              data-provider-kind={row.kind}
              data-selected={checked ? "true" : "false"}
              data-effective={effective ? "true" : "false"}
              data-disabled={pickDisabled || !configWritable ? "true" : "false"}
              data-unavailable={unavailableNote !== undefined ? "true" : undefined}
              aria-current={effective ? "true" : undefined}
            >
              <div className="settings-ai-row-main">
                <label className="settings-ai-pick">
                  <input
                    type="radio"
                    name="settings-ai-active"
                    className="settings-ai-radio"
                    checked={checked}
                    disabled={busy || pickDisabled || !configWritable}
                    onChange={() => (isManaged ? activateManaged() : activate(row.id))}
                  />
                  <span className="settings-ai-radio-mark" aria-hidden="true" />
                  <span className="settings-ai-title">
                    <span className="settings-provider-label">{row.label}</span>
                    <span className="settings-ai-meta">
                      <code className="settings-provider-id">{row.id}</code>
                      <span className="settings-provider-kind">{PROVIDER_KIND_LABEL[row.kind] ?? row.kind}</span>
                      <CapabilityChips capabilities={row.capabilities} />
                      {row.entry ? (
                        <span className="settings-ai-key-badge" data-key-set={row.entry.keySet}>
                          {row.entry.keySet ? "密钥已保存 ●" : "未设密钥"}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </label>
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
                  <span
                    className="settings-ai-managed-note settings-ai-managed-status"
                    data-logged-in={managedLoggedIn ? "true" : "false"}
                  >
                    {managedLoggedIn ? "已登录托管积分" : "未登录 — 请登录以使用托管积分"}
                  </span>
                ) : unavailableNote ? (
                  // Packaged build without this provider's native dep: disabled-not-hidden.
                  // Reuses the existing muted-note style (.settings-ai-managed-note) — no
                  // new CSS — with a semantic hook class for tests/future styling.
                  <span className="settings-ai-managed-note settings-ai-unavailable-note">{unavailableNote}</span>
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
              {isManaged && configWritable ? (
                <div className="settings-ai-managed-panel" data-logged-in={managedLoggedIn ? "true" : "false"}>
                  {!managedLoggedIn ? (
                    // No stored session → a 登录 affordance (delta 3): phone → code →
                    // verify. Never enable-and-strand — the panel prompts login here
                    // rather than letting an active-but-unconfigured managed stream-error.
                    <div className="settings-ai-managed-login">
                      {managed.step === "phone" ? (
                        <>
                          <input
                            type="tel"
                            className="settings-ai-managed-phone"
                            value={managed.phone}
                            placeholder="手机号（+8613800138000）"
                            autoComplete="off"
                            onChange={(event) => setManaged((prev) => ({ ...prev, phone: event.target.value }))}
                          />
                          <button
                            type="button"
                            className="settings-link-btn settings-ai-managed-login-btn"
                            disabled={busy || !managed.phone.trim()}
                            onClick={managedRequestCode}
                          >
                            登录（发送验证码）
                          </button>
                        </>
                      ) : (
                        <>
                          <input
                            type="text"
                            className="settings-ai-managed-code"
                            value={managed.code}
                            placeholder="短信验证码"
                            autoComplete="off"
                            onChange={(event) => setManaged((prev) => ({ ...prev, code: event.target.value }))}
                          />
                          <button
                            type="button"
                            className="settings-link-btn settings-ai-managed-verify-btn"
                            disabled={busy || !managed.code.trim()}
                            onClick={managedVerify}
                          >
                            验证登录
                          </button>
                          <button
                            type="button"
                            className="settings-ai-mini-btn settings-ai-managed-back-btn"
                            disabled={busy}
                            onClick={() => setManaged((prev) => ({ ...prev, step: "phone", code: "" }))}
                          >
                            返回
                          </button>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="settings-ai-managed-account">
                      <p className="settings-ai-managed-balance">
                        余额:<strong>{managed.balance ? managed.balance.balance : "…"}</strong> 积分
                        <button
                          type="button"
                          className="settings-ai-mini-btn settings-ai-managed-refresh-btn"
                          disabled={busy}
                          onClick={() => void refreshBalance()}
                        >
                          刷新
                        </button>
                        <button
                          type="button"
                          className="settings-ai-mini-btn settings-ai-managed-logout-btn"
                          disabled={busy}
                          onClick={managedLogout}
                        >
                          退出登录
                        </button>
                      </p>
                      <div className="settings-ai-managed-topups">
                        <span className="settings-ai-managed-topup-label">充值:</span>
                        {MANAGED_TOPUP_SKUS.map((pack) => (
                          <button
                            key={pack.sku}
                            type="button"
                            className="settings-ai-mini-btn settings-ai-managed-topup-btn"
                            data-sku={pack.sku}
                            disabled={busy}
                            onClick={() => managedTopup(pack.sku)}
                          >
                            {pack.label}
                          </button>
                        ))}
                      </div>
                      {managed.order ? (
                        <p className="settings-ai-managed-order">
                          已充值 {managed.order.credits} 积分（模拟支付）·<code>{managed.order.qrPayload}</code>
                        </p>
                      ) : null}
                    </div>
                  )}
                </div>
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
