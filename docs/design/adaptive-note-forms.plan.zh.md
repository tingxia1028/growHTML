# 自适应 Note 形式 — 中文实施计划

> 配套研究文档:`docs/design/adaptive-note-forms.md`(英文,含逐行代码引用)。
> 本文件是**落地执行计划**(中文),按阶段拆分,每阶段可独立发布、独立验收。

## 0. 目标与原则

- **一句话目标**:让 note 按内容**自动识别并以对应形式渲染**(视频 / 思维导图 / 互动游戏 …),AI 聊天里生成的富内容能**丝滑内嵌成 note**,用户**不用手选一堆类型**。
- **核心判断(来自研究)**:绝大部分机制已存在,**不另造系统**。
  - `Note.contentType` 本身就是渲染判别符;渲染器注册表(`NoteContentSpec` + `NoteTypePlugin`)、生成→预览→保存回路、沙箱 iframe、`markmap`/`mermaid` 库都已就绪。
  - 真正新增的只有**一个纯函数 `classifyContent`**(内容自动识别)+ 2 个新内容类型(`video-embed`、`html-interactive`)+ 游戏沙箱的安全加固。
- **遵守仓库铁律**:加类型 = 注册 1 个 core spec + 1 个 client plugin,App/Workspace 不改;新类型尽量做成 **register-only 的 "rich-notes kit"**,零 core 改动。唯一动 core 缝的是"聊天保存路径接入分类"。
- **目标平台**:今后只做**桌面客户端(Electron)+ 手机/pad app(系统 WebView 壳)**,**无浏览器 web 发布**。两端渲染器都是 web 技术(Chromium / WKWebView / Android WebView)。故凡需隔离执行(游戏/HTML)的**安全容器基线 = 标准沙箱 `<iframe>`**(三端通用);Electron `<webview>` 仅桌面有,只能作桌面端增强,不能当基线。手机/pad 用哪套壳(Capacitor / Tauri v2 / RN)另定,不影响此渲染基线。
- **流程**:每个阶段按记忆里的工作流走 —— plan → 起后台 agent 实现 → 自测(tsc + 单测 + e2e 全绿)→ 落文档;主会话只编排/磁盘核验/提交。**注意:跑 e2e 前必须确保 4177/5173/5174 没有在用的 dev 服务器**(否则 reuseExistingServer 会污染/干掉实时库)。

## 0.5 设计法则:adaptive note 是所有 note-gen 插件的必备契约

> 这是一条**强制法则**,不是可选功能:**今后任何会"产出 note"的插件,都必须建立在 adaptive note 的两个能力之上 —— (A) 类型识别、(B) 按形式展示;没有插件可以绕过它们自己渲染。** 它把仓库已有的注册表铁律对**所有 note-gen 插件强制化**,并补上"识别"那一环。与 `abstract-recurring-capabilities` 同一精神。

**两个契约能力**

- **A. 识别(produce → contentType)**:插件产物必须解析成一个**已注册的 `contentType`**,且都从**同一个出口 `resolveForm()`** 产出:
  - *声明式*:插件/模型直接声明形式(如 flashcard 生成器永远产 flashcard;或路由 prompt 输出 discriminated union)—— 天然高置信。
  - *推断式*:没声明时用 `classifyContent()` 推断(聊天/粘贴/自由文本)。
  - **不强迫已知形式的插件去跑启发式**;"必备"指的是**都从同一条 `resolveForm` 出口产出 contentType**,而非都跑分类器。
- **B. 展示(contentType → 渲染)**:一切显示只走 `getNoteType(contentType).render(...)` + 共享 `ArtifactCard`/`FocusOverlay`。**插件不得有自定义渲染路径。**

**"render 实现" vs "渲染路径"(关键区分)**

- 插件用 `registerNoteType({ contentType, render })` 注册的 `render()` 函数 = **应该有**(这是插件贡献的渲染实现)。
- "渲染路径" = note 内容最终被画到屏幕的那条路 → **只能有一条**:`getNoteType(contentType).render(...)`。"不得有自定义渲染路径" = **不许绕过注册表显示 note**;render 实现归插件,渲染入口归框架。

**❌ 禁止(自定义渲染路径)**

1. 宿主/kit 里按类型分支:`if (contentType === "game") return <MyGameView/>` —— 每来个新形式就改宿主,违反"统一 host 调用、零分支"。
2. 某 kit 在自己面板里用自己的组件渲染 note,而不调注册表 —— 出现第二套显示路径。
3. 绕过类型系统直接塞 DOM:聊天拿到 HTML 就 `dangerouslySetInnerHTML`,或保存时写死 `contentType:"markdown"`。
4. 另写一个"预览组件"重新实现渲染,而不复用 `getNoteType().render`。

**✅ 要求**

- 插件:`registerNoteType({ contentType, render, edit })` 贡献实现。
- 所有显示处统一 `getNoteType(note.contentType).render(input)`:列表(`views.tsx:592-602`)、生成预览(`GenerationPreview` 已用 `getNoteType(draft.contentType)`,正面样板)、`ArtifactCard`/`FocusOverlay` 全走同一入口。
- 加新形式 = **注册一个新 `NoteContentSpec` + `NoteTypePlugin`(可放进 kit)**,宿主一行不改。**扩展形式的唯一方式就是注册新 form,而不是写自己的渲染/保存路径。**

**为什么强制 ≠ 关闭开放模型**:法则约束的是**契约形状**(识别 + 注册表渲染),不冻结形式清单 —— 新形式无限可加,只是必须以"注册新 form"的方式加。

**落点(大半已被半强制)**:展示侧已基本强制(列表/查看只走 `getNoteType().render`;server 落库前用 `getNoteContentSpec(contentType).schema` 校验,未注册/不合形状进不了库)。**唯一缺口 = 识别侧**:今天调用方写死 `contentType`,需把所有生成路径收口到 `resolveForm`(信任声明 or 分类)。

**强制手段**:① 类型层面让插件拿不到自定义渲染入口;② 评审加一条 lens —— **标记任何绕过 `getNoteType()` 的 note 渲染、宿主按 contentType 分支、写死 contentType 的保存**;③ 文档法则(本节)。

---

## 1. 复用 vs 新增(总览)

| 关注点 | 直接复用(不改) | 最小新增 |
| --- | --- | --- |
| 渲染器注册表 | `NoteTypePlugin` / `getNoteType` / `listNoteTypes` | **不加新类型**;扩展 `video`/`html` 的 render 处理内部变体 |
| 内容 spec | `NoteContentSpec` / `getNoteContentSpec`(server 落库前校验) | 扩展 `video`/`html` 的 schema(加变体字段);收敛掉 `plain-text`/静态 `mindmap`(见 §2.5) |
| 生成→预览→保存 | `GeneratedDraft` / `GenerationPreview` / `onGenerated` / `anchor.add-note` | 无 |
| 结构化生成引擎 | `src/ai/structured.ts` `generateStructured` | 无(V1);路由 prompt(V2) |
| 聊天存为 note | `anchor.ask-ai` + "保存回复" 按钮 | 把写死的 `contentType:"markdown"` 换成 `classifyContent(...)` |
| **自动识别** | — | **新纯函数 `classifyContent`(唯一全新机制)** |
| 类型选择器 | 编辑器 `<select>` | 降级成 "已识别:X · 可改" 小标签 |
| 沙箱 | `<iframe sandbox srcDoc>` 模式 | `allow-scripts`+CSP(`html` 的 interactive 变体) |

## 2. 现状关键事实(执行时要记住)

- 已有可用类型:`markmap`(交互思维导图,markdown→SVG)、`mermaid`(图)、`video`(**仅本地 asset**)、`html-sandbox`(`sandbox=""`,**脚本被禁,跑不了游戏**)、`markdown`/`flashcard`/`quiz`/`code-snippet` 等。
- 缺口:**思维导图交互版**用 `markmap`(弃用静态 `mindmap`);**视频缺 URL 内嵌**(并入 `video` 的 embed 变体);**游戏缺能跑脚本的沙箱**(并入 `html` 的 interactive 变体);且这些**都无法从聊天到达**(模型没有"选形式"的路径)。
- 资产服务 `GET /api/assets/:id` 现在**整文件读进内存、无 range、无大小上限** → 长本地视频不能拖进度且内存爆;**Phase 2 给它加 HTTP Range**(本地长视频也要支持),远程视频则用 `video-embed` URL 内嵌。
- 服务器/`index.html` **当前没有 CSP** → 游戏的 CSP 要同时用 iframe `csp` 属性 **和** srcdoc 里的 `<meta http-equiv>` 兜底。

## 2.5 contentType 收敛清单(基础类型全在 core,一介质一类型)

**定位**:基础类型 = **core 内置**(note 的通用语言,永远在);**kit 只留给领域垂直扩展**(像 Textbook Kit;以后如化学分子式、特定游戏模板)。**不搞"系统自带 kit 层"**包基础类型——无收益的间接层。

**原则**:一种介质一个 contentType,"变体"放进 content、由该类型唯一的 render 处理(见 §3),**不为"本地/远程""静态/可交互"再开一个并列类型**。

现有 13 个 → 收敛为 **11 个 core 类型**:

| 分组 | 类型 | 说明 / 变体 |
| --- | --- | --- |
| 文本 | `markdown` | 并掉 `plain-text`(markdown 是超集) |
| 代码 | `code-snippet` | `{ language, code }` |
| 媒体 | `image` / `audio` / `video` | **`video` 统一**:`{ kind:"asset", assetId, … }`(本地,Phase 2 加 Range 支持长视频)\| `{ kind:"embed", provider, videoId, url }`(YouTube/bilibili/Vimeo 内嵌) |
| 富网页 | `html` | **统一**:`{ html, interactive:false }`(惰性,`sandbox=""`)\| `{ html, interactive:true }`(游戏,`allow-scripts`+CSP,Phase 3) |
| 图/导图 | `mermaid` / `markmap` | `markmap` = 思维导图(markdown→交互);**弃用静态 `mindmap`** |
| 学习卡 | `flashcard` / `quiz` | 不变 |
| 标记 | `bookmark` | 不变 |

净效果:**不新增类型,反而消掉 2 个重叠**(`plain-text`、静态 `mindmap`),`html`/`video` 各保持 **1 个**。

**向后兼容(不破坏已存 note)**:库里旧的 `plain-text` / `mindmap` note 要么保留**别名渲染**(`plain-text`→按 markdown 渲染;`mindmap`→静态渲染或转 markmap 大纲),要么做一次性小迁移。收敛 PR 必须带兼容处理 + 一个"旧类型仍能打开"的测试。

**落地节奏**:`plain-text`/静态 `mindmap` 收敛随 **Phase 1**;`video` 统一(asset|embed)在 **Phase 2**;`html` 统一(static|interactive)在 **Phase 3**。

---

## 3. 总体设计(两条产生路径,汇入同一渲染)

1. **AI 路径(自描述)**:模型输出带判别符的块,判别符**就是 `contentType`**,注册表直接渲染。
2. **用户/粘贴路径(自动分类)**:内容没声明形式时,纯函数 `classifyContent(raw)` 把原文映射到一个 `contentType`,手选器降级成"建议 + 可改"。

两条都走 `getNoteType(contentType).render(...)`。**`contentType` 是"路由"判别符**(决定调哪个 render);**不要再加一个与它竞争的顶层路由判别符**。但**一个类型的 `content` 可以有内部变体字段、由它自己唯一的 render 处理**(如 `video.kind:"asset"|"embed"`、`html.interactive`,正如 flashcard 有 front/back)——这不是第二个路由判别符,完全合规。**这是支撑 §2.5 收敛(一介质一类型)的关键。**

`classifyContent` 契约(纯、无依赖、永不抛错,低置信回退 `markdown`):

```ts
// 建议位置:src/client/notes/classifyContent.ts(纯函数;若 server 也要用则放 src/core/notes/)
export type ClassifiedForm = {
  contentType: string;               // 已注册的 contentType
  content: unknown;                  // 按该类型 schema 整形
  confidence: "high" | "low";        // high=自动套用;low=仅建议、可改
};
export function classifyContent(raw: string): ClassifiedForm;
```

V1 识别规则(高精度、最具体优先):远程视频 URL→`video`{kind:"embed"};`graph/flowchart/...` 或 ```` ```mermaid ````→`mermaid`;多级标题/列表大纲→`markmap`;含 `<script>` 且有 `<canvas>`/`addEventListener`/`requestAnimationFrame`→`html`{interactive:true};有标签但无脚本→`html`{interactive:false};```` ```lang ````→`code-snippet`;否则→`markdown`。

---

## 3.5 用户补充诉求(3 条)及落地方式

> 用户原话:1) AI chat 里就能看到不同类型产物的**卡片**,点击卡片可以**在屏幕中间互动**卡片里的内容;2) **note viewer 这一层就是对应的渲染**,而不是全是高亮和文字;3) HTML 现在试下来**有些不能播放**。

**诉求 1 —— 聊天里的"类型卡片 + 点击居中展开互动"。**
这是一个**跨界面的通用能力**(聊天和 note viewer 都要),按"复现行为=一个能力挂在共享契约后"的原则做成**一个**能力,不在两处各写一遍:

- 新增一个共享组件 `ArtifactCard`(紧凑预览:图标 + 标题 + 形式标签 + 缩略/首屏)和一个 `FocusOverlay`(居中浮层/灯箱,承载该 block 的**完整可交互渲染**)。
- 卡片与浮层**都通过 `getNoteType(contentType).render(...)` 渲染**(预览态 vs 完整态用一个 `mode?: "card" | "full"` 入参区分,或卡片渲染轻量首屏、浮层渲染完整),保证"卡片里看到的"和"展开后玩到的"和"存成 note 后"三处一致。
- 互动型(游戏/视频/markmap)在卡片里可给**静态/受限预览**,点击进浮层才真正运行(避免线程里同时跑多个 iframe)。

**诉求 2 —— note viewer 按形式渲染,而不是高亮+文字。**
note 列表已走 `getNoteType(contentType).render`(`views.tsx:592-602`),所以富类型注册后**列表即按形式渲染**;要补的是:

- 让 note 的**查看/聚焦态**复用上面同一个 `FocusOverlay`/`render(mode:"full")`,使富 note(思维导图、游戏、视频)在查看时是**对应的交互渲染**,而不是被压平成文字。
- 锚点/高亮仍是"源文档上的标注",与"note 自身内容的富渲染"是两件事——本诉求是后者:**note 的 content 要按其 contentType 渲染**(惰性 HTML 之外的脚本/图/导图/视频都要真正呈现)。

**诉求 3 —— HTML 有些播不了 = `sandbox=""` 禁脚本(已核实 `builtinNoteTypes.tsx:375-402`)。**
由 Phase 3 给 `html` 加 **interactive 变体**(`sandbox="allow-scripts"`+CSP)解决;`interactive:false` 仍走 `sandbox=""` 惰性渲染。**短期可选**:给现有 html note 一个"在浮层中以 `allow-scripts` 打开"的入口先解燃眉(仍不带 same-origin)。

> 落地映射:诉求 1/2 的 `ArtifactCard`+`FocusOverlay` 共享能力在 **Phase 1** 就建立骨架(先服务已能渲染的 markmap/mermaid),**Phase 3** 接入游戏的完整交互;诉求 3 即 Phase 3。

---

## 4. 分阶段执行

### Phase 1 — 在"已能渲染的形式"上做自动识别(不加新渲染器)
**最小面、纯赚。先证明分类器。**

- 新增 `classifyContent` 纯模块 + 单测,覆盖 `markmap` / `mermaid` / `code-snippet` / `markdown`。
- 接入**聊天"保存回复/保存选区"**(`src/client/workspace/views.tsx` 约 `:482-499`,现写死 `contentType:"markdown"`):先 `classifyContent` → **走 `onGenerated` 进预览回路**(先预览再存),用识别到的 contentType + 整形后的 content。
- 接入**编辑器**(`views.tsx` 约 `:548-560` 的 `<select>`):输入实时分类,显示"已识别:<形式> · 可改"标签,`<select>` 变成 override。
- **建立共享能力骨架(诉求 1/2)**:`ArtifactCard`(紧凑卡片)+ `FocusOverlay`(居中互动浮层),两者都用 `getNoteType(...).render(mode)`;先服务已能渲染的 `markmap`/`mermaid`。聊天富回复渲染成**卡片**,点击在屏幕中央展开互动;note 查看态复用同一浮层。
- **交付**:聊天问"给我画个思维导图"→ AI 回大纲 → 线程里出现 markmap **卡片**,点击居中展开可缩放交互 → 一键存成 note(查看时同样按形式渲染)。无新类型、无安全改动。
- **验收**:`classifyContent` 单测(每条规则正/反例 + 低置信回退);e2e:聊天回复含 mermaid/markmap → 保存后 note 以对应形式渲染。
- **风险**:误判。缓解——规则高精度,仅 `high` 自动套用,永远可改。

### Phase 2 — 完整视频支持(远程内嵌 `video-embed` + 本地长视频 Range)

**远程(主路径)** —— 不新建类型,**扩展 `video`**
- 给 `video` 的 schema 加 embed 变体 `{ kind:"embed", provider, videoId, url }`(原本地为 `{ kind:"asset", assetId, … }`);`video` 的 render 内部按 `kind` 选 `<video>` 或 provider iframe。纯函数 `parseVideoUrl`(与分类器共用)。
  - 渲染(embed):`<iframe sandbox="allow-scripts allow-same-origin allow-presentation" allow="fullscreen; picture-in-picture" src=provider-embed>`(src 指向 YouTube/bilibili/Vimeo 播放器 origin,非本站,故 `allow-same-origin` 安全)。
- 分类器高置信规则:裸 provider URL → `video`{kind:"embed"}。

**本地长视频(已定:要支持)**
- 给 `GET /api/assets/:id`(`app.ts:890-901`)加 **HTTP Range**:解析 `Range` 头 → 用**文件流**按字节区间返回 `206 Partial Content`(带 `Accept-Ranges: bytes` / `Content-Range` / 正确 `Content-Length`),不再整文件读进内存;无 `Range` 头时退回 200 全量。
- 这样本地 `video`(`<video src=asset>`)**能拖进度、边下边播、内存恒定**,长视频可用;**移除"仅短片"限制**。
- 注意:`assets.ts` 现按 SHA-256 整文件去重——大文件**导入**仍会读全量算哈希(可接受,一次性);**播放**走流式即可。

- **交付**:粘贴 / AI 给出视频链接 → 内嵌播放器;导入本地长视频 → 可拖动流畅播放。
- **验收**:`parseVideoUrl` 单测;e2e:粘贴链接 → 渲染 iframe;**Range e2e** —— 带 `Range` 头请求资产返回 `206` + 正确 `Content-Range`,`<video>` seek 生效。
- **风险**:provider URL 漂移/内嵌被禁(缓解:解析器小而全测试 + "外部打开"兜底);Range 边界(末尾区间、超界、非法 range)处理要对(缓解:覆盖这些 case 的测试)。

### Phase 3 — 互动游戏(扩展 `html` 加 interactive 变体)⚠ 安全改动

- 给 `html` 的 schema 加 `interactive:boolean`(默认 false);render 内部:`interactive:false`→`sandbox=""`(惰性,原 `html-sandbox` 行为);`interactive:true`→ **`sandbox="allow-scripts"`(绝不加 `allow-same-origin`)+ 严格 CSP**(见 §5)。
- 分类器规则:自包含 HTML(`<script>` + `<canvas>`/监听器)→ `html`{interactive:true}。
- 引导 AI 把游戏产物围栏化(如 ```` ```html-game ````)便于可靠分类。
- **接入共享卡片/浮层(诉求 1)**:游戏在聊天里先以**卡片 + 受限预览**出现,**点击进 `FocusOverlay` 居中运行**(浮层里才挂 `allow-scripts` iframe,避免线程里多个 iframe 同时跑);note 查看态同样在浮层里运行(诉求 2)。
- **交付**:聊天问"做个拖拽配对小游戏"→ AI 写出 → 线程出现卡片 → 点击在屏幕中央**隔离运行**,可一键存成 note + 下载;之后在 note viewer 查看该 note 也是可玩的渲染。
- **验收**:安全 e2e —— 断言 frame **拿不到** `window.parent`、**发不出网络请求**;游戏能交互;security review 走一遍。
- **风险(最高)**:沙箱逃逸 / 数据外泄 / 失控 CPU。缓解见 §5;残留(忙循环卡渲染)记为已知风险,V2 加"停止/卸载"控件或 `<webview>` 进程隔离。

### Phase 4(推迟,V2/V3)

- Design A "表单路由" prompt(`note.generate-block`,输出为 discriminated union,模型一次定形式),需要确定性 mock。
- 模糊文本的 AI 辅助分类。
- `.xmind` 导入 → 转成 `markmap` 大纲(分类器识别 .xmind asset → 转换,无新渲染器)。
- 游戏 `postMessage` 计分通道 + 自适应高度(需校验 `event.origin==="null"`,载荷当不可信数据)。
- (本地长视频 Range 已提到 Phase 2,不在此。)

---

## 5. 游戏沙箱安全(Phase 3 必须严格执行)

- **承重规则:`allow-scripts` 且不带 `allow-same-origin`**。两者同开,`srcdoc` frame 与父页同源 → AI 代码可全权访问宿主 DOM = 逃逸。去掉 `allow-same-origin` → frame 处于**唯一不透明 origin**:脚本能跑,但 `window.parent`、cookie、`localStorage`、对本站的 `fetch`、vault 全部不可达。
- **不开** `allow-forms` / `allow-popups` / `allow-top-navigation` / `allow-modals`。
- **CSP `default-src 'none'`** 阻断一切网络外泄与外部脚本;`script-src 'unsafe-inline'` 只放行内联游戏码;`img-src data:`。CSP 同时用 iframe `csp` 属性(Chromium/Electron)+ srcdoc 内 `<meta http-equiv>`(兜底,因本站无 server CSP)。
- **Electron**:宿主已 `contextIsolation:true` / `nodeIntegration:false`;用 `<iframe>`(非 `<webview>`),不带 same-origin → 够不到 `window.studyVault`。Web 构建同行为,**两端同一套渲染,不分叉**。
- **回传宿主**:V1 **不做**(自包含教学游戏无需 I/O)。
- **理由**:与 `html-sandbox` 拆成两个类型,因为**安全姿态不同**(`sandbox=""` vs `allow-scripts`+CSP),保持能力显式可审计——惰性 HTML 永不会"偷偷"获得脚本执行。

---

## 6. 待你拍板的决策点(含推荐)

1. **自动套用 vs 总是建议**。**已定:仅 `high` 自动套用,其余只建议**(low 保持 markdown + 可点的"渲染为 X?"提示;自动套用错了也能用"已识别:X · 可改"一键改回)。`high` = 唯一解(裸 provider URL、围栏块、明确大纲);`low` = "看着像"。
2. **类型选择器收到什么程度**。**已定:用"已识别:X · override"替代 `<select>`**——主界面默认展示识别结果,手选降级成 override 下拉(**override 仍可达所有已注册类型,含 kit 贡献的**),既收掉"手选一堆类型",又不关闭开放插件模型。
3. **游戏安全胃口**。**已定:iframe 沙箱版(三端通用)`sandbox="allow-scripts"`(无 same-origin)+ CSP,配 security review + 逃逸 e2e。** Electron `<webview>` 进程隔离仅桌面有、手机/pad 没有,**不能当基线**,最多作桌面端额外增强,推迟到真出现滥用再说。三层含义:**iframe 版** = 选轻量、三端通用的沙箱当容器;**security review** = 上线前人工/`/security-review` 验一次 sandbox/CSP 没漏(尤其没误开 same-origin);**逃逸 e2e** = 自动断言游戏拿不到 `window.parent`、发不出网络、碰不到 vault,作长期回归守卫。残留风险(失控 CPU 卡渲染)记为已知,V2 加"停止/卸载"控件。
4. **本地视频**。**已定:要支持长视频** —— Phase 2 给 `/api/assets/:id` 加 HTTP Range(流式 + 拖进度,移除"仅短片"限制);远程仍优先 `video-embed`。
5. **新能力 kit vs core**。**已定:富能力并入 core 的 `video`/`html` 变体(不做单独类型、不做 kit);基础类型全在 core,kit 只留给领域垂直扩展。** 详见 §2.5 收敛清单。
6. **法则强制力度(§0.5)**。**已定:分侧分火候 —— 展示侧硬、识别侧先软后硬。**
   - **展示侧硬契约(现在就上)**:`getNoteType().render` 为**唯一**渲染入口;关掉现存旁路(聊天写死 `markdown`、`renderNoteContent("markdown",…)`、保存写死 contentType);加 **lint/测试守卫**——宿主禁止 `contentType ===` 分支、禁止在 `getNoteType` 之外渲染 note、禁止保存写死字面量 contentType。成本低、收益高(已 90% 是这样)。
   - **识别侧先软后硬**:`resolveForm` / `classifyContent` 先 **强约定 + review lens**;等经 2-3 个真实插件验证(rule-of-three)后再硬化到类型层,避免过早锁死新抽象。
   - 全程保留唯一正规扩展路 = **注册新 form**。
7. **`resolveForm` 放哪层**。**已定:`resolveForm` 进核心生成管线**(server/`src/ai` 侧,**所有产 note 的路径都过这道闸**——声明了就信、没声明才调 `classifyContent`),**`classifyContent` 做成可下沉 `src/core` 的纯模块**(无 React/fetch,server+client 共用、好单测)。这是识别侧将来能硬化的前提。

---

## 7. 与"多厂商 AI agent"的衔接

你的真实痛点("AI 生成游戏却看不到/没法内嵌")根因是 **claude-cli 把产物写成磁盘文件、回复只有文字**。最干净的端到端方案是把本计划与 `multi-provider-ai-agent.md` 的 Phase1/2 **纵切片**组合:**HTTP provider(AI SDK)用结构化输出让模型把 HTML 当内容返回 → 本计划 Phase 3 的 `html-interactive` 沙箱渲染 + 下载**。
如暂不切 provider,过渡方案:约定固定产物目录,app 捕获 agent 写出的文件 → 导入 vault asset → 挂到 note。
