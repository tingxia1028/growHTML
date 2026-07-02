// server-only — the A4a concrete agent tools (docs/design/multi-provider-ai-agent.md
// §4.3 "MVP honesty"): a small, safe, READ-ONLY set over the vault stores, registered
// into the src/ai tool registry with their vault access injected BY CLOSURE here (the
// iron rule's converse: src/ai defines the ToolDefinition seam and never sees a store;
// the server plugs capabilities in). The one write tool (createNote via the
// generate→preview→save loop) is A4b. Outputs are deliberately small and capped —
// every tool result is model-context payload, so each stays ≤ ~2k serialized chars
// (fitRows drops trailing rows; excerpts/snippets/quotes are sliced per-field).

import { z } from "zod";
import { registerTool, type ToolDefinition } from "../ai";
import { readSourceContent } from "../core/store/sources";
import type { SourceRecord } from "../core/schema";
import type { StudyVault } from "../core/vault";

export type AgentToolDeps = { vault: StudyVault };

/** Per-tool serialized-output budget (chars) — rows beyond it are dropped. */
export const AGENT_TOOL_RESULT_CHAR_BUDGET = 2000;
/** search_notes row budget: default/max rows and per-row snippet size. */
export const SEARCH_NOTES_DEFAULT_LIMIT = 8;
export const SEARCH_NOTES_MAX_LIMIT = 20;
export const SEARCH_SNIPPET_CHAR_CAP = 140;
/** get_source text excerpt cap (title/type/location ride alongside). */
export const SOURCE_EXCERPT_CHAR_CAP = 1500;
/** list_anchors per-row quote cap. */
export const ANCHOR_QUOTE_CHAR_CAP = 100;

// Source types whose content file is TEXT we can excerpt cheaply (readSourceContent).
// pdf/image/word are binary; web_live is a live URL with no snapshot on disk.
const TEXT_SOURCE_TYPES = new Set(["html", "markdown", "webpage", "code", "transcript"]);

const searchNotesInputSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(SEARCH_NOTES_MAX_LIMIT).optional()
});

const sourceIdInputSchema = z.object({ sourceId: z.string().min(1) });

/**
 * Largest prefix of `rows` whose JSON serialization fits the budget, plus a
 * truncation flag — the uniform "capped output" guard for row-shaped results.
 */
function fitRows<T>(rows: T[], budget = AGENT_TOOL_RESULT_CHAR_BUDGET): { rows: T[]; truncated: boolean } {
  let kept = rows.length;
  while (kept > 0 && JSON.stringify(rows.slice(0, kept)).length > budget) kept -= 1;
  return { rows: rows.slice(0, kept), truncated: kept < rows.length };
}

/** Note content as searchable text: strings verbatim, structured content as JSON. */
function noteContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content === undefined || content === null) return "";
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

/** A snippet window around the FIRST match (or the head when matching contentType only). */
function snippetAround(text: string, matchIndex: number): string {
  const start = Math.max(0, matchIndex - 40);
  const raw = text.slice(start, start + SEARCH_SNIPPET_CHAR_CAP);
  return `${start > 0 ? "…" : ""}${raw}${start + raw.length < text.length ? "…" : ""}`;
}

/** Where the source lives, for the model: original URL when known, else the vault path. */
function sourceLocation(source: SourceRecord): string {
  const metadata = source.metadata as Record<string, unknown> | undefined;
  const url = metadata?.sourceUrl ?? metadata?.normalizedUrl;
  return typeof url === "string" && url.length > 0 ? url : source.path;
}

/**
 * Build the read-only tool set bound to ONE vault. Pure factory — callers that
 * need the registry go through registerAgentTools below.
 */
export function createAgentTools({ vault }: AgentToolDeps): ToolDefinition[] {
  const searchNotes: ToolDefinition = {
    name: "search_notes",
    description:
      "Search the user's study notes by plain-text substring (case-insensitive) over note content " +
      "and contentType. Returns compact rows { id, contentType, snippet, sourceId } plus the total match count.",
    inputSchema: searchNotesInputSchema,
    execute: async (input: unknown) => {
      const { query, limit } = searchNotesInputSchema.parse(input);
      const needle = query.toLowerCase();
      const notes = await vault.stores.notes.list();
      const matches = notes.flatMap((note) => {
        const text = noteContentText(note.content);
        const index = text.toLowerCase().indexOf(needle);
        if (index < 0 && !note.contentType.toLowerCase().includes(needle)) return [];
        return [
          {
            id: note.id,
            contentType: note.contentType,
            snippet: snippetAround(text, Math.max(index, 0)),
            sourceId: note.sourceId
          }
        ];
      });
      const capped = fitRows(matches.slice(0, limit ?? SEARCH_NOTES_DEFAULT_LIMIT));
      // truncated = the model is not seeing every match (limit OR budget trim).
      return { rows: capped.rows, total: matches.length, truncated: capped.rows.length < matches.length };
    }
  };

  const getSource: ToolDefinition = {
    name: "get_source",
    description:
      "Look one study source up by id. Returns { id, title, sourceType, location } plus a capped text " +
      "excerpt for text sources (html/markdown/webpage/code/transcript). Unknown id returns { error }.",
    inputSchema: sourceIdInputSchema,
    execute: async (input: unknown) => {
      const { sourceId } = sourceIdInputSchema.parse(input);
      const source = await vault.stores.sources.get(sourceId);
      if (!source) return { error: `Source not found: ${sourceId}` };
      const row: Record<string, unknown> = {
        id: source.id,
        title: source.title,
        sourceType: source.sourceType,
        location: sourceLocation(source)
      };
      if (TEXT_SOURCE_TYPES.has(source.sourceType)) {
        try {
          const text = await readSourceContent(vault, source);
          row.excerpt = text.slice(0, SOURCE_EXCERPT_CHAR_CAP);
          row.excerptTruncated = text.length > SOURCE_EXCERPT_CHAR_CAP;
        } catch {
          // Content file missing/unreadable — the metadata row is still useful.
        }
      }
      return row;
    }
  };

  const listAnchors: ToolDefinition = {
    name: "list_anchors",
    description:
      "List the highlight anchors on one source. Returns compact rows { id, kind, quote } " +
      "plus the total anchor count. Unknown sourceId returns { error }.",
    inputSchema: sourceIdInputSchema,
    execute: async (input: unknown) => {
      const { sourceId } = sourceIdInputSchema.parse(input);
      if (!(await vault.stores.sources.get(sourceId))) return { error: `Source not found: ${sourceId}` };
      const anchors = (await vault.stores.anchors.list()).filter((anchor) => anchor.sourceId === sourceId);
      const rows = anchors.map((anchor) => ({
        id: anchor.id,
        kind: anchor.anchorKind,
        quote: anchor.quote.slice(0, ANCHOR_QUOTE_CHAR_CAP)
      }));
      const capped = fitRows(rows);
      return { rows: capped.rows, total: anchors.length, truncated: capped.truncated };
    }
  };

  return [searchNotes, getSource, listAnchors];
}

/**
 * Create the tools bound to this vault AND register them in the src/ai registry
 * (replace-on-re-register keeps repeat createApp calls idempotent). Returns the
 * created instances so the caller can hold ITS vault's set — with several apps
 * alive (tests spin publisher/recipient pairs) the registry's global entries
 * belong to whichever app registered last.
 */
export function registerAgentTools(deps: AgentToolDeps): ToolDefinition[] {
  const tools = createAgentTools(deps);
  for (const tool of tools) registerTool(tool);
  return tools;
}
