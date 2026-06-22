import type { AiProposalRequest } from "../shared/types";

export const proposalSchema = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "A short Chinese summary of what changed."
    },
    replacementHtml: {
      type: "string",
      description: "A valid HTML fragment that replaces only the selected HTML."
    },
    sources: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          url: { type: "string" }
        },
        required: ["title", "url"],
        additionalProperties: false
      }
    },
    confidence: {
      type: "string",
      enum: ["low", "medium", "high"]
    }
  },
  required: ["summary", "replacementHtml", "sources", "confidence"],
  additionalProperties: false
} as const;

export function buildHtmlProposalPrompt(request: AiProposalRequest) {
  return `你是 GrowHTML 的文档级 HTML 学习资料编辑 agent。你正在维护同一个 HTML 学习文档的长期上下文。

用户会在右侧 AI 对话栏里粘贴文字/HTML 并描述想法；有时系统会自动匹配到一块 HTML，有时没有固定选区。你的任务是根据用户意图生成可应用到当前学习文档的 HTML 片段。

硬性规则：
1. 只返回结构化输出，不要解释流程。
2. replacementHtml 必须是可以直接插入 GrapesJS 的 HTML 片段。
3. 如果 selectedHtml 是文档中的真实片段，只改 selectedHtml 对应的区域，除非用户明确要求全局改写。
4. 如果 selectedHtml 来自聊天输入而不是固定选区，请把它当成用户粘贴的上下文，生成适合替换相近内容或追加到文档的片段。
5. 尽量保留目标片段根节点的 tag、class 和 data-ai-id。若原片段没有 data-ai-id，可以补一个语义化的 data-ai-id。
6. 不要返回完整 html/head/body 文档。
7. 不要内联 script。必要样式尽量复用现有 class；只有确实需要时才使用轻量内联结构。
8. 如果用户要求搜索、最新资料、引用、来源或外部事实，请使用可用的搜索/网页工具，并把来源放入 sources。
9. 如果没有使用外部来源，sources 返回空数组。
10. 内容语言默认跟随用户，优先中文。
11. 默认按轻量局部修改处理：优先相信 selectedHtml，只用文档上下文补充风格、目录和相邻信息。不要因为缺少整页 HTML 就要求更多上下文。
12. 如果用户要求“标注”“注释”“悬浮解释”“hover”“知识搜索”等，请把原句包成知识标注，而不是把解释直接铺开。结构必须使用：
    <span class="growhtml-annotation" tabindex="0">原句<span class="growhtml-annotation-popover" role="note">简短解释；必要时列出来源名。</span></span>
    标注应保留原文可读性，popover 内容控制在 2-5 句。不要使用 script；不要返回 title 属性作为唯一解释。

当前选区：
label: ${request.selection.label}
componentId: ${request.selection.componentId ?? "unknown"}
data-ai-id: ${request.selection.aiId ?? "none"}
tagName: ${request.selection.tagName}

selectedHtml:
${request.selection.selectedHtml}

轻量文档 HTML 上下文（可能只包含标题、目录、相邻片段，不是整页）：
${request.document.html.slice(0, 20000)}

相关 CSS 上下文（已压缩）：
${request.document.css.slice(0, 8000)}

用户指令：
${request.instruction}`;
}
