# Workspace Runtime — ViewRegistry, WorkspaceContext, WorkspaceShell (P3)

This is the landing doc for **P3** of the frontend re-abstraction
(`frontend-workspace-redesign.md` §P3). It turns the hard-coded three-pane
`Workspace` component into a **layout of nodes rendered through a ViewRegistry**, so
the main UI is no longer fixed JSX. The kernel (FocusProvider, EntityClient, the
CommandRegistry, the SurfaceReader contract) is reused **unchanged at the API level**.

> **Behaviour-preserving.** This is an internal restructure: the rendered DOM is
> identical. All 16 e2e (9 web + 7 electron) stay green with **no selector edits** —
> that is the guardrail proving the UI didn't change. Note schema, kernel APIs, and
> the surface contract are untouched.

## The shape after P3

```
App.tsx
  └ <FocusProvider>                     (kernel — unchanged)
      └ <WorkspaceProvider>             (shared state + actions; useWorkspace())
          └ <WorkspaceShell layout={threePane} />
                └ for each node in layout.nodes:
                     renderNode(node, ctx)  →  ViewRegistry  →  the view's React
```

`App.tsx` is now ONLY the composition root above — no panel JSX, no
`activeViewer.kind === …` reader branching. Success check (met): adding a new view =
register a plugin + add its node to a preset, **zero other App edits**.

## 1. ViewRegistry — `src/client/workspace/viewRegistry.tsx`

The plugin seam that maps a node `kind` → a React renderer.

```ts
type WorkspaceViewPlugin = {
  kind: string;
  render(node: WorkspaceNode, ctx: WorkspaceContext): React.ReactNode;
};

registerView(plugin): void          // register (later wins for the same kind)
getView(kind): WorkspaceViewPlugin | undefined
listViews(): readonly WorkspaceViewPlugin[]
renderNode(node, ctx): React.ReactNode   // resolve + render; unknown kind → inert
                                         // `.workspace-node-missing` placeholder
```

- `WorkspaceNode = { id; kind; params? }` is reused from `entityClient` types (it is
  the same shape the persisted `WorkspaceLayout.nodes` use).
- `WorkspaceContext` (the render arg) is an alias for the value `useWorkspace()`
  returns (below).
- **Unknown kind is handled gracefully** (no throw) so a stale/typo'd preset can't
  crash the shell.

**Iron law:** views collaborate ONLY through the WorkspaceContext (which is itself
backed by Focus / Command / EntityClient). A view never reaches into a sibling view.

## 2. WorkspaceContext — `src/client/workspace/WorkspaceContext.tsx`

`WorkspaceProvider` holds **all** the state + actions that used to live inline in the
old `Workspace` component, and `useWorkspace()` exposes them. This is the relocation
target — the logic moved verbatim, only its home changed.

What it exposes (the union of what the three panels need — a single explicit seam):

- **status**: `status`, `error`.
- **sources**: `sources`, `activeSourceId`, `activeSource`, `activeViewer`,
  `setActiveSourceId`, `loadSources`, `deleteSourceItem`.
- **reader data**: `renderedHtml`, `anchors`, `notes`, `patches`, the
  `paintAnchors` memo (ONE normalized `PaintAnchor[]` for the active source), and
  `activePatches` (scoped to the focused anchor).
- **open / import**: `canOpenLocal`, `folderRoot`/`setFolderRoot`, `activeFilePath`,
  `importUrl`/`setImportUrl`, `openLocalFile`, `openFileDialog`, `openFolderDialog`,
  `importFromUrl`, `openLiveUrl`.
- **study panel**: `chatMessages`, `composerMode`/`setComposerMode`,
  `noteContentType`/`setNoteContentType`, `chatInput`/`setChatInput`,
  `patchHtml`/`setPatchHtml`, `showTerminal`/`setShowTerminal`, `activeFileDir`,
  `draftQuote`, `hasRegionDraft`, `composerDisabled`, `submitComposer`, `dispatch`,
  `selectedTextOr`, `changePatchStatus`.
- **kernel**: `focus` (the `useFocus()` value, passed through unchanged).

`dispatch(commandId, payload)` builds the shared `CommandContext` (focus + entity
client + chat context + the `onNoteCreated`/`onPatchCreated`/`onChatHistory`/
`onAssistantMessage` action callbacks) and runs the command via `runCommand` — the
same wiring App had. The two mount effects (load sources on mount; load a source's
workspace when `activeSourceId` changes) and the patch-textarea-seeding effect moved
here too.

## 3. View plugins — `src/client/workspace/views.tsx`

The three panels, each registered as a view and rendering the **same DOM** it did
inline:

| kind | renders | DOM (unchanged) |
| --- | --- | --- |
| `library` | sources list, Open file/folder, URL import | `.library-panel` aside |
| `source.viewer` | header + the active source's reader | `.reader-panel` main (`.reader-header h2`, then the reader) |
| `study` | chat-box (source chip + chat log + composer + note-list + patch-fold) **and** terminal-box | `.study-panel` aside (`> .chat-box`, `> .terminal-box`) |

Importing `views.tsx` runs the `registerView(...)` calls (side effect).

### `study` kept as ONE view (not split)

The mission allowed splitting `study` into `ai.chat` / `note.list` / `patch.review` /
`terminal` **only if the DOM stays identical**. It was **kept as one view** for P3
because the e2e depend on the exact `.study-panel > .chat-box` / `.terminal-box`
structure, and the chat-box's chip / chat-log / composer / note-list / patch-fold all
read shared draft + composer state in one flow — splitting them risks the DOM.
Splitting it later (when the finer views can be proven to emit the identical tree) is
a follow-up, not a P3 requirement.

### `source.viewer` reader resolution — `src/client/workspace/readerForSource.tsx`

The per-surface reader `if/else` that used to live inline in App's `.reader-panel`
(the `activeViewer.kind === "webview" | "pdfjs" | "image" | "file" | "html"` chain)
moved into `readerForSource({ source, anchors, onSelect, renderedHtml })`. It returns
the right reader element (or the `.empty-reader` fallback) so **App has no
per-surface reader branching**. Every annotatable reader still gets the uniform
contract — `anchors={paintAnchors}` (it filters by `anchorKind`) +
`onSelect={focus.setDraft}` — and only its own source locator differs.

> Adding a viewer = map its surface in `readerForSource` + (if it's a new source
> type) register a `SourceViewer` in `viewers.ts`. No host edits.

## 4. WorkspaceShell + the threePane preset

- **`src/client/workspace/presets.ts`** — `threePane` is a `WorkspaceLayout`:
  ```ts
  { id, name, mode: "dock", layout: "three-pane",
    nodes: [{ kind: "library" }, { kind: "source.viewer" }, { kind: "study" }] }
  ```
  Node order matters: the shell renders them left→right into `.app-shell`, so the
  order reproduces the original library → reader → study layout.
- **`src/client/workspace/WorkspaceShell.tsx`** — `<WorkspaceShell layout />` renders
  `.app-shell` and maps `layout.nodes` → `renderNode(node, ctx)` in order. It also
  side-effect-imports `./views` so the built-in plugins are registered. It is
  layout-agnostic: it knows nothing about the specific panels.

## 5. How to add a new view / preset

1. Write the view component (read everything from `useWorkspace()` / `useFocus()` —
   never from a sibling).
2. `registerView({ kind: "my.view", render: (node, ctx) => <MyView ctx={ctx} /> })`
   (in `views.tsx` or any module the shell imports).
3. Add `{ id: "my-view", kind: "my.view" }` to a preset's `nodes` (e.g. a new preset,
   or `threePane`).
4. Done — no `App`/`WorkspaceShell` edits. A param-driven view (e.g. a `source.viewer`
   pinned to a specific `sourceId`) reads `node.params` in its `render`.

## 6. Tests (the guardrail)

- **`viewRegistry.test.tsx`** — register → `getView`; `renderNode` invokes the
  plugin with the node + ctx; unknown kind → inert placeholder (no throw); later
  registration wins; `listViews` includes the built-in panel kinds. (Renders via
  `react-dom/client` + React 19 `act` under jsdom; mocks the surface reader modules
  so the `PdfReader → pdfjs-dist` import chain doesn't need a canvas in jsdom.)
- **`WorkspaceShell.test.tsx`** — given the `threePane` preset, the shell renders the
  three pane containers (`.library-panel` / `.reader-panel` / `.study-panel`) into
  `.app-shell`, in node order, with no `.workspace-node-missing` placeholders.

Full P3 gate: `tsc --noEmit` clean · vitest **208** (200 + 8 new) · web e2e **9** ·
electron e2e **7** — all green, **no e2e selector changes**.
