# App Shell UX — 左下角用户菜单 + 设置中枢 + 新手引导

Two user requests, one shell surface (both pass the kernel law as views): (1) a Claude-client-
style bottom-left user menu gathering the app's scattered settings/config; (2) first-run
onboarding (导入文档 → 接入 AI → 做笔记 → 看分层 → 导入笔记 → 复习). Grounded 2026-07-02.

## 1. 左下角用户菜单 (SHELL-1)
**Mount is CLEAN:** IconRail.tsx (repeatedly committed today — 复习/画像 entries) — add a
bottom-anchored avatar/identity button; the svpack identity (~/.growte, Tier-A name) supplies
the display name when present, else "本地用户".
**Popover menu entries (all existing or scheduled surfaces — the menu AGGREGATES, it does not
re-implement):**
- 设置 → the new **Settings Hub view** (below)
- Kit & 插件 → existing plugin.manager view
- 画像与记忆 → existing profile.panel view (capture switch/清除记忆 live there)
- 分享身份 → svpack identity/roster dialogs (shipped)
- 账户/积分 → G-A3b managed login+balance (menu entry ships DISABLED-with-tooltip until G-A3b)
- 关于 → version, licenses, 检查更新 (wired to electron-updater at X1; stub shows version now)
**Settings Hub** = one registered view (manager-panel idiom: registerView + WorkspaceShell
side-effect import + presets node — NOT a rail icon; reached via the menu) hosting sections:
AI 提供方 (A3b's home when it lands — the hub ships with the section stubbed to env-detection
readout), 外观 (theme tokens toggle if/when), 快捷键 readout, 数据目录/vault path readout,
记忆设置 deep-link. Sections REGISTER (a tiny `registerSettingsSection` list, additive) so
tracks land their panels without touching the hub again — the same recurring-capability
principle as everything else.

## 2. 新手引导 (SHELL-2 checklist now, SHELL-3 spotlight later)
**V1 = a welcome CHECKLIST panel, not a spotlight tour** — zero contended files, honest about
the reader-session gate:
- First-run detection: `onboarding` block in workspace prefs (`{dismissed, completedAt}`);
  fresh vault (no sources) + no flag → the panel auto-opens as the initial center view.
- Steps (each: 一句话 + "带我去" action + auto-done detection from EXISTING data — pure
  functions over vault/prefs state, no DOM spying):
  1. 导入第一个文档 — opens the library + import affordance; done: sources.length > 0
  2. 接入 AI — opens Settings Hub AI section (cli-agent auto-detect readout); done: a
     non-mock provider detected/configured
  3. 做第一条笔记 — instructs select-text→toolbar (V1 text + screenshot; spotlight = V3);
     done: notes.length > 0
  4. 看分层 — opens the Layers surface; done: layer toggled at least once (memory event
     layer.toggle exists — read via the events binding)
  5. 导入笔记/分享包 — opens svpack import dialog; done: any imported layer exists
  6. 复习一次 — opens the 复习 rail view; done: any note.review event
- Progress persists; dismissable + re-openable from the user menu (帮助/新手引导 entry).
- Optional: "载入示例文档" seeding the self-verify HTML fixture (existing) so step 3/4 are
  try-able without the user's own file.
**SHELL-3 (gated):** spotlight/coach-marks overlay needs `data-tour-id` anchors inside
contended reader/TopBar files → rides the reader-gated batch window; the checklist stays as
the fallback for keyboard/a11y.

## 3. Phasing
- **SHELL-1** user menu + Settings Hub (+registerSettingsSection) — clean files, parallel-safe.
- **SHELL-2** onboarding checklist + first-run flag + sample-doc seed — clean files.
- **SHELL-3** spotlight tour — reader-gated batch.
A3b/G-A3b land INTO the hub/menu when their tracks run (the hub is their mount, removing one
more reason to touch views.tsx).

## 4. Tests
Menu popover jsdom (entries render, disabled states); settings hub section registration;
onboarding: first-run detection (fresh vs existing vault), each step's done-detection pure fn,
persistence roundtrip, dismiss/reopen; sample-doc seed idempotent. e2e later with SHELL-3.
