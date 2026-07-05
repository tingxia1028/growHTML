// @vitest-environment jsdom
// AI 提供方 settings section (A3b) — the full config panel that replaced the SHELL-1
// stub: provider rows (kind badges + capability chips), the ACTIVE radio persisted
// through the /active seam, BYOK add/edit/delete through the field-group-safe list
// seam, the WRITE-ONLY key flow (sent once, cleared, NEVER echoed into the DOM),
// per-row 测试连接 (typed ok/fail), cli-agent auto-detection + 刷新检测, the managed
// disabled placeholder, and the env-only key-store banner (web/dev builds).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AiProviderEntryInput, AiProvidersInfo } from "../data/entityClient";
import { AiProvidersSection } from "./AiProvidersSection";
import { setSettingsIoForTests } from "./settingsIo";

let container: HTMLDivElement;
let root: Root;

type Calls = {
  list: AiProviderEntryInput[][];
  active: Array<string | null>;
  key: Array<{ id: string; apiKey: string }>;
  deletedKeys: string[];
  tested: string[];
  detected: string[];
  // Managed (托管积分, G-A3b) seams.
  managedRequestCode: Array<{ id: string; phone: string }>;
  managedVerify: Array<{ id: string; phone: string; code: string }>;
  managedTopup: Array<{ id: string; sku: string; mockNotify?: boolean }>;
  managedLoggedOut: string[];
  managedBalances: string[];
};

function baseInfo(): AiProvidersInfo {
  const http = { chat: true, agentic: true, streaming: true, structured: true, tools: true, vision: true, kind: "http" };
  return {
    active: { id: "mock", kind: "mock" },
    activeSource: "default",
    envProviderId: null,
    providers: [
      {
        id: "mock",
        kind: "mock",
        label: "Mock (offline)",
        capabilities: { chat: true, agentic: false, streaming: true, structured: true, tools: false, vision: true, kind: "mock" }
      },
      {
        id: "claude-agent",
        kind: "cli-agent",
        label: "Claude (subscription, Agent SDK)",
        capabilities: { chat: true, agentic: true, streaming: true, structured: false, tools: false, vision: false, kind: "cli-agent" }
      },
      { id: "managed", kind: "managed", label: "Managed (托管积分)" }
    ],
    config: {
      activeProviderId: null,
      providers: [
        {
          id: "deepseek-1",
          kind: "http",
          preset: "deepseek",
          label: "DeepSeek",
          model: "deepseek-v4-flash",
          keySet: false,
          capabilities: http
        }
      ],
      error: null
    },
    keyStore: { kind: "safe-storage", persistent: true }
  };
}

/** Mutable fake IO: writes update `info` so the post-action reload sees them. `about`
    seeds the /api/about read (isPackaged) the section makes on mount; default = dev. */
function installFake(
  info: AiProvidersInfo,
  overrides: Parameters<typeof setSettingsIoForTests>[0] = {},
  about: { isPackaged?: boolean } = {}
): Calls {
  const calls: Calls = {
    list: [],
    active: [],
    key: [],
    deletedKeys: [],
    tested: [],
    detected: [],
    managedRequestCode: [],
    managedVerify: [],
    managedTopup: [],
    managedLoggedOut: [],
    managedBalances: []
  };
  const keyed = new Set(info.config?.providers.filter((entry) => entry.keySet).map((entry) => entry.id));
  // Track the managed backing entry's session state so the reload reflects login/logout.
  const managedSessions = new Set(
    info.config?.providers.filter((entry) => entry.sessionSet).map((entry) => entry.id)
  );
  const managedBalance = { balance: 1000, recent: [{ id: "l1", kind: "signup_bonus", amount: 1000, ts: 1 }] };
  setSettingsIoForTests({
    fetchProviders: async () => JSON.parse(JSON.stringify(info)) as AiProvidersInfo,
    fetchAbout: async () => ({ app: "ai-study-vault", version: "0.0.0-test", isPackaged: about.isPackaged === true }),
    saveProviderList: async (providers) => {
      calls.list.push(providers);
      info.config!.providers = providers.map((entry) => ({
        ...entry,
        keySet: keyed.has(entry.id),
        ...(entry.kind === "managed" ? { sessionSet: managedSessions.has(entry.id) } : {})
      }));
      return { config: info.config! };
    },
    saveActiveProvider: async (activeProviderId) => {
      calls.active.push(activeProviderId);
      info.config!.activeProviderId = activeProviderId;
      return { config: info.config! };
    },
    saveProviderKey: async (id, apiKey) => {
      calls.key.push({ id, apiKey });
      keyed.add(id);
      info.config!.providers = info.config!.providers.map((entry) =>
        entry.id === id ? { ...entry, keySet: true } : entry
      );
      return { ok: true, keySet: true, storage: "safe-storage" };
    },
    deleteProviderKey: async (id) => {
      calls.deletedKeys.push(id);
      keyed.delete(id);
      info.config!.providers = info.config!.providers.map((entry) =>
        entry.id === id ? { ...entry, keySet: false } : entry
      );
      return { ok: true, keySet: false };
    },
    testProvider: async (id) => {
      calls.tested.push(id);
      return { provider: { id, kind: "http" }, ok: true, latencyMs: 42 };
    },
    detectProvider: async (id) => {
      calls.detected.push(id);
      return { id, spec: "claude", ok: true, version: "2.1.0" };
    },
    managedRequestCode: async (id, phone) => {
      calls.managedRequestCode.push({ id, phone });
      return { ok: true };
    },
    managedVerify: async (id, phone, code) => {
      calls.managedVerify.push({ id, phone, code });
      managedSessions.add(id);
      info.config!.providers = info.config!.providers.map((entry) =>
        entry.id === id ? { ...entry, sessionSet: true } : entry
      );
      return { ok: true, userId: "usr_1", isNewUser: true };
    },
    managedBalance: async (id) => {
      calls.managedBalances.push(id);
      return managedBalance;
    },
    managedTopup: async (id, sku, mockNotify) => {
      calls.managedTopup.push({ id, sku, mockNotify });
      managedBalance.balance += 300;
      return { paymentId: "pay_1", qrPayload: `mockpay://qr/pay_1`, amountYuan: 30, credits: 300 };
    },
    managedLogout: async (id) => {
      calls.managedLoggedOut.push(id);
      managedSessions.delete(id);
      info.config!.providers = info.config!.providers.map((entry) =>
        entry.id === id ? { ...entry, sessionSet: false } : entry
      );
      return { ok: true };
    },
    ...overrides
  });
  return calls;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setSettingsIoForTests(null);
});

async function render() {
  await act(async () => {
    root.render(<AiProvidersSection />);
  });
  await act(async () => {}); // flush the auto-detect effect chain
}

const row = (id: string) => container.querySelector(`.settings-ai-row[data-provider-id="${id}"]`)!;

function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function setSelect(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!;
  setter.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("AiProvidersSection — rows + picker", () => {
  it("lists registry built-ins AND stored config entries with kind badges + capability chips", async () => {
    installFake(baseInfo());
    await render();

    const ids = Array.from(container.querySelectorAll(".settings-ai-row")).map((el) =>
      el.getAttribute("data-provider-id")
    );
    expect(ids).toEqual(["mock", "claude-agent", "managed", "deepseek-1"]);
    expect(row("claude-agent").querySelector(".settings-provider-kind")!.textContent).toBe("本地 CLI（订阅）");
    // Capability chips: the http entry advertises all five incl. V-1 视觉; claude-agent
    // (a non-vision cli-agent) only 对话/流式 (no 视觉).
    const httpCaps = Array.from(row("deepseek-1").querySelectorAll(".settings-ai-cap")).map((el) => el.textContent);
    expect(httpCaps).toEqual(["对话", "流式", "结构化", "工具", "视觉"]);
    const cliCaps = Array.from(row("claude-agent").querySelectorAll(".settings-ai-cap")).map((el) => el.textContent);
    expect(cliCaps).toEqual(["对话", "流式"]);
  });

  it("managed (托管积分) is now SELECTABLE with a login sub-panel (G-A3b)", async () => {
    installFake(baseInfo());
    await render();
    const managedRow = row("managed");
    // The radio is ENABLED (no longer the disabled placeholder).
    expect(managedRow.querySelector<HTMLInputElement>(".settings-ai-radio")!.disabled).toBe(false);
    // The old "即将上线" placeholder is gone; the status reads 未登录.
    expect(managedRow.textContent).not.toContain("即将上线");
    expect(managedRow.querySelector(".settings-ai-managed-status")!.getAttribute("data-logged-in")).toBe("false");
    // No token → a 登录 affordance (phone step), NOT an error.
    expect(managedRow.querySelector(".settings-ai-managed-login-btn")).toBeTruthy();
    expect(managedRow.querySelector(".settings-ai-managed-phone")).toBeTruthy();
  });

  it("the ACTIVE radio persists through the /active seam and re-renders checked", async () => {
    const calls = installFake(baseInfo());
    await render();

    await act(async () => {
      row("deepseek-1").querySelector<HTMLInputElement>(".settings-ai-radio")!.click();
    });
    expect(calls.active).toEqual(["deepseek-1"]);
    expect(row("deepseek-1").querySelector<HTMLInputElement>(".settings-ai-radio")!.checked).toBe(true);

    // 恢复默认 clears the stored choice (null → env/default chain).
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".settings-ai-clear-active-btn")!.click();
    });
    expect(calls.active).toEqual(["deepseek-1", null]);
  });

  it("surfaces the env override banner (explicit-beats-config) when STUDY_VAULT_AI_PROVIDER is set", async () => {
    const info = baseInfo();
    info.envProviderId = "claude-pty";
    info.activeSource = "env";
    installFake(info);
    await render();
    const banner = container.querySelector(".settings-env-override-note")!;
    expect(banner.textContent).toContain("STUDY_VAULT_AI_PROVIDER = claude-pty");
    expect(banner.textContent).toContain("覆盖");
  });
});

describe("AiProvidersSection — managed (托管积分) login / balance / top-up (G-A3b)", () => {
  const managedRow = () => row("managed");

  /** baseInfo + a logged-in managed backing entry (MANAGED_ENTRY_ID, sessionSet). */
  function loggedInInfo(active = false): AiProvidersInfo {
    const info = baseInfo();
    info.config!.providers.push({
      id: "managed-account",
      kind: "managed",
      preset: "managed",
      label: "托管积分",
      keySet: false,
      sessionSet: true
    });
    if (active) info.config!.activeProviderId = "managed-account";
    return info;
  }

  it("activating managed provisions the backing entry and activates it (existing saveActiveProvider seam)", async () => {
    const calls = installFake(baseInfo());
    await render();
    await act(async () => {
      managedRow().querySelector<HTMLInputElement>(".settings-ai-radio")!.click();
    });
    // The backing managed config entry was provisioned via the list seam…
    expect(calls.list).toHaveLength(1);
    expect(calls.list[0].some((entry) => entry.id === "managed-account" && entry.kind === "managed")).toBe(true);
    // …and activated by its id (active.id resolves to "managed" server-side).
    expect(calls.active).toEqual(["managed-account"]);
  });

  it("no token → shows a 登录 prompt (phone → code → verify), NOT a stream error", async () => {
    const calls = installFake(baseInfo());
    await render();
    // Enter a phone and send the code.
    setValue(managedRow().querySelector<HTMLInputElement>(".settings-ai-managed-phone")!, "+8613800138000");
    await act(async () => {
      managedRow().querySelector<HTMLButtonElement>(".settings-ai-managed-login-btn")!.click();
    });
    expect(calls.managedRequestCode).toEqual([{ id: "managed-account", phone: "+8613800138000" }]);
    // The panel advanced to the code step.
    const codeInput = managedRow().querySelector<HTMLInputElement>(".settings-ai-managed-code")!;
    expect(codeInput).toBeTruthy();
    setValue(codeInput, "123456");
    await act(async () => {
      managedRow().querySelector<HTMLButtonElement>(".settings-ai-managed-verify-btn")!.click();
    });
    expect(calls.managedVerify).toEqual([{ id: "managed-account", phone: "+8613800138000", code: "123456" }]);
    // After verify, the status flips 已登录 and the balance auto-loads.
    expect(managedRow().querySelector(".settings-ai-managed-status")!.getAttribute("data-logged-in")).toBe("true");
    expect(managedRow().querySelector(".settings-ai-managed-balance")!.textContent).toContain("1000");
  });

  it("a logged-in managed row renders the balance and auto-fetches it on mount", async () => {
    const calls = installFake(loggedInInfo());
    await render();
    expect(calls.managedBalances).toContain("managed-account");
    expect(managedRow().querySelector(".settings-ai-managed-status")!.getAttribute("data-logged-in")).toBe("true");
    expect(managedRow().querySelector(".settings-ai-managed-balance")!.textContent).toContain("1000");
  });

  it("top-up calls the seam (mock pay) and refreshes the balance", async () => {
    const calls = installFake(loggedInInfo());
    await render();
    await act(async () => {
      managedRow().querySelector<HTMLButtonElement>('.settings-ai-managed-topup-btn[data-sku="pack_30"]')!.click();
    });
    expect(calls.managedTopup).toEqual([{ id: "managed-account", sku: "pack_30", mockNotify: true }]);
    // The order confirmation renders (the mock QR payload) and the balance re-fetched.
    expect(managedRow().querySelector(".settings-ai-managed-order")!.textContent).toContain("mockpay://");
    expect(managedRow().querySelector(".settings-ai-managed-balance")!.textContent).toContain("1300");
  });

  it("退出登录 clears the session through the logout seam (back to the 登录 prompt)", async () => {
    const calls = installFake(loggedInInfo());
    await render();
    await act(async () => {
      managedRow().querySelector<HTMLButtonElement>(".settings-ai-managed-logout-btn")!.click();
    });
    expect(calls.managedLoggedOut).toEqual(["managed-account"]);
    expect(managedRow().querySelector(".settings-ai-managed-status")!.getAttribute("data-logged-in")).toBe("false");
    expect(managedRow().querySelector(".settings-ai-managed-login-btn")).toBeTruthy();
  });

  it("an active managed entry checks the built-in managed radio (active.id → managed)", async () => {
    const info = loggedInInfo(true);
    info.active = { id: "managed", kind: "managed" };
    info.activeSource = "config";
    installFake(info);
    await render();
    expect(managedRow().querySelector<HTMLInputElement>(".settings-ai-radio")!.checked).toBe(true);
    // The backing entry is HIDDEN from the row list (it backs the built-in row).
    expect(container.querySelector('.settings-ai-row[data-provider-id="managed-account"]')).toBeNull();
  });
});

describe("AiProvidersSection — packaged-build unavailable providers (codex)", () => {
  /** baseInfo + the codex cli-agent descriptor (the server always lists it). */
  function infoWithCodex(): AiProvidersInfo {
    const info = baseInfo();
    info.providers.push({
      id: "codex",
      kind: "cli-agent",
      label: "Codex (subscription)",
      capabilities: { chat: true, agentic: true, streaming: true, structured: false, tools: false, vision: false, kind: "cli-agent" }
    });
    return info;
  }

  it("packaged build: codex row is disabled + labelled 需从源码运行 (degrade-not-disappear)", async () => {
    installFake(infoWithCodex(), {}, { isPackaged: true });
    await render();

    // Still LISTED (not hidden) — degrade-not-disappear.
    const codex = row("codex");
    expect(codex).toBeTruthy();
    expect(codex.getAttribute("data-unavailable")).toBe("true");
    expect(codex.querySelector<HTMLInputElement>(".settings-ai-radio")!.disabled).toBe(true);
    expect(codex.querySelector(".settings-ai-unavailable-note")!.textContent).toContain("需从源码运行");
    // The disabled row offers no 测试连接 button.
    expect(codex.querySelector(".settings-ai-test-btn")).toBeNull();

    // The claude-agent row stays fully enabled (only codex is unavailable packaged).
    expect(row("claude-agent").getAttribute("data-unavailable")).toBeNull();
    expect(row("claude-agent").querySelector<HTMLInputElement>(".settings-ai-radio")!.disabled).toBe(false);
  });

  it("dev build (isPackaged=false): codex is a NORMAL selectable row", async () => {
    installFake(infoWithCodex(), {}, { isPackaged: false });
    await render();

    const codex = row("codex");
    expect(codex.getAttribute("data-unavailable")).toBeNull();
    expect(codex.querySelector<HTMLInputElement>(".settings-ai-radio")!.disabled).toBe(false);
    expect(codex.querySelector(".settings-ai-unavailable-note")).toBeNull();
    expect(codex.querySelector(".settings-ai-test-btn")).toBeTruthy(); // 测试连接 offered
  });
});

describe("AiProvidersSection — cli-agent detection", () => {
  it("auto-probes cli rows once on mount and 刷新检测 re-runs the probe", async () => {
    const calls = installFake(baseInfo());
    await render();

    expect(calls.detected).toEqual(["claude-agent"]); // mock/managed/deepseek-1 are not probed
    expect(row("claude-agent").querySelector(".settings-ai-detect")!.getAttribute("data-detect-status")).toBe("ok");
    expect(row("claude-agent").textContent).toContain("已检测✓ 2.1.0");

    await act(async () => {
      row("claude-agent").querySelector<HTMLButtonElement>(".settings-ai-detect-btn")!.click();
    });
    expect(calls.detected).toEqual(["claude-agent", "claude-agent"]);
  });

  it("a failed probe reads 未检测到", async () => {
    installFake(baseInfo(), {
      detectProvider: async (id) => ({ id, spec: "claude", ok: false })
    });
    await render();
    expect(row("claude-agent").querySelector(".settings-ai-detect")!.getAttribute("data-detect-status")).toBe("fail");
    expect(row("claude-agent").textContent).toContain("未检测到");
  });
});

describe("AiProvidersSection — 测试连接", () => {
  it("reports a typed ok result with latency", async () => {
    const calls = installFake(baseInfo());
    await render();
    await act(async () => {
      row("deepseek-1").querySelector<HTMLButtonElement>(".settings-ai-test-btn")!.click();
    });
    expect(calls.tested).toEqual(["deepseek-1"]);
    const result = row("deepseek-1").querySelector(".settings-ai-test-result")!;
    expect(result.getAttribute("data-test-status")).toBe("ok");
    expect(result.textContent).toContain("连接成功 · 42ms");
  });

  it("reports the typed failure reason (e.g. the not-configured message) without throwing", async () => {
    installFake(baseInfo(), {
      testProvider: async (id) => ({
        provider: { id, kind: "http" },
        ok: false,
        latencyMs: 3,
        reason: "DeepSeek（deepseek-1）未配置密钥 — 在 设置 → AI 提供方 保存 API 密钥"
      })
    });
    await render();
    await act(async () => {
      row("deepseek-1").querySelector<HTMLButtonElement>(".settings-ai-test-btn")!.click();
    });
    const result = row("deepseek-1").querySelector(".settings-ai-test-result")!;
    expect(result.getAttribute("data-test-status")).toBe("fail");
    expect(result.textContent).toContain("未配置密钥");
  });
});

describe("AiProvidersSection — BYOK add / edit / key flows", () => {
  it("adds an OpenAI-compatible entry through the list seam and sends the key ONCE, never echoing it", async () => {
    const calls = installFake(baseInfo());
    await render();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".settings-ai-add-btn")!.click();
    });
    setSelect(container.querySelector<HTMLSelectElement>(".settings-ai-preset-select")!, "openai-compatible");
    setValue(container.querySelector<HTMLInputElement>(".settings-ai-label-input")!, "OpenRouter");
    setValue(container.querySelector<HTMLInputElement>(".settings-ai-model-input")!, "deepseek/deepseek-v4");
    setValue(container.querySelector<HTMLInputElement>(".settings-ai-baseurl-input")!, "https://openrouter.ai/api/v1");
    setValue(container.querySelector<HTMLInputElement>(".settings-ai-key-input")!, "sk-or-SECRET-123");
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".settings-ai-save-btn")!.click();
    });

    // The list write carries the entry (no key material); the key went to ITS seam.
    expect(calls.list).toHaveLength(1);
    expect(calls.list[0][1]).toEqual({
      id: "openai-compatible-1",
      kind: "http",
      preset: "openai-compatible",
      label: "OpenRouter",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "deepseek/deepseek-v4"
    });
    expect(JSON.stringify(calls.list)).not.toContain("sk-or-SECRET-123");
    expect(calls.key).toEqual([{ id: "openai-compatible-1", apiKey: "sk-or-SECRET-123" }]);

    // WRITE-ONLY: the form closed and the key exists NOWHERE in the DOM; the row
    // only shows the 已保存 badge.
    expect(container.innerHTML).not.toContain("sk-or-SECRET-123");
    expect(row("openai-compatible-1").querySelector(".settings-ai-key-badge")!.textContent).toContain("密钥已保存");
  });

  it("validates the compatible preset needs Base URL + model before any write", async () => {
    const calls = installFake(baseInfo());
    await render();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".settings-ai-add-btn")!.click();
    });
    setSelect(container.querySelector<HTMLSelectElement>(".settings-ai-preset-select")!, "openai-compatible");
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".settings-ai-save-btn")!.click();
    });
    expect(container.querySelector(".settings-ai-notice")!.textContent).toContain("Base URL");
    expect(calls.list).toHaveLength(0);
  });

  it("edit prefills the entry, saves a replacement, and an untouched key field changes nothing", async () => {
    const info = baseInfo();
    info.config!.providers[0].keySet = true;
    const calls = installFake(info);
    await render();

    await act(async () => {
      row("deepseek-1").querySelector<HTMLButtonElement>(".settings-ai-edit-btn")!.click();
    });
    const modelInput = container.querySelector<HTMLInputElement>(".settings-ai-model-input")!;
    expect(modelInput.value).toBe("deepseek-v4-flash");
    // A SAVED key is represented only by placeholder state — never a value.
    const keyInput = container.querySelector<HTMLInputElement>(".settings-ai-key-input")!;
    expect(keyInput.value).toBe("");
    expect(keyInput.placeholder).toContain("已保存");

    setValue(modelInput, "deepseek-reasoner-v5");
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".settings-ai-save-btn")!.click();
    });
    expect(calls.list).toHaveLength(1);
    expect(calls.list[0]).toEqual([
      {
        id: "deepseek-1",
        kind: "http",
        preset: "deepseek",
        label: "DeepSeek",
        baseUrl: undefined,
        model: "deepseek-reasoner-v5"
      }
    ]);
    expect(calls.key).toHaveLength(0); // empty key field → the saved key is untouched
  });

  it("清除已保存密钥 goes through the delete seam", async () => {
    const info = baseInfo();
    info.config!.providers[0].keySet = true;
    const calls = installFake(info);
    await render();
    await act(async () => {
      row("deepseek-1").querySelector<HTMLButtonElement>(".settings-ai-edit-btn")!.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".settings-ai-clear-key-btn")!.click();
    });
    expect(calls.deletedKeys).toEqual(["deepseek-1"]);
  });

  it("删除 removes the entry through the list seam", async () => {
    const calls = installFake(baseInfo());
    await render();
    await act(async () => {
      row("deepseek-1").querySelector<HTMLButtonElement>(".settings-ai-delete-btn")!.click();
    });
    expect(calls.list).toEqual([[]]);
    expect(container.querySelector('.settings-ai-row[data-provider-id="deepseek-1"]')).toBeNull();
  });
});

describe("AiProvidersSection — env-only key store (web/dev builds)", () => {
  it("states the mode, names the env vars, and offers NO key input", async () => {
    const info = baseInfo();
    info.keyStore = { kind: "env-only", persistent: false, reason: "非 Electron 主进程：web / dev / CLI 模式" };
    installFake(info);
    await render();

    const banner = container.querySelector(".settings-keystore-note")!;
    expect(banner.textContent).toContain("无法安全保存 API 密钥");
    expect(banner.textContent).toContain("DEEPSEEK_API_KEY");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".settings-ai-add-btn")!.click();
    });
    expect(container.querySelector(".settings-ai-key-input")).toBeNull();
    expect(container.querySelector(".settings-ai-key-env-note")!.textContent).toContain("DEEPSEEK_API_KEY");
  });
});
