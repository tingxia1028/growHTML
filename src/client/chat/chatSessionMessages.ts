// Every user-visible string of the chat-session switcher (ai-workspace W1) in ONE
// typed dictionary — the zh/en pair is enforced by the Message type. React-free on
// purpose (mirrors conceptMessages.ts / libraryMessages.ts).

import { defineMessages } from "../i18n";

export const chatSessionMessages = defineMessages({
  menuLabel: { zh: "会话", en: "Conversations" },
  newConversation: { zh: "新对话", en: "New conversation" },
  historyLabel: { zh: "历史会话", en: "History" },
  empty: { zh: "还没有历史会话。", en: "No conversations yet." },
  untitled: { zh: "未命名会话", en: "Untitled conversation" },
  deleteAction: { zh: "删除会话", en: "Delete conversation" },
  deleteConfirm: {
    zh: "删除这个会话？其消息记录将被永久移除。",
    en: "Delete this conversation? Its messages will be permanently removed."
  },
  // —— W2 attachments ——
  attachLabel: { zh: "附加来源", en: "Attach source" },
  attachEmpty: { zh: "没有可附加的来源。", en: "No sources to attach." },
  detachAction: { zh: "移除附件", en: "Remove attachment" },
  attachedTitle: { zh: "已附加到本会话", en: "Attached to this conversation" }
});
