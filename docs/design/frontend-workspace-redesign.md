# AI Study Vault — 全栈重抽设计（数据结构 / 工作拆分 / 自测方法）

> 本文是 `frontend-workspace-architecture.md` 的落地版。范围已与产品确认：
>
> - **全栈重塑**：core schema + HTTP API + 存储布局 + 前端抽象一起重做。
> - **媒体 Note**：走本地存储（导入本地文件进 vault，无上传服务）。
> - **Concept / Relation**：schema 定稿 + 手动关联 UI（Inspector / list / link / extract 命令），**不做** AI 自动抽取、**不做** 图谱可视化。
> - **Note.content**：`unknown` + 每个 NoteType 自带 zod schema 校验。
> - 开发期无存量数据，schema 直接写终态、直接改写，**`schemaVersion` 保持 `1`**，不做迁移。

---

## 第一部分：新数据结构

### 0. 公共信封（保留，微调）

`recordEnvelopeSchema` 保持不变（`id / type / schemaVersion / createdAt / updatedAt / createdBy / metadata`），`schemaVersion` 常量保持 `1`（开发期无数据，直接改写）。

`metadata: Record<string, unknown>` 继续作为插件逃生舱。

新增两个实体 kind，需要同步改 `ids.ts`：

```ts
// src/core/ids.ts
export const entityKinds = [
  "source", "anchor", "note", "patch", "concept", "relation",
  "asset",            // 新增：媒体/二进制资产
] as const;

export const idPrefixByKind = {
  source: "src", anchor: "anchor", note: "note", patch: "patch",
  concept: "concept", relation: "rel",
  asset: "asset",     // 新增
};
```

> Layout **不进** core 实体（见 §6），所以不加 id kind。

### 1. Source（保留）

`src/core/schema/source.ts` 不变。`sourceType` 枚举、`metadata.originalPath / normalizedUrl / sourceUrl` 沿用。

### 2. Anchor（保留）

`src/core/schema/anchor.ts` 的 discriminated union（html/pdf/code/image/web）保留。Anchor 仍是"原文中的一个位置"，是 Focus 的主角。

### 3. Note（重设计 ★）

```ts
// src/core/schema/note.ts
export const noteSchema = recordEnvelopeSchema("note", noteIdSchema).extend({
  // —— 挂载（全部可选，anchor/concept 多值）——
  sourceId: sourceIdSchema.optional(),     // 纯 concept 笔记可以没有 source
  anchorIds: z.array(anchorIdSchema).default([]),   // 取代单值 anchorId
  conceptIds: z.array(conceptIdSchema).default([]), // 取代 linkedConceptIds（更名）

  // —— 内容 ——
  contentType: z.string().min(1).default("markdown"), // 插件 key
  content: z.unknown(),                                // 结构由 NoteType 插件的 zod 校验

  visibility: visibilitySchema.default("private"),
});
```

**相对旧 schema 的变化**

| 变化 | 说明 |
|---|---|
| 删 `noteKind` enum | 三轴混淆（格式/来源/语义）；语义未来用 tag，但现在没消费者，**先不加字段**。 |
| 删 `question` 字段 | quiz 类型把题干放进 `content`，不在 core 占字段。 |
| `anchorId` → `anchorIds[]` | 一条笔记可跨多个片段（HTML + PDF 讲同一个点）。 |
| `linkedConceptIds` → `conceptIds` | 更名对齐 `anchorIds`；P1 concept 接口已在用。 |
| `content: string` → `unknown` | 结构化内容 first-class，**core 不校验 content 形状**，交给插件（见下）。 |

> **YAGNI（已落实）**：`title / tags / commandId / displayMode / assetRefs / authorId` 全部砍掉——无当前消费者。开发期无数据、字段皆 optional/default，用到任一字段时再加回来零成本、零迁移。媒体 note 的 `assetId` 直接放在 `content` 里，不需要单独 `assetRefs`。

**content 的校验在哪做**：core 的 `noteSchema.content = z.unknown()`，core store 不认识具体形状。校验发生在 **NoteContent 规格表**（server + client 共享，纯函数）：

```ts
// src/core/notes/contentTypes.ts  （纯逻辑，无 React，server 可用）
export type NoteContentSpec<T = unknown> = {
  contentType: string;
  schema: z.ZodType<T>;
  createDefault(): T;
  toSearchText(content: T): string;   // 喂给搜索/导出
};

export const noteContentSpecs = new Map<string, NoteContentSpec>();
export function registerNoteContentSpec(spec: NoteContentSpec) { /* ... */ }
export function getNoteContentSpec(contentType: string): NoteContentSpec | undefined { /* ... */ }
```

API 在写入 note 前，用 `getNoteContentSpec(contentType).schema.parse(content)` 校验；找不到 spec 时拒绝（400）。

**第一批内置 content spec**（`createDefault` + `schema` 形状示意）：

```ts
markdown      → string
plain-text    → string
mindmap       → { title: string; children: MindmapNode[] }
flashcard     → { front: string; back: string }
mermaid       → string
markmap       → string
quiz          → { question: string; options: string[]; answerIndex: number; explanation?: string }
code-snippet  → { language: string; code: string }
image         → { assetId: string; caption?: string }
audio         → { assetId: string; caption?: string; startSec?: number; endSec?: number }
video         → { assetId: string; caption?: string; startSec?: number; endSec?: number }
html-sandbox  → { html: string }   // 渲染走 sandbox iframe（复用 LocalHtmlReader 模式）
```

### 4. Asset（新增 ★，本地存储）

媒体不塞进 note，进独立资产存储。**导入本地文件 = 复制进 vault**（durable，原文件移动也不丢），无上传服务。

```ts
// src/core/schema/asset.ts
export const assetTypeSchema = z.enum(["image", "audio", "video", "file"]);

export const assetSchema = recordEnvelopeSchema("asset", assetIdSchema).extend({
  assetType: assetTypeSchema,
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  byteSize: z.number().int().nonnegative(),
  path: z.string().min(1),                 // vault 相对路径，如 assets/asset_xxx.mp4
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  originalPath: z.string().optional(),     // 导入来源（仅记录）
  durationSec: z.number().optional(),      // 音视频
});
```

- 存储目录：`vault/assets/`（新增，`vault.ts` 里 `ensureDir`）。
- 实体记录：`assets.jsonl`（新增到 `entityFileNames` + `EntityStores`）。
- 导入：`importLocalAsset(vault, absPath)` → 读盘 → 算 hash → 复制到 `assets/<id>.<ext>` → upsert AssetRecord。

### 5. Concept / Relation（schema 保留，前端启用）

`concept.ts` / `relation.ts` 不改。本轮把它们接进前端（手动 link/extract + Inspector + list），不做 AI 抽取 / graph。

### 6. WorkspaceLayout（新增，但**非 core 实体**）

布局是 UI 状态，不进 JSONL 实体存储、不做 zod 实体校验。存为单个 JSON 文件，随 vault 走：

```
vault/.study/workspace.json
```

```ts
type WorkspaceNode = {
  id: string;
  kind: string;            // "source.viewer" | "ai.chat" | "anchor.inspector" | "note.list" | ...
  params?: Record<string, unknown>;  // 如 { sourceId } / { followFocus: true }
};

type WorkspaceLayout = {
  id: string;
  name: string;
  mode: "dock" | "canvas";
  nodes: WorkspaceNode[];
  layout: unknown;          // dock/canvas 各自的布局树，前端自定义
};

type WorkspaceState = {
  activeLayoutId: string;
  layouts: WorkspaceLayout[];
};
```

API：`GET /api/workspace` / `PUT /api/workspace`（整存整取，server 只做 JSON 读写 + 基本结构校验）。

---

## 第二部分：前端架构（5 层内核 + 铁律）

```
L0 EntityClient     typed fetch 封装（现在 App.tsx 里的 api 对象升级而来）
L1 FocusContext     "用户此刻在操作什么"的唯一真相（合并 selection + anchor）
L2 CommandRegistry  动作 = (focus, entities, workspace) 的纯函数
L3 WorkspaceRuntime nodes + layout，经 ViewRegistry 渲染
   ├ ViewRegistry        kind → render(node, ctx)
   ├ NoteTypeRegistry    client 插件 = NoteContentSpec + render/edit(React)
   ├ InspectorRegistry   targetType → render(focus)
   └ AnnotationRenderer  （已存在，保留）
```

**铁律（code review 红线）：节点之间不直接通信，只通过 Focus / Command / EntityClient 协作。**

```ts
// L1 FocusContext
type AnchorDraft = {            // 由 SelectionDraft 泛化而来
  sourceId: string;
  kind: "html" | "web" | "pdf" | "code" | "image";
  quote: string;
  prefix?: string; suffix?: string;
  studyId?: string; selector?: string; page?: number; url?: string;
};

type FocusTarget =
  | { type: "source"; sourceId: string }
  | { type: "anchor"; anchorId: string }
  | { type: "anchor-draft"; draft: AnchorDraft }
  | { type: "note"; noteId: string }
  | { type: "patch"; patchId: string }
  | { type: "concept"; conceptId: string }
  | { type: "relation"; relationId: string };

type FocusContextValue = {
  focus: FocusTarget | null;
  setFocus(next: FocusTarget | null): void;
  materializeAnchor(): Promise<AnchorRecord | null>;  // = 现在的 ensureAnchor()
};
```

```ts
// L2 Command
type CommandContext = {
  focus: FocusTarget | null;
  workspace: WorkspaceRuntime;
  entities: EntityClient;
};
type Command = {
  id: string; title: string; group?: string;
  isAvailable(ctx: CommandContext): boolean;
  run(ctx: CommandContext): void | Promise<void>;
};
```

---

## 第三部分：工作拆分（按 strangler 顺序，每步 app 都能跑）

> 依赖关系：P0 → P1 → P2 → {P3, P4} → P5 → P6。P3/P4 可并行。
> 每个任务给【交付】+【自测】。自测分**自动化**（vitest，`npx vitest run <file>`）与**手动**（跑应用观察；dev 端口 server 4177 / vite 5174，改 Electron 后需重新打包并重启）。

### P0 — Core schema 定稿（数据地基）

| # | 任务 | 交付 | 自测 |
|---|---|---|---|
| P0.1 | 信封 + ids | `schemaVersion` 保持 1；`ids.ts` 加 `asset` kind | 自动：`ids.test.ts` 加断言 `isEntityId("asset", createEntityId("asset"))===true`；`getEntityKindFromId` 能识别 asset |
| P0.2 | Note 重设计 | 新 `note.ts`（见 §3） | 自动：`schema.test.ts` 补例——含 `anchorIds/conceptIds/tags/content:unknown` 的合法 note 通过；旧字段 `noteKind/question` 不再存在（类型层面） |
| P0.3 | Asset schema | 新 `asset.ts`（§4） | 自动：合法 asset 记录 parse 通过；`path` 不符 / `contentHash` 不符 → 抛错 |
| P0.4 | NoteContent 规格表 | `core/notes/contentTypes.ts` + 内置 spec（markdown/flashcard/mindmap/quiz/image/...） | 自动：新建 `contentTypes.test.ts`——每个 spec 的 `createDefault()` 能被自己的 `schema.parse` 通过；`toSearchText` 对样例返回非空且不含结构噪声 |
| P0.5 | Store 注册 asset | `entities.ts` 加 `assets` store + `assets.jsonl`；`vault.ts` `ensureDir(assets)` | 自动：`vault.test.ts` 断言 open 后 `assets.jsonl` 存在、`stores.assets` 可 upsert/get/list/delete |

**P0 完成判据**：`npm test` 全绿，且 `golden.ts` fixture 更新为新 note 形状。

### P1 — Storage + API 重塑（全栈）

| # | 任务 | 交付 | 自测 |
|---|---|---|---|
| P1.1 | Note API 改造 | `POST /api/notes` 接收 `anchorIds/conceptIds/contentType/content/tags/...`；写入前用 `getNoteContentSpec(contentType).schema.parse(content)` 校验，未知 type→400 | 自动：supertest——合法 markdown note→201；`contentType:"quiz"` 但 content 缺 `answerIndex`→400；未知 contentType→400 |
| P1.2 | Note 查询升级 | `GET /api/sources/:id/notes` 仍按 source 过滤；新增 `GET /api/notes?conceptId=` / `?anchorId=` | 自动：建 3 条 note（不同挂载）后各查询返回正确子集 |
| P1.3 | Asset API | `POST /api/assets/local-file {path}`（复制进 vault）；`GET /api/assets/:id`（字节）；`GET /api/assets/:id/meta` | 自动：导入一个临时小文件→201 且返回 assetId；GET bytes 长度与 byteSize 一致、hash 一致；手动：在应用里插入 image note 能显示 |
| P1.4 | Concept/Relation API | `GET/POST /api/concepts`、`GET/POST/DELETE /api/relations`、`GET /api/concepts/:id`（带反查：哪些 anchor/note 关联） | 自动：建 concept→link 一条 note(`conceptIds`)→`GET /api/concepts/:id` 返回该 note |
| P1.5 | Workspace API | `GET/PUT /api/workspace`（读写 `.study/workspace.json`） | 自动：PUT 一个 layout→GET 取回一致；坏 JSON 结构→400 |
| P1.6 | 清理 | 移除 `noteKindSchema` 引用、`createNoteRequestSchema` 的 `noteKind/question` | 自动：grep 无 `noteKind` 残留；`npm run build`（tsc）通过 |

**P1 完成判据**：所有 server 测试绿；旧前端（未改）能跑（接口向后只在 note 形状上变，下一步 P2 同步前端）。

### P2 — 前端内核（Focus + Command + EntityClient），三栏外观不变

| # | 任务 | 交付 | 自测 |
|---|---|---|---|
| P2.1 | EntityClient | 把 `App.tsx` 的 `api` 抽到 `src/client/data/entityClient.ts`，补 concept/relation/asset/workspace 方法 | 自动：`entityClient.test.ts` 用 mock fetch 断言每个方法命中正确 URL/method/body |
| P2.2 | FocusContext | `src/client/focus/FocusContext.tsx`（`FocusTarget` + `materializeAnchor`，吸收 `ensureAnchor` 逻辑） | 自动：`focus.test.tsx`（@testing-library）——setFocus(anchor-draft)→materializeAnchor() 调 createAnchor 并把 focus 切到 `{type:"anchor"}` |
| P2.3 | CommandRegistry | `src/client/commands/registry.ts` + 注册 `anchor.ask-ai / anchor.add-note / anchor.create-patch` | 自动：`commands.test.ts`——focus 为 source 时 add-note `isAvailable`=true、为 null 时 false；run 调对应 EntityClient |
| P2.4 | App 改用内核 | `App.tsx` 删掉 `selection/anchor` 两个 state，全部走 FocusContext；三个动作改走 Command。**UI 外观保持不变** | 手动：跑应用，HTML/PDF/Web 选区→Ask AI、Save Note、Create Patch 全部与改造前行为一致（回归）；自动：现有交互若有测试保持绿 |

**P2 完成判据**：人工回归三种 reader（HTML/PDF/web-live）的选区→提问/笔记/补丁全链路与旧版一致。

### P3 — 节点化 + ViewRegistry（App → WorkspaceShell）

| # | 任务 | 交付 | 自测 |
|---|---|---|---|
| P3.1 | ViewRegistry | `src/client/workspace/viewRegistry.ts`（`kind → render(node, ctx)`），把 `viewers.ts` 的 source 渲染分发收进来（消灭 App 854–877 的 if/else） | 自动：`viewRegistry.test.ts`——注册一个假 view，`getView(kind).render` 被调；source 类型→正确 viewer kind（迁移自现有 `viewers.test.ts`） |
| P3.2 | 内置节点 | `source.viewer / ai.chat / anchor.inspector / note.list / patch.review / terminal` 各包成 node 组件，仅通过 Focus/Command/EntityClient 取数 | 自动：每个 node 组件单测——给定 focus，渲染出预期内容、点击按钮派发预期 command（mock） |
| P3.3 | WorkspaceShell | `<WorkspaceShell layout />`，三栏作为内置 preset `threePane`（写死布局，节点经 registry 渲染） | 手动：应用外观与 P2 一致；自动：shell 按 preset 渲染出 3 个 node 容器 |
| P3.4 | App 收尾 | `App.tsx` 变成 `<FocusProvider><WorkspaceShell layout={threePane}/></FocusProvider>` | 手动：全功能回归 |

**P3 完成判据**：`App.tsx` 不再有 `sourceType===` / `kind===` 分支；新增一个 view 只需注册。

> **落地（P3.1–P3.4 已完成）**：见 `workspace-runtime.md`。`App.tsx` = `<FocusProvider><WorkspaceProvider><WorkspaceShell layout={threePane}/></WorkspaceProvider></FocusProvider>`，无面板 JSX、无 per-surface reader 分支（reader 分发收进 `readerForSource`，节点状态收进 `WorkspaceContext`）。三个内置 view：`library` / `source.viewer` / `study`（`study` 本轮保持单 view，未拆分——拆分会动到 e2e 依赖的 `.study-panel > .chat-box`/`.terminal-box` 结构）。闸门：tsc 干净 · vitest 208（+8 新增）· web e2e 9 · electron e2e 7，全绿且**未改任何 e2e selector**。

### P4 — NoteType 插件（content: unknown）+ 媒体/Asset 笔记（与 P3 可并行）

| # | 任务 | 交付 | 自测 |
|---|---|---|---|
| P4.1 | NoteTypeRegistry(client) | `src/client/notes/noteTypeRegistry.tsx`：插件 = 引用 core `NoteContentSpec` + `render(React)` + `edit(React)` | 自动：`noteTypeRegistry.test.tsx`——markdown 插件 render 出 HTML、edit 触发 onChange |
| P4.2 | 迁移现有 renderer | 把 `adapters/notes/render.ts`（markdown/mindmap/flashcard）+ diagrams（mermaid/markmap）重构为插件，content 从字符串改为结构对象 | 自动：`render.test.ts` 改为对结构化 content 断言；坏 content→插件回退 inert 文本（不抛） |
| P4.3 | Note 编辑器 | composer 的"Note"模式按 `contentType` 切换到对应 `edit()`（markdown editor / quiz 表单 / flashcard 表单） | 手动：新建 markdown / flashcard / quiz 笔记各一条，保存后列表正确渲染 |
| P4.4 | 媒体笔记 | image/audio/video 插件：edit 用"选本地文件"→`importLocalAsset`→拿 assetId 存进 content；render 用 `<img>/<audio>/<video src=/api/assets/:id>` | 手动：插入一张本地图片 note→显示；重启应用后仍能显示（验证 asset 已复制进 vault）；自动：image spec.schema 校验 `{assetId}` |
| P4.5 | html-sandbox 笔记 | 复用 `LocalHtmlReader`/webview 的 sandbox 模式渲染 HTML note，禁外部脚本 | 手动：插入含 `<script>` 的 html note→脚本不执行、内容隔离在 iframe；自动：spec 校验 `{html}` |

**P4 完成判据**：加一种 note 类型 = 注册一个 NoteContentSpec + 一个 client 插件，零改 App。

### P5 — Concept / Relation 手动 UI

| # | 任务 | 交付 | 自测 |
|---|---|---|---|
| P5.1 | InspectorRegistry | `src/client/inspectors/registry.ts`（`targetType → render(focus)`） | 自动：注册假 inspector，focus 切到 concept→对应 inspector 渲染 |
| P5.2 | Concept Inspector | focus=concept 时显示：name/aliases/description、关联的 anchors/notes、relations | 手动：建 concept、link 2 条 note→inspector 列出 2 条；自动：组件给定 mock 数据渲染计数正确 |
| P5.3 | 命令 | `anchor.extract-concept`（从当前 anchor/选区新建 concept 并 link）、`anchor.link-concept`（挂到已有 concept）、`note.link-concept` | 自动：`commands.test.ts`——extract-concept run 后调 createConcept + 更新 note.conceptIds |
| P5.4 | Concept list 节点 | 新 view `concept.list`，可作为 workspace node 打开 | 手动：打开 concept.list 节点，点条目→focus 切 concept、inspector 跟随 |
| P5.5 | Relation 创建/列表 | 在 inspector 里手动建 relation（from/to/relationKind），列表展示 | 手动：建 `Concept A depends_on Concept B`→两侧 inspector 都能看到该 relation |

**P5 完成判据**：可以"选中原文→抽成 concept→另一处原文 link 到同一 concept→在 concept inspector 看到两处来源"。

### P6 — 布局持久化 + Dock（最后 / 可选）

| # | 任务 | 交付 | 自测 |
|---|---|---|---|
| P6.1 | Layout 持久化 | WorkspaceShell 读写 `/api/workspace`；切换/保存 preset | 手动：调整布局→刷新/重启后保持；自动：layout 序列化往返一致 |
| P6.2 | Dock 布局 | 引入 dock（可并排/tab/收起/关闭）；支持打开多个 source.viewer、多个 ai.chat 绑定不同 focus | 手动：左 PDF / 右 HTML / 下 AI chat 同屏；AI chat 固定到某 anchor 不随全局 focus 变 |
| P6.3 | Canvas（远期占位） | 仅留接口，不实现 | — |

---

## 第四部分：贯穿性自测策略

- **回归基线**：P2/P3 每步完成后,人工跑"三种 reader 选区 → Ask AI / Save Note / Create Patch / Apply Patch"全链路,作为不变式。
- **类型闸门**:每个 Phase 结束 `npm run build`(tsc)必须过——这是 schema 改动是否波及全栈的最快探针。
- **单测命令**:`npx vitest run`(全量)或 `npx vitest run src/core/notes/contentTypes.test.ts`(单文件)。
- **手动验证环境**:dev 跑 server(4177)+ vite(5174),`ELECTRON_DEV_URL` 指向 5174;改了 Electron 主进程/preload 需重新打包 bundle 并重启桌面应用。
- **资产持久性专项**:媒体 note 必须做"重启应用后仍可显示"测试,确认文件确实复制进了 `vault/assets/` 而非只引用了原路径。

---

## 第五部分：需要你再确认的默认决策

以下是我在没有进一步信息时**采用的默认**,如不同意请指出:

1. **媒体资产 = 复制进 vault**(`vault/assets/<id>.<ext>`),而不是只记录原始磁盘路径。优点:原文件移动/删除后 note 不失效。代价:vault 体积变大。
2. **Layout 存 `vault/.study/workspace.json`**(随 vault 走、可跨设备),而不是浏览器 localStorage。
3. **字段更名**:`linkedConceptIds → conceptIds`、删除 `noteKind` 与 `question` 字段。
4. ~~`schemaVersion` 升到 2~~ → **保持 1**,旧 fixture/golden 直接改写,不留兼容代码。（已确认）
5. **P6(dock/canvas)留到最后且可选**,前 5 个 Phase 完成即是一个完整可用的"以片段为中心的工作台"(仍是三栏 preset,但全部可插)。
