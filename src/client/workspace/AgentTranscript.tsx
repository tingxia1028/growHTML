// AgentTranscript — the A4b render surface for a runAgent turn. It reads the pure
// AgentTurnState (agentTurnReducer.ts) the WorkspaceContext accumulates from the agent
// SSE and shows it as a small transcript: streamed text bubbles + collapsible tool
// CARDS (one per tool call). It is render-only — the persisted assistant turn is the
// normal chat log; this transcript never reaches export/history (only done.message
// does, via the WorkspaceContext seam).
//
// Text items render through the SAME ChatMessageBody path an assistant reply uses, so
// a markdown/rich answer looks identical to a normal reply. Tool cards collapse to
// `🛠 {toolName}` + a state glyph; expanding reveals the args + result, pretty-printed
// when the raw JSON parses and shown verbatim (with a 截断 badge) when it doesn't
// (DELTA 3 — a truncated >4000-char payload never parses).

import { useState } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronRight, Loader2, Wrench } from "lucide-react";
import { ChatMessageBody } from "./ChatMessageBody";
import type { AgentTranscriptItem, AgentTurnState } from "./agentTurnReducer";
import "./agentTranscript.css";

/** A friendly one-liner for the three known read-only tools; falls back to the name. */
function toolSummary(item: Extract<AgentTranscriptItem, { kind: "tool" }>): string {
  const args = item.args as Record<string, unknown> | undefined;
  switch (item.toolName) {
    case "search_notes":
      return typeof args?.query === "string" ? `搜索笔记 “${args.query}”` : "搜索笔记";
    case "get_source":
      return typeof args?.sourceId === "string" ? `读取来源 ${args.sourceId}` : "读取来源";
    case "list_anchors":
      return typeof args?.sourceId === "string" ? `列出锚点 ${args.sourceId}` : "列出锚点";
    default:
      return item.toolName;
  }
}

/** Pretty-print a raw JSON string when it parses; else return it verbatim. */
function prettyOrRaw(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function ToolCard({ item }: { item: Extract<AgentTranscriptItem, { kind: "tool" }> }) {
  const [open, setOpen] = useState(false);
  const glyph =
    item.state === "calling" ? (
      <Loader2 size={13} className="spin agent-tool-glyph" aria-label="运行中" />
    ) : item.state === "error" ? (
      <AlertTriangle size={13} className="agent-tool-glyph agent-tool-glyph-error" aria-label="错误" />
    ) : (
      <Check size={13} className="agent-tool-glyph agent-tool-glyph-done" aria-label="完成" />
    );

  return (
    <div className={`agent-tool-card agent-tool-${item.state}`} data-tool={item.toolName}>
      <button
        type="button"
        className="agent-tool-head"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Wrench size={13} className="agent-tool-icon" />
        <span className="agent-tool-name">{toolSummary(item)}</span>
        {item.truncated ? <span className="agent-tool-truncated">…(截断)</span> : null}
        <span className="agent-tool-state">{glyph}</span>
      </button>
      {open ? (
        <div className="agent-tool-body">
          <div className="agent-tool-section">
            <span className="agent-tool-label">参数</span>
            <pre className="agent-tool-json">{prettyOrRaw(item.argsRaw)}</pre>
          </div>
          {item.error ? (
            <div className="agent-tool-section">
              <span className="agent-tool-label">错误</span>
              <pre className="agent-tool-json agent-tool-json-error">{item.error}</pre>
            </div>
          ) : item.resultRaw !== undefined ? (
            <div className="agent-tool-section">
              <span className="agent-tool-label">结果</span>
              <pre className="agent-tool-json">{prettyOrRaw(item.resultRaw)}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function AgentTranscript({ turn }: { turn: AgentTurnState | null }) {
  if (!turn) return null;
  return (
    <div className="agent-transcript" role="log" aria-live="polite">
      {turn.items.map((item, index) =>
        item.kind === "tool" ? (
          <ToolCard key={item.id || index} item={item} />
        ) : (
          <div key={index} className="agent-transcript-text">
            <ChatMessageBody role="assistant" content={item.content} />
          </div>
        )
      )}
      {/* Running tail: after the last tool settles but before the final answer streams,
          show a spinner so the turn never looks frozen. */}
      {turn.status === "running" ? (
        <div className="agent-transcript-running" role="status" aria-live="polite">
          <Loader2 size={13} className="spin" />
          <span>AI 正在使用工具…</span>
        </div>
      ) : null}
      {turn.status === "error" ? (
        <div className="agent-transcript-error" role="alert">
          <AlertTriangle size={13} />
          <span>{turn.error ?? "工具调用失败"}</span>
        </div>
      ) : null}
    </div>
  );
}
