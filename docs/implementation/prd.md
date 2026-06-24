# AI Study Vault 开发文档 v0.3

## 1. 项目定位

AI Study Vault 是一个 AI 原生的学习资料工作台。

它不是单纯的 HTML 编辑器，也不是传统笔记软件，而是一个可以覆盖在多种学习资料之上的 AI 学习层。

用户可以把 HTML、PDF、Markdown、Word、图片、代码、网页等资料导入系统，在阅读、学习或分析过程中选中任意片段进行追问，让 AI 解释、补充、改写、生成例子、生成图解、生成复习题，并将这些结果以 Note、Patch 或 Relation 的形式沉淀下来。

核心目标：

> 让任意学习资料都变成可追问、可批注、可修改、可关联、可复用、可导出的 AI 学习对象。

---

## 2. 产品核心理念

Obsidian 的强大之处，不是 Markdown 本身，而是它把底层抽得很干净：

```text
Vault
File
Link
Metadata
Plugin
View
```

所以它可以长出日记、任务管理、知识图谱、Canvas、数据库视图、AI 插件等能力。

AI Study Vault 也应该保持这种底层克制。

但它的核心关系不是“笔记和笔记之间的双链”，而是：

```text
资料片段
↓
用户问题
↓
AI 解释
↓
学习记录
↓
原文修改
↓
知识关系
```

因此系统底层抽象为：

```text
Source + Anchor + Note + Patch + Concept + Relation + Plugin + AI Runtime
```

其中：

* Source：资料源
* Anchor：资料中的具体位置
* Note：学习记录
* Patch：对原资料的修改
* Concept：抽象知识点
* Relation：节点之间的关系
* Plugin：格式、动作、视图、导出、AI 能力的扩展机制
* AI Runtime：统一的 AI 调用、上下文组织、结果解析和权限管理运行时

---

## 3. 核心对象模型

### 3.1 Source：资料源

Source 表示一个可学习的原始资料。

它可以是：

* HTML 学习文档
* PDF
* Markdown
* Word 文档
* 图片
* 网页
* 代码文件
* 代码仓库
* 音视频转写文本

示例：

```json
{
  "id": "src_001",
  "type": "html",
  "title": "UE Render Thread 学习笔记",
  "path": "sources/ue-render-thread.html",
  "createdAt": "2026-06-23T10:00:00Z",
  "updatedAt": "2026-06-23T10:00:00Z"
}
```

Source 不要求统一格式。
原始资料可以保持原样，由不同的 Source Adapter 负责读取、展示、选区定位和修改。

---

### 3.2 Anchor：资料位置

Anchor 表示一个 Note、Patch 或 Relation 挂载到 Source 的哪个位置。

不同格式有不同的 Anchor 策略。

HTML 示例：

```json
{
  "id": "anchor_001",
  "sourceId": "src_001",
  "type": "html_selection",
  "selector": "#render-thread-section p:nth-of-type(2)",
  "quote": "Render Thread 负责提交渲染命令",
  "contextBefore": "Game Thread 产生场景状态",
  "contextAfter": "RHI 负责底层图形 API 调用"
}
```

PDF 示例：

```json
{
  "id": "anchor_002",
  "sourceId": "src_002",
  "type": "pdf_selection",
  "page": 12,
  "rect": [120, 320, 500, 360],
  "quote": "Render dependency graph"
}
```

代码示例：

```json
{
  "id": "anchor_003",
  "sourceId": "src_003",
  "type": "code_range",
  "filePath": "Engine/Source/Runtime/Renderer/Private/Renderer.cpp",
  "startLine": 120,
  "endLine": 145,
  "symbol": "FRendererModule::BeginRenderingViewFamily"
}
```

Anchor 是整个系统的关键。

它让 AI 的解释、用户的追问、后续的修改都能准确挂回原资料。

---

### 3.3 Note：学习记录

Note 是用户或 AI 在学习过程中产生的解释、问题、总结、例子、纠错、旁注、复习题等内容。

示例：

```json
{
  "id": "note_001",
  "sourceId": "src_001",
  "anchorId": "anchor_001",
  "type": "explanation",
  "question": "为什么 UE 要把 Game Thread 和 Render Thread 分开？",
  "answer": "因为游戏逻辑和渲染提交的节奏不同。Game Thread 负责玩法逻辑和 Actor 更新，Render Thread 负责把场景变化转换成渲染命令，两者分离后可以减少主线程阻塞。",
  "createdBy": "ai",
  "createdAt": "2026-06-23T10:20:00Z"
}
```

Note 类型包括：

```text
explanation      解释
annotation       旁注
summary          总结
example          例子
correction       纠错
question         用户问题
quiz             复习题
source_analysis  源码分析
diagram          图解说明
```

---

### 3.4 Patch：修改补丁

Patch 表示 AI 对原始资料提出或已经应用的修改。

这是 AI Study Vault 和普通批注工具的关键差异。

普通批注工具只是：

```text
原文不动
旁边加注释
```

AI Study Vault 要支持：

```text
解释原文
补充原文
改写原文
重构章节
生成新学习版本
```

Patch 示例：

```json
{
  "id": "patch_001",
  "sourceId": "src_001",
  "anchorId": "anchor_001",
  "action": "replace_selection",
  "status": "pending",
  "oldText": "Render Thread 负责提交渲染命令。",
  "newContent": "<p>Render Thread 负责把 Game Thread 产生的场景变化转换成可提交给 RHI / GPU 的渲染命令。它不是在处理玩法逻辑，而是在准备这一帧应该如何被画出来。</p>",
  "createdAt": "2026-06-23T10:25:00Z"
}
```

Patch 状态：

```text
pending   待用户确认
accepted  已接受
rejected  已拒绝
applied   已应用到原资料
reverted  已撤销
```

Patch 动作类型：

```text
insert_after_selection
insert_before_selection
replace_selection
append_to_section
rewrite_section
add_annotation
add_example
add_diagram
add_quiz
restructure_document
```

所有 AI 对原文的修改都应该先生成 Patch。
用户预览后再选择接受、拒绝或继续调整。

---

### 3.5 Concept：知识点

Concept 表示一个抽象知识节点。

它不是某一条具体 Note，而是从多个 Source、Anchor、Note 中抽取出来的学习概念。

示例：

```json
{
  "id": "concept_render_thread",
  "name": "Render Thread",
  "aliases": ["渲染线程", "UE Render Thread"],
  "description": "UE 中负责准备和提交渲染命令的线程。",
  "tags": ["UE", "Rendering", "Threading"],
  "createdBy": "ai",
  "createdAt": "2026-06-23T10:30:00Z"
}
```

Concept 的价值：

* 把零散 Note 汇总成知识点
* 支持类似 Obsidian 的图谱
* 支持学习路径分析
* 支持前置知识推荐
* 支持跨资料关联

例如用户在多个资料里都问过 Render Thread，系统可以自动形成一个 Concept 节点。

---

### 3.6 Relation：节点关系

Relation 表示 Source、Anchor、Note、Patch、Concept 之间的关系。

这是 AI Study Vault 类似 Obsidian 关联图的基础。

示例：

```json
{
  "id": "rel_001",
  "from": {
    "id": "note_001",
    "type": "note"
  },
  "to": {
    "id": "concept_render_thread",
    "type": "concept"
  },
  "type": "explains",
  "label": "解释概念",
  "createdBy": "ai",
  "confidence": 0.9,
  "createdAt": "2026-06-23T10:30:00Z"
}
```

支持的节点类型：

```ts
type NodeType =
  | 'source'
  | 'anchor'
  | 'note'
  | 'patch'
  | 'concept'
```

支持的关系类型：

```ts
type RelationType =
  | 'related'
  | 'explains'
  | 'extends'
  | 'contradicts'
  | 'depends_on'
  | 'same_topic'
  | 'derived_from'
  | 'references'
  | 'modifies'
  | 'summarizes'
```

关系示例：

```text
Note A：Render Thread 是什么
  ↓ explains
Concept：Render Thread

Concept：Render Thread
  ↓ depends_on
Concept：Game Thread

Note B：ENQUEUE_RENDER_COMMAND 解释
  ↓ related
Concept：RHI

Patch C：改写某段解释
  ↓ modifies
Anchor：HTML 中某一段

Note D：源码调用链说明
  ↓ derived_from
Anchor：Renderer.cpp 某段代码
```

Relation 让系统不只是存学习记录，而是能构建学习过程图。

---

## 4. AI Runtime 设计

AI Runtime 是系统的 AI 调用核心。

核心系统不绑定任何具体模型、提示词或外部工具，只提供统一运行时。

具体模型、AI 学习动作、上下文收集器、外部工具和 MCP 服务，都通过插件接入。

### 4.1 AI Runtime 职责

AI Runtime 负责：

```text
接收用户动作
识别当前 Source / Anchor
收集上下文
选择模型 Provider
调用模型
解析模型结果
生成 Note / Patch / Concept / Relation
处理流式输出
管理权限
记录调用历史
统计成本
```

AI Runtime 不负责：

```text
写死具体模型
写死具体 Prompt
写死某种资料格式
写死某种 AI 动作
直接修改原文
```

所有原文修改必须生成 Patch，并经过用户确认。

---

### 4.2 AI Runtime 流程

```text
用户选中内容
↓
点击 AI Action
↓
AI Runtime 创建 Action Context
↓
Context Provider 收集上下文
↓
AI Action Plugin 生成 Prompt
↓
Model Provider Plugin 调用模型
↓
AI Action Plugin 解析输出
↓
生成 Note / Patch / Concept / Relation
↓
用户确认
↓
Source Adapter 应用 Patch 或保存 Note
```

---

## 5. AI 插件体系

AI 能力也必须插件化。

不要把 AI 接入简单理解成：

```text
每个 AI 模型一个插件
```

更准确的设计是：

```text
模型是插件
AI 动作是插件
上下文来源是插件
工具调用是插件
MCP 接入也是插件
```

因此 AI 相关插件分为四类：

```text
Model Provider Plugin
AI Action Plugin
Context Provider Plugin
Tool / MCP Plugin
```

---

### 5.1 Model Provider Plugin

Model Provider Plugin 负责接入不同模型供应商。

例如：

```text
OpenAI Provider
Claude Provider
Gemini Provider
DeepSeek Provider
豆包 Provider
通义 Provider
Ollama Provider
LM Studio Provider
OpenAI-Compatible Provider
```

接口示例：

```ts
interface ModelProviderPlugin {
  id: string
  name: string

  listModels(): Promise<ModelInfo[]>

  chat(request: AIChatRequest): Promise<AIChatResponse>

  streamChat(request: AIChatRequest): AsyncIterable<AIStreamChunk>
}
```

用户可以配置：

```text
默认解释模型：Claude
默认改写模型：GPT
默认总结模型：DeepSeek
隐私资料模型：本地 Ollama
代码分析模型：Claude / Gemini
```

第一版建议内置：

```text
OpenAI-Compatible Provider
Ollama Provider
```

---

### 5.2 AI Action Plugin

AI Action Plugin 负责提供具体学习动作。

例如：

```text
解释这段
改得更好懂
补一个例子
插入补充说明
替换原文
生成图解
生成复习题
生成源码调用链
提取概念
推荐关联
总结当前资料
生成学习路线
```

接口示例：

```ts
interface AIActionPlugin {
  id: string
  title: string
  description: string

  isAvailable(context: ActionContext): boolean

  buildPrompt(context: ActionContext): Promise<PromptPayload>

  parseResult(output: AIOutput): Promise<AIActionResult>
}
```

Action Plugin 的输出不应该只是纯文本。
它应该能产生结构化结果：

```ts
type AIActionResult =
  | { type: 'note'; note: Note }
  | { type: 'patch'; patch: Patch }
  | { type: 'concept'; concept: Concept }
  | { type: 'relation'; relation: Relation }
  | { type: 'mixed'; items: Array<Note | Patch | Concept | Relation> }
```

第一版建议内置：

```text
Explain Selection
Simplify Selection
Insert Explanation
Rewrite Selection
Extract Concept
Recommend Relation
Generate Quiz
```

---

### 5.3 Context Provider Plugin

Context Provider Plugin 负责收集 AI 需要的上下文。

AI 回答质量不只取决于模型，也取决于上下文。

同样是“解释这段”，只给选中文本，AI 可能回答很浅。
如果同时提供当前章节、相关 Note、相关 Concept、源码路径、历史追问，回答质量会更高。

Context Provider 示例：

```text
Current Selection Context
Current Source Context
Neighbor Paragraph Context
Related Notes Context
Related Concepts Context
Graph Context
Patch History Context
Code Repository Context
PDF Context
Web Search Context
Obsidian Vault Context
```

接口示例：

```ts
interface ContextProviderPlugin {
  id: string
  name: string

  isAvailable(scope: ContextScope): boolean

  collect(scope: ContextScope): Promise<ContextChunk[]>
}
```

ContextChunk 示例：

```json
{
  "id": "ctx_001",
  "type": "related_note",
  "title": "之前关于 Render Thread 的解释",
  "content": "Render Thread 负责把场景状态转换为渲染命令……",
  "source": "notes.jsonl",
  "weight": 0.82
}
```

第一版建议内置：

```text
Current Selection Context
Current Source Context
Related Notes Context
Related Concepts Context
```

---

### 5.4 Tool / MCP Plugin

Tool / MCP Plugin 负责接入外部工具或 MCP Server。

AI 不只是生成文本，还需要调用工具：

```text
读文件
查源码
搜索资料
解析 PDF
查当前 Vault
生成图
修改 HTML
应用 Patch
导出文件
查询 Git
查询代码符号
```

可以设计一个 MCP Bridge Plugin，让系统接入外部 MCP Server。

示例：

```text
Filesystem MCP
Git MCP
Browser MCP
PDF Parser MCP
Code Search MCP
Database MCP
Obsidian MCP
Web Search MCP
```

Tool 插件接口示例：

```ts
interface ToolPlugin {
  id: string
  name: string
  description: string

  listTools(): Promise<ToolDefinition[]>

  callTool(name: string, input: unknown): Promise<ToolResult>
}
```

注意：

* Tool 调用必须经过权限控制
* 修改文件类工具必须要求用户确认
* 外部联网类工具需要明确提示
* 涉及私有资料时要允许用户选择本地模型和本地工具

---

## 6. 插件架构总览

整体插件架构：

```text
AI Study Vault Core
│
├── Vault Core
│   ├── Source
│   ├── Anchor
│   ├── Note
│   ├── Patch
│   ├── Concept
│   └── Relation
│
├── AI Runtime
│   ├── Prompt Orchestrator
│   ├── Context Collector
│   ├── Model Router
│   ├── Result Parser
│   ├── Permission Manager
│   └── Cost / History Logger
│
└── Plugins
    ├── Source Adapter Plugins
    │   ├── HTML
    │   ├── PDF
    │   ├── Markdown
    │   └── Code
    │
    ├── Model Provider Plugins
    │   ├── OpenAI
    │   ├── Claude
    │   ├── DeepSeek
    │   └── Ollama
    │
    ├── AI Action Plugins
    │   ├── Explain
    │   ├── Rewrite
    │   ├── Quiz
    │   ├── Extract Concept
    │   └── Recommend Relation
    │
    ├── Context Provider Plugins
    │   ├── Current Selection
    │   ├── Related Notes
    │   ├── Concept Graph
    │   └── Code Repo
    │
    ├── Tool / MCP Plugins
    │   ├── File System
    │   ├── Git
    │   ├── Web Search
    │   └── PDF Parser
    │
    └── View / Export Plugins
        ├── Graph View
        ├── Timeline View
        ├── Export HTML
        └── Export Markdown
```

---

## 7. 权限模型

AI 插件必须有权限声明。

因为 AI 插件不仅可能读取资料，还可能调用外部模型、联网工具、修改原文、读取整个 Vault。

权限示例：

```json
{
  "id": "ai-action-explain-code",
  "name": "Explain Code",
  "permissions": [
    "read_current_selection",
    "read_source_context",
    "read_related_notes",
    "call_model"
  ]
}
```

会修改资料的插件：

```json
{
  "id": "ai-action-rewrite-html",
  "name": "Rewrite HTML Section",
  "permissions": [
    "read_current_selection",
    "read_source_context",
    "call_model",
    "write_patch",
    "modify_source"
  ]
}
```

联网或外部工具插件：

```json
{
  "id": "web-search-context",
  "name": "Web Search Context",
  "permissions": [
    "network_access",
    "send_query_to_external_service"
  ]
}
```

权限类型建议：

```text
read_current_selection
read_source_context
read_full_source
read_vault
read_related_notes
read_graph
call_model
network_access
send_content_to_external_model
write_note
write_patch
modify_source
call_tool
call_mcp
read_filesystem
write_filesystem
```

默认策略：

```text
AI 可以生成 Note
AI 可以生成 Patch
AI 不可以自动应用 Patch
AI 不可以默认读取整个 Vault
AI 不可以默认把私有资料发给外部模型
AI 不可以默认联网
```

---

## 8. Source Adapter Plugin

Source Adapter Plugin 负责支持不同资料格式。

内置插件：

```text
HTML Adapter
Markdown Adapter
PDF Adapter
Image Adapter
Word Adapter
Code Adapter
```

接口示例：

```ts
interface SourceAdapter {
  type: string

  load(source: Source): Promise<LoadedSource>

  render(container: HTMLElement, source: LoadedSource): Promise<void>

  getSelection(): Promise<SelectionAnchor | null>

  getContext(anchor: Anchor): Promise<SourceContext>

  applyPatch(patch: Patch): Promise<PatchApplyResult>

  save(source: LoadedSource): Promise<void>
}
```

第一版重点实现：

```text
HTML Adapter
Markdown Adapter
```

PDF 第一版只做旁注，不直接修改原 PDF。

---

## 9. View Plugin

View Plugin 负责不同展示方式。

第一批 View：

```text
Source Reader View
Notes Timeline View
Patch Review View
Study Summary View
Graph View
Concept View
```

后续扩展：

```text
Canvas View
Mindmap View
Flashcard View
Knowledge Graph View
Learning Path View
```

Graph View 作为插件实现，不放进核心逻辑。

---

## 10. Export Plugin

Export Plugin 负责导出不同产物。

第一批导出：

```text
导出修改后的 HTML
导出 Markdown 学习总结
导出 Notes JSON
导出 Patch 历史
导出 Concept 图谱
```

后续扩展：

```text
导出 PDF
导出 Word
导出 Anki / RemNote 卡片
导出 Obsidian Vault
导出 Graph JSON
```

---

## 11. Graph View 设计

Graph View 是 AI Study Vault 的一个重要插件。

它展示：

```text
Source
Anchor
Note
Patch
Concept
Relation
```

之间的连接。

### 11.1 图谱节点

第一版建议只展示：

```text
Source
Note
Concept
```

Anchor 和 Patch 可以作为详情信息展示，不一定作为默认节点。

第二版再支持：

```text
Anchor
Patch
```

### 11.2 图谱过滤

需要支持：

```text
只看当前 Source
只看当前 Concept
只看用户确认的关系
只看 AI 推荐的关系
只看前置知识链
只看源码相关节点
只看某一类 Note
```

### 11.3 关系来源

Relation 可以来自：

```text
用户手动创建
AI 自动建议
系统自动发现
```

建议区分：

```json
{
  "createdBy": "user"
}
```

```json
{
  "createdBy": "ai",
  "confidence": 0.82
}
```

```json
{
  "createdBy": "system",
  "confidence": 0.61
}
```

低置信度关系只作为推荐，不直接进入主图谱。

---

## 12. 本地 Vault 结构

第一版建议使用本地文件夹 + JSONL，保持简单、可读、可迁移。

```text
study-vault/
  sources/
    ue-render-thread.html
    react-fiber.md
    rendering-overview.pdf

  .study/
    manifest.json
    sources.jsonl
    anchors.jsonl
    notes.jsonl
    patches.jsonl
    concepts.jsonl
    relations.jsonl
    conversations.jsonl
    ai-calls.jsonl
    plugin-settings.json

  exports/
    ue-render-thread.study.html
    ue-render-thread.summary.md
    graph.json
```

为什么用 JSONL：

* 简单
* 可读
* 容易调试
* 方便 AI 读取
* 方便后续迁移到 SQLite / IndexedDB / 服务端数据库
* 适合本地优先的 Vault 模型

---

## 13. AI 上下文组织

AI 每次回答不应该只拿用户选中文本。

需要组织以下上下文：

```text
当前资料标题
当前章节标题
选中文本
前后文
当前 Anchor
已有 Notes
相关 Concepts
相关 Relations
历史 Patches
用户选择的 Action
可用资料来源
用户偏好
当前模型能力
插件权限限制
```

示例上下文：

```json
{
  "sourceTitle": "UE Render Thread 学习笔记",
  "sectionTitle": "Game Thread 和 Render Thread",
  "selectedText": "Render Thread 负责提交渲染命令。",
  "contextBefore": "Game Thread 产生场景状态。",
  "contextAfter": "RHI 负责底层图形 API 调用。",
  "relatedConcepts": ["Render Thread", "Game Thread", "RHI"],
  "relatedNotes": ["note_001", "note_007"],
  "action": "rewrite_selection",
  "allowedOutputs": ["note", "patch", "concept", "relation"]
}
```

---

## 14. HTML Source 规范

为了让 HTML 更适合持续学习和修改，建议生成 HTML 时遵守轻量规范。

### 14.1 Section 规范

```html
<section id="render-thread" data-study-section="true">
  <h2>Render Thread</h2>
  <p>...</p>
</section>
```

### 14.2 旁注区域

```html
<div class="study-annotations"></div>
```

### 14.3 AI 插入内容

```html
<div class="ai-explanation" data-note-id="note_001">
  <h4>补充理解</h4>
  <p>...</p>
</div>
```

### 14.4 Patch 标记

```html
<p data-patch-id="patch_001">
  Render Thread 负责把 Game Thread 产生的场景变化转换成可提交给 RHI / GPU 的渲染命令。
</p>
```

### 14.5 Concept 标记

```html
<span data-concept-id="concept_render_thread">Render Thread</span>
```

这可以帮助 Graph View 建立内容和知识点的关系。

---

## 15. UI 设计

### 15.1 主界面

```text
左侧：资料库
中间：资料阅读 / 编辑区
右侧：AI 学习助手
底部：Note / Patch / Relation 历史
```

### 15.2 选区浮动菜单

用户选中内容后出现：

```text
解释
举例
改写
补充
加旁注
插入原文
替换原文
生成复习题
提取概念
关联已有笔记
```

### 15.3 右侧 AI 面板

展示：

```text
AI 回答
保存为 Note
插入原文
替换原文
生成 Patch
关联 Concept
推荐 Relation
切换模型
查看使用的上下文
```

### 15.4 AI 设置面板

用户可以配置：

```text
默认模型
不同 AI Action 使用的模型
是否允许联网
是否允许读取整个 Vault
是否允许发送内容到外部模型
是否使用本地模型处理隐私资料
Provider API Key
MCP Server 配置
```

### 15.5 Graph View

图谱视图提供：

```text
当前资料图谱
全局学习图谱
某个概念的局部图谱
前置知识图谱
源码学习图谱
```

---

## 16. 与现有产品的差异

现有产品大致分散在几个方向：

```text
NotebookLM：资料问答和学习材料生成
MarginNote / LiquidText：深度阅读和批注组织
Hypothesis / Readwise：网页和 PDF 高亮批注
Obsidian：本地知识库和插件生态
Claude Artifacts / ChatGPT Canvas：AI 生成并修改产物
DeepWiki / Sourcegraph / Cursor：代码库理解
```

AI Study Vault 的差异是：

> 把 Source、Anchor、Note、Patch、Concept、Relation、Plugin、AI Runtime 统一成一个 AI 原生学习底座。

它不只是问答，不只是批注，也不只是生成 HTML。

它强调：

```text
任意资料可学习
任意片段可追问
AI 解释可沉淀
原文可被 Patch 修改
知识点可被抽取
Note 和 Concept 可关联成图
不同格式和学习动作可插件化扩展
不同 AI 模型和工具可插件化接入
```

---

## 17. 非目标

第一版不做：

```text
完整 Word 编辑器
完整 PDF 编辑器
多人实时协作
复杂 CRDT
完整 Obsidian 替代品
完整插件市场
全格式万能导入
自动构建完美知识图谱
复杂 AI Agent 编排平台
```

第一版只验证：

```text
Source → Anchor → AI Action → Note / Patch → Concept / Relation → View
```

以及：

```text
AI Runtime → Model Provider → Context Provider → Action Plugin → Result Parser
```

---

## 18. 开发里程碑

### Milestone 1：HTML MVP

目标：完成 HTML 学习资料的选中、追问、回写闭环。

功能：

```text
导入 HTML
展示 HTML
选中文字
获取 DOM Anchor
右侧 AI 问答
保存 Note
生成 Patch
插入原文
替换原文
保存修改后 HTML
```

---

### Milestone 2：Vault 数据层

目标：让学习记录独立于 HTML 存在。

功能：

```text
manifest.json
sources.jsonl
anchors.jsonl
notes.jsonl
patches.jsonl
学习记录面板
Patch 历史
撤销 / 恢复
```

---

### Milestone 3：AI Runtime 基础层

目标：将 AI 调用从业务逻辑中抽离。

功能：

```text
AI Runtime
OpenAI-Compatible Provider
Ollama Provider
AI 调用历史
流式输出
Prompt 构造
结果解析
基础权限控制
```

---

### Milestone 4：AI Action 插件

目标：把学习动作插件化。

功能：

```text
Explain Selection
Rewrite Selection
Insert Explanation
Extract Concept
Recommend Relation
Generate Quiz
Action Plugin 接口
Action 配置面板
```

---

### Milestone 5：Context Provider 插件

目标：把上下文收集插件化。

功能：

```text
Current Selection Context
Current Source Context
Related Notes Context
Related Concepts Context
Patch History Context
```

---

### Milestone 6：Concept / Relation 数据层

目标：支持 Note 和 Concept 之间的关系。

功能：

```text
concepts.jsonl
relations.jsonl
手动链接 Note
AI 推荐相关 Concept
AI 推荐相关 Note
关系确认 / 忽略
```

---

### Milestone 7：Graph View 插件

目标：展示类似 Obsidian 的学习关系图。

功能：

```text
展示 Source / Note / Concept
展示 Relation
支持当前 Source 局部图谱
支持 Concept 局部图谱
支持关系类型过滤
支持 AI 推荐关系和用户确认关系区分
```

---

### Milestone 8：插件雏形

目标：把核心能力插件化。

功能：

```text
Source Adapter 接口
Model Provider Plugin 接口
AI Action Plugin 接口
Context Provider Plugin 接口
Tool / MCP Plugin 接口
View Plugin 接口
Export Plugin 接口
HTML Adapter 内置
Markdown Adapter 内置
Graph View 内置
```

---

### Milestone 9：PDF 旁注

目标：支持 PDF 学习，但暂不直接修改 PDF。

功能：

```text
PDF 导入
PDF 阅读
文本选区
页码 + 坐标 Anchor
AI 解释
保存 Note
旁注展示
导出 HTML 学习版
```

---

### Milestone 10：代码学习插件

目标：支持代码学习场景。

功能：

```text
导入代码文件
选中代码
获取文件路径 / 行号 / 函数名
AI 解释代码
生成调用链说明
抽取 Concept
关联已有 Note
可选：与 VSCode 插件联动
```

---

### Milestone 11：MCP Bridge

目标：支持外部工具和 MCP Server。

功能：

```text
配置 MCP Server
读取 MCP 工具列表
AI Action 可声明需要工具
Tool 调用权限确认
文件读取工具
代码搜索工具
PDF 解析工具
Git 工具
```

---

## 19. 技术建议

### 19.1 前端

建议：

```text
React / Vue 均可
HTML 阅读区使用 iframe 或 Shadow DOM 隔离样式
AI 面板作为独立组件
Patch Review 使用 diff 视图
Graph View 可使用 Cytoscape.js / React Flow / Sigma.js
PDF 支持可基于 PDF.js
```

### 19.2 本地存储

MVP：

```text
本地文件夹
JSONL
原始 sources 文件
```

Web 版：

```text
IndexedDB
OPFS
可导出 zip
```

桌面版：

```text
Electron / Tauri
本地文件系统访问
后续支持 Git / 网盘同步
```

### 19.3 AI 调用

建议：

```text
初期支持用户配置 API Key
模型通过 Model Provider Plugin 接入
Action Plugin 生成 Prompt
Context Provider 负责收集上下文
核心系统只做 AI Runtime 和权限控制
模型输出必须经过结构化解析
修改原文必须生成 Patch
关系推荐必须带 confidence
低置信度关系不自动进入主图谱
```

---

## 20. 最小可运行闭环

最小产品闭环：

```text
打开一个 HTML 学习笔记
↓
选中一段
↓
点击“解释”
↓
AI Runtime 收集上下文
↓
Model Provider 调用模型
↓
AI 给出解释
↓
点击“插入原文”
↓
系统生成 Patch
↓
用户确认
↓
HTML 被更新
↓
Note 和 Patch 被保存
↓
AI 提取 Concept
↓
AI 推荐 Relation
↓
Graph View 可看到关联
```

这个闭环跑通后，后续所有能力都只是插件扩展。

---

## 21. 一句话总结

AI Study Vault 是一个 AI 原生学习资料工作台。

它的核心不是 HTML、PDF、Markdown，也不是普通笔记，而是：

```text
Source + Anchor + Note + Patch + Concept + Relation + Plugin + AI Runtime
```

HTML 编辑器只是第一个 Source Adapter。

AI 模型接入也只是 Model Provider Plugin。

真正的产品价值在于：

> 让任何学习资料都可以被 AI 理解、追问、注释、修改、关联和持续演化，同时像 Obsidian 一样保持底层干净、插件可扩展、模型可替换、数据可掌控。
