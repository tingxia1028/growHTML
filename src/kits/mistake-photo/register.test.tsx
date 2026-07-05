// @vitest-environment jsdom
// V-2 拍错题 kit registration: installing the client kits + the server prompts wires the
// capture command (resolvable + available once a photo is staged) + the extract prompt
// (resolvable by id) — and the extracted card renders through the CORE `mistake` note type
// (the kit registers NO note type of its own). This is the "register" commit's gate.
import { describe, expect, it } from "vitest";
import { isValidElement } from "react";

// Side effect: install the Product Kits (textbook + subject + teach-back + mistake-photo).
// This registers the mistake-photo capture command into the global command registry.
import "../clientKits";
// The CORE note types register via this side-effect (mistakeNoteType is a core built-in,
// NOT a kit plugin — the kit registers no note type of its own).
import "../../client/notes/builtinNoteTypes";
// The 错题本 browse/manage lens now lives in THIS kit (folded from core) — importing it
// self-registerViews kind "mistake.book" into the shared global registry (the shell does
// this side-effect import at runtime; here we pin the register-only relocation).
import "./MistakeBookView";
// Server-side prompt registration (React-free) — the same path installServerKits rides.
import { installServerKits } from "../server";

import { getCommand } from "../../client/commands/registry";
import { getNoteType } from "../../client/notes/noteTypeRegistry";
import { getView } from "../../client/workspace/viewRegistry";
import { getKitPrompt } from "../prompts";
import { getNoteContentSpec, MISTAKE_CONTENT_TYPE } from "../../core/notes/contentTypes";
import { MISTAKE_PHOTO_EXTRACT_PROMPT } from "./commands";

installServerKits();

// A minimal CommandContext stub — enough to probe isAvailable (payload only).
function ctxWith(images?: Array<{ type: "image"; assetId: string }>) {
  return { payload: images ? { images } : {} } as unknown as Parameters<
    NonNullable<ReturnType<typeof getCommand>>["isAvailable"]
  >[0];
}

describe("mistake-photo kit registration", () => {
  it("registers the mistake-photo.capture command", () => {
    const command = getCommand("mistake-photo.capture");
    expect(command).toBeTruthy();
    expect(command!.group).toBe("mistake-photo");
  });

  it("the folded 错题本 lens self-registers kind mistake.book; the `mistake` contentType stays CORE", () => {
    // Register-only relocation: the view moved into this kit's directory but self-registers
    // into the SAME global registry, so getView(kind) resolves (kind string unchanged).
    expect(getView("mistake.book")).toBeTruthy();
    // The contentType stays a CORE spec (the kit does NOT own it — only the browse lens).
    expect(getNoteContentSpec(MISTAKE_CONTENT_TYPE)).toBeTruthy();
  });

  it("capture is available once a photo REF is staged, unavailable otherwise (degrade-not-disappear key)", () => {
    const command = getCommand("mistake-photo.capture")!;
    expect(command.isAvailable(ctxWith())).toBe(false);
    expect(command.isAvailable(ctxWith([{ type: "image", assetId: "asset_01ARZ3NDEKTSV4RRFFQ69G5FAV" }]))).toBe(true);
  });

  it("getKitPrompt resolves mistake-photo.extract after installServerKits → CORE mistake output", () => {
    const prompt = getKitPrompt(MISTAKE_PHOTO_EXTRACT_PROMPT);
    expect(prompt).toBeTruthy();
    expect(prompt!.outputType).toBe(MISTAKE_CONTENT_TYPE);
    // The output type is a REGISTERED core spec (preview/save/render reuse it).
    expect(getNoteContentSpec(MISTAKE_CONTENT_TYPE)).toBeTruthy();
  });

  it("the extracted card renders through the CORE `mistake` note type (adaptive-note contract)", () => {
    const plugin = getNoteType(MISTAKE_CONTENT_TYPE);
    expect(plugin).toBeTruthy();
    const el = plugin!.render({
      content: {
        question: "1/2 + 1/3 = ?",
        wrongAnswer: "2/5",
        correctAnswer: "5/6",
        retryCount: 0,
        mastery: "weak"
      },
      mode: "full"
    });
    expect(isValidElement(el)).toBe(true);
  });
});
