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
import { registerSettingsSection } from "./registry";
import { setSettingsIoForTests } from "./settingsIo";

let container: HTMLDivElement;
let root: Root;

const stubIo = (over: Parameters<typeof setSettingsIoForTests>[0] = {}) =>
  setSettingsIoForTests({
    fetchProviders: async () => ({
      active: { id: "claude-agent", kind: "cli-agent" },
      providers: [
        { id: "mock", kind: "mock", label: "Mock (offline)" },
        { id: "claude-agent", kind: "cli-agent", label: "Claude (subscription, Agent SDK)" }
      ],
      envProviderId: "claude-agent"
    }),
    fetchVaultInfo: async () => ({ manifest: { name: "My Vault" }, paths: { rootDir: "C:/vaults/demo" } }),
    fetchAbout: async () => ({ app: "ai-study-vault", version: "0.1.0" }),
    fetchMemorySettings: async () => ({ settings: { captureEnabled: true } }),
    saveMemorySettings: async () => ({}),
    ...over
  });

beforeEach(() => {
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
});

async function renderHub() {
  await act(async () => {
    root.render(getView("settings.hub")!.render({ id: "settings", kind: "settings.hub" } as never, {} as never) as React.ReactElement);
  });
}

describe("SettingsHub", () => {
  it("renders the shipped sections in registry order (AI → 记忆 → 数据 → 关于)", async () => {
    await renderHub();
    const ids = Array.from(container.querySelectorAll(".settings-hub-section")).map((el) =>
      el.getAttribute("data-section-id")
    );
    // Relative order of the four built-ins (extra registered sections may follow).
    const builtins = ids.filter((id) => ["ai-providers", "memory-privacy", "data", "about"].includes(id ?? ""));
    expect(builtins).toEqual(["ai-providers", "memory-privacy", "data", "about"]);
  });

  it("AI 提供方 section shows the ACTIVE provider + env readout + the A3b stub note", async () => {
    await renderHub();
    const active = container.querySelector(".settings-active-provider")!;
    expect(active.getAttribute("data-provider-id")).toBe("claude-agent");
    expect(active.getAttribute("data-provider-kind")).toBe("cli-agent");
    expect(container.querySelector(".settings-env-readout")!.textContent).toContain("STUDY_VAULT_AI_PROVIDER");
    expect(container.querySelector(".settings-env-readout")!.textContent).toContain("claude-agent");
    // Both registered descriptors are listed.
    const rows = Array.from(container.querySelectorAll(".settings-provider-row")).map((el) =>
      el.getAttribute("data-provider-id")
    );
    expect(rows).toEqual(["mock", "claude-agent"]);
    expect(container.querySelector(".settings-hub-note")!.textContent).toContain("A3b");
  });

  it("数据 section reads the vault path; 关于 shows the version + a DISABLED 检查更新 stub", async () => {
    await renderHub();
    expect(container.querySelector(".settings-vault-path")!.textContent).toBe("C:/vaults/demo");
    expect(container.querySelector(".settings-about-version")!.textContent).toContain("v0.1.0");
    const update = container.querySelector<HTMLButtonElement>(".settings-check-update-btn")!;
    expect(update.disabled).toBe(true);
    expect(update.title).toContain("X1");
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
