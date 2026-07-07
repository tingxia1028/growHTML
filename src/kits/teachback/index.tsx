// Teach-back Kit (PRO-2, proactive-learning.md §2 — the flagship "AI 装不懂" Feynman
// experience) — a register-only ProductKit. It invents NO core entities; it REGISTERS a
// bundle into the existing registries (NoteTypeRegistry via a member plugin, the
// teachback.start command, the React-free prompt pack + content specs the SERVER
// registers). The runner PANEL self-registerViews (TeachbackPanel.tsx) + is shell-
// imported — the `views` kit sink is a DEAD phase-3 collector (clientContext.tsx:193),
// so the panel does NOT ride it (the ReviewPanel precedent).
//
// KIT-vs-core: the ONLY core touches are 4 precedented one-liners (WorkspaceShell import
// + a presets node + a commandEntries NAV_COMMANDS entry + a searchMessages string) —
// everything here is register-only.

import type { KitMemberPlugin, ProductKit } from "../types";
import { teachbackContentSpecs } from "./contentTypes";
import { teachbackSummaryPlugin, teachbackTurnPlugin } from "./noteTypes";
import { teachbackPrompts } from "./prompts";
import { teachbackStartCommand } from "./commands";

// One member: the teach-back experience — its two note types + its launch command.
const teachbackMember: KitMemberPlugin = {
  id: "teachback",
  name: "教回 Teach-back",
  description: "Feynman 教回:AI 装不懂,你来教;弱项处追问;小结成笔记。",
  install(ctx) {
    ctx.noteTypes.register(teachbackContentSpecs[0], teachbackSummaryPlugin);
    ctx.noteTypes.register(teachbackContentSpecs[1], teachbackTurnPlugin);
    ctx.commands.register(teachbackStartCommand);
  }
};

export const teachbackKit: ProductKit = {
  id: "teachback",
  name: "Teach-back Kit",
  icon: "brain",
  description: "教回/费曼模式:把你学过的东西讲给装不懂的 AI,它专挑你的薄弱处追问,最后成一条小结笔记。",
  contentSpecs: teachbackContentSpecs,
  prompts: teachbackPrompts,
  members: [teachbackMember],
  // No kit-level config (no layout/policy) — the runner panel self-registers its view.
  install() {}
};
