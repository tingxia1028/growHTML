# Library Redesign — 统一加号 + 内容分区 (LIB-2)

> **Status: ✅ SHIPPED (LIB-2-001, 2026-07-04).** LibraryView rebuilt per §1–§3: registry pair
> `src/client/workspace/librarySections.tsx` (`LibrarySection` + `LibraryAddAction`, core-seeded
> from `libraryBuiltins.tsx` via side-effect import), scoped `library.css`, minimal typed I18N
> seed `src/client/i18n` (zh default + full en; provider/persistence = I18N-1). **新建 resolved
> to:** 文档… wired MINIMALLY over the EXISTING `POST /api/sources/html` ingest (seeded HTML doc,
> opens on create) — the markdown blank-create templates + 纯编辑模式 remain SRC-1/2
> (source-authoring.md) and will ride this same registry-backed 新建 group. **.xmind folded into
> the ONE 文件… picker** (extension routing inside `openFileDialog`; no separate menu item).
> Search input = client-side section-title filter with the SEARCH-1 mount seam commented.

User decision (2026-07-04, layout blessed): the Library pane holds many content kinds now —
give it ONE unified `+` entry for adding anything, and partition the list into content
sections instead of the current Folders-only body. Current state (`views.tsx` LibraryView):
header + kebab menu hiding ALL import actions (Open File/Folder, .xmind, URL fetch/live);
body = Folders + Recent Read; **no full documents list exists**.

## 1. Layout (blessed)

```
资料库                    🔍  ＋      ← title · search (SEARCH-1 mounts here) · the one +
▾ 最近                               ← 3–5 compact rows, one-click open
▾ 文档 (23)     [全部|PDF|网页|图片]   ← the NEW main list of all sources + type filter chips
▾ 文件夹 (2)                          ← mounted local folder trees (existing FileTree)
▾ 教材包 …                            ← kit-contributed sections (registry, later)
```

Principles:
- **Sections partition by CONTAINER, not file type** (最近/文档/文件夹/kit sections). Types
  are a filter-chip row on 文档's header — per-type sections would shred the list.
- Every section: collapsible, count badge, empty state with one guidance line (空库 → "点 +
  导入第一份资料"). All strings via I18N `defineMessages` (no hardcoded zh).
- **Kit sections are a VIEW over the same sources, never a container**: a kit registers a
  section that organizes content it recognizes (Textbook Kit → 教材 grouped by subject via
  detectSubject); uninstall the kit → the section disappears, the documents remain in 文档.
  Same law as "Layer 不改变 Source"; kernel-wise a section is a "view" contribution.

## 2. The unified `+` (registry-backed menu)

Two groups:
- **导入**: 文件… (PDF/图片/HTML/MD/.xmind — one picker, .xmind no longer a separate item) ·
  网页… (URL → 抓取 or 实时打开) · 挂载文件夹…
- **新建**: 文档… (markdown seed — the SRC-1 create entry point) · kit-contributed creators
  auto-append here (e.g. 新建课程包, later).
Both groups read a small `LibraryAddAction` registry (core seeds the built-ins; kits may
contribute) — same contribution idiom as everything else. Refresh stays in an overflow
menu; web mode disables desktop-only items with the existing hint pattern.

## 3. Contribution points (small, V1 = plumbing only)

```ts
LibrarySection { id, title (LocalizedText), order, render(ctx) }   // registerLibrarySection
LibraryAddAction { id, group: "import"|"create", title, icon?, run(ctx) }
```
Core registers 最近/文档/文件夹 sections + built-in add actions through the SAME registries
(shell-primitive rule: core-registered, not uninstallable, no bypass). No kit section ships
in LIB-2 itself — Textbook Kit's 教材 section rides FLAT-1's capability groups later.

## 4. Scope & sequencing
- LIB-2 = LibraryView rebuild (sections + full 文档 list + filter chips + `+` menu +
  registries) + scoped `library.css` (styles.css is contended by the parallel UI session).
- Search box = a filter over section items for now; SEARCH-1's Cmd+K palette replaces/feeds
  it later — leave a mount point, don't build search twice.
- Sequenced AFTER SPEECH-3 (my agents serialize on the shared implementation logs) and it
  must re-verify `views.tsx` is free of the parallel session before starting.

## 5. Tests
Sections render/collapse/counts; full source list + type chips filter; add-menu groups from
the registry (fixture kit action appears under 新建); kit-section registry (fixture section
renders, unregister removes it); web-mode disabled states; empty states; existing
LibraryView behaviors preserved (open/delete/recent/folder trees — port current assertions).
