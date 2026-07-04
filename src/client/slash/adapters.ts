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
import { providerOf } from "../../kits/catalog";
import { isPluginEffectiveInstalled } from "../../kits/installState";
import { resolveText } from "../i18n";
import type { SlashEntry } from "./engine";

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
