# 设计哲学：与 Obsidian 的异同

记录本产品（AI Study Vault）底座设计与 Obsidian 的关系，作为架构取向的参照。

## 结论

> 底座哲学（最小核心 + 注册式插件 + command + dock workspace + 本地优先）与 Obsidian **同源**；
> 但产品主语是「对资料的锚点」而非「笔记文件」，加上可传播学习层、结构化 + AI 原生 note、
> Product Kit 垂直产品包 —— 整体更像 **Obsidian × Hypothes.is × Anki** 的结合。

## 一样的部分（设计思路同源）

| 维度 | Obsidian | 本产品 |
| --- | --- | --- |
| 最小核心 + 注册式扩展 | core 提供 vault/编辑/链接；插件注册 command/view/setting/ribbon | core 提供 Source/Anchor/Note/Layer + registry（NoteType/Command/View/Layout/Surface）；Product Kit 只注册、不改 core |
| 命令系统 | 万物皆 command + 命令面板 | `CommandRegistry`（`isAvailable`/`run`） |
| Workspace = dock 树 | split → leaves，每 leaf 一个 view（by type），可拖拽停靠、保存布局 | dock 布局引擎（`split`/`leaf` + 布局 preset + 切换）—— 见 [[layout-engine]] / `docs/design/layout-engine.md` |
| 本地优先 / 可移植 | 本地 markdown vault | 本地 vault + `.studypack` 文件分享 |

共同内核：**core 是机制，功能靠注册进来**——加功能 = 往 registry 注册一个插件，而不是改 core。

## 不一样的部分（差异化）

1. **主语不同**：Obsidian 的主语是*笔记文件*；本产品的主语是**「对一份资料的 Anchor / 选区」**（`FocusContext` 以锚点为一等真相）。"对外部资料的精确锚点 + 跨副本重定位"是 Hypothes.is 的路子，Obsidian 没有。
2. **可传播学习层 (Study Layer)**：Obsidian 分享文件/vault；本产品能把 anchor+note 打包、在别人副本上重定位（W3C TextQuoteSelector）、导入为独立层、开关。见 `docs/design/study-layer.md`。
3. **结构化 Note + AI 原生**：`Note.content = unknown` + 按 contentType 的结构化卡片（flashcard/exercise/…）+ AI 结构化生成直接进 command；Obsidian 笔记是 markdown 文本，结构化 / AI 靠社区插件、非 core。
4. **Product Kit = 垂直产品包**：Obsidian 插件是"能力插件"；本产品的 Kit 是"一整套领域产品"（内容类型 + 命令 + 布局 + 领域语言 + 传播策略 + per-source 激活），更像"换一套产品皮"。见 `docs/design/product-kit.md`。
5. **多 reader surface**：PDF / web(snapshot+live) / image / code 各有专门 reader + 锚点种类；Obsidian 基本以 markdown 为主，PDF 标注能力有限。

## 取向小结

- 像 **Obsidian** 的：可插拔工作台（dock + view + command + 本地优先）。
- 像 **Hypothes.is** 的：对外部资料的锚点 + 可分享 / 可导入 / 可重定位的标注层。
- 像 **Anki** 的：结构化的学习卡片（flashcard / exercise / review-pack）与复习闭环。
