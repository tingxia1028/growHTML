// Kit & Plugin manager view (Phase 2) — the left-rail panel that enumerates the plugin
// READ MODEL (docs/design/plugin-viewer-model.md §7): a grouped Kit → Plugin →
// Contribution list, each contribution row carrying a toggle that enables/disables it.
//
// IRON LAW: this view talks ONLY through the shared WorkspaceContext. It reads
// ctx.installedKits (the kit display names), ctx.installedPlugins (the plugin read model
// with its contributions), and ctx.pluginPrefs (the disabled set), and it WRITES only via
// ctx.setContributionEnabled(id, next). It never touches a host registry or entityClient
// directly. Disabling a contribution removes its CREATE affordance (surface/command
// filtering in clientContext) — it NEVER changes rendering (the adaptive-note contract:
// getNoteType().render is untouched), so a disabled note-type still displays existing
// notes; only its authoring entry-point is hidden.
//
// Styling reuses the shared panel classes (`.panel-title`, `.record-list`, `.empty-state`)
// the Bookmarks / Layers panes use, so it matches without new CSS.

import { Blocks } from "lucide-react";
import { registerView, type WorkspaceContext } from "./viewRegistry";
import type { PluginRecord } from "../../kits/plugin";
import { listViewers, resolveViewer, NOTETYPE_SENTINEL } from "../notes/viewerRegistry";

// A short human label for a contribution kind (the row's kind badge).
const KIND_LABEL: Record<string, string> = {
  noteType: "Note Type",
  viewer: "Viewer",
  command: "Command",
  surface: "Surface",
  language: "Language",
  layout: "Layout",
  prompt: "Prompt",
  layerPolicy: "Layer Policy"
};

function PluginManagerView({ ctx }: { ctx: WorkspaceContext }) {
  const { installedKits, installedPlugins, pluginPrefs, setContributionEnabled } = ctx;
  const disabled = new Set(pluginPrefs.disabledContributions);

  // Group plugins under their kit. plugin==kit 1:1 today (plugin.kitId === plugin.id for a
  // kit), plus the synthetic "core" plugin (no kitId). A kit's display name comes from
  // installedKits; a plugin without a matching kit (e.g. "core") groups under itself.
  const kitName = (id: string): string => installedKits.find((k) => k.id === id)?.name ?? id;
  const groups: { key: string; title: string; plugins: PluginRecord[] }[] = [];
  const byKey = new Map<string, { key: string; title: string; plugins: PluginRecord[] }>();
  for (const plugin of installedPlugins) {
    const groupKey = plugin.kitId ?? plugin.id;
    let group = byKey.get(groupKey);
    if (!group) {
      group = { key: groupKey, title: kitName(groupKey), plugins: [] };
      byKey.set(groupKey, group);
      groups.push(group);
    }
    group.plugins.push(plugin);
  }

  return (
    <aside className="plugin-manager-panel">
      <div className="panel-title">
        <Blocks size={16} />
        Kit &amp; Plugin
      </div>

      <div className="plugin-manager-list record-list">
        {groups.map((group) => (
          <div key={group.key} className="plugin-kit-group" data-kit-id={group.key}>
            <div className="plugin-kit-name">{group.title}</div>
            {group.plugins.map((plugin) => (
              <div key={plugin.id} className="plugin-row" data-plugin-id={plugin.id}>
                {/* plugin==kit 1:1 today → the plugin name repeats the kit header; only
                    show it when it adds info (multiple plugins, or a differing name). */}
                {group.plugins.length > 1 || plugin.name !== group.title ? (
                  <div className="plugin-name">{plugin.name}</div>
                ) : null}
                {plugin.contributions.length === 0 ? (
                  <div className="empty-state plugin-contrib-empty">No contributions.</div>
                ) : (
                  <ul className="plugin-contrib-list">
                    {plugin.contributions.map((contribution) => {
                      const enabled = !disabled.has(contribution.id);
                      return (
                        <li key={contribution.id} className="plugin-contrib-row" data-contribution-id={contribution.id}>
                          <span className="plugin-contrib-kind">{KIND_LABEL[contribution.kind] ?? contribution.kind}</span>
                          <span className="plugin-contrib-label">{contribution.label}</span>
                          <label className="plugin-contrib-toggle">
                            <input
                              type="checkbox"
                              checked={enabled}
                              aria-label={`Toggle ${contribution.label}`}
                              onChange={(event) => setContributionEnabled(contribution.id, event.target.checked)}
                            />
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ))}
          </div>
        ))}
        {groups.length === 0 ? <div className="empty-state">No kits or plugins installed.</div> : null}
      </div>

      <ViewerConflicts ctx={ctx} plugins={installedPlugins} />
    </aside>
  );
}

// —— Viewer conflicts (plugin-viewer-model §4/§7) — for each contentType that ≥2 viewers
// are willing to handle, show the current WINNER (from resolveViewer) and a picker that
// pins a per-contentType association via ctx.pinViewer. The candidate set is derived by
// probing each registered viewer's match({ contentType }): a viewer that matches by
// contentType alone competes for that type. Content-dependent viewers (that only match on
// note body) still appear as pickable options via the note's own "Open with…" control, so
// this panel deliberately focuses on the per-type conflict the user resolves globally.
function ViewerConflicts({ ctx, plugins }: { ctx: WorkspaceContext; plugins: readonly PluginRecord[] }) {
  // Every contentType a note-type contribution declares (the universe of types that could
  // be viewed), de-duped.
  const contentTypes = Array.from(
    new Set(
      plugins.flatMap((p) => p.contributions.filter((c) => c.kind === "noteType" && c.key).map((c) => c.key as string))
    )
  ).sort();

  const viewers = listViewers();
  // Per-type candidate viewers = those whose match({contentType}) > 0. Only types with ≥2
  // candidates are a CONFLICT the user resolves here.
  const conflicts = contentTypes
    .map((contentType) => {
      const candidates = viewers.filter((v) => {
        try {
          return v.match({ contentType }) > 0;
        } catch {
          return false;
        }
      });
      return { contentType, candidates };
    })
    .filter((entry) => entry.candidates.length > 1);

  const pinnedFor = (contentType: string): string =>
    ctx.pluginPrefs.viewerAssociations?.byContentType?.[contentType] ?? "";

  return (
    <div className="plugin-viewer-conflicts">
      <div className="plugin-section-title">Viewer conflicts</div>
      {conflicts.length === 0 ? (
        <div className="empty-state">No viewer conflicts.</div>
      ) : (
        <ul className="viewer-conflict-list">
          {conflicts.map(({ contentType, candidates }) => {
            const winner = resolveViewer({ contentType }, ctx.pluginPrefs);
            const winnerLabel =
              winner.viewerId === NOTETYPE_SENTINEL
                ? "Default (note type)"
                : candidates.find((c) => c.id === winner.viewerId)?.label ?? winner.viewerId;
            return (
              <li key={contentType} className="viewer-conflict-row" data-content-type={contentType}>
                <span className="viewer-conflict-type">{contentType}</span>
                <span className="viewer-conflict-winner" title={`Resolved by: ${winner.source}`}>
                  {winnerLabel}
                </span>
                <select
                  className="viewer-conflict-picker"
                  aria-label={`Viewer for ${contentType}`}
                  value={pinnedFor(contentType)}
                  onChange={(event) => ctx.pinViewer({ contentType }, event.target.value)}
                >
                  {/* Empty = no explicit pin (resolver's automatic choice). */}
                  <option value="">Auto ({winnerLabel})</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                  <option value={NOTETYPE_SENTINEL}>Default (note type)</option>
                </select>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

registerView({ kind: "plugin.manager", render: (_node, ctx) => <PluginManagerView ctx={ctx} /> });
