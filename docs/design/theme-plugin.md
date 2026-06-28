# Pluggable Theme / Appearance System

**Status: V1 Implemented (token layer + registry + switcher + Default/Dark); V1.5/V2 deferred.**

> 怎么让软件的主题/外观(配色、字体、组件皮肤等视觉风格)可以用"插件"整体换掉?
> i.e. swap the whole visual style — color palette, typography, component skins, light/dark — as a plug-in,
> while keeping the底层(core) clean and simple.

This is a **research + design proposal only**. No source/test/config files are changed by this document.

---

## 1. Context / problem

We want the app's **visual theme** — colors, typography, spacing, radii, and component skin colors,
plus light/dark variants — to be swappable as a unit ("插件整体换掉"), not edited component by component.

Scope boundary (important):

- **In scope:** the *visual* style — color ramps, text/bg/border colors, fonts, radius, spacing, light/dark.
- **Out of scope:** *layout* (which panes show and how they're arranged). That is already a separate, solved
  concern owned by the **dock layout engine** (`src/client/workspace/dock.ts`, `presets.ts`, `WorkspaceShell.tsx`,
  see `docs/design/layout-engine.md`). A theme must **not** touch layout, and the layout engine must not touch color.
  The two switchers can sit side by side in the reader header but stay orthogonal.

The user's standing value across this repo: **keep the core clean and simple.** Concretely that means:

- A theme is **data (CSS custom properties / design tokens)**, not code that rewrites components.
- Components stay **theme-agnostic** — they read `var(--token)`, they don't know which theme is active.
- We **reuse the existing plugin (Product Kit) seam and registry patterns** rather than inventing a parallel system.

The honest headline finding (see §2): **the codebase has no design tokens today** — colors are hardcoded as
raw hex literals throughout `src/client/styles.css`. So the *real first task* of any theme system is **tokenization**:
extract the palette into CSS variables. Once that exists, "swapping a theme" is just "override the variables at a
scope," which is trivial and clean. Without it, no theme plugin can do anything.

---

## 2. Current state (verified against real files)

### 2.1 Styling lives in one global stylesheet, loaded once

- The single stylesheet is `src/client/styles.css` (~1887 lines).
- It is imported exactly once, for its side effect, at the client entry: `src/client/main.tsx:4`
  (`import "./styles.css";`), which `createRoot(...).render(<App/>)` into `#root` defined in `index.html:9`.
- There is **no** `<link rel="stylesheet">` or inline `<style>` in `index.html` (it only loads
  `/src/client/main.tsx`), and no per-component CSS modules — every rule is global in this one file.

So there is exactly **one global CSS surface** to theme. Good: a token layer added here reaches the whole app.

### 2.2 There are NO design tokens today — colors are hardcoded

Grepping the whole `src/**` for `var(--`, `--color`, `--font`, `--space`, `--radius`, `data-theme`,
`prefers-color-scheme` returns **only `styles.css` itself**, and inside it there are **zero `var(--…)` usages**
and **no custom-property definitions**. The single `:root` block just sets literal values:

```css
/* src/client/styles.css:1 */
:root {
  color: #202124;
  background: #f4f1ea;
  font-family: Inter, "Segoe UI", Arial, sans-serif;
}
```

Everything else is raw hex/`rgba()` literals, repeated across many rules. The palette that actually recurs:

| Role (de-facto) | Literal(s) seen | Example call sites (paths) |
|---|---|---|
| App text | `#202124`, `#24302c`, `#39423e` | `styles.css:2,18,581`; `.icon-button` 1454; `.panel-title` 1471 |
| App background (warm paper) | `#f4f1ea` | `:root` 3; `body` 19; `.chat-source-empty` 1307 |
| Panel surface | `#fbfaf7` | `.library-panel`/`.study-panel`/`.concept-panel` 185; `.practice-panel` 202; many |
| Card surface | `#ffffff` | `.source-item` 563; `.concept-item` 241; `.note-edit-field` 1013; pervasive |
| Hairline border | `#d8d2c6` / `#ddd7cc` / `#e2dccd` | `.library-panel` 184; `.source-item` 561; inputs 1486; pervasive |
| **Accent (teal/green)** | `#2f6f64` (+ `#285c52`, `#1f5c4f`, `#edf6f3`) | `.source-item.active` 568; `.icon-button.primary` 1463; `.generation-preview` 1198; `.dock-resize:hover` 170 |
| Muted text | `#66756a`, `#68706a`, `#70766f`, `#5b6058` | `.brand-block p` 536; `.empty-state` 1536; many |
| Danger (red) | `#b3261e`, `#842020`, `#9a3127`, `#f4dada` | `.source-item-delete:hover` 618; `.error-box` 1745; `.status-error` 1732 |
| Warning (amber) | `#e0a800`, `#f0a500`, `#604510`, `#f5e8be` | `.annot-mode-toggle:hover` 1684; `.pdf-region-box` 715; `.status-loading` 1737 |
| "Success" green | `#1f6b4a`, `#2f7d54`, `#d6efe3` | `.tb-badge[...mastered]` 1149; `.sv-quiz-answer` 1065; `.layer-stat[matched]` 477 |
| Dark surfaces (terminal/code) | `#1e1b16`, `#1f2622`, `#2c2a26`, `#555049` | `.xterm-host` 796; `.sv-code-pre` 1078; `.note-rendered .sv-code` 947; `.pdf-reader-canvas` 681 |

The **same accent `#2f6f64`** appears in well over a dozen rules; the same paper `#f4f1ea` and card `#ffffff`
recur dozens of times. This is exactly the pattern that a token layer collapses into a handful of variables.

How component classes get their colors today: **directly, inline in each rule.** Examples:

- `.tb-card-kind { color: #66756a; }` (`styles.css:1124`) — the Textbook Kit card label.
- `.generation-preview { border:1px solid #cfe3dd; border-left:3px solid #2f6f64; background:#f3faf7; }` (1196).
- `.note-rendered code { background:#efe9dc; }` (916); toolbars `.selection-toolbar-btn`/`.source-actions-btn` (1347/1377).
- `.kit-select`, `.layout-select` (1688) — the existing reader-header dropdowns — also use literals.

None of these read a variable, so **no theme can change them yet.** Tokenizing them (mechanically replacing
literals with `var(--token)`) is the prerequisite.

### 2.3 No existing theme / dark-mode handling

- No `prefers-color-scheme` media query anywhere.
- No `[data-theme]` / `data-theme` attribute logic, no theme class toggling.
- The lone "dark" surfaces (terminal, code blocks, PDF/image canvas backdrop) are **hardcoded dark** regardless of
  any mode — they are intrinsic surface choices, not a dark *theme*.

**Conclusion:** there is one clean global stylesheet and a clear, small recurring palette, but **everything is
hardcoded**. The theme system's V1 is therefore "extract tokens + add a swap mechanism," not "write themes."

### 2.4 Precedents we can copy verbatim

The repo already implements *exactly the shape* a theme switcher needs, twice, for **layout** and **kits**:

- **A registry list + an active id + a context setter + a header `<select>`:**
  - `src/client/workspace/presets.ts` exports `LAYOUT_PRESETS` + `DEFAULT_LAYOUT_ID` + `getLayoutPreset(id)`.
  - `WorkspaceContext` holds `activeLayoutId`, `availableLayouts`, `setActiveLayout(id)`
    (`WorkspaceContext.tsx:188-192, 681-690`), persisting the choice to `localStorage` under
    `ACTIVE_LAYOUT_KEY = "sv-active-layout"` (`WorkspaceContext.tsx:47`).
  - The switcher UI is a `<select className="layout-select">` in the reader header
    (`src/client/workspace/views.tsx:223-236`). The Product Kit `<select className="kit-select">` sits right next to it
    (`views.tsx:237-251`). **A theme `<select>` is a third dropdown in this same `.reader-header-actions` row.**
- **A React-free contribution registry tagged by owner**, mirrored by the kit seam: `registerKitLanguage`
  (`src/kits/language.ts`), the surface/command sinks in `src/kits/clientContext.tsx`. A `registerTheme()` registry
  is the same trivial array/map-backed module.
- **Per-vault UI-state persistence** already exists: `GET/PUT /api/workspace` reads/writes
  `vault/.study/workspace.json` via `vault.storage` (`src/server/app.ts:834-855`), validated by
  `workspaceStateSchema` (`app.ts:175-178`, currently `{ activeLayoutId, layouts }`). The active **theme id** is a
  natural new field here when we want the choice to follow the vault rather than the browser.

So we are not inventing new machinery — we are adding a fourth instance of a pattern the codebase already uses three
times.

---

## 3. The theme model — token-based, not component rewrites

**Recommendation: a theme is a named set of design tokens (CSS custom properties).** Applying a theme = setting those
variables at a scope. Components never change; only the variable values do. This is the cleanest possible core: the
theme system owns *one* CSS variable layer and *one* attribute; everything else is untouched.

### 3.1 The token contract (the variable names)

Define a stable, small vocabulary of `--sv-*` tokens (prefixed to avoid collisions). The **default theme defines all
of them at `:root`**; every other theme overrides the same names. Components only ever reference these names.

```css
/* Base / default theme — lives at :root (or [data-theme="default"]). */
:root {
  /* —— Surfaces & text —— */
  --sv-bg:            #f4f1ea;  /* app paper background */
  --sv-surface:       #fbfaf7;  /* panel surface */
  --sv-surface-card:  #ffffff;  /* cards, inputs */
  --sv-text:          #202124;  /* primary text */
  --sv-text-strong:   #24302c;  /* headings / button labels */
  --sv-text-muted:    #66756a;  /* secondary text, captions */
  --sv-border:        #d8d2c6;  /* hairline border */
  --sv-border-soft:   #e2dccd;  /* lighter inner divider */

  /* —— Accent ramp (the teal/green) —— */
  --sv-accent:        #2f6f64;
  --sv-accent-strong: #285c52;  /* hover/pressed */
  --sv-accent-weak:   #edf6f3;  /* tinted active background */
  --sv-on-accent:     #ffffff;  /* text on a filled accent */

  /* —— Semantic status —— */
  --sv-danger:        #b3261e;  --sv-danger-bg:  #fff5f5;
  --sv-warn:          #8a6d1f;  --sv-warn-bg:    #f5e8be;
  --sv-success:       #1f6b4a;  --sv-success-bg: #d6efe3;

  /* —— Intrinsic dark surfaces (terminal/code/reader backdrop) —— */
  --sv-dark-surface:  #1e1b16;
  --sv-dark-text:     #e6e3da;

  /* —— Typography —— */
  --sv-font-sans: Inter, "Segoe UI", Arial, sans-serif;
  --sv-font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  --sv-font-size: 13px;

  /* —— Shape / rhythm —— */
  --sv-radius:    8px;
  --sv-radius-sm: 6px;
  --sv-radius-pill: 999px;
  --sv-space-1: 4px;  --sv-space-2: 8px;  --sv-space-3: 12px;  --sv-space-4: 18px;
}
```

These names map **1:1 onto the de-facto palette already in §2.2**, so tokenizing is a mechanical find-and-replace, not
a redesign. (The exact set can be trimmed/extended during V1; the principle is what matters.)

### 3.2 How a theme overrides tokens (scope)

A theme is just a `[data-theme="<id>"]` block (or `:root.<id>`) that **re-declares the same variables**:

```css
[data-theme="dark"] {
  --sv-bg:            #1b1a17;
  --sv-surface:       #232220;
  --sv-surface-card:  #2b2a27;
  --sv-text:          #e8e4da;
  --sv-text-strong:   #f2efe6;
  --sv-text-muted:    #a59f93;
  --sv-border:        #3a3833;
  --sv-accent:        #5fb6a4;
  --sv-accent-weak:   #1f3a35;
  --sv-on-accent:     #11221f;
  /* status / typography / radius inherit from :root unless a theme chooses to override */
}
```

The host applies a theme by setting **one attribute** on the root element:

```ts
document.documentElement.setAttribute("data-theme", themeId); // e.g. "dark"
```

Because every component reads `var(--sv-…)`, this single attribute flip restyles the entire app instantly, with no
re-render and no network. This is the whole "整体换掉" mechanism.

### 3.3 Light / dark, system preference, and multiple coexisting themes

- **Multiple themes coexist** as sibling `[data-theme="x"]` blocks — they don't conflict because only the matching
  attribute value is active. Themes can be *light* or *dark*; a theme just declares a `colorScheme: "light" | "dark"`
  in its registry metadata (used to set the CSS `color-scheme` property so native form controls / scrollbars match).
- **System preference** is supported with a thin convention: a built-in `"auto"` choice resolves at runtime via
  `window.matchMedia("(prefers-color-scheme: dark)")` to the registered light/dark theme. This is the only place we
  touch `prefers-color-scheme`, and it's optional for V1.
- **Theme vs. layout are orthogonal**: `data-theme` controls color/type; the dock engine controls arrangement. They
  never read each other's state.

### 3.4 Why token-based beats the alternatives (for the clean-core value)

- **Per-component skin objects / CSS-in-JS:** would require touching every component and a runtime styling dependency.
  Rejected — violates "keep core clean," and the app has no component-CSS layer to begin with.
- **Shipping a whole replacement `styles.css` per theme:** a theme could override *layout/structure* too, which we do
  **not** want (layout is the dock engine's job), and it duplicates 1800 lines per theme. Rejected as the default.
- **Token override block (recommended):** a theme is ~15–40 lines of variable declarations. The core stylesheet stays
  single-source-of-truth for *structure*; themes only swap *values*. Maximum reuse, minimum surface.

> Deliberately out of scope for the token model: **full per-component skin overrides** (a theme restyling
> `.tb-card`'s shape/spacing, not just its colors). That's a later extension (§5/§6) once tokens exist; richer themes
> can add their own scoped rules, but V1 deliberately limits a theme to *token values* so the contract stays small.

---

## 4. The plugin seam — register, switch, persist

Three pieces, each mirroring an existing precedent: **(a)** a registry, **(b)** a switcher UI, **(c)** persistence.

### 4.1 (a) Registration — a `registerTheme()` registry + an optional kit contribution

**The Theme type** (React-free; a theme is data + token values, no components):

```ts
// proposed: src/client/theme/registry.ts  (mirrors src/kits/language.ts)
export type Theme = {
  id: string;                       // "default" | "dark" | "high-contrast" | kit-supplied
  name: string;                     // shown in the switcher
  colorScheme: "light" | "dark";    // drives CSS `color-scheme`
  /** Token overrides, emitted as a [data-theme="id"] block. */
  tokens: Record<string, string>;   // e.g. { "--sv-bg": "#1b1a17", ... }
  builtin?: boolean;                // default themes vs plugin-supplied
};

const themes = new Map<string, Theme>();
export function registerTheme(theme: Theme): void { themes.set(theme.id, theme); }
export function listThemes(): Theme[] { return [...themes.values()]; }
export function getTheme(id: string): Theme | undefined { return themes.get(id); }
```

At startup, the host injects each registered theme's tokens into a single managed `<style>` element (one `<style>`,
keyed `data-sv-themes`, rebuilt from the registry), producing the `[data-theme="…"]` blocks of §3.2. The default theme
also seeds `:root`. **This keeps the theme layer in one place and out of `index.html`/individual components.**

**Two ways to ship a theme, both supported:**

1. **Standalone theme plugin (recommended primary path).** A theme is pure data, so it does **not** need the Product
   Kit machinery (kits exist for *behavioral verticals*: note types, commands, prompts, layer policy — see
   `src/kits/types.ts:1-10`). A theme has none of that. So the cleanest model is a **dedicated, lightweight theme
   registry** — a `themes` list registered for side effect, exactly like `productKits` in
   `src/kits/clientKits.tsx:8-10` registers kits. Built-in themes live in `src/client/theme/builtins.ts` and call
   `registerTheme(...)`.

2. **A Product Kit may also ship a theme.** For a vertical that wants a matching skin (e.g. a "Textbook" kit with a
   warmer palette), add **one optional field** to the kit contract — the only core change to the kit seam:

   ```ts
   // src/kits/types.ts — additive, optional, non-breaking
   export type ProductKit = {
     /* …existing… */
     theme?: Theme;   // optional: the kit also contributes a theme to the registry
   };
   ```

   `installClientKits` (`src/kits/clientContext.tsx:80-87`) gains one line:
   `if (kit.theme) registerTheme(kit.theme);`. This is purely additive — existing kits that omit `theme` are
   unaffected, honoring the "kits register-only, don't change core" iron law (`src/kits/types.ts:6-10`).

   > Note: a kit's theme is registered globally (it appears in the switcher); it is **not** auto-applied when the kit
   > is activated on a source. Theme is a *workspace-wide* visual choice (like layout), distinct from the *per-source*
   > kit activation gate (`src/kits/activation.ts`). Keeping them decoupled avoids per-document theme-thrash and keeps
   > the core simple. (Auto-suggesting a kit's theme on activation could be a later opt-in.)

   **Recommendation:** make the **standalone theme registry the backbone** (it's where built-ins and pure theme
   plugins live), and let `ProductKit.theme` be a thin optional adapter that funnels into the *same* registry. One
   registry, two registration doorways — no parallel systems.

### 4.2 (b) The switcher UI — a third dropdown in the reader header

Add `activeThemeId`, `availableThemes`, `setActiveTheme(id)` to `WorkspaceContext` (mirroring
`activeLayoutId`/`availableLayouts`/`setActiveLayout` at `WorkspaceContext.tsx:188-192, 681-690`). `setActiveTheme`:

1. `document.documentElement.setAttribute("data-theme", id)` and `style.colorScheme = theme.colorScheme`,
2. persists the choice (§4.3).

The control is a `<select className="theme-select">` placed in `.reader-header-actions` next to the existing layout
and kit selects (`src/client/workspace/views.tsx:223-251`):

```tsx
<select className="theme-select" aria-label="Theme"
        value={activeThemeId} onChange={(e) => setActiveTheme(e.target.value)}>
  {availableThemes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
</select>
```

`.theme-select` reuses the existing `.layout-select`/`.kit-select` rule shape (`styles.css:1688`) — which will itself
be tokenized in V1, so the switcher is on-theme too.

### 4.3 (c) Persistence — per-vault, like workspace prefs

Two consistent options; **recommend mirroring the layout precedent for symmetry**:

- **Browser-local (V1 minimal):** `localStorage` under `"sv-active-theme"`, exactly like `ACTIVE_LAYOUT_KEY`
  (`WorkspaceContext.tsx:47`). Zero server changes; ships fastest.
- **Per-vault (recommended end-state):** add `activeThemeId?: string` to `workspaceStateSchema`
  (`src/server/app.ts:175-178`) so the choice persists in `vault/.study/workspace.json` via `vault.storage`
  (`app.ts:834-855`) and follows the vault across machines — the same rationale the workspace doc gives for storing
  layout in the vault rather than `localStorage` (`docs/design/frontend-workspace-redesign.md:335`). This is a
  one-field, backward-compatible schema addition (`emptyWorkspaceState` gains a default).

Since `activeLayoutId` is itself currently `localStorage`-backed in the client, V1 can stay `localStorage` and a later
pass can migrate **both** layout and theme into `workspace.json` together.

---

## 5. Migration / impact / risks

**The one real work item: tokenize `styles.css`.** Mechanically replace recurring literals with `var(--sv-…)`,
following the §2.2 table. This is the bulk of the effort and the only change to existing CSS. It is low-risk because:

- It's a **value-preserving refactor** — the default theme's tokens are exactly today's literals, so the app looks
  pixel-identical after tokenization. (A snapshot/visual check on the default theme is the acceptance test.)
- It can be **incremental**: tokenize the high-traffic core palette first (bg/surface/card/text/border/accent/danger
  /warn/success). Niche one-off literals (e.g. specific marquee/region colors) can stay hardcoded initially — they
  simply won't theme yet, which is fine and honest for V1.

**How we avoid editing every component:** components are styled by **class rules in one stylesheet**, and those rules
read `var(--sv-…)`. So we edit *rules*, never the React components — `App.tsx`, `views.tsx`, `WorkspaceShell.tsx`,
the kit note-type plugins, etc. are untouched. A new theme adds variable values; it never touches a `.tsx`.

**Backward compatibility:** all additions are optional/additive — `ProductKit.theme?`, a new client `theme/` module,
an optional `workspaceState.activeThemeId`. Nothing existing breaks; with no theme chosen, `:root` defaults apply and
the app is unchanged.

**FOUC / flash-on-load and on-swap:**

- *On swap:* none — flipping `data-theme` is synchronous and components just re-resolve `var()`; no React re-render,
  no network. This is strictly better than re-importing a stylesheet.
- *On load:* the default theme lives at `:root` in the bundled `styles.css`, so first paint is already correct for the
  default. The risk is only when the **persisted choice is non-default**: the saved id must be applied **before first
  paint**. Mitigation: read the stored theme id and set `data-theme` synchronously as early as possible (an inline
  bootstrap in `index.html`/`main.tsx` before React mounts, or — for the per-vault case — accept one frame of default
  until `/api/workspace` resolves, the same trade-off the layout pref already makes). Keeping the default at `:root`
  bounds any flash to "default → chosen," never "unstyled → styled."

**Risks / watch-items:**

- **Token coverage gaps:** a literal missed during tokenization won't follow the theme (e.g. a dark theme with a
  stray light hardcoded border). Mitigated by the §2.2 inventory + a lint/grep guard for raw hex in `styles.css`.
- **Contrast in dark/high-contrast themes:** intrinsic dark surfaces (terminal/code) already assume light-on-dark; a
  dark *theme* must not double-darken them. Handled by giving those their own `--sv-dark-*` tokens (§3.1) so the theme
  controls them deliberately rather than by accident.
- **Third-party widget chrome** (xterm, pdf.js, KaTeX, cytoscape) renders with its own colors; a theme can re-skin
  the *container* tokens but full internal theming of those libs is out of scope for V1.

**Explicitly out of scope (now):** full per-component skin overrides (a theme restyling component *structure/shape*,
not just token values); animated theme transitions; user-authored custom themes via UI. All are natural follow-ons
once the token layer + registry exist.

---

## 6. Staged plan

**V1 — tokenize + registry + switcher + 2 built-in themes.** Deliverable: you can pick "Default / Dark" from a header
dropdown and the whole app re-skins, with the default looking identical to today.

Files to **add**:

- `src/client/theme/registry.ts` — `Theme` type + `registerTheme` / `listThemes` / `getTheme` (mirrors
  `src/kits/language.ts`).
- `src/client/theme/applyTheme.ts` — injects the managed `<style data-sv-themes>` from the registry, and
  `setActiveTheme(id)` (sets `data-theme` + `color-scheme` on `<html>`).
- `src/client/theme/builtins.ts` — registers `default` (light) + `dark` (and/or `high-contrast`); imported for side
  effect like `src/kits/clientKits.tsx`.
- (tests) `src/client/theme/registry.test.ts`, `applyTheme.test.ts` — register/list/get + attribute flip; a unit test
  asserting the default theme's tokens equal the documented base palette.

Files to **change**:

- `src/client/styles.css` — **the main task:** define the `--sv-*` tokens at `:root` (§3.1) and replace recurring
  literals with `var(--sv-…)` per §2.2. Value-preserving; default unchanged.
- `src/client/workspace/WorkspaceContext.tsx` — add `activeThemeId` / `availableThemes` / `setActiveTheme`
  (mirror the `activeLayoutId` block at lines 188-192, 681-690); persist to `localStorage["sv-active-theme"]` in V1.
- `src/client/workspace/views.tsx` — add the `.theme-select` dropdown in `.reader-header-actions` (next to lines
  223-251).
- `src/client/main.tsx` (or a tiny inline script in `index.html`) — apply the persisted theme id before React mounts
  (FOUC guard).

**V1.5 — kit-contributed themes + per-vault persistence (small, optional):**

- `src/kits/types.ts` — add optional `theme?: Theme` to `ProductKit`; `src/kits/clientContext.tsx` — one line in
  `installClientKits` to `registerTheme(kit.theme)`.
- `src/server/app.ts` — add `activeThemeId?` to `workspaceStateSchema` (+ `emptyWorkspaceState` default); client
  reads/writes it via the existing `/api/workspace` so theme follows the vault (and migrate layout alongside it).

**V2+ (deferred):** richer per-component skin overrides (themes adding scoped rules beyond tokens), `auto` /
`prefers-color-scheme` resolution, animated transitions, user-authored themes. None required for the core promise.

---

## 7. End goal — Obsidian-style open CSS (V1 is the foundation, not a detour)

The intended **end state** is full Obsidian-parity theming: a theme can (a) override the
design tokens, (b) write **arbitrary CSS** to re-skin any component, (c) declare
**user-tunable knobs** (Style Settings style) over its variables, and (d) coexist with
user **CSS snippets** (toggleable local overrides). **Reaching it from V1 needs no
rework — every later piece is additive on V1's seams:**

| Obsidian-style feature | How it lands on V1 (additive, nothing undone) |
| --- | --- |
| Override variables | **Is** V1 — the `--sv-*` token layer. Unchanged. |
| Arbitrary-CSS component re-skin | `Theme` gains an optional `css?: string` (or a full `theme.css`); `applyTheme` already owns a managed `<style>`, so it just *also* injects the theme's raw CSS, scoped under the theme's `[data-theme]`. Registry / switcher / persistence untouched. |
| Style Settings (tunable knobs) | A theme declares which variables are user-adjustable (+ control type); a settings UI writes user overrides into a user-scope `<style>` / inline vars. Sits entirely on top of the token layer — it just lets users set token values. |
| CSS snippets | A user list of small CSS strings toggled on/off, injected after the theme through the same `applyTheme` style layer. |

So the `Theme` type and the `applyTheme` injector **grow**; nothing in V1 is undone. The
single extension point is the **managed style-injection seam** in `applyTheme`: V1 injects
token blocks; V2 also injects raw theme CSS, then user overrides, then snippets (a fixed
cascade order).

**The only way V1 causes rework is if it's built carelessly. Two V1 rules prevent that:**

1. **Design the `--sv-*` vocabulary for the end state, not just today's palette.** Make it
   reasonably complete and *semantic* (`--sv-accent`, `--sv-surface-card`, …), not ad-hoc.
   Obsidian's whole theme ecosystem rests on a rich, stable variable vocabulary; a thin /
   ad-hoc V1 set would force a painful re-tokenization later.
2. **Treat component class names + structure as a semi-public contract.** The moment themes
   can write arbitrary selectors, `.tb-card` / `.note-list` / `.generation-preview` etc.
   become a public surface. Keep them semantic and stable (ideally documented) so opening
   CSS later doesn't break every theme on a refactor.

Neither is extra work — it is "do V1 thoughtfully." Doing tokens **first** is in fact the
*lowest-rework* path to the Obsidian model: Obsidian itself is token-first + open CSS, and
jumping straight to open CSS without a token layer would have themes hacking unstable
internals from day one.

---

## 8. Summary

- **Theme model:** a **token-based theme** — a named set of CSS custom properties (`--sv-*`: color ramps, text/bg
  /border, typography, radius, spacing) declared at `:root` for the default and overridden under `[data-theme="id"]`.
  Swapping = flipping one `data-theme` attribute; components stay theme-agnostic (`var(--…)`), so the core stays clean
  and no component is rewritten.
- **Plugin seam:** a small **standalone `registerTheme()` registry** (mirroring `src/kits/language.ts` /
  `clientKits.tsx`) as the backbone, plus an **optional `ProductKit.theme?`** funneling into the *same* registry — two
  doorways, one system, no parallel machinery. Switcher = a third `<select>` in `.reader-header-actions`
  (`views.tsx:223-251`) backed by `activeThemeId`/`setActiveTheme` in `WorkspaceContext` (mirroring the layout
  switcher); persistence via `localStorage` in V1, graduating to `activeThemeId` in `workspace.json`
  (`app.ts:175-178, 834-855`) for per-vault.
- **The V1 first step (and the real work):** **tokenize `src/client/styles.css`** — extract the hardcoded palette
  (today there are zero design tokens; only literals) into `--sv-*` variables value-for-value, then add the registry
  + switcher + a `dark` theme. Everything else is small and additive.

---

## 9. Implementation log

V1 shipped exactly as designed in §3/§4/§6: a token layer at `:root`, a React-free registry, a managed `<style>`
injector + one `data-theme` attribute flip, a third header dropdown, Default + Dark built-ins, and a value-preserving
tokenization of the global stylesheet. The plan's V1.5 (kit-contributed themes, per-vault persistence) and V2+
(arbitrary-CSS re-skin, Style Settings, snippets, `auto`/`prefers-color-scheme`) remain **deferred** — §7's end-goal
and the staged plan stand unchanged.

### 9.1 Files changed (final on-disk state)

New (`src/client/theme/`):

- `registry.ts` — `Theme` type + `registerTheme` / `listThemes` / `getTheme` + a `resetThemes()` test hook (mirrors
  `src/kits/language.ts`).
- `applyTheme.ts` — owns the managed `<style data-sv-themes>` (`injectThemeStyles`), the `setActiveTheme(id)` attribute
  flip, `readPersistedThemeId()`, and `THEME_STORAGE_KEY = "sv-active-theme"`.
- `builtins.ts` — `DEFAULT_THEME_TOKENS` (full vocabulary) + `DARK_THEME_TOKENS` (override-only) + `registerTheme(...)`
  for `default` (light) and `dark`; exports `DEFAULT_THEME_ID` / `DARK_THEME_ID`.
- `registry.test.ts`, `applyTheme.test.ts` — registry behaviour, the value-preservation guard, and the injector /
  attribute-flip / fallback / persistence reads.

New e2e: `e2e/theme-switch.spec.ts`.

Changed (tracked) — `git diff HEAD --stat`:

```
 src/client/main.tsx                       |   9 +
 src/client/styles.css                     | 613 +++++++++++++++++-------------
 src/client/workspace/WorkspaceContext.tsx |  48 ++-
 src/client/workspace/views.tsx            |  18 +-
```

(`src/client/theme/*` and `e2e/theme-switch.spec.ts` are still untracked, so they don't appear in the stat above.)

- `styles.css` — the bulk of the work: the `:root` token block (§9.2) plus the literal→`var(--sv-*)` rewrite (~262
  `var(--sv-*)` usages now; ~99 deliberate one-off hex literals remain per §9.7).
- `WorkspaceContext.tsx` — `activeThemeId` / `availableThemes` / `setActiveTheme` added as a strict **sibling** of the
  layout switcher (it never reads `activeLayoutId`); seeded from `localStorage` via `loadActiveTheme()`, the setter
  flips `<html>` and persists.
- `views.tsx` — the `<select className="theme-select">` in `.reader-header-actions`, next to the layout + kit selects.
- `main.tsx` — registers built-ins + injects styles + applies the persisted theme **before** `createRoot().render`
  (the FOUC guard).

### 9.2 The `--sv-*` vocabulary shipped

63 token definitions at `:root` in `styles.css`, grouped semantically: surfaces & text
(`--sv-bg`, `--sv-surface`, `--sv-surface-card`, `--sv-surface-tag`, `--sv-surface-muted`, `--sv-active-bg`,
`--sv-select-bg`, `--sv-select-text`, `--sv-icon-muted`, the `--sv-text-*` family, the `--sv-border*` family); the
accent ramp (`--sv-accent`, `-strong`, `-weak`, `-weak-hover`, `-border`, `-text`, `-text-strong`, `-weak-preview`,
`--sv-on-accent`); semantic status (`--sv-danger*`, `--sv-warn-*`, `--sv-fuzzy-*`, `--sv-success`, `-strong`, `-bg`);
intrinsic dark surfaces (`--sv-dark-surface*`, `--sv-reader-backdrop`, `--sv-dark-text*`); component accents
(`--sv-chat-user-bg`, `--sv-chat-assistant-bg`, `--sv-bookmark-dot`); typography (`--sv-font-sans/-mono`); and
shape/rhythm (`--sv-radius*`, `--sv-space-1..4`). The names map 1:1 onto the §2.2 de-facto palette; each value is the
exact literal it replaces, so the default renders byte-identical.

### 9.3 Registry, applyTheme injector, and built-ins

A theme is pure data (`{ id, name, colorScheme, tokens, builtin? }`). `injectThemeStyles()` builds one managed
`<style data-sv-themes>` from the registry — the default theme emits `:root, [data-theme="default"]` (re-seeding root
so the bundled stylesheet and the registry agree), every other theme emits `[data-theme="id"]` override-only blocks.
Re-injection updates the existing element rather than duplicating it. `setActiveTheme(id)` is the whole "整体换掉"
mechanism: it sets `data-theme` + `style.colorScheme` on `<html>`, with an unknown id falling back to default without
throwing. Dark is override-only and deliberately **omits** the intrinsic dark surfaces (`--sv-dark-*`,
`--sv-reader-backdrop`) and the type/radius/space scales so terminal/code/pdf backdrops don't double-darken.

### 9.4 Switcher + FOUC guard

The switcher is a `.theme-select` dropdown in `.reader-header-actions`, a sibling of the layout/kit selects, backed by
`activeThemeId`/`setActiveTheme` in `WorkspaceContext` and persisted to `localStorage["sv-active-theme"]`. The FOUC
guard lives in `main.tsx`: built-ins are registered, styles injected, and the persisted theme applied **before** React
mounts. Because `styles.css` carries the default tokens at `:root`, any flash is bounded to default→chosen, never
unstyled→styled.

### 9.5 Value-preservation approach + its test

The default theme's tokens are the original literals, value-for-value, so tokenization is a pure refactor. This is
enforced by `registry.test.ts`'s `default theme value-preservation` block: a frozen `EXPECTED_BASE_PALETTE` map that
`DEFAULT_THEME_TOKENS` must `toEqual`, so any drift in `builtins.ts` fails the build. A second case asserts Dark
overrides only a subset and never declares an intrinsic-dark-surface token. Three sources stay in lockstep: `:root` in
`styles.css`, `DEFAULT_THEME_TOKENS`, and `EXPECTED_BASE_PALETTE`.

### 9.6 The dark theme

`DARK_THEME_TOKENS` inverts the surface/text/border/accent/status families for a dark UI (e.g. `--sv-bg: #1b1a17`,
`--sv-surface-card: #2b2a27`, `--sv-accent: #5fb6a4`, `--sv-on-accent: #11221f`), and re-themes the component accents
(`--sv-chat-*`, `--sv-bookmark-dot: #74a9f0`). It omits the intrinsic dark surfaces and the type/radius/space scales,
which inherit `:root`.

### 9.7 Review findings — fixed / rejected

A review against the tokenized stylesheet flagged hardcoded colors that wouldn't follow a theme. 13 new tokens were
added value-for-value and the offending rules rewritten; the value-preservation guard (§9.5) keeps `:root` /
`DEFAULT_THEME_TOKENS` / `DARK_THEME_TOKENS` / `EXPECTED_BASE_PALETTE` all in sync.

Fixed:

- **Quiz answer + success palette (high/medium, two reports of the same line).** `.sv-quiz-answer` `#2f7d54` → new
  `--sv-success-strong` (default `#2f7d54`, dark `#74c695`). The alt-fix of mapping it to `--sv-success` (`#1f6b4a`)
  was **rejected** as a pixel regression. The duplicate report's claim that the default "won't be pixel-identical" is
  incorrect — the default token equals the original literal, so the default renders byte-identical; the real gap was
  dark-mode, now fixed.
- **Bookmark dot (high).** `.sv-bookmark-dot` `#3b82f6` → `--sv-bookmark-dot` (default `#3b82f6`, dark `#74a9f0`).
- **Warning / fuzzy status (high).** Recurring `#fbeed2` / `#8a6d1f` → `--sv-fuzzy-bg` / `--sv-fuzzy-text` on
  `.layer-stat[fuzzy]` and `.layer-preview-anchor[fuzzy]`.
- **Chat backgrounds (medium).** `#e8efe4` / `#f2ede0` → `--sv-chat-user-bg` / `--sv-chat-assistant-bg`.
- **Generation preview (medium).** `.generation-preview` `#f3faf7` → a **value-preserving** `--sv-accent-weak-preview`
  (default `#f3faf7`, dark `#1f3a35`). The suggested map to `--sv-accent-weak` (`#edf6f3`) was **rejected** — it would
  drift the default by one shade.
- **Select dropdowns (high).** `#fffdf5` / `#5c5340` → `--sv-select-bg` / `--sv-select-text`, applied to
  `.kit-select` / `.layout-select` / `.theme-select` **and** `.annot-mode-toggle`, which share the literals.
- **Hardcoded `#fff` (medium).** `.dock-collapse-btn:hover` `#fff` → `var(--sv-surface-card)` (value-preserving,
  `#fff === #ffffff`).
- **Broader hardcoded subset (medium).** Added `--sv-surface-muted` (`#f1ece1`), `--sv-active-bg` (`#e2efe9`),
  `--sv-accent-text-strong` (`#1f534b`), `--sv-icon-muted` (`#8a8579`); tokenized `.composer-mode`, `.anchor-chip`,
  `.tree-row` hover/active/svg, and `.tree-hint`.

Rejected / not done:

- The "tokens redundantly defined in both bundled and injected stylesheets" finding (low) is **by design** — `:root`
  in `styles.css` gives a correct first paint with zero JS; the injector re-seeds the same values from the registry so
  the two agree (the guard enforces it). Not a redundancy to remove.
- **Deliberately left hardcoded** per §5 (niche V1 one-offs that won't theme in dark yet, not regressions): bookmark
  chip border/bg `#d7ddd5` / `#f3f6f1`; dock-rail `#e3ddcf` / `#efeadf` / `#5f5a4e`; `.annot-mode-toggle:hover`
  `#fdf4d6`; `.link-button` `#2f6f4f`. A later coverage pass can tokenize these.

### 9.8 Tests

- Unit: registry + value-preservation guard + injector/flip/fallback/persistence pass (the CSS-only tokenization is
  covered by the value-preservation guard).
- e2e: `e2e/theme-switch.spec.ts` (no new file was needed beyond it) drives the real reader-header dropdown — boots on
  default (`<html data-theme="default">`, body bg `rgb(244,241,234)`), switches to Dark (attribute + color-scheme flip,
  body bg `rgb(27,26,23)`), switches back, and verifies persistence across reload (localStorage `sv-active-theme`).
  Type-check, unit, and e2e all pass.
