// 错题本 (Mistake Book) — a CORE workspace view (NOT part of the mistake-photo kit)
// that browses/manages EVERY mistake note across all sources in one place, and hands off
// the actual drilling to the existing review runner. It is the "拍错题→复习环" deepening's
// net-new surface: the review LOOP is already closed (a saved mistake with no schedule row
// is due immediately — queue.ts rule 1 + isDueAt(undefined)==true), so this view adds only
// BROWSE (list) · FILTER (mastery/source) · SORT (recency) · EDIT/DELETE · a 复习错题 launch.
//
// It clones the bookmark.list precedent (bookmarkViews.tsx) but CROSS-SOURCE: instead of
// the active source's visible notes, it fetches every note via entityClient.allNotes()
// (the review panel's 全库 read, reviewIo.ts) and filters to the `mistake` CAPABILITY
// (getNoteContentSpec(ct)?.mistake === true) — alias-aware, so legacy `textbook.mistake`
// records are included. Each card renders through getNoteType(ct).render (the NoteListPanel
// idiom); inline edit reuses getNoteType(ct).edit → dispatch("note.edit"); delete →
// dispatch("note.delete"). 复习错题 sets a pending review scope then navigates the review
// runner (reviewScope.ts + navigateShell) — this view NEVER reimplements the drill.
//
// IRON LAW: it talks only through the shared WorkspaceContext (dispatch + sources) + the
// registries; no cross-view coupling. Registered as kind "mistake.book".

import { useEffect, useState } from "react";
import { BookX, Pencil, Play, Trash2 } from "lucide-react";
import { getNoteContentSpec } from "../../core/notes/contentTypes";
import { getNoteType } from "../../client/notes/noteTypeRegistry";
import { entityClient, type NoteRecord } from "../../client/data/entityClient";
import { registerView, type WorkspaceContext } from "../../client/workspace/viewRegistry";
import { navigateShell } from "../../client/workspace/shellNav";
import { setPendingReviewScope } from "../../client/review/reviewScope";
import "./mistakeBook.css";

// The mastery enum is the core mistake spec's own (contentTypes.ts) — "弱项" spans the two
// not-yet-solid buckets (weak + unknown), the rest are self-explanatory.
type MasteryFilter = "all" | "weak" | "improving" | "mastered";

/** A note is a mistake iff its spec (alias-aware) declares the `mistake` capability —
    NEVER a contentType-string check (catches legacy textbook.mistake too). */
function isMistakeNote(note: NoteRecord): boolean {
  return getNoteContentSpec(note.contentType)?.mistake === true;
}

/** The note's mastery, read defensively off its (validated) content. Absent ⇒ "weak"
    (the spec default), so a legacy record without the field still buckets. */
function masteryOf(note: NoteRecord): string {
  const m = (note.content as { mastery?: unknown } | null)?.mastery;
  return typeof m === "string" ? m : "weak";
}

/** createdAt is on the wire (server envelope) even though the client NoteRecord type omits
    it — read it defensively for the recency sort; absent orders last (as ""). */
function createdAtOf(note: NoteRecord): string {
  const c = (note as { createdAt?: unknown }).createdAt;
  return typeof c === "string" ? c : "";
}

function matchesMastery(note: NoteRecord, filter: MasteryFilter): boolean {
  if (filter === "all") return true;
  const m = masteryOf(note);
  if (filter === "weak") return m === "weak" || m === "unknown"; // 弱项 = weak ∪ unknown
  return m === filter;
}

export function MistakeBookView({ ctx }: { ctx: WorkspaceContext }) {
  const { dispatch, sources } = ctx;
  const [notes, setNotes] = useState<NoteRecord[] | null>(null);
  const [mastery, setMastery] = useState<MasteryFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<unknown>(undefined);

  // Cross-source read (the review panel's 全库 edge). Degrade to [] on failure — an
  // empty book is honest; it never breaks the shell.
  useEffect(() => {
    let live = true;
    void entityClient
      .allNotes()
      .then(({ notes: all }) => {
        if (live) setNotes(all);
      })
      .catch(() => {
        if (live) setNotes([]);
      });
    return () => {
      live = false;
    };
  }, []);

  const mistakes = (notes ?? [])
    .filter(isMistakeNote)
    .filter((note) => matchesMastery(note, mastery))
    .filter((note) => sourceFilter === "all" || note.sourceId === sourceFilter)
    .slice()
    .sort((a, b) => createdAtOf(b).localeCompare(createdAtOf(a))); // newest first

  // Sources that actually own a mistake — the source filter only lists the useful ones.
  const mistakeSourceIds = new Set(
    (notes ?? []).filter(isMistakeNote).map((note) => note.sourceId).filter((id): id is string => !!id)
  );
  const sourceOptions = sources.filter((source) => mistakeSourceIds.has(source.id));

  const startEdit = (noteId: string, content: unknown) => {
    setEditingId(noteId);
    setDraft(content);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setDraft(undefined);
  };
  const saveEdit = (noteId: string) => {
    void dispatch("note.edit", { noteId, content: draft });
    cancelEdit();
  };

  // 复习错题 — set the pending scope, then hand off to the existing review runner. No
  // queue-policy change: the queue already assembles mistakes first; the panel filter
  // (Commit 2) just hides the non-mistakes for this scoped session.
  const reviewMistakes = () => {
    setPendingReviewScope("mistakes");
    navigateShell({ type: "pane", kind: "review.panel" });
  };

  const masteryChips: { value: MasteryFilter; label: string }[] = [
    { value: "all", label: "全部" },
    { value: "weak", label: "弱项" },
    { value: "improving", label: "进步中" },
    { value: "mastered", label: "已掌握" }
  ];

  return (
    <aside className="mistake-book">
      <div className="panel-title">
        <BookX size={16} />
        错题本
      </div>

      <div className="mistake-book-toolbar">
        <div className="mistake-book-filters" role="group" aria-label="mastery filter">
          {masteryChips.map((chip) => (
            <button
              key={chip.value}
              type="button"
              className={`mistake-book-chip${mastery === chip.value ? " active" : ""}`}
              aria-pressed={mastery === chip.value}
              onClick={() => setMastery(chip.value)}
            >
              {chip.label}
            </button>
          ))}
        </div>

        {sourceOptions.length > 1 ? (
          <select
            className="mistake-book-select"
            aria-label="source filter"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
          >
            <option value="all">所有来源</option>
            {sourceOptions.map((source) => (
              <option key={source.id} value={source.id}>
                {source.title}
              </option>
            ))}
          </select>
        ) : null}

        <button
          type="button"
          className="mistake-book-launch"
          disabled={mistakes.length === 0}
          onClick={reviewMistakes}
        >
          <Play size={13} />
          复习错题
        </button>
      </div>

      <div className="mistake-book-list record-list">
        {mistakes.map((note) => {
          const contentType = note.contentType;
          const plugin = getNoteType(contentType);
          const editing = editingId === note.id;

          if (editing && plugin) {
            return (
              <div key={note.id} className="mistake-book-item mistake-book-item-editing" data-note-id={note.id}>
                {plugin.edit({ content: draft, onChange: setDraft })}
                <div className="mistake-book-edit-actions">
                  <button type="button" className="mistake-book-edit-save" onClick={() => saveEdit(note.id)}>
                    保存
                  </button>
                  <button type="button" className="mistake-book-edit-cancel" onClick={cancelEdit}>
                    取消
                  </button>
                </div>
              </div>
            );
          }

          return (
            <div key={note.id} className="mistake-book-item" data-note-id={note.id}>
              {plugin ? plugin.render({ content: note.content, note }) : null}
              <div className="mistake-book-item-actions">
                {plugin ? (
                  <button
                    type="button"
                    className="mistake-book-edit note-edit-start"
                    title="编辑错题"
                    aria-label="Edit mistake"
                    onClick={() => startEdit(note.id, note.content)}
                  >
                    <Pencil size={13} />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="mistake-book-delete note-delete"
                  title="删除错题"
                  aria-label="Delete mistake"
                  onClick={() => void dispatch("note.delete", { noteId: note.id })}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          );
        })}
        {notes !== null && mistakes.length === 0 ? (
          <div className="mistake-book-empty">
            {mastery === "all" && sourceFilter === "all"
              ? "还没有错题。拍一道错题,或在阅读时把答错的题存为错题。"
              : "没有符合筛选条件的错题。"}
          </div>
        ) : null}
      </div>
    </aside>
  );
}

registerView({ kind: "mistake.book", render: (_node, ctx) => <MistakeBookView ctx={ctx} /> });
