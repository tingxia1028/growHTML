// Register the built-in inspectors. Importing this module runs the
// `registerInspector` calls (the same side-effect pattern the views use). The
// concept pane side-effect-imports this so the concept/relation inspectors are
// available when a concept or relation is focused.

import { registerInspector } from "./registry";
import { ConceptInspector } from "./ConceptInspector";
import { RelationInspector } from "./RelationInspector";

registerInspector({
  targetType: "concept",
  render: (focus, ctx) =>
    focus.type === "concept" ? <ConceptInspector conceptId={focus.conceptId} ctx={ctx} /> : null
});

registerInspector({
  targetType: "relation",
  render: (focus, ctx) =>
    focus.type === "relation" ? <RelationInspector relationId={focus.relationId} ctx={ctx} /> : null
});
