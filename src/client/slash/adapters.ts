// Slash composer adapters (SC-0; docs/design/slash-composer.md §2) — the thin seam
// between the LIVE registries and the pure engine. The engine never imports a
// registry; a mount calls an adapter to DERIVE its `SlashEntry[]` and injects it.
// That derivation is the whole "one entry enumerates every type" claim: a newly
// registered (kit) note type appears in the palette with zero palette code.

import { listNoteTypes } from "../notes/noteTypeRegistry";
import type { SlashEntry } from "./engine";

/**
 * Every REGISTERED, non-hidden client note type as a palette entry.
 *   • title falls back to the contentType when a registration carries none.
 *   • aliases default to [] (the id/title still match in the engine).
 *   • kitId = the registration's owning pluginId (plugin==kit 1:1 today; absent for
 *     built-ins) — the palette renders it as the kit badge.
 *   • hidden types are SKIPPED: `hidden` means "not authored from a generic composer
 *     entry" (bookmark materializes an anchor via its command; plain-text/mindmap are
 *     retired as new choices) — exactly what a slash pick would violate.
 * Order = registration order (stable); the engine keeps it as the tie-break, and the
 * active-kit / memory-recency ranking lands with SC-3 (design §2).
 */
export function slashEntriesFromNoteTypes(): SlashEntry[] {
  return listNoteTypes()
    .filter((plugin) => !plugin.hidden)
    .map((plugin) => ({
      kind: "noteType" as const,
      id: plugin.contentType,
      title: plugin.title ?? plugin.contentType,
      aliases: plugin.aliases ?? [],
      icon: plugin.icon,
      kitId: plugin.pluginId
    }));
}
