# Plugin / Kit / Viewer 模型(定稿)

状态:定稿(2026-07-01);§8 "Marketplace model" 定稿 v2(2026-07-02)。作为 "Kit & Plugin" 功能与 viewer 层的地基。
关联:`textbook-product-kit`(记忆)、`docs/design/markdown-viewer-plugins.md`(命名待对齐到本文)、`docs/design/studypack-sharing.md`(§8.7 的 import 依赖解析挂接其 §6 recipient 流程)。

## 1. 术语(钉死)

- **Plugin = 最小扩展单元**(Obsidian 插件那种)。它向宿主**注册若干"贡献"(contribution)**。plugin 本身是能力单元,不是某种注册项。
- **Kit = 精选打包 + 配置**。一个垂直产品 = 一组 plugin + 布局 + 语言 + 策略。Kit 不是扩展单元,是"发行版/产品"。
- **关系:Kit 装 Plugin;Plugin 才是能力单元。** 一个 plugin 可以被多个 kit 复用;一个 kit 可以只 enable 某 plugin 的部分贡献。

> 修正历史说法:note-type-plugin 不是"kit 的一种注册项",而是 plugin 能贡献的**一种** contribution。

## 2. Contribution 种类(plugin 能贡献什么)

- **NoteType renderer** —— 渲染一个 `contentType` 的 note(render/edit)。**独占**,key = `contentType`。
- **Viewer** —— 跨类型/文件级的展示层(表格、看板、日历、mindmap 全屏…)。**独占**,靠 resolver 选。
- **Decoration / marker** —— 在已渲染内容上叠加(锚点图标、批注高亮、post-processor)。**叠加**。
- **Command / Operation** —— 动作(可上工具栏)。
- **Prompt pack** —— 结构化生成的提示词。
- **Language / Layout / Policy** —— 文案、dock 布局、层传播策略。

## 3. 冲突的关键:先分两类

| | **独占型 (exclusive)** | **叠加型 (compositional)** |
|---|---|---|
| 语义 | 一个槽只能有**一个**渲染者 | **所有**匹配者都作用 |
| 例子 | note 用哪个 viewer 打开 | 装饰、批注 marker、post-processor |
| 冲突 | 有"选哪个" | 无 —— 只需定**顺序** |

**大多数"多插件抢 viewer"的痛,都是把本该独占的做成模糊匹配、或把本该叠加的做成互斥。先分流。**

## 4. 独占型的解法(抄 VS Code 的心智模型)

统一优先级链:

```
用户显式关联(最高)  >  match() 特异性/打分  >  priority  >  注册顺序(last-wins + 警告)  >  默认 fallback
                      并且永远保留 "用…打开 / Reopen With…" 逃生口
```

- **key/命名空间**是第一消歧器(`contentType` / mime / 文件 glob / fence lang);plugin id 前缀防误撞;同 key 重复 = 安装期报错或 last-wins + 警告。
- **特异性打分**:viewer 声明 `match(note|file) → number`(0 = 不接;越高越特化),host 取最高分。
- **用户显式选择压过一切**,并持久化(per-type / per-note 关联,存 prefs)。
- 必给**默认 fallback**(回落到该类型的 NoteType renderer)+ **手动切换**。

参考:Obsidian `registerView`/`registerExtensions`(按 key,多个能开 → 用户选默认)、`registerMarkdownCodeBlockProcessor(lang)`(fence key);VS Code `customEditors`(`viewType + selector + priority: default|option` + `workbench.editorAssociations` 用户 pin + "Reopen With")。

## 5. 叠加型的解法

**全部匹配者都跑,结果合并**,顺序由 `priority`/`sortOrder`/precedence 决定。没有"选哪个",只有"按什么顺序叠"。参考:Obsidian post-processor、VS Code hover/completion providers、CM6 facet precedence。

我们的 anchor marker / 批注高亮就属这类。

## 6. growHTML 落地

1. **NoteType 渲染 = 独占,key = `contentType`**。现有 `getNoteType(contentType)` registry 已是"一类型一渲染器"。把重复注册定成 **last-wins + 警告**,或带 `priority` 让 kit B 显式覆盖 kit A(如换掉默认 markdown 渲染)。
2. **Viewer 层(待建)= 独占槽 + resolver**:`Viewer { id, match(note|file)→score, render, priority? }`;host `resolveViewer()` 按 §4 优先级链选;用户可 pin;fallback 到 NoteType renderer;给"用…打开"。
3. **Decoration/marker = 叠加**:走"全跑 + priority 排序",不进独占 resolver。
4. **plugin id 命名空间化**,注册 key 用 `pluginId:key` 或校验唯一。

## 7. Kit & Plugin 管理(左侧栏)【superseded by §8 Marketplace — kept for history】

- 最左侧栏加 **"Kit & Plugin"** 入口:列出已装 kit / plugin,开关各 contribution,查看/解决 viewer 冲突(显示当前 winner + 让用户改关联)。
- **用户自定义 kit**:把选中的一组 plugin + 布局 + 语言存成一个用户 kit(register-only,不改 core)。
- 先把 §1–§6 的契约在代码里落实(尤其 Viewer resolver + 命名空间 id),再挂 UI。

> Status: shipped as the P2 flat manager panel (`src/client/workspace/pluginManagerViews.tsx`, view kind `plugin.manager`, rail entry in `src/client/workspace/IconRail.tsx`) plus the P3 viewer-conflict picker. **§8 supersedes this PANEL as the product surface** — the read model, `plugin-prefs.json`, and the per-contribution toggles all survive, relocated into the market's plugin detail page ("Advanced", §8.5.3). Kept here for history.

## 8. Marketplace model (定稿 v2)

状态:定稿(2026-07-02)。Reframes the left-rail "Kit & Plugin" entry as a **market**. Everything in §1–§6 stays the substrate — contribution kinds, the exclusive/compositional split, the viewer resolver, namespaced ids, the plugin read model (`src/kits/plugin.ts`). The market adds two things on top: a **catalog** (what CAN be installed, with market presentation) and per-vault **install state** (what IS installed). It changes no host registry contract.

### 8.1 Three layers: hidden vs listed

- **(a) Core primitives — HIDDEN.** Content basics are always-on infrastructure: registered unconditionally at startup (side-effect imports of `src/core/notes/contentTypes.ts` `builtinNoteContentSpecs` + `src/client/notes/builtinNoteTypes.tsx`), **never listed in the market**, not installable/uninstallable. The table primitive today = the pipe-table content *inside* markdown (there is no separate table contentType); if a dedicated table contentType is ever added it is also core — while the enhanced Table *viewer* is a plugin.
- **(b) Plugins — the market's item unit.** Upper-layer semantic/functional units. Each is one `CatalogEntry(kind:"plugin")` (§8.2) and, when its code is active, one `PluginRecord` in the read model. Installed-ness is per-vault state (§8.3).
- **(c) Kits — bundles of plugin refs.** Official curated kits (Textbook Learning Kit, `src/kits/textbook-learning/index.tsx`) AND user-defined compositions (§8.5.4). A kit carries no capability of its own — capability lives in member plugins; a kit additionally bundles config (layout / language / policy), exactly as `ProductKit` (`src/kits/types.ts`) already models.

Rule of thumb: the market lists units a user can meaningfully **choose**; core primitives are the substrate every vault needs to display anything at all.

Classification of everything that exists today:

| Today's unit (registration site) | Layer | Market? | Note |
|---|---|---|---|
| `markdown` (+ hidden legacy alias `plain-text`) | core primitive | hidden | always-on |
| `code-snippet` | core primitive | hidden | |
| `image` / `audio` / `video` | core primitive | hidden | asset/embed variants stay internal to the one renderer |
| `html-sandbox` (static + interactive) | core primitive | hidden | |
| markdown pipe-table content | core primitive | hidden | the CONTENT is markdown; the enhanced viewer is the next row |
| Table viewer (`core:table`, `src/client/notes/tableViewer.tsx`) | **plugin** `table-viewer` | listed | today registered under pluginId `"core"` → re-home (§8.10) |
| `flashcard` (builtinNoteTypes.tsx) | **plugin** `flashcard` | listed | reclassified out of the "core" seed — metadata-first |
| `quiz` (builtinNoteTypes.tsx) | **plugin** `quiz` | listed | ditto |
| `bookmark` (`BOOKMARK_CONTENT_TYPE`, currently in core) | **plugin** `bookmark` | listed | reclassified OUT of core — §8.6 |
| `mermaid` + `markmap` (+ hidden legacy `mindmap`) | **plugin** `diagrams` | listed | one plugin providing both types (doc-level call; consistent with the locked list's open tail) |
| `textbook.explanation` | **plugin** `explanation` | listed | today inside the monolithic textbook kit → split (§8.10) |
| `textbook.exercise` | **plugin** `practice` | listed | |
| `textbook.mistake` | **plugin** `mistake` | listed | |
| `textbook.review-pack` | **plugin** `review-pack` | listed | |
| textbook domain language (`ctx.language.register`) | **plugin** `textbook-language` | listed | language packs are plugins |
| Textbook Learning Kit | **kit** | listed (Kits tab) | becomes refs to the plugins above + layout/policy |
| user-defined kits | **kit** | listed (Kits tab) | stored in plugin-prefs `userKits` (§8.3) |

Hidden means hidden: core primitives get no card and no detail page. (Composer-level hiding of legacy aliases — `plain-text`/`mindmap` are `hidden:true` in `builtinNoteTypes.tsx` — is a registry flag, orthogonal to install state.)

### 8.2 Catalog data model

A new React-free module (peer of `src/kits/plugin.ts`; e.g. `src/kits/catalog.ts`) — the market's read model. **V1 = a static, bundled array** (all plugin code ships in the app bundle); the types are shaped so a remote registry can back the SAME UI later (§8.9).

```ts
// One market item. `id` doubles as the pluginId (kind:"plugin") / kitId (kind:"kit")
// used everywhere else (PluginRecord.id, namespaceId(), NoteTypePlugin.pluginId).
export type CatalogEntry = {
  id: string;
  kind: "plugin" | "kit";
  name: string;
  icon?: string;              // lucide icon name (same convention as KitSurfaceItem.icon)
  description: string;
  version?: string;           // informational in V1 (bundled == app version)
  author?: string;            // "growte" for official entries
  /** Detail-page live preview (§8.4.3): 1–2 sample notes rendered through the plugin's
      OWN registered renderer. sampleContent MUST validate against the core
      NoteContentSpec schema for its contentType (parseNoteContent-clean). */
  previewFixtures?: { contentType: string; sampleContent: unknown; label?: string }[];
  /** plugins: the contributions installing this plugin activates — the same Contribution
      shape as the read model (src/kits/plugin.ts), so the detail page, the Advanced
      toggles, and the disabled set share one vocabulary + one namespaced id space. */
  contributions?: Contribution[];
  /** plugins: the contentTypes this plugin PROVIDES (its noteType contribution keys).
      This is the import-resolution index (§8.7): contentType → providing plugin. */
  provides?: string[];
  /** kits: member plugin ids — each must resolve to a kind:"plugin" entry. */
  members?: string[];
  /** Counts as installed while catalogState is null (back-compat, §8.3). true for every
      V1 bundled entry, since everything shipping today is active today. */
  defaultInstalled?: boolean;
  /** V1: always "bundled". A future remote registry adds "registry" + acquisition
      metadata WITHOUT changing this UI contract (§8.9). */
  source?: "bundled" | "registry";
};
```

Two hard requirements on the surrounding code:

1. **contentType → pluginId index.** The catalog exposes `providerOf(contentType): CatalogEntry | undefined`, built from `provides`. Prerequisite: `NoteTypePlugin.pluginId` (`src/client/notes/noteTypeRegistry.tsx` — today optional, "absent for built-ins") becomes **required for every cataloged plugin's registrations**, so the renderer registry, the read model, and the catalog agree on ownership. Core primitives keep `pluginId` absent and are deliberately NOT in the catalog → `providerOf("markdown") === undefined` means "always available, nothing to install".
2. **Catalog vs read model.** `PluginRecord` (`listInstalledPlugins()`) stays the *runtime* truth of what is registered in this session; `CatalogEntry` is what *could* be installed plus its market presentation. In V1-bundled the two coincide for plugins (every cataloged plugin's code is in the bundle and registers at startup); the market joins them by `id`.

### 8.3 Install state: the plugin-prefs extension

Storage stays the per-vault `plugin-prefs.json` (`src/server/app.ts` `pluginPrefsSchema`, `GET/PUT /api/plugin-prefs`, written via `vault.storage.writeTextAtomic` under `vault.paths.studyDir`; client mirror `PluginPrefs` + `pluginPrefs()/putPluginPrefs()` in `src/client/data/entityClient.ts`). Extension:

```ts
// TYPES the userKits slot declared (as z.array(z.unknown())) since P2.
const userKitSchema = z.object({
  id: z.string().min(1),                    // "user:" prefix, e.g. "user:exam-prep"
  name: z.string().min(1),
  description: z.string().default(""),
  members: z.array(z.string()).default([])  // cataloged plugin ids
});

const pluginPrefsSchema = z.object({
  disabledContributions: z.array(z.string()).default([]),  // unchanged (P2 → "Advanced")
  viewerAssociations: /* unchanged (P3 pins) */,
  userKits: z.array(userKitSchema).default([]),            // now typed
  // NEW (M1): market install state.
  catalogState: z
    .object({
      // null = vault has never touched the market → the DEFAULT-INSTALLED set
      // (every bundled entry with defaultInstalled:true = everything active today).
      installedPlugins: z.array(z.string()).nullable().default(null),
      installedKits: z.array(z.string()).nullable().default(null)
    })
    .default({ installedPlugins: null, installedKits: null })
});
```

**Back-compat default (locked):** an existing vault — absent file, or a prefs file without `catalogState` — parses to `{ installedPlugins: null, installedKits: null }`, and `null` means the default-installed set. Since every V1 bundled entry is `defaultInstalled:true`, **existing vaults see no change**. The first explicit install/uninstall MATERIALIZES the effective set into concrete arrays and then applies the delta — so catalog entries added in later app versions don't silently auto-install into a vault that has started curating.

**Effective-installed derivation** (also the kit refcount, §8.5.2 — derived, nothing persisted beyond the two lists):

```
installedKitIds   = catalogState.installedKits    ?? { defaultInstalled kits }
directPluginIds   = catalogState.installedPlugins ?? { defaultInstalled plugins }
effectiveInstalled(p) ⇔ p ∈ directPluginIds
                       ∨ ∃ k ∈ installedKitIds : p ∈ members(k)   // catalog kits ∪ userKits
```

`userKits` participate uniformly: their ids sit in `installedKits` like any catalog kit (the create flow adds the new kit id there, since its members were picked from this vault's catalog).

### 8.4 Market UI

Where: the SAME left-rail entry (`src/client/workspace/IconRail.tsx` `{ kind: "plugin.manager", label: "Kit & Plugin" }`). The view registered in `pluginManagerViews.tsx` is REPLACED by the market; the view kind stays `plugin.manager` so `presets.ts` / persisted `workspace.json` need no migration.

**8.4.1 List — two tabs: Plugins | Kits**, search + filter, item cards:

```
┌──────────────────────────────────────────────┐
│ Kit & Plugin                      [search…]  │
│ ┌─────────┬──────┐        filter: [All ▾]    │
│ │ Plugins │ Kits │                           │
│ └─────────┴──────┘                           │
│ ┌──────────────────────────────────────────┐ │
│ │ ▤ Flashcard                [Installed ✓] │ │
│ │   Two-sided recall cards                 │ │
│ ├──────────────────────────────────────────┤ │
│ │ ? Quiz                     [Install]     │ │
│ │   Single-choice questions with answers   │ │
│ ├──────────────────────────────────────────┤ │
│ │ ⌗ Table viewer             [Installed ✓] │ │
│ │   Renders markdown pipe tables as tables │ │
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

Card = icon · name · one-line description · install state (badge or button). Search matches name + description; filter = All / Installed / Not installed (later: source). The Kits tab uses the same card plus an "N plugins" count; user kits mix in with a `user` badge, plus a `+ New kit` entry (M2, §8.5.4).

**8.4.2 Detail page** (drill-in from a card, with back navigation):

```
┌──────────────────────────────────────────────┐
│ ← back                                       │
│ ▤ Flashcard                 v1 · by growte   │
│   Two-sided recall cards for spaced recall.  │
│                        [ Install / Remove ]  │
│ ── Preview ───────────────────────────────── │
│ ┌───────────────┐  ┌───────────────┐         │
│ │ sample note 1 │  │ sample note 2 │  ← live │
│ │ (plugin's own │  │               │  render │
│ │  renderer)    │  │               │         │
│ └───────────────┘  └───────────────┘         │
│ ── Contributions ─────────────────────────── │
│  Note Type   flashcard                       │
│  Command     flashcard.create                │
│  Surface     selection → "Make flashcard"    │
│ ── Advanced ───────────────────────────────  │
│  per-contribution toggles (the P2 rows) +    │
│  viewer-conflict picker when this plugin     │
│  registers a viewer                          │
└──────────────────────────────────────────────┘
```

Kit detail adds a member list (each row links to that plugin's detail page) and installs/uninstalls as a set:

```
│ ── Plugins in this kit ───────────────────── │
│  ▤ Flashcard      installed ✓   →            │
│  ? Quiz           installed ✓   →            │
│  ✎ Explanation    installed ✓   →            │
│                                              │
│ [Install kit]  installs all members          │
│ [Remove kit]   removes members not held      │
│                elsewhere (§8.5.2)            │
```

**8.4.3 Live effect preview.** Each `previewFixtures` entry renders **through the plugin's own registered renderer** — the market builds a `FocusOverlayBlock`-shaped `{ contentType, content: sampleContent }` and hands it to the SAME machinery every surface already uses: the shared PreviewCard/`ArtifactCard` (`src/client/workspace/ArtifactCard.tsx`), whose `cardBody` runs `resolveViewer(...)` and falls through to `getNoteType(contentType).render({ mode: "card" })`; double-click opens the FocusOverlay full view, exactly like a real note. This keeps the adaptive-note MANDATORY contract: **the market has no bespoke preview renderer** — a plugin that renders nowhere else renders nothing here either. Viewer plugins preview the same way (table-viewer fixture = a markdown pipe table; the resolver picks the viewer — showing exactly what installing it does).

V1-bundled corollary: renderers of not-yet-installed plugins are still registered (§8.5.1), so previews work for uninstalled items with no special sandbox. A future remote registry must ship fixture screenshots or defer preview until code is present (§8.9).

### 8.5 Install / uninstall semantics

**8.5.1 Plugin.** *Installed* = authoring affordances active + viewers eligible:

- surface items appear (`kitSurfaceItems` in `src/kits/clientContext.tsx`);
- commands invocable (CommandRegistry / palette / toolbars);
- the composer type picker lists its contentTypes;
- its Viewer contributions compete in `resolveViewer` (§4 chain).

*Uninstalled* = authoring hidden; **rendering untouched**:

- all the above filtered out — mechanically the SAME seam as the P2 disabled set (`setDisabledContributions` → the `kitSurfaceItems` filter): "uninstalled" behaves like every authoring contribution of the plugin disabled, plus market state. One predicate: `visible(contribution) ⇔ effectiveInstalled(plugin) ∧ contribution ∉ disabledContributions`.
- **`getNoteType(contentType)` render/edit stays registered — existing notes keep rendering at FULL fidelity.** This is the adaptive-note contract the current code already enforces for disabled contributions (`pluginManagerViews.tsx` header; `clientContext.tsx` "getNoteType() is left untouched"). Uninstall NEVER unregisters a renderer in V1. Editing an *existing* note of an uninstalled type also keeps working (the registry entry carries render+edit); only CREATE entry-points disappear.
- Viewer contributions of an uninstalled plugin DECLINE (filtered from the resolver's candidate set); display falls down the §4 chain to the NoteType renderer — full fidelity of the base type, minus the optional enhancement (a pipe table renders as markdown again, i.e. the exact pre-viewer behavior).

**8.5.2 Kit + refcount.** Kit install = add the kit id to `installedKits` → all members become effective-installed via the §8.3 union (locked: "kit install = install all member plugins"). Kit uninstall = remove the kit id; a member stays effective-installed iff another installed kit still contains it OR it is directly in `installedPlugins`. **The refcount is derived from the union — no counter persisted, nothing to drift.** The uninstall confirmation names the outcome per member:

```
Remove «Textbook Learning Kit»?
  Explanation   — removed
  Practice      — removed
  Quiz          — kept (also in «Exam Prep»)
  Flashcard     — kept (installed directly)
```

Direct install of a plugin a kit already provides = adding a direct hold (survives kit removal). Removing a kit-held plugin from its own detail page removes the direct hold only; the page says "installed via «Textbook Learning Kit»" — to fully remove it, uninstall the holding kit. No half-installed kit state in V1; hiding one member's affordances without uninstalling = the Advanced per-contribution toggles.

**8.5.3 The P2 panel relocates.** The contribution-level toggle rows and the `ViewerConflicts` picker (both in `pluginManagerViews.tsx`) become the **"Advanced" section of the plugin detail page** — same `disabledContributions` / `viewerAssociations` prefs, same semantics, one level deeper. The flat panel is retired as a top-level surface (§7 superseded).

**8.5.4 User-defined kits (M2).** `+ New kit` in the Kits tab → pick member plugins from the catalog, name + describe → saved as a `userKits[]` entry (§8.3; the slot has been declared in the prefs schema since P2, now typed) → appears in the Kits tab like any kit; install/uninstall/refcount identical (its id enters `installedKits`). Exporting the definition as shareable JSON (and importing one) is a FUTURE note — the schema is already JSON-portable; V1 builds no exchange UI.

**8.5.5 Conflict surfacing at install / uninstall time (user-confirmed 2026-07-01).** The §4 resolution chain stays the runtime arbiter, but the market makes conflicts VISIBLE at the moments users act — silent last-wins is demoted to a dev-time fallback, never market UX:

- **Install-time.** When a plugin being installed `provides` a slot (a contentType's NoteType, or a Viewer claim) that an effective-installed plugin already provides, the Install action surfaces it BEFORE committing: *"提供 Quiz 渲染 — 当前由 «X» 提供"*, with three choices: **保留两个** (both registered; the §4 chain decides per render, pinnable later in Defaults), **设为默认** (install + write the per-contentType pin via `viewerAssociations.byContentType` / `ctx.pinViewer`, so the newcomer wins deterministically), **取消**. The §4 tier-4 registration-order tiebreak (+ `console.warn`) remains only for unmediated programmatic registrations.
- **Uninstall takeover.** Uninstalling the current winner of a slot re-evaluates the §4 chain automatically — the next candidate (pin > match > priority > order) takes over at next render, and display can never break (final fallback = the NoteType renderer, per 8.5.1). Pins pointing at a now-ineligible viewer are ignored by `resolveViewer` (the stale-pin rule already implemented in `src/client/notes/viewerRegistry.ts`); the Defaults section shows such a pin as *"inactive — plugin uninstalled"* with one-click clear. The uninstall confirmation names affected slots: *"Quiz rendering → falls back to «Y» / note-type default."*
- **Where visible:** the plugin detail page (pre-install), the uninstall confirmation, and the market's **Defaults / conflicts** section (the relocated `ViewerConflicts` picker, 8.5.3).

### 8.6 Bookmark reclassification (out of core)

`bookmark` is an upper-layer functional unit (a named-marker workflow), not a content basic — it becomes a cataloged plugin. The move is **metadata-first, code migration gradual**:

- **Now (M1):** the catalog lists `bookmark` (`provides: ["bookmark"]`; contributions = the noteType + the `bookmark.add` command + its surface item) while the code stays where it is: spec in `src/core/notes/contentTypes.ts` (`BOOKMARK_CONTENT_TYPE` + `bookmarkSchema` inside `builtinNoteContentSpecs`), chip renderer/editor in `src/client/notes/builtinNoteTypes.tsx`.
- **Gradually (§8.10):** move the spec out of `builtinNoteContentSpecs` into a bookmark plugin module, keeping `BOOKMARK_CONTENT_TYPE` re-exported from its current path so its ~8 importers (`WorkspaceContext.tsx`, `NoteListPanel.tsx`, `useBookmarks.ts`, `bookmarkViews.tsx`, `commands/registry.ts`, `noteCards.ts`, …) don't churn at once; registrations gain `pluginId: "bookmark"` (today `seedCorePlugin()` in `clientContext.tsx` claims it under the synthetic `"core"` record); bookmark-keyed host surfaces (Bookmarks pane, hover index) become the plugin's contributions or gate on `effectiveInstalled("bookmark")`.
- **Semantics on day one:** uninstalling `bookmark` hides `bookmark.add` + the pane's create affordances; existing bookmark chips keep rendering (§8.5.1), the Bookmarks pane keeps listing what exists.

### 8.7 Import dependency resolution (M3)

One flow for both containers:

```
inspect ──► resolve ──► prompt ──► install ──► commit
```

1. **inspect** — obtain the pack's contentType set (+ kit/plugin hints if the pack carries them):
   - `.studypack` (legacy plaintext): the client already parses the pack and calls `POST /api/layers/import/preview` (`entityClient.importLayer` → `previewImport`; UI = the pending-preview state in `LayerLensManage.tsx` / `layerViews.tsx`). The set = distinct `note.contentType` over the pack's notes — computable client-side before commit.
   - `.svpack` (`docs/design/studypack-sharing.md` §6.1): step 1 `POST /api/svpack/inspect` parses the HEADER only; note contentTypes live in the *encrypted* payload, so the authoritative set is computed after step 2 (code entered → decrypt → `previewImport` on the plaintext), and the prompt runs **between preview and commit** (§6.1 step 3). The v2 header MAY additionally carry a `contentTypes` hint (public metadata — a small, publisher-visible leak of which note types the pack uses) so the prompt can show pre-code; the post-decrypt set stays authoritative.
2. **resolve** — map each contentType through `providerOf(contentType)` (§8.2): no provider + a registered core renderer → core primitive, nothing to do; provider effective-installed → nothing to do; provider NOT installed → collect for the prompt; no provider and no renderer → "unknown type" (listed informationally; renders via the inert fallback).
3. **prompt** — one dialog naming the uninstalled providers: *"This pack uses **Quiz**, **Flashcard** — install now?"* with one-click **Install all** (+ per-item opt-out) and an explicit Decline.
4. **install** — accepted providers are added to `catalogState.installedPlugins` (direct holds) through the normal §8.5 path — the SAME write a market install performs, nothing bespoke.
5. **commit** — the existing commit runs unchanged (`commitImport` for `.studypack`; the sealed-store commit for `.svpack`, §6.1 step 3 / §7). **Import never blocks on declining** — notes of a declined type still land.

**Declined rendering, stated honestly for V1:** with the bundled catalog, a cataloged provider's renderer is registered even while "uninstalled" (§8.5.1), so declined notes STILL render at full fidelity — in V1 the prompt's practical effect is restoring authoring affordances + honest install state. The **per-note "install X to view fully" affordance** attaches to the fallback path — cards whose `getNoteType(contentType)` is absent (the inert `InertNote` fallback, `builtinNoteTypes.tsx`): it reads "install X to view fully" when `providerOf` knows a provider, "unsupported type" when it doesn't. That affordance is what makes this flow forward-compatible: once remote-registry plugins can be genuinely absent (§8.9), the same prompt + the same per-note affordance cover them with no new UI.

Bridge to svpack: the prompt inserts as a sub-step of studypack-sharing.md §6.1 (between preview and commit), sharing its dialog with the legacy `.studypack` import; the svpack inspect dialog (publisher / pin status / validity) MAY surface the header hint early but never requires it.

### 8.8 Phasing

- **M1 — catalog model + install state + two-tab market UI (bundled).** `src/kits/catalog.ts` (CatalogEntry + bundled entries + `providerOf` index; `NoteTypePlugin.pluginId` required for cataloged registrations), plugin-prefs `catalogState` + typed `userKits` (server schema + client mirror), effective-installed derivation wired into the authoring seams (`kitSurfaceItems` / commands / composer picker / viewer eligibility), market list + detail page + Install/Uninstall + Advanced (= relocated P2 toggles). Back-compat verified: an untouched vault behaves byte-for-byte as today.
- **M2 — previews + user-defined kits.** `previewFixtures` on every cataloged entry, rendered via the shared ArtifactCard/FocusOverlay path (§8.4.3); kit detail member lists; `+ New kit` composer writing `userKits`.
- **M3 — import prompts.** contentType-set computation on both import paths, `providerOf` resolution, the prompt dialog + install-all, the per-note fallback affordance; bridges into the svpack import UI (§6.1) when that lands.
- **Future — out of scope:** §8.9.

### 8.9 Future: remote registry / sandboxing (explicitly out of scope)

- **Remote registry:** `source: "registry"` entries fetched from a catalog endpoint — signature verification, versioning/updates, download-on-install, preview via shipped screenshots until code is present. The CatalogEntry shape, the market UI, and the install-state model are designed to take this without change; only *acquisition* is new.
- **Sandboxing** third-party plugin code (out-of-process / iframe isolation, permissioned host API) is a prerequisite to executing NON-bundled code and is deliberately not designed here.
- **NO remote code download in V1** — locked.

### 8.10 Migration notes (code follows the metadata, gradually — no flag day)

- **plugin==kit 1:1 must split.** `src/kits/plugin.ts` + `clientContext.tsx` register one PluginRecord per kit; the textbook kit must decompose into per-plugin records (explanation / practice / mistake / review-pack / textbook-language) so catalog kit `members` resolve. `installClientKits` grows a per-member registration path (or the install ctx tags each contribution with its member plugin id).
- **The synthetic `"core"` record over-claims.** `seedCorePlugin()` (`clientContext.tsx`) currently files flashcard / quiz / bookmark / diagram types under `"core"`; they need their own PluginRecords + `pluginId` on their `registerNoteType` calls.
- **Table viewer re-home.** `tableViewer.tsx` registers `TABLE_VIEWER_ID = "core:table"` with `pluginId: "core"` and a contribution on `"core"` → becomes the `table-viewer` catalog plugin.
- **Bookmark-as-core** → §8.6 (spec + renderer relocation, re-exported `BOOKMARK_CONTENT_TYPE`, host surfaces gating).
- **P2 panel + its tests.** `pluginManagerViews.tsx` becomes the market; the toggle rows/conflict picker live on in Advanced; `pluginManagerViews.test.tsx` (and any e2e driving `plugin.manager` rows) update to the market navigation. View kind `plugin.manager` and `presets.ts` pane ids stay.
- **Prefs schema is additive** — `catalogState` nullable-defaults + typing the already-declared `userKits`; no migration of existing `plugin-prefs.json` files.
