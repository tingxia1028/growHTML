# Official Website — 官网 (product · download · pricing · plugin-dev docs)

A public site so people can see what Growte is, download it, later buy plans — 酷炫, education
vertical first, plus plugin development tutorials. P3 (platform & business) per the kernel —
and P0 closed today, so P3 items are legitimately schedulable in idle slots. Real download
links gate on X1 (electron-builder + GitHub Releases). Grounded 2026-07-02.

## 1. Stack + repo decision
- **Astro + MDX**, `website/` subdir in this repo (monorepo-lite): content-heavy site, zero-JS
  by default (fast = 酷炫's precondition), MDX for tutorials, and it can import the app's
  design tokens (styles.css `--sv-*` vars) so the site LOOKS like the product — the cheapest
  authentic cool. Deploy: Vercel or GitHub Pages via CI; domain when the user has one
  (ICP 备案 rides the license chain if hosted in-country — same ledger as managed/marketplace).
- No SPA framework needed until the hosted marketplace web storefront (MH-1) — which will be
  its own app behind the same domain (`/market`), NOT this site.

## 2. Information architecture
- **Home** — hero (the loop story: 读→锚→记→问→复 with live-looking captures), 三个卖点
  (anchor-native notes · AI that knows what you're weak at · 可分享的学习层), download CTA
  (OS auto-detect), education-vertical banner.
- **教育版** — the textbook kit story (预习/学习/复习/拓展, 错题→复习环, 老师分层分享 svpack,
  班级场景), screenshots per flow.
- **下载** — per-platform cards (Win NSIS / macOS universal / mobile "即将推出" until X2/X3),
  release notes feed from GitHub Releases API, auto-update note.
- **文档** — 用户手册 (import/annotate/layers/review/share) + **插件开发教程**: data-plugin
  how-to (operations/prompts-as-data, kit configs, taxonomies — mirrors the marketplace
  data-only rule), the CatalogSource/registry contracts reference, worked example (build a
  vocab kit). Source of truth = MDX here; deep technical contracts LINK to the repo docs
  rather than duplicating.
- **定价** — BYOK 免费本地 vs 托管积分/月费 plans; ships as "即将推出" placeholders until the
  G license chain + real payments land (no fake prices).
- 关于/联系 — minimal.

## 3. 酷炫 direction (concrete, not vibes)
Dark-first using the app's token palette; one signature interaction on the hero (an anchored
passage that grows a note card on scroll — CSS/scroll-driven, no heavy JS); real product
captures over illustrations; motion restrained (the product's own aesthetic is calm precision —
the site should feel like the app, not a crypto landing page).

## 4. Phasing
- **WEB-1 — landing + download + 教育版** (static, screenshots + Releases API; links go live
  the day X1 ships its first release).
- **WEB-2 — 文档/插件教程** (MDX; extract the data-plugin tutorial from the shipped contracts:
  operations, kit registration, CatalogSource).
- **WEB-3 — 定价/购买 + 账户** (rides G launch; later the MH-1 storefront mounts at /market).

## 5. Tests / acceptance
Build passes in CI (astro check + link check); Lighthouse ≥ 95 perf/a11y on Home; download
links resolve per-OS; docs pages render the worked plugin example verbatim from a
CI-compiled snippet (no rot); zh-CN primary, en stub acceptable at WEB-1.
