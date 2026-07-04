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
import {
  argumentSpec,
  causeEffectSpec,
  derivationSpec,
  excerptSpec,
  experimentSpec,
  figureSpec,
  formulaSpec,
  grammarSpec,
  theoremSpec,
  timelineSpec,
  vocabSpec,
  subjectContentSpecs
} from "./contentTypes";
import {
  argumentPlugin,
  causeEffectPlugin,
  derivationPlugin,
  excerptPlugin,
  experimentPlugin,
  figurePlugin,
  formulaPlugin,
  grammarPlugin,
  theoremPlugin,
  timelinePlugin,
  vocabPlugin
} from "./noteTypes";
import {
  generateArgumentCommand,
  generateCauseEffectCommand,
  generateDerivationCommand,
  generateExcerptCommand,
  generateExperimentCommand,
  generateFigureCommand,
  generateFormulaCommand,
  generateGrammarCommand,
  generateTheoremCommand,
  generateTimelineCommand,
  generateVocabCommand
} from "./commands";
import { subjectPrompts } from "./prompts";
import {
  chineseDetection,
  englishDetection,
  historyGeoDetection,
  mathDetection,
  scienceDetection
} from "./detection";

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

// —— M-C members (one loop step per remaining type — the textbook member pattern) ——
// Each member is installed ONCE, under its "home" kit (the doc §Risks: a shared
// plugin's home author = growte, one detail page). Multi-kit membership
// (formula∈{数学,理化生}, excerpt∈{语文,英语}, figure∈{语文,史地}) is expressed by the
// CATALOG members[] (catalog.ts refcount / foreground) + kit-level language — never by
// re-installing the member, which would double-push its surface + flip its owner kit.

const derivationMember: KitMemberPlugin = {
  id: "subject-derivation",
  name: "推导步骤 Derivation",
  install(ctx) {
    ctx.noteTypes.register(derivationSpec, derivationPlugin);
    ctx.commands.register(generateDerivationCommand);
    ctx.surfaces.contribute("selection-toolbar", [
      {
        commandId: generateDerivationCommand.id,
        title: "推导步骤",
        icon: "list-ordered",
        group: "Study Actions",
        priority: 80,
        description: "把选中的推导整理成逐步 LaTeX 步骤（含理由）"
      }
    ]);
  }
};

const theoremMember: KitMemberPlugin = {
  id: "subject-theorem",
  name: "定理卡 Theorem",
  install(ctx) {
    ctx.noteTypes.register(theoremSpec, theoremPlugin);
    ctx.commands.register(generateTheoremCommand);
    ctx.surfaces.contribute("selection-toolbar", [
      {
        commandId: generateTheoremCommand.id,
        title: "定理卡",
        icon: "scroll-text",
        group: "Study Actions",
        priority: 80,
        description: "把选中的定理整理成定理卡（内容/条件/证明/用法）"
      }
    ]);
  }
};

const grammarMember: KitMemberPlugin = {
  id: "subject-grammar",
  name: "语法点 Grammar",
  install(ctx) {
    ctx.noteTypes.register(grammarSpec, grammarPlugin);
    ctx.commands.register(generateGrammarCommand);
    ctx.surfaces.contribute("selection-toolbar", [
      {
        commandId: generateGrammarCommand.id,
        title: "语法点",
        icon: "languages",
        group: "Study Actions",
        priority: 80,
        description: "把选中的语法现象整理成语法点（含义/结构/例句/易错点）"
      }
    ]);
  }
};

const excerptMember: KitMemberPlugin = {
  id: "subject-excerpt",
  name: "摘抄赏析 Excerpt",
  install(ctx) {
    ctx.noteTypes.register(excerptSpec, excerptPlugin);
    ctx.commands.register(generateExcerptCommand);
    ctx.surfaces.contribute("selection-toolbar", [
      {
        commandId: generateExcerptCommand.id,
        title: "摘抄赏析",
        icon: "quote",
        group: "Study Actions",
        priority: 80,
        description: "把选中的名句做成摘抄赏析（出处/修辞/主题/赏析）"
      }
    ]);
  }
};

const argumentMember: KitMemberPlugin = {
  id: "subject-argument",
  name: "论证结构 Argument",
  install(ctx) {
    ctx.noteTypes.register(argumentSpec, argumentPlugin);
    ctx.commands.register(generateArgumentCommand);
    ctx.surfaces.contribute("selection-toolbar", [
      {
        commandId: generateArgumentCommand.id,
        title: "论证结构",
        icon: "scale",
        group: "Study Actions",
        priority: 80,
        description: "把选中的论述拆成论证结构（论点/论据/推理/反驳/结论）"
      }
    ]);
  }
};

const figureMember: KitMemberPlugin = {
  id: "subject-figure",
  name: "人物卡 Figure",
  install(ctx) {
    ctx.noteTypes.register(figureSpec, figurePlugin);
    ctx.commands.register(generateFigureCommand);
    ctx.surfaces.contribute("selection-toolbar", [
      {
        commandId: generateFigureCommand.id,
        title: "人物卡",
        icon: "user-round",
        group: "Study Actions",
        priority: 80,
        description: "把选中的人物整理成人物卡（时代/身份/事迹/作品/意义）"
      }
    ]);
  }
};

const causeEffectMember: KitMemberPlugin = {
  id: "subject-cause-effect",
  name: "因果链 Cause-Effect",
  install(ctx) {
    ctx.noteTypes.register(causeEffectSpec, causeEffectPlugin);
    ctx.commands.register(generateCauseEffectCommand);
    ctx.surfaces.contribute("selection-toolbar", [
      {
        commandId: generateCauseEffectCommand.id,
        title: "因果链",
        icon: "waypoints",
        group: "Study Actions",
        priority: 80,
        description: "把选中的事件拆成因果链（起因/事件/结果，短期/长期）"
      }
    ]);
  }
};

const experimentMember: KitMemberPlugin = {
  id: "subject-experiment",
  name: "实验记录 Experiment",
  install(ctx) {
    ctx.noteTypes.register(experimentSpec, experimentPlugin);
    ctx.commands.register(generateExperimentCommand);
    ctx.surfaces.contribute("selection-toolbar", [
      {
        commandId: generateExperimentCommand.id,
        title: "实验记录",
        icon: "flask-conical",
        group: "Study Actions",
        priority: 80,
        description: "把选中的实验整理成实验记录（目的/材料/步骤/现象/结论/安全）"
      }
    ]);
  }
};

// —— the kits (kit-level config ONLY — capability lives in the members) ————————————

export const subjectEnglishKit: ProductKit = {
  id: "subject-english",
  name: "英语 Kit",
  description: "生词卡、语法点、摘抄赏析——把英语材料变成可复习的卡片。",
  // PART 2 members: subject-vocab, subject-grammar, subject-excerpt, flashcard.
  // subject-excerpt is shared with 语文 (its home kit for install is 英语 here).
  contentSpecs: [vocabSpec, grammarSpec, excerptSpec],
  prompts: subjectPrompts.filter((p) =>
    ["subject.vocab", "subject.grammar", "subject.excerpt"].includes(p.outputType)
  ),
  detection: englishDetection,
  members: [vocabMember, grammarMember, excerptMember],
  install(ctx) {
    // PART 2: anchor→"Word/Point" + the per-type display names.
    ctx.language.register({
      anchor: "Word/Point",
      contentTypes: {
        "subject.vocab": "生词卡",
        "subject.grammar": "语法点",
        "subject.excerpt": "摘抄赏析"
      }
    });
  }
};

export const subjectMathKit: ProductKit = {
  id: "subject-math",
  name: "数学 Kit",
  description: "公式卡、推导步骤、定理卡——LaTeX 优先的数学学习类型。",
  // PART 2 members: subject-formula, subject-derivation, subject-theorem, mistake, quiz.
  // subject-formula is shared with 理化生 (its home kit for install is 数学).
  contentSpecs: [formulaSpec, derivationSpec, theoremSpec],
  prompts: subjectPrompts.filter((p) =>
    ["subject.formula", "subject.derivation", "subject.theorem"].includes(p.outputType)
  ),
  detection: mathDetection,
  members: [formulaMember, derivationMember, theoremMember],
  install(ctx) {
    // PART 2: source→"教材" + the per-type display names.
    ctx.language.register({
      source: "教材",
      contentTypes: {
        "subject.formula": "公式卡",
        "subject.derivation": "推导步骤",
        "subject.theorem": "定理卡"
      }
    });
  }
};

export const subjectHistoryGeoKit: ProductKit = {
  id: "subject-history-geo",
  name: "史地 Kit",
  description: "时间线、人物卡、因果链——面向历史/地理材料的结构化笔记。",
  // PART 2 members: subject-timeline, subject-figure, subject-cause-effect.
  // subject-figure is shared with 语文 (its home kit for install is 史地).
  contentSpecs: [timelineSpec, figureSpec, causeEffectSpec],
  prompts: subjectPrompts.filter((p) =>
    ["subject.timeline", "subject.figure", "subject.cause-effect"].includes(p.outputType)
  ),
  detection: historyGeoDetection,
  members: [timelineMember, figureMember, causeEffectMember],
  install(ctx) {
    ctx.language.register({
      contentTypes: {
        "subject.timeline": "时间线",
        "subject.figure": "人物卡",
        "subject.cause-effect": "因果链"
      }
    });
  }
};

// —— M-C new kits (PART 2 rows 语文 / 理化生) ————————————————————————————————————
// Deliberate shared-member overlap (§8.5.2): 语文 members subject-excerpt (home 英语) +
// subject-figure (home 史地); 理化生 members subject-formula (home 数学). Those shared
// members are NOT re-installed here (installClientKits installs each member once under
// its home kit) — this kit's `members` array carries ONLY the members it installs, while
// the CATALOG members[] (catalog.ts) express the full membership for refcount/foreground.
// Kit-level LANGUAGE still names the shared types for THIS kit's foreground.

export const subjectChineseKit: ProductKit = {
  id: "subject-chinese",
  name: "语文 Kit",
  description: "摘抄赏析、论证结构、人物卡——面向语文阅读/写作材料的结构化笔记。",
  // PART 2 members: subject-excerpt, subject-argument, subject-figure. Only argument
  // is installed here (its home kit); excerpt/figure are installed by 英语/史地.
  contentSpecs: [argumentSpec],
  prompts: subjectPrompts.filter((p) => p.outputType === "subject.argument"),
  detection: chineseDetection,
  members: [argumentMember],
  install(ctx) {
    // PART 2: note→"赏析/结构" + per-type names for THIS kit's foreground (incl. shared).
    ctx.language.register({
      note: "赏析/结构",
      contentTypes: {
        "subject.excerpt": "摘抄赏析",
        "subject.argument": "论证结构",
        "subject.figure": "人物卡"
      }
    });
  }
};

export const subjectScienceKit: ProductKit = {
  id: "subject-science",
  name: "理化生 Kit",
  description: "实验记录、公式卡、概念图——面向物理/化学/生物材料的学习类型。",
  // PART 2 members: subject-experiment, subject-formula, quiz, diagrams(=concept-map).
  // Only experiment is installed here; formula is installed by 数学 (shared, §8.5.2).
  contentSpecs: [experimentSpec],
  prompts: subjectPrompts.filter((p) => p.outputType === "subject.experiment"),
  detection: scienceDetection,
  members: [experimentMember],
  install(ctx) {
    // LaTeX + diagram layout intent — the per-type names for THIS kit's foreground.
    ctx.language.register({
      contentTypes: {
        "subject.experiment": "实验记录",
        "subject.formula": "公式卡"
      }
    });
  }
};

export const subjectKits: ProductKit[] = [
  subjectEnglishKit,
  subjectMathKit,
  subjectHistoryGeoKit,
  subjectChineseKit,
  subjectScienceKit
];
