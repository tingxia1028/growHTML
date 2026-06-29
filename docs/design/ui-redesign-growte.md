# UI 重构 — "Growte" 默认外观(浅 + 深)

> 依据两张设计稿:**浅色(默认)**与**深色(Dark)**,同一套布局、两套令牌。后台 agent 看不到原图,**本规范是唯一实现依据**。落在现有体系上:布局 = `src/client/workspace/presets.ts`(dock 树)+ `WorkspaceShell.tsx`;视图 = `viewRegistry.tsx` 插件;主题 = `src/client/styles.css :root` + `src/client/theme/builtins.ts`(`DEFAULT_THEME_TOKENS`/`DARK_THEME_TOKENS`)+ `[data-theme]`。

## 0. 总布局(浅深一致)

从左到右四个区 + 顶部通栏:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ TOPBAR: [⚓ Growte  «] │  [Document | Notes Overlay | Anchor Focus]  │ 🔍 🔖 ⛶ ⋯ │
├──┬───────────┬──────────────────────────────────────────┬───────────────┤
│  │ Library ▲ │  tab: 2.2 Pressure…pdf  ✕                 │ ⚓ Anchor   📌⋯ │
│IC│ ───────── │  ← →  56/256  − 100% +  ⛶ 📖 🔍 🔖 ⋯       │ [Excerpt card]│
│ON│ tree:     │  ┌───────────────────────┐  ┌──────────┐ │ ───────────── │
│RA│ Univ Phys │  │ ⚓ paragraph…          │  │KeyConcept│ │ ✦ AI Chat   ⋯ │
│IL│  Ch1…     │  │ ⚓ p=ρgh  📄❔          │┄┄│ …body…   │ │ [you bubble]  │
│  │  Ch2 ▾    │  │ ⚓ [highlighted]  ▶    │  └──────────┘ │ [AI msg]      │
│  │   2.1     │  │   figure (navy)       │  ┌──────────┐ │  👍 👎 ⧉       │
│⌂ │   2.2◀    │  │ ⚓ [amber highlight]   │┄┄│Visualizat│ │ ───────────── │
│⚓│   2.3     │  │   📄❔                 │  └──────────┘ │ [Ask anything…│
│📝│  Ch3…     │  └───────────────────────┘  ┌──────────┐ │            ➤ ]│
│🔗│           │                             │Derivation│ │               │
│⌗ │           │                             └──────────┘ │               │
│  │           │  (margin note cards 虚线连到原文锚点)     │               │
│👤│           │                                          │               │
└──┴───────────┴──────────────────────────────────────────┴───────────────┘
```

- **TOPBAR**(通栏,高 ~56):左段(在 Library 列宽内)= 锚形 logo;中段 = 三视图分段控件(pill 组,选中态高亮)**Document / Notes Overlay / Anchor Focus**(`Anchor Focus` 可带计数徽标,如 `Anchor Focus 1`);右段 = **Anchor layer 透明度滑块**(`Anchor layer 18% ▾`,即现 layer.switcher 的锚点层不透明度)+ 图标按钮 图层 / 概念·关系 / 阅读·书 / 设置齿轮。(搜索/书签/全屏在阅读器工具条里,不在顶栏。)
- **ICON RAIL**(最左竖条,宽 ~56):图标导航(锚 / 文档 / 笔记 / 链接·概念 / 代码·操作 …,见 §4)+ **底部头像**(浅色显示 `Alex ▾`)。用来收纳稿里没画的现有面板(图层、概念、书签、操作等)。
- **Library**(宽 ~280):头部 `Library` + 折叠 chevron;来源**树**(University Physics → 章 → 节,可展开;Appendices)。
- **CENTER**(flex):①文档 tab 条(文件名 + `✕`);②阅读器工具条(← → / `页/总` / `− 100% +` / 全屏 / 书页 / 搜索 / 书签 / `⋯`);③阅读体:段落左侧**锚点标记 ⚓**、**高亮**(蓝=选中、琥珀=标注)、段落下方**内联操作图标簇**(📄 文档 / ❔ 概念 / ▶ 播放 / `</>` 代码);④右侧**批注卡 gutter**(Key Concept / Visualization / Derivation 卡片,**虚线连到对应锚点**)。
- **RIGHT**(宽 ~360):自上而下三段——
  1. **Anchor**(标题 ⚓ Anchor + ⋯):`Current Anchor` 摘录卡(左强调条 + 锚定文本 + `Page 42 · 文件名` 页码行)。
  2. **Anchor Tools**(= Anchor Action Bar,见 §7):纯图标网格,围绕当前 Anchor 的动作集 + `…` More。
  3. **AI Log / AI Chat**(标题 ✦ + ⋯):消息流(You 右对齐带时间、AI Assistant 带 ✦+时间+👍👎⧉);底部 `Ask anything…` 输入 + 📎 + ➤。

## 1. 视觉基调(浅深共通)

- 圆角:卡片/面板 **10px**;输入/按钮 8px;分段/标签 **pill(999px)**;小标签 6px。
- 阴影:卡片 `0 1px 2px rgba(0,0,0,.05), 0 6px 20px rgba(0,0,0,.06)`(深色用更深 alpha)。
- 间距节奏:面板内边距 16;卡片内边距 12–14;元素间距 8/10/12。
- 字体:无衬正文(系统 UI 栈);**阅读器正文用衬线**(教材感,稿中正文是衬线);代码/公式等宽。
- 图标:沿用 **lucide-react**(currentColor),工具/簇 14–16px,标题 16px。
- 连线:批注卡 → 锚点用 **1px 虚线**(`--sv-connector`),贝塞尔或折线均可,端点对齐锚点 ⚓ 与卡片左缘。

## 2. 令牌表 —— 浅色(默认 `:root` / DEFAULT_THEME_TOKENS)

> 起始值,落地后在 app 内微调。`colorScheme: "light"`。

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--sv-bg` | `#f3f4f6` | 应用底色(冷调浅灰) |
| `--sv-surface` | `#ffffff` | 面板(库/中心/右栏) |
| `--sv-surface-card` | `#ffffff` | 卡片(批注卡/摘录/消息) |
| `--sv-surface-muted` | `#f6f7f9` | 次级底/hover |
| `--sv-active-bg` | `#eef2fb` | 选中行(库当前节、active) |
| `--sv-border` | `#e6e8ee` | 主边框 |
| `--sv-border-soft` | `#eef0f4` | 弱分隔 |
| `--sv-text` | `#1f2329` | 正文 |
| `--sv-text-heading` | `#11141a` | 标题 |
| `--sv-text-muted` | `#6b7280` | 次要文字/时间戳 |
| `--sv-text-faint` | `#9aa1ab` | 占位/极弱 |
| `--sv-icon-muted` | `#6b7280` | 默认图标 |
| `--sv-accent` | `#3b6fe0` | 主强调(active 图标/链接/聚焦环) |
| `--sv-accent-strong` | `#2b5bd0` | hover |
| `--sv-accent-weak` | `#eaf1fe` | 强调弱底(active tab/选中节) |
| `--sv-accent-border` | `#cfe0fb` | 强调描边 |
| `--sv-select-bg` | `#cfe0fb` | 文本选中高亮(蓝) |
| `--sv-highlight-bg` | `#fdeec3` | 标注高亮(琥珀) |
| `--sv-highlight-text` | `#5b4a1e` | 琥珀高亮上的文字 |
| `--sv-chat-user-bg` | `#e9f1fe` | 用户气泡 |
| `--sv-chat-assistant-bg` | `#f5f6f8` | AI 气泡/卡片 |
| `--sv-connector` | `#cdd3dc` | 批注卡虚线连线 |
| `--sv-reader-backdrop` | `#ffffff` | 阅读器底(浅色=白纸) |
| `--sv-anchor-marker` | `#9aa1ab` | 段落锚点 ⚓ 颜色 |

## 3. 令牌表 —— 深色(`[data-theme="dark"]` / DARK_THEME_TOKENS)

> `colorScheme: "dark"`。**深色阅读器正文是浅字深底**(稿中文档区也是深色),故 `--sv-reader-backdrop` 用深色。

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--sv-bg` | `#0b0d11` | 应用底色(近黑微冷) |
| `--sv-surface` | `#13161c` | 面板 |
| `--sv-surface-card` | `#181c23` | 卡片 |
| `--sv-surface-muted` | `#1b1f27` | 次级底/hover |
| `--sv-active-bg` | `#1d2740` | 选中行 |
| `--sv-border` | `#262b34` | 主边框 |
| `--sv-border-soft` | `#1e232b` | 弱分隔 |
| `--sv-text` | `#e6e9ee` | 正文 |
| `--sv-text-heading` | `#f2f4f7` | 标题 |
| `--sv-text-muted` | `#9aa1ab` | 次要/时间戳 |
| `--sv-text-faint` | `#6b727c` | 占位 |
| `--sv-icon-muted` | `#9aa1ab` | 默认图标 |
| `--sv-accent` | `#5b8cf5` | 主强调(active 图标发光) |
| `--sv-accent-strong` | `#7aa2f7` | hover |
| `--sv-accent-weak` | `#1d2740` | 强调弱底 |
| `--sv-accent-border` | `#2f4a78` | 强调描边 |
| `--sv-select-bg` | `#24344f` | 文本选中高亮(蓝) |
| `--sv-highlight-bg` | `#3a3320` | 标注高亮(暖) |
| `--sv-highlight-text` | `#e9d9a6` | 暖高亮文字 |
| `--sv-chat-user-bg` | `#1e2a44` | 用户气泡 |
| `--sv-chat-assistant-bg` | `#181c23` | AI 气泡/卡片 |
| `--sv-connector` | `#2c333d` | 虚线连线 |
| `--sv-reader-backdrop` | `#0e1116` | 阅读器底(深色) |
| `--sv-anchor-marker` | `#6b727c` | 段落锚点 ⚓ |

> 其余既有令牌(danger/warn/success/radius/space/font 等)按上述基调相应更新;DARK 仅覆盖差异项,radius/space/font 继承 :root。

## 4. 左侧图标栏(收纳现有功能)

竖排图标 → 切换/打开对应面板(沿用既有视图):

| 图标 | 含义 | 映射现有 |
| --- | --- | --- |
| ⌂/folder | Library | library |
| ⚓ | Anchors/Bookmarks | bookmark.list |
| 📝 | Notes | 笔记列表(study 内) |
| 🔗 | Concepts/Links | concept.list |
| `</>` | Operations | operation.manager |
| ▤ | Layers/Lens | layer.switcher |
| ⚙(⋯ 内) | Theme/Layout 切换 | theme-select / layout-select |
| 👤(底部) | 账号/设置 | — |

- 点击切换左侧面板内容(或浮出);稿里默认显示 Library。**主题/布局切换**从原 reader-header 下放到图标栏底部或顶栏 `⋯` 菜单(稿中 reader-header 不再放这些下拉)。

## 5. 分区组件要点

- **TopBar**(新组件 `TopBar.tsx`):三段;中段分段控件 = 三视图;`Document`=正常阅读,`Notes Overlay`=批注卡浮层模式(margin 卡显隐),`Anchor Focus`=聚焦当前锚点(右栏 Anchor 放大/居中)。右段图标按钮。
- **IconRail**(新组件 `IconRail.tsx`):见 §4;底部头像。
- **Library**:头部 `Library` + chevron;树用现有 `FileTree`/source 列表重构成"章/节"层级;当前节 `--sv-active-bg` + 左强调条。
- **Reader chrome**:文档 tab 条 + 工具条(现有 PDF 工具条样式对齐稿:页码框、`− 100% +`、各图标按钮)。段落**锚点 ⚓** 在左 margin;**高亮**用 `--sv-select-bg`/`--sv-highlight-bg`;**内联操作簇**(现有 SelectionToolbar 概念,改为 hover/常驻在段落下的小图标行)。
- **批注卡 gutter**:即现有 `annotationMode:"margin"` 卡,重绘成稿中卡片(图标+标题+⋯+正文+时间戳),并加**虚线连线**到锚点(新增连线层,在 annotationLayer/DomReader margin 渲染里画 SVG/canvas 连线)。
- **Right 面板**:拆成 **Anchor**(摘录卡:focus 当前锚点文本 + 页码 + 操作)与 **AI Chat**(现有 chat,重绘气泡/操作/输入)。dock 右栏改为上下两段(column split)。

## 6. 分期计划(每期:实现 → tsc+单测+e2e → 我磁盘核验 → 提交)

- **R0 令牌(浅默认 + 深)**:改 `styles.css :root` + `builtins.ts` 的 DEFAULT/DARK 为本规范令牌;浅色设为默认主题。**纯令牌、低风险、立刻换肤**。先做。
- **R1 Shell/顶栏/图标栏**:新 `TopBar` + `IconRail` + 改 `presets.ts` dock 树为"iconrail | library | reader | (anchor/aichat 上下)";现有面板收进图标栏/⋯;三视图分段控件接 annotationMode/focus。
- **R2 Library**:树层级 + 头部 + active 态按稿。
- **R3 Note 展示统一(§10,组件地基)+ Reader chrome**:先收敛 `ArtifactCard`/`FocusOverlay` → 一套 **PreviewCard(三态)+ CenterView**(双击打开)+ per-type 预览规则 + 尺寸;再做 tab 条、工具条、锚点标记、**note-type 图标→点开预览卡**(§10.4)、内联簇(= Selection Toolbar 表面,§7)、margin 卡 + 虚线连线。**R4/R5 消费同一套卡**。
- **R4 Right(Anchor + Anchor Tools + AI Log)**:摘录卡 + Anchor Action Bar 表面(§7)+ 聊天气泡/操作/输入重绘;Anchor 下 / Chat 里的 Note **复用 §10 PreviewCard**。
- **R5 通用件**:卡片三态/Center View 收尾 + 按钮/输入/滚动条对齐两套令牌。
- **R6 工具栏体系 + Customize(见 §7)**:抽 **Action Registry**(kit 提供动作集 + 用户自定义)→ 三表面统一渲染(Selection / Anchor / 全局底栏)+ Hover tooltip + More 菜单分组 + Disabled 态 + **Customize Toolbar**(排序/显隐/换图标/钉自定义 Operation/Reset)。复用现有 `commands/registry` + `operationViews`,对齐「AI Operation as Data」计划。
- **R7 Layer Lens + 层级(见 §8)**:顶栏 `Layers` pill → 弹层(过滤+管理合一);`studyLayerSchema` 加 `parentId`(导入/角色驱动)+ per-layer 计数 + roll-up + 父级级联;`Visible note count` 页脚。
- **R8 右侧目录 / Bookmarks 索引(hover-reveal,见 §9)**:阅读器右边缘 hover 滑出的**书签**索引(按 category 分组),复用现有 bookmark 数据 + 跳转;折叠态=目录图标,可 pin。

> 全程保持功能不变 + 契约守卫绿;每期串行(改动多在 styles.css/presets/views,易冲突)。R6 可与 R3/R4 协同:R3/R4 先用占位的内联/Anchor 工具行,R6 再把它们替换成 Action Registry 的统一渲染。

## 7. 工具栏体系(Action Toolbar System)

> 核心原则(对齐「复现行为=一个能力挂共享契约后」):**不是三套工具栏,而是同一个 Action Registry 的三种渲染**。动作集由 **kit 提供**(不同 kit 一套 tools),用户可**自定义**(排序/显隐/换图标/钉自定义 AI Operation)。三个表面只决定「默认显示哪些 + 布局密度」,动作定义与执行共用。落地复用现有 `src/client/commands/registry`、`operationViews.tsx`、以及「AI Operation as Data」计划(`docs/design/ai-operation-as-data.md`)。

### 7.1 Action 模型(共享契约)
每个 action:`{ id, label, description(一句简介,用于 tooltip), icon(lucide), group, run(ctx) }`。
- **group** 用于 More 菜单分组:`Create Note`(Note/Quiz/Flashcard/Media/Mermaid/HTML…)、`AI Actions`(Explain/Summarize/Translate/Generate Example/Extract Concept…)、`Study Actions`(Review/Practice/Mistake…)、`Custom Actions`(用户的 AI Operation,如 `My Operation 1/2`)。
- 来源:**内置 + kit 注册 + 用户自定义 Operation**,统一进 Registry。

### 7.2 三个表面(surfaces)
1. **Selection Toolbar(内联)** —— 正文选区下浮出。状态:
   - *Default*:一行常用图标(Quote / Explain / Note / Quiz / Media / Bookmark …)+ `…`。
   - *Hover*:tooltip = `名称 — 一句简介`(如 `Explain — Ask AI to explain this selection in simple terms.`)。
   - *More 菜单*:四列分组(Create Note / AI Actions / Study Actions / Custom Actions)+ 底部 `Customize Toolbar`。
2. **Anchor Action Bar(右侧 Anchor 面板)** —— 围绕**当前 Anchor**,只图标、密度更高、放更多动作(Explain/Note/Quiz/Flashcard/Review/Mistake/Media/HTML/Mermaid/Concept/Practice…)。状态:Default 图标网格 / Hover tooltip(`Quiz — Generate questions to test understanding of this anchor.`)/ More 菜单(`More (Anchor Panel)`:Flashcard·Concept·Summarize / Media·Practice·Generate Example / HTML·Translate·Extract Concept + `Customize Anchor Toolbar`)/ **Disabled 态**(动作对当前 Anchor 不适用时灰显)。
3. **全局底栏(参考条)** —— 所有可用动作的总览(Quote/Explain/Note/Quiz/Flashcard | Review/Mistake/Media/HTML/Mermaid/Concept/Practice/More)。

### 7.3 Customize Toolbar(自定义面板)
- 左导航:`Inline Toolbar` / `Anchor Toolbar` / `My Actions`(各表面独立配置)。
- 主区:`Drag to reorder. Toggle to show or hide` —— 动作列表带**拖拽手柄 + 显隐开关**(如 Explain/Note/Quiz/Flashcard/Bookmark 开,Media/HTML 收到 `Hidden`)。
- `Change Icon`:为某动作换图标(图标网格选择)。
- 底部:`Reset to default` / `Cancel` / `Save`。
- 自定义配置按**表面 + vault** 持久化(沿用 `operation-prefs.json` / workspace storage 模式)。

### 7.4 服务对象
- Selection Toolbar 作用于**当前选区**;Anchor Action Bar 作用于**右侧当前 Anchor**(生成解释/题目/复习卡/媒体/自定义 AI 输出)。
- 产物一律经 **adaptive-note**(`resolveForm` → `getNoteType().render`)渲染,不走自定义渲染路径(见 [[adaptive-note-mandatory-contract]])。

## 8. Layer Lens(数据层)+ 层级

> 现有模型(`src/core/schema/study-layer.ts` + `src/core/study-layer/layers.ts`):layer **每个 source 一套**;`role: preset|custom|shared`、`importMode: owned|imported|subscribed`、`enabled`、`color`、`order`;预设阶段 = **预习/学习/复习/拓展**(`PRESET_STAGES`)。note 用 `layerIds[]`(多归属)、anchor 用单 `layerId`;**过滤 = 勾选层的 OR**,server 按各层 `enabled` 同时驱动笔记列表 + 锚点重绘(见 `layerViews.tsx`)。

### 8.1 Layer Lens 弹层(顶栏 `Layers` pill → 弹出)
- 触发:顶栏右段 `Layers` pill(与 `Anchor layer 18%` 不透明度滑块并列,二者不同:滑块=锚点层透明度,pill=层可见性 Lens)。
- 内容(**过滤 + 管理合一**,用户已定:Lens 里也能管理):
  - 标题 `Layer Lens` + 副标题 `Choose which layers are visible`。
  - **层级树**:每行 = 复选(可见性)+ **颜色圆点** + 层名 + **笔记计数**(右对齐);父层可展开/折叠。
  - 计数:叶层 = 该层笔记数;**父层 = 后代之和(roll-up)**。
  - 可见性:勾选 = 纳入 OR 过滤;**父层勾选 = 级联开关所有后代**;部分开 → 父层 indeterminate(─)。底部 `Visible note count: N`(当前可见集合去重总数)。
  - 管理(就地):新建 custom 层、改名/改色/排序、删除 custom、Import/Export `.studypack`(复用现有 `entityClient` 那套,从 `layer.switcher` pane 迁来)。
- 现 `layer.switcher` pane 折叠进此弹层(或弹层即 `layer.switcher` 的弹出渲染);icon rail 的 layer 入口打开它。

### 8.2 层级模型(**导入/角色驱动**,用户已定)
- `studyLayerSchema` 加可选 **`parentId: layerIdSchema.optional()`**(additive,无迁移负担;无 parentId = 顶层)。
- **不靠手动拖拽嵌套**:层级**天然来自导入/角色** —— 导入一个「老师 studypack 包」→ 形成一个**父层**(如 `Teacher Layer`),包内的 **预习/复习/学习拓展** = 其**子层**(`parentId` 指向父)。即 `.studypack` 携带成组层 + 父子关系;import 时按 `origin.packId`/角色建父并挂子。
- 角色:父层多为 `shared`(imported)或一个代表角色的容器层;子层沿用现有 `preset`/`custom`。owned 个人层默认顶层。
- 过滤语义不变:仍是**叶层 `enabled` 的 OR**;父层 `enabled` 仅作级联主开关 + 计数归并,不直接决定 note 归属(note 仍属具体叶层)。

### 8.3 需要的改动(R7)
- core:`study-layer.ts` 加 `parentId`;`.studypack`(`pack.ts`)序列化父子;import 路径按包建父挂子。
- server:layers 接口返回 **per-layer note 计数**(+ 可见去重总数),供 Lens 显示。
- client:新 **Layer Lens** 弹层组件(树渲染 + 级联/indeterminate + 计数 + 就地管理);顶栏 `Layers` pill;`toggleLayerFilter` 扩展为父级级联。

## 9. 右侧目录 / Bookmarks 索引(hover-reveal)

> 阅读器**右边缘**一个**悬浮即现**的可跳转索引("目录")。**每条 = 一个书签(bookmark note-type)**,不是任意 note/anchor。它就是现有 **Bookmarks**(`64bc9b2`,`bookmarkViews.tsx`)换成 hover-reveal 的**分组**呈现 —— 复用同一份数据 + 同一套跳转,点击**跳到书签所在原文锚点**。

### 9.1 交互
- **折叠态**(默认):右边缘只留一个**目录图标**(竖条),不占阅读宽度。
- **悬浮展开**:鼠标移到右边缘/图标 → 面板从右侧滑入(over 内容,带过渡);鼠标移开 → 收起。可 **pin**(图钉)常驻;pin 后变成常驻面板。
- 顶部有 `«` 折叠 + 最大化小图标(对齐稿)。
- 条目点击 = 跳到该书签的锚点(复用 `bookmarkViews.tsx` 已有逻辑:`focus.setAnchor(anchors.find(a=>a.id===note.anchorIds[0]))`,reader 经 paintAnchors 重绘);当前所在条目高亮(稿中 `Concept Misunderstanding` 高亮态)。锚点不可见(被图层过滤)则禁用跳转。

### 9.2 内容结构(分组)
- 数据源:`visibleNotes.filter(contentType==="bookmark")` —— 与 Bookmarks 面板**同一份 OR 过滤后的书签**(隐藏图层的书签同样不显示)。
- 现有 `bookmarkSchema = { label, color?, order? }`(`src/core/notes/contentTypes.ts`),**无分组字段**。要按稿分组(`Important Formula` / `Summary` / `To-do` / `Common Mistake` / `Exam Review` / `Related Links`),给 bookmark 内容加**可选 `category?: string`**(additive,无迁移负担;空=未分组组)。分组名由用户在加书签/编辑时选填(可来自最近用过的 category 下拉)。
- 每行:组头 = 文件夹图标 + `category`(muted);条目 = 书签 `label`(accent 蓝,链接态),按 `order`/label 排序。空组不显示。

### 9.3 与右栏的关系(默认假设,可调)
- 目录是**最外侧**的 hover-reveal 折叠条,**独立**于持久右栏(Anchor / Anchor Tools / AI Log);二者可并存。pin 后并入右侧区域。

### 9.4 需要的改动(R8)
- core(小):`bookmarkSchema` 加可选 `category`(仅当确认要类目分组时;否则 R8 先按现有 label 平铺/按 color 分组)。
- client:新 **BookmarkIndex** hover 面板组件(右边缘触发区 + 滑入过渡 + pin 状态持久化到 workspace storage),**复用 `bookmarkViews` 的数据 + 跳转**,只是换成分组 + hover 呈现(两者可共享一个 hook)。
- 纯 `--sv-*` 令牌;两套主题。

## 10. Note 展示统一(Preview Card + Center View)—— 组件地基

> **核心原则**:Note 默认**不**完整展开,而是以**轻量预览卡**出现在各场景;要看全文/互动再**双击/点开** Center View。**同一个 Note,无论在源文档旁、Anchor 面板下、还是 AI Chat 里,都用同一套预览卡组件;点开统一在中间打开完整视图**。这是 [[abstract-recurring-capabilities]] + [[adaptive-note-mandatory-contract]] 的最强落点:卡片与完整视图都由 `getNoteType().render({mode})` 契约驱动,**不为每个来源单独设计**。
>
> 复用现状:Phase 1b 已有 `ArtifactCard`(card 模式)、`FocusOverlay`(full 模式)、`ChatMessageBody`、`NoteRenderInput.mode:"card"|"full"`。R3 把它们**收敛成一套** `PreviewCard` + `CenterView`,补 Hover 态 / per-type 预览规则 / 源文档 note-type 图标交互 / 尺寸。

### 10.1 三种展示态
1. **Preview Card(预览态,默认)**:出现在 Notes Overlay、Anchor 面板下、AI Chat、右侧相关 Note 列表、Anchor Focus。只显示:**类型图标 + 类型名 + 标题 + 少量摘要 + 来源页码/创建时间/Layer + 更多入口**。默认不铺全文。
2. **Hover Preview(悬浮态)**:鼠标悬浮 → 卡片轻微高亮 + 浮出操作入口:**打开 / 固定(pin)/ 编辑 / 更多 / 跳转到 Anchor**。不大幅展开内容。
3. **Center View(完整态)**:**双击预览卡或点"打开"** → 中间大浮层。支持:看全文 / 编辑 / 播放媒体 / 做 Quiz / 看 HTML·Mermaid·Mindmap / 翻 Flashcard / 读代码 / 复制·删除·**移动 Layer** / **跳回源 Anchor**。所有 Rich Note 的统一完整入口。顶部 pin/编辑/关闭,底部 `Page · Created …` + open-in-center + ⋯(对齐稿)。

### 10.2 统一组件规则
- 所有来源的 Note(Anchor 生成 / AI Chat 生成 / 手动创建 / 从别的 Layer 导入)**共用同一套 PreviewCard**,不单独设计样式 → 视觉/交互一致、维护低、新增 note 类型不用重做展示逻辑。
- 稿中明确标注:`Same preview card across anchor and chat`、`Open in center view`。

### 10.3 per-type 预览规则(card 模式各 NoteType 自管)
| 类型 | 预览卡显示 |
| --- | --- |
| Markdown | 标题 + 正文前三行 |
| Quiz | 题目摘要 + 题数(不展开选项) |
| Flashcard | 正面摘要(不默认翻背面) |
| Media | 缩略图 + 标题 + 时长/来源 |
| HTML | 标题 + 简短说明 + `Interactive` 标识(**不默认运行**) |
| Mermaid / Mindmap | 缩略预览或结构摘要(完整图在 Center View 缩放) |
| Code | 语言 + 代码摘要 + 说明 |

> 实现:各规则放进对应 NoteType 的 `render({mode:"card"})`;Center View = `render({mode:"full"})`。守卫测试已保证「展示侧硬契约」。

### 10.4 源文档里的展示(关键交互)
- ⚓ **Anchor 图标** = 「这里有一个锚点」;旁边的 **note-type 图标**(📄/❔/▶/`</>`…)= 「这个锚点下挂了哪些 Note」。
- **点 note-type 图标** → 在文档旁显示该 Note 的 **Preview Card**;**双击卡** → Center View。**避免默认铺开大量卡**。
- 与三 tab 配合:`Document` 模式 = 图标 + 点开预览;`Notes Overlay` 模式 = margin 把卡铺出来(+ 虚线连线,§5);`Anchor Focus` = 聚焦当前锚点的卡。

### 10.5 推荐尺寸
- Preview Card:宽 240–280px / 高 120–160px(**默认 260 × 140**)。
- Center View:宽 720–920px / 高 70–85vh。

### 10.6 需要的改动(R3 地基,R4/R5 消费)
- client:收敛 `ArtifactCard`/`FocusOverlay` → 统一 **`PreviewCard`(三态)** + **`CenterView`**;双击 → Center View(`focus`/overlay 状态)。
- 各 NoteType 补 `render({mode:"card"})` 的 per-type 预览规则(§10.3)。
- 源 reader:anchor 旁渲染 note-type 图标簇 + 点击出预览卡(§10.4);Notes Overlay/Anchor Focus 复用同卡。
- 纯 `--sv-*` 令牌;两套主题。
