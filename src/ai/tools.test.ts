import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { clearToolsForTests, getTool, listTools, registerTool, type ToolDefinition } from "./tools";

// The tool registry mirrors the provider registry's semantics (module Map,
// replace-on-re-register) — see registry.test.ts for the sibling suite.

function fakeTool(name: string, marker = name): ToolDefinition {
  return {
    name,
    description: `fake ${name}`,
    inputSchema: z.object({}),
    async execute() {
      return marker;
    }
  };
}

afterEach(() => clearToolsForTests());

describe("tool registry — registration semantics", () => {
  it("starts empty and lists registered tools in registration order", () => {
    expect(listTools()).toEqual([]);
    registerTool(fakeTool("search_notes"));
    registerTool(fakeTool("get_source"));
    expect(listTools().map((t) => t.name)).toEqual(["search_notes", "get_source"]);
  });

  it("getTool looks up by exact name; unknown names are undefined", async () => {
    registerTool(fakeTool("search_notes"));
    const tool = getTool("search_notes");
    expect(tool?.description).toBe("fake search_notes");
    await expect(tool?.execute({}, undefined)).resolves.toBe("search_notes");
    expect(getTool("SEARCH_NOTES")).toBeUndefined(); // names are exact, not case-folded
    expect(getTool("nope")).toBeUndefined();
  });

  it("re-registering the same name REPLACES the entry (no duplicates)", async () => {
    registerTool(fakeTool("search_notes", "first"));
    registerTool(fakeTool("search_notes", "second"));

    const entries = listTools().filter((t) => t.name === "search_notes");
    expect(entries).toHaveLength(1);
    await expect(getTool("search_notes")?.execute({}, undefined)).resolves.toBe("second");
  });

  it("clearToolsForTests empties the registry", () => {
    registerTool(fakeTool("a"));
    registerTool(fakeTool("b"));
    clearToolsForTests();
    expect(listTools()).toEqual([]);
    expect(getTool("a")).toBeUndefined();
  });
});
