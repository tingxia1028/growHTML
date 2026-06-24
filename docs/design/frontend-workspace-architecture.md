# Frontend Workspace Architecture

本文整理 AI Study Vault 前端表现层的下一阶段方案。

核心目标：

- 让前端从固定三栏页面升级为可组合的学习工作台。
- 让 Anchor 成为阅读资料时的主要交互焦点。
- 让 Viewer、AI 对话、Note、Patch、Graph、Terminal 都可以作为工作台节点自由组合。
- 让 Note 的内容形式、编辑方式、外在表现都可以插件化扩展。

## 1. 当前架构定位

当前项目的底层数据结构已经较完整，核心对象包括：

```text
Source
Anchor
Note
Patch
Concept
Relation
```

前端目前集中在 `src/client/App.tsx`，整体形态是固定三栏：

```text
左侧：Sources / 文件树 / 导入入口
中间：Source Reader
右侧：AI Chat / Notes / Patch / Terminal
```

当前已经存在几个很有价值的扩展点：

```text
SourceViewer registry
AnnotationRenderer registry
Note renderer registry
```

它们分别解决：

```text
不同 Source 如何显示
不同 Anchor 如何高亮和显示旁注
不同 Note contentType 如何渲染
```

但这些扩展点目前仍然是局部的。整体 workspace、布局、AI 面板、Note 编辑器、Patch Review、Graph View、Inspector 还没有被抽象成可组合节点。

因此当前状态可以概括为：

```text
数据模型已经比较灵活
前端外壳仍然比较固定
```

下一阶段要做的是：

```text
让前端表现层也变成可组合、可扩展、可保存布局的 workspace runtime
```

## 2. 新架构核心变化

新的前端架构不是推翻已有实现，而是在已有 viewer / annotation / note renderer 之上再抽一层。

当前架构：

```text
App
  activeSourceId
  selection
  anchor
  notes
  patches
  chatMessages

  固定三栏布局
```

目标架构：

```text
Workspace Runtime
  WorkspaceNode Registry
  Layout Store
  FocusTarget Context
  Command Registry
  Inspector Registry
  NoteType Registry

Core Entities
  Source / Anchor / Note / Patch / Concept / Relation
```

一句话区别：

```text
当前是 Source 驱动的固定应用
目标是 Anchor 驱动的可组合工作台
```

更准确地说：

```text
Source 决定资料从哪里来
Anchor 决定用户当前正在围绕哪段资料工作
WorkspaceNode 决定这些工作如何被组织和展示
```

## 3. Dashboard / Workspace

前端可以升级为 dashboard，但不建议一开始直接做完全自由画布。

推荐分阶段：

```text
阶段 1：Dock Layout
  支持左右上下分屏、tab、面板收起、布局保存

阶段 2：Floating Panels
  支持 AI、Note、Inspector、Patch Review 作为浮窗叠加在 viewer 上

阶段 3：Canvas Workspace
  支持把 viewer、note、graph、chat 当作卡片自由摆放
```

默认布局仍然可以保持当前三栏，因为它适合第一版用户：

```text
library | reader | copilot
```

但它应该只是一个 workspace preset，而不是代码架构本身。

### 3.1 WorkspaceNode

所有前端主要区域都可以抽象成节点：

```ts
type WorkspaceNode =
  | SourceViewerNode
  | AiChatNode
  | AnchorInspectorNode
  | NoteEditorNode
  | PatchReviewNode
  | ConceptGraphNode
  | TerminalNode;
```

示例：

```ts
type SourceViewerNode = {
  id: string;
  kind: "source.viewer";
  sourceId: string;
  viewerId?: string;
};

type AiChatNode = {
  id: string;
  kind: "ai.chat";
  scope: FocusScope;
};

type AnchorInspectorNode = {
  id: string;
  kind: "anchor.inspector";
  anchorId?: string;
  followFocus?: boolean;
};
```

这样同一个 workspace 可以出现多个 viewer：

```text
左边 PDF
右边 HTML
下面 AI Chat
右侧 Anchor Inspector
旁边 Concept Graph
```

### 3.2 Layout Store

布局也应该成为数据，而不是 JSX 写死：

```ts
type WorkspaceLayout = {
  id: string;
  name: string;
  mode: "dock" | "canvas";
  nodes: WorkspaceNode[];
  layout: unknown;
};
```

未来可以支持：

```text
默认学习布局
代码阅读布局
PDF 精读布局
图谱复习布局
写作/整理布局
```

## 4. Anchor Focus

Anchor 是阅读资料时最重要的交互焦点。

它表示：

```text
资料中的一个可操作位置
```

例如用户在 HTML、PDF、网页、代码中选中一段内容：

```text
Render Thread 负责提交渲染命令
```

系统会形成一个 Anchor：

```text
source: UE Render Thread.html
position: DOM selector / PDF page / text quote / code range
quote: Render Thread 负责提交渲染命令
contextBefore: 前文
contextAfter: 后文
```

之后用户的大部分学习动作都围绕这个 Anchor：

```text
Ask AI
Add Note
Create Patch
Extract Concept
Link Concept
Show Related Notes
Open Graph Around Anchor
Search Similar Anchors
Review Patch History
```

所以 Anchor 不只是存储定位信息，也不是单纯的高亮。它是当前资料片段的操作上下文。

### 4.1 不是所有交互都必须是 Anchor

Anchor 是阅读资料时的主要焦点，但不是整个应用唯一的焦点。

更完整的抽象是 `FocusTarget`：

```ts
type FocusTarget =
  | { type: "source"; sourceId: string }
  | { type: "anchor"; anchorId: string }
  | { type: "anchor-draft"; draft: AnchorDraft }
  | { type: "note"; noteId: string }
  | { type: "patch"; patchId: string }
  | { type: "concept"; conceptId: string }
  | { type: "relation"; relationId: string };
```

其中 `anchor-draft` 很重要：

```text
用户刚选中一段内容
但还没有保存成真实 Anchor
```

这可以避免每次选区都写入存储。只有当用户真正执行保存 Note、Ask AI、Create Patch 等动作时，才把 draft materialize 成正式 Anchor。

### 4.2 AnchorFocusContext

前端可以维护一个全局上下文：

```ts
type AnchorFocusContext = {
  focus: FocusTarget | null;
  setFocus(next: FocusTarget | null): void;
  materializeAnchor(): Promise<AnchorRecord | null>;
};
```

不同节点通过这个上下文协作：

```text
ViewerNode 负责产生 AnchorDraft
AIChatNode 读取当前 FocusTarget 作为上下文
NoteEditorNode 把内容挂到当前 Anchor
GraphNode 展示当前 Anchor 周围关系
InspectorNode 展示当前 Anchor 详情
```

这样 Viewer 不需要知道 AI 面板在哪里，AI 面板也不需要知道 PDF 或 HTML 如何选区。它们只通过 Anchor Focus 协作。

## 5. Concept

Concept 是抽象知识点。

它和 Anchor 的区别：

```text
Anchor 解决：这条内容在原文哪里？
Concept 解决：这条内容属于哪个知识点？
```

例子：

```text
Anchor A: HTML 文档某段提到 Render Thread
Anchor B: PDF 第 12 页提到 Render Thread
Anchor C: 源码注释提到 Render Thread
Note D: 用户问过为什么需要 Render Thread
```

这些都可以关联到：

```text
Concept: Render Thread
```

Concept 不是某一次选区，也不是某一条 note。它是多个资料片段和学习记录沉淀出来的知识节点。

### 5.1 Core Entity Roles

```text
Source
  原始资料，例如 HTML、PDF、网页、代码文件

Anchor
  Source 中的一个具体位置或片段

Note
  用户或 AI 围绕 Source / Anchor / Concept 产生的内容对象

Patch
  对 Source 的可审查修改建议或已应用修改

Concept
  抽象知识点

Relation
  Source / Anchor / Note / Patch / Concept 之间的关系
```

### 5.2 Relation Examples

```text
Anchor references Concept
Note explains Concept
Patch modifies Anchor
Concept depends_on Concept
Note derived_from Anchor
Source contains Anchor
```

Concept 的价值是让系统不只是保存批注，而是逐渐形成知识网络：

```text
某个知识点在哪些资料中出现？
用户围绕它写过哪些 note？
AI 生成过哪些解释？
有哪些 patch 修改过相关原文？
它和哪些其他 concept 有依赖或关联？
```

## 6. Note Model

Note 不应该被固定的 `noteKind` enum 绑死。

更灵活的理解是：

```text
Note 是挂在 Source / Anchor / Concept 上的一块内容对象
```

核心应该关注：

```text
内容是什么格式
用什么编辑器编辑
用什么 renderer 展示
挂在哪些对象上
```

“解释、例子、纠错、问题、测验”这些语义不应该是核心固定类型。它们更适合作为：

```text
tag
templateId
commandId
metadata
AI action result
```

### 6.1 Recommended Note Shape

```ts
type NoteRecord = {
  id: string;

  sourceId?: string;
  anchorIds?: string[];
  conceptIds?: string[];

  contentType: string;
  content: unknown;
  assetRefs?: string[];

  title?: string;
  tags?: string[];

  metadata?: {
    commandId?: string;
    templateId?: string;
    rendererId?: string;
    editorId?: string;
    displayMode?: "inline" | "popover" | "sidecard" | "canvas-node";
  };
};
```

其中：

```text
contentType
  决定内容如何存储、编辑、渲染，例如 markdown / html / audio / video / quiz。

rendererId
  决定同一份内容用什么外观展示，例如 card / compact / popover / timeline item。

editorId
  决定如何编辑，例如 markdown editor / HTML editor / audio recorder。

tags / metadata
  表达学习语义，例如 explanation、question、ai-generated、important。

commandId
  记录这条 note 是由哪个命令产生，例如 explain-selection。
```

### 6.2 Content Type 与外在表现分离

同一条 markdown note 可以显示成：

```text
右侧卡片
原文旁边浮窗
底部 timeline item
graph 节点
导出时的 markdown 段落
```

同一条 video note 可以显示成：

```text
小播放器
缩略图卡片
anchor 旁悬浮预览
canvas 节点
timeline item
```

因此 `contentType` 不应该和 UI 外观绑定。

推荐拆分：

```text
contentType: 内容结构
editorId: 编辑方式
rendererId: 展示方式
displayMode: 出现位置和形态
```

### 6.3 NoteTypePlugin

每种 Note 内容形式都可以由插件提供：

```ts
type NoteTypePlugin = {
  contentType: string;

  createDefaultContent(): unknown;

  render(input: {
    content: unknown;
    note: NoteRecord;
    context: RenderContext;
  }): React.ReactNode;

  edit(input: {
    content: unknown;
    note?: NoteRecord;
    onChange(next: unknown): void;
  }): React.ReactNode;

  toSearchText(content: unknown): string;

  export?(input: {
    content: unknown;
    format: string;
  }): string | Blob | Promise<string | Blob>;
};
```

第一批内置内容类型可以是：

```text
markdown
plain-text
html-sandbox
image
audio
video
flashcard
quiz
mindmap
mermaid
code-snippet
```

### 6.4 Asset Based Notes

视频、音频、图片不应该直接塞入 `content`。

推荐：

```text
Note.content 保存结构化引用
真实文件进入 assets 存储
```

示例：

```json
{
  "contentType": "video",
  "content": {
    "assetId": "asset_001",
    "caption": "这段视频解释 Render Thread 和 RHI 的关系",
    "startTime": 12.4,
    "endTime": 38.2
  }
}
```

这样 Note 可以引用任意媒体，同时保留搜索、导出、预览能力。

### 6.5 HTML Note Safety

HTML note 不能直接注入主 DOM。

建议策略：

```text
默认使用 sandbox iframe
只允许受控消息通信
可选 sanitizer
禁止默认执行外部脚本
资源访问走资产系统或明确权限
```

这让用户可以扩展 HTML 形式的 note，同时避免污染主应用。

## 7. Command Registry

用户操作不应该散落在组件里，而应该注册成命令。

示例命令：

```text
anchor.ask-ai
anchor.add-note
anchor.create-patch
anchor.extract-concept
anchor.link-concept
anchor.show-related
source.summarize
concept.open-graph
note.convert-type
note.change-renderer
```

命令接口：

```ts
type Command = {
  id: string;
  title: string;
  icon?: React.ComponentType;
  group?: string;

  isAvailable(context: CommandContext): boolean;
  run(context: CommandContext): void | Promise<void>;
};
```

命令上下文：

```ts
type CommandContext = {
  focus: FocusTarget | null;
  workspace: WorkspaceRuntime;
  entities: EntityAccess;
};
```

这样选区浮动菜单、右键菜单、命令面板、AI action 列表都可以共用同一套命令定义。

## 8. Inspector Registry

每种实体都应该可以有自己的详情面板：

```text
Source Inspector
Anchor Inspector
Note Inspector
Patch Inspector
Concept Inspector
Relation Inspector
```

接口示例：

```ts
type InspectorPlugin = {
  targetType: FocusTarget["type"];
  render(target: FocusTarget, context: InspectorContext): React.ReactNode;
};
```

Anchor Inspector 应该是最重要的一种：

```text
Quote
Location
Context before / after
Linked Notes
Linked Patches
Linked Concepts
Related Anchors
Available Commands
```

## 9. View Registry

当前已有 `SourceViewer registry`，下一步可以上升到 `WorkspaceView registry`。

```ts
type WorkspaceViewPlugin = {
  kind: string;
  title: string;
  createNode(input?: unknown): WorkspaceNode;
  render(node: WorkspaceNode, context: WorkspaceRenderContext): React.ReactNode;
};
```

第一批 View：

```text
source.viewer
ai.chat
anchor.inspector
note.editor
note.list
patch.review
concept.graph
timeline
terminal
search
```

这会让 app 的主界面不再写死：

```tsx
<LibraryPanel />
<ReaderPanel />
<StudyPanel />
```

而是：

```tsx
<WorkspaceShell layout={layout} nodes={nodes} />
```

## 10. Search

搜索应该面向实体，而不是只搜文本。

```ts
type SearchResult =
  | { type: "source"; sourceId: string }
  | { type: "anchor"; anchorId: string }
  | { type: "note"; noteId: string }
  | { type: "patch"; patchId: string }
  | { type: "concept"; conceptId: string }
  | { type: "relation"; relationId: string };
```

搜索 “Render Thread” 可以返回：

```text
Source: UE Render Thread.html
Anchor: 某段原文
Note: AI 解释
Patch: 改写记录
Concept: Render Thread
Relation: Render Thread depends_on Game Thread
```

点击结果不只是打开文件，而是可以设置 FocusTarget：

```text
点击 Anchor result -> 打开 source viewer 并 focus anchor
点击 Concept result -> 打开 concept inspector 或 graph
点击 Note result -> 打开 note editor 或定位到它挂载的 anchor
```

## 11. Recommended Implementation Path

### Phase 1: 保留现有三栏，抽出 Focus 与命令

目标：

```text
不大改 UI 外观
先把交互中心从 App state 抽成 AnchorFocusContext
```

任务：

```text
新增 FocusTarget / AnchorDraft 类型
新增 AnchorFocusProvider
让 HTML / PDF / Web viewer 通过统一接口 emit focus
让 AI Chat / Note 保存 / Patch 创建读取 FocusTarget
新增 CommandRegistry，先注册 Ask AI / Add Note / Create Patch
```

### Phase 2: 抽 WorkspaceNode

目标：

```text
把固定三栏里的主要区域抽成 node
```

任务：

```text
SourceViewerNode
AiChatNode
AnchorInspectorNode
NoteListNode
PatchReviewNode
TerminalNode
```

三栏布局继续存在，但由 workspace preset 描述。

### Phase 3: NoteTypePlugin

目标：

```text
让 Note 内容类型、编辑器、renderer 解耦
```

任务：

```text
重构现有 noteRenderers 为 NoteTypePlugin
添加 markdown editor
添加 html-sandbox renderer
添加 asset note 基础结构
添加 displayMode / rendererId 元数据
```

### Phase 4: Dock Layout

目标：

```text
让 viewer / ai / inspector / note / patch 可以并排、tab、关闭、恢复
```

任务：

```text
引入或实现 dock layout
保存 workspace layout
允许打开多个 source viewer
允许 AI Chat 绑定当前 focus 或固定 source/anchor
```

### Phase 5: Concept / Relation UI

目标：

```text
让 Concept 和 Relation 进入前端主流程
```

任务：

```text
Concept Inspector
Link Concept command
Extract Concept command
Relation list
Graph View node
Search result 支持 concept/relation
```

## 12. Design Principle Summary

最终前端原则：

```text
固定布局只是 preset，不是架构
Viewer 是 node，不是页面中心
AI Chat 是 node，不是固定右栏
Anchor 是阅读动作的主要焦点
Concept 是跨资料沉淀的知识点
Note 是内容对象，不应该被固定 noteKind 绑死
contentType 决定内容结构
editorId 决定编辑方式
rendererId 决定外观表现
Command 统一菜单、快捷键、AI action
Inspector 统一实体详情
Workspace 保存用户自己的学习布局
```

一句话：

```text
AI Study Vault 的前端应该从固定页面升级为实体驱动的学习工作台。
```

