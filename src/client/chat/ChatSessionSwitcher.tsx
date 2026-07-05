// ChatSessionSwitcher (ai-workspace.md W1) — the compact session surface INSIDE the
// chat panel's title row: 新对话 + the history list (title · time, select to resume,
// delete with confirm). Renders over the shared PanelMenu popover; all state comes
// through the ONE bundled ChatSessionsApi (the session domain in ./useChatSessions),
// so this component is a pure view — unit-testable with a fake api.

import { History, MessageSquarePlus, Trash2 } from "lucide-react";
import { PanelMenu } from "../workspace/PanelMenu";
import { t } from "../i18n";
import { platformDialogs } from "../platform";
import { chatSessionMessages } from "./chatSessionMessages";
import type { ChatSessionsApi } from "./useChatSessions";
import "./chatSessions.css";

/** Compact list time: today → HH:mm; this year → M/D; else → YYYY/M/D. */
export function formatSessionTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  const monthDay = `${date.getMonth() + 1}/${date.getDate()}`;
  return date.getFullYear() === now.getFullYear() ? monthDay : `${date.getFullYear()}/${monthDay}`;
}

export function ChatSessionSwitcher({ api }: { api: ChatSessionsApi }) {
  const confirmDelete = (title: string) =>
    platformDialogs().confirm(
      `${t(chatSessionMessages.deleteConfirm)}\n${title || t(chatSessionMessages.untitled)}`
    );

  return (
    <div className="chat-session-switcher">
      <PanelMenu label={t(chatSessionMessages.menuLabel)} icon={<History size={15} />} align="right">
        <button
          type="button"
          className="panel-menu-item chat-session-new"
          onClick={() => api.startNew()}
        >
          <MessageSquarePlus size={14} />
          {t(chatSessionMessages.newConversation)}
        </button>
        <div className="panel-menu-sep" />
        <div className="panel-menu-label">{t(chatSessionMessages.historyLabel)}</div>
        {api.list.length === 0 ? (
          <div className="chat-session-empty">{t(chatSessionMessages.empty)}</div>
        ) : (
          <div className="chat-session-list">
            {api.list.map((session) => {
              const title = session.title || t(chatSessionMessages.untitled);
              return (
                <div
                  key={session.id}
                  className={`chat-session-row${session.id === api.activeId ? " active" : ""}`}
                  data-session-id={session.id}
                >
                  {/* .panel-menu-item → PanelMenu closes after a resume click. */}
                  <button
                    type="button"
                    className="panel-menu-item chat-session-open"
                    title={title}
                    onClick={() => void api.select(session.id)}
                  >
                    <span className="chat-session-title">{title}</span>
                    <span className="chat-session-time">{formatSessionTime(session.updatedAt)}</span>
                  </button>
                  {/* NOT a .panel-menu-item — the menu stays open while pruning. */}
                  <button
                    type="button"
                    className="chat-session-delete"
                    aria-label={t(chatSessionMessages.deleteAction)}
                    title={t(chatSessionMessages.deleteAction)}
                    onClick={() => {
                      void confirmDelete(session.title).then((ok) => {
                        if (ok) void api.remove(session.id);
                      });
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </PanelMenu>
    </div>
  );
}
