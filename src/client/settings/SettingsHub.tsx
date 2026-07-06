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
import { defineMessages, resolveText, setLocale, t, useLocale, type Locale } from "../i18n";
import { registerView } from "../workspace/viewRegistry";
import { navigateShell } from "../workspace/shellNav";
import { IMPORT_CONFIRM_PHRASE, type BackupStatusInfo } from "../workspace/dataTrust";
import { setMemoryCaptureEnabled } from "../memory/capture";
import { getPlatformOptional, platformDialogs } from "../platform";
import { setSpeechPreferences, useSpeechPreferences } from "../speech/speechPreferences";
import type { MemorySettings } from "../data/entityClient";
import { listSettingsSections, registerSettingsSection } from "./registry";
import { getSettingsIo } from "./settingsIo";
import { AiProvidersSection } from "./AiProvidersSection";

const settingsMessages = defineMessages({
  title: { zh: "设置", en: "Settings" },
  sectionFailed: {
    zh: "该设置区块加载失败（其余设置不受影响）。",
    en: "This settings section failed to load. The rest of Settings is unaffected."
  },
  empty: { zh: "暂无设置区块。", en: "No settings sections yet." },
  languageSection: { zh: "语言", en: "Language" },
  languageHelp: { zh: "切换后界面立即刷新。", en: "The interface updates immediately after switching." },
  languageChinese: { zh: "中文", en: "Chinese" },
  languageEnglish: { zh: "English", en: "English" },
  languageSaveError: { zh: "语言偏好保存失败", en: "Failed to save language preference" },
  loading: { zh: "读取中…", en: "Loading…" },
  memorySection: { zh: "记忆与隐私", en: "Memory & Privacy" },
  aiProvidersSection: { zh: "AI 提供方", en: "AI Providers" },
  dataSection: { zh: "数据", en: "Data" },
  speechSection: { zh: "语音", en: "Speech" },
  aboutSection: { zh: "关于", en: "About" },
  readMemoryFailed: { zh: "无法读取记忆设置", en: "Unable to read memory settings" },
  captureLabel: { zh: "记录学习行为（学习记忆）", en: "Record learning activity (memory)" },
  updateCaptureFailed: { zh: "更新记录开关失败", en: "Failed to update the capture switch" },
  openProfile: { zh: "打开画像与记忆（查看/清除记忆）", en: "Open profile & memory (view/clear memory)" },
  readDataFailed: { zh: "无法读取数据目录", en: "Unable to read the data folder" },
  vaultLabel: { zh: "知识库:", en: "Vault:" },
  dataDirLabel: { zh: "数据目录(vault):", en: "Data folder (vault):" },
  backupStatusLabel: { zh: "备份状态", en: "Backup status" },
  noBackups: { zh: "暂无备份", en: "No backups yet" },
  lastBackupLabel: { zh: "上次备份", en: "Last backup" },
  backupTotalLabel: { zh: "总数", en: "Total" },
  nextBackupLabel: { zh: "下次自动检查", en: "Next auto check" },
  backupLimitLabel: { zh: "恢复列表显示份数", en: "Restore list limit" },
  backupRestoreLabel: { zh: "从备份恢复", en: "Restore from backup" },
  backupRestoreButton: { zh: "恢复", en: "Restore" },
  backupConfirmPrompt: { zh: "恢复会完整替换当前库。输入确认口令：", en: "Restore replaces the current vault. Type the confirmation phrase:" },
  backupConfirmMismatch: { zh: "确认口令不符，已取消恢复。", en: "Confirmation phrase did not match; restore was cancelled." },
  backupRestoreDone: { zh: "恢复完成，刷新后生效。恢复前备份：", en: "Restore complete. Refresh to reload. Pre-restore backup:" },
  backupRestoreFailed: { zh: "恢复失败", en: "Restore failed" },
  speechUnavailable: { zh: "朗读语音暂不可用", en: "Read-aloud voices are unavailable" },
  speechVoiceLabel: { zh: "音色", en: "Voice" },
  speechDefaultVoice: { zh: "默认音色", en: "Default voice" },
  speechRateLabel: { zh: "语速", en: "Rate" },
  checkUpdates: { zh: "检查更新", en: "Check for updates" },
  updateCurrent: { zh: "当前已是此安装版本", en: "This installation is on the current bundled version" },
  updateCheckFailed: { zh: "检查更新失败", en: "Unable to check for updates" }
});

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
          {t(settingsMessages.sectionFailed)}
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

function formatDateTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatBackupOption(backup: { name: string; createdAt: string; sizeBytes: number }): string {
  const mb = backup.sizeBytes / (1024 * 1024);
  const size = mb >= 0.1 ? `${mb.toFixed(1)} MB` : `${backup.sizeBytes} B`;
  return `${formatDateTime(backup.createdAt)} · ${size} · ${backup.name}`;
}

// —— built-in sections ————————————————————————————————————————————————————————
// AI 提供方 lives in ./AiProvidersSection (A3b): it REPLACED the SHELL-1 read-only
// stub through the same id-keyed registration below (re-registering "ai-providers"
// replaces — the seam the hub was built around).

/** 语言 — global app-shell locale, persisted through its own workspace field group. */
function LanguageSection() {
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getSettingsIo()
      .fetchUiPrefs()
      .then(({ prefs }) => {
        if (!cancelled) setLocale(prefs.locale);
      })
      .catch(() => {
        // LocalStorage/default locale remains the fallback.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const choose = async (next: Locale) => {
    if (busy || next === locale) return;
    setLocale(next);
    setBusy(true);
    setError("");
    try {
      await getSettingsIo().saveUiPrefs({ locale: next });
    } catch {
      setError(t(settingsMessages.languageSaveError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-language-section">
      <div className="settings-radio-group" role="radiogroup" aria-label={t(settingsMessages.languageSection)}>
        <label className="settings-radio-row">
          <input
            type="radio"
            name="growte-locale"
            value="zh"
            checked={locale === "zh"}
            disabled={busy}
            onChange={() => void choose("zh")}
          />
          <span>{t(settingsMessages.languageChinese)}</span>
        </label>
        <label className="settings-radio-row">
          <input
            type="radio"
            name="growte-locale"
            value="en"
            checked={locale === "en"}
            disabled={busy}
            onChange={() => void choose("en")}
          />
          <span>{t(settingsMessages.languageEnglish)}</span>
        </label>
      </div>
      <p className="settings-hub-muted">{t(settingsMessages.languageHelp)}</p>
      {error ? <p className="settings-hub-error-text">{error}</p> : null}
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
        if (!cancelled) setError(t(settingsMessages.readMemoryFailed));
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
      setError(t(settingsMessages.updateCaptureFailed));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-memory-section">
      {settings ? (
        <label className="settings-capture-switch profile-capture-switch sv-switch-row">
          <span className="sv-switch-copy">{t(settingsMessages.captureLabel)}</span>
          <span className="sv-switch">
            <input
              type="checkbox"
              className="sv-switch-input"
              checked={settings.captureEnabled}
              disabled={busy}
              onChange={(event) => void toggleCapture(event.target.checked)}
            />
            <span className="sv-switch-track" aria-hidden="true" />
          </span>
        </label>
      ) : (
        <p className="settings-hub-muted">{error || t(settingsMessages.loading)}</p>
      )}
      {settings && error ? <p className="settings-hub-error-text">{error}</p> : null}
      <button
        type="button"
        className="settings-link-btn settings-open-profile-btn"
        onClick={() => navigateShell({ type: "pane", kind: "profile.panel" })}
      >
        {t(settingsMessages.openProfile)}
      </button>
    </div>
  );
}

/** 数据 — where this vault lives on disk (read-only). */
function DataSection() {
  const [vaultPath, setVaultPath] = useState("");
  const [vaultName, setVaultName] = useState("");
  const [backupStatus, setBackupStatus] = useState<BackupStatusInfo | null>(null);
  const [backupLimit, setBackupLimit] = useState(() => {
    try {
      const prefs = getPlatformOptional()?.prefs;
      const raw = prefs
        ? prefs.get("growte.backup.restoreLimit")
        : globalThis.localStorage?.getItem("growte.backup.restoreLimit");
      return Math.max(1, Number(raw ?? 11));
    } catch {
      return 11;
    }
  });
  const [selectedBackup, setSelectedBackup] = useState("");
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState("");
  const [error, setError] = useState("");

  const loadBackupStatus = () =>
    getSettingsIo()
      .fetchBackupStatus()
      .then((status) => {
        setBackupStatus(status);
        setSelectedBackup((current) => current || status.backups[0]?.name || "");
      });

  useEffect(() => {
    let cancelled = false;
    const io = getSettingsIo();
    Promise.all([io.fetchVaultInfo(), io.fetchBackupStatus()])
      .then(([info, status]) => {
        if (cancelled) return;
        setVaultPath(info.paths.rootDir);
        setVaultName(info.manifest.name ?? "");
        setBackupStatus(status);
        setSelectedBackup(status.backups[0]?.name || "");
      })
      .catch(() => {
        if (!cancelled) setError(t(settingsMessages.readDataFailed));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateLimit = (value: number) => {
    const next = Math.max(1, Math.min(99, Math.round(value || 1)));
    setBackupLimit(next);
    try {
      const prefs = getPlatformOptional()?.prefs;
      if (prefs) prefs.set("growte.backup.restoreLimit", String(next));
      else globalThis.localStorage?.setItem("growte.backup.restoreLimit", String(next));
    } catch {
      // best-effort local UI preference
    }
  };

  const restoreSelected = async () => {
    if (!selectedBackup || restoreBusy) return;
    const answer = await platformDialogs().prompt(`${t(settingsMessages.backupConfirmPrompt)}\n${IMPORT_CONFIRM_PHRASE}`);
    if (answer === null) return;
    if (answer.trim() !== IMPORT_CONFIRM_PHRASE) {
      setRestoreMessage(t(settingsMessages.backupConfirmMismatch));
      return;
    }
    setRestoreBusy(true);
    setRestoreMessage("");
    try {
      const result = await getSettingsIo().restoreBackup(selectedBackup, IMPORT_CONFIRM_PHRASE);
      setRestoreMessage(`${t(settingsMessages.backupRestoreDone)}${result.preRestoreBackup}`);
      await loadBackupStatus();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setRestoreMessage(`${t(settingsMessages.backupRestoreFailed)}: ${message}`);
    } finally {
      setRestoreBusy(false);
    }
  };

  if (error) return <p className="settings-hub-muted">{error}</p>;
  const visibleBackups = backupStatus?.backups.slice(0, backupLimit) ?? [];
  return (
    <div className="settings-data-section">
      {vaultName ? <p className="settings-vault-name">{t(settingsMessages.vaultLabel)}{vaultName}</p> : null}
      <p className="settings-hub-muted">{t(settingsMessages.dataDirLabel)}</p>
      <code className="settings-vault-path">{vaultPath || t(settingsMessages.loading)}</code>
      <div className="settings-backup-status" aria-label={t(settingsMessages.backupStatusLabel)}>
        {backupStatus ? (
          <>
            <span>
              {backupStatus.backups.length > 0
                ? `${t(settingsMessages.lastBackupLabel)} ${formatDateTime(backupStatus.lastBackupAt)}`
                : t(settingsMessages.noBackups)}
            </span>
            <span>{t(settingsMessages.backupTotalLabel)} {backupStatus.backups.length}</span>
            <span>{t(settingsMessages.nextBackupLabel)} {formatDateTime(backupStatus.nextDueAt)}</span>
          </>
        ) : (
          <span>{t(settingsMessages.loading)}</span>
        )}
      </div>
      <label className="settings-field-row">
        <span>{t(settingsMessages.backupLimitLabel)}</span>
        <input
          type="number"
          min={1}
          max={99}
          value={backupLimit}
          onChange={(event) => updateLimit(Number(event.target.value))}
        />
      </label>
      <div className="settings-restore-row">
        <label>
          <span>{t(settingsMessages.backupRestoreLabel)}</span>
          <select
            value={selectedBackup}
            disabled={visibleBackups.length === 0 || restoreBusy}
            onChange={(event) => setSelectedBackup(event.target.value)}
          >
            {visibleBackups.length === 0 ? <option value="">{t(settingsMessages.noBackups)}</option> : null}
            {visibleBackups.map((backup) => (
              <option key={backup.name} value={backup.name}>
                {formatBackupOption(backup)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="settings-link-btn settings-restore-btn"
          disabled={!selectedBackup || restoreBusy}
          onClick={() => void restoreSelected()}
        >
          {restoreBusy ? t(settingsMessages.loading) : t(settingsMessages.backupRestoreButton)}
        </button>
      </div>
      {restoreMessage ? <p className="settings-hub-note">{restoreMessage}</p> : null}
    </div>
  );
}

/** 语音 — shared read-aloud preferences consumed by useSpeakText/SpeakButton. */
function SpeechSection() {
  const prefs = useSpeechPreferences();
  const [voices, setVoices] = useState<Array<{ id: string; label: string; locale: string }>>([]);
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getSettingsIo()
      .fetchSpeechStatus()
      .then((status) => {
        if (cancelled) return;
        setAvailable(!!status.tts.available);
        setVoices(status.tts.voices ?? []);
      })
      .catch(() => {
        if (!cancelled) setError(t(settingsMessages.speechUnavailable));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="settings-speech-section">
      {error ? <p className="settings-hub-muted">{error}</p> : null}
      <label className="settings-field-row">
        <span>{t(settingsMessages.speechVoiceLabel)}</span>
        <select
          value={prefs.voice ?? ""}
          disabled={!available || voices.length === 0}
          onChange={(event) => setSpeechPreferences({ voice: event.target.value || undefined })}
        >
          <option value="">{t(settingsMessages.speechDefaultVoice)}</option>
          {voices.map((voice) => (
            <option key={voice.id} value={voice.id}>
              {voice.label} · {voice.locale}
            </option>
          ))}
        </select>
      </label>
      <label className="settings-field-row settings-rate-row">
        <span>{t(settingsMessages.speechRateLabel)}</span>
        <input
          type="range"
          min="0.5"
          max="1.5"
          step="0.05"
          value={prefs.rate}
          onChange={(event) => setSpeechPreferences({ rate: Number(event.target.value) })}
        />
        <output>{prefs.rate.toFixed(2)}x</output>
      </label>
    </div>
  );
}

/** 关于 — version readout; 检查更新 refreshes the local version readout for X1. */
function AboutSection() {
  const [version, setVersion] = useState("");
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");

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

  const checkUpdates = async () => {
    if (checking) return;
    setChecking(true);
    setMessage("");
    try {
      const info = await getSettingsIo().fetchAbout();
      setVersion(info.version);
      setMessage(`${t(settingsMessages.updateCurrent)}: v${info.version}`);
    } catch {
      setMessage(t(settingsMessages.updateCheckFailed));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="settings-about-section">
      <p className="settings-about-version">
        Growte{version ? ` v${version}` : ""}
      </p>
      <button
        type="button"
        className="settings-link-btn settings-check-update-btn"
        disabled={checking}
        onClick={() => void checkUpdates()}
      >
        {checking ? t(settingsMessages.loading) : t(settingsMessages.checkUpdates)}
      </button>
      {message ? <p className="settings-hub-note">{message}</p> : null}
    </div>
  );
}

// The shipped sections. Registration is idempotent (id-keyed), so re-imports and
// hot reloads never duplicate. Order groups: 10 AI · 20 记忆 · 30 数据 · 40 关于 —
// later tracks slot theirs in between without edits here.
registerSettingsSection({
  id: "language",
  title: settingsMessages.languageSection,
  order: 5,
  render: () => <LanguageSection />
});
registerSettingsSection({
  id: "ai-providers",
  title: settingsMessages.aiProvidersSection,
  order: 10,
  render: () => <AiProvidersSection />
});
registerSettingsSection({
  id: "memory-privacy",
  title: settingsMessages.memorySection,
  order: 20,
  render: () => <MemoryPrivacySection />
});
registerSettingsSection({ id: "data", title: settingsMessages.dataSection, order: 30, render: () => <DataSection /> });
registerSettingsSection({ id: "speech", title: settingsMessages.speechSection, order: 35, render: () => <SpeechSection /> });
registerSettingsSection({ id: "about", title: settingsMessages.aboutSection, order: 40, render: () => <AboutSection /> });

// —— the hub view ————————————————————————————————————————————————————————————

export function SettingsHub() {
  useLocale();
  const sections = listSettingsSections();
  return (
    <aside className="settings-hub">
      <div className="panel-title">
        <Settings size={16} />
        {t(settingsMessages.title)}
      </div>
      <div className="settings-hub-sections">
        {sections.map((section) => (
          <section key={section.id} className="settings-hub-section" data-section-id={section.id}>
            <h3 className="settings-hub-section-title">{resolveText(section.title)}</h3>
            <SectionBoundary sectionId={section.id}>
              <SectionBody section={section} />
            </SectionBoundary>
          </section>
        ))}
        {sections.length === 0 ? <p className="settings-hub-muted">{t(settingsMessages.empty)}</p> : null}
      </div>
    </aside>
  );
}

registerView({ kind: "settings.hub", render: () => <SettingsHub /> });
