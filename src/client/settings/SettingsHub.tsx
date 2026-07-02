// Settings Hub (SHELL-1, docs/design/app-shell-ux.md §1) — ONE registered view
// (the manager-panel idiom: registerView + WorkspaceShell side-effect import + a
// preset node; reached from the user menu, NOT a rail icon) that hosts REGISTERED
// sections (./registry). The hub itself knows nothing about any section: tracks land
// panels via registerSettingsSection without touching this file again — A3b's full
// provider config UI will replace the stub AI section the same way.
//
// Isolation rule: each section renders inside its own error boundary, so an unknown
// or broken section degrades to an inline error card instead of crashing the hub.

import { Component, useEffect, useState, type ReactNode } from "react";
import { Settings } from "lucide-react";
import { registerView } from "../workspace/viewRegistry";
import { navigateShell } from "../workspace/shellNav";
import { setMemoryCaptureEnabled } from "../memory/capture";
import type { AiProvidersInfo, MemorySettings } from "../data/entityClient";
import { listSettingsSections, registerSettingsSection } from "./registry";
import { getSettingsIo } from "./settingsIo";

// —— per-section error boundary (a broken section must never take the hub down) ——
class SectionBoundary extends Component<{ sectionId: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="settings-hub-section-error" data-section-id={this.props.sectionId}>
          该设置区块加载失败（其余设置不受影响）。
        </div>
      );
    }
    return this.props.children;
  }
}

// Invokes section.render() INSIDE the boundary's subtree — calling it straight in
// the hub's own render would throw in the PARENT, past the boundary's reach.
function SectionBody({ section }: { section: { render(): ReactNode } }) {
  return <>{section.render()}</>;
}

// —— built-in sections ————————————————————————————————————————————————————————

const PROVIDER_KIND_LABEL: Record<string, string> = {
  mock: "离线 Mock",
  "cli-agent": "本地 CLI（订阅）",
  http: "BYOK API",
  managed: "托管积分"
};

/** AI 提供方 — A3b's future mount; today a read-only env-detection readout. */
function AiProvidersSection() {
  const [info, setInfo] = useState<AiProvidersInfo | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getSettingsIo()
      .fetchProviders()
      .then((next) => {
        if (!cancelled) setInfo(next);
      })
      .catch(() => {
        if (!cancelled) setError("无法读取 AI 提供方状态");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="settings-hub-muted">{error}</p>;
  if (!info) return <p className="settings-hub-muted">检测中…</p>;

  return (
    <div className="settings-ai-section">
      <p className="settings-active-provider" data-provider-id={info.active.id} data-provider-kind={info.active.kind}>
        当前提供方:<strong>{info.active.id}</strong>
        <span className="settings-provider-kind">{PROVIDER_KIND_LABEL[info.active.kind] ?? info.active.kind}</span>
      </p>
      <p className="settings-hub-muted settings-env-readout">
        环境变量 STUDY_VAULT_AI_PROVIDER = {info.envProviderId ?? "(未设置，默认 mock)"}
      </p>
      <ul className="settings-provider-list">
        {info.providers.map((provider) => (
          <li key={provider.id} className="settings-provider-row" data-provider-id={provider.id}>
            <span className="settings-provider-label">{provider.label}</span>
            <code className="settings-provider-id">{provider.id}</code>
          </li>
        ))}
      </ul>
      <p className="settings-hub-note">完整配置界面随 A3b 到来——当前为只读检测。</p>
    </div>
  );
}

/** 记忆与隐私 — mirrors the vault capture switch + deep-links to the 画像页. */
function MemoryPrivacySection() {
  const [settings, setSettings] = useState<MemorySettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getSettingsIo()
      .fetchMemorySettings()
      .then(({ settings: next }) => {
        if (!cancelled) setSettings(next);
      })
      .catch(() => {
        if (!cancelled) setError("无法读取记忆设置");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleCapture = async (captureEnabled: boolean) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await getSettingsIo().saveMemorySettings({ captureEnabled });
      // Mirror into the local capture queue gate — the exact 画像页 behavior.
      setMemoryCaptureEnabled(captureEnabled);
      setSettings({ captureEnabled });
    } catch {
      setError("更新记录开关失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-memory-section">
      {settings ? (
        <label className="settings-capture-switch profile-capture-switch">
          <input
            type="checkbox"
            checked={settings.captureEnabled}
            disabled={busy}
            onChange={(event) => void toggleCapture(event.target.checked)}
          />
          记录学习行为（学习记忆）
        </label>
      ) : (
        <p className="settings-hub-muted">{error || "读取中…"}</p>
      )}
      {settings && error ? <p className="settings-hub-error-text">{error}</p> : null}
      <button
        type="button"
        className="settings-link-btn settings-open-profile-btn"
        onClick={() => navigateShell({ type: "pane", kind: "profile.panel" })}
      >
        打开画像与记忆（查看/清除记忆）
      </button>
    </div>
  );
}

/** 数据 — where this vault lives on disk (read-only). */
function DataSection() {
  const [vaultPath, setVaultPath] = useState("");
  const [vaultName, setVaultName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getSettingsIo()
      .fetchVaultInfo()
      .then((info) => {
        if (cancelled) return;
        setVaultPath(info.paths.rootDir);
        setVaultName(info.manifest.name ?? "");
      })
      .catch(() => {
        if (!cancelled) setError("无法读取数据目录");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="settings-hub-muted">{error}</p>;
  return (
    <div className="settings-data-section">
      {vaultName ? <p className="settings-vault-name">知识库:{vaultName}</p> : null}
      <p className="settings-hub-muted">数据目录(vault):</p>
      <code className="settings-vault-path">{vaultPath || "读取中…"}</code>
    </div>
  );
}

/** 关于 — version readout; 检查更新 stays a disabled stub until X1 (electron-updater). */
function AboutSection() {
  const [version, setVersion] = useState("");

  useEffect(() => {
    let cancelled = false;
    getSettingsIo()
      .fetchAbout()
      .then(({ version: next }) => {
        if (!cancelled) setVersion(next);
      })
      .catch(() => {
        // Version unreachable — the row just shows the app name.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="settings-about-section">
      <p className="settings-about-version">
        Growte{version ? ` v${version}` : ""}
      </p>
      <button
        type="button"
        className="settings-link-btn settings-check-update-btn"
        disabled
        title="随桌面更新通道(X1)上线"
      >
        检查更新
      </button>
    </div>
  );
}

// The shipped sections. Registration is idempotent (id-keyed), so re-imports and
// hot reloads never duplicate. Order groups: 10 AI · 20 记忆 · 30 数据 · 40 关于 —
// later tracks slot theirs in between without edits here.
registerSettingsSection({ id: "ai-providers", title: "AI 提供方", order: 10, render: () => <AiProvidersSection /> });
registerSettingsSection({ id: "memory-privacy", title: "记忆与隐私", order: 20, render: () => <MemoryPrivacySection /> });
registerSettingsSection({ id: "data", title: "数据", order: 30, render: () => <DataSection /> });
registerSettingsSection({ id: "about", title: "关于", order: 40, render: () => <AboutSection /> });

// —— the hub view ————————————————————————————————————————————————————————————

export function SettingsHub() {
  const sections = listSettingsSections();
  return (
    <aside className="settings-hub">
      <div className="panel-title">
        <Settings size={16} />
        设置
      </div>
      <div className="settings-hub-sections">
        {sections.map((section) => (
          <section key={section.id} className="settings-hub-section" data-section-id={section.id}>
            <h3 className="settings-hub-section-title">{section.title}</h3>
            <SectionBoundary sectionId={section.id}>
              <SectionBody section={section} />
            </SectionBoundary>
          </section>
        ))}
        {sections.length === 0 ? <p className="settings-hub-muted">暂无设置区块。</p> : null}
      </div>
    </aside>
  );
}

registerView({ kind: "settings.hub", render: () => <SettingsHub /> });
