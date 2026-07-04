import { monotonicFactory } from "ulid";

export const entityKinds = ["source", "anchor", "note", "patch", "concept", "relation", "asset", "layer", "operation", "trigger", "pack", "memory", "chatSession"] as const;

export type EntityKind = (typeof entityKinds)[number];

export const idPrefixByKind = {
  source: "src",
  anchor: "anchor",
  note: "note",
  patch: "patch",
  concept: "concept",
  relation: "rel",
  asset: "asset",
  layer: "layer",
  operation: "op",
  trigger: "trigger",
  pack: "pack",
  memory: "mem",
  chatSession: "chat"
} as const satisfies Record<EntityKind, string>;

export type EntityIdPrefix = (typeof idPrefixByKind)[EntityKind];

const ulidPattern = "[0-9A-HJKMNP-TV-Z]{26}";

export const idPatternByKind = Object.fromEntries(
  entityKinds.map((kind) => [kind, new RegExp(`^${idPrefixByKind[kind]}_${ulidPattern}$`)])
) as Record<EntityKind, RegExp>;

const createUlid = monotonicFactory();

export function createEntityId(kind: EntityKind) {
  return `${idPrefixByKind[kind]}_${createUlid()}`;
}

export function isEntityId(kind: EntityKind, value: string) {
  return idPatternByKind[kind].test(value);
}

export function getEntityKindFromId(value: string): EntityKind | null {
  return entityKinds.find((kind) => isEntityId(kind, value)) ?? null;
}

