// @vitest-environment jsdom
// PRO-2 teach-back kit registration: installing the client kits + the server prompts wires
// the two note types (render/edit through the ONE getNoteType contract) + the three prompts
// (resolvable by id from the React-free registry). This is the "register" commit's gate.
import { describe, expect, it } from "vitest";
import { isValidElement } from "react";

// Side effect: install the Product Kits (textbook + subject + teach-back). This registers
// the teach-back note types (spec + client plugin) into the global registries.
import "../clientKits";
// Server-side prompt registration (React-free) — the same path installServerKits rides.
import { installServerKits } from "../server";

import { getNoteType } from "../../client/notes/noteTypeRegistry";
import { getKitPrompt } from "../prompts";
import { getNoteContentSpec } from "../../core/notes/contentTypes";

installServerKits();

describe("teach-back kit registration", () => {
  it("getNoteType('teachback.summary').render returns a React element (adaptive-note contract)", () => {
    const plugin = getNoteType("teachback.summary");
    expect(plugin).toBeTruthy();
    const el = plugin!.render({
      content: { topic: "浮力", explainedWell: ["排开的水"], gaps: [], summary: "讲清了。", transcript: [] },
      mode: "full"
    });
    expect(isValidElement(el)).toBe(true);
    // card mode also renders (the light preview body)
    expect(isValidElement(plugin!.render({ content: { topic: "浮力" }, mode: "card" }))).toBe(true);
  });

  it("getNoteType('teachback.turn') is registered + hidden (machine type)", () => {
    const plugin = getNoteType("teachback.turn");
    expect(plugin).toBeTruthy();
    expect(plugin!.hidden).toBe(true);
    expect(isValidElement(plugin!.render({ content: { role: "ai", kind: "pose", text: "为什么?" } }))).toBe(true);
  });

  it("both content specs are in the core registry (server validation path)", () => {
    expect(getNoteContentSpec("teachback.summary")).toBeTruthy();
    expect(getNoteContentSpec("teachback.turn")).toBeTruthy();
  });

  it("getKitPrompt resolves all three teach-back prompts after installServerKits", () => {
    for (const id of ["teach.pose", "teach.probe", "teach.wrapup"]) {
      const prompt = getKitPrompt(id);
      expect(prompt, id).toBeTruthy();
    }
    expect(getKitPrompt("teach.pose")!.outputType).toBe("teachback.turn");
    expect(getKitPrompt("teach.wrapup")!.outputType).toBe("teachback.summary");
  });
});
