// NudgeToast (PRO-1, proactive-learning §1) — the PRIMARY nudge surface. Clones the
// DraftNoteToast host-chrome idiom (a <body> portal, mounted once in WorkspaceShell beside
// DraftNoteToast) and shows the pending nudge the proactive tick raised: its REASON (every
// nudge must show WHY it fired — the queue-reason principle), a primary "去复习" that
// deep-links the trigger's target via navigateShell, and 稍后再说 / 关闭 controls that POST
// snooze / dismiss and clear the toast.
//
// DESKTOP NOTIFICATION (build-spec delta #6): the toast is the primary surface; the OS
// `new Notification(reason)` is only an ENHANCEMENT, raised ONLY when the window is hidden
// AND Notification.permission === "granted". We requestPermission() ONCE lazily; while it
// is "default" or "denied" the toast still shows (nothing is lost) — the notification just
// doesn't escalate. The gate lives here so the tick stays headless-safe.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, Clock, X } from "lucide-react";
import { triggerIo } from "./triggerIo";
import { navigateShell } from "./shellNav";
import { getPlatformOptional } from "../platform/platformSingleton";
import { clearNudge, subscribeNudge, type PendingNudge } from "./nudgeStore";
import { isHidden } from "./idleSignal";
import { nudgeMessages } from "./nudgeMessages";
import { t } from "../i18n";
import "./nudge.css";

/** How long 稍后再说 silences a trigger (3h — one minGap window; conservative). */
const SNOOZE_MS = 3 * 60 * 60_000;

/**
 * Escalate a nudge to a desktop Notification IFF the window is hidden AND permission is
 * granted (delta #6). Requests permission once when it is still "default". Never throws
 * (Notification is absent in jsdom/older shells) — the toast is the guaranteed surface.
 */
export function maybeNotify(nudge: PendingNudge): boolean {
  // Capability gate for the OS Notification API; the new Notification() call below is
  // unchanged. Fallback mirrors the old direct `typeof Notification` feature-detect.
  const notificationAvailable =
    getPlatformOptional()?.capabilities.notification ??
    typeof Notification !== "undefined";
  if (!notificationAvailable) return false;
  if (!isHidden()) return false; // only escalate when the user isn't looking at the app
  if (Notification.permission === "granted") {
    try {
      new Notification(nudge.reason);
      return true;
    } catch {
      return false;
    }
  }
  if (Notification.permission === "default") {
    // Ask once; a later hidden+granted nudge will escalate. Fire-and-forget.
    void Notification.requestPermission().catch(() => undefined);
  }
  return false; // "denied" / just-requested ⇒ toast only
}

export function NudgeToast() {
  const [nudge, setNudge] = useState<PendingNudge | null>(null);

  useEffect(() => subscribeNudge(setNudge), []);

  // When a nudge lands while the window is hidden + permission granted, mirror it as a
  // desktop notification (the enhancement). The toast renders regardless.
  useEffect(() => {
    if (nudge) maybeNotify(nudge);
  }, [nudge]);

  if (!nudge || typeof document === "undefined") return null;

  const openTarget = () => {
    navigateShell({ type: "pane", kind: nudge.target });
    clearNudge();
  };

  const snooze = () => {
    void triggerIo.snoozeTrigger(nudge.triggerId, Date.now() + SNOOZE_MS).catch(() => undefined);
    clearNudge();
  };

  const dismiss = () => {
    void triggerIo.dismissTrigger(nudge.triggerId).catch(() => undefined);
    clearNudge();
  };

  return createPortal(
    <div className="nudge-toast" role="status">
      <span className="nudge-toast-badge">
        <Bell size={12} />
        {t(nudgeMessages.badge)}
      </span>
      {/* The REASON — the WHY this nudge fired (queue-reason principle). */}
      <button type="button" className="nudge-toast-reason" onClick={openTarget}>
        {nudge.reason}
      </button>
      <button type="button" className="nudge-toast-open" onClick={openTarget}>
        {t(nudgeMessages.open)}
      </button>
      <button type="button" className="nudge-toast-snooze" onClick={snooze} title={t(nudgeMessages.snooze)}>
        <Clock size={13} />
      </button>
      <button
        type="button"
        className="nudge-toast-dismiss"
        aria-label={t(nudgeMessages.dismiss)}
        title={t(nudgeMessages.dismiss)}
        onClick={dismiss}
      >
        <X size={13} />
      </button>
    </div>,
    document.body
  );
}
