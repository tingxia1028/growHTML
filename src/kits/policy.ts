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
