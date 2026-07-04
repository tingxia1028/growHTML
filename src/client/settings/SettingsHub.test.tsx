// @vitest-environment jsdom
// Settings Hub (SHELL-1) — the registered view over the section registry: built-in
// sections render in order with their readouts (AI provider env detection, capture
// switch mirror, vault path, version), a broken section is ISOLATED by the per-section
// error boundary, and the 记忆与隐私 deep-link navigates through the shell nav bus.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// Importing the hub registers the view AND the four built-in sections (module scope).
import "./SettingsHub";

import { getView } from "../workspace/viewRegistry";
import { registerShellNavigator, type ShellNavTarget } from "../workspace/shellNav";
import { LocaleProvider, setLocale } from "../i18n";
import { resetSpeechPreferencesForTests } from "../speech/speechPreferences";
import { registerSettingsSection } from "./registry";
import { setSettingsIoForTests } from "./settingsIo";

let container: HTMLDivElement;
let root: Root;

const stubIo = (over: Parameters<typeof setSettingsIoForTests>[0] = {}) =>
  setSettingsIoForTests({
    fetchProviders: async () => ({
      active: { id: "claude-agent", kind: "cli-agent" },
      activeSource: "env",
      providers: [
        { id: "mock", kind: "mock", label: "Mock (offline)" },
        { id: "claude-agent", kind: "cli-agent", label: "Claude (subscription, Agent SDK)" }
      ],
      envProviderId: "claude-agent",
      config: { activeProviderId: null, providers: [], error: null },
      keyStore: { kind: "safe-storage", persistent: true }
    }),
    detectProvider: async (id) => ({ id, spec: "claude", ok: true, version: "1.0.0" }),
    testProvider: async (id) => ({ provider: { id, kind: "cli-agent" }, ok: true, latencyMs: 5 }),
    fetchVaultInfo: async () => ({ manifest: { name: "My Vault" }, paths: { rootDir: "C:/vaults/demo" } }),
    fetchAbout: async () => ({ app: "ai-study-vault", version: "0.1.0" }),
    fetchMemorySettings: async () => ({ settings: { captureEnabled: true } }),
    saveMemorySettings: async () => ({}),
    fetchUiPrefs: async () => ({ prefs: { locale: "zh" } }),
    saveUiPrefs: async () => ({ prefs: { locale: "zh" } }),
    fetchBackupStatus: async () => ({
      backups: [
        {
          name: "vault-backup-20260704-010203-manual.zip",
          createdAt: "2026-07-04T01:02:03.000Z",
          reason: "manual",
          sizeBytes: 1024
        }
      ],
      lastBackupAt: "2026-07-04T01:02:03.000Z",
      nextDueAt: "2026-07-05T01:02:03.000Z",
      backupsDir: "C:/backups"
    }),
    restoreBackup: async () => ({
      ok: true,
      restoredFrom: "backup.zip",
      preRestoreBackup: "pre-restore.zip",
      counts: {}
    }),
    fetchSpeechStatus: async () => ({
      tts: {
        available: true,
        lane: "edge",
        defaultVoice: "zh-CN-XiaoxiaoNeural",
        voices: [
          { id: "zh-CN-XiaoxiaoNeural", label: "Xiaoxiao", locale: "zh-CN" },
          { id: "en-US-JennyNeural", label: "Jenny", locale: "en-US" }
        ]
      },
      stt: { available: false, lane: "local" }
    }),
    ...over
  });

beforeEach(() => {
  setLocale("zh");
  resetSpeechPreferencesForTests();
  stubIo();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setSettingsIoForTests(null);
  registerShellNavigator(null);
  resetSpeechPreferencesForTests();
});

async function renderHub() {
  await act(async () => {
    root.render(
      <LocaleProvider>
        {getView("settings.hub")!.render({ id: "settings", kind: "settings.hub" } as never, {} as never) as React.ReactElement}
      </LocaleProvider>
    );
  });
  await act(async () => {});
}

describe("SettingsHub", () => {
  it("renders the shipped sections in registry order (语言 → AI → 记忆 → 数据 → 关于)", async () => {
    await renderHub();
    const ids = Array.from(container.querySelectorAll(".settings-hub-section")).map((el) =>
      el.getAttribute("data-section-id")
    );
    const builtins = ids.filter((id) => ["language", "ai-providers", "memory-privacy", "data", "speech", "about"].includes(id ?? ""));
    expect(builtins).toEqual(["language", "ai-providers", "memory-privacy", "data", "speech", "about"]);
  });

  it("language radio flips the hub chrome immediately and persists through ui-prefs", async () => {
    const saved: Array<{ locale: "zh" | "en" }> = [];
    stubIo({ saveUiPrefs: async (prefs) => {
      saved.push(prefs);
      return { prefs };
    } });
    await renderHub();

    expect(container.querySelector(".panel-title")!.textContent).toContain("设置");
    await act(async () => {
      container.querySelector<HTMLInputElement>('input[name="growte-locale"][value="en"]')!.click();
    });

    expect(saved).toEqual([{ locale: "en" }]);
    expect(container.querySelector(".panel-title")!.textContent).toContain("Settings");
    expect(container.querySelector('[data-section-id="language"] .settings-hub-section-title')!.textContent).toBe("Language");
  });

  it("AI 提供方 section (the A3b panel that REPLACED the stub) renders active + rows + env banner", async () => {
    await renderHub();
    const active = container.querySelector(".settings-active-provider")!;
    expect(active.getAttribute("data-provider-id")).toBe("claude-agent");
    expect(active.getAttribute("data-provider-kind")).toBe("cli-agent");
    // Explicit-beats-config: the env override is surfaced as a banner.
    expect(container.querySelector(".settings-env-override-note")!.textContent).toContain("STUDY_VAULT_AI_PROVIDER");
    expect(container.querySelector(".settings-env-override-note")!.textContent).toContain("claude-agent");
    // Both registered descriptors are listed as picker rows (detailed flows are
    // covered by AiProvidersSection.test.tsx).
    const rows = Array.from(container.querySelectorAll(".settings-ai-row")).map((el) =>
      el.getAttribute("data-provider-id")
    );
    expect(rows).toEqual(["mock", "claude-agent"]);
  });

  it("数据 section reads backup status and restores through the typed confirm flow", async () => {
    const restored: string[] = [];
    stubIo({
      restoreBackup: async (name, confirm) => {
        restored.push(`${name}:${confirm}`);
        return {
          ok: true,
          restoredFrom: name,
          preRestoreBackup: "vault-backup-20260704-020304-pre-restore.zip",
          counts: {}
        };
      }
    });
    vi.spyOn(window, "prompt").mockReturnValue("替换全库");
    await renderHub();
    expect(container.querySelector(".settings-vault-path")!.textContent).toBe("C:/vaults/demo");

    expect(container.querySelector(".settings-backup-status")!.textContent).toContain("1");
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".settings-restore-btn")!.click();
    });
    expect(restored).toEqual(["vault-backup-20260704-010203-manual.zip:替换全库"]);
    expect(container.querySelector('[data-section-id="data"] .settings-hub-note')!.textContent).toContain(
      "vault-backup-20260704-020304-pre-restore.zip"
    );
  });

  it("语音 section stores the selected voice/rate and About check refreshes the version readout", async () => {
    await renderHub();
    const voice = container.querySelector<HTMLSelectElement>('[data-section-id="speech"] select')!;
    await act(async () => {
      voice.value = "en-US-JennyNeural";
      voice.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const rate = container.querySelector<HTMLInputElement>('[data-section-id="speech"] input[type="range"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(rate, "1.25");
      rate.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(JSON.parse(localStorage.getItem("growte.speech.preferences") || "{}")).toMatchObject({
      voice: "en-US-JennyNeural",
      rate: 1.25
    });

    expect(container.querySelector(".settings-about-version")!.textContent).toContain("v0.1.0");
    const update = container.querySelector<HTMLButtonElement>(".settings-check-update-btn")!;
    expect(update.disabled).toBe(false);
    await act(async () => {
      update.click();
    });
    expect(container.querySelector('[data-section-id="about"] .settings-hub-note')!.textContent).toContain("v0.1.0");
  });

  it("记忆与隐私 mirrors the capture switch (PUT on toggle) and deep-links to profile.panel", async () => {
    const saved: Array<{ captureEnabled: boolean }> = [];
    const targets: ShellNavTarget[] = [];
    stubIo({ saveMemorySettings: async (settings) => saved.push(settings) });
    registerShellNavigator((target) => targets.push(target));
    await renderHub();

    const checkbox = container.querySelector<HTMLInputElement>(".settings-capture-switch input")!;
    expect(checkbox.checked).toBe(true);
    await act(async () => {
      checkbox.click();
    });
    expect(saved).toEqual([{ captureEnabled: false }]);

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".settings-open-profile-btn")!.click();
    });
    expect(targets).toEqual([{ type: "pane", kind: "profile.panel" }]);
  });

  it("a broken section is ISOLATED: its boundary shows an error card, the rest render", async () => {
    // Silence React's boundary error logging for this deliberate throw.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    registerSettingsSection({
      id: "zzz-broken",
      title: "Broken",
      order: 999,
      render: () => {
        throw new Error("section exploded");
      }
    });
    await renderHub();

    expect(container.querySelector('.settings-hub-section-error[data-section-id="zzz-broken"]')).not.toBeNull();
    // The hub did not crash: the built-ins are still there.
    expect(container.querySelector('[data-section-id="ai-providers"]')).not.toBeNull();
    expect(container.querySelector('[data-section-id="about"]')).not.toBeNull();

    consoleError.mockRestore();
    // Neutralize the broken section for any later render in this file.
    registerSettingsSection({ id: "zzz-broken", title: "Broken", order: 999, render: () => null });
  });
});
