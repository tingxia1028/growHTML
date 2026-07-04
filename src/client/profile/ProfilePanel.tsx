// 画像页 (MEM-2, learner-memory.md §5/§6.4) — the registered Profile view, a peer of
// the plugin-manager panel: the user SEES and OWNS their memory. Sections:
//   记忆画像 — deterministic profile facts (recomputed from digests) with the override
//             layer editable in place: 置顶 (pin), 隐藏/恢复 (hide), 修正 (correct) —
//             overrides persist separately and survive every fact recompute.
//   学习摘要 — per-dimension digest breakdowns (学科/类型/来源) as token-styled lists
//             with plain-div fail-ratio bars (no chart lib) + the activity rhythm.
//   记忆管理 — the capture switch (the EXISTING vault-level setting), 立即汇总
//             (POST …/consolidate), 清除记忆 with an inline confirm (wipes every
//             tier), and the retention defaults so nothing is a black box.
// All IO goes through the swappable profileIo seam (entityClient bindings only).
// Registered exactly like review.panel: registerView + a preset node + an IconRail
// entry (WorkspaceShell side-effect-imports this module).

import { useCallback, useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import {
  summarizeMemoryDigests,
  type MemoryDigestSummary,
  type MemoryDimensionSummary
} from "../../core/memory/digest";
import { upsertProfileOverride } from "../../core/memory/profile";
import type { MemoryProfileResponse, ProfileFactView } from "../data/entityClient";
import { defineMessages, t, useLocale, type Locale } from "../i18n";
import { setMemoryCaptureEnabled } from "../memory/capture";
import { registerView } from "../workspace/viewRegistry";
import { getProfileIo } from "./profileIo";

const profileMessages = defineMessages({
  weakKind: { zh: "弱项", en: "Weak" },
  activityKind: { zh: "活跃", en: "Activity" },
  topKind: { zh: "常用", en: "Frequent" },
  subjectDimension: { zh: "学科", en: "Subject" },
  contentTypeDimension: { zh: "类型", en: "Type" },
  sourceDimension: { zh: "来源", en: "Source" },
  loadFailed: { zh: "加载画像失败", en: "Failed to load profile" },
  saveFailed: { zh: "保存画像修改失败", en: "Failed to save profile changes" },
  captureFailed: { zh: "更新记录开关失败", en: "Failed to update capture setting" },
  consolidateFailed: { zh: "汇总失败", en: "Failed to consolidate memory" },
  clearFailed: { zh: "清除记忆失败", en: "Failed to clear memory" },
  pinned: { zh: "已置顶", en: "Pinned" },
  correctionPrefix: { zh: "我的更正:", en: "My correction:" },
  correctionPlaceholder: { zh: "更正这条画像…", en: "Correct this profile fact…" },
  save: { zh: "保存", en: "Save" },
  cancel: { zh: "取消", en: "Cancel" },
  restore: { zh: "恢复", en: "Restore" },
  unpin: { zh: "取消置顶", en: "Unpin" },
  pin: { zh: "置顶", en: "Pin" },
  hide: { zh: "隐藏", en: "Hide" },
  correct: { zh: "修正", en: "Correct" },
  failedAttemptsTitle: { zh: "次未过", en: "failed attempts" },
  failRate: { zh: "错误率", en: "Fail Rate" },
  panelTitle: { zh: "画像", en: "Profile" },
  captureOff: {
    zh: "行为记录已关闭 — 现有记忆仍可查看、编辑和清除。",
    en: "Behavior capture is off. Existing memory can still be viewed, edited, and cleared."
  },
  loading: { zh: "加载中…", en: "Loading…" },
  memoryProfile: { zh: "记忆画像", en: "Memory Profile" },
  emptyFacts: {
    zh: "暂无画像事实 — 随着阅读、记笔记和复习的积累,这里会自动总结出弱项、活跃度和常用习惯。",
    en: "No profile facts yet. Reading, note-taking, and review activity will summarize weak spots, activity, and common habits here."
  },
  hidden: { zh: "已隐藏", en: "Hidden" },
  items: { zh: "条", en: "items" },
  collapse: { zh: "收起", en: "collapse" },
  expand: { zh: "展开", en: "expand" },
  learningSummary: { zh: "学习摘要", en: "Learning Summary" },
  events: { zh: "次行为", en: "events" },
  activeDays: { zh: "个活跃日", en: "active days" },
  streak: { zh: "连续", en: "streak" },
  days: { zh: "天", en: "days" },
  recent: { zh: "最近", en: "recent" },
  noSummary: { zh: "暂无摘要数据。", en: "No summary data yet." },
  memoryManagement: { zh: "记忆管理", en: "Memory Management" },
  captureLearning: { zh: "记录学习行为(本地,永不导出)", en: "Capture learning behavior (local, never exported)" },
  consolidateNow: { zh: "立即汇总", en: "Consolidate Now" },
  clearConfirm: { zh: "确认清除全部记忆?", en: "Clear all memory?" },
  clearConfirmButton: { zh: "确认清除", en: "Clear All" },
  clearMemory: { zh: "清除记忆", en: "Clear Memory" },
  rawEventsPrefix: { zh: "原始行为事件保留", en: "Raw behavior events are kept for" },
  rawEventsSuffix: { zh: "天(汇总后自动清理);摘要保留约", en: "days (auto-cleaned after consolidation); summaries are kept for about" },
  months: { zh: "个月", en: "months" },
  profileRetention: { zh: "画像长期保留,可随时编辑或清除。", en: "Profile facts are kept long-term and can be edited or cleared anytime." },
  currentMeta: { zh: "当前:", en: "Current:" },
  rawEvents: { zh: "条原始事件", en: "raw events" },
  digestRows: { zh: "条摘要", en: "digest rows" },
  lastConsolidated: { zh: "上次汇总", en: "last consolidated" },
  titleWeak: { zh: "弱项", en: "Weak Spot" },
  titleLastActive: { zh: "最近活跃", en: "Last Active" },
  titleStreak: { zh: "连续学习", en: "Learning Streak" },
  titleTopVerbs: { zh: "最常做", en: "Most Frequent Actions" },
  titleTopTypes: { zh: "常用类型", en: "Common Types" },
  reviewFailRate: { zh: "复习错误率", en: "Review fail rate" },
  failed: { zh: "次未过", en: "failed" },
  through: { zh: "至", en: "through" },
  total: { zh: "共", en: "" }
});

const KIND_LABEL: Record<ProfileFactView["kind"], keyof typeof profileMessages> = {
  weak: "weakKind",
  activity: "activityKind",
  top: "topKind"
};

const DIMENSION_LABEL: Record<MemoryDimensionSummary["dimension"], keyof typeof profileMessages> = {
  subject: "subjectDimension",
  contentType: "contentTypeDimension",
  sourceId: "sourceDimension"
};

const percent = (ratio: number) => `${Math.round(ratio * 100)}%`;

function dimensionLabelFromZh(label: string): string {
  if (label === "学科") return t(profileMessages.subjectDimension);
  if (label === "类型") return t(profileMessages.contentTypeDimension);
  if (label === "来源") return t(profileMessages.sourceDimension);
  return label;
}

function factTitle(fact: ProfileFactView, locale: Locale): string {
  if (locale === "zh") return fact.title;
  if (fact.key.startsWith("weak:")) return `${t(profileMessages.titleWeak)}: ${fact.key.split(":").slice(2).join(":")}`;
  if (fact.key === "activity:last-active") return t(profileMessages.titleLastActive);
  if (fact.key === "activity:streak") return t(profileMessages.titleStreak);
  if (fact.key === "top:verbs") return t(profileMessages.titleTopVerbs);
  if (fact.key === "top:content-types") return t(profileMessages.titleTopTypes);
  return fact.title;
}

function factValue(fact: ProfileFactView, locale: Locale): string {
  if (locale === "zh") return fact.value;

  const weakMatch = fact.value.match(/^复习错误率\s+([^(]+)\((\d+)\/(\d+)\s+次未过,([^)]+)\)$/);
  if (weakMatch) {
    const [, ratio, failed, attempts, dimension] = weakMatch;
    return `${t(profileMessages.reviewFailRate)} ${ratio} (${failed}/${attempts} ${t(profileMessages.failed)}, ${dimensionLabelFromZh(dimension)})`;
  }

  const lastActiveMatch = fact.value.match(/^(.+)\(共\s+(\d+)\s+个活跃日,(\d+)\s+次行为\)$/);
  if (lastActiveMatch) {
    const [, day, activeDays, events] = lastActiveMatch;
    return `${day} (${activeDays} ${t(profileMessages.activeDays)}, ${events} ${t(profileMessages.events)})`;
  }

  const streakMatch = fact.value.match(/^(\d+)\s+天\(至\s+(.+)\)$/);
  if (streakMatch) {
    const [, days, day] = streakMatch;
    return `${days} ${Number(days) === 1 ? "day" : t(profileMessages.days)} (${t(profileMessages.through)} ${day})`;
  }

  return fact.value;
}

export function ProfilePanel() {
  const locale = useLocale();
  const [profile, setProfile] = useState<MemoryProfileResponse | null>(null);
  const [summary, setSummary] = useState<MemoryDigestSummary | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [noteDraft, setNoteDraft] = useState<{ key: string; text: string } | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const io = getProfileIo();
      const [nextProfile, digests] = await Promise.all([io.fetchProfile(), io.fetchDigests()]);
      setProfile(nextProfile);
      setSummary(summarizeMemoryDigests(digests.digests));
      // Mirror the vault switch into the local capture queue gate (capture.ts).
      setMemoryCaptureEnabled(nextProfile.digestMeta.captureEnabled);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t(profileMessages.loadFailed));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // One override edit = merge the patch into the stored document, save, reload —
  // the server recomputes facts and re-applies the (surviving) overrides.
  const patchOverride = async (key: string, patch: { pinned?: boolean; hidden?: boolean; note?: string }) => {
    if (!profile || busy) return;
    setBusy(true);
    setError("");
    try {
      await getProfileIo().saveOverrides(upsertProfileOverride(profile.overrides, key, patch));
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t(profileMessages.saveFailed));
    } finally {
      setBusy(false);
    }
  };

  const toggleCapture = async (captureEnabled: boolean) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await getProfileIo().saveSettings({ captureEnabled });
      setMemoryCaptureEnabled(captureEnabled);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t(profileMessages.captureFailed));
    } finally {
      setBusy(false);
    }
  };

  const consolidateNow = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await getProfileIo().consolidate();
      await load();
    } catch (consolidateError) {
      setError(consolidateError instanceof Error ? consolidateError.message : t(profileMessages.consolidateFailed));
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await getProfileIo().clearAll();
      setConfirmingClear(false);
      await load();
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : t(profileMessages.clearFailed));
    } finally {
      setBusy(false);
    }
  };

  const facts = profile?.facts ?? [];
  const visibleFacts = facts.filter((fact) => !fact.hidden);
  const hiddenFacts = facts.filter((fact) => fact.hidden);
  const meta = profile?.digestMeta ?? null;

  const factRow = (fact: ProfileFactView) => (
    <li key={fact.key} className="profile-fact" data-fact-key={fact.key} data-kind={fact.kind}>
      <div className="profile-fact-main">
        <span className="profile-fact-kind" data-kind={fact.kind}>
          {t(profileMessages[KIND_LABEL[fact.kind]])}
        </span>
        <span className="profile-fact-title">{factTitle(fact, locale)}</span>
        {fact.pinned ? <span className="profile-fact-pin">{t(profileMessages.pinned)}</span> : null}
      </div>
      <div className="profile-fact-value">{factValue(fact, locale)}</div>
      {fact.note ? <div className="profile-fact-note">{t(profileMessages.correctionPrefix)}{fact.note}</div> : null}
      {noteDraft?.key === fact.key ? (
        <div className="profile-note-edit">
          <input
            className="profile-note-input"
            placeholder={t(profileMessages.correctionPlaceholder)}
            value={noteDraft.text}
            onChange={(event) => setNoteDraft({ key: fact.key, text: event.target.value })}
          />
          <button
            type="button"
            className="profile-btn profile-note-save-btn"
            disabled={busy}
            onClick={() => {
              const text = noteDraft.text.trim();
              setNoteDraft(null);
              void patchOverride(fact.key, { note: text });
            }}
          >
            {t(profileMessages.save)}
          </button>
          <button type="button" className="profile-btn" onClick={() => setNoteDraft(null)}>
            {t(profileMessages.cancel)}
          </button>
        </div>
      ) : (
        <div className="profile-fact-actions">
          {fact.hidden ? (
            <button
              type="button"
              className="profile-btn profile-restore-btn"
              disabled={busy}
              onClick={() => void patchOverride(fact.key, { hidden: false })}
            >
              {t(profileMessages.restore)}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="profile-btn profile-pin-btn"
                disabled={busy}
                aria-pressed={fact.pinned}
                onClick={() => void patchOverride(fact.key, { pinned: !fact.pinned })}
              >
                {fact.pinned ? t(profileMessages.unpin) : t(profileMessages.pin)}
              </button>
              <button
                type="button"
                className="profile-btn profile-hide-btn"
                disabled={busy}
                onClick={() => void patchOverride(fact.key, { hidden: true })}
              >
                {t(profileMessages.hide)}
              </button>
              <button
                type="button"
                className="profile-btn profile-correct-btn"
                disabled={busy}
                onClick={() => setNoteDraft({ key: fact.key, text: fact.note ?? "" })}
              >
                {t(profileMessages.correct)}
              </button>
            </>
          )}
        </div>
      )}
    </li>
  );

  const dimensionGroup = (dimension: MemoryDimensionSummary["dimension"]) => {
    const cells = (summary?.dimensions ?? []).filter((cell) => cell.dimension === dimension);
    if (cells.length === 0) return null;
    return (
      <div key={dimension} className="profile-dimension" data-dimension={dimension}>
        <h4 className="profile-subhead">{t(profileMessages[DIMENSION_LABEL[dimension]])}</h4>
        <ul className="profile-dimension-list">
          {cells.map((cell) => (
            <li key={cell.bucket} className="profile-dimension-row" data-bucket={cell.bucket}>
              <span className="profile-dimension-bucket">{cell.bucket}</span>
              <span className="profile-dimension-count">×{cell.events}</span>
              {cell.review.attempts > 0 ? (
                <span className="profile-fail" title={`${cell.review.fail}/${cell.review.attempts} ${t(profileMessages.failedAttemptsTitle)}`}>
                  <span className="profile-bar" aria-hidden="true">
                    <span className="profile-bar-fill" style={{ width: percent(cell.review.failRatio) }} />
                  </span>
                  <span className="profile-fail-label">{t(profileMessages.failRate)} {percent(cell.review.failRatio)}</span>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    );
  };

  return (
    <aside className="profile-panel">
      <div className="panel-title">
        <UserRound size={16} />
        {t(profileMessages.panelTitle)}
      </div>

      {error ? <div className="profile-error">{error}</div> : null}
      {meta && !meta.captureEnabled ? (
        <div className="profile-capture-off">{t(profileMessages.captureOff)}</div>
      ) : null}

      {profile === null ? (
        <div className="profile-loading">{t(profileMessages.loading)}</div>
      ) : (
        <>
          <section className="profile-section profile-facts-section">
            <h3 className="profile-head">{t(profileMessages.memoryProfile)}</h3>
            {visibleFacts.length === 0 ? (
              <div className="empty-state profile-empty">
                {t(profileMessages.emptyFacts)}
              </div>
            ) : (
              <ul className="profile-fact-list">{visibleFacts.map(factRow)}</ul>
            )}
            {hiddenFacts.length > 0 ? (
              <div className="profile-hidden-block">
                <button
                  type="button"
                  className="profile-btn profile-hidden-toggle"
                  aria-expanded={showHidden}
                  onClick={() => setShowHidden((value) => !value)}
                >
                  {t(profileMessages.hidden)} {hiddenFacts.length} {t(profileMessages.items)}
                  {showHidden ? `(${t(profileMessages.collapse)})` : `(${t(profileMessages.expand)})`}
                </button>
                {showHidden ? <ul className="profile-fact-list profile-fact-list-hidden">{hiddenFacts.map(factRow)}</ul> : null}
              </div>
            ) : null}
          </section>

          <section className="profile-section profile-digest-section">
            <h3 className="profile-head">{t(profileMessages.learningSummary)}</h3>
            {summary && summary.overall.events > 0 ? (
              <>
                <p className="profile-activity">
                  {locale === "zh"
                    ? `共 ${summary.overall.events} 次行为 · ${summary.overall.activeDays.length} 个活跃日 · 连续 ${summary.overall.streakDays} 天${
                        summary.overall.lastActiveAt ? ` · 最近 ${summary.overall.lastActiveAt.slice(0, 10)}` : ""
                      }`
                    : `${summary.overall.events} ${t(profileMessages.events)} · ${summary.overall.activeDays.length} ${t(profileMessages.activeDays)} · ${t(
                        profileMessages.streak
                      )} ${summary.overall.streakDays} ${summary.overall.streakDays === 1 ? "day" : t(profileMessages.days)}${
                        summary.overall.lastActiveAt ? ` · ${t(profileMessages.recent)} ${summary.overall.lastActiveAt.slice(0, 10)}` : ""
                      }`}
                </p>
                {dimensionGroup("subject")}
                {dimensionGroup("contentType")}
                {dimensionGroup("sourceId")}
              </>
            ) : (
              <div className="empty-state profile-empty">{t(profileMessages.noSummary)}</div>
            )}
          </section>

          <section className="profile-section profile-manage-section">
            <h3 className="profile-head">{t(profileMessages.memoryManagement)}</h3>
            <label className="profile-capture-switch sv-switch-row">
              <span className="sv-switch-copy">{t(profileMessages.captureLearning)}</span>
              <span className="sv-switch">
                <input
                  type="checkbox"
                  className="sv-switch-input"
                  checked={meta?.captureEnabled ?? true}
                  disabled={busy}
                  onChange={(event) => void toggleCapture(event.target.checked)}
                />
                <span className="sv-switch-track" aria-hidden="true" />
              </span>
            </label>
            <div className="profile-manage-actions">
              <button type="button" className="profile-btn profile-consolidate-btn" disabled={busy} onClick={() => void consolidateNow()}>
                {t(profileMessages.consolidateNow)}
              </button>
              {confirmingClear ? (
                <span className="profile-clear-confirm">
                  {t(profileMessages.clearConfirm)}
                  <button type="button" className="profile-btn profile-clear-yes-btn" disabled={busy} onClick={() => void clearAll()}>
                    {t(profileMessages.clearConfirmButton)}
                  </button>
                  <button type="button" className="profile-btn" onClick={() => setConfirmingClear(false)}>
                    {t(profileMessages.cancel)}
                  </button>
                </span>
              ) : (
                <button type="button" className="profile-btn profile-clear-btn" disabled={busy} onClick={() => setConfirmingClear(true)}>
                  {t(profileMessages.clearMemory)}
                </button>
              )}
            </div>
            <p className="profile-retention">
              {t(profileMessages.rawEventsPrefix)} {meta?.retention.rawEventDays ?? 14} {t(profileMessages.rawEventsSuffix)}{" "}
              {Math.round((meta?.retention.digestDays ?? 365) / 30)} {t(profileMessages.months)};{" "}
              {t(profileMessages.profileRetention)}
              {meta ? ` ${t(profileMessages.currentMeta)}${meta.events} ${t(profileMessages.rawEvents)} / ${meta.rows} ${t(profileMessages.digestRows)}` : ""}
              {meta?.consolidatedAt ? `, ${t(profileMessages.lastConsolidated)} ${meta.consolidatedAt.slice(0, 16).replace("T", " ")}` : ""}.
            </p>
          </section>
        </>
      )}
    </aside>
  );
}

registerView({ kind: "profile.panel", render: () => <ProfilePanel /> });
