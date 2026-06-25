# AI Study Vault V1 — Figma UI 制作清单

## 设计范围

第一版只画：

* Source 资料阅读
* Selection / Anchor 创建
* Rich Note 创建、编辑、展示
* 一个 Anchor 下多个 Notes
* Study Layer 导入、导出、切换
* 可插拔 Workspace / Region 概念
* Concept / Relation 只做轻量入口，不画图谱
* 不画 Patch / Diff / 改原文流程

第一版核心产品表达：

> 用户可以在任意资料片段上创建 Anchor，并为这个 Anchor 挂上多种形式的 Note。Anchor + Notes 可以组成 Study Layer，被导出、分享、导入，并叠加到同一份资料上。

---

# 00. Cover / 产品总览

## Frame 00-01：产品一句话

画一个干净的封面：

标题：

AI Study Vault

副标题：

把任意学习资料变成可追问、可批注、可复习、可共享的学习层。

核心链路：

Source → Selection → Anchor → Rich Note → Study Layer → Share / Import

## Frame 00-02：对象关系图

画一张对象关系图：

Source 资料
↓
Anchor 锚点
↓
Note 笔记
↓
Study Layer 学习层

关系要表达清楚：

* 一个 Source 可以有多个 Study Layer
* 一个 Study Layer 有多个 Anchor
* 一个 Anchor 可以挂多个 Note
* 一个 Note 可以是多种 contentType
* Study Layer 可以导入 / 导出 / 共享

---

# 01. Design System / 视觉规范

## Frame 01-01：对象颜色和图标

定义这些对象的视觉符号：

Source：资料源
Anchor：原文高亮 / 锚点
Note：笔记卡片
Study Layer：学习层 / 叠层
AI Draft：AI 生成草稿
Imported Note：来自他人的 Note
My Note：我的 Note
Unmatched Anchor：导入后未匹配的锚点

建议图标：

* Source：文件 / 文档
* Anchor：定位点 / 高亮线
* Markdown Note：文档图标
* Flashcard：卡片图标
* Quiz：问号图标
* Diagram：节点图
* Code：代码符号
* Media：图片 / 音频 / 视频
* Study Layer：叠层图标
* Imported Layer：叠层 + 作者头像

## Frame 01-02：基础组件

画这些组件：

* Button
* Icon Button
* Chip
* Tag
* Card
* Side Panel
* Floating Menu
* Tooltip
* Toast
* Empty State
* Tab
* Dropdown
* Layer Switch
* Status Badge

状态至少包括：

* 默认
* hover
* selected
* disabled
* loading
* warning
* error

## Frame 01-03：Note 类型卡片样式

画 6 种 Note 卡片：

* Markdown
* Flashcard
* Quiz
* Diagram
* Code
* Media

每种卡片要有：

* 类型图标
* 标题 / 摘要
* 所属 Anchor 片段
* 所属 Layer
* 作者
* 创建时间
* 操作按钮

---

# 02. Workspace / 主工作台

## Frame 02-01：默认三栏工作台

画桌面端主界面：

左栏：Library
中间：Source Reader
右栏：Note Studio
底部：Note Timeline / Anchor List

结构：

左侧：

* Source 列表
* Study Layer 切换器
* Note 类型筛选

中间：

* 文档阅读区
* 原文高亮
* Anchor 标记
* 当前选区浮动菜单

右侧：

* 当前 Anchor
* AI 生成入口
* Note 类型切换
* Note 草稿 / 编辑器

底部：

* 当前资料的所有 Notes
* 当前资料的 Anchors
* 按 Layer / 类型筛选

## Frame 02-02：Workspace 可插拔说明图

画一张架构式 UI 图：

Workspace
├── Region Left：source.library / layer.switcher
├── Region Center：source.viewer
├── Region Right：note.studio / anchor.inspector
└── Region Bottom：note.list / timeline

重点表达：

* Region 是容器
* View 是功能
* View 可以挂到不同 Region
* 第一版默认是 threePane
* 未来可以切换 Layout

## Frame 02-03：布局 Preset 切换

画一个小菜单：

Layout Preset：

* Study Workspace
* Review Workspace
* Layer Import Workspace
* Focus Reading
* Custom Layout

第一版只需要视觉预留，不一定真的实现复杂拖拽。

---

# 03. Source Library / 资料库与导入

## Frame 03-01：Source Library 默认态

左侧资料库列表：

* React Docs
* AI Paper
* Course HTML
* Local PDF
* Web Article

每个 Source 列表项显示：

* 标题
* 类型标签：HTML / PDF / Web / Markdown / Code
* Note 数量
* 已启用 Layer 数量
* 最近打开时间

## Frame 03-02：Import Source 弹窗

入口：

Import Source

选项：

* 导入 HTML
* 导入 PDF
* 打开网页 URL
* 导入 Markdown
* 导入文件夹
* 生成 HTML

注意：不要画成 PDF 专属工具 / HTML 专属工具，而是统一 Source 导入。

## Frame 03-03：Source 空状态

没有资料时：

标题：

导入一份资料开始学习

副文案：

你可以导入 HTML、PDF、网页、Markdown 或代码文件。选中任意片段后，即可创建 Anchor 并生成多种学习 Note。

按钮：

* Import Source
* Open URL
* Generate HTML

---

# 04. Selection / Anchor 创建流程

这是最高优先级页面。

## Frame 04-01：选中原文

中间 Reader 里选中一段文字。

选区要明显，但不要刺眼。

选区旁出现浮动工具条。

## Frame 04-02：选区浮动菜单

菜单分两组：

AI 生成：

* 解释
* 总结
* 举例
* 卡片
* 题目
* 图解
* 代码示例

手动创建：

* 旁注
* 摘录
* 重点标记

暂时不放：

* 改写
* 插入原文
* 替换原文
* Patch
* Diff

## Frame 04-03：Anchor Draft 状态

用户点“解释”后，右侧 Note Studio 顶部出现：

当前 Anchor Draft：

“React Fiber 是 React 16 引入的新协调架构……”

状态：

* 尚未保存 Anchor
* 保存 Note 时会自动创建 Anchor

按钮：

* 创建 Note
* 取消选区

## Frame 04-04：Anchor 已创建状态

原文出现高亮。

右侧显示：

Anchor 已创建

包含：

* Anchor 原文片段
* 所属 Source
* 所属 Study Layer
* 已挂 Notes 数量
* 创建时间

---

# 05. Note Studio / Rich Note 创建与编辑

这是右栏核心。

## Frame 05-01：无选区状态

右侧空状态：

请选择资料中的一段内容来创建 Note

下面展示快捷说明：

* 选中一段文字
* 选择解释 / 卡片 / 题目 / 图解
* 保存为 Note
* Note 会挂回原文 Anchor

## Frame 05-02：有 Anchor 后的 Note Studio

顶部：

当前 Anchor：

“React Fiber 是 React 16 引入的新协调架构……”

下方：

Note 类型：

* Markdown
* Flashcard
* Quiz
* Diagram
* Code
* Media

操作：

* AI 生成
* 手动编辑
* 保存 Note

## Frame 05-03：AI 生成 Markdown Note 草稿

右侧显示：

AI Draft

内容：

* 标题
* Markdown 正文
* 来源 Anchor
* 所属 Layer

按钮：

* 保存为 Note
* 编辑
* 重新生成
* 换成 Flashcard
* 换成 Quiz

## Frame 05-04：Flashcard Note 编辑器

字段：

* Front
* Back
* Explanation
* Difficulty

按钮：

* AI 填充
* 保存
* 预览卡片

## Frame 05-05：Quiz Note 编辑器

字段：

* Question
* Options
* Answer
* Explanation

状态：

* 单选题
* 判断题
* 简答题

按钮：

* 生成选项
* 保存
* 预览题目

## Frame 05-06：Diagram Note 编辑器

左侧输入：

* Mermaid / Markmap 源码

右侧预览：

* 图形预览

按钮：

* AI 生成图解
* 重新生成
* 保存

## Frame 05-07：Code Note 编辑器

字段：

* Language
* Code
* Explanation

按钮：

* 生成示例
* 复制代码
* 保存

## Frame 05-08：Media Note 编辑器

类型：

* Image
* Audio
* Video

上传区域：

* 选择本地文件
* 添加 caption
* 音视频可选 start / end 时间

状态：

* 文件已导入 Vault
* 文件加载失败
* 文件过大提示

---

# 06. Reader 中的 Note 展示

## Frame 06-01：原文高亮 + Note 数量

中间 Reader 里多个 Anchor 高亮。

每个高亮旁有数字角标：

* 1
* 2
* 5

表示这个 Anchor 下有多少条 Notes。

## Frame 06-02：悬浮 Note 预览卡

鼠标 hover 某个 Anchor。

浮出卡片：

这个片段有 3 条 Notes：

* 我的解释 Note
* Jack 的 Flashcard
* 官方 Quiz

卡片上显示：

* Note 类型
* Layer 来源
* 作者
* 简短摘要

操作：

* 打开
* 钉住
* 复制到我的笔记

## Frame 06-03：点击 Anchor 后右侧打开 Anchor Inspector

右侧显示：

Anchor Inspector

包含：

* 原文片段
* 所属 Source
* 所属 Layer
* 这个 Anchor 下的所有 Notes
* 添加新 Note 按钮
* 复制 Anchor 链接

## Frame 06-04：钉住 Note 小窗

Note 卡片可以钉在 Reader 上。

小窗支持：

* 拖动
* 收起
* 关闭
* 编辑
* 跳到 Anchor

---

# 07. Note List / 管理与复习

## Frame 07-01：底部 Note Timeline

底部显示当前 Source 的 Notes。

Tab：

* All Notes
* Anchors
* Flashcards
* Quizzes
* Diagrams
* Imported

列表项显示：

* Note 类型
* Anchor 原文摘要
* 所属 Layer
* 作者
* 更新时间

点击后：

* 中间 Reader 跳到 Anchor
* 右侧打开 Note

## Frame 07-02：按 Anchor 分组

列表按 Anchor 分组：

Anchor A：

* Markdown Note
* Flashcard
* Quiz

Anchor B：

* Diagram
* Code Example

重点表达一个 Anchor 可以挂多个 Notes。

## Frame 07-03：复习入口

Flashcard / Quiz 可以单独进入复习模式。

按钮：

* Review Flashcards
* Practice Quiz
* Only Imported
* Only My Notes

第一版只画入口，不需要完整复习系统。

---

# 08. Study Layer 分享 / 导入 / 切换

这是新增重点，必须画。

## Frame 08-01：Layer Switcher

在左栏或 Reader 顶部画 Layer Switcher：

当前 Source 的 Study Layers：

* ✓ 我的笔记层
* ✓ Jack 的 React 精读层
* □ 官方基础解释层
* □ Quiz 练习层

每个 Layer 显示：

* 标题
* 作者
* Anchor 数量
* Note 数量
* 是否导入
* 是否启用

操作：

* 开关
* 查看详情
* 导出
* 删除 / 隐藏

## Frame 08-02：Layer Detail 详情

显示：

Study Layer：React Docs 面试精读层

信息：

* 作者
* 描述
* 适配 Source
* Anchor 数量
* Note 数量
* Note 类型分布
* 最后更新时间

按钮：

* 启用 / 关闭
* 导出
* 复制为我的 Layer

## Frame 08-03：导出 Study Layer

弹窗：

导出 Study Layer

字段：

* 标题
* 描述
* 作者名
* 包含的 Note 类型
* 是否包含媒体资产
* 是否包含 Concept 链接

统计：

* 42 Anchors
* 96 Notes
* 18 Flashcards
* 12 Quizzes
* 6 Diagrams

按钮：

* 导出文件
* 生成分享链接

第一版可以优先画导出文件。

## Frame 08-04：导入 Study Layer 入口

入口可以在左栏：

Import Study Layer

支持：

* 选择 .study-layer 文件
* 粘贴分享链接
* 拖拽文件导入

## Frame 08-05：导入预览页

重点页面。

显示：

Study Layer：React Docs 面试精读层
作者：Jack
来源资料：React Docs

包含：

* 42 Anchors
* 96 Notes
* 18 Flashcards
* 12 Quizzes
* 6 Diagrams

匹配结果：

* 38 个 Anchor 已匹配
* 3 个 Anchor 模糊匹配
* 1 个 Anchor 未匹配

按钮：

* 导入为独立 Layer
* 取消

不要默认合并到我的笔记。

## Frame 08-06：Anchor 匹配列表

列表展示导入包中的 Anchors。

每条显示：

* 原始片段
* 匹配状态：已匹配 / 模糊匹配 / 未匹配
* 当前 Source 中匹配到的位置
* Note 数量

状态设计：

已匹配：绿色
模糊匹配：黄色
未匹配：红色 / 灰色

## Frame 08-07：未匹配 Anchor 手动定位

画一个手动定位界面：

左侧：

导入包里的 Anchor 原文

右侧：

当前 Source Reader

用户可以在当前 Source 中重新选中一段文字。

按钮：

* 绑定到当前选区
* 跳过
* 保留为未匹配

## Frame 08-08：Imported Note 卡片

导入别人的 Note 后，卡片要显示来源：

来自 Jack 的 React 精读层

操作：

* 复制到我的笔记
* 隐藏这条
* 查看来源
* 跳到原 Anchor

复制后，Note 变成我的 Layer 中的一条独立 Note。

---

# 09. Concept / Relation 轻量入口

第一版不画 Graph View。

## Frame 09-01：Concept List

左侧或右侧节点：

Concepts

列表：

* React Fiber
* Scheduler
* Concurrent Rendering

每个 Concept 显示：

* 名称
* 关联 Notes 数量
* 关联 Anchors 数量

## Frame 09-02：Concept Inspector

右侧显示：

Concept：React Fiber

字段：

* name
* aliases
* description

关联：

* Anchors
* Notes
* Relations

操作：

* Link current Anchor
* Link selected Note
* Create Relation

## Frame 09-03：新建 Relation 小表单

字段：

* From
* Relation Type
* To

Relation Type：

* explains
* depends_on
* related_to
* contradicts
* example_of

不要画知识图谱。

---

# 10. Empty / Error / Edge States

## Frame 10-01：无 Source

导入资料开始。

## Frame 10-02：无选区

提示选择一段内容。

## Frame 10-03：当前 Anchor 没有 Notes

按钮：

* 创建 Markdown Note
* 生成 Flashcard
* 生成 Quiz

## Frame 10-04：AI 生成失败

状态：

* 错误提示
* 重试
* 手动创建 Note

## Frame 10-05：Study Layer 导入失败

状态：

* 文件格式错误
* Source 不匹配
* Anchor 全部未匹配

## Frame 10-06：媒体加载失败

状态：

* 文件不存在
* 文件格式不支持
* 重新选择文件

---

# 11. Mobile / Tablet 预留

第一版可以只画方向，不做完整移动端。

## Frame 11-01：手机阅读模式

结构：

* 上方 Source Reader
* 底部 Note Studio 抽屉
* 长按选区出现浮动菜单

## Frame 11-02：平板双栏模式

结构：

* 左侧 Reader
* 右侧 Note Studio
* Layer Switcher 折叠在左上角

---

# 优先级

## P0 必画

* 00-02 对象关系图
* 02-01 默认三栏工作台
* 04-01 选中原文
* 04-02 选区浮动菜单
* 05-02 有 Anchor 后的 Note Studio
* 05-03 AI 生成 Markdown Note 草稿
* 06-01 原文高亮 + Note 数量
* 06-02 悬浮 Note 预览卡
* 08-01 Layer Switcher
* 08-05 导入预览页

## P1 必画

* 05-04 Flashcard Note 编辑器
* 05-05 Quiz Note 编辑器
* 05-06 Diagram Note 编辑器
* 07-01 Note Timeline
* 08-06 Anchor 匹配列表
* 08-08 Imported Note 卡片

## P2 可后画

* Media Note
* Concept Inspector
* Relation 表单
* Mobile / Tablet
* Layout Preset
* Workspace 可插拔说明图

---

# 第一版 Figma 交付物

最终交付应该包含：

1. 一个完整桌面端主工作台
2. 一个完整 Selection → Anchor → Note 创建流程
3. 一组 Rich Note 类型编辑器
4. 一组 Reader 中 Note 呈现组件
5. 一个完整 Study Layer 导入流程
6. 一个 Layer Switcher
7. 一个 Design System 基础组件页
8. 一张对象关系图
9. 一张 Workspace / Region / View 关系图

---

# 设计红线

不要画：

* Patch / Diff / 改原文
* 知识图谱 Graph View
* 多人协作
* 评论区
* 插件市场
* 复杂权限系统
* 完整移动端
* PDF / HTML 专属复杂编辑器

必须体现：

* 一切从选区开始
* Anchor 是第一公民
* 一个 Anchor 可以挂多个 Rich Notes
* Note 可以是多种类型
* Study Layer 可以导入 / 导出 / 切换
* 别人的 Note 默认属于别人的 Layer
* 用户可以复制别人的 Note 到自己的 Layer
* Workspace 是可插拔的，但第一版默认三栏
