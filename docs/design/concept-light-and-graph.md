# Concepts — 轻量关联 + 核心关联图 (CONCEPT-LIGHT / GRAPH)

User decisions (2026-07-04): ① relationship-building must be LIGHT — form-driven create/link
means nobody builds relations ("很重就不想建立了"); ② **the 关联图 is a product core** — the
graph view lives in CORE; plugins modify VISUALIZATION STYLE, never the graph itself.

Substrate already right: concept + relation are core entities; relationSchema has 10 kinds +
`confidence` (built for AI-emitted edges); what was wrong is the form-driven surface.

## 1. Capture — relationships as BYPRODUCTS (core; the Obsidian lesson)

Obsidian's graph works because links are a byproduct of writing, never a chore. Ordered by
effort saved:
1. **AI 顺手挂 (flagship, our advantage)**: the generation contract gains an optional
   `concepts: string[]` side-channel on structured outputs; the preview card shows suggested
   concept chips (removable); saving creates-or-matches concepts + links the note + same_topic
   edges (schema's `confidence` finally used). Zero user effort. Engine change beside
   composeAutoContext (action-v2-auto-context.md) — the two ride the same seam.
2. **[[名词]] wiki-links**: typing `[[浮力]]` in any markdown note creates/links the concept;
   renders as a clickable chip; composer autocompletes on `[[`. Writing IS linking.
3. **共现 derived edges (never stored)**: concepts sharing an anchor/note/source get dashed
   same_topic edges computed at read time — zero data debt, the graph is alive from day one.
4. **选中即建 / chips / 关联到… / list usability** — ✅ shipping as CONCEPT-UX-1 (in flight):
   selection-toolbar 标为概念 (dedupe by normalized name), FocusOverlay concept chips +
   autocomplete quick-link, single "related" autocomplete in ConceptInspector (10-kind picker
   demoted to the advanced path), count-sorted/filterable list.
All capture mechanisms are CORE: they are contract/pipeline-level (the recurring-capability
law), they feed the loop (concept-grain weak buckets → review queue + profileContext), and
uninstalling them would orphan the data.

## 2. The graph — ONE core engine, plugin lenses (user amendment)

**Core** (`concept.graph` registered view, lazy-loaded chunk so the shell pays nothing until
opened):
- Data assembly: stored relations (solid edges) + derived co-occurrence (dashed), nodes sized
  by linked-note count.
- Interaction contract: click node → its anchors/notes (existing focus/navigation), double →
  reveal in reader; filter by subject / source / layer; search-jump.
- Layout: force-directed (small dep or hand-rolled; benchmark on the 94MB real vault —
  cap rendered nodes with a "top-N + expand" rule before it melts).

**Plugin seam — GraphLens/GraphStyle contribution point** (style, never structure):
```ts
GraphLens { id, title: LocalizedText, nodeStyle?(concept, ctx), edgeStyle?(relation, ctx),
            filter?(concept, ctx), legend? }
```
Examples: Textbook Kit lens = subject coloring; 弱项 lens = profile-driven red scale on weak
concepts; 复习 lens = highlight concepts with due cards. One engine, many skins — the Action
Registry / adaptive-note pattern. Plugins can NOT register a second graph.

**判例 amendment** (supersedes the earlier "graph = kit" verdict): a view over core entities
may live in core when the product declares it mission-level (user call, like review); the
kit boundary moves to LENSES. The 3-question test (环判据/复现判据/卸载判据) still governs —
uninstall any kit and the graph + data survive, only a lens disappears.

## 3. Phasing
> **Status: CG-1/2/3 ✅ shipped 2026-07-04 (CG-123-001, commit 02c0476)** — core graph engine
> (`src/core/graph/` + `src/core/concepts/`), `GET /api/graph` (+ direct-transport parity),
> `ConceptGraphView` with a hand-rolled `forceLayout` (zero heavy deps), `graphLens` registry
> (core default lens; plugins restyle only), CG-2 auto-tag side-channel (`generateStructured`
> `concepts[]`) + `[[wiki-links]]`. Kit-side subject/弱项/复习 lenses (the CG-3 lens exemplars)
> remain a follow-up now that the seam exists.
- **CONCEPT-UX-1** ✅ (§1.4).
- **CG-1** ✅: graph view core (assembly + interactions) + co-occurrence derivation + lens
  registry with the built-in default lens.
- **CG-2** ✅: AI 顺手挂 (generation-contract side-channel) + [[双链]] in markdown/composer.
- **CG-3** ✅ (engine + seam): review-queue concept-grain hooks; the exemplar Textbook subject
  lens + 弱项/复习 kit lenses remain a follow-up (the seam is proven by the core default lens).

## 4. Tests
Capture: dedupe-by-name, [[]) parse/render/autocomplete, co-occurrence derivation pure fn
(same anchor/note/source fixtures). Graph: assembly (solid vs dashed), top-N cap, click/filter
contracts (jsdom), lens registry (fixture lens styles nodes; unregister falls back), lazy
chunk boundary (build emits separate chunk). Loop: concept-grain buckets appear in queue
reasons + profileContext (gate parity tests).
