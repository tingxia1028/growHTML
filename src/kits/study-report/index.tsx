// Study Report Kit (REPORT-1, study-report-delivery.md §1 — the 学习报告 core) — a
// register-only ProductKit. It invents NO core entities; it REGISTERS a bundle into the
// existing registries: the study-report.report note type (spec + client plugin), the
// generate + open commands, and the React-free prompt pack + content spec the SERVER
// registers. The report.list VIEW self-registerViews (ReportListView.tsx, shell-imported —
// the `views` kit sink is a dead phase-3 collector, the TeachbackPanel precedent). Mirrors
// teachbackKit / mistakePhotoKit.
//
// KIT-vs-core: the ONLY core touches are register-only aggregation edits (kitContentSpecs +
// kitPrompts in src/kits/index.ts, productKits in clientKits.tsx) + the report.list shell
// import + the launch one-liners (commandEntries NAV_COMMANDS + searchMessages). Zero
// core-ENGINE edits (no schema / server-route / entity).

import type { KitMemberPlugin, ProductKit } from "../types";
import { studyReportContentSpecs } from "./contentTypes";
import { studyReportPlugin } from "./noteTypes";
import { studyReportPrompts } from "./prompts";
import { studyReportCommands } from "./commands";

// One member: the 学习报告 experience — its note type + its generate/open commands.
const studyReportMember: KitMemberPlugin = {
  id: "study-report",
  name: "学习报告 Study Report",
  description: "把这段时间的学习(复习/错题/活跃/弱项)总结成一份可编辑的学习报告。",
  install(ctx) {
    ctx.noteTypes.register(studyReportContentSpecs[0], studyReportPlugin);
    for (const command of studyReportCommands) ctx.commands.register(command);
  }
};

export const studyReportKit: ProductKit = {
  id: "study-report",
  name: "Study Report Kit",
  description:
    "学习报告:把 MEM-2 记忆里的复习/错题/活跃/弱项,按本周/本月自动总结成一份可编辑的报告,存进报告列表。",
  contentSpecs: studyReportContentSpecs,
  prompts: studyReportPrompts,
  members: [studyReportMember],
  // No kit-level config (no layout/policy) — the report.list view self-registers.
  install() {}
};
