// ChatAttachments (ai-workspace.md §W2) — the composer's attachment strip + the "+"
// source picker. Renders the session's attached-source chips (each removable) and a
// PanelMenu "+" listing the library sources not yet attached. A PURE view over the
// ChatSessionsApi attachment ops (add/remove/attachments) + a sources list, so it is
// unit-testable with a fake api (mirrors ChatSessionSwitcher). CHAT-ONLY: attaching a
// source feeds the widened ChatContext.sources[] the next ask-ai resolves.

import { Plus, X } from "lucide-react";
import { PanelMenu } from "../workspace/PanelMenu";
import { t } from "../i18n";
import { chatSessionMessages } from "./chatSessionMessages";
import type { ChatSessionsApi } from "./useChatSessions";
import "./chatSessions.css";

/** The minimal source shape the picker needs (id + title). */
export type AttachableSource = { id: string; title: string };

export function ChatAttachments({
  api,
  sources = []
}: {
  api: ChatSessionsApi;
  sources?: AttachableSource[];
}) {
  // Defensive against a legacy/partial api (older fixtures predate the W2 fields).
  const attached = api.attachments ?? [];
  const attachedIds = new Set(attached.map((item) => item.sourceId));
  const titleById = new Map(sources.map((source) => [source.id, source.title]));
  const attachable = sources.filter((source) => !attachedIds.has(source.id));

  return (
    <div className="chat-attachments" aria-label={t(chatSessionMessages.attachedTitle)}>
      {attached.map((attachment) => {
        const title = titleById.get(attachment.sourceId) || attachment.sourceId;
        return (
          <span key={attachment.sourceId} className="chat-attachment-chip" data-source-id={attachment.sourceId}>
            <span className="chat-attachment-title" title={title}>
              {title}
            </span>
            <button
              type="button"
              className="chat-attachment-remove"
              aria-label={t(chatSessionMessages.detachAction)}
              title={t(chatSessionMessages.detachAction)}
              onClick={() => api.removeAttachment(attachment.sourceId)}
            >
              <X size={12} />
            </button>
          </span>
        );
      })}
      <PanelMenu
        label={t(chatSessionMessages.attachLabel)}
        icon={<Plus size={14} />}
        align="left"
        buttonClassName="chat-attachment-add"
      >
        {attachable.length === 0 ? (
          <div className="chat-session-empty">{t(chatSessionMessages.attachEmpty)}</div>
        ) : (
          <div className="chat-attachment-picker">
            {attachable.map((source) => (
              <button
                key={source.id}
                type="button"
                className="panel-menu-item chat-attachment-pick"
                data-source-id={source.id}
                title={source.title}
                onClick={() => api.addAttachment(source.id)}
              >
                {source.title}
              </button>
            ))}
          </div>
        )}
      </PanelMenu>
    </div>
  );
}
