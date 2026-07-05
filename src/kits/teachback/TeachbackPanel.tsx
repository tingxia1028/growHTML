// Teach-back runner panel (PRO-2, proactive-learning.md §2 — the flagship "AI 装不懂"
// Feynman experience). A registered VIEW (registerView, the ReviewPanel.tsx:769
// precedent — the `views` kit sink is a dead phase-3 collector), shell-imported for its
// side effect. It is deliberately a COMPOSITION of existing organs:
//   session   — the pure teachbackSession reducer owns phases + the round cap; the panel
//               only fires actions as AI/student turns arrive (no logic in the view).
//   AI        — the STRUCTURED seam via teachbackIo (mock echoes each prompt's
//               mockContent, so the drive is deterministic across turns). profileContext
//               is appended in pose/probe input → auto-gated server-side. NO chat route.
//   render    — the wrap-up + turns display through getNoteType(contentType).render (the
//               ONE adaptive-note contract) — no bespoke path.
//   persist   — the wrap-up rides ctx.dispatch("anchor.add-note", {teachback.summary})
//               (the adaptive-note contract) + ONE recordMemoryEvent("note.review", _,
//               {mode:"teach"}) — mode is free payload (memory.ts), the closed verb enum
//               untouched.
//   topics    — weakReviewBuckets (via pickTopics); empty → the delta-5 empty state.

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { GraduationCap } from "lucide-react";
import { registerView, type WorkspaceContext } from "../../client/workspace/viewRegistry";
import { getNoteType } from "../../client/notes/noteTypeRegistry";
import { recordMemoryEvent } from "../../client/memory/capture";
import { buildProfileContext } from "../../core/memory/profileContext";
import { defineMessages, t, useLocale } from "../../client/i18n";
import { posePrompt, probePrompt, wrapupPrompt } from "./prompts";
import type { TeachbackSummaryContent } from "./contentTypes";
import { getTeachbackIo } from "./teachbackIo";
import {
  initialSession,
  openGaps,
  pickTopics,
  studentPoints,
  teachbackReducer
} from "./teachbackSession";
import "./teachback.css";

const messages = defineMessages({
  panelTitle: { zh: "教回", en: "Teach-back" },
  loading: { zh: "加载中…", en: "Loading…" },
  emptyTitle: { zh: "还没有可教回的主题", en: "Nothing to teach back yet" },
  emptyHint: { zh: "先复习几道题,弱项出现后就能开始教回。", en: "Review a few items first — weak spots unlock teach-back." },
  pickPrompt: { zh: "选一个主题,讲给装不懂的 AI 听:", en: "Pick a topic to teach the confused AI:" },
  posing: { zh: "AI 正在想问题…", en: "The AI is thinking of a question…" },
  probing: { zh: "AI 正在追问…", en: "The AI is asking a follow-up…" },
  wrapping: { zh: "正在总结…", en: "Wrapping up…" },
  explainPlaceholder: { zh: "把你的理解讲清楚…", en: "Explain it in your own words…" },
  submit: { zh: "讲给它听", en: "Explain" },
  endEarly: { zh: "讲完了,总结", en: "Done — wrap up" },
  saveSummary: { zh: "存为小结", en: "Save summary" },
  saved: { zh: "已存为小结", en: "Saved" },
  restart: { zh: "再教一个", en: "Teach another" },
  aiTurn: { zh: "AI", en: "AI" },
  studentTurn: { zh: "我", en: "Me" },
  error: { zh: "生成失败,稍后再试。", en: "Generation failed, try again." }
});

/** Coerce the structured generate output into a turn text (defensive — mock is exact). */
function turnFrom(content: unknown): { text: string; topic: string; round: number; kind: "pose" | "probe" } {
  const c = (content ?? {}) as Partial<{ text: string; topic: string; round: number; kind: string }>;
  return {
    text: typeof c.text === "string" ? c.text : "",
    topic: typeof c.topic === "string" ? c.topic : "",
    round: typeof c.round === "number" ? c.round : 0,
    kind: c.kind === "probe" ? "probe" : "pose"
  };
}

export function TeachbackPanel({ ctx }: { ctx: WorkspaceContext }) {
  useLocale(); // subscribe so the panel re-renders on a locale switch (t() reads module state)
  const [session, dispatch] = useReducer(teachbackReducer, undefined, initialSession);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [aiError, setAiError] = useState("");
  const [saved, setSaved] = useState(false);
  // profileContext is fetched once at load and woven into pose/probe (auto-gated).
  const profileRef = useRef<string | undefined>(undefined);
  // The weakest bucket name (the probe's steer target) — first weak topic.
  const weakestRef = useRef<string>("");

  // Load a session: fetch digests + profile, derive topics, seed the reducer. Degrades
  // to the empty state on any failure (the reviewIo law). Only mount / restart rebuilds.
  const load = useCallback(async () => {
    setLoading(true);
    setAiError("");
    setSaved(false);
    setDraft("");
    try {
      const io = getTeachbackIo();
      const [summaries, facts] = await Promise.all([io.fetchDigestSummaries(), io.fetchProfileFacts()]);
      const topics = pickTopics(summaries);
      profileRef.current = buildProfileContext(facts) || undefined;
      weakestRef.current = topics[0] ?? "";
      dispatch({ type: "init", topics });
    } catch {
      dispatch({ type: "init", topics: [] });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Pick a topic → generate the opening pose (teach.pose).
  const pick = async (topic: string) => {
    if (busy) return;
    dispatch({ type: "pick", topic });
    setBusy(true);
    setAiError("");
    try {
      const { content } = await getTeachbackIo().generate({
        promptId: posePrompt.id,
        contentType: posePrompt.outputType,
        input: { topic, ...(profileRef.current ? { profileContext: profileRef.current } : {}) }
      });
      const turn = turnFrom(content);
      dispatch({
        type: "posed",
        turn: { role: "ai", kind: "pose", text: turn.text, topic: turn.topic || topic, round: 0 }
      });
    } catch {
      setAiError(t(messages.error));
    } finally {
      setBusy(false);
    }
  };

  // Submit the student's explanation → the reducer advances (probing or assessing). When
  // it lands in probing, generate the next probe; when it lands in assessing, wrap up.
  const submitExplanation = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    // Compute the next state synchronously so we know whether to probe or wrap up.
    const afterExplain = teachbackReducer(session, { type: "explain", text });
    dispatch({ type: "explain", text });
    if (afterExplain.phase === "assessing") {
      await wrapUp(afterExplain);
    } else if (afterExplain.phase === "probing") {
      await probe(afterExplain, text);
    }
  };

  // Generate the AI's follow-up probe (teach.probe), steered to the weakest topic.
  const probe = async (state: typeof session, lastExplanation: string) => {
    setBusy(true);
    setAiError("");
    try {
      const transcript = state.turns.map((turnItem) => `${turnItem.role}: ${turnItem.text}`).join("\n");
      const { content } = await getTeachbackIo().generate({
        promptId: probePrompt.id,
        contentType: probePrompt.outputType,
        input: {
          topic: state.topic,
          lastExplanation,
          transcript,
          weakestTopic: weakestRef.current || state.topic,
          round: state.round,
          ...(profileRef.current ? { profileContext: profileRef.current } : {})
        }
      });
      const turn = turnFrom(content);
      dispatch({
        type: "probed",
        turn: { role: "ai", kind: "probe", text: turn.text, topic: state.topic, round: state.round }
      });
    } catch {
      setAiError(t(messages.error));
    } finally {
      setBusy(false);
    }
  };

  // End early (from explaining/probing) → assess + wrap up.
  const endEarly = async () => {
    if (busy) return;
    const afterEnd = teachbackReducer(session, { type: "end" });
    dispatch({ type: "end" });
    if (afterEnd.phase === "assessing") await wrapUp(afterEnd);
  };

  // Assemble the wrap-up summary (teach.wrapup) over the completed transcript.
  const wrapUp = async (state: typeof session) => {
    setBusy(true);
    setAiError("");
    try {
      const transcript = state.turns.map((turnItem) => `${turnItem.role}: ${turnItem.text}`).join("\n");
      const { content } = await getTeachbackIo().generate({
        promptId: wrapupPrompt.id,
        contentType: wrapupPrompt.outputType,
        input: {
          topic: state.topic,
          transcript,
          turns: state.turns,
          studentPoints: studentPoints(state),
          openGaps: openGaps(state)
        }
      });
      const summary = asSummary(content, state.topic, state.turns);
      dispatch({ type: "wrapped", summary });
    } catch {
      setAiError(t(messages.error));
    } finally {
      setBusy(false);
    }
  };

  // Persist the wrap-up: ONE anchor.add-note (adaptive-note contract) + ONE memory event
  // (note.review, mode:"teach"). Fire-once (the button disables after save).
  const saveSummary = () => {
    if (!session.wrapUp || saved) return;
    setSaved(true);
    void ctx.dispatch("anchor.add-note", {
      contentType: "teachback.summary",
      content: session.wrapUp,
      anchorIds: []
    });
    recordMemoryEvent(
      "note.review",
      { contentType: "teachback.summary" },
      { mode: "teach", topic: session.wrapUp.topic }
    );
  };

  const busyLabel =
    session.phase === "posing"
      ? t(messages.posing)
      : session.phase === "probing"
        ? t(messages.probing)
        : session.phase === "assessing"
          ? t(messages.wrapping)
          : "";

  return (
    <aside className="teachback-panel" data-phase={session.phase}>
      <div className="panel-title">
        <GraduationCap size={16} />
        {t(messages.panelTitle)}
      </div>

      {aiError ? <div className="teachback-error">{aiError}</div> : null}

      {loading ? (
        <div className="teachback-loading">{t(messages.loading)}</div>
      ) : session.phase === "empty" ? (
        // Delta 5: the graceful empty-topic state (a fresh vault, weakReviewBuckets []).
        <div className="empty-state teachback-empty">
          <p className="teachback-empty-title">{t(messages.emptyTitle)}</p>
          <p className="teachback-empty-hint">
            {t(messages.emptyTitle)} · {t(messages.emptyHint)}
          </p>
        </div>
      ) : session.phase === "picking" ? (
        <div className="teachback-pick">
          <p className="teachback-pick-prompt">{t(messages.pickPrompt)}</p>
          <div className="teachback-topics">
            {session.topics.map((topic) => (
              <button
                key={topic}
                type="button"
                className="teachback-topic-btn"
                disabled={busy}
                onClick={() => void pick(topic)}
              >
                {topic}
              </button>
            ))}
          </div>
        </div>
      ) : session.phase === "done" && session.wrapUp ? (
        <section className="teachback-summary">
          <SummaryView summary={session.wrapUp} />
          <div className="teachback-actions">
            <button type="button" className="teachback-btn teachback-save-btn" disabled={saved} onClick={saveSummary}>
              {saved ? t(messages.saved) : t(messages.saveSummary)}
            </button>
            <button type="button" className="teachback-btn teachback-restart-btn" onClick={() => void load()}>
              {t(messages.restart)}
            </button>
          </div>
        </section>
      ) : (
        <section className="teachback-run" aria-busy={busy}>
          <ul className="teachback-transcript">
            {session.turns.map((turnItem, i) => (
              <li key={i} className={`teachback-turn teachback-turn-${turnItem.role}`}>
                <span className="teachback-turn-role">
                  {turnItem.role === "ai" ? t(messages.aiTurn) : t(messages.studentTurn)}
                </span>
                <span className="teachback-turn-text">{turnItem.text}</span>
              </li>
            ))}
          </ul>

          {busy ? <div className="teachback-busy">{busyLabel}</div> : null}

          {session.phase === "explaining" && !busy ? (
            <div className="teachback-explain">
              <textarea
                className="teachback-explain-input"
                placeholder={t(messages.explainPlaceholder)}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <div className="teachback-actions">
                <button
                  type="button"
                  className="teachback-btn teachback-primary teachback-submit-btn"
                  disabled={!draft.trim()}
                  onClick={() => void submitExplanation()}
                >
                  {t(messages.submit)}
                </button>
                <button
                  type="button"
                  className="teachback-btn teachback-end-btn"
                  onClick={() => void endEarly()}
                >
                  {t(messages.endEarly)}
                </button>
              </div>
            </div>
          ) : null}
        </section>
      )}
    </aside>
  );
}

// Coerce the wrap-up generate output into a valid TeachbackSummaryContent, ALWAYS
// carrying the session's real topic + transcript (defensive — the mock is exact).
function asSummary(content: unknown, topic: string, turns: TeachbackSummaryContent["transcript"]): TeachbackSummaryContent {
  const c = (content ?? {}) as Partial<TeachbackSummaryContent>;
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x ?? "")) : []);
  return {
    topic: typeof c.topic === "string" && c.topic ? c.topic : topic,
    explainedWell: strings(c.explainedWell),
    gaps: strings(c.gaps),
    summary: typeof c.summary === "string" ? c.summary : "",
    transcript: Array.isArray(c.transcript) && c.transcript.length ? (c.transcript as typeof turns) : turns
  };
}

// The summary displays through the ONE adaptive-note contract (getNoteType.render), never
// a bespoke path — mode "full" is the Center-View presentation.
function SummaryView({ summary }: { summary: TeachbackSummaryContent }) {
  const plugin = getNoteType("teachback.summary");
  if (!plugin) return <pre className="teachback-inert">{JSON.stringify(summary, null, 2)}</pre>;
  return <>{plugin.render({ content: summary, mode: "full" })}</>;
}

registerView({ kind: "teachback.panel", render: (_node, ctx) => <TeachbackPanel ctx={ctx} /> });
