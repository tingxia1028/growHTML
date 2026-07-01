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

      {/* Viewer conflicts — filled in P3 (the exclusive-viewer resolver + user pin UI). */}
      <div className="plugin-viewer-conflicts">
        <div className="plugin-section-title">Viewer conflicts</div>
        <div className="empty-state">Viewer resolution arrives in a later phase.</div>
      </div>
    </aside>
  );
}

registerView({ kind: "plugin.manager", render: (_node, ctx) => <PluginManagerView ctx={ctx} /> });
