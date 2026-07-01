# Markdown Viewer Plugins

Status: accepted direction  
Date: 2026-07-01

## Decision

Growte should support a lightweight plugin model that is separate from Product
Kits.

The plugin model is for ordinary file-level tools such as calendar, kanban,
tasks, tables, whiteboards, and custom markdown databases. The bottom layer stays
as Markdown files. A plugin only owns how matching Markdown files are interpreted,
viewed, edited, and acted on.

Product Kits remain useful for vertical product packaging and domain language.
Markdown viewer plugins are simpler: they do not rename the app, do not own core
data structures, and do not require source/note schema changes.

## Plugin Layers

There are two plugin layers, and they should not be mixed.

System plugins are reserved for baseline platform capabilities:

- Basic note content types and their render/edit UI.
- Basic file type viewers, such as Markdown, PDF, image, HTML, and text.
- Core viewer adapters and low-level source handling.

System plugins should feel like part of the platform. They define what Growte can
open and the minimum note/file experiences needed for the app to function.

Ordinary plugins are user-facing tools built on top of those capabilities:

- Calendar.
- Kanban.
- Task lists.
- Tables/databases.
- Whiteboards.
- Other custom Markdown-backed tools.

Calendar must be treated as an ordinary Markdown viewer plugin, not a system
plugin. It can be bundled in the repository during MVP development, but that is a
packaging convenience, not a platform-level classification.

## Core Principle

The data must be readable without the plugin.

A plugin-enhanced file is still a normal `.md` file:

```md
---
plugin: calendar
type: event
title: Math review
start: 2026-07-01T09:00:00+08:00
end: 2026-07-01T10:00:00+08:00
tags: [math, review]
status: planned
sourceId: src_xxx
anchorIds:
  - anchor_xxx
---

Review parallelograms and trapezoids.
Focus on previous mistakes.
```

If the calendar plugin is unavailable, the file opens as ordinary Markdown. If
the plugin is available, the same file can render as a calendar event, agenda
item, or editable event form.

## Plugin Shape

The client should expose a small registry:

```ts
type MarkdownViewerPlugin = {
  id: string;
  name: string;
  match(input: MarkdownPluginMatchInput): boolean;
  viewer: MarkdownPluginViewer;
  editor?: MarkdownPluginEditor;
  commands?: MarkdownPluginCommand[];
};
```

Example registration:

```ts
registerMarkdownViewerPlugin({
  id: "calendar",
  name: "Calendar",
  match: ({ frontmatter }) => frontmatter.plugin === "calendar",
  viewer: CalendarViewer,
  editor: CalendarEditor,
  commands: calendarCommands
});
```

## Viewer Selection Flow

```text
Markdown source
  -> parse frontmatter + body
  -> PluginRegistry.match()
  -> matching custom viewer/editor
  -> fallback Markdown viewer when no plugin matches
```

Matching should be deterministic. If multiple plugins match, the first
registered plugin wins for MVP, and the UI can later expose an override.

## Calendar Plugin Direction

Calendar should be implemented as an ordinary Markdown viewer plugin, not as a
Product Kit and not as a system plugin.

Recommended MVP storage:

```text
calendar/
  2026-07-01-math-review.md
  2026-07-03-physics.md
```

Use one Markdown file per event first. This keeps create/edit/delete simple,
plays well with file history, and preserves human-readable data.

The calendar plugin owns:

- Scanning open folders for Markdown files with `plugin: calendar`.
- Parsing frontmatter into event records.
- Rendering agenda/week/month views.
- Editing frontmatter and body through a custom event editor.
- Linking events back to Growte `sourceId` and `anchorIds` when present.

## Non-goals For MVP

- No Product Kit dependency.
- No system-plugin classification for calendar, kanban, tasks, or similar tools.
- No new core entity for calendar events.
- No database migration.
- No external calendar sync.
- No complex recurrence engine.
- No runtime marketplace or sandboxed third-party plugin loading yet.

## Implementation Phases

Phase 1: bundled ordinary plugins

- Keep ordinary plugin code in `src/plugins/*`.
- Add a `MarkdownViewerPluginRegistry`.
- Parse Markdown frontmatter for local Markdown sources.
- Route matched files to custom viewers.
- Implement calendar as the first plugin.

Phase 2: richer plugin host

- Add plugin-specific commands and toolbar surfaces.
- Add folder-level collection views, such as "all calendar events in this folder".
- Add plugin settings.
- Add optional editor drawers/modals.

Phase 3: external plugins

- Load plugin manifests from a local `plugins/` folder.
- Define a stable runtime API.
- Add permission boundaries for file access, network access, and commands.
- Consider packaging and version compatibility.

## Open Questions

- Where should folder-level plugin views appear: left library, center workspace,
  or a dedicated plugin rail?
- Should plugin frontmatter use `plugin: calendar`, `view: calendar`, or both?
- Should frontmatter parsing live in the source loader, a Markdown adapter, or the
  plugin host?
- How should a user switch back to raw Markdown when a plugin claims the file?
