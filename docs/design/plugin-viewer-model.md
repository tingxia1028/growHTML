# Plugin / Kit / Viewer 模型(定稿)

状态:定稿(2026-07-01),作为后续 "Kit & Plugin" 功能与 viewer 层的地基。
关联:`textbook-product-kit`(记忆)、`docs/design/markdown-viewer-plugins.md`(命名待对齐到本文)。

## 1. 术语(钉死)

- **Plugin = 最小扩展单元**(Obsidian 插件那种)。它向宿主**注册若干"贡献"(contribution)**。plugin 本身是能力单元,不是某种注册项。
- **Kit = 精选打包 + 配置**。一个垂直产品 = 一组 plugin + 布局 + 语言 + 策略。Kit 不是扩展单元,是"发行版/产品"。
- **关系:Kit 装 Plugin;Plugin 才是能力单元。** 一个 plugin 可以被多个 kit 复用;一个 kit 可以只 enable 某 plugin 的部分贡献。

> 修正历史说法:note-type-plugin 不是"kit 的一种注册项",而是 plugin 能贡献的**一种** contribution。

## 2. Contribution 种类(plugin 能贡献什么)

- **NoteType renderer** —— 渲染一个 `contentType` 的 note(render/edit)。**独占**,key = `contentType`。
- **Viewer** —— 跨类型/文件级的展示层(表格、看板、日历、mindmap 全屏…)。**独占**,靠 resolver 选。
- **Decoration / marker** —— 在已渲染内容上叠加(锚点图标、批注高亮、post-processor)。**叠加**。
- **Command / Operation** —— 动作(可上工具栏)。
- **Prompt pack** —— 结构化生成的提示词。
- **Language / Layout / Policy** —— 文案、dock 布局、层传播策略。

## 3. 冲突的关键:先分两类

| | **独占型 (exclusive)** | **叠加型 (compositional)** |
|---|---|---|
| 语义 | 一个槽只能有**一个**渲染者 | **所有**匹配者都作用 |
| 例子 | note 用哪个 viewer 打开 | 装饰、批注 marker、post-processor |
| 冲突 | 有"选哪个" | 无 —— 只需定**顺序** |

**大多数"多插件抢 viewer"的痛,都是把本该独占的做成模糊匹配、或把本该叠加的做成互斥。先分流。**

## 4. 独占型的解法(抄 VS Code 的心智模型)

统一优先级链:

```
用户显式关联(最高)  >  match() 特异性/打分  >  priority  >  注册顺序(last-wins + 警告)  >  默认 fallback
                      并且永远保留 "用…打开 / Reopen With…" 逃生口
```

- **key/命名空间**是第一消歧器(`contentType` / mime / 文件 glob / fence lang);plugin id 前缀防误撞;同 key 重复 = 安装期报错或 last-wins + 警告。
- **特异性打分**:viewer 声明 `match(note|file) → number`(0 = 不接;越高越特化),host 取最高分。
- **用户显式选择压过一切**,并持久化(per-type / per-note 关联,存 prefs)。
- 必给**默认 fallback**(回落到该类型的 NoteType renderer)+ **手动切换**。

参考:Obsidian `registerView`/`registerExtensions`(按 key,多个能开 → 用户选默认)、`registerMarkdownCodeBlockProcessor(lang)`(fence key);VS Code `customEditors`(`viewType + selector + priority: default|option` + `workbench.editorAssociations` 用户 pin + "Reopen With")。

## 5. 叠加型的解法

**全部匹配者都跑,结果合并**,顺序由 `priority`/`sortOrder`/precedence 决定。没有"选哪个",只有"按什么顺序叠"。参考:Obsidian post-processor、VS Code hover/completion providers、CM6 facet precedence。

我们的 anchor marker / 批注高亮就属这类。

## 6. growHTML 落地

1. **NoteType 渲染 = 独占,key = `contentType`**。现有 `getNoteType(contentType)` registry 已是"一类型一渲染器"。把重复注册定成 **last-wins + 警告**,或带 `priority` 让 kit B 显式覆盖 kit A(如换掉默认 markdown 渲染)。
2. **Viewer 层(待建)= 独占槽 + resolver**:`Viewer { id, match(note|file)→score, render, priority? }`;host `resolveViewer()` 按 §4 优先级链选;用户可 pin;fallback 到 NoteType renderer;给"用…打开"。
3. **Decoration/marker = 叠加**:走"全跑 + priority 排序",不进独占 resolver。
4. **plugin id 命名空间化**,注册 key 用 `pluginId:key` 或校验唯一。

## 7. 后续功能:Kit & Plugin 管理(左侧栏)

- 最左侧栏加 **"Kit & Plugin"** 入口:列出已装 kit / plugin,开关各 contribution,查看/解决 viewer 冲突(显示当前 winner + 让用户改关联)。
- **用户自定义 kit**:把选中的一组 plugin + 布局 + 语言存成一个用户 kit(register-only,不改 core)。
- 先把 §1–§6 的契约在代码里落实(尤其 Viewer resolver + 命名空间 id),再挂 UI。
