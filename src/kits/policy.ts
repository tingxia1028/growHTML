// Kit layer-propagation policy — React-free registry (server registers these, like
// prompts + content specs). A Product Kit declares which of its note contentTypes are
// safe to SHARE (export) and which are PRIVATE BY DEFAULT, so a teacher exporting a
// Learning Layer never ships a student's mistakes (user spec §11). The hard rule is
// the export filter: a note is excluded from a `.studypack` iff its contentType is
// private-by-default in some installed kit. Generic notes (markdown, …) — no policy —
// stay exportable, so non-kit layers behave exactly as before.

export type KitLayerPolicy = {
  kitId: string;
  /** Content types intended to be shared (informational + UI hints). */
  exportableContentTypes: string[];
  /** Content types that must NOT leave the vault on export (hard filter). */
  privateByDefaultContentTypes: string[];
  /** Content types a recipient may copy into their own layer. */
  copyableContentTypes: string[];
  /**
   * Suggested STAGE AXIS this kit seeds onto a source (F7a): the preset lens layers a
   * source gets when this kit is active (e.g. textbook → 预习/学习/复习/拓展; 英语Kit →
   * 词汇/语法/听力). Core no longer hardcodes any stage taxonomy — a kit MAY omit this,
   * in which case it imposes NO stage axis. `order` sorts the axis in the switcher.
   */
  stagePreset?: { title: string; order: number }[];
};

const policies: KitLayerPolicy[] = [];
const privateByDefault = new Set<string>();

export function registerKitLayerPolicy(policy: KitLayerPolicy): void {
  // Idempotent per kit (re-install / test re-import shouldn't duplicate).
  if (policies.some((p) => p.kitId === policy.kitId)) return;
  policies.push(policy);
  for (const ct of policy.privateByDefaultContentTypes) privateByDefault.add(ct);
}

/** Is this note contentType private-by-default for some installed kit? (export filter) */
export function isPrivateByDefault(contentType: string): boolean {
  return privateByDefault.has(contentType);
}

/** A note is exportable unless a kit marks its contentType private-by-default. */
export function isExportableContentType(contentType: string): boolean {
  return !privateByDefault.has(contentType);
}

export function listKitLayerPolicies(): readonly KitLayerPolicy[] {
  return policies;
}

/**
 * The stage axis to seed for a source, given its active kit ids (F7a). Reads the
 * registered kit policies: each active kit MAY contribute a `stagePreset`; we
 * concatenate them IN KIT ORDER and dedupe by title (the FIRST active kit to name a
 * stage wins its order). Kits with no `stagePreset` — and the all-Core case (`kitIds`
 * empty) — contribute nothing, so the result is empty and NO preset stages are created.
 */
export function stagePresetForKits(kitIds: readonly string[]): { title: string; order: number }[] {
  const byTitle = new Map<string, { title: string; order: number }>();
  for (const kitId of kitIds) {
    const policy = policies.find((p) => p.kitId === kitId);
    if (!policy?.stagePreset) continue;
    for (const stage of policy.stagePreset) {
      if (!byTitle.has(stage.title)) byTitle.set(stage.title, { title: stage.title, order: stage.order });
    }
  }
  return [...byTitle.values()];
}
