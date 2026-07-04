// Slash composer adapters (SC-0; docs/design/slash-composer.md §2) — the thin seam
// between the LIVE registries and the pure engine. The engine never imports a
// registry; a mount calls an adapter to DERIVE its `SlashEntry[]` and injects it.
// That derivation is the whole "one entry enumerates every type" claim: a newly
// registered (kit) note type appears in the palette with zero palette code.
//
// M1/F4 (slash-composer §1 "List gating"): marketplace EFFECTIVE-INSTALLED is the
// palette's list source. A type whose catalog provider is not effective-installed is
// SKIPPED — its CREATE entry-point disappears (plugin-viewer-model §8.5.1) while its
// renderer stays registered (existing notes keep rendering). Types with no catalog
// provider (core primitives, test types) are always available.

import { listNoteTypes } from "../notes/noteTypeRegistry";
import { providerOf, catalogKitMembers } from "../../kits/catalog";
import { isPluginEffectiveInstalled } from "../../kits/installState";
import { resolveText } from "../i18n";
import type { SlashEntry } from "./engine";
import { slashEntriesFromOperations, type SlashOperationSources } from "./operationAdapter";

/**
 * Every REGISTERED, non-hidden, EFFECTIVE-INSTALLED client note type as a palette entry.
 *   • title falls back to the contentType when a registration carries none.
 *   • aliases default to [] (the id/title still match in the engine).
 *   • kitId = the registration's owning pluginId (the member plugin after F5; absent
 *     for core primitives) — the palette renders it as the provider badge.
 *   • hidden types are SKIPPED: `hidden` means "not authored from a generic composer
 *     entry" (bookmark materializes an anchor via its command; plain-text/mindmap are
 *     retired as new choices) — exactly what a slash pick would violate.
 *   • types whose catalog provider is NOT effective-installed are SKIPPED (M1/F4 —
 *     uninstalling a plugin removes its create affordances, never its rendering).
 * Order = registration order (stable); the engine keeps it as the tie-break, and the
 * active-kit / memory-recency ranking lands with SC-3 (design §2).
 */
export function slashEntriesFromNoteTypes(): SlashEntry[] {
  return listNoteTypes()
    .filter((plugin) => !plugin.hidden)
    .filter((plugin) => {
      const provider = providerOf(plugin.contentType);
      // No catalog provider → core primitive / uncataloged: always available.
      return provider ? isPluginEffectiveInstalled(provider.id) : true;
    })
    .map((plugin) => ({
      kind: "noteType" as const,
      id: plugin.contentType,
      title: plugin.title ? resolveText(plugin.title) : plugin.contentType,
      aliases: plugin.aliases ?? [],
      icon: plugin.icon,
      kitId: plugin.pluginId
    }));
}

// The plugin ids an active kit set FOREGROUNDS: the kits themselves + their catalog
// members (a member-owned note type floats when its enclosing kit is active). Mirrors
// clientContext.foregroundPluginIds (not exported) so the note-type ranking agrees with
// the surface-item foregrounding kitSurfaceItems already does for operations.
function foregroundIds(kitIds: readonly string[]): Set<string> {
  const ids = new Set<string>(kitIds);
  for (const kitId of kitIds) for (const member of catalogKitMembers(kitId)) ids.add(member);
  return ids;
}

/**
 * SC-3 ranking (slash-composer.md §2 "active kit's types first"): STABLE-partition a
 * palette list so entries owned by an active/foreground kit come first, everything else
 * after — each group keeping its incoming relative order (the secondary "stable order"
 * the engine's tie-break then preserves through resolution). A no-op when no kit is
 * foregrounded (empty set → the whole list stays in the group-2 order = unchanged).
 *
 * MEMORY-RECENCY (design §2 "then memory recency, later") is intentionally SCOPED OUT
 * of SC-3: no cheap client-side per-entry usage signal exists (searchRecents is recent
 * QUERIES, not entry usage), and a real recency rank would need new MEM plumbing into
 * src/client/memory — out of this build's blast radius. Ranking here = active-kit-first
 * + stable; recency lands when a MEM digest signal is available.
 */
export function rankByActiveKit(
  entries: readonly SlashEntry[],
  foregroundKitIds: readonly string[] | undefined
): SlashEntry[] {
  if (!foregroundKitIds || foregroundKitIds.length === 0) return [...entries];
  const fg = foregroundIds(foregroundKitIds);
  const active: SlashEntry[] = [];
  const rest: SlashEntry[] = [];
  for (const entry of entries) {
    (entry.kitId && fg.has(entry.kitId) ? active : rest).push(entry);
  }
  return [...active, ...rest];
}

/**
 * The FULL slash palette: note types + operations, active-kit-first (SC-3). One
 * derivation the mount injects into the pure engine — a newly installed kit's types AND
 * its actions both appear with zero palette code. `operations`/`disabled`/
 * `foregroundKitIds` come from WorkspaceContext (custom ops are per-vault state); omit
 * them for the note-types-only list SC-1 shipped.
 */
export function slashEntries(sources: SlashOperationSources = {}): SlashEntry[] {
  const noteTypes = slashEntriesFromNoteTypes();
  const operations = slashEntriesFromOperations(sources);
  return rankByActiveKit([...noteTypes, ...operations], sources.foregroundKitIds);
}
