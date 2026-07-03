# Shell Modal Surfaces + 全局双语 — SHELL-4 / I18N

User decisions (2026-07-04): ① left rail keeps ONLY Library · Review · Concepts · Profile;
② everything else (Operations, Kit & Plugin, settings-ish surfaces) lives in the bottom-left
user menu, and ALL config surfaces open as a **centered modal dialog** over the workspace
(Claude desktop client idiom), not as left-rail panel swaps; ③ every label ships 中文版 and
英文版, switchable in 设置 — **no mixed-language UI** (today e.g. the rail's "复习 (Review)",
English buttons inside Chinese panels).

## 1. SHELL-4 — rail slim + ModalViewHost

- `IconRail.tsx` `RAIL_ENTRIES` → `library`, `review.panel`, `concept.list`, `profile.panel`
  (that order). `operation.manager` / `plugin.manager` icons removed — the views stay
  registered; they are reached from the user menu (kernel: views stay registered + reachable,
  only the chrome entry moves — same move as the earlier rail dedup).
- **ModalViewHost** (new, in `WorkspaceShell`): a backdrop + centered dialog (~min(920px, 92vw),
  max-height ~86vh, internal scroll, ✕ + Esc + backdrop-click to close) that renders ANY
  registered view kind: `openModalView(kind)` exposed via WorkspaceContext (or a light
  ShellNav context). ONE host, view registry reuse — a view doesn't know whether it renders
  in the rail slot or the modal (no per-view forks; same rule as the manager-panel idiom).
- `UserMenu` entries route through `openModalView`: 设置 (settings.hub) · Kit & 插件
  (plugin.manager) · 操作 (operation.manager, NEW entry) · 分享身份 (layer.switcher) ·
  新手引导 · 关于. 画像与记忆 stays a rail destination (profile is rail-resident per ①);
  the menu item may deep-link to the rail view rather than a modal.
- Onboarding checklist deep-links that previously navigated to plugin.manager / settings now
  call `openModalView` — one code path.
- Non-goals: no routing rewrite, no dock-tree change; the modal is chrome ABOVE the dock,
  sibling of the FocusOverlay idiom (reuse its z-index/backdrop conventions).

## 2. I18N — locale system (two locales, restraint version)

- `src/client/i18n/`: `type Locale = "zh" | "en"`; `LocaleProvider` + `useLocale()`;
  dictionary modules per surface: typed `const M = defineMessages({ key: { zh: "…", en: "…" } })`
  and `t(M.key)` resolves by current locale. NO external i18n dependency — two locales, flat
  keys, full TypeScript checking (a missing translation is a type error).
- Persistence: `locale` rides workspace prefs via its own field-group-safe route slice
  (the single-writer-per-field-group rule — do NOT widen an existing PUT body). Default zh.
  Applies live (context), no restart.
- **Contribution labels become localizable**: registries that carry user-visible strings
  (note-type specs' labels, kit/capability-group names, command/operation titles, settings
  section titles, rail entries, right-sidebar tabs) accept
  `LocalizedText = string | { zh: string; en: string }` + core `resolveText(text, locale)`.
  A plain string stays legal (renders as-is in both locales) so third-party kits degrade
  gracefully — but ALL built-ins declare both.
- Settings Hub gains a 语言/Language section (radio 中文 / English) — registered via the
  existing `registerSettingsSection`.
- AI-facing strings (prompts, profileContext) are NOT localized by this track — model I/O
  language is a separate concern (prompts already write Chinese-first output rules).

## 3. Phasing
- **SHELL-4**: rail slim + ModalViewHost + user-menu rerouting + onboarding deep-links. Small,
  self-contained.
- **I18N-1**: mechanism (Locale/dicts/resolveText/prefs slice) + full sweep of CHROME: rail
  tooltips, user menu, right-sidebar tabs, top bar, settings hub (incl. new Language section),
  plugin manager, onboarding.
- **I18N-2**: panel-deep sweep (review runner, profile page, library, composer/preview,
  operations manager) + built-in contribution labels (note types, kits, commands). Acceptance:
  flip locale → ZERO hardcoded-language strings visible on each swept surface.
- Rule going forward: new user-visible strings MUST go through `t()`/`LocalizedText`; PR-time
  check = each swept surface has a locale-flip test (render zh, render en, assert no
  cross-locale markers — each surface dict exports its strings so tests can assert absence).
- Ordering vs the V1 queue: REV-CORE (in flight) → SHELL-4 → I18N-1 → FLAT-1 (manager UI is
  rebuilt inside the modal, bilingual from day one) → I18N-2 → SHELL-PRIM → SPEECH → X1+TRUST.

## 4. Tests
ModalViewHost: opens any registered kind, Esc/backdrop/✕ close, focus trap basic, user-menu
entries route, onboarding deep-link opens modal. Rail: exactly 4 entries. i18n: resolveText
string/object; locale persistence roundtrip (field-group-safe route); Settings language section
switches context live; per-surface locale-flip render tests (zh has no English leakage for
dict-covered strings and vice versa); plain-string contribution renders unchanged in both.
