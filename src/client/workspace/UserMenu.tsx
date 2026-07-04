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
import { backupStatusLine, runBackupNow, runExportVault, runImportVault } from "./dataTrust";
import { navigateShell } from "./shellNav";
import { getUserMenuIo } from "./userMenuIo";

const LOCAL_USER_NAME = "本地用户";
const FEEDBACK_ISSUES_URL = "https://github.com/tingxia1028/growHTML/issues";

type MenuEntry = {
  id: string;
  label: string;
  disabled?: boolean;
  /** Tooltip — mandatory on disabled entries (the honest "why not"). */
  title?: string;
  action?: () => void;
};

export function UserMenu() {
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
        // No identity endpoint / offline — 本地用户 stays.
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

  const displayName = identityName ?? LOCAL_USER_NAME;
  const initial = displayName.charAt(0).toUpperCase();

  const run = (action?: () => void) => {
    if (!action) return;
    close(false);
    action();
  };

  const entries: MenuEntry[] = [
    { id: "settings", label: "设置", action: () => navigateShell({ type: "pane", kind: "settings.hub" }) },
    { id: "plugins", label: "Kit & 插件", action: () => navigateShell({ type: "pane", kind: "plugin.manager" }) },
    { id: "profile", label: "画像与记忆", action: () => navigateShell({ type: "pane", kind: "profile.panel" }) },
    {
      id: "share",
      label: "分享身份",
      title: "分享/导入 .svpack(层列表里的分享与导入对话框)",
      action: () => navigateShell({ type: "pane", kind: "layer.switcher" })
    },
    // 数据 (TRUST-1/2, docs/design/data-trust.md) — the Settings Hub 数据 section
    // (status line + backup picker/restore) is deferred while SettingsHub is
    // contended; these entries expose the capability meanwhile (dataTrust.ts).
    {
      id: "backup-now",
      label: "立即备份",
      title: backupTitle ?? "把当前库打包为一份本地备份(zip,自动轮转保留)",
      action: () => {
        void runBackupNow();
      }
    },
    {
      id: "export-vault",
      label: "导出全库…",
      title: "下载 .growte-vault.zip(JSONL+资源+配置+清单)",
      action: () => {
        void runExportVault();
      }
    },
    {
      id: "import-vault",
      label: "导入全库(替换)…",
      title: "从 .growte-vault.zip 完整替换当前库(导入前自动备份)",
      action: () => runImportVault()
    },
    // TRUST-3 回收站 — the registered trash view (trashViews.tsx): deleted
    // documents/notes stay restorable for 30 days before auto-purge.
    {
      id: "trash",
      label: "回收站",
      title: "已删除的文档与笔记(30 天内可恢复,到期自动清除)",
      action: () => navigateShell({ type: "pane", kind: "trash.panel" })
    },
    { id: "account", label: "账户/积分", disabled: true, title: "等待托管上线" },
    { id: "onboarding", label: "帮助/新手引导", action: () => navigateShell({ type: "onboarding", open: true }) },
    {
      id: "feedback",
      label: "反馈问题",
      title: "在 GitHub 上提交 issue(浏览器打开)",
      action: () => {
        window.open(FEEDBACK_ISSUES_URL, "_blank", "noopener");
      }
    },
    {
      id: "about",
      label: version ? `关于 · v${version}` : "关于",
      action: () => navigateShell({ type: "pane", kind: "settings.hub" })
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
        <div className="shell-menu-pop" role="menu" aria-label="用户菜单" ref={popRef} onKeyDown={onPopKeyDown}>
          <div className="shell-menu-identity">
            <span className="shell-menu-identity-name">{displayName}</span>
            {identityId ? (
              <code className="shell-menu-identity-id">{identityId}</code>
            ) : (
              <span className="shell-menu-identity-hint">未创建分享身份</span>
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
