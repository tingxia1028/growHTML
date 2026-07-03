# Growte Design

## 这个文档是做什么用的

`design.md` 是这个工具的总设计说明。它不是宣传页，也不是每日开发计划，而是给开发者和未来的自己看的“系统地图”。

它主要回答这些问题：

- 这个工具到底要解决什么问题。
- 核心对象有哪些，它们之间是什么关系。
- 前端、数据层、AI、插件、Viewer、Note、Anchor 的边界在哪里。
- 新功能应该接到哪里，哪些地方不应该硬编码。
- 遇到设计取舍时，应该优先遵守哪些原则。

更具体的专题设计放在 `docs/design/` 下；这个文件是入口和总览。

## 产品定位

Growte 是一个本地优先的 AI 学习工作台。

它不是单纯的 PDF 阅读器，也不是传统笔记软件。它的核心目标是：让任何学习资料都可以被选中、追问、批注、生成笔记、关联知识点，并在原文位置上长期可找回。

典型资料包括：

- PDF 教材
- HTML / Markdown 文档
- 本地文件夹里的学习材料
- 图片、网页、代码、交互内容
- 未来的表格、日程、课程包等插件型内容

Growte 的核心体验是围绕“资料片段”展开，而不是围绕孤立笔记展开：

```text
Source 原始资料
  -> Anchor 原文位置
  -> Note 学习记录
  -> AI Chat 针对片段的追问
  -> Concept / Relation 知识结构
  -> Layer 可分享、可开关的学习层
```

## 核心设计原则

### 1. Source 是事实来源

Source 表示原始资料。Note、Anchor、Patch、Concept 都围绕 Source 工作。

不要把资料内容复制成另一套独立真相。Viewer 可以用不同方式展示 Source，但不能改变 Source 的核心身份。

### 2. Anchor 是所有学习记录的挂载点

Note 不应该只是一个列表项。它应该知道自己来自哪段原文。

Anchor 负责描述“这条记录挂在 Source 的哪个位置”。不同 Source 类型可以有不同定位方式：

- PDF 可以用 page + quote + rect hint。
- HTML 可以用 study id 或 TextQuote。
- 图片可以用 normalized rect。
- 网页可以用 URL + TextQuote。

但上层只应该理解统一的 Anchor 语义。

### 3. Note 类型可扩展，但外壳要统一

Note 可以是 markdown、quiz、flashcard、media、code、mindmap、textbook explanation 等类型。

每种 Note 类型可以定义自己的内容结构和渲染方式，但小卡片、大窗口、列表样式、标题栏、操作按钮应该复用统一组件。

这样可以避免每个 Note 类型“各写各的”，也方便未来接入普通插件。

### 4. Viewer 是插件边界

不同文件类型应该通过 Viewer 展示，而不是在主工作区里到处写 `if source.type === ...`。

Viewer 的职责：

- 展示某种 Source。
- 支持选择内容或区域。
- 把选择转换成 Anchor draft。
- 把已有 Anchor 画回 Source 上。
- 在需要时支持跳转到 Anchor。

主工作区只关心“当前 Source 用哪个 Viewer 渲染”。

### 5. UI 是工作台，不是落地页

Growte 打开后应该直接进入可用的学习界面。

默认布局：

- 左侧：Library、Folders、Recent Read、插件入口
- 中间：Source Viewer
- 右侧：Anchor、Notes、Layers、AI Chat 等上下文面板
- 顶部：文档模式、Notes Overlay、Anchor Focus、窗口控制

顶部不承载太多工具入口；可扩展入口优先进入侧边栏或面板。

### 6. AI 是能力，不是数据模型

AI Chat、生成笔记、生成练习、解释文本等都是能力调用。

AI 的输出必须落到已有对象里：

- 生成学习记录：Note
- 生成修改建议：Patch
- 生成知识点：Concept / Relation
- 生成导出内容：Layer / Pack

不要让 AI 直接拥有一套平行的数据结构。

### 7. 插件是普通能力组合，不是系统特权

系统插件只负责基础能力，例如：

- 文件类型 Viewer
- 基础 Note 类型
- 基础命令
- 基础 AI Provider

垂直场景，比如教材学习、日程表、课程计划、错题本，不应该做成系统特权。它们应该作为普通插件或插件组合注册到现有扩展点。

## 核心对象

### Source

Source 是学习资料本身。

重要字段：

- `id`
- `type`
- `title`
- `content` 或文件引用
- `metadata`

Source 不要求统一内容格式。不同类型由不同 Viewer 解释。

### Anchor

Anchor 是 Source 内的位置。

重要字段：

- `id`
- `sourceId`
- `anchorKind`
- `quote`
- `contextBefore`
- `contextAfter`
- `page`
- `rect`
- `url`

Anchor 应该尽量可重定位。优先使用 quote/context 这类语义位置，rect 作为图像或 PDF 区域的必要补充。

### Note

Note 是学习记录。

重要字段：

- `id`
- `contentType`
- `content`
- `anchorIds`
- `layerId`
- `metadata`

Note 的内容结构由 `contentType` 对应的 NoteType renderer 解释。

### Layer

Layer 是一组可开关、可导入导出的学习记录集合。

用途：

- 我的笔记
- 老师层
- 练习层
- 导入层
- 未来共享或订阅层

Layer 不改变 Source，只是在 Source 上叠加学习内容。

### Concept / Relation

Concept 表示抽象知识点。

Relation 表示知识点之间或知识点与资料片段之间的关系。

这部分服务于知识图谱、复习路径和结构化学习，不应该替代 Anchor/Note。

## 前端架构

### Workspace Shell

Workspace Shell 负责布局，不负责业务解释。

它通过 ViewRegistry 渲染不同面板：

```text
WorkspaceShell
  -> IconRail
  -> Library / Folders / Concepts / Layers / Operations
  -> Source Viewer
  -> Right Sidebar Tabs
  -> AI Chat
```

新增面板应该注册为 View，而不是直接写死进 Shell。

### Workspace Context

Workspace Context 是视图之间协作的共享边界。

它负责：

- 当前 Source
- 当前 anchors / notes / layers
- 当前 selection / focus
- 命令 dispatch
- AI chat 状态
- Source 导入与切换

视图之间不要互相直接调用。需要协作时走 Workspace Context 或 Focus。

### Focus

Focus 表示当前用户正在关注什么。

典型目标：

- 当前 Anchor
- 当前 Note
- 当前 Source
- 当前选择片段

例如点击 Anchor 面板中的 linked note，应该设置 note focus，让 Notes 面板展示对应小卡片，而不是在 Anchor 面板里再弹一个独立浮窗。

## Annotation 设计

Annotation layer 是所有 Viewer 共用的低层展示层。

职责：

- 给 Anchor 对应内容加高亮。
- 显示 anchor marker / note count。
- 显示 hover / pinned note card。
- 支持 jump to anchor。

规则：

- 普通 hover card 可以临时显示。
- pinned card 应该锚定到文本位置，而不是固定在窗口坐标。
- 多个 Viewer 不应该各自实现一套 note card UI。

## Note UI 设计

Note 有两种主要形态：

### 小卡片

用于：

- Notes 列表
- Source Viewer hover card
- Anchor linked notes
- 搜索结果

小卡片应该统一：

- 类型图标
- 类型 label
- 标题
- 简短正文
- 页码 / layer / 时间等 footer 信息
- hover / active / selected 状态

### 大窗口

用于：

- 展开查看
- 编辑
- 交互型 Note
- 图表、代码、媒体内容

大窗口保留统一外壳，内部 body 由 NoteType 决定。

## 插件与扩展点

Growte 的扩展点分为几类：

- Viewer：文件或 Source 的展示器
- NoteType：Note 内容类型的渲染和编辑
- Command：可触发的动作
- Operation：用户可配置的动作模板
- AI Provider：模型调用能力
- Layout：工作区布局
- Policy：导入导出、隐私、层传播策略

插件应该注册 contribution，而不是修改核心代码。

未来“日程表”这类能力应作为普通插件：

- 底层数据可以是 markdown 或结构化 frontmatter。
- 上层 Viewer 可以是日历视图。
- Note / Anchor 可以挂到日期、任务或课程上。
- 不需要做成系统插件。

## 数据与存储

Growte 当前是本地优先。

设计约束：

- 数据应可导入导出。
- Source 原始内容和学习层分离。
- Note / Anchor / Layer 应能组成 `.studypack`。
- 未来同步或云端共享不应破坏本地数据模型。

存储层不应该假设只有一种运行环境。桌面端可以使用本地文件系统，未来移动端或浏览器端可以替换 Storage Adapter。

## AI Runtime

AI Runtime 负责统一模型调用，不绑定具体模型。

能力包括：

- 普通 chat
- streaming
- structured generation
- provider fallback
- 本地 CLI provider
- 未来 OpenAI / Ollama / hosted provider

AI 调用必须有明确上下文：

- Source title/type
- 当前 quote
- anchor location
- surrounding context
- related notes

AI 输出进入系统时要落到 Note、Patch、Concept、Relation 或 Layer。

## 重要流程

### 选择片段并生成笔记

```text
用户选择 Source 片段
  -> Viewer 生成 AnchorDraft
  -> Workspace materialize Anchor
  -> Command 创建 Note
  -> Annotation layer 画回高亮与 note marker
  -> Notes 面板展示小卡片
```

### 点击 linked note

```text
用户点击 Anchor 面板的 linked note
  -> focus.setAnchor(anchor)
  -> focus.setFocus({ type: "note", noteId })
  -> Source Viewer 跳转原文
  -> Notes 面板切到对应 note 并高亮
```

### 导入学习层

```text
选择 .studypack
  -> import preview
  -> rematch anchors
  -> 显示 matched / fuzzy / unmatched
  -> confirm commit
  -> Layer 出现在 Layers 面板
  -> Source Viewer 叠加显示该层 notes
```

## 非目标

当前阶段不优先做：

- 完整多人实时协作。
- 全网公共批注网络。
- 把垂直产品能力写死进核心。
- 为每种文件类型单独做一套 Note/Anchor UI。
- AI 直接修改原文且不可审查。

## 相关文档

- `docs/implementation/prd.md`：产品需求和长期目标。
- `docs/design/workspace-runtime.md`：Workspace / ViewRegistry / Context 运行时设计。
- `docs/design/plugin-viewer-model.md`：插件、Kit、Viewer 的关系。
- `docs/design/note-types.md`：Note 类型设计。
- `docs/design/study-layer.md`：学习层和导入导出。
- `docs/design/selection-architecture.md`：选择、Anchor draft、跨 Viewer 选区。
- `docs/design/ai-orchestration.md`：AI 调用和结构化生成。
- `docs/design/layout-engine.md`：工作区布局引擎。
- `docs/design/ui-redesign-growte.md`：Growte UI 重设计方向。

## 维护规则

当系统出现新的核心概念或架构边界变化时，需要更新这个文件。

当只是某个功能的实现细节变化时，优先更新 `docs/design/` 下对应专题文档。

当只是一次具体开发任务的过程记录时，更新 `docs/implementation/`。
