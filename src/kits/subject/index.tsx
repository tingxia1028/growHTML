// Subject kits (subject-kits.md PART 2, milestone M-B) — the first three of the five,
// shipped with their exemplar types: 英语 (subject.vocab), 数学 (subject.formula),
// 史地 (subject.timeline). Post-F5 shape throughout: capability lives in MEMBER
// plugins (one per exemplar type — id == CatalogEntry id, so catalog `members[]`
// resolve against the read model); the kit itself carries only kit-level config
// (domain language) + its M-A detection table.
//
// PART 2's full member lists also name EXISTING plugins (flashcard / mistake / quiz)
// — those are referenced in the CATALOG kit entries only (src/kits/catalog.ts), never
// re-installed here: their code registers once via the built-ins/textbook kit, and the
// members-union refcount (§8.5.2) handles the sharing. The M-C types (derivation /
// theorem / grammar / excerpt / figure / cause-effect) append to these kits later.
//
// Unlike the always-on textbook kit these entries are NOT default-installed
// (catalog.ts): PART 5 M-B — "installing 英语 Kit lights up vocab in the composer" —
// so the types stay registered (rendering is never gated) while their CREATE
// affordances wait for the marketplace install.

import type { KitMemberPlugin, ProductKit } from "../types";
import { formulaSpec, timelineSpec, vocabSpec, subjectContentSpecs } from "./contentTypes";
import { formulaPlugin, timelinePlugin, vocabPlugin } from "./noteTypes";
import { generateFormulaCommand, generateTimelineCommand, generateVocabCommand } from "./commands";
import { subjectPrompts } from "./prompts";
import { englishDetection, historyGeoDetection, mathDetection } from "./detection";

export { subjectContentSpecs, subjectPrompts };

// One member = one exemplar type: its note type + its AI command + its toolbar surface
// (the textbook member pattern, one loop step per plugin).
const vocabMember: KitMemberPlugin = {
  id: "subject-vocab",
  name: "生词卡 Vocab",
  install(ctx) {
    ctx.noteTypes.register(vocabSpec, vocabPlugin);
    ctx.commands.register(generateVocabCommand);
    ctx.surfaces.contribute("selection-toolbar", [
      {
        commandId: generateVocabCommand.id,
        title: "生词卡",
        icon: "spell-check",
        group: "Study Actions",
        priority: 80,
        description: "把选中的单词做成生词卡（音标/词性/释义/例句）"
      }
    ]);
  }
};

const formulaMember: KitMemberPlugin = {
  id: "subject-formula",
  name: "公式卡 Formula",
  install(ctx) {
    ctx.noteTypes.register(formulaSpec, formulaPlugin);
    ctx.commands.register(generateFormulaCommand);
    ctx.surfaces.contribute("selection-toolbar", [
      {
        commandId: generateFormulaCommand.id,
        title: "公式卡",
        icon: "sigma",
        group: "Study Actions",
        priority: 80,
        description: "把选中的公式提取为 LaTeX 公式卡（含变量表和用法）"
      }
    ]);
  }
};

const timelineMember: KitMemberPlugin = {
  id: "subject-timeline",
  name: "时间线 Timeline",
  install(ctx) {
    ctx.noteTypes.register(timelineSpec, timelinePlugin);
    ctx.commands.register(generateTimelineCommand);
    ctx.surfaces.contribute("selection-toolbar", [
      {
        commandId: generateTimelineCommand.id,
        title: "时间线",
        icon: "history",
        group: "Study Actions",
        priority: 80,
        description: "把选中的段落整理成时间线（时间/事件/意义）"
      }
    ]);
  }
};

// —— the kits (kit-level config ONLY — capability lives in the members) ————————————

export const subjectEnglishKit: ProductKit = {
  id: "subject-english",
  name: "英语 Kit",
  description: "生词卡、语法点、摘抄赏析——把英语材料变成可复习的卡片（M-B: 生词卡 + flashcard）。",
  contentSpecs: [vocabSpec],
  prompts: subjectPrompts.filter((p) => p.outputType === "subject.vocab"),
  detection: englishDetection,
  members: [vocabMember],
  install(ctx) {
    // PART 2: anchor→"Word/Point" + the per-type display name.
    ctx.language.register({
      anchor: "Word/Point",
      contentTypes: { "subject.vocab": "生词卡" }
    });
  }
};

export const subjectMathKit: ProductKit = {
  id: "subject-math",
  name: "数学 Kit",
  description: "公式卡、推导、定理——LaTeX 优先的数学学习类型（M-B: 公式卡 + 错题/小测）。",
  contentSpecs: [formulaSpec],
  prompts: subjectPrompts.filter((p) => p.outputType === "subject.formula"),
  detection: mathDetection,
  members: [formulaMember],
  install(ctx) {
    // PART 2: source→"教材" + the per-type display name.
    ctx.language.register({
      source: "教材",
      contentTypes: { "subject.formula": "公式卡" }
    });
  }
};

export const subjectHistoryGeoKit: ProductKit = {
  id: "subject-history-geo",
  name: "史地 Kit",
  description: "时间线、人物卡、因果链——面向历史/地理材料的结构化笔记（M-B: 时间线）。",
  contentSpecs: [timelineSpec],
  prompts: subjectPrompts.filter((p) => p.outputType === "subject.timeline"),
  detection: historyGeoDetection,
  members: [timelineMember],
  install(ctx) {
    ctx.language.register({
      contentTypes: { "subject.timeline": "时间线" }
    });
  }
};

export const subjectKits: ProductKit[] = [subjectEnglishKit, subjectMathKit, subjectHistoryGeoKit];
