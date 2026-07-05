// Offline-Mock honesty banner strings — the one-line hint shown in the chat surface
// when the ACTIVE AI provider is the offline `mock` (a fresh install with no real
// provider configured). Keyed off entityClient.aiProviders().active.kind === "mock".
// One typed dictionary so the zh/en pair is enforced by the Message type (mirrors
// nudgeMessages / draftNoteMessages). React-free.

import { defineMessages } from "../i18n";

export const offlineMockMessages = defineMessages({
  // The banner line + the settings deep-link (a keyless demo user's replies are
  // placeholder echoes — this states it plainly and points at AI 提供方 settings).
  text: {
    zh: "离线 Mock 模式 · 回答为占位。前往设置接入真实 AI →",
    en: "Offline Mock mode · replies are placeholders. Connect a real AI in Settings →"
  },
  // Accessible label for the dismiss (✕) control.
  dismiss: { zh: "关闭提示", en: "Dismiss hint" }
});
