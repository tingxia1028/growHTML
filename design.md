# Growte Design

## 这个文档是做什么用的

`design.md` 是 Growte 的总设计说明。它不是开发计划，也不是宣传页，而是给当前和未来开发者看的系统地图。

它主要回答这些问题：

- Growte 要解决什么问题。
- Source、Anchor、Note、Layer、Plugin、Viewer、AI Chat 的边界在哪里。
- 新功能应该接到哪个扩展点，而不是硬编码进主界面。
- UI 控件、卡片、面板、颜色和字体应该遵守什么统一规则。
- 做取舍时优先保护哪些产品原则。

更细的专题设计可以放到 `docs/design/`。这个文件只记录长期稳定的产品和架构约束。

## 产品定位

Growte 是一个本地优先的 AI 学习工作台。

它不是单纯的 PDF 阅读器，也不是传统笔记软件。核心体验是：用户可以在任何学习资料上选中片段，创建 Anchor，写 Note，向 AI 追问，并在以后从原文位置找回这些记录。

核心链路：

```text
Source 原始资料
  -> Anchor 原文位置
  -> Note 学习记录
  -> AI Chat 针对片段追问
  -> Layer 可开关、可分享的学习层
  -> Viewer 不同文件类型的展示与定位能力
```

## 核心对象原则

### Source 是事实来源

Source 表示原始学习资料本身。Note、Anchor、Patch、Concept 都围绕 Source 工作。

不要把资料内容复制成另一套独立真相。Viewer 可以用不同方式展示 Source，但不应该改变 Source 的身份。

### Anchor 是学习记录的挂载点

Note 不应该只是列表里的独立项目。它必须知道自己来自哪一段原文。

不同 Source 类型可以有不同定位方式：

- PDF 使用 page、quote、rect hint。
- HTML 使用 study id 或 TextQuote。
- 图片使用 normalized rect。
- 网页使用 URL 和 TextQuote。

上层只理解统一的 Anchor 语义：这条记录挂在 Source 的哪个位置。

### Note 类型可扩展，但外壳必须统一

Note 可以是 markdown、quiz、flashcard、media、code、mindmap、textbook explanation 等类型。

每种 Note 类型可以定义自己的内容结构和渲染方式，但小卡片、大窗口、列表卡片、标题栏、图标、操作按钮必须复用同一套卡片外壳。不要让每个 Note 类型各写各的 UI。

### Layer 是学习层，不是第二套资料

Layer 用来组织、开关、分享一组 Anchor 和 Note。

Layer 面板里的每一行是一个可启用的学习层。它应该使用统一的小卡片和统一勾选控件，不应该出现单独定制的大蓝勾、第二套颜色或混乱的文本排列。

Layer 的组织结构只依赖 `parentId`。不要在 UI 里定死 `Stages`、`Custom` 这类分组。预习、学习、复习、拓展等 kit 预设层只是普通 child layer，默认挂在 Mine 下面；Imported 也只是一个普通父 layer，导入的层挂在它下面。`role` 只用于兼容、权限和只读判断，不用于决定 UI 层级。

### Viewer 是文件类型边界

不同文件类型通过 Viewer 展示，而不是在主工作区到处写 `if source.type === ...`。

Viewer 的职责：

- 展示某种 Source。
- 支持文本选择或区域选择。
- 把选择转换成 Anchor draft。
- 把已有 Anchor 画回 Source。
- 支持跳转到 Anchor。

主工作区只关心当前 Source 用哪个 Viewer 渲染。

### AI 是能力，不是独立数据模型

AI Chat、生成笔记、生成练习、解释文本都只是能力调用。

AI 输出必须落到已有对象里：

- 学习记录落到 Note。
- 修改建议落到 Patch。
- 知识节点落到 Concept 或 Relation。
- 分享和导出落到 Layer 或 Pack。

不要让 AI 拥有一套平行的数据结构。

## 插件边界

系统插件只负责基础能力：

- 基础文件类型 Viewer。
- 基础 Note 类型。
- 基础命令。
- 基础 AI Provider。
- 基础设置页和权限页。

垂直场景不做成系统插件。例如教材学习、日程表、课程计划、错题本都应该是普通插件或插件组合。它们可以注册自己的 Viewer、Note 类型、命令、侧栏 View 和导出能力，但不能获得系统特权。

### 日程表插件方向

日程表不做成 kit，也不做成系统插件。底层数据可以是 Markdown 或普通本地文件，上层 Viewer 可以定制。

推荐形态：

- 数据层：`.md` 或 `.schedule.md`，使用 frontmatter 或结构化块保存事件。
- Viewer：自定义 calendar viewer，负责月视图、周视图、日视图和事件编辑。
- Note：日程里的事件可以关联 Anchor 或 Note，但不取代 Note 模型。
- Command：提供“从资料生成复习日程”“把错题加入复习计划”等普通命令。
- 权限：只声明需要读写哪些文件或文件夹，不走系统特权。

## UI 设计原则

Growte 是工作台，不是落地页。打开后应该直接进入可用的学习界面。

默认布局：

- 左侧：Library、Folders、Recent Read、插件入口。
- 中间：Source Viewer。
- 右侧：Anchor、Notes、Layers、AI Chat 等上下文面板。
- 顶部：Document、Notes Overlay、Anchor Focus、窗口控制。

顶部不承载太多工具入口。扩展入口优先进入侧边栏或对应面板。

### 视觉基调

- 字体：界面字体保持 13px 左右，标题 14px 左右，紧凑、清晰、可扫描。
- 圆角：普通卡片和控件使用 8px 或更小圆角，避免厚重的圆角按钮感。
- 边框：使用轻灰边框，不使用大面积深色描边。
- 阴影：只用于浮层和弹窗，普通面板尽量靠边框和留白分层。
- 颜色：主交互色只使用 Growte accent blue。不要在阅读高亮、Anchor 摘录、公式文字、勾选态里混入 amber、green 等第二套主题色。

### 浮层与内联动作

临时展开的 UI 必须像一个可收起的浮层，而不是永久插进页面布局。

规则：

- 工具按钮对齐遵守统一原则：标签栏、标题栏、header bar 上的工具统一靠右；content/card 内部的 `...` 更多按钮靠右；其它正文内主要操作默认靠左。
- `+` 菜单、更多菜单、搜索展开、Autocomplete、轻量 popover 都必须支持点击/聚焦到外部后自动收回。
- 同一个输入字段的动作优先放在输入框尾部作为 icon button，例如 URL 输入框后放“抓取网页”“实时打开”，不要拆成输入框下面的多行菜单项。
- icon button 必须提供 `title` 和 `aria-label`，文字提示只在 hover/无障碍标签中出现。
- 会改变数据或发起动作的 icon button 点击后默认关闭所在浮层；纯输入、选择器、开关可以保持浮层打开。
- 浮层通过 portal 渲染时，也要按 trigger + popover 双区域判断内外点击，不能因为 DOM 脱离父面板就无法自动关闭。

### Library 面板样式

Library 是侧栏工作台面板，和 Layers、Actions、Settings 使用同一套 pane 语言。

规则：

- 标题行只放标题和轻量图标按钮，不放常驻长输入框。
- 搜索默认收起为放大镜图标；点击后在标题行下面展开一行搜索输入框。
- 最近、文档、文件夹都是 section，不做成厚卡片或文件夹式大块。
- 最近和文档里的 source row 只显示一行：文件类型图标 + 标题前几个字，长标题用 ellipsis。
- source id、原始路径、类型等详细信息只放到 hover tooltip，不直接占用列表高度。
- row 里的 `x` 只表示从当前列表移除或关闭此行，不删除 Source，不使用垃圾桶图标。
- 真正删除资料必须放在更明确的菜单或回收站流程里，避免误点。

### 统一选择控件与开关

所有有勾的地方必须使用统一控件，不允许直接裸用浏览器默认 checkbox。

有两种控件：

1. `.sv-check`
   - 用途：列表选择、包含关系、必填项、Layer 是否参与显示。
   - 视觉：16px 小方框，5px 圆角，选中后填充 Growte accent blue，白色对勾。
   - 使用场景：Layers 列表、变量 required、HTML note interactive、普通多选列表。

2. `.sv-switch`
   - 用途：持续性的开关设置。
   - 视觉：Codex 风格 pill switch，右侧滑块，打开时使用 Growte accent blue。
   - 使用场景：记忆记录开关、默认权限开关、插件启用/停用、功能启用/隐藏。

实现规则：

- JSX 必须显式使用 `.sv-check-input + .sv-check-box` 或 `.sv-switch-input + .sv-switch-track`。
- 不要给单个业务面板另写 checkbox 颜色、尺寸或对勾。
- 勾选态、开关态、active row 都使用同一套 accent blue token。
- 如果一个控件表达“是否启用某个长期设置”，优先用 switch。
- 如果一个控件表达“这个列表项是否被选中或纳入过滤”，优先用 check。

### 插件管理面板

Kit & Plugin 面板使用侧栏工作台样式，不使用市场页或设置页的大块营销布局。

规则：

- `已安装` / `市场` 是面板上层页签，使用下划线 active 状态，不使用胶囊按钮。
- 搜索默认收起，只在页签行右侧显示放大镜图标。
- 点击放大镜后，在页签行下面展开一行搜索输入框。
- 搜索是面板级行为：在 `已安装` 中过滤已安装 kit/plugin，在 `市场` 中过滤市场 listing。
- 类型过滤（All / Plugins / Kits）属于 `市场` tab 的内部过滤，放在搜索行和列表之间。
- 插件启用/停用继续使用 `.sv-switch`，安装/卸载是普通轻量按钮，不混用 checkbox。

### Settings 面板样式

Settings 也是侧栏工作台，不是独立设置页。它必须使用和 Library、Layers、Actions 一致的 pane 外壳。

规则：

- Settings Hub 使用白底、10px 圆角、浅灰边框、顶部标题分隔线。
- 每个 setting section 是无框分组，section 之间用浅灰分隔线，不再做“卡片套卡片”。
- Provider 选择列表使用统一小卡片行：8px 圆角、浅灰边框、选中时 accent blue 弱背景和蓝边。
- Provider 单选不显示浏览器默认 radio；使用 16px 自定义蓝色圆点。
- 能力标签、provider id、kind badge 默认使用中性灰，不抢主交互蓝。
- 检测成功、密钥已保存等正向状态使用 accent blue；只有错误/失败使用 danger red。
- 表单输入和轻按钮使用 8px 圆角、13px 控件字重，和左侧 pane 控件一致。

### Layers 面板样式

Layers 里的层列表必须和其他侧栏列表统一：

- 每个 layer 是 8px 圆角小卡片。
- 列表按 `parentId` 渲染成树，不显示固定的 `Stages` 分组标题。
- Mine 是用户自有 layer 的根；kit 预设层和用户新建 custom layer 默认缩进挂在 Mine 下。
- 未启用时白底、浅灰边框，不用降低到看不清。
- 启用时使用 `--sv-accent-weak` 背景和 `--sv-accent-border` 边框。
- 颜色块只是 layer 的识别辅助，不能抢过勾选控件的主视觉。
- 行内操作按钮保持 12px 左右，使用图标或轻量文字，不堆叠成长句。

### Note 卡片样式

所有 Note 类型的小窗口、列表卡片和大窗口都复用同一套 Note card 外壳。

允许变化的是内容区，不允许变化的是：

- 卡片圆角、边框、阴影。
- 类型图标位置。
- 标题与元信息排列。
- 操作按钮位置。
- 预览卡片尺寸和文本层级。

### Source Viewer 标记

Source Viewer 上的 Anchor 和 Note 标记必须浮在原文位置附近，并跟随原文滚动或缩放。

Note 图标点击后显示该 Anchor 下的所有可见 Note，不应该只弹出一个原始 JSON 或单个临时窗口。

Linked Notes 点击后应该跳转到文本位置，并在 Notes viewer 里展示对应卡片。

## 数据与本地优先

Growte 默认使用本地数据。用户资料、Note、Anchor、Layer、插件数据都应该能被用户理解和迁移。

原则：

- 不把本地学习行为自动导出。
- 分享必须显式发生。
- 可读数据优先使用 Markdown、JSONL 或普通文件结构。
- 需要迁移时，迁移逻辑应可测试、可回滚、可解释。

## 未来扩展方向

优先级最高的是把“阅读 -> 选中 -> Anchor -> Note/AI -> 回到原文”的闭环做到稳定、好看、可信。

可以扩展但不要提前膨胀的方向：

- 更多 Viewer：Word、网页、代码、表格、视频。
- 更多普通插件：日程表、课程计划、错题本、复习包。
- 分享和订阅 Layer。
- Concept 和 Relation 图谱。
- AI action marketplace。

只要新能力能注册到现有对象和扩展点，就不要新增系统特权。
