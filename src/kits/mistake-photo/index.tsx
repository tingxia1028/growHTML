// Mistake-Photo Kit (V-2, vision-input.md §3 — the 拍照错题 → VLM 抽取 → 预览 → 存错题本
// killer flow) — a register-only ProductKit. It invents NO core entities and registers NO
// content spec: the extracted card is the CORE `mistake` type (its spec + React render are
// core built-ins). The kit contributes ONLY the VLM extract prompt (React-free, server-
// registered via kitPrompts) + the `mistake-photo.capture` command. Mirrors teachbackKit.
//
// KIT-vs-core: zero core touches beyond the two register-only aggregation one-liners
// (kitPrompts + productKits) — everything here rides the existing registries.

import type { KitMemberPlugin, ProductKit } from "../types";
import { mistakePhotoCommands } from "./commands";
import { mistakePhotoPrompts } from "./prompts";

// One member: the 拍错题 experience — its capture command. (No note types: the extracted
// card is the CORE `mistake` type, already rendered by the core mistakeNoteType.)
const mistakePhotoMember: KitMemberPlugin = {
  id: "mistake-photo",
  name: "拍错题 Mistake Photo",
  description: "拍照错题 → VLM 抽取 → 预览 → 存错题本。",
  install(ctx) {
    for (const command of mistakePhotoCommands) ctx.commands.register(command);
  }
};

export const mistakePhotoKit: ProductKit = {
  id: "mistake-photo",
  name: "Mistake Photo Kit",
  icon: "camera",
  description: "拍错题:拍一张错题照片,AI 抽取题目/错误答案/正确解法/错因/订正,预览后存进错题本。",
  // React-free prompt pack (the server registers it) — the extract prompt. NO contentSpecs:
  // the output is the core `mistake` type.
  prompts: mistakePhotoPrompts,
  members: [mistakePhotoMember],
  // No kit-level config (no layout/policy).
  install() {}
};
