# Study Layer — 可共享 / 可导入的学习层（anchor + note）

> 设计提案（v1，待确认）。目标：让用户能把自己对一篇资料的 **anchor + note** 打包分享，
> 另一个用户拿到后能"贴"回**他自己的同一篇资料副本**上，并能区分自己的 / 导入的 / 复制来的，
> 能开关、能更新、能把别人的 note 复制成自己的。

本提案与现有架构（`FocusContext` / `CommandRegistry` / `ViewRegistry` / `NoteTypeRegistry`）衔接，
不引入 Patch 到 V1 的 UI/命令链路。

---

## 1. 核心洞察：可移植 ≠ 本地实现

导入别人的 anchor，最难的不是"传输"，而是**重定位**：A 的 source 和 B 的 source 是两份不同副本，
`sourceId` 不同，`studyId` 是 A 那次注入时生成的、在 B 的副本里**毫无意义**。

好消息：**真正可移植的定位信息，schema 里已经有了** —— anchor 信封上的
`quote` + `contextBefore` + `contextAfter`（`src/core/schema/anchor.ts:16-18`），
这就是 W3C `TextQuoteSelector`（Hypothes.is 跨用户标注用的同一套模型）。

```
跨用户可移植：  SourceFingerprint + { quote, prefix, suffix, page/url, kind }   ← 已在 schema
本地实现（导入时重建）： sourceId, studyId, selector, rect, normalizedUrl
导入时新增：    layerId, matchStatus, note.origin（溯源）
```

所以这套方案的工作量**不是新增一种 selector**，而是：
1. 一个**重定位 resolver**（把可移植的 quote+context 在我的副本里找回来，产出 `matchStatus`，再生成本地 realization）；
2. **来源身份匹配**（`SourceFingerprint` → 我本地的某个 source）；
3. **归属/分层**（imported / mine / copied 可区分、可开关）。

---

## 2. 数据模型

### 2.1 SourceFingerprint（值对象，不是实体）

存在 layer 上、也写进导出包，用于把导入包匹配到本地 source。

```ts
type SourceFingerprint = {
  contentHash?: string;   // sha256:… —— source 已经有（source.ts:21），最强信号
  fileHash?: string;      // 二进制文件（pdf/image）的哈希
  canonicalUrl?: string;  // 归一化 URL（web 类）
  url?: string;
  title?: string;
  sourceType?: SourceType;
};
```

匹配优先级：`contentHash` 完全相等 ＞ `fileHash` 相等 ＞ `canonicalUrl` 相等 ＞ `url` 相等 ＞ `title` 模糊。
匹配不到 → layer 落为"未绑定"，等用户手动指定本地 source 再重定位。

### 2.2 StudyLayer（新实体，id 前缀 `layer`）

一个 layer = 针对某个 source 身份的一束 {anchors + notes}。**分享的最小单元**。

```ts
type StudyLayer = recordEnvelope<"layer"> & {
  sourceFingerprint: SourceFingerprint;
  localSourceId?: SourceId;            // 解析后绑定到本地 source（未匹配时为空）
  title: string;
  description?: string;
  author?: { id?: string; name?: string };
  visibility: "private" | "shared" | "public";   // 复用 common.ts 已有枚举
  importMode: "owned" | "imported" | "subscribed";
  enabled: boolean;                    // 开关：关掉则该 layer 的标注不绘制
  origin?: { packId?: string; importedAt?: string; sourceLayerId?: string };
};
```

- `owned`：我自己的标注（每个 source 默认自动建一个）。
- `imported`：从 `.studypack` 文件导入的（只读基线 + 可 copy-to-mine）。
- `subscribed`：云端订阅（V3，先占位）。

### 2.3 Anchor / Note 增量（最小侵入）

```ts
// anchor 增加：
layerId: LayerId;                                  // 默认 → 该 source 的 owned layer
matchStatus?: "matched" | "fuzzy" | "unmatched";   // 仅导入产生

// note 增加：
layerId: LayerId;
origin?: { layerId?: LayerId; noteId?: NoteId; copiedFrom?: string };  // copy-to-mine 溯源
```

二者都设为带默认值/可解析，避免硬迁移。

---

## 3. 重定位（rematch）—— 方案核心

导入时对每个 anchor，用其 `quote / contextBefore / contextAfter` 在 B 本地 source 内定位，
按 `anchorKind` 分派：

| kind | 定位策略 | 典型结果 |
| --- | --- | --- |
| `html_selection` / `web_text_quote` | ① 找 `prefix+quote+suffix` 全匹配 → 精确；② 退化只找 `quote`（多处时用 context 选最近）；③ 归一化空白/大小写后模糊匹配（相似度阈值）；④ 找不到。匹配后**用 B 本地的 study-id 注入结果重建** `studyId`+`selector` | matched / fuzzy / unmatched |
| `pdf_selection` | 有文本：page+quote 文本匹配；无文本（图形区域）：page+归一化 `rect`（跨缩放稳定） | 同一 PDF 多为 matched |
| `image_region` | 归一化 `rect`；要求 `fileHash/contentHash` 相同才记 matched，否则 fuzzy | matched / fuzzy |
| `code_range` | filePath + `symbol` + `quote` 重算行号（行号会漂移，不能直接信） | matched / fuzzy |

**铁律**：永不丢 note。`unmatched` 的 anchor 仍随 layer 落库，UI 标"未能定位"，并展示原文 `quote`
供手动重锚（`anchor.rematch` 命令）。

resolver 是纯函数、可单测（喂"本地 source 文本 + 可移植 anchor → matchStatus + 本地 realization"），
这是 V1 测试重点。

---

## 4. 导出 / 导入流程 + API

传输：**V1 用本地文件 `.studypack`（JSON）**，离线、无需服务器，契合本地 vault 哲学。

```
.studypack = {
  packId, createdAt, app,
  sourceFingerprint,
  layer:  { title, description?, author?, visibility },
  anchors: [{ anchorKind, quote, contextBefore, contextAfter, page?, normalizedUrl?, rect? }],  // 只留可移植字段
  notes:   [{ contentType, content, anchorRefs, conceptRefs? }]
}
```

导出时**剥离本地实现字段**（`studyId` / `selector` / 本地 `sourceId` / 个人信息可匿名）。

| API | 作用 |
| --- | --- |
| `POST /api/layers/:id/export` | 下载 `.studypack` |
| `POST /api/layers/import/preview` | 上传包，**不落库**：跑 fingerprint 匹配 + rematch，返回匹配到的本地 source + 每个 anchor 的 matchStatus + 统计 |
| `POST /api/layers/import/commit` | 落库：建 `importMode:"imported"` 的 layer + anchors（含本地 realization + matchStatus）+ notes |
| `POST /api/anchors/:id/rematch` | 单个 unmatched/fuzzy 重跑，或手动指定本地选区后绑定 |
| `PATCH /api/layers/:id` | 改 `enabled`（开关）/ title 等 |
| `POST /api/notes/:id/copy-to-layer` | 把导入 note 复制进我的 owned layer，写 `origin` 溯源 |
| `GET /api/sources/:id/layers` | 列出某 source 的所有 layer |

**绘制改动**：现有 `GET /api/sources/:id/anchors` 需按 `enabled` 的 layer 过滤（关掉的 layer 不绘制）。

---

## 5. 命令 / 视图（保持 Obsidian-like）

动作走 `CommandRegistry`，不散落成按钮：

```
commands: layer.export | layer.import | layer.toggle | layer.copy-note-to-mine | anchor.rematch
views:    layer.switcher        // 列出该 source 的 layers + 开关 + 作者
          layer.import-preview  // 导入预览：matched / fuzzy / unmatched 三态 + 统计
          anchor.match-inspector// 处理未匹配 / 模糊
```

`FocusContext` 增加可聚焦目标 `layer`（与现有 source/anchor/note/concept 并列），
`layer.switcher` 与 `note.list` 联动按 layer 过滤。

---

## 6. 分阶段（推荐，不必先问范围）

- **V1（地基，建议先做）✅ 已落地（2026-06-25）**：schema（`SourceFingerprint` / `StudyLayer` / `layerId` / `origin` / `matchStatus`）
  + 迁移（自动 owned layer 回填）+ **rematch resolver（核心算法 + 单测；文本类做全，几何类 best-effort）**
  + export / import(preview+commit) API + 最小 import-preview。**不做**花哨 UI。
  - 落地位置：`src/core/schema/study-layer.ts`、`src/core/study-layer/{rematch,fingerprint,layers,pack}.ts`、
    `src/server/studyLayer.ts`（编排，因需 HTML adapter 故置于 server 层，core 保持无 adapter 依赖）、
    `src/server/app.ts`（routes + 新 anchor/note 盖 owned layer + anchors 按 enabled layer 过滤）、`src/server/start.ts`（boot 迁移）。
  - 未在 V1 自动化：`code_range` 导入重定位、PDF 逐页文本重定位（best-effort / 待 V2）；`copy-note-to-layer`、`anchor.rematch` 的 HTTP 入口（未匹配的 anchor 已把可移植信息存进 `note.metadata.unmatchedAnchors`，不丢）。
- **V2 ✅ 部分落地（2026-06-25）**：本地 `.studypack` UX —— `layer.switcher` 视图（列出某 source 的 layers + `enabled` 开关 + 每层 Export 下载 `.studypack`）、导入流程（选文件 → `import/preview` 三态汇总 matched/fuzzy/unmatched → 确认 → `import/commit`，新 imported layer 出现 + matched 标注绘制 + 开关隐藏/显示）。
  - 落地位置：`src/client/workspace/layerViews.tsx`（`layer.switcher` 视图，additive 第 5 个 pane）、`src/client/commands/registry.ts`（`layer.toggle` 命令 + `onLayersChanged`）、`src/client/data/entityClient.ts`（`layers/patchLayer/exportLayer/importPreview/importCommit`）、`WorkspaceContext`（`refreshLayers()`/`layersVersion`）、`presets.ts`（加 `layer.switcher` 节点）、`styles.css`（`body min-width` 1460→1740 容纳第 5 pane）。
  - **冒烟用例**：`STUDY_VAULT_ROOT=.vault-dev npx tsx scripts/smoke-study-layer.ts` —— 在 dev vault 种一个 source 并生成 `docs/samples/sample.studypack`（anchors 故意构造成 matched/fuzzy/unmatched 各一）。然后在客户端：打开该 source → 右侧 Layers pane 点 “Import Layer” 选该文件 → 预览显示 Matched 1 / Fuzzy 1 / Unmatched 1 → Import → 出现 “Alex's rendering highlights” 层且原文高亮 → 取消勾选该层高亮消失、勾选恢复。自动化覆盖见 `e2e/study-layer.spec.ts`。
  - **V2 仍 deferred**：`copy-note-to-mine`（需 `POST /notes/:id/copy-to-layer`）、`anchor.rematch` + `anchor.match-inspector` 视图（未匹配信息已在 `note.metadata.unmatchedAnchors`）、`layer` FocusTarget + note.list 按层过滤。
- **V3**：云端 / 订阅（`importMode:"subscribed"`），需 auth + hosting，另议。

> 为什么 V1 必须先落 schema：等 rich-note 数据堆起来再补 `layerId` 是痛苦的回填迁移；
> 现在记录少，一次性回填几乎零成本。

---

## 7. 数据迁移

- 启动时（或 lazy）：对每个缺 `layerId` 的 anchor/note，按 `sourceId` 找/建该 source 的 owned layer
  （`visibility:"private"`, `importMode:"owned"`, `enabled:true`），回填 `layerId`。
- schema 上 `layerId` 用可解析默认，迁移失败不阻塞启动。

---

## 8. 边界与风险

- **studyId 不可移植**：导入时必须基于 B 本地 source 重新注入/匹配，禁止直接用包里的 studyId。
- **同源多副本**：fingerprint 以 `contentHash` 优先；web 类用 `canonicalUrl` 归一。
- **源已变更**（B 的副本比 A 新/旧）：靠 fuzzy + unmatched 兜底，永不丢 note。
- **重复导入**：用 `packId` / layer `origin` 去重，提示"已导入，是否更新"。
- **隐私**：导出默认剥离个人字段，`author` 可匿名。

---

## 9. 改动清单（落地时按"子 agent → 严格测试 → 文档"执行）

- core schema：新增 `study-layer.ts`（`SourceFingerprint` + `StudyLayer`）；`ids.ts` 加 `layer` 前缀；
  `anchor.ts` / `note.ts` 加 `layerId` / `matchStatus` / `origin`；`index.ts` 导出。
- core：`rematch` resolver（纯函数 + 单测）；迁移脚本（owned layer 回填）。
- server：上述 API + anchors 查询按 enabled layer 过滤。
- client：`layer` command/view（V2）；`FocusContext` 加 `layer` 目标。
- 测试：resolver 单测（matched/fuzzy/unmatched 各路径）、export/import API 测、e2e（导入预览 + 绘制 + copy-to-mine）。
- 文档：决策记入 `docs/implementation/04-decision-log.md`，验证记入 `02-verification-log.md`。
