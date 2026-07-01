# Multi‑document workspace, cross‑document notes & the fine‑grained concept graph

Status: **Design only** (2026-07-02). No code in this pass. Branch: `codex/ai-study-vault-rework`.

This doc specs three intertwined capabilities that share ONE enabler (per‑pane source
resolution):

- **(A) Multi‑document workspace** — VS Code–style tabs + split panes over the existing
  dock engine, replacing the single `activeSourceId`.
- **(B) Cross‑document notes** — one note anchored to passages in several documents, painted
  in all open panes at once. The data model already allows this; A unlocks display + authoring.
- **(C) The concept graph** — relate fragmented knowledge at the **passage/anchor** level
  (Obsidian‑but‑finer): a concept aggregates every passage + note across ALL documents.

It **extends / reconciles** (does not duplicate):
`docs/design/note-presentation-unified.md` (D1 `ReaderAnnotationAdapter`, D2 markers — the paint
contract B/C build on), `docs/design/multi-anchor-note.md` (the V1 `note.link-anchor` flow — B is
its explicitly‑deferred "cross‑source" follow‑up), `docs/design/concept-relation-ui.md` (P5 concept
list + inspector — C's starting point), `docs/design/layout-engine.md` (the dock engine A extends),
`docs/design/design-vs-obsidian.md` (positioning), `docs/design/study-layer.md` (layer‑as‑lens).

> **Concurrency note.** A parallel session is editing the reader/marker files
> (`annotationLayer.ts`, `markerOverlay.ts`, `*Reader.tsx`, `DomReader.tsx`,
> `electron/webview-preload.ts`). This doc treats them as READ‑ONLY: it builds strictly on the
> **host‑side** paint contract (`paintAnchors` fed into `readerForSource`) and the D1 adapter,
> and never assumes the readers' in‑flight internal shape. All new work here lands in
> `WorkspaceContext.tsx`, `dock.ts`/`presets.ts`, `views.tsx`, `conceptViews.tsx`, and additive
> schema/endpoints — none of the locked reader files.

---

## 0. Executive summary (12 lines)

1. Today the whole workspace is keyed to ONE `activeSourceId` (`WorkspaceContext.tsx` L501); every
   reader leaf renders that single active source (`SourceViewerView`, `views.tsx` L223).
2. **A** replaces it with an **open‑panes model** in the dock tree: `openPanes[]` + `focusedPaneId`,
   each pane a `source.viewer` leaf carrying its own `sourceId` via `node.params`.
3. The dock ALREADY does splits (`split("row",[…])`, `presets.ts`) — side‑by‑side docs are expressible
   today; what's missing is a **tabs container** and **a leaf that carries a sourceId + per‑pane state**.
4. `activeSource` becomes a **back‑compat shim** = `focusedPane`'s source, so single‑pane callers keep
   working through the migration.
5. **B's data is already there**: `note.anchorIds[]` is N:N and each `anchor.sourceId` is single, so one
   note already spans sources (`note.ts` / `anchor.ts`). Only DISPLAY + AUTHORING were missing.
6. Per‑pane paint = `notesForSource(sourceId)`: each pane resolves its own source → anchors → notes →
   `paintAnchors`; a note anchored in two open docs paints in BOTH — no "multi‑doc note" type needed.
7. Authoring already half‑exists: `note.link-anchor` + `NoteAnchorControl` (`multi-anchor-note.md` V1)
   append the focused passage to a note; cross‑source was the doc's **Deferred** item, gated on A.
8. **C's atom is the anchor**, not a file. A concept ("导数") aggregates passages + notes across every
   document — a cross‑document backlinks/transclusion view.
9. **Decision**: link concepts at the anchor level by **embedding `conceptIds` on the anchor envelope**
   (additive, migration‑free — mirrors `note.conceptIds`); reserve `relation` for typed concept↔concept /
   concept↔anchor edges. `nodeRefSchema` already supports both, so the join is also free.
10. The concept page today shows note back‑refs only (`ConceptInspector`); it is **passage‑blind and
    not grouped by source** — C adds passages‑by‑document, related concepts, and co‑occurrence.
11. **Reaffirmed**: note bodies still render only via `getNoteType().render` — B/C change WHERE notes are
    resolved/painted and add concept views, never HOW a note renders.
12. **Smallest demo**: P‑A1 + P‑A2 = "open two docs split, a shared note paints in both."

---

## 0.1 Ground truth — object graph & cardinalities (cite the code)

| Relationship | Cardinality | Where | Note |
| --- | --- | --- | --- |
| note → source | 0..1 (`sourceId?`) | `note.ts` L25 | a note's "home" source, optional |
| note → anchors | **N:N** (`anchorIds[]`) | `note.ts` L26 | one note, many passages |
| note → concepts | **N:N** (`conceptIds[]`) | `note.ts` L27 | manual link today |
| note → layers | **N:N** (`layerIds[]`) | `note.ts` L39 | the lens filter |
| **anchor → source** | **exactly 1** (`sourceId`) | `anchor.ts` L14 | **a passage lives in ONE source** |
| anchor → concepts | — (none today) | `anchor.ts` | **C adds this** |
| relation.from / .to | any node | `relation.ts` + `nodeRefSchema` | `common.ts` L47 |
| nodeRef kinds | source · **anchor** · note · patch · **concept** | `common.ts` L41–53 | anchor & concept ARE members |

**The two load‑bearing facts.** (1) `note.anchorIds` is an array and each anchor names exactly one
source → **a single note already references passages across multiple sources** with zero schema
change. (2) `nodeRefSchema` already includes `anchor` and `concept` → **a `relation` can already
connect an anchor to a concept** with zero schema change. Both unlock B and C respectively; the gap
is entirely UI + per‑pane resolution.

## 0.2 Ground truth — the single‑active‑source reality

Everything the reader paints is derived from one `activeSourceId` (`WorkspaceContext.tsx`):

- `activeSource` = `sources.find(id === activeSourceId)` (L562); `activeViewer` from it (L569).
- `loadSourceWorkspace(activeSourceId)` (L750) fetches `renderedHtml / anchors / notes / patches /
  sourceLayers` for the ONE active source into top‑level state; an effect reloads on id change (L902).
- `enabledLayerIds` (L584) is the active source's layers' enabled set; `visibleNotes` (L593) is the
  OR‑filter over `notes`; `notesByAnchorId` (L607) → `paintAnchors` / `revealAnchors` (L642/L668) is
  the ONE paint list handed to whichever reader matches the active source.
- `commandContext.sourceId = activeSourceId` (L951) so add‑note/link/generate all target it;
  `buildChatContext` (L922), `activeKitIds` (L1292), `recentSourceIds`/`rememberSourceId` (L697, L899)
  all key off it. The reader header renders a **single** doc tab whose close does `setActiveSourceId("")`
  (`views.tsx` L244–263).

This is the refactor surface. A's job is to re‑target each of these to **per‑pane** or **focused‑pane**.

---

## PART A — Multi‑document workspace (tabs + split)

### A.1 The core refactor: `activeSourceId` → open‑panes model

Replace the single id with an open‑documents model that lives alongside the dock tree:

```ts
// The reader sub‑state a pane owns (was global top‑level state before).
type PaneViewState = {
  scrollTop?: number;                    // reader scroll offset
  page?: number;                         // PDF.js current page
  zoom?: number;                         // PDF.js zoom
  mode?: string;                         // reader sub‑mode (e.g. web live/snapshot)
  annotationMode?: HtmlAnnotationMode;   // floating ↔ margin gutter, per‑pane (D1)
  enabledLayerIds?: string[];            // per‑pane Layer Lens (else the source default)
};

type OpenPane = {
  paneId: string;      // stable id; ALSO the dock leaf's nodeId (leaf(paneId))
  sourceId: string;    // the document this pane shows → node.params.sourceId
  viewState: PaneViewState;
};

type WorkspaceDocsState = {
  openPanes: OpenPane[];   // every open reader pane (mirrors the dock's source.viewer leaves)
  focusedPaneId: string;   // the pane that selection / anchor / source actions target
};
```

The reader entity data (rendered HTML, anchors, notes, patches, layers) becomes a **per‑source
cache** instead of single top‑level state — a natural generalization since it is already fetched
per source (`entityClient.notes(sourceId)` etc.):

```ts
type SourceBundle = { renderedHtml, anchors, notes, patches, layers };
sourceBundles: Map<sourceId, SourceBundle>   // filled when a pane opens; reused across panes
```

**`activeSource` shim (back‑compat, the migration keystone).** Keep the exact old names, redefined:

```ts
const focusedPane   = openPanes.find(p => p.paneId === focusedPaneId) ?? openPanes[0];
const activeSourceId = focusedPane?.sourceId ?? "";                 // ← same string every caller reads
const activeSource   = sources.find(s => s.id === activeSourceId) ?? null;
const bundle         = sourceBundles.get(activeSourceId);           // backs top‑level notes/paint fields
function setActiveSourceId(id) { openOrFocusPane(id); }             // open a pane / focus its pane
```

Every consumer that reads `activeSourceId`/`activeSource`/`visibleNotes`/`paintAnchors` keeps
compiling; it now reflects the FOCUSED pane. New per‑pane consumers (the readers) read their own
`sourceId`. Migration proceeds pane‑by‑pane behind the shim.

### A.2 Exact `activeSourceId` consumers to re‑target

| Consumer (`WorkspaceContext.tsx`) | Line | Re‑targets to |
| --- | --- | --- |
| `activeSource`, `activeViewer`, `activeFilePath`, `activeFileDir` | 562, 569, 559, 571 | **focused pane** (shim) |
| `loadSourceWorkspace(id)` + reload effect | 750, 902 | **per‑pane** — load each pane's `SourceBundle` on open |
| `refreshAnnotations()` (uses `activeSourceId`) | 786 | the **mutated source's** bundle (any open pane) |
| `enabledLayerIds`, `sourceLayers` | 584, 508 | **per‑pane** (pane's source layers + its filter) |
| `visibleNotes` | 593 | **per‑pane** `notesForSource(sourceId)` for paint; keep a focused‑pane copy for the notes panel |
| `notesByAnchorId`, `paintAnchors`, `revealAnchors` | 607, 642, 668 | **per‑pane** paint lists (pane sourceId → its anchors+notes) |
| `visibleAnchors` / `mergeFocusedAnchor(…, activeSourceId)` | 576, 237 | merge `focus.anchor` into the pane whose `sourceId` matches |
| `activePatches` | 692 | **focused pane** (patches of its source, scoped to focused anchor) |
| `commandContext.sourceId` | 951 | **focused pane** (add‑note/link/generate land on the focused doc) |
| `buildChatContext` | 922 | **focused pane** source + the global `focus` passage |
| `activeKitIds`, `setActiveKit`, `deleteSourceItem` | 1292, 1296, 863 | **focused pane** source metadata |
| `rememberSourceId` effect / `recentSourceIds` | 697, 899 | remember on pane **open/focus** |
| ingest → `setActiveSourceId(newId)` (`importFromUrl`/`openLiveUrl`/`openLocalFile`) | 804–851 | **open a pane** for the new source + focus it |
| `previewClassifiedReply` / `importXmindFile` draft `sourceId` | 1120, 1180 | **focused pane** |
| reader‑header tab strip + close (`setActiveSourceId("")`) | `views.tsx` 244–263 | open/close/switch a **pane tab** |

`focus` itself stays a SINGLE global (`FocusContext` — one `anchor`/`draft`/`revealSeq`,
`setFocus`/`setAnchor`/`materializeAnchor`). Interpretation: the focused passage belongs to
`focusedPaneId`. Selection in a pane sets `focusedPaneId = that pane` then `focus.setDraft(...)` as
today. **No per‑pane focus store in V1** — this keeps the anchor/selection pipeline untouched.

### A.3 Dock integration — what already works vs what's missing

The dock is a pure `split | leaf` tree (`dock.ts`): `leaf(nodeId)` resolves a `nodeId` → a
`WorkspaceNode {id, kind, params?}` (`entityClient.ts` L242), `split("row"/"column", children)` nests
with flex/px sizing + gutter resize. `paneLabel` already reads `node.params?.title` (L130).

- **WORKS today**: two readers side by side = `split("row", [ leaf("pane-A"), leaf("pane-B") ])`.
  Nesting, sizing, gutters, persistence of the tree — all done (`presets.ts` `studentDock` even nests
  a `column` split). Reveal/scroll per reader already flows through the D1/`revealSeq` contract.
- **MISSING #1 — the leaf carries a sourceId + per‑pane state.** `source.viewer` is registered as
  `render: (_node, ctx) => <SourceViewerView ctx={ctx} />` (`views.tsx` L529) — it **ignores the node**
  and reads global `activeSource`. Fix: read `node.params.sourceId` and resolve THAT source's bundle +
  paint list. The code already anticipates this (comment `views.tsx` L524–527: "a source.viewer pinned
  to a specific sourceId reads `node.params`"). `WorkspaceNode.params` already exists — no dock change.
- **MISSING #2 — a tabs container.** *(Code reality — stated plainly: the dock has NO `tabs` node
  type.* `DockNode = split | leaf` only.) Tabs today are a **view‑level** construct: `right.tabs`
  (`RightSidebarTabs`) internally switches sub‑views with its own popped‑pane split helper
  (`rightSplit.ts`). The single reader "tab" is hardcoded chrome (`views.tsx` L244). Two options:
  - **(pref) add a `tabs` DockNode variant** — `{ type: "tabs"; children: DockChild[]; activeIndex }`
    holding `source.viewer` leaves; the shell renders a tab strip + the active child. Principled,
    matches a VS Code editor group, and other leaf kinds can be tabbed later.
  - **(interim) a `source.tabs` host view** mirroring `RightSidebarTabs` that hosts N `source.viewer`
    panes by `sourceId`. Lower risk, reuses the `rightSplit.ts` precedent, but tabs stay a special
    view rather than a dock primitive.

  Recommend the `tabs` DockNode (keeps the dock the single layout authority; `dockLeafIds` and
  `paneLabel` extend cleanly). **Split** needs nothing new: opening "to the side" wraps the focused
  leaf in `split("row", [focused, leaf(newPane)])`.

Opening a doc = add an `OpenPane` + a leaf (a new tab in the focused group, or a split); closing =
remove the pane + collapse its leaf (unwrap a one‑child split, drop an emptied tab group). These are
pure tree edits next to `dock.ts`'s existing helpers (`dockLeafIds`, `gutterTarget`).

### A.4 Persistence

Persist `openPanes` (paneId, sourceId, viewState) + `focusedPaneId` + the dock tree, mirroring the
existing `recentSourceIds` / folder‑roots localStorage pattern (`WorkspaceContext.tsx` L185–225) and
the per‑layout right‑split key (`rightSplit.ts` `rightSplitKey`). Reopen restores the same docs, tabs,
splits, scroll/zoom, and focus. Prune panes whose `sourceId` no longer resolves (source deleted).

### A.5 Wireframe — two documents split side‑by‑side, each with its own tab bar

```
┌Rail┬─ Library ──┬───────────── Editor Group  split("row",[A,B]) ─────────────┬─ Right Tabs ─┐
│📚  │ ▸ calculus │ ┌ tabs ────────────────┐   │   ┌ tabs ──────────────────┐  │ Anchor       │
│🔖  │ ▸ physics  │ │[derivatives.pdf ×][+]│   │   │[waves.html ×][kinemat…]│  │ Notes        │
│🧩  │ ▸ notes    │ ├──────────────────────┤   │   ├────────────────────────┤  │ Layers       │
│🕸   │            │ │  ██ f'(x)=lim… ██    │   │   │  ██ 光的折射 ██         │  │ AI Chat      │
│    │            │ │  (⚓)(❔)             │ ◀╫▶ │  (⚓)(▤)                │  │              │
│    │            │ │  reader body …       │   │   │  reader body …         │  │              │
│    │            │ └──────────────────────┘   │   └────────────────────────┘  │              │
│    │            │  focusedPane = LEFT — selection/anchor/source actions target it              │
└────┴────────────┴──────────────────────────────────────────────────────────┴──────────────┘
   each leaf: node.params.sourceId → its own SourceBundle → its own paintAnchors (per‑pane)
```

### A.6 Scope / risks

- **Reader instances multiply** — one PDF.js / webview / iframe per pane ⇒ memory + CPU. Mitigate: cap
  concurrent live readers, lazy‑mount off‑screen tabs (a background tab's leaf renders a lightweight
  placeholder until activated), and reuse the per‑source `SourceBundle` cache across panes on the same
  source. Live‑webview panes are the heaviest — consider limiting to one live pane initially.
- **Focus routing** — exactly one `focusedPaneId`; a click/selection in a pane claims focus first, then
  the global `focus` pipeline runs unchanged. Anchor‑bar / selection‑toolbar / `commandContext.sourceId`
  all read the focused pane.
- **Which pane an action targets** — always the focused pane. A `note.link-anchor` from a card in pane A
  can nonetheless append a passage the user just focused in pane B (that's B's authoring win, §B.4).

---

## PART B — Cross‑document notes

### B.1 Key insight — the data model already supports this

Per §0.1, `note.anchorIds[]` × `anchor.sourceId(single)` means **one note can already reference
passages in several sources**. `multi-anchor-note.md` shipped the intra‑source half (V1:
`note.link-anchor`, multi‑anchor paint, "Anchored at N places" card) and explicitly lists
**"Cross‑source multi‑anchor (a note spanning passages in different sources)"** under *Deferred*. B is
that deferred item — and it needs no new note type, only **per‑pane resolution** (unlocked by A) plus a
grouped card. The reader paint itself is unchanged: it consumes the host's one `paintAnchors` list via
the D1 adapter (`note-presentation-unified.md` §1); we only change how that list is BUILT per pane.

### B.2 Per‑pane paint resolution — `notesForSource(sourceId)`

Today `visibleNotes` / `paintAnchors` are singular (active source). Introduce a selector, replacing the
single‑source paint for READERS while keeping a focused‑pane copy for panels:

```ts
function notesForSource(sourceId): NoteRecord[] {
  const b = sourceBundles.get(sourceId);
  const enabled = enabledLayerIdsForPane(sourceId);            // per‑pane Layer Lens
  return b.notes.filter(n => n.layerIds.length === 0 || n.layerIds.some(id => enabled.has(id)));
}
function paintAnchorsForPane(pane): PaintAnchor[] {            // same builder as L642, per source
  const notes   = notesForSource(pane.sourceId);
  const anchors = sourceBundles.get(pane.sourceId).anchors;   // anchors whose sourceId === pane.sourceId
  return buildPaintAnchors(anchors, notes, pane.sourceId);     // notesByAnchorId → PaintAnchor[]
}
```

**Consequence (the whole feature):** a note whose `anchorIds` include passages in open docs A **and** B
appears in `notesForSource(A)` (via its A‑anchors) **and** `notesForSource(B)` (via its B‑anchors), so it
paints in BOTH panes automatically. No "multi‑doc note" flag — cross‑doc painting is an emergent
property of resolving paint per pane. `notesForSource` is memoized per `(sourceId, bundle, enabledSet)`.

### B.3 Note card across docs — grouped by source + jump

Extend `NoteAnchorControl` (`noteAnchorControl.tsx`) — today it lists jump buttons flat and resolves
each anchor from `ctx.anchors` (the **active source only**, so cross‑source jumps are inert). New:
**group the note's `anchorIds` by their anchor's `sourceId`**, each group a document heading; each row a
passage excerpt with an action:

- passage in an **open** pane → `[→ 定位]` scrolls that pane (`focus.setAnchor` + the `revealSeq` reveal
  leg the readers already implement, per `multi-anchor-note.md` "reveal").
- passage in a **not‑open** doc → show the doc title + `[↗ 打开并定位]` = open a pane for that source
  (`openOrFocusPane`) then reveal.

Resolving anchors cross‑source needs their records: fetch via the per‑source `SourceBundle` cache
(open docs) or a small `entityClient.anchors(sourceId)` on demand for closed docs (or resolve names
from `sources`). The CenterView (`FocusOverlay`) shows the same grouped list at full size. Note bodies
still render only through `getNoteType().render` — the grouping is card chrome, not a render path.

### B.4 Authoring a cross‑doc link

The command exists: `note.link-anchor` materializes the current `focus` selection and appends its id to
the target note (`anchorIds`), fresh‑read + deduped (`multi-anchor-note.md` §1; `registry.ts`). With A,
the focused passage can be in a **different pane**, so the SAME command becomes cross‑document:

1. Open note card in pane A (or its CenterView).
2. Focus a passage in pane B (select text → `focusedPaneId = B`, `focus.setDraft`) — or open a new pane
   for a closed doc and select there.
3. Click **`＋ 链接到另一处`** (`NoteAnchorControl`'s existing "Link to selection", relabelled) →
   `note.link-anchor { noteId }` appends B's anchor. Repaint shows it in pane B.

Also support **drag from the Anchor bar** onto a note card (drag payload = focused anchor id → same
`note.link-anchor`). API is unchanged: `PATCH /api/notes/:id { anchorIds }` already replaces the full
array (`app.ts` L834), which the command uses. No server change for B.

### B.5 Layer / visibility interplay (per‑pane)

Layer visibility is **per‑note**, not per‑anchor: an anchor paints iff some note referencing it sits in
an enabled layer (server‑derived; `multi-anchor-note.md` "Rejected review finding"; a note's
`layerIds`). A shared cross‑doc note has ONE `layerIds`. With per‑pane filters:

> A shared note paints in pane P **iff** `note.layerIds ∩ enabledLayerIds(P)` (or the note has no
> layers). Because each pane owns its Layer Lens (`PaneViewState.enabledLayerIds`), the same note can
> show in pane A yet be filtered out of pane B — correct, since layers are per source and each pane
> shows a different source's lens set. Today `enabledLayerIds` is global (active source's layers,
> L584); B makes it a per‑pane function `enabledLayerIdsForPane(sourceId)`.

### B.6 Wireframe — a cross‑doc note card grouped by source

```
┌ Note · markdown ───────────────────── ⤢ ✕ ┐
│ “导数是变化率的极限” …                       │
│ ─────────────────────────────────────────  │
│ Anchored at 3 passages · 2 documents        │
│ 📄 derivatives.pdf        (open · focused)  │
│   ⤷ “f'(x)=lim Δy/Δx”            [→ 定位]   │
│   ⤷ “切线斜率即导数”              [→ 定位]   │
│ 📄 kinematics.html        (not open)        │
│   ⚫ “瞬时速度是位移的导数”   [↗ 打开并定位]  │
│ ─────────────────────────────────────────  │
│ 🕸 concepts: 导数 · 极限     [＋ 关联概念]    │
│ [＋ 链接到另一处]  ← focus a passage, click   │
└─────────────────────────────────────────────┘
```

---

## PART C — The concept graph (fine‑grained, Obsidian‑but‑finer)

### C.1 Positioning — note vs concept, and why the atom is the anchor

Per `design-vs-obsidian.md`, the product's subject is **「对资料的锚点」(the anchor)**, not a note file.
So where Obsidian links whole notes/files/headings, here the linkable ATOM is finer: **the anchor (a
passage)** and **the concept node**. Reconcile the two layers explicitly — they are complementary, not
competitors:

- **Note** = authored content anchored to passage(s) (`note.content` via a NoteType) — the "what you
  wrote/generated." N:N to anchors and concepts.
- **Concept** = a lightweight named knowledge node (`conceptSchema`: name/aliases/description/tags) —
  the "what this is about." It owns no content; anchors, notes, and other concepts LINK to it.

A concept ("导数", "光合作用") aggregates **every passage + note across ALL documents** that reference it.
That aggregation — passages from different PDFs/pages/sites converging on one concept page — is exactly
"把所有零碎知识点做关联," and is finer than Obsidian's file‑level backlinks.

### C.2 Linking granularity — the anchor‑concept decision

Today `conceptIds` lives only on the **note** (`note.ts` L27); a highlighted passage with no note can't
belong to a concept. Two ways to add anchor‑level linking:

- **(A) Embed `conceptIds` on the anchor envelope** — `conceptIds: z.array(conceptIdSchema).default([])`
  on `anchorEnvelopeSchema` (`anchor.ts` L13). Additive default `[]` ⇒ every existing anchor parses
  unchanged (the migration‑free story `note.ts` L18–21 already relies on). All discriminated variants
  inherit it. Mirrors `note.conceptIds` exactly.
- **(B) Join via `relation`** — `relation.from={type:"anchor"}`, `to={type:"concept"}`. **Zero schema
  change**: `nodeRefSchema` already admits both (`common.ts`), and `POST /api/relations` already accepts
  arbitrary node refs (`app.ts` L1215). But `relation` is a TYPED, directional edge (10 `relationKind`s);
  expressing plain membership through it overloads the vocabulary (a pseudo `member_of`).

**Decision: (A) embed `conceptIds` on the anchor.** Rationale: membership ("this passage is about 导数")
is a lightweight fact best held on the entity, symmetric with `note.conceptIds` (least surprise), and
migration‑free. The reverse query (concept → anchors) becomes a scan for `conceptIds`, the **same shape**
as the existing concept → notes query (`app.ts` L1196 filters notes by `conceptIds`) — one symmetric line
in the concept‑detail endpoint. Reserve **`relation`** for TYPED edges: concept↔concept
(`导数 —depends_on→ 极限`, already shipped in P5) and concept↔anchor when a *directional/typed* link is
wanted (`concept —references→ anchor`). Membership = arrays; typed edges = `relation`. (Because (B) is
free today, a v0 of anchor‑concept linking could ship as relations before the schema field lands — noted,
not recommended as the durable model.)

### C.3 Concept page — the payoff (cross‑document aggregation)

Today `GET /api/concepts/:id` returns `{ concept, notes(by conceptIds), relations }` and `ConceptInspector`
renders concept fields + **linked notes back‑refs** + relations + manual link/relation actions
(`concept-relation-ui.md`). *Code reality: it is passage‑blind and NOT grouped by source.* Extend the
endpoint and the view into a full aggregation page:

- **Passages** — with `anchor.conceptIds`, add `anchors = anchors.filter(a => a.conceptIds.includes(id))`
  to the endpoint; the page lists them **grouped by `sourceId`** (document heading → anchor excerpt +
  `[→ 打开定位]` opening a pane + revealing). Cross‑document by construction (anchors span sources).
- **Notes** — the existing note back‑refs, rendered as **PreviewCards** (`ArtifactCard`, reusing R3 /
  `note-presentation-unified.md`), also groupable by their `sourceId`.
- **Related concepts** — the existing `relations` (concept↔concept), shown as `from —kind→ to`.
- **Co‑occurrence** (new, computed) — concepts that SHARE anchors or notes with this one ("appears with
  积分 in 2 passages"). A cheap server aggregation over notes/anchors `conceptIds`; suggests latent links.

This is a cross‑document backlinks/transclusion view — the concept as the hub where fragmented passages
across every document meet.

```
┌ Concept ────────────────────────────────────────────────────────┐
│ 导数   aliases: 微商, derivative               [编辑]             │
│ “函数在某点的瞬时变化率”                                           │
│ ────────────────────────────────────────────────────────────────│
│ 📌 Passages (5) — across 3 documents                             │
│   📄 derivatives.pdf                                             │
│     ⤷ “f'(x)=lim Δy/Δx”                          [→ 打开定位]    │
│     ⤷ “切线斜率即导数”                            [→ 打开定位]    │
│   📄 physics/kinematics.html                                     │
│     ⤷ “瞬时速度是位移的导数”                      [→ 打开定位]    │
│ ────────────────────────────────────────────────────────────────│
│ 📝 Notes (3)   [PreviewCard] [PreviewCard] [PreviewCard]         │
│ ────────────────────────────────────────────────────────────────│
│ 🕸 Related concepts                                              │
│   导数 —depends_on→ 极限      导数 —explains→ 瞬时速度            │
│   ~ co‑occurs: 积分 (shares 2 passages) · 连续 (1 note)          │
│ ────────────────────────────────────────────────────────────────│
│ [＋ 新建关系]   [＋ 关联当前选区]                                  │
└──────────────────────────────────────────────────────────────────┘
```

### C.4 Concept graph view

A new `concept.graph` view (sibling of `concept.list`; register it like any view via
`registerView`, `conceptViews.tsx`): nodes = concepts (optionally anchors/notes as satellite nodes),
edges = `relation`s + computed co‑occurrence. Click a node → its concept page (C.3); filter by
subject/tag/layer.

*Code reality: there is NO existing graph renderer* (a repo grep finds only the `markmap` NOTE type /
`DiagramNote` — a note‑body renderer, not a concept graph). Recommendation: **start with a simple
hand‑rolled SVG/canvas force layout** (a tiny spring simulation over ≤ a few‑hundred nodes) — no new
dependency, matching the "prefer a simple SVG/canvas first" bias. Only if it doesn't scale, flag adding
a force‑graph dep (e.g. `d3-force`) as a follow‑up. Reuse `relation` data verbatim (`GET /api/relations`)
plus a co‑occurrence pass; no schema change.

### C.5 Capture flow — how concepts get created & linked

- **From a passage** (Anchor bar / selection toolbar, `anchorViews.tsx` `ActionGrid`): a
  **`关联到概念`** action — autocomplete over `entityClient.concepts()` (match name/alias), pick existing
  or **create new** inline → append the concept id to the anchor's `conceptIds` (a new
  `anchor.link-concept` command, mirroring `note.link-anchor`; API = `PATCH /api/anchors/:id { conceptIds }`,
  additive endpoint next to the existing note PATCH).
- **From a note** — the note card gains `＋ 关联概念` (the existing `concept.link-note` /
  `PATCH /api/notes/:id { conceptIds }`, already shipped — `concept-relation-ui.md` §4/§6). Just surface it
  on the card instead of only in the inspector's dropdown.
- **From the concept list / page** — `concept.create` (existing) + link the current selection
  (`＋ 关联当前选区` → `anchor.link-concept` on `focus`).
- **From AI** — a generated note can propose concept tags: the generation draft carries suggested
  concept names; on save, resolve/create them and set `conceptIds`. Fits the existing preview‑then‑save
  loop (`GeneratedDraft` → `savePendingDraft`) with an additive `suggestedConcepts` field; no new pipeline.

### C.6 Relationship to subject kits / marketplace

Concepts are **cross‑subject connective tissue** — one concept ("周期") can span a 数学 doc and a 物理
doc, each opened under a different Product Kit. Keep them **decoupled from kits**: concepts are core
entities (like anchors/notes), not kit‑owned, so a link never depends on a kit being active. A subject
kit MAY seed a starter concept vocabulary or bias AI concept suggestions, but the graph is global and
kit‑agnostic. Don't over‑couple: the concept layer must keep working with the `core` kit.

---

## Cross‑cutting

- **Adaptive‑note contract reaffirmed.** Notes still render ONLY via `getNoteType(contentType).render`
  (`noteTypeRegistry.tsx`, guarded by `contract.guard.test.ts`). B changes WHERE notes are resolved
  (per‑pane `notesForSource`) and painted (per‑pane `paintAnchors`); C adds concept VIEWS and reuses
  `PreviewCard`/`ArtifactCard` for note cards on the concept page. Neither adds a note‑render path.
- **Reuse map.**
  - Layout: `dock.ts` (`split`/`leaf`, add `tabs`), `presets.ts` (`WorkspaceNode.params.sourceId`),
    `views.tsx` `SourceViewerView` (read `node.params`), `rightSplit.ts` (tab‑group precedent).
  - Paint: the D1 `ReaderAnnotationAdapter` + the host `paintAnchors` feed (`note-presentation-unified.md`
    §1; `readerForSource.tsx`) — unchanged per reader, built per pane.
  - Authoring: `note.link-anchor` + `NoteAnchorControl` (`multi-anchor-note.md`); `concept.link-note` /
    `relation.create` + `ConceptInspector` (`concept-relation-ui.md`); the Anchor bar / selection toolbar
    (`anchorViews.tsx`, `SelectionFloatingToolbar.tsx`).
  - Schema/endpoints: `note.ts`/`anchor.ts`/`concept.ts`/`relation.ts`, `nodeRefSchema` (`common.ts`),
    `/api/concepts(:id)` · `/api/relations` · `PATCH /api/notes/:id` (`app.ts`).
  - Focus: `FocusContext` (`setAnchor`/`materializeAnchor`/`revealSeq`) — single global, unchanged.
- **Migration / back‑compat.** A is behind the `activeSource` shim (§A.1) — nothing breaks during the
  single→multi migration; panes convert incrementally. B is pure UI + selectors over existing data +
  the existing `note.link-anchor` — no schema/endpoint change. C's `anchor.conceptIds` is additive
  (`default([])`, migration‑free); the concept‑detail passage aggregation and `anchor.link-concept`
  endpoint are additive; the graph reuses existing relation data.

---

## Phasing (each independently shippable, with test notes)

- **P‑A1 — the big enabler.** Dock leaf carries `sourceId` + `PaneViewState`; `source.viewer` reads
  `node.params.sourceId`; `openPanes`/`focusedPaneId` state + `activeSource` shim; open‑in‑new‑tab +
  split‑to‑side; per‑source `SourceBundle` cache. Tabs = new `tabs` DockNode (or `source.tabs` view).
  *Tests:* unit — pure tree ops (open/close/split/focus, unwrap emptied splits) next to `dock.test.ts`;
  shim returns focused pane's source; e2e — open two docs (tab + split), focus routing targets the right
  pane, close collapses cleanly.
- **P‑A2 — cross‑doc paint.** `notesForSource(sourceId)` / `paintAnchorsForPane`; each pane paints its
  own source; per‑pane Layer Lens. *Tests:* unit — a note with anchors in A & B appears in
  `notesForSource(A)` and `notesForSource(B)` (extends the `annotations.test.ts` multi‑anchor test to two
  sources); e2e — a seeded shared note paints in both open panes; toggling a pane's layer hides it there
  only.
- **P‑B — cross‑doc authoring.** `note.link-anchor` across panes (focus a passage in another pane →
  append); grouped‑by‑source note card + open/reveal for closed docs; drag‑from‑anchor‑bar.
  *Tests:* extend `noteAnchorControl.test.tsx` (grouped rendering, open‑and‑reveal for a closed source);
  extend `e2e/multi-anchor.spec.ts` to two sources (the doc's own Deferred item).
- **P‑C1 — concept anchor‑linking + aggregation page.** `anchor.conceptIds` (schema) +
  `anchor.link-concept` command/endpoint; concept‑detail returns passages; concept page groups passages
  by document + PreviewCards + co‑occurrence. *Tests:* supertest — `PATCH /api/anchors/:id` links →
  `GET /api/concepts/:id` returns the anchor grouped by source; unit — co‑occurrence aggregation; e2e —
  tag two passages in different docs to one concept → both appear on the concept page → jump opens/reveals.
- **P‑C2 — concept graph view.** `concept.graph` SVG/canvas force layout over relations + co‑occurrence;
  click → concept page; subject/layer filter. *Tests:* unit — graph model builder (nodes/edges from
  relations + co‑occurrence, pure); e2e — nodes render, click navigates to the page.

**Smallest first slice that demonstrates the vision: P‑A1 + P‑A2** = *"open two documents split
side‑by‑side; a note anchored in both shows (paints) in both panes at once."* It proves A (multi‑pane
with per‑pane sourceId) and B's core (per‑pane paint of a shared note) with the least surface — the
shared note can be seeded via the existing `note.link-anchor` (once P‑A1 lets you focus a passage in the
second pane) or the note API, so no new authoring UI is required to see the payoff. P‑B (fluent
authoring) and P‑C (concepts) layer on after.

---

## Honest deltas — code reality vs. the brief's assumptions

1. **The dock has NO `tabs` node type.** `DockNode = split | leaf` only (`dock.ts`). "Tabs" today are a
   VIEW (`right.tabs`/`RightSidebarTabs` with `rightSplit.ts`), and the reader's single doc tab is
   hardcoded chrome (`views.tsx` L244). Part A's "tabbed dock container" must be ADDED — recommended as a
   new `tabs` DockNode. **Split**, by contrast, already works (`split("row",[…])`).
2. **Cross‑doc notes are a *deferred follow‑up*, not greenfield.** `multi-anchor-note.md` shipped
   `note.link-anchor` + multi‑anchor paint + the "Anchored at N places" card, and explicitly lists
   "Cross‑source multi‑anchor" as **Deferred**. Part B finishes that item; its blockers are exactly the
   single active source (no way to focus a passage in another doc) and jumps resolving via `ctx.anchors`
   (active source only) — both removed by A.
3. **`relation` already links anchor↔concept with zero schema change** (`nodeRefSchema` admits anchor &
   concept; `POST /api/relations` accepts them). This makes the "join" option free today, and informs the
   decision — but membership is still best embedded as `anchor.conceptIds` (§C.2).
4. **The concept page half‑exists but is passage‑blind.** `GET /api/concepts/:id` + `ConceptInspector`
   already show note back‑refs + relations; they show NO passages and are NOT grouped by source. Part C
   is additive over this, not a rewrite.
5. **Layer visibility is per‑note, not per‑anchor** (`multi-anchor-note.md` rejected finding). So a
   shared cross‑doc note paints in a pane iff that ONE note's `layerIds` intersect the pane's enabled set
   — clean, but note that per‑pane Layer Lens is new (today `enabledLayerIds` is global, L584).
