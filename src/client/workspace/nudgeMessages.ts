// PRO-1 nudge strings — the user-visible text for the proactive-learning nudge toast.
// One typed dictionary so the zh/en pair is enforced by the Message type (mirrors
// draftNoteMessages / conceptMessages). React-free.

import { defineMessages } from "../i18n";

export const nudgeMessages = defineMessages({
  // The small badge on the nudge toast (克制: it announces itself as a gentle suggestion).
  badge: { zh: "提醒", en: "Nudge" },
  // The primary action — deep-links the trigger's target (e.g. the review runner).
  open: { zh: "去复习", en: "Review now" },
  // Silence THIS nudge for a while (writes snoozedUntil).
  snooze: { zh: "稍后再说", en: "Later" },
  dismiss: { zh: "关闭", en: "Dismiss" }
});
