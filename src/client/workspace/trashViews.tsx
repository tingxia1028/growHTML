// 回收站 view (TRUST-3, docs/design/data-trust.md §3) — the registered trash panel,
// a peer of the plugin-manager/profile panels (the manager-panel idiom): typed
// sections (已删除的文档 / 已删除的笔记), per-item 恢复 / 彻底删除, 清空回收站 with
// the typed confirm phrase (the TRUST-2 import idiom), the retention readout
// ("保留 30 天" — the server's number), and an empty state. Reached from the
// UserMenu 数据 group (no IconRail icon — a bin is not a daily surface).
//
// All IO goes through the swappable trashIo seam; destructive confirms go through
// the injectable ui seam (native confirm/prompt/alert by default — tests inject).
// Every string lives in trashMessages (zh/en). Styles are scoped in trash.css
// (styles.css untouched — contended).

import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import { platformDialogs } from "../platform";
import { registerView } from "./viewRegistry";
import { getTrashIo, PURGE_ALL_CONFIRM_PHRASE, type TrashListing, type TrashNoteItem, type TrashSourceItem } from "./trashIo";
import { trashMessages as m } from "./trashMessages";
import "./trash.css";

// Destructive confirms/prompts/alerts route through platformDialogs() (the swappable
// adapter — mobile supplies native dialogs). Tests inject answers via
// memoryPlatform({ dialogs }) + setPlatform (no hand-rolled UI seam).

// —— Helpers ————————————————————————————————————————————————————————————————————

function formatDay(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// —— The panel ———————————————————————————————————————————————————————————————————

export function TrashPanel() {
  const [listing, setListing] = useState<TrashListing | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // A SYNCHRONOUS in-flight guard for the dialog-opening handlers. `busy` (state) is only set inside
  // run() AFTER the awaited dialog resolves, and is stale-captured in the async closure — so with a
  // genuinely-async dialog (the future mobile/Capacitor adapter this refactor targets) a second click
  // would open a second dialog and fire a DOUBLE purge (destructive). A ref set before any await blocks
  // the re-entry (desktop/web window.* dialogs are sync-blocking, so this is inert there — S5-review fold).
  const dialogInFlight = useRef(false);

  const load = useCallback(async () => {
    setError("");
    try {
      setListing(await getTrashIo().fetchTrash());
    } catch (loadError) {
      setError(`${t(m.loadFailed)}: ${errorMessage(loadError)}`);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // One mutation = run the IO edge, surface its failure inline, reload the listing.
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      await load();
    } catch (actionError) {
      setError(`${t(m.actionFailed)}: ${errorMessage(actionError)}`);
    } finally {
      setBusy(false);
    }
  };

  const restore = (id: string) => void run(() => getTrashIo().restore(id));

  const purgeOne = (id: string) => {
    if (dialogInFlight.current) return;
    dialogInFlight.current = true;
    void (async () => {
      try {
        if (!(await platformDialogs().confirm(t(m.confirmPurgeOne)))) return;
        await run(() => getTrashIo().purge(id));
      } finally {
        dialogInFlight.current = false;
      }
    })();
  };

  // 清空回收站 — the typed confirm phrase (the TRUST-2 import idiom): a cancelled
  // prompt is a silent no-op; a wrong phrase alerts and touches nothing.
  const purgeAll = () => {
    if (dialogInFlight.current) return;
    dialogInFlight.current = true;
    void (async () => {
      try {
        const answer = await platformDialogs().prompt(t(m.purgeAllPrompt));
        if (answer === null) return;
        if (answer.trim() !== PURGE_ALL_CONFIRM_PHRASE) {
          await platformDialogs().alert(t(m.purgeAllMismatch));
          return;
        }
        await run(() => getTrashIo().purgeAll(PURGE_ALL_CONFIRM_PHRASE));
      } finally {
        dialogInFlight.current = false;
      }
    })();
  };

  const isEmpty = !!listing && listing.sources.length === 0 && listing.notes.length === 0;

  return (
    <section className="trash-panel" aria-label={t(m.title)}>
      <header className="trash-head">
        <h2 className="trash-title">{t(m.title)}</h2>
        <div className="trash-head-actions">
          <button type="button" className="trash-btn" disabled={busy} onClick={() => void load()}>
            {t(m.refresh)}
          </button>
          <button
            type="button"
            className="trash-btn trash-btn-danger trash-purge-all"
            disabled={busy || !listing || isEmpty}
            onClick={purgeAll}
          >
            {t(m.purgeAll)}
          </button>
        </div>
      </header>

      <p className="trash-retention">{t(m.retentionNote).replace("{days}", String(listing?.retentionDays ?? 30))}</p>

      {error ? <div className="trash-error">{error}</div> : null}
      {!listing && !error ? <div className="trash-loading">{t(m.loading)}</div> : null}
      {isEmpty ? <div className="trash-empty">{t(m.empty)}</div> : null}

      {listing && listing.sources.length > 0 ? (
        <div className="trash-section trash-section-sources">
          <h3 className="trash-section-title">{t(m.sectionSources)}</h3>
          <ul className="trash-list">
            {listing.sources.map((source) => (
              <TrashSourceRow key={source.id} item={source} busy={busy} onRestore={restore} onPurge={purgeOne} />
            ))}
          </ul>
        </div>
      ) : null}

      {listing && listing.notes.length > 0 ? (
        <div className="trash-section trash-section-notes">
          <h3 className="trash-section-title">{t(m.sectionNotes)}</h3>
          <ul className="trash-list">
            {listing.notes.map((note) => (
              <TrashNoteRow key={note.id} item={note} busy={busy} onRestore={restore} onPurge={purgeOne} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

type RowActions = { busy: boolean; onRestore: (id: string) => void; onPurge: (id: string) => void };

function TrashRowActions({ id, busy, onRestore, onPurge }: { id: string } & RowActions) {
  return (
    <span className="trash-row-actions">
      <button type="button" className="trash-btn trash-restore" disabled={busy} onClick={() => onRestore(id)}>
        {t(m.restore)}
      </button>
      <button type="button" className="trash-btn trash-btn-danger trash-purge" disabled={busy} onClick={() => onPurge(id)}>
        {t(m.purge)}
      </button>
    </span>
  );
}

function TrashSourceRow({ item, ...actions }: { item: TrashSourceItem } & RowActions) {
  return (
    <li className="trash-row trash-source-row" data-id={item.id}>
      <div className="trash-row-main">
        <span className="trash-row-title">{item.title}</span>
        <span className="trash-row-meta">
          <span className="trash-type-chip">{item.sourceType}</span>
          {t(m.cascadeCounts).replace("{notes}", String(item.noteCount)).replace("{anchors}", String(item.anchorCount))}
          {" · "}
          {t(m.deletedAtPrefix)} {formatDay(item.deletedAt)}
        </span>
      </div>
      <TrashRowActions id={item.id} {...actions} />
    </li>
  );
}

function TrashNoteRow({ item, ...actions }: { item: TrashNoteItem } & RowActions) {
  const blocked = item.sourceState === "trashed" || item.sourceState === "missing";
  return (
    <li className="trash-row trash-note-row" data-id={item.id}>
      <div className="trash-row-main">
        <span className="trash-row-title">{item.excerpt || t(m.untitledNote)}</span>
        <span className="trash-row-meta">
          <span className="trash-type-chip">{item.contentType}</span>
          {item.sourceTitle ? `${item.sourceTitle} · ` : ""}
          {t(m.deletedAtPrefix)} {formatDay(item.deletedAt)}
        </span>
        {blocked ? (
          <span className="trash-row-hint">
            {item.sourceState === "trashed" ? t(m.sourceInTrashHint) : t(m.sourceMissingHint)}
          </span>
        ) : null}
      </div>
      <TrashRowActions id={item.id} {...actions} />
    </li>
  );
}

// Registered exactly like plugin.manager/profile.panel (WorkspaceShell
// side-effect-imports this module); reached via the UserMenu 数据 group.
registerView({ kind: "trash.panel", render: () => <TrashPanel /> });
