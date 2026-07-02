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
import { setMemoryCaptureEnabled } from "../memory/capture";
import { registerView } from "../workspace/viewRegistry";
import { getProfileIo } from "./profileIo";

const KIND_LABEL: Record<ProfileFactView["kind"], string> = {
  weak: "弱项",
  activity: "活跃",
  top: "常用"
};

const DIMENSION_LABEL: Record<MemoryDimensionSummary["dimension"], string> = {
  subject: "学科",
  contentType: "类型",
  sourceId: "来源"
};

const percent = (ratio: number) => `${Math.round(ratio * 100)}%`;

export function ProfilePanel() {
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
      setError(loadError instanceof Error ? loadError.message : "加载画像失败");
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
      setError(saveError instanceof Error ? saveError.message : "保存画像修改失败");
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
      setError(saveError instanceof Error ? saveError.message : "更新记录开关失败");
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
      setError(consolidateError instanceof Error ? consolidateError.message : "汇总失败");
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
      setError(clearError instanceof Error ? clearError.message : "清除记忆失败");
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
          {KIND_LABEL[fact.kind]}
        </span>
        <span className="profile-fact-title">{fact.title}</span>
        {fact.pinned ? <span className="profile-fact-pin">已置顶</span> : null}
      </div>
      <div className="profile-fact-value">{fact.value}</div>
      {fact.note ? <div className="profile-fact-note">我的更正:{fact.note}</div> : null}
      {noteDraft?.key === fact.key ? (
        <div className="profile-note-edit">
          <input
            className="profile-note-input"
            placeholder="更正这条画像…"
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
            保存
          </button>
          <button type="button" className="profile-btn" onClick={() => setNoteDraft(null)}>
            取消
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
              恢复
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
                {fact.pinned ? "取消置顶" : "置顶"}
              </button>
              <button
                type="button"
                className="profile-btn profile-hide-btn"
                disabled={busy}
                onClick={() => void patchOverride(fact.key, { hidden: true })}
              >
                隐藏
              </button>
              <button
                type="button"
                className="profile-btn profile-correct-btn"
                disabled={busy}
                onClick={() => setNoteDraft({ key: fact.key, text: fact.note ?? "" })}
              >
                修正
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
        <h4 className="profile-subhead">{DIMENSION_LABEL[dimension]}</h4>
        <ul className="profile-dimension-list">
          {cells.map((cell) => (
            <li key={cell.bucket} className="profile-dimension-row" data-bucket={cell.bucket}>
              <span className="profile-dimension-bucket">{cell.bucket}</span>
              <span className="profile-dimension-count">×{cell.events}</span>
              {cell.review.attempts > 0 ? (
                <span className="profile-fail" title={`${cell.review.fail}/${cell.review.attempts} 次未过`}>
                  <span className="profile-bar" aria-hidden="true">
                    <span className="profile-bar-fill" style={{ width: percent(cell.review.failRatio) }} />
                  </span>
                  <span className="profile-fail-label">错误率 {percent(cell.review.failRatio)}</span>
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
        画像
      </div>

      {error ? <div className="profile-error">{error}</div> : null}
      {meta && !meta.captureEnabled ? (
        <div className="profile-capture-off">行为记录已关闭 — 现有记忆仍可查看、编辑和清除。</div>
      ) : null}

      {profile === null ? (
        <div className="profile-loading">加载中…</div>
      ) : (
        <>
          <section className="profile-section profile-facts-section">
            <h3 className="profile-head">记忆画像</h3>
            {visibleFacts.length === 0 ? (
              <div className="empty-state profile-empty">
                暂无画像事实 — 随着阅读、记笔记和复习的积累,这里会自动总结出弱项、活跃度和常用习惯。
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
                  已隐藏 {hiddenFacts.length} 条{showHidden ? "(收起)" : "(展开)"}
                </button>
                {showHidden ? <ul className="profile-fact-list profile-fact-list-hidden">{hiddenFacts.map(factRow)}</ul> : null}
              </div>
            ) : null}
          </section>

          <section className="profile-section profile-digest-section">
            <h3 className="profile-head">学习摘要</h3>
            {summary && summary.overall.events > 0 ? (
              <>
                <p className="profile-activity">
                  共 {summary.overall.events} 次行为 · {summary.overall.activeDays.length} 个活跃日 · 连续{" "}
                  {summary.overall.streakDays} 天
                  {summary.overall.lastActiveAt ? ` · 最近 ${summary.overall.lastActiveAt.slice(0, 10)}` : ""}
                </p>
                {dimensionGroup("subject")}
                {dimensionGroup("contentType")}
                {dimensionGroup("sourceId")}
              </>
            ) : (
              <div className="empty-state profile-empty">暂无摘要数据。</div>
            )}
          </section>

          <section className="profile-section profile-manage-section">
            <h3 className="profile-head">记忆管理</h3>
            <label className="profile-capture-switch">
              <input
                type="checkbox"
                checked={meta?.captureEnabled ?? true}
                disabled={busy}
                onChange={(event) => void toggleCapture(event.target.checked)}
              />
              记录学习行为(本地,永不导出)
            </label>
            <div className="profile-manage-actions">
              <button type="button" className="profile-btn profile-consolidate-btn" disabled={busy} onClick={() => void consolidateNow()}>
                立即汇总
              </button>
              {confirmingClear ? (
                <span className="profile-clear-confirm">
                  确认清除全部记忆?
                  <button type="button" className="profile-btn profile-clear-yes-btn" disabled={busy} onClick={() => void clearAll()}>
                    确认清除
                  </button>
                  <button type="button" className="profile-btn" onClick={() => setConfirmingClear(false)}>
                    取消
                  </button>
                </span>
              ) : (
                <button type="button" className="profile-btn profile-clear-btn" disabled={busy} onClick={() => setConfirmingClear(true)}>
                  清除记忆
                </button>
              )}
            </div>
            <p className="profile-retention">
              原始行为事件保留 {meta?.retention.rawEventDays ?? 14} 天(汇总后自动清理);摘要保留约{" "}
              {Math.round((meta?.retention.digestDays ?? 365) / 30)} 个月;画像长期保留,可随时编辑或清除。
              {meta ? ` 当前:${meta.events} 条原始事件 / ${meta.rows} 条摘要` : ""}
              {meta?.consolidatedAt ? `,上次汇总 ${meta.consolidatedAt.slice(0, 16).replace("T", " ")}` : ""}。
            </p>
          </section>
        </>
      )}
    </aside>
  );
}

registerView({ kind: "profile.panel", render: () => <ProfilePanel /> });
