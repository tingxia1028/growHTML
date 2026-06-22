# GrowHTML

GrowHTML is a local HTML learning-material workspace:

- GrapesJS canvas for direct visual editing
- Cursor-style selected-region prompt box
- One document-bound Claude Agent SDK session
- One document-bound Codex CLI session
- Local persistence for HTML, CSS, GrapesJS project data, and thread history

## Run

```powershell
cd C:\utopia\growHTML
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

The API runs on:

```text
http://127.0.0.1:4177
```

## Claude

The server uses `@anthropic-ai/claude-agent-sdk` and resolves your local `claude` executable from PATH. On this machine it found:

```text
C:\Users\Admin\.local\bin\claude.exe
```

You can override this with:

```powershell
$env:CLAUDE_CODE_EXECUTABLE="C:\path\to\claude.exe"
```

or create a `.env` file:

```text
CLAUDE_CODE_EXECUTABLE=C:\path\to\claude.exe
ANTHROPIC_API_KEY=your-key-if-needed
```

## Codex

The server also supports local Codex CLI through `codex exec`.

On this machine, `codex --version` returned:

```text
codex-cli 0.130.0-alpha.5
```

You can override the Codex executable with:

```powershell
$env:CODEX_EXECUTABLE="C:\path\to\codex.cmd"
```

or in `.env`:

```text
CODEX_EXECUTABLE=C:\path\to\codex.cmd
CODEX_API_KEY=your-key-if-needed
```

Codex is launched in read-only mode:

```text
codex --search --sandbox read-only exec ...
```

GrowHTML applies the returned HTML only after you click `应用并保存`.

## Workflow

1. Start on the home dialog.
2. Generate a new HTML document, import one `.html` file, or import a folder.
3. The document opens in preview/read mode by default.
4. Double-click the preview to enter GrapesJS edit mode.
5. In edit mode, click a section/card/paragraph in the canvas.
6. Describe what you want in the right panel.
7. Claude or Codex returns a scoped replacement HTML fragment.
8. Click `应用并保存`.

## Folder Import

Use `导入文件夹` when your HTML was generated as a folder with assets.

GrowHTML will:

- read all files selected by the folder picker
- load `index.html` first when it exists, otherwise the first `.html` file
- show a page selector when the folder contains multiple `.html` files
- preserve `html` and `body` attributes such as `class`, `style`, and `data-theme`
- inline local stylesheet links into the GrapesJS CSS panel
- convert local image/CSS `url(...)` assets to data URLs so the saved standalone export keeps rendering

The folder picker depends on Chromium/Edge's directory upload support, which is available in the local Vite browser flow.

If an imported page looked white in older builds while direct-open looked blue, it was usually because the importer dropped `body/html` theme attributes. Current imports preserve those attributes and apply them to preview/export and the GrapesJS canvas.

Agent conversations are persisted by session id in:

```text
data\documents\main\thread.json
```

Saved document files:

```text
data\documents\main\content.html
data\documents\main\style.css
data\documents\main\shell.json
data\documents\main\project.json
data\documents\main\index.html
```

`index.html` is a standalone export you can open directly.

## Notes

Claude is configured to return structured JSON with `replacementHtml`, `summary`, `sources`, and `confidence`. It is allowed to use `WebSearch` and `WebFetch`, and file-writing tools are blocked.

Codex uses `codex exec --output-schema` for the first turn and `codex exec resume <sessionId>` for later turns. Codex file edits are not used; GrowHTML applies changes only after you click the apply button.
