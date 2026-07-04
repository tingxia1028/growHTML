// UserMenu (SHELL-1, docs/design/app-shell-ux.md §1) — the Claude-client-style
// bottom-left identity button + popover on the IconRail. The menu AGGREGATES existing
// or scheduled surfaces, it re-implements none of them:
//   设置          → the Settings Hub view (left-slot swap via the shell nav bus)
//   Kit & 插件    → the existing plugin.manager view
//   画像与记忆    → the existing profile.panel view
//   分享身份      → the Layers pane (layer.switcher), which hosts the shipped svpack
//                   分享/导入 dialogs (svpackViews) — the identity/roster surfaces
//   数据          → 立即备份 / 导出全库… / 导入全库(替换)… (TRUST-1/2, dataTrust.ts;
//                   the hub 数据 section is deferred while SettingsHub is contended)
//                   + 回收站 (TRUST-3 → the trash.panel view, trashViews.tsx)
//   账户/积分     → DISABLED with tooltip until G-A3b (managed login + balance)
//   帮助/新手引导 → reopen the SHELL-2 onboarding checklist (center view)
//   反馈问题      → GitHub issues via window.open (desktop's window-open handler
//                   routes _blank to shell.openExternal; web opens a tab) (X1)
//   关于          → the Settings Hub (its 关于 section carries version + 检查更新 stub)
// Display name = the local Tier-A svpack identity when present, else 本地用户.
// Accessible: Esc closes, focus enters the menu on open (minimal trap: Tab cycles),
// mousedown outside closes, focus restores to the trigger on close.

import { useCallback, useEffect, useRef, useState } from "react";
import { defineMessages, t, useLocale } from "../i18n";
import { backupStatusLine, runBackupNow, runExportVault, runImportVault } from "./dataTrust";
import { navigateShell } from "./shellNav";
import { getUserMenuIo } from "./userMenuIo";

const FEEDBACK_ISSUES_URL = "https://github.com/tingxia1028/growHTML/issues";

const userMenuMessages = defineMessages({
  localUser: { zh: "本地用户", en: "Local User" },
  userMenu: { zh: "用户菜单", en: "User menu" },
  noIdentity: { zh: "未创建分享身份", en: "No sharing identity yet" },
  settings: { zh: "设置", en: "Settings" },
  plugins: { zh: "插件", en: "Kit & Plugin" },
  operations: { zh: "操作", en: "Operations" },
  profile: { zh: "画像与记忆", en: "Profile & Memory" },
  shareIdentity: { zh: "分享身份", en: "Share Identity" },
  shareTitle: {
    zh: "分享/导入 .svpack（层列表里的分享与导入对话框）",
    en: "Share/import .svpack from the Layers sharing dialogs"
  },
  backupNow: { zh: "立即备份", en: "Back Up Now" },
  backupTitle: {
    zh: "把当前库打包为一份本地备份（zip，自动轮转保留）",
    en: "Package this vault as a local backup zip with automatic rotation"
  },
  exportVault: { zh: "导出全库…", en: "Export Vault…" },
  exportTitle: {
    zh: "下载 .growte-vault.zip（JSONL+资源+配置+清单）",
    en: "Download a .growte-vault.zip with JSONL, assets, config, and manifest"
  },
  importVault: { zh: "导入全库（替换）…", en: "Import Vault (Replace)…" },
  importTitle: {
    zh: "从 .growte-vault.zip 完整替换当前库（导入前自动备份）",
    en: "Replace this vault from a .growte-vault.zip after an automatic backup"
  },
  trash: { zh: "回收站", en: "Trash" },
  trashTitle: {
    zh: "已删除的文档与笔记（30 天内可恢复，到期自动清除）",
    en: "Deleted documents and notes are restorable for 30 days before auto-purge"
  },
  account: { zh: "账户/积分", en: "Account / Credits" },
  accountTitle: { zh: "等待托管上线", en: "Waiting for hosted account support" },
  onboarding: { zh: "帮助/新手引导", en: "Help / Onboarding" },
  shortcuts: { zh: "快捷键", en: "Shortcuts" },
  feedback: { zh: "反馈问题", en: "Report Issue" },
  feedbackTitle: { zh: "在 GitHub 上提交 issue（浏览器打开）", en: "Open GitHub issues in the browser" },
  about: { zh: "关于", en: "About" },
  builtin: { zh: "内置", en: "Built in" }
});

type MenuEntry = {
  id: string;
  label: string;
  disabled?: boolean;
  /** Tooltip — mandatory on disabled entries (the honest "why not"). */
  title?: string;
  action?: () => void;
};

export function UserMenu() {
  useLocale();
  const [open, setOpen] = useState(false);
  const [identityName, setIdentityName] = useState<string | null>(null);
  const [identityId, setIdentityId] = useState<string | null>(null);
  const [version, setVersion] = useState("");
  const [backupTitle, setBackupTitle] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  // Identity + version readouts — fire-and-forget; failures keep the fallbacks.
  useEffect(() => {
    let cancelled = false;
    const io = getUserMenuIo();
    io.fetchIdentity()
      .then(({ identity }) => {
        if (cancelled || !identity) return;
        setIdentityName(identity.displayName);
        setIdentityId(identity.id);
      })
      .catch(() => {
        // No identity endpoint / offline — keep the local fallback.
      });
    io.fetchAbout()
      .then(({ version: next }) => {
        if (!cancelled) setVersion(next);
      })
      .catch(() => {
        // Version unreachable — the 关于 row just shows no number.
      });
    // TRUST-1 readout for the 立即备份 tooltip ("上次备份 x 小时前 · 共 N 份").
    backupStatusLine()
      .then((line) => {
        if (!cancelled && line) setBackupTitle(line);
      })
      .catch(() => {
        // Status unreachable — the entry keeps its static tooltip.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  // Mousedown OUTSIDE the menu root closes (attached only while open).
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) {
        close(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open, close]);

  // Focus moves into the popover on open (first enabled item).
  useEffect(() => {
    if (!open) return;
    const first = popRef.current?.querySelector<HTMLElement>(".shell-menu-item:not([disabled])");
    first?.focus();
  }, [open]);

  const displayName = identityName ?? t(userMenuMessages.localUser);
  const initial = displayName.charAt(0).toUpperCase();

  const run = (action?: () => void) => {
    if (!action) return;
    close(false);
    action();
  };

  const entries: MenuEntry[] = [
    { id: "settings", label: t(userMenuMessages.settings), action: () => navigateShell({ type: "modal", kind: "settings.hub" }) },
    { id: "plugins", label: t(userMenuMessages.plugins), action: () => navigateShell({ type: "modal", kind: "plugin.manager" }) },
    { id: "operations", label: t(userMenuMessages.operations), action: () => navigateShell({ type: "modal", kind: "operation.manager" }) },
    { id: "profile", label: t(userMenuMessages.profile), action: () => navigateShell({ type: "pane", kind: "profile.panel" }) },
    {
      id: "share",
      label: t(userMenuMessages.shareIdentity),
      title: t(userMenuMessages.shareTitle),
      action: () => navigateShell({ type: "modal", kind: "layer.switcher" })
    },
    // 数据 (TRUST-1/2, docs/design/data-trust.md) — the Settings Hub 数据 section
    // (status line + backup picker/restore) is deferred while SettingsHub is
    // contended; these entries expose the capability meanwhile (dataTrust.ts).
    {
      id: "backup-now",
      label: t(userMenuMessages.backupNow),
      title: backupTitle ?? t(userMenuMessages.backupTitle),
      action: () => {
        void runBackupNow();
      }
    },
    {
      id: "export-vault",
      label: t(userMenuMessages.exportVault),
      title: t(userMenuMessages.exportTitle),
      action: () => {
        void runExportVault();
      }
    },
    {
      id: "import-vault",
      label: t(userMenuMessages.importVault),
      title: t(userMenuMessages.importTitle),
      action: () => runImportVault()
    },
    // TRUST-3 回收站 — the registered trash view (trashViews.tsx): deleted
    // documents/notes stay restorable for 30 days before auto-purge.
    {
      id: "trash",
      label: t(userMenuMessages.trash),
      title: t(userMenuMessages.trashTitle),
      action: () => navigateShell({ type: "modal", kind: "trash.panel" })
    },
    { id: "account", label: t(userMenuMessages.account), disabled: true, title: t(userMenuMessages.accountTitle) },
    { id: "onboarding", label: t(userMenuMessages.onboarding), action: () => navigateShell({ type: "modal", kind: "onboarding.checklist" }) },
    { id: "shortcuts", label: t(userMenuMessages.shortcuts), action: () => navigateShell({ type: "modal", kind: "shortcut.help" }) },
    {
      id: "feedback",
      label: t(userMenuMessages.feedback),
      title: t(userMenuMessages.feedbackTitle),
      action: () => {
        window.open(FEEDBACK_ISSUES_URL, "_blank", "noopener");
      }
    },
    {
      id: "about",
      label: version ? `${t(userMenuMessages.about)} · v${version}` : t(userMenuMessages.about),
      action: () => navigateShell({ type: "modal", kind: "settings.hub" })
    }
  ];

  // Esc closes; a MINIMAL Tab trap cycles within the popover's enabled items.
  const onPopKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key !== "Tab") return;
    const items = Array.from(
      popRef.current?.querySelectorAll<HTMLElement>(".shell-menu-item:not([disabled])") ?? []
    );
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="shell-menu" ref={rootRef}>
      {open ? (
        <div className="shell-menu-pop" role="menu" aria-label={t(userMenuMessages.userMenu)} ref={popRef} onKeyDown={onPopKeyDown}>
          <div className="shell-menu-identity">
            <span className="shell-menu-identity-name">{displayName}</span>
            {identityId ? (
              <code className="shell-menu-identity-id">{identityId}</code>
            ) : (
              <span className="shell-menu-identity-hint">{t(userMenuMessages.noIdentity)}</span>
            )}
          </div>
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="menuitem"
              className="shell-menu-item"
              data-entry-id={entry.id}
              disabled={entry.disabled}
              title={entry.title}
              onClick={() => run(entry.action)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        className="shell-menu-trigger"
        ref={triggerRef}
        aria-haspopup="menu"
        aria-expanded={open}
        title={displayName}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) close(true);
        }}
      >
        <span className="shell-menu-avatar-dot" aria-hidden="true">
          {initial}
        </span>
        <span className="shell-menu-avatar-label">{displayName}</span>
      </button>
    </div>
  );
}
