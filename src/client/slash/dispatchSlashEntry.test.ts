// SC-2 — dispatchSlashEntry: the ONE shared pick→dispatch decision used by the chat
// composer AND the toolbar mounts. All three branches + the exact generate-block hint
// string + the operation.run payload are locked here so neither mount can drift.
import { describe, expect, it, vi } from "vitest";
import { dispatchSlashEntry, generateBlockText } from "./dispatchSlashEntry";
import type { SlashEntry } from "./engine";

function noteType(id: string, title: string): SlashEntry {
  return { kind: "noteType", id, title, aliases: [] };
}
function operation(id: string, scope: "anchor" | "source" = "anchor"): SlashEntry {
  return { kind: "operation", id, title: "op", aliases: [], scope };
}

function deps() {
  return {
    dispatch: vi.fn().mockResolvedValue(undefined),
    openManualEditor: vi.fn()
  };
}

describe("dispatchSlashEntry", () => {
  it("noteType, NO instruction → openManualEditor(id) only (manual mode)", () => {
    const d = deps();
    dispatchSlashEntry(noteType("quiz", "小测"), "", d);
    expect(d.openManualEditor).toHaveBeenCalledTimes(1);
    expect(d.openManualEditor).toHaveBeenCalledWith("quiz");
    expect(d.dispatch).not.toHaveBeenCalled();
  });

  it("noteType + instruction → note.generate-block with the EXACT form-router hint string", () => {
    const d = deps();
    dispatchSlashEntry(noteType("quiz", "小测"), "出三道压强题", d);
    expect(d.openManualEditor).not.toHaveBeenCalled();
    expect(d.dispatch).toHaveBeenCalledTimes(1);
    const [commandId, payload] = d.dispatch.mock.calls[0] as [string, { text: string }];
    expect(commandId).toBe("note.generate-block");
    // The LOCKED string — `以「${title}」(${id}) 的形式：${instruction}`.
    expect(payload.text).toBe("以「小测」(quiz) 的形式：出三道压强题");
    expect(payload.text).toBe(generateBlockText("小测", "quiz", "出三道压强题"));
  });

  it("operation → operation.run with the entry's id + scope, no manual editor", () => {
    const d = deps();
    dispatchSlashEntry(operation("op_test", "source"), "", d);
    expect(d.openManualEditor).not.toHaveBeenCalled();
    expect(d.dispatch).toHaveBeenCalledTimes(1);
    const [commandId, payload] = d.dispatch.mock.calls[0] as [
      string,
      { operationId: string; scope: string; variables: unknown[] }
    ];
    expect(commandId).toBe("operation.run");
    expect(payload.operationId).toBe("op_test");
    expect(payload.scope).toBe("source");
    expect(payload.variables).toEqual([]);
  });

  it("operation ignores a stray instruction (operations carry no instruction from any mount)", () => {
    const d = deps();
    dispatchSlashEntry(operation("op_x"), "some text", d);
    const [commandId, payload] = d.dispatch.mock.calls[0] as [string, { operationId: string; scope: string }];
    expect(commandId).toBe("operation.run");
    expect(payload.operationId).toBe("op_x");
    expect(payload.scope).toBe("anchor");
  });
});
