import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { SERVER } from "./harness";
import { openNotesTab } from "./helpers";

// M-C subject types (subject-kits.md PART 1 §1.2–1.11) end-to-end against the REAL
// running app. Two contract halves, both provider/UI-chrome-independent so this spec
// stays stable while the workspace IA rebuild is in flight on this branch:
//
//   (1) SERVER validation — the running server registers the 8 M-C content specs via
//       installServerKits, so `POST /api/notes` ACCEPTS schema-valid `subject.*`
//       content and REJECTS malformed content with 4xx. This is the adaptive-note
//       mandatory contract's server half: content is validated by parseNoteContent
//       before storage (no bespoke path).
//   (2) CLIENT registration + render — the shipped client bundle registers each M-C
//       type through the kit → noteTypes.register → registerNoteType path, and renders
//       ONLY through getNoteType().render. We evaluate the app's own registry inside the
//       real browser (window bridge) to prove card + full render produce DOM and that a
//       math-bearing type (derivation) degrades bad TeX to an inert .katex-error span
//       rather than throwing.

async function seedHtmlSource(request: APIRequestContext, title: string, body: string) {
  const res = await request.post(`${SERVER}/api/sources/html`, { data: { title, content: body } });
  expect(res.ok(), `seed source failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).source as { id: string; title: string };
}

// One schema-valid sample per M-C type (the doc's field shapes).
const VALID: Record<string, unknown> = {
  "subject.derivation": {
    title: "动能定理推导",
    goal: "由功推出 E_k",
    steps: [{ expr: "W = F s", rationale: "功的定义" }, { expr: "E_k = \\frac{1}{2} m v^2" }],
    result: "E_k = \\frac{1}{2} m v^2"
  },
  "subject.theorem": {
    name: "勾股定理",
    statement: "a^2 + b^2 = c^2",
    conditions: ["直角三角形"],
    proof: "面积法",
    usage: "求第三边",
    examples: ["3-4-5"]
  },
  "subject.grammar": {
    pattern: "would rather + 动词原形",
    meaning: "宁愿",
    structure: "would rather + do",
    examples: [{ sentence: "I would rather stay.", note: "原形" }],
    pitfalls: ["不加 to"]
  },
  "subject.excerpt": {
    quote: "落霞与孤鹜齐飞",
    author: "王勃",
    work: "滕王阁序",
    comment: "对偶工整,动静结合",
    devices: ["对偶"],
    theme: "壮美"
  },
  "subject.argument": {
    claim: "科技进步扩大了教育差距",
    grounds: ["资源集中在发达地区"],
    warrant: "获取不平等放大差距",
    evidence: ["城乡完成率差异显著"],
    counter: ["开放课程理论上人人可用"],
    conclusion: "需政策配套"
  },
  "subject.figure": {
    name: "商鞅",
    era: "战国",
    role: "改革家",
    facts: ["主持秦国变法", "奖励耕战"],
    works: ["商君书"],
    significance: "为统一奠定制度基础",
    relations: [{ name: "秦孝公", relation: "君主/支持者" }]
  },
  "subject.cause-effect": {
    title: "商鞅变法",
    event: "商鞅变法",
    causes: [{ factor: "秦国国力落后", category: "政治" }],
    effects: [
      { outcome: "国力迅速上升", term: "短期" },
      { outcome: "为统一奠定基础", term: "长期" }
    ]
  },
  "subject.experiment": {
    title: "测量金属密度",
    purpose: "测定金属密度",
    materials: ["天平", "量筒"],
    procedure: ["称质量", "量水求体积差", "ρ = m/V"],
    observations: ["水面上升"],
    conclusion: "由 ρ = m/V 得密度",
    safety: ["小心量筒易碎"]
  }
};

// One MALFORMED sample per type (missing a required field / wrong enum) — must be
// rejected by the server's parseNoteContent gate.
const INVALID: Record<string, unknown> = {
  "subject.derivation": { title: "T" }, // steps required
  "subject.theorem": { name: "T" }, // statement required
  "subject.grammar": { pattern: "p", meaning: "m" }, // examples required
  "subject.excerpt": { quote: "q" }, // comment required
  "subject.argument": { claim: "c" }, // grounds required
  "subject.figure": { name: "n" }, // facts required
  "subject.cause-effect": { title: "t", event: "e", causes: [{ factor: "f" }] }, // effects required
  "subject.experiment": { title: "t", purpose: "p" } // procedure required
};

const MC_TYPES = Object.keys(VALID);

test("server validates the 8 M-C subject types: accepts schema-valid, rejects malformed", async ({ request }) => {
  const source = await seedHtmlSource(request, `M-C Types ${Date.now()}`, "<article><p>Body.</p></article>");

  for (const contentType of MC_TYPES) {
    // Valid content → the server registered the spec (installServerKits) and stores it.
    const ok = await request.post(`${SERVER}/api/notes`, {
      data: { sourceId: source.id, contentType, content: VALID[contentType] }
    });
    expect(ok.ok(), `${contentType} valid content should be accepted (got ${ok.status()})`).toBeTruthy();
    const note = (await ok.json()).note as { contentType: string; content: unknown };
    expect(note.contentType, contentType).toBe(contentType);

    // Malformed content → parseNoteContent rejects it before storage (4xx).
    const bad = await request.post(`${SERVER}/api/notes`, {
      data: { sourceId: source.id, contentType, content: INVALID[contentType] }
    });
    expect(bad.ok(), `${contentType} malformed content must be rejected`).toBeFalsy();
    expect(bad.status(), `${contentType} reject status`).toBeGreaterThanOrEqual(400);
  }
});

async function openSource(page: Page, title: string) {
  await page.goto("/");
  await page.locator(".source-item-open", { hasText: title }).first().click();
  await expect(page.locator(".reader-tab-title")).toHaveText(title);
}

// A math-bearing M-C exemplar surfaced through the SAME NoteListPanel PreviewCard the
// built-in types use — proving a subject.* note renders IN ITS FORM through
// getNoteType().render (no bespoke path). We pick 实验记录 (a sectioned card whose body
// text is deterministic) so the card body assertion is stable across the IA rebuild.
test("a seeded 实验记录 (subject.experiment) note renders through the shared PreviewCard, in its form", async ({
  page,
  request
}) => {
  const title = `Experiment Note ${Date.now()}`;
  const source = await seedHtmlSource(request, title, "<article><p>Body about experiments.</p></article>");

  const noteRes = await request.post(`${SERVER}/api/notes`, {
    data: { sourceId: source.id, contentType: "subject.experiment", content: VALID["subject.experiment"] }
  });
  expect(noteRes.ok(), `create experiment note failed: ${noteRes.status()}`).toBeTruthy();

  await openSource(page, title);
  await openNotesTab(page);

  // The card badge shows the HUMAN type label — the kit's 中文 title "实验记录"
  // (noteCardMeta resolves the plugin label), not the raw contentType string.
  const row = page
    .locator(".note-list-row", { has: page.locator(".sv-artifact-badge", { hasText: "实验记录" }) })
    .first();
  await expect(row).toBeVisible();

  // The card renders the experiment form (the §1.11 card body: conclusion/purpose line),
  // proving the note flowed through getNoteType("subject.experiment").render.
  const card = row.locator(".sv-preview-card");
  await expect(card).toContainText("ρ = m/V");
});

// A math-bearing type (公式-adjacent) renders LaTeX through the shared <Latex> seam in
// the CenterView, and a subject type never throws on a bad shape. We open the theorem's
// FULL view (the sectioned Center View) and assert its statement typeset via KaTeX.
test("定理卡 (subject.theorem) full view typesets its statement through the shared <Latex>/KaTeX seam", async ({
  page,
  request
}) => {
  const title = `Theorem Note ${Date.now()}`;
  const source = await seedHtmlSource(request, title, "<article><p>Body about theorems.</p></article>");

  const noteRes = await request.post(`${SERVER}/api/notes`, {
    data: { sourceId: source.id, contentType: "subject.theorem", content: VALID["subject.theorem"] }
  });
  expect(noteRes.ok(), `create theorem note failed: ${noteRes.status()}`).toBeTruthy();

  await openSource(page, title);
  await openNotesTab(page);

  const row = page
    .locator(".note-list-row", { has: page.locator(".sv-artifact-badge", { hasText: "定理卡" }) })
    .first();
  await expect(row).toBeVisible();

  // Open the shared centered FocusOverlay (CenterView) → the full view typesets the
  // statement via the SAME KaTeX seam the formula card uses (.katex present, no error).
  await row.locator(".sv-preview-card").click();
  const overlay = page.locator(".sv-focus-overlay");
  await expect(overlay).toBeVisible();
  await expect(overlay.locator(".sv-latex .katex").first()).toBeVisible({ timeout: 15_000 });
  await expect(overlay.locator(".katex-error")).toHaveCount(0);
  await expect(overlay).toContainText("直角三角形"); // a condition — the sectioned full body

  await page.keyboard.press("Escape");
  await expect(overlay).toHaveCount(0);
});
