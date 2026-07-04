# Proactive Learning — 主动学习引擎(触发器)+ 口语/教回 kit(AI 装不懂)

The fourth rung of the kernel's AI-native ladder (克制的主动性), expanded per the user
(2026-07-02): scheduled tasks / hooks TRIGGER the AI to push learning — 英语口语对话, AI 装不懂
listening to YOUR explanation (Feynman teach-back), AI 主动带你复习. Mechanism = core trigger
organ; experiences = plugins. Grounded 2026-07-02.

## 1. The trigger organ (PRO-1, core mechanism — passes the law as operation-data extension)
```ts
trigger = { id, kind: "schedule" | "event", spec, actionRef, enabled, constraints }
// schedule: {cron-lite: daily@19:00, spaced: fromMemoryRecency}   — node timers, the MEM-2
//           idle-scheduler pattern already in server/memory.ts
// event:    hooks over what EXISTS: memory-event stream (N mistakes accumulated, streak-about-
//           to-break = no events today by 20:00), app lifecycle (open, source-close-after-Nmin)
// actionRef: an operation/command id (operations-as-data — behaviors stay DATA, plugin-registered
//           + user-editable in the manager, same as everything else)
```
**克制 constraints are FIRST-CLASS, not polish** (the kernel's word was "restrained"):
opt-in per trigger family; quiet hours; daily cap (default 2 nudges); one-tap 关掉这类;
every nudge shows WHY it fired (the queue-reason principle: "5 张浮力卡到期 · 你 19:00 常复习");
snooze. Delivery: a 今日学习 nudge card (center/rail surface, clean files) + desktop
`new Notification()` (renderer API works in Electron; mobile = X2 local notifications).
**Exemplar shipped with PRO-1: 主动复习推动** — spaced trigger → "该复习了" → one tap deep-links
the review runner pre-filtered (REV queue + weak buckets already exist; this is wiring).

## 2. 教回/口语 kit (PRO-2, the flagship experience — its own runner-style panel, NOT views.tsx)
- **费曼模式(AI 装不懂):** AI plays a curious/confused student on a topic from YOUR notes:
  "为什么浮力只跟排开的水有关?第二步我没听懂…" — you explain; the AI probes EXACTLY where
  your profile says you're shaky (MEM-3 profileContext steering the confusion, not random);
  wrap-up = what you explained well / what you dodged → a summary note (declared form) +
  memory events (note.review with mode:"teach" — mode is payload, the closed verb enum is
  untouched). Teaching is the strongest learning mode; the AI's ignorance is the product.
- **英语口语对话:** roleplay partner; daily topic seeded from your subject.vocab notes (the
  words you're learning become the conversation); AI keeps to your level (profile), plays dumb
  to force rephrasing, gentle corrections at the end (not mid-flow). Voice rides SPEECH-1/2
  lanes (TTS reads AI turns, STT takes yours, transcript-confirm) — **text mode ships FIRST**
  (valuable typed, no speech dependency; voice lights up when SPEECH lands).
- Both are kit-registered experiences: a panel (runner idiom), operations (data), triggers
  (daily 口语 at your active hour), types (conversation-summary rides markdown/declared forms).

## 3. More modes (PRO-3, later, all data-registered)
睡前 3 问 (bedtime micro-quiz from today's anchors) · streak protection · 三天没碰物理 nudge ·
pre-class preview (needs calendar — defer). Spaced-repetition upgrade of the schedule spec
feeds back into the REV queue policy (the swappable-policy seam).

## 4. Phasing
- **PRO-1 ✅ SHIPPED (PRO1-001, 2026-07-05, client-centric).** Trigger organ (core `trigger` entity in `triggers.jsonl` + pure `evaluateTrigger`, constraints first-class) + client tick + NudgeToast + desktop Notification + the review-push exemplar with a new-user arming guard. **Trimmed to `when:schedule` + `actionRef:navigate`** (event/operation schema-defined but evaluator-rejected). **No server scheduler** — the client ticks while the app runs; the pure evaluator is called client-side with the REAL LOCAL clock (fixes the timezone bug: the codebase is 100% UTC); fire is recorded on SURFACE not on candidate; due-signal is client-computed (`reviewDueStats`). Background/closed-app + OS/mobile push = PRO-3.
- ~~**PRO-1** trigger engine (schedule+event, constraints first-class) + nudge surface +
  desktop notification + the review-push exemplar. Clean files; scheduler pattern exists.~~
- **PRO-2** 教回/口语 kit text-first (panel + operations + wrap-up note + memory) →
  voice via SPEECH lanes when they land.
- **PRO-3** more modes + spaced scheduling + X2 mobile notifications.

## 5. Tests
Trigger firing matrix (schedule/event/quiet-hours/cap/snooze/disabled — clock injected, the
digest-scheduler test idiom); nudge explainability (reason string present); review deep-link
lands filtered; teach-back flow jsdom (probe uses profile fixture, wrap-up dispatches declared
form, memory event mode:"teach"); vocab-seeded topic (fixture vocab notes → conversation seed);
caps never exceeded across trigger families (property-ish test).
